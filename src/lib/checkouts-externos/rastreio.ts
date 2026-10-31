import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarAoDestino } from "@/lib/tracking/envio";
import { MAX_TENTATIVAS, proximaTentativaEm } from "@/lib/tracking/fila";
import { validarEscritaNoPixel } from "@/lib/tracking/meta-capi";
import { validarEscritaNoTiktok } from "@/lib/tracking/tiktok-api";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";
import { limparUtm } from "@/lib/tracking/origem-pedido";
import { JANELA_COMPRA_MS, type DestinoDoCheckout, type EnvioGravado, type EnvioNovo, type EnvioParaEntregar, type RastreioCheckout } from "./compra";
import type { RepositorioDoColetor } from "./coletor";
import { semMigration069, tabelaAusente, type PlataformaRastreio } from "./tipos";

// ============================================================================
// A compra do checkout externo pelo servidor: o banco e a rede (073).
//
//   checkout_externo_destinos           o pixel do Meta e o do TikTok do checkout
//   checkout_externo_destino_segredos   o token de cada um (ZERO policy)
//   checkout_externo_envios             a fila, unique (destino_id, event_id)
//   checkout_externo_identidades        o visitante da ponte (Fase D)
//
// Irmas das tracking_* das lojas: nada aqui le ou escreve nelas. O envio em
// si e o mesmo (src/lib/tracking/envio.ts), e o cron do drain das lojas
// tambem drena esta fila (drenarFilaDoCheckout). O ramo de checkout do
// coletor publico (coletor.ts) grava pela repositorioDoColetor.
//
// Sem a 073 aplicada: nenhum destino (o webhook segue como antes) e o drain
// nao faz nada. Erro de banco de verdade LANCA.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** Uma linha da fila como o envio precisa. */
interface LinhaDaFila {
  id: string;
  destino_id: string;
  plataforma: string;
  event_id: string;
  payload: unknown;
  attempts: number;
}

function destinoDaLinha(d: Record<string, unknown>, token: string | null): DestinoDoCheckout {
  return {
    id: String(d.id),
    plataforma: d.plataforma === "tiktok" ? "tiktok" : "meta",
    conta: String(d.conta ?? ""),
    token,
    testEventCode: (d.test_event_code as string | null) ?? null,
    ativo: Boolean(d.ativo),
  };
}

const COLUNAS_DESTINO = "id, checkout_id, plataforma, conta, test_event_code, ativo";

/** O cron deixa a linha nova para o after() do webhook por este tempo. */
const RESERVA_DO_AFTER_MS = 2 * 60 * 1000;

/** Os tokens dos destinos (service role: a tabela nao tem policy). Erro LANCA. */
async function tokensDe(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("checkout_externo_destino_segredos")
    .select("destino_id, access_token")
    .in("destino_id", ids);
  if (error) throw new Error(`falha ao ler os tokens do rastreamento: ${error.message}`);
  return new Map(((data ?? []) as { destino_id: string; access_token: string | null }[]).map((s) => [s.destino_id, s.access_token ?? ""]));
}

