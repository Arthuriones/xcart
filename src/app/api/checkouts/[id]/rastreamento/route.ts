import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  chaveDoCheckout,
  conferirLigarRastreamento,
  lerPerfilParaLimites,
  lerUso,
  limitesDoPerfil,
} from "@/lib/billing/limites";
import { conferirCredencial } from "@/lib/checkouts-externos/rastreio";
import { getPublicAppUrl } from "@/lib/public-url";
import { NAO_ENCONTRADO, checkoutDaSessao, json, usuarioDaSessao } from "@/lib/checkouts-externos/servidor";
import {
  NOME_REDE,
  codigoDeTeste,
  colunaAusente,
  compraQuandoDe,
  contaDoPixel,
  nomeDaPlataforma,
  rastreiaCompra,
  scriptDaPonteDoCheckout,
  tabelaAusente,
  tokenDoPixel,
  type CheckoutExternoRow,
  type DestinoNaTela,
  type EnvioNaTela,
  type PlataformaRastreio,
  type RastreamentoDoCheckout,
  type StatusDoEnvio,
} from "@/lib/checkouts-externos/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// /api/checkouts/[id]/rastreamento: a compra do checkout (Cakto) pelo servidor
// ao Meta e ao TikTok (073). A SESSAO confere o dono (checkoutDaSessao, RLS);
// quem grava e o service role.
//
//   GET     destinos (sem o token), "Mandar a compra", as ultimas compras
//           enviadas, o uso do limite do plano e a tag da ponte para a pagina
//           de vendas, com o que ela mandou nas ultimas 24 h (Fase D)
//   POST    salva o pixel de uma rede { plataforma, conta, token?, testEventCode?, ativo? }:
//           confere o token com um evento CUSTOM (nunca uma compra) antes de gravar
//   PATCH   { compra_quando } e/ou { plataforma, ativo }
//   DELETE  ?plataforma=meta|tiktok tira o pixel: desliga e apaga o token, e
//           a linha fica (a fila dela e a trava contra a compra em dobro)
//
// LIMITE DO PLANO: checkout com destino ativo conta como uma loja com
// rastreamento (conferirLigarRastreamento com { checkoutId }). So barra
// ativacao NOVA: religar o que ja conta, ou mexer no pixel, passa.
//
// Toda resposta de sucesso devolve o estado inteiro: a tela so troca o que
// mostra. O token nunca volta.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const ENVIOS_NA_TELA = 20;

/** O nome da compra na fila (o do Meta, nas duas redes): a lista da tela e so dela. */
const COMPRA = "Purchase";
/** O que a ponte manda da pagina de vendas (Fase D). */
const DA_PAGINA = { visitas: "PageView", inicios: "InitiateCheckout" } as const;

const AINDA_NAO = () =>
  json(503, { ok: false, erro: "O rastreamento do checkout ainda não foi liberado. Tente mais tarde." });

function plataformaDe(v: unknown): PlataformaRastreio | null {
  return v === "meta" || v === "tiktok" ? v : null;
}

