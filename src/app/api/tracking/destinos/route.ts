import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conferirLigarRastreamento } from "@/lib/billing/limites";
import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";
import {
  chaveDoEvento,
  lerRotulos,
  vaiPeloServidor,
  type PlataformaDestino,
} from "@/lib/tracking/eventos";
import { TEMPLATE_PADRAO, validarTemplate } from "@/lib/tracking/id-produto";
import { validarEscritaNoPixel } from "@/lib/tracking/meta-capi";
import {
  CODIGOS_DE_CREDENCIAL_TIKTOK,
  validarEscritaNoTiktok,
} from "@/lib/tracking/tiktok-api";

export const runtime = "nodejs";

// ============================================================================
// Os destinos de conversao de uma loja: criar, editar, remover.
//
// POR QUE VARIOS POR LOJA
//
// Pedido do Arthur, e caso real: cinco contas de Google anunciando produtos
// diferentes do mesmo catalogo. Antes da 043 isto era UMA coluna por
// plataforma, e a segunda conta nao tinha onde morar.
//
// Mandar todo evento para TODAS as contas e correto, nao desperdicio: conversao
// cujo gclid nao pertence a conta e DESCARTADA pelo Google -- a conta dona do
// clique conta, as outras ignoram. Entao nao existe roteamento a fazer por
// produto, e tentar adivinhar qual conta e a dona custaria a conversao quando
// adivinhasse errado.
//
// O GOOGLE E CONFIGURACAO, NAO FILA
//
// A conta AW- e os rotulos por evento sao lidos pela tag do Google no
// navegador (/api/tracking/google-config); nada sai do servidor para o Google.
// Aqui so se grava e valida.
//
// META E TIKTOK: PIXEL + TOKEN, CONFERIDO ANTES DE GRAVAR
//
// Os dois saem pelo servidor. O token mora em tracking_destination_secrets
// (RLS sem policy: so o service_role le) e nunca volta para a tela. Token que a
// plataforma recusa nao cria nem muda destino nenhum.
//
// TUDO PASSA PELO SERVICE ROLE
//
// A linha carrega `user_id`, e deixar o cliente escolher esse campo abriria a
// porta para apontar o destino para a loja de outro. O dono e lido do banco a
// partir da sessao, nunca do corpo da requisicao. E o dono que vale e o da
// LOJA, conferido em toda escrita -- o `user_id` da linha sozinho nao prova
// nada sobre o `store_id` ao lado dele.
// ============================================================================

/**
 * Teto de destinos por loja.
 *
 * Cada evento gera uma linha de fila POR destino: 20 destinos transformam um
 * `view_item` em 20 escritas e 20 chamadas de rede. O teto nao e burocracia, e
 * o que impede o rastreamento de uma loja virar carga de banco para todas.
 */
const MAX_DESTINOS_POR_LOJA = 20;

interface CorpoDestino {
  storeId?: string;
  id?: string;
  plataforma?: string;
  nome?: string | null;
  conta?: string | null;
  /** So Google: {"purchase":"AbC...","add_to_cart":"XyZ..."}. */
  labels?: Record<string, string> | null;
  testEventCode?: string | null;
  /**
   * Formato do id de produto: {variant_id}, {product_id}, {sku}.
   *
   * Vazio = `{variant_id}`, o comportamento de antes de isto existir.
   */
  idTemplate?: string | null;
  ativo?: boolean;
  /**
   * Token do CAPI do Meta ou da Events API do TikTok. Vazio/ausente na EDICAO =
   * nao mexer no gravado.
   *
   * Nunca volta na leitura: a tela so recebe um booleano dizendo se existe.
   * Vazio nao apaga de proposito -- a tela manda o campo vazio em todo
   * salvamento normal, e apagar ali derrubaria o rastreamento a cada vez que o
   * lojista renomeasse o destino.
   */
  accessToken?: string | null;
}

async function lerCorpo(request: NextRequest): Promise<CorpoDestino | null> {
  try {
    return (await request.json()) as CorpoDestino;
  } catch {
    return null;
  }
}