/** A identidade do visitante (Fase D), sem o que venceu. Falha = null. */
async function identidadeDe(admin: Admin, checkoutId: string, visitorId: string): Promise<IdentidadeGuardada | null> {
  const { data, error } = await admin
    .from("checkout_externo_identidades")
    .select("visitor_id, fbp, fbc, fbclid, ttclid, ttp, gclid, client_ip_address, client_user_agent, utm, utm_em, expires_at")
    .eq("checkout_id", checkoutId)
    .eq("visitor_id", visitorId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  const { utm, ...resto } = data as Record<string, unknown>;
  const l = resto as Record<string, string | null>;
  return {
    visitorId: l.visitor_id,
    fbp: l.fbp,
    fbc: l.fbc,
    fbclid: l.fbclid,
    ttclid: l.ttclid,
    ttp: l.ttp,
    gclid: l.gclid,
    clientIp: l.client_ip_address,
    userAgent: l.client_user_agent,
    // A hora do clique: o fbc montado do fbclid leva ela (compra.ts).
    utmEm: l.utm_em,
    // A campanha do clique: o pedido sem UTM no webhook (Hotmart) a herda (receber.ts).
    utm: utm ? limparUtm(utm as Record<string, unknown>) : null,
  };
}

/** O RastreioCheckout de verdade (receber.ts usa o contrato). */
export function rastreioSupabase(admin: Admin): RastreioCheckout {
  return {
    async destinos(checkoutId) {
      const { data, error } = await admin
        .from("checkout_externo_destinos")
        .select(COLUNAS_DESTINO)
        .eq("checkout_id", checkoutId)
        .eq("ativo", true);
      if (error) {
        // Sem a 073: o checkout nao rastreia (o webhook segue como sempre).
        if (tabelaAusente(error)) return [];
        throw new Error(`falha ao ler os destinos do checkout: ${error.message}`);
      }
      const linhas = (data ?? []) as Record<string, unknown>[];
      const tokens = await tokensDe(admin, linhas.map((l) => String(l.id)));
      return linhas.map((l) => destinoDaLinha(l, tokens.get(String(l.id)) || null));
    },
    identidade: (checkoutId, visitorId) => identidadeDe(admin, checkoutId, visitorId),
    async enfileirar(linhas: EnvioNovo[]): Promise<EnvioGravado[]> {
      const gravadas: EnvioGravado[] = [];
      // O after() do webhook manda na hora; o cron so pega depois de
      // RESERVA_DO_AFTER_MS (se o after() nao rodou), em vez de disputar a
      // mesma linha com ele.
      const proxima = new Date(Date.now() + RESERVA_DO_AFTER_MS).toISOString();
      // Uma por vez: a duplicada (23505) e o caminho normal e nao pode
      // derrubar as outras do lote.
      for (const l of linhas) {
        const { data, error } = await admin
          .from("checkout_externo_envios")
          .insert({ ...l, next_attempt_at: proxima })
          .select("id")
          .single();
        if (error?.code === "23505") continue;
        if (error) throw new Error(`falha ao enfileirar a compra: ${error.message}`);
        gravadas.push({ ...l, id: String((data as { id: string }).id), attempts: 0 });
      }
      return gravadas;
    },
  };
}

/** Um destino pelo id, com o token. null = removido. Erro LANCA. */
async function destinoPorId(admin: Admin, id: string): Promise<DestinoDoCheckout | null> {
  const { data, error } = await admin.from("checkout_externo_destinos").select(COLUNAS_DESTINO).eq("id", id).maybeSingle();
  if (error) throw new Error(`falha ao ler o destino: ${error.message}`);
  if (!data) return null;
  const tokens = await tokensDe(admin, [id]);
  return destinoDaLinha(data as Record<string, unknown>, tokens.get(id) || null);
}

/**
 * Entrega uma linha e grava o desfecho, SO sobre linha ainda 'pendente' (a
 * do after() e a do cron podem se cruzar). `destino` = o que o webhook ja
 * leu; o cron rele (a configuracao pode ter mudado).
 */
export async function entregarEnvio(
  admin: Admin,
  linha: LinhaDaFila,
  destinoCarregado?: DestinoDoCheckout | null
): Promise<{ ok: boolean; motivo?: string }> {
  const tentativas = linha.attempts + 1;
  const gravar = async (campos: Record<string, unknown>) => {
    await admin.from("checkout_externo_envios").update(campos).eq("id", linha.id).eq("status", "pendente");
  };
  const desistir = async (motivo: string) => {
    await gravar({ status: "falhou", attempts: tentativas, last_error: motivo.slice(0, 500) });
    return { ok: false, motivo };
  };

  const destino = destinoCarregado ?? (await destinoPorId(admin, linha.destino_id));
  if (!destino) return desistir("destino removido");
  if (!destino.ativo) return desistir("destino desligado");
  if (!destino.conta || !destino.token) {
    return desistir(destino.plataforma === "tiktok" ? "destino do TikTok sem token da Events API" : "destino do Meta sem token do CAPI");
  }
  if (destino.plataforma !== linha.plataforma) {
    return desistir(`linha de ${linha.plataforma} apontando para destino de ${destino.plataforma}`);
  }
  // O Meta e o TikTok recusam compra com mais de 7 dias: fecha com o motivo.
  const quandoS = Number((linha.payload as { event_time?: unknown } | null)?.event_time);
  if (!Number.isFinite(quandoS) || Date.now() - quandoS * 1000 > JANELA_COMPRA_MS) {
    return desistir("passou dos 7 dias que o Meta e o TikTok aceitam");
  }

  const r = await enviarAoDestino(
    { plataforma: destino.plataforma, conta: destino.conta, token: destino.token, testEventCode: destino.testEventCode },
    linha.payload
  );
  if (r.ok) {
    await gravar({
      status: "enviado",
      attempts: tentativas,
      sent_at: new Date().toISOString(),
      last_error: r.aviso,
      response: r.corpo,
    });
    return { ok: true };
  }
  const erro = r.erro ?? "falha desconhecida";
  const acabou = !r.podeTentarDeNovo || tentativas >= MAX_TENTATIVAS;
  await gravar({
    status: acabou ? "falhou" : "pendente",
    attempts: tentativas,
    next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
    last_error: erro.slice(0, 500),
    response: r.corpo,
  });
  return { ok: false, motivo: erro };
}

/** O after() do webhook: o que entrou na fila sai agora; falha fica para o cron. */
export async function entregarEnvios(admin: Admin, lista: readonly EnvioParaEntregar[]): Promise<void> {
  for (const { envio, destino } of lista) {
    try {
      await entregarEnvio(admin, envio, destino);
    } catch (e) {
      console.error("[checkout/rastreio] falha ao entregar", envio.id, e instanceof Error ? e.message : e);
    }
  }
}

const COMPRA = "Purchase";

/**
 * Uma passada da fila do checkout. Chamado pelo cron do drain das lojas.
 *
 * A COMPRA PRIMEIRO: a fila tambem tem o PageView e o InitiateCheckout da
 * pagina de vendas (Fase D), muito mais numerosos. Com o Meta fora do ar, o
 * limite da passada iria todo para eles e a compra esperaria atras.
 *
 * `ateMs`: depois dele nao entrega linha nova (a sobra fica pendente para a
 * proxima passada) -- o cron tem 120 s e divide com a fila das lojas.
 */
export async function drenarFilaDoCheckout(
  limite = 50,
  ateMs = Number.POSITIVE_INFINITY
): Promise<{ pegos: number; enviados: number; falharam: number }> {
  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const pendentes = () =>
    admin
      .from("checkout_externo_envios")
      .select("id, destino_id, plataforma, event_id, payload, attempts")
      .eq("status", "pendente")
      .lte("next_attempt_at", agora);
  const compras = await pendentes().eq("event_name", COMPRA).order("next_attempt_at", { ascending: true }).limit(limite);
  if (compras.error) {
    if (tabelaAusente(compras.error)) return { pegos: 0, enviados: 0, falharam: 0 };
    throw new Error(`falha ao ler a fila do checkout: ${compras.error.message}`);
  }
  const linhas = (compras.data ?? []) as LinhaDaFila[];
  if (linhas.length < limite) {
    const resto = await pendentes()
      .neq("event_name", COMPRA)
      .order("next_attempt_at", { ascending: true })
      .limit(limite - linhas.length);
    if (resto.error) throw new Error(`falha ao ler a fila do checkout: ${resto.error.message}`);
    linhas.push(...((resto.data ?? []) as LinhaDaFila[]));
  }
  let enviados = 0;
  let falharam = 0;
  let pegos = 0;
  for (const linha of linhas) {
    if (Date.now() > ateMs) break;
    pegos += 1;
    try {
      const r = await entregarEnvio(admin, linha);
      if (r.ok) enviados += 1;
      else falharam += 1;
    } catch (e) {
      console.error("[checkout/rastreio] falha ao entregar linha", linha.id, e instanceof Error ? e.message : e);
      falharam += 1;
    }
  }
  return { pegos, enviados, falharam };
}

// ---------------------------------------------------------------------------
// O ramo de checkout do coletor publico (Fase D): o banco do coletor.ts
// ---------------------------------------------------------------------------

const INICIO = "InitiateCheckout";

/** O RepositorioDoColetor de verdade (service role). */
export function repositorioDoColetor(admin: Admin): RepositorioDoColetor {
  const rastreio = rastreioSupabase(admin);
  const identidades = () => admin.from("checkout_externo_identidades");
  return {
    async checkout(id) {
      const { data, error } = await admin
        .from("checkouts_externos")
        .select("id, user_id, plataforma, ativo")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        if (semMigration069(error)) return null;
        throw new Error(`falha ao ler o checkout: ${error.message}`);
      }
      if (!data) return null;
      const l = data as Record<string, unknown>;
      return { id: String(l.id), user_id: String(l.user_id), plataforma: String(l.plataforma), ativo: Boolean(l.ativo) };
    },
    destinos: (checkoutId) => rastreio.destinos(checkoutId),
    async atualizarIdentidade(checkoutId, visitorId, campos) {
      const { data, error } = await identidades()
        .update(campos)
        .eq("checkout_id", checkoutId)
        .eq("visitor_id", visitorId)
        .select("visitor_id");
      if (error) throw new Error(`falha ao atualizar a identidade: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async identidadesNovas(checkoutId, desde, ipHash) {
      const contar = () =>
        identidades().select("visitor_id", { count: "exact", head: true }).eq("checkout_id", checkoutId).gte("created_at", desde);
      const [doCheckout, doIp] = await Promise.all([contar(), ipHash ? contar().eq("ip_hash", ipHash) : null]);
      return {
        doCheckout: doCheckout.error ? null : (doCheckout.count ?? 0),
        doIp: !doIp || doIp.error ? null : (doIp.count ?? 0),
      };
    },
    async inserirIdentidade(linha) {
      const { error } = await identidades().upsert(linha, { onConflict: "checkout_id,visitor_id" });
      if (error) throw new Error(`falha ao gravar a identidade: ${error.message}`);
    },
    async contarEnvios(f) {
      let q = admin
        .from("checkout_externo_envios")
        .select("id", { count: "exact", head: true })
        .eq("checkout_id", f.checkoutId)
        .gte("created_at", f.desde);
      if (f.visitorId) q = q.eq("visitor_id", f.visitorId);
      else if (f.ipHash) q = q.eq("ip_hash", f.ipHash);
      // O balde do checkout conta so o que veio da ponte: a compra nao gasta.
      else q = q.not("visitor_id", "is", null);
      const { count, error } = await q;
      return error ? null : (count ?? 0);
    },
    async inicioDesde(checkoutId, visitorId, desde) {
      const { data, error } = await admin
        .from("checkout_externo_envios")
        .select("id")
        .eq("checkout_id", checkoutId)
        .eq("visitor_id", visitorId)
        .eq("event_name", INICIO)
        .gte("created_at", desde)
        .limit(1);
      // Melhor esforco: sem a conferencia sai um InitiateCheckout a mais, nao some nenhum.
      if (error) console.error("[tracking/collect] falha ao conferir o InitiateCheckout do checkout", error.message);
      return !error && (data ?? []).length > 0;
    },
    enfileirar: (linhas) => rastreio.enfileirar(linhas),
    async entregar(lista) {
      return Promise.all(
        lista.map(async ({ envio, destino }) => {
          try {
            const r = await entregarEnvio(admin, envio, destino);
            return { id: envio.id, ok: r.ok };
          } catch (e) {
            console.error("[tracking/collect] falha ao entregar o evento do checkout", envio.id, e instanceof Error ? e.message : e);
            return { id: envio.id, ok: false };
          }
        })
      );
    },
  };
}

// ---------------------------------------------------------------------------
// A credencial, antes de gravar (a tela do checkout)
// ---------------------------------------------------------------------------

/**
 * O token escreve neste pixel? Um evento CUSTOM (XcartCredentialCheck), nunca
 * uma compra: nao conta como conversao. O mesmo teste da tela de
 * Rastreamento das lojas.
 */
export async function conferirCredencial(
  plataforma: PlataformaRastreio,
  conta: string,
  token: string,
  testEventCode: string | null
): Promise<{ ok: true } | { ok: false; status: 400 | 503; erro: string }> {
  const rede = plataforma === "tiktok" ? "TikTok" : "Meta";
  const r =
    plataforma === "tiktok"
      ? await validarEscritaNoTiktok(conta, token, testEventCode)
      : await validarEscritaNoPixel(conta, token);
  if (r.ok) return { ok: true };
  if (r.podeTentarDeNovo) {
    return {
      ok: false,
      status: 503,
      erro: `O ${rede} não respondeu ao conferir o token (${r.erro ?? "sem resposta"}). Nada foi gravado: tente de novo em instantes.`,
    };
  }
  const semAcesso =
    plataforma === "tiktok"
      ? (r as { codigo?: number }).codigo === 40001
      : /does not exist|unsupported (get|post) request/i.test(r.erro ?? "");
  if (semAcesso) {
    return {
      ok: false,
      status: 400,
      erro:
        plataforma === "tiktok"
          ? "O token não tem acesso a este pixel. Confira o Pixel ID e gere o token no próprio pixel, no Gerenciador de eventos do TikTok."
          : "ID do pixel não encontrado, ou o token não tem acesso a ele. Confira o ID e gere o token nesse pixel, no Gerenciador de Eventos.",
    };
  }
  return { ok: false, status: 400, erro: `O ${rede} recusou o token: ${r.erro ?? `HTTP ${r.status}`}` };
}