async function lerEstado(admin: Admin, checkout: CheckoutExternoRow, userId: string): Promise<RastreamentoDoCheckout> {
  const vazio: RastreamentoDoCheckout = {
    compraQuando: compraQuandoDe(checkout.compra_quando),
    destinos: [],
    envios: [],
    uso: null,
    semMigration: false,
    scriptDaPagina: scriptDaPonteDoCheckout(getPublicAppUrl(), checkout.id, checkout.plataforma),
    daPagina: null,
  };
  // Pela sessao (RLS): so o checkout do dono. A fila, so as colunas que o
  // grant da 073 da ao lojista (nunca o payload), e so as compras: o PageView
  // e o InitiateCheckout da pagina (Fase D) encheriam a lista.
  const supabase = await createClient();
  const [ds, es] = await Promise.all([
    supabase
      .from("checkout_externo_destinos")
      .select("id, plataforma, conta, test_event_code, ativo")
      .eq("checkout_id", checkout.id)
      .order("plataforma", { ascending: true }),
    supabase
      .from("checkout_externo_envios")
      .select("id, plataforma, event_name, grupo, status, attempts, last_error, sent_at, created_at")
      .eq("checkout_id", checkout.id)
      .eq("event_name", COMPRA)
      .order("created_at", { ascending: false })
      .limit(ENVIOS_NA_TELA),
  ]);
  if (ds.error) {
    if (tabelaAusente(ds.error)) return { ...vazio, semMigration: true };
    throw new Error(`falha ao ler os destinos: ${ds.error.message}`);
  }
  if (es.error && !tabelaAusente(es.error)) throw new Error(`falha ao ler os envios: ${es.error.message}`);

  const linhas = (ds.data ?? []) as { id: string; plataforma: string; conta: string; test_event_code: string | null; ativo: boolean }[];
  // So a EXISTENCIA do token (service role: a tabela nao tem policy).
  let comToken = new Set<string>();
  if (linhas.length > 0) {
    const { data, error } = await admin
      .from("checkout_externo_destino_segredos")
      .select("destino_id")
      .in(
        "destino_id",
        linhas.map((l) => l.id)
      );
    if (error) throw new Error(`falha ao ler os tokens: ${error.message}`);
    comToken = new Set(((data ?? []) as { destino_id: string }[]).map((s) => String(s.destino_id)));
  }
  // Desligado e sem token = removido (o DELETE guarda a linha pela trava da
  // fila): para a tela, "Não configurado".
  const destinos: DestinoNaTela[] = linhas
    .map((l) => ({
      plataforma: (l.plataforma === "tiktok" ? "tiktok" : "meta") as PlataformaRastreio,
      conta: String(l.conta),
      testEventCode: l.test_event_code ?? null,
      ativo: Boolean(l.ativo),
      temToken: comToken.has(String(l.id)),
    }))
    .filter((d) => d.ativo || d.temToken);

  const envios: EnvioNaTela[] = ((es.error ? [] : es.data ?? []) as Record<string, unknown>[]).map((e) => ({
    id: String(e.id),
    plataforma: e.plataforma === "tiktok" ? "tiktok" : "meta",
    evento: String(e.event_name ?? ""),
    grupo: (e.grupo as string | null) ?? null,
    status: (["pendente", "enviado", "falhou"].includes(String(e.status)) ? e.status : "pendente") as StatusDoEnvio,
    tentativas: Number(e.attempts) || 0,
    detalhe: (e.last_error as string | null) ?? null,
    enviadoEm: (e.sent_at as string | null) ?? null,
    criadoEm: String(e.created_at),
  }));

  // A pagina de vendas nas ultimas 24 h: as linhas de UMA rede (cada acao
  // rende uma por pixel), so contagem. Falhou, a tela so nao mostra o numero.
  let daPagina: RastreamentoDoCheckout["daPagina"] = null;
  const rede = destinos.find((d) => d.ativo)?.plataforma;
  if (rede) {
    const desde = new Date(Date.now() - 864e5).toISOString();
    const contar = (evento: string) =>
      supabase
        .from("checkout_externo_envios")
        .select("id", { count: "exact", head: true })
        .eq("checkout_id", checkout.id)
        .eq("plataforma", rede)
        .eq("event_name", evento)
        .gte("created_at", desde);
    const [v, i] = await Promise.all([contar(DA_PAGINA.visitas), contar(DA_PAGINA.inicios)]);
    if (!v.error && !i.error) daPagina = { visitas: v.count ?? 0, inicios: i.count ?? 0 };
  }

  // O uso do limite: so informativo aqui (a trava e no POST/PATCH).
  let uso: RastreamentoDoCheckout["uso"] = null;
  try {
    const limites = limitesDoPerfil(await lerPerfilParaLimites(admin, userId));
    const u = await lerUso(admin, userId);
    uso = { emUso: u.rastreamento.size, limite: limites.rastreamento, esteConta: u.rastreamento.has(chaveDoCheckout(checkout.id)) };
  } catch (e) {
    console.error("[checkouts/rastreamento] uso", e instanceof Error ? e.message : e);
  }

  return { ...vazio, destinos, envios, uso, daPagina };
}