type Autorizacao =
  | { erro: NextResponse }
  | {
      erro: null;
      admin: ReturnType<typeof createAdminClient>;
      loja: { id: string; user_id: string };
    };

/** A sessao e a loja que ela pode mexer. */
async function autorizar(storeId: string): Promise<Autorizacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", storeId)
    .maybeSingle();

  if (!loja || loja.user_id !== user.id) {
    return { erro: NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 }) };
  }
  return { erro: null, admin, loja };
}

/**
 * A loja do destino e de quem esta logado?
 *
 * O `user_id` da linha sozinho nao basta. Ele foi gravado uma vez e nada o
 * amarra a loja depois: uma linha com o user_id de um e o store_id de outro
 * (escrita direta pela API do Supabase, antes de a migration fechar isso) daria
 * ao primeiro o poder de mexer no rastreamento -- e no token -- da loja do
 * segundo. Quem manda no destino e quem manda na LOJA.
 */
async function lojaEDoUsuario(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string,
  userId: string
): Promise<boolean> {
  const { data: loja } = await admin
    .from("stores")
    .select("user_id")
    .eq("id", storeId)
    .maybeSingle();
  return Boolean(loja) && loja?.user_id === userId;
}

/**
 * Confere o token do Meta ANTES de gravar.
 *
 * Token que o Meta recusa nao envia nada, e o lojista so descobriria na fila,
 * venda por venda. Pior: na troca de token depois de um 190, gravar um token
 * ruim e reenfileirar as compras que falharam faria todas falharem de novo --
 * e cada tentativa queimada aproxima o evento do limite de 7 dias do Meta.
 *
 * O teste e um evento custom (`XcartCredentialCheck`), nao um Purchase: nao
 * conta como conversao nem entra no aprendizado da campanha.
 *
 * Devolve a resposta de erro pronta, ou null quando o token vale.
 */
async function conferirTokenNoMeta(
  pixelId: string,
  token: string
): Promise<NextResponse | null> {
  const r = await validarEscritaNoPixel(pixelId, token);
  if (r.ok) return null;

  if (r.podeTentarDeNovo) {
    // Rede, timeout, 429, 5xx: o Meta nao disse que o token e ruim, so nao
    // respondeu. Gravar sem conferir abriria mao da garantia acima; recusar
    // com "token invalido" seria mentira. Pede para tentar de novo.
    return NextResponse.json(
      {
        error:
          `O Meta não respondeu ao conferir o token (${r.erro ?? "sem resposta"}). ` +
          "Nada foi gravado — tente de novo em instantes.",
      },
      { status: 503 }
    );
  }

  // ID errado: o Graph responde 100 "Object with ID ... does not exist" /
  // "Unsupported post request". Dizer "token recusado" mandava o lojista
  // trocar o token certo. O 190 (token invalido) fica com a mensagem do token.
  if (pixelNaoEncontrado(r.erro)) {
    return NextResponse.json(
      { error: "ID do pixel não encontrado, ou o token não tem acesso a ele. Confira o ID e gere o token nesse pixel, no Gerenciador de Eventos." },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: `O Meta recusou o token: ${r.erro ?? `HTTP ${r.status}`}` },
    { status: 400 }
  );
}

/** O erro do Meta diz que o objeto (o pixel) nao existe para este token? */
function pixelNaoEncontrado(erro: string | undefined): boolean {
  return /does not exist|unsupported (get|post) request/i.test(erro ?? "");
}

/**
 * Confere o token do TikTok ANTES de gravar. Mesmo contrato do Meta: null =
 * vale; senao a resposta de erro pronta.
 *
 * O TikTok nao tem endpoint de checagem: vai um evento CUSTOM
 * (`XcartCredentialCheck`), nunca uma compra, e com o codigo de teste do
 * lojista quando ele preencheu -- ai cai so na aba Test Events. Ver
 * `validarEscritaNoTiktok`.
 */
async function conferirTokenNoTiktok(
  pixelCode: string,
  token: string,
  testEventCode: string | null
): Promise<NextResponse | null> {
  const r = await validarEscritaNoTiktok(pixelCode, token, testEventCode);
  if (r.ok) return null;

  if (r.podeTentarDeNovo) {
    // Rede, timeout, limite de taxa, 5xxxx: o TikTok nao disse que o token e
    // ruim, so nao respondeu.
    return NextResponse.json(
      {
        error:
          `O TikTok não respondeu ao conferir o token (${r.erro ?? "sem resposta"}). ` +
          "Nada foi gravado — tente de novo em instantes.",
      },
      { status: 503 }
    );
  }

  // 40001: o token e de OUTRA conta de anuncio (ou de quem nao e Admin/
  // Operator), ou o Pixel Code nao e desta conta. Dizer "token invalido"
  // mandaria trocar o token certo.
  if (r.codigo === 40001) {
    return NextResponse.json(
      {
        error:
          "O token não tem acesso a este pixel. Confira o Pixel ID e gere o token no próprio pixel, no Gerenciador de eventos do TikTok (pixel › Configurações).",
      },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: `O TikTok recusou o token: ${r.erro ?? `HTTP ${r.status}`}` },
    { status: 400 }
  );
}

/** Confere o token da plataforma antes de gravar. null = vale. */
function conferirToken(
  plataforma: PlataformaDestino,
  conta: string,
  token: string,
  testEventCode: string | null
): Promise<NextResponse | null> {
  return plataforma === "tiktok"
    ? conferirTokenNoTiktok(conta, token, testEventCode)
    : conferirTokenNoMeta(conta, token);
}

/**
 * Janela de reenvio, em dias.
 *
 * O Meta aceita `event_time` de ate 7 dias atras e recusa o resto. Seis deixa
 * um dia de folga para a fila drenar (50 linhas a cada 10 min) antes de o
 * evento passar do limite.
 */
const JANELA_REENVIO_DIAS = 6;

/**
 * Erros que significam "a credencial e o problema", nao o evento.
 *
 * TIKTOK: o corpo que a fila grava e {code, message, request_id}, entao o
 * codigo fica em `response.code` (ver CODIGOS_DE_CREDENCIAL_TIKTOK).
 *
 * META:
 *
 *   190      token invalido, expirado ou revogado
 *   200, 10  permissao negada
 *   100/33   "Object with ID ... does not exist, cannot be loaded due to
 *            missing permissions" -- e assim que o Graph responde no POST de
 *            eventos quando o system user nao tem o pixel atribuido. A primeira
 *            versao so olhava 190/200 e deixava este, o caso mais comum de
 *            permissao, de fora.
 *
 * Sao os que um token novo conserta. O 100 GENERICO (parametro ruim) continua
 * fora: falharia de novo com qualquer token. So o par 100/33 entra, e so e
 * seguro porque a escrita no mesmo pixel acabou de ser validada com o token
 * novo.
 *
 * A sintaxe do Meta foi conferida contra o PostgREST do projeto; a do TikTok e
 * a mesma forma (`->>` e `in`), um nivel acima no JSON.
 */
const FILTRO_CREDENCIAL: Record<"meta" | "tiktok", string> = {
  meta:
    "response->error->>code.in.(190,200,10)," +
    "and(response->error->>code.eq.100,response->error->>error_subcode.eq.33)",
  tiktok: `response->>code.in.(${CODIGOS_DE_CREDENCIAL_TIKTOK.join(",")})`,
};