/** O usuario e o checkout dele (de venda), ou a resposta de erro. */
async function abrir(id: string): Promise<{ userId: string; checkout: CheckoutExternoRow } | Response> {
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  let checkout: CheckoutExternoRow | null;
  try {
    checkout = await checkoutDaSessao(id);
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler o checkout: ${e instanceof Error ? e.message : e}` });
  }
  if (!checkout) return NAO_ENCONTRADO();
  return { userId: user.id, checkout };
}

async function responder(admin: Admin, checkout: CheckoutExternoRow, userId: string, extra: Record<string, unknown> = {}) {
  try {
    return json(200, { ok: true, ...(await lerEstado(admin, checkout, userId)), ...extra });
  } catch (e) {
    return json(500, { ok: false, erro: e instanceof Error ? e.message : "Falha ao ler o rastreamento." });
  }
}

/** O pixel da rede existe E tem token salvo? A resposta de erro, se o banco falhou. */
async function temTokenSalvo(
  admin: Admin,
  checkoutId: string,
  userId: string,
  plataforma: PlataformaRastreio
): Promise<boolean | Response> {
  const { data, error } = await admin
    .from("checkout_externo_destinos")
    .select("id")
    .eq("checkout_id", checkoutId)
    .eq("user_id", userId)
    .eq("plataforma", plataforma)
    .maybeSingle();
  if (error) {
    if (tabelaAusente(error)) return AINDA_NAO();
    return json(500, { ok: false, erro: `Falha ao ler o pixel: ${error.message}` });
  }
  if (!data) return false;
  const { data: s, error: e } = await admin
    .from("checkout_externo_destino_segredos")
    .select("destino_id")
    .eq("destino_id", String((data as { id: string }).id))
    .maybeSingle();
  if (e) return json(500, { ok: false, erro: `Falha ao ler o token: ${e.message}` });
  return Boolean(s);
}

/** Ligar conta no limite do plano. null = pode. */
async function conferirLimite(admin: Admin, userId: string, checkoutId: string) {
  const limite = await conferirLigarRastreamento(admin, userId, { checkoutId });
  if (limite.ok) return null;
  const erro = limite.mensagem;
  return json(limite.status, { ok: false, erro, code: limite.codigo });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aberto = await abrir(id);
  if (aberto instanceof Response) return aberto;
  return responder(createAdminClient(), aberto.checkout, aberto.userId);
}

interface CorpoDestino {
  plataforma?: unknown;
  conta?: unknown;
  token?: unknown;
  testEventCode?: unknown;
  ativo?: unknown;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aberto = await abrir(id);
  if (aberto instanceof Response) return aberto;
  const { userId, checkout } = aberto;
  if (!rastreiaCompra(checkout.plataforma)) {
    return json(400, { ok: false, erro: `A ${nomeDaPlataforma(checkout.plataforma)} não manda a compra pelo Panda Track.` });
  }

  let corpo: CorpoDestino;
  try {
    corpo = (await request.json()) as CorpoDestino;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }
  const plataforma = plataformaDe(corpo?.plataforma);
  if (!plataforma) return json(400, { ok: false, erro: "Rede inválida." });
  const rede = NOME_REDE[plataforma];
  const conta = contaDoPixel(plataforma, corpo.conta);
  if (!conta) {
    return json(400, {
      ok: false,
      erro: plataforma === "tiktok" ? "Pixel ID do TikTok inválido. Esperado algo como CUSG5HBC77UD11VVRQEG." : "ID do pixel inválido. Esperado só dígitos.",
    });
  }
  const teste = codigoDeTeste(corpo.testEventCode);
  if (teste === undefined) return json(400, { ok: false, erro: "Código de teste inválido: só letras, números, _ e -." });
  const colado = corpo.token === undefined || corpo.token === null || corpo.token === "" ? null : tokenDoPixel(corpo.token);
  if (corpo.token && !colado) return json(400, { ok: false, erro: "Token inválido: cole o token inteiro, sem espaço." });
  const ativo = corpo.ativo !== false;

  const admin = createAdminClient();
  const { data: atual, error } = await admin
    .from("checkout_externo_destinos")
    .select("id, conta, ativo")
    .eq("checkout_id", checkout.id)
    .eq("plataforma", plataforma)
    .maybeSingle();
  if (error) {
    if (tabelaAusente(error)) return AINDA_NAO();
    return json(500, { ok: false, erro: `Falha ao ler o pixel: ${error.message}` });
  }
  const existente = atual as { id: string; conta: string; ativo: boolean } | null;

  let salvo: string | null = null;
  if (existente && !colado) {
    const { data, error: e } = await admin
      .from("checkout_externo_destino_segredos")
      .select("access_token")
      .eq("destino_id", existente.id)
      .maybeSingle();
    if (e) return json(500, { ok: false, erro: `Falha ao ler o token: ${e.message}` });
    salvo = (data as { access_token?: string | null } | null)?.access_token ?? null;
  }
  const token = colado ?? salvo;
  if (!token) {
    return json(400, {
      ok: false,
      erro: plataforma === "tiktok" ? "Cole o Access Token da Events API: sem ele nenhuma compra sai." : "Cole o token da API de Conversões: sem ele nenhuma compra sai.",
    });
  }

  if (ativo) {
    const barrado = await conferirLimite(admin, userId, checkout.id);
    if (barrado) return barrado;
  }

  // Token novo, pixel novo ou trocado: confere antes de gravar (evento custom).
  if (colado || !existente || existente.conta !== conta) {
    const c = await conferirCredencial(plataforma, conta, token, teste);
    if (!c.ok) return json(c.status, { ok: false, erro: c.erro });
  }

  const agora = new Date().toISOString();
  const gravarToken = (destinoId: string) =>
    admin
      .from("checkout_externo_destino_segredos")
      .upsert({ destino_id: destinoId, access_token: colado, updated_at: agora }, { onConflict: "destino_id" });
  let destinoId: string;
  if (existente) {
    // O token ANTES da linha: o pixel removido (desligado, sem token) nao
    // pode voltar ligado sem token se gravar o token falhar.
    if (colado) {
      const { error: e } = await gravarToken(existente.id);
      if (e) return json(500, { ok: false, erro: `Falha ao salvar o token: ${e.message}` });
    }
    const { error: e } = await admin
      .from("checkout_externo_destinos")
      .update({ conta, test_event_code: teste, ativo, updated_at: agora })
      .eq("id", existente.id)
      .eq("user_id", userId);
    if (e) return json(500, { ok: false, erro: `Falha ao salvar o pixel: ${e.message}` });
    destinoId = existente.id;
  } else {
    const { data, error: e } = await admin
      .from("checkout_externo_destinos")
      .insert({ checkout_id: checkout.id, user_id: userId, plataforma, conta, test_event_code: teste, ativo })
      .select("id")
      .single();
    if (e?.code === "23505") return json(409, { ok: false, erro: `O ${rede} deste checkout acabou de ser salvo. Recarregue a tela.` });
    if (e || !data) return json(500, { ok: false, erro: `Falha ao salvar o pixel: ${e?.message ?? "sem resposta"}` });
    destinoId = String((data as { id: string }).id);
    if (colado) {
      const { error: e2 } = await gravarToken(destinoId);
      if (e2) {
        // Pixel novo sem token nao manda nada: melhor nao deixar pela metade
        // (a linha acabou de nascer, nao tem fila).
        await admin.from("checkout_externo_destinos").delete().eq("id", destinoId).eq("user_id", userId);
        return json(500, { ok: false, erro: `Falha ao salvar o token: ${e2.message}` });
      }
    }
  }

  return responder(admin, checkout, userId);
}

interface CorpoPatch {
  compra_quando?: unknown;
  plataforma?: unknown;
  ativo?: unknown;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aberto = await abrir(id);
  if (aberto instanceof Response) return aberto;
  const { userId, checkout } = aberto;
  if (!rastreiaCompra(checkout.plataforma)) {
    return json(400, { ok: false, erro: `A ${nomeDaPlataforma(checkout.plataforma)} não manda a compra pelo Panda Track.` });
  }

  let corpo: CorpoPatch;
  try {
    corpo = (await request.json()) as CorpoPatch;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }
  if (!corpo || typeof corpo !== "object") return json(400, { ok: false, erro: "Corpo inválido." });
  const admin = createAdminClient();
  let atualizado = checkout;

  if (corpo.compra_quando !== undefined) {
    if (corpo.compra_quando !== "gerada" && corpo.compra_quando !== "aprovada") {
      return json(400, { ok: false, erro: "Opção de envio inválida." });
    }
    const { data, error } = await admin
      .from("checkouts_externos")
      .update({ compra_quando: corpo.compra_quando, updated_at: new Date().toISOString() })
      .eq("id", checkout.id)
      .eq("user_id", userId)
      .select("id");
    if (error) {
      if (colunaAusente(error)) return AINDA_NAO();
      return json(500, { ok: false, erro: `Falha ao salvar: ${error.message}` });
    }
    if (!data || data.length === 0) return NAO_ENCONTRADO();
    atualizado = { ...checkout, compra_quando: corpo.compra_quando };
  }

  if (corpo.ativo !== undefined) {
    const plataforma = plataformaDe(corpo.plataforma);
    if (!plataforma || typeof corpo.ativo !== "boolean") return json(400, { ok: false, erro: "Rede ou estado inválido." });
    if (corpo.ativo) {
      // Ligar so o pixel com token: o removido (sem token) e "não configurado".
      const configurado = await temTokenSalvo(admin, checkout.id, userId, plataforma);
      if (configurado instanceof Response) return configurado;
      if (!configurado) return json(404, { ok: false, erro: `O ${NOME_REDE[plataforma]} ainda não foi configurado.` });
      const barrado = await conferirLimite(admin, userId, checkout.id);
      if (barrado) return barrado;
    }
    const { data, error } = await admin
      .from("checkout_externo_destinos")
      .update({ ativo: corpo.ativo, updated_at: new Date().toISOString() })
      .eq("checkout_id", checkout.id)
      .eq("user_id", userId)
      .eq("plataforma", plataforma)
      .select("id");
    if (error) {
      if (tabelaAusente(error)) return AINDA_NAO();
      return json(500, { ok: false, erro: `Falha ao salvar: ${error.message}` });
    }
    if (!data || data.length === 0) return json(404, { ok: false, erro: `O ${NOME_REDE[plataforma]} ainda não foi configurado.` });
  }

  if (corpo.compra_quando === undefined && corpo.ativo === undefined) return json(400, { ok: false, erro: "Nada para mudar." });
  return responder(admin, atualizado, userId);
}

/**
 * Tirar o pixel NAO apaga a linha do destino: desliga e apaga so o token. A
 * fila cai em cascata com o destino, e a compra ja entregue dela e a trava
 * (destino_id, event_id) contra a segunda compra da mesma cobranca -- o Pix
 * gerado antes e aprovado depois de o lojista tirar e por o pixel de novo
 * sairia outra vez (o Meta e o TikTok so descartam event_id repetido em 48 h).
 * O POST reaproveita a linha pelo unique (checkout_id, plataforma). Na tela,
 * desligado e sem token = "Não configurado" (lerEstado).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aberto = await abrir(id);
  if (aberto instanceof Response) return aberto;
  const { userId, checkout } = aberto;
  const plataforma = plataformaDe(new URL(request.url).searchParams.get("plataforma"));
  if (!plataforma) return json(400, { ok: false, erro: "Rede inválida." });
  const admin = createAdminClient();
  // Desliga primeiro: dali em diante nada sai para este pixel (o drain rele o
  // destino), mesmo que apagar o token falhe.
  const { data, error } = await admin
    .from("checkout_externo_destinos")
    .update({ ativo: false, updated_at: new Date().toISOString() })
    .eq("checkout_id", checkout.id)
    .eq("user_id", userId)
    .eq("plataforma", plataforma)
    .select("id");
  if (error) {
    if (tabelaAusente(error)) return AINDA_NAO();
    return json(500, { ok: false, erro: `Falha ao remover: ${error.message}` });
  }
  const ids = ((data ?? []) as { id: string }[]).map((d) => String(d.id));
  if (ids.length > 0) {
    const { error: e } = await admin.from("checkout_externo_destino_segredos").delete().in("destino_id", ids);
    if (e) return json(500, { ok: false, erro: `O pixel foi desligado, mas o token não saiu: ${e.message}. Tente de novo.` });
  }
  return responder(admin, checkout, userId);
}