/**
 * Devolve para a fila as compras que falharam por causa do token antigo.
 *
 * `meta-capi` classifica 190/200 como permanente -- corretamente, porque
 * insistir com o MESMO token nao adianta. Mas isso deixava a linha em 'falhou'
 * para sempre, mesmo depois de o lojista trocar o token: uma queda de fim de
 * semana virava dois dias de compras que o Meta nunca viu, e a campanha
 * otimizando sem elas. Com o token novo conferido, elas voltam.
 *
 * O `event_id` nao muda, entao se alguma ja tiver chegado por outro caminho o
 * Meta deduplica -- nao ha risco de contar duas vezes.
 *
 * O codigo fica em `response.error.code` porque `gravarFalha` grava ali o corpo
 * JSON do Meta como veio. O `->>` devolve texto, e o PostgREST compara como
 * texto tambem, entao "190" e "33" casam.
 */
async function reenfileirarFalhasDeCredencial(
  admin: ReturnType<typeof createAdminClient>,
  destinoId: string,
  plataforma: "meta" | "tiktok"
): Promise<{ total: number; compras: number }> {
  const desde = new Date(
    Date.now() - JANELA_REENVIO_DIAS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await admin
    .from("tracking_events")
    .update({
      status: "pendente",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("destination_id", destinoId)
    .eq("status", "falhou")
    .gte("created_at", desde)
    .or(FILTRO_CREDENCIAL[plataforma])
    .select("event_name");

  // O token ja foi gravado; falhar aqui nao desfaz isso. As compras ficam em
  // 'falhou' e salvar de novo com o mesmo token tenta outra vez.
  if (error) {
    console.error("[tracking/destinos] falha ao reenfileirar:", error.message);
    return { total: 0, compras: 0 };
  }
  // Volta tudo que caiu pela credencial, funil incluido: carrinho e checkout
  // tambem alimentam a otimizacao. Mas o que o lojista quer saber e quantas
  // VENDAS voltaram, entao a compra e contada a parte para a tela.
  const linhas = data ?? [];
  return {
    total: linhas.length,
    compras: linhas.filter((l) => chaveDoEvento(l.event_name) === "purchase").length,
  };
}

/**
 * Normaliza e valida os campos da plataforma.
 *
 * `exigirToken` so no cadastro: na edicao, campo vazio significa "mantem o que
 * esta gravado".
 */
function validar(
  plataforma: PlataformaDestino,
  corpo: CorpoDestino,
  opcoes: { exigirToken: boolean; jaTemToken?: boolean }
):
  | { erro: string }
  | {
      conta: string;
      labels: Record<string, string>;
      testEventCode: string | null;
      idTemplate: string | null;
      token: string | null;
    } {
  const token = (corpo.accessToken || "").trim() || null;

  // O template vai cru para dentro de `content_ids` do Meta e de `ecomm_prodid`
  // do Google. Template invalido nao da erro em lugar nenhum: o evento e
  // aceito e o anuncio dinamico so nao serve aquele item. Entao a recusa e
  // aqui, enquanto o lojista ainda esta olhando.
  const template = (corpo.idTemplate || "").trim();
  if (template && template !== TEMPLATE_PADRAO) {
    const erro = validarTemplate(template);
    if (erro) return { erro };
  }
  const idTemplate = template && template !== TEMPLATE_PADRAO ? template : null;

  if (plataforma === "google") {
    // Descarta evento desconhecido e rotulo vazio: o mapa nunca chega ao banco
    // como {"purchase": ""}. Rotulo colado como "AW-123/AbC" vira "AbC", e o
    // AW da frente preenche a conta vazia; de outra conta, e erro.
    const lidos = lerRotulos(corpo.labels, (corpo.conta || "").trim());
    if ("erro" in lidos) return { erro: lidos.erro };
    const numero = apenasNumeroDaConversao(lidos.conta);
    if (!numero) {
      return { erro: "ID de conversão inválido. Esperado algo como AW-123456789." };
    }
    const labels = lidos.labels;
    if (Object.keys(labels).length === 0) {
      return {
        erro:
          "Preencha o rótulo de ao menos um evento — no Google cada evento é uma " +
          "ação de conversão própria, e sem rótulo não há o que enviar.",
      };
    }

    // Guardado como AW-<digitos>: o lojista cola o que o painel mostra, com
    // espaco ou sem prefixo, e a URL do endpoint recusa qualquer outra forma.
    return { conta: `AW-${numero}`, labels, testEventCode: null, idTemplate, token: null };
  }

  let pixel: string;
  if (plataforma === "tiktok") {
    // O Pixel Code do TikTok e alfanumerico (ex.: CUSG5HBC77UD11VVRQEG).
    // Arrancar as letras, como no Meta, gravaria outro pixel. So o espaco do
    // copiar-colar sai; o resto tem que ser letra e digito.
    pixel = (corpo.conta || "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9]{10,30}$/.test(pixel)) {
      return { erro: "Pixel ID do TikTok inválido. Esperado algo como CUSG5HBC77UD11VVRQEG." };
    }
  } else {
    // So digitos: o Events Manager as vezes mostra o id com espaco, e o Meta
    // recusa a URL do endpoint se vier qualquer outra coisa.
    pixel = (corpo.conta || "").replace(/\D/g, "");
    if (!pixel) {
      return { erro: "ID do pixel inválido. Esperado só dígitos." };
    }
  }

  if (opcoes.exigirToken && !token && !opcoes.jaTemToken) {
    // Pixel sem token nao envia NADA: a linha existiria na tela como
    // "configurado" e a plataforma nunca receberia um evento.
    return {
      erro:
        plataforma === "tiktok"
          ? "O TikTok precisa do Access Token da Events API — sem ele nenhum evento sai."
          : "O Meta precisa do token do CAPI — sem ele nenhum evento sai.",
    };
  }

  return {
    conta: pixel,
    labels: {},
    testEventCode: (corpo.testEventCode || "").trim() || null,
    idTemplate,
    token,
  };
}

/** Mensagem legivel para o unique (store_id, plataforma, conta). */
function erroDeBanco(mensagem: string): NextResponse {
  if (mensagem.includes("tracking_destinations_loja_conta_key")) {
    return NextResponse.json(
      {
        error:
          "Esta conta já está cadastrada nesta loja. A mesma conta duas vezes " +
          "duplicaria toda conversão.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: mensagem }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const corpo = await lerCorpo(request);
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  if (!corpo.storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }
  if (
    corpo.plataforma !== "google" &&
    corpo.plataforma !== "meta" &&
    corpo.plataforma !== "tiktok"
  ) {
    return NextResponse.json({ error: "Plataforma invalida." }, { status: 400 });
  }

  const auth = await autorizar(corpo.storeId);
  if (auth.erro !== null) return auth.erro;
  const { admin, loja } = auth;

  const { count } = await admin
    .from("tracking_destinations")
    .select("id", { count: "exact", head: true })
    .eq("store_id", loja.id);

  if ((count ?? 0) >= MAX_DESTINOS_POR_LOJA) {
    return NextResponse.json(
      {
        error: `Limite de ${MAX_DESTINOS_POR_LOJA} destinos por loja. Remova ou desative um antes.`,
      },
      { status: 400 }
    );
  }

  const v = validar(corpo.plataforma, corpo, { exigirToken: true });
  if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });

  // Antes do insert: token recusado nao cria destino nenhum.
  if (vaiPeloServidor(corpo.plataforma) && v.token) {
    const recusa = await conferirToken(corpo.plataforma, v.conta, v.token, v.testEventCode);
    if (recusa) return recusa;
  }

  const { data: criado, error } = await admin
    .from("tracking_destinations")
    .insert({
      store_id: loja.id,
      user_id: loja.user_id,
      plataforma: corpo.plataforma,
      nome: (corpo.nome || "").trim() || null,
      conta: v.conta,
      labels: v.labels,
      test_event_code: v.testEventCode,
      id_template: v.idTemplate,
      ativo: corpo.ativo ?? true,
    })
    .select("id")
    .single();

  if (error) return erroDeBanco(error.message);

  if (v.token && criado) {
    const { error: erroSegredo } = await admin
      .from("tracking_destination_secrets")
      .upsert({ destination_id: criado.id, access_token: v.token }, {
        onConflict: "destination_id",
      });
    if (erroSegredo) {
      // O destino sem token nao envia nada e ficaria como armadilha silenciosa
      // na tela. Desfaz, para o lojista tentar de novo em vez de descobrir na
      // primeira venda.
      await admin.from("tracking_destinations").delete().eq("id", criado.id);
      return NextResponse.json({ error: erroSegredo.message }, { status: 500 });
    }
  }

  // A linha de config precisa existir para o interruptor da loja ter onde
  // morar (e para o coletor carimbar o pixel do checkout). Primeiro pixel que
  // recebe a compra ja nasce LIGADO: cadastrar e esquecer o interruptor era o
  // jeito mais comum de nao rastrear nada. Linha que ja existe nao e tocada
  // (ignoreDuplicates = ON CONFLICT DO NOTHING): loja que o lojista desligou
  // continua desligada.
  const recebeCompra =
    (corpo.ativo ?? true) &&
    (vaiPeloServidor(corpo.plataforma) ? Boolean(v.token) : Boolean(v.labels.purchase));

  // Nascer ligado tambem e LIGAR: passa pelo limite de lojas do plano. Acima
  // dele, o pixel fica salvo e a loja nasce desligada, com o aviso de por que.
  let ligar = recebeCompra;
  let aviso: string | null = null;
  if (recebeCompra) {
    const { data: jaTem } = await admin
      .from("tracking_configs")
      .select("store_id")
      .eq("store_id", loja.id)
      .maybeSingle();
    if (!jaTem) {
      const limite = await conferirLigarRastreamento(admin, loja.user_id, loja.id);
      if (!limite.ok) {
        ligar = false;
        aviso = `Pixel salvo, mas o rastreamento desta loja ficou desligado. ${limite.mensagem}`;
      }
    }
  }

  await admin
    .from("tracking_configs")
    .upsert(
      { store_id: loja.id, user_id: loja.user_id, ...(ligar ? { enabled: true } : {}) },
      { onConflict: "store_id", ignoreDuplicates: true }
    );

  return NextResponse.json({ ok: true, id: criado?.id ?? null, ...(aviso ? { aviso } : {}) });
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const corpo = await lerCorpo(request);
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  if (!corpo.id) return NextResponse.json({ error: "id ausente." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("tracking_destinations")
    .select(
      "id, store_id, user_id, plataforma, conta, labels, test_event_code, id_template, ativo"
    )
    .eq("id", corpo.id)
    .maybeSingle();

  // A linha E a loja precisam ser do usuario. So o user_id da linha deixava
  // passar linha com dono de um e loja de outro; ver `lojaEDoUsuario`. Mesmo
  // 404 nos dois casos: dizer "existe, mas nao e sua" confirmaria o id.
  if (
    !atual ||
    atual.user_id !== user.id ||
    !(await lojaEDoUsuario(admin, atual.store_id, user.id))
  ) {
    return NextResponse.json({ error: "Destino nao encontrado." }, { status: 404 });
  }

  const plataforma = atual.plataforma as PlataformaDestino;

  // So desligar/ligar: nao exige reenviar conta nem rotulo, senao o toggle da
  // tela precisaria carregar o formulario inteiro.
  const soMudarAtivo =
    typeof corpo.ativo === "boolean" &&
    corpo.conta === undefined &&
    corpo.labels === undefined &&
    corpo.nome === undefined &&
    !(corpo.accessToken || "").trim();

  if (soMudarAtivo) {
    const { error } = await admin
      .from("tracking_destinations")
      .update({ ativo: corpo.ativo, updated_at: new Date().toISOString() })
      .eq("id", atual.id);
    if (error) return erroDeBanco(error.message);
    return NextResponse.json({ ok: true });
  }

  const { data: segredo } = await admin
    .from("tracking_destination_secrets")
    .select("access_token")
    .eq("destination_id", atual.id)
    .maybeSingle();

  const v = validar(
    plataforma,
    {
      ...corpo,
      conta: corpo.conta ?? atual.conta,
      labels: corpo.labels ?? (atual.labels as Record<string, string> | null),
      testEventCode: corpo.testEventCode ?? atual.test_event_code,
      idTemplate: corpo.idTemplate ?? atual.id_template,
    },
    { exigirToken: true, jaTemToken: Boolean(segredo?.access_token) }
  );
  if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });

  // Antes de qualquer escrita: token recusado nao muda nada, nem o resto do
  // formulario -- senao o lojista veria "erro" e acharia que nada foi salvo.
  const tokenNovo = vaiPeloServidor(plataforma) ? v.token : null;
  if (tokenNovo) {
    const recusa = await conferirToken(plataforma, v.conta, tokenNovo, v.testEventCode);
    if (recusa) return recusa;
  }

  const mudancas: Record<string, unknown> = {
    conta: v.conta,
    labels: v.labels,
    test_event_code: v.testEventCode,
    id_template: v.idTemplate,
    ativo: corpo.ativo ?? atual.ativo,
    updated_at: new Date().toISOString(),
  };
  // Campo ausente nao vira null: PATCH sem `nome` nao e "apague o nome".
  if (corpo.nome !== undefined) mudancas.nome = (corpo.nome || "").trim() || null;

  const { error } = await admin
    .from("tracking_destinations")
    .update(mudancas)
    .eq("id", atual.id);

  if (error) return erroDeBanco(error.message);

  // Token novo substitui; vazio mantem o que esta gravado.
  if (v.token) {
    const { error: erroSegredo } = await admin
      .from("tracking_destination_secrets")
      .upsert({ destination_id: atual.id, access_token: v.token }, {
        onConflict: "destination_id",
      });
    if (erroSegredo) {
      return NextResponse.json({ error: erroSegredo.message }, { status: 500 });
    }
  }

  // Token novo e conferido: as compras que cairam pelo token antigo voltam.
  //
  // So com o MESMO pixel. As falhas foram contra o pixel antigo; trocar o pixel
  // junto com o token e apontar para outro conjunto de dados, e despejar ali
  // compras de outro pixel nao e recuperacao, e mistura.
  //
  // E so com o destino ativo e a loja ligada: senao `entregar` derrubaria cada
  // linha de volta para 'falhou' com "destino desativado", e a tela teria dito
  // "vao ser reenviadas" sem nada sair.
  let reenviados = { total: 0, compras: 0 };
  if (
    tokenNovo &&
    vaiPeloServidor(plataforma) &&
    v.conta === atual.conta &&
    mudancas.ativo === true
  ) {
    const { data: config } = await admin
      .from("tracking_configs")
      .select("enabled")
      .eq("store_id", atual.store_id)
      .maybeSingle();
    if (config?.enabled) {
      reenviados = await reenfileirarFalhasDeCredencial(admin, atual.id, plataforma);
    }
  }

  return NextResponse.json({
    ok: true,
    requeued: reenviados.total,
    requeuedPurchases: reenviados.compras,
  });
}

// ---------------------------------------------------------------------------
// Remover
// ---------------------------------------------------------------------------
//
// Apagar leva o HISTORICO junto: `tracking_events.destination_id` tem
// `on delete cascade`, entao os envios daquela conta saem da contagem da tela.
// A tela avisa isso e oferece desativar, que para de enviar e preserva o que
// ja saiu.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id ausente." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("tracking_destinations")
    .select("id, store_id, user_id")
    .eq("id", id)
    .maybeSingle();

  // Mesma regra do PATCH: a linha e a loja. Aqui pesa mais, porque apagar leva
  // o historico junto (cascade) e nao tem volta.
  if (
    !atual ||
    atual.user_id !== user.id ||
    !(await lojaEDoUsuario(admin, atual.store_id, user.id))
  ) {
    return NextResponse.json({ error: "Destino nao encontrado." }, { status: 404 });
  }

  const { error } = await admin.from("tracking_destinations").delete().eq("id", atual.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
