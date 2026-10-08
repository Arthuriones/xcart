import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureWebhook, shopifyGraphQL, type ShopifyCredentials } from "@/lib/shopify/client";
import { getPublicAppUrl } from "@/lib/public-url";
import { runWithConcurrency } from "@/lib/concurrency";
import {
  CAMINHO_DOS_WEBHOOKS,
  CHAVE_PEDIDOS,
  CHAVE_VITRINE,
  MOTIVO_ESCAPE,
  MOTIVO_SEM_ESCOPO,
  TOPICO_CHECKOUT,
  TOPICO_PEDIDOS,
  chaveDoEscape,
  classificarFalha,
  decidirTopico,
  detalheDoEscape,
  itensDoCheckout,
  lerInscricao,
  precisaConferir,
  type InscricaoNaShopify,
  type InscricaoWebhook,
} from "@/lib/checkout-routes/sensor";

// ============================================================================
// O lado com banco e rede do sensor do roteamento (as regras estao em
// sensor.ts).
//
//   conferirWebhooks          -- garante orders/create em cada loja de
//                                checkout ligada e checkouts/create na vitrine
//                                de cada rota ligada. Idempotente e barato: 1
//                                leitura por loja (escopos + inscricoes), e so
//                                inscreve o que falta. Grava o resultado em
//                                settings (sem migration) para a tela e para a
//                                conferencia seguinte, no maximo 1x por dia.
//   registrarCheckoutNaVitrine -- o handler do checkouts/create.
// ============================================================================

type Admin = SupabaseClient;

/**
 * Sempre o host publico do app, nunca a origem da requisicao: o cron da
 * Vercel chega pelo *.vercel.app, e inscrever la criaria uma segunda
 * assinatura -- cada pedido entregue duas vezes.
 */
export function urlDosWebhooks(): string {
  return `${getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL)}${CAMINHO_DOS_WEBHOOKS}`;
}

const QUERY_SENSOR = `query SensorDaLoja {
  currentAppInstallation { accessScopes { handle } }
  webhookSubscriptions(first: 100) {
    nodes {
      topic
      createdAt
      endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
    }
  }
}`;

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Escopos e inscricoes da loja, e inscreve os topicos que faltam. */
async function conferirLoja(
  creds: ShopifyCredentials,
  topicos: readonly string[],
  callbackUrl: string,
  agora: string
): Promise<Record<string, InscricaoWebhook>> {
  const saida: Record<string, InscricaoWebhook> = {};
  let escopos: string[] = [];
  let inscricoes: InscricaoNaShopify[] = [];
  try {
    const d = (await shopifyGraphQL(creds, QUERY_SENSOR)) as {
      currentAppInstallation?: { accessScopes?: { handle?: string }[] } | null;
      webhookSubscriptions?: {
        nodes?: { topic?: string; createdAt?: string | null; endpoint?: { callbackUrl?: string | null } | null }[];
      } | null;
    } | null;
    escopos = (d?.currentAppInstallation?.accessScopes || []).map((s) => String(s.handle || ""));
    inscricoes = (d?.webhookSubscriptions?.nodes || []).map((n) => ({
      topico: String(n.topic || ""),
      url: n.endpoint?.callbackUrl ?? null,
      criadoEm: n.createdAt ?? null,
    }));
  } catch (e) {
    const f = classificarFalha(mensagem(e));
    for (const t of topicos) saida[t] = { em: agora, estado: f.estado, motivo: f.motivo };
    return saida;
  }

  for (const topico of topicos) {
    const d = decidirTopico({ topico, escopos, inscricoes });
    if (d.acao === "ja_inscrito") {
      saida[topico] = { em: agora, estado: "inscrito", desde: d.desde ?? agora };
      continue;
    }
    if (d.acao === "sem_escopo") {
      saida[topico] = { em: agora, estado: "sem_permissao", motivo: MOTIVO_SEM_ESCOPO };
      continue;
    }
    const r = await ensureWebhook(creds, topico, callbackUrl);
    if (r.ok) {
      saida[topico] = { em: agora, estado: "inscrito", desde: agora };
    } else {
      const f = classificarFalha(r.message);
      saida[topico] = { em: agora, estado: f.estado, motivo: f.motivo };
    }
  }
  return saida;
}

type Tabela = "routed_checkout_configs" | "routed_checkout_targets";

interface Tarefa {
  tabela: Tabela;
  linhaId: string;
  chave: typeof CHAVE_PEDIDOS | typeof CHAVE_VITRINE;
  storeId: string;
  userId: string;
  topico: string;
  anterior: InscricaoWebhook | null;
}

/**
 * Grava settings[chave] lendo o settings na hora: o conserto e o tema-vitrine
 * escrevem no mesmo jsonb, e espalhar uma copia velha apagaria o que eles
 * gravaram.
 */
async function gravarInscricao(admin: Admin, t: Tarefa, valor: InscricaoWebhook): Promise<void> {
  const { data, error } = await admin.from(t.tabela).select("settings").eq("id", t.linhaId).maybeSingle();
  if (error || !data) {
    console.warn("[sensor] nao li o settings para gravar a inscricao:", error?.message ?? "linha sumiu");
    return;
  }
  const settings = ((data as { settings?: Record<string, unknown> | null }).settings || {}) as Record<string, unknown>;
  const { error: erro } = await admin
    .from(t.tabela)
    .update({ settings: { ...settings, [t.chave]: valor } })
    .eq("id", t.linhaId);
  if (erro) console.warn("[sensor] nao gravei a inscricao:", erro.message);
}

export interface ResultadoDaConferencia {
  lojas: number;
  inscritos: number;
  semPermissao: number;
  foraDoAr: number;
  falhas: number;
}

/**
 * Confere (e inscreve o que falta) os webhooks do sensor.
 *
 * Sem `rotaId`: todas as rotas LIGADAS, so o que nao foi conferido nas
 * ultimas 24 h, ate `limiteLojas` lojas por vez -- a mais tempo sem conferir
 * primeiro. Com `rotaId` (rota criada, loja de checkout adicionada): so
 * aquela rota, ligada ou nao. `forcar` ignora a data da ultima conferencia;
 * `reconferirPendentes` so para o que ainda nao esta inscrito.
 *
 * Nunca lanca por causa da Shopify: cada loja vira um estado na tela. Lanca so
 * se o banco nao responder a leitura das rotas.
 */
export async function conferirWebhooks(
  admin: Admin,
  opts: {
    rotaId?: string;
    forcar?: boolean;
    /** Reconfere ja o que NAO esta inscrito (o lojista acabou de dar a permissao). */
    reconferirPendentes?: boolean;
    limiteLojas?: number;
    agora?: number;
  } = {}
): Promise<ResultadoDaConferencia> {
  const agora = opts.agora ?? Date.now();
  const agoraIso = new Date(agora).toISOString();
  const resultado: ResultadoDaConferencia = { lojas: 0, inscritos: 0, semPermissao: 0, foraDoAr: 0, falhas: 0 };

  let qRotas = admin.from("routed_checkout_configs").select("id, user_id, source_store_id, settings");
  qRotas = opts.rotaId ? qRotas.eq("id", opts.rotaId) : qRotas.eq("enabled", true);
  const { data: rotas, error } = await qRotas;
  if (error) throw new Error(`[sensor] falha ao ler as rotas: ${error.message}`);
  type Rota = { id: string; user_id: string; source_store_id: string | null; settings: unknown };
  const listaRotas = (rotas || []) as Rota[];
  if (listaRotas.length === 0) return resultado;

  const { data: destinos, error: erroDestinos } = await admin
    .from("routed_checkout_targets")
    .select("id, route_id, target_store_id, settings")
    .in(
      "route_id",
      listaRotas.map((r) => r.id)
    )
    .eq("enabled", true);
  if (erroDestinos) throw new Error(`[sensor] falha ao ler as lojas de checkout: ${erroDestinos.message}`);
  type Destino = { id: string; route_id: string; target_store_id: string | null; settings: unknown };
  const donoDaRota = new Map(listaRotas.map((r) => [r.id, r.user_id]));

  const tarefas: Tarefa[] = [
    ...listaRotas.map((r): Tarefa => ({
      tabela: "routed_checkout_configs",
      linhaId: r.id,
      chave: CHAVE_VITRINE,
      storeId: r.source_store_id || "",
      userId: r.user_id,
      topico: TOPICO_CHECKOUT,
      anterior: lerInscricao(r.settings, CHAVE_VITRINE),
    })),
    ...((destinos || []) as Destino[]).map((d): Tarefa => ({
      tabela: "routed_checkout_targets",
      linhaId: d.id,
      chave: CHAVE_PEDIDOS,
      storeId: d.target_store_id || "",
      userId: donoDaRota.get(d.route_id) || "",
      topico: TOPICO_PEDIDOS,
      anterior: lerInscricao(d.settings, CHAVE_PEDIDOS),
    })),
  ].filter(
    (t) =>
      t.storeId &&
      t.userId &&
      (opts.forcar ||
        (opts.reconferirPendentes && t.anterior?.estado !== "inscrito") ||
        precisaConferir(t.anterior, agora))
  );
  if (tarefas.length === 0) return resultado;

  const porLoja = new Map<string, Tarefa[]>();
  for (const t of tarefas) porLoja.set(t.storeId, [...(porLoja.get(t.storeId) || []), t]);
  const idade = (lista: Tarefa[]) =>
    Math.min(...lista.map((t) => (t.anterior ? Date.parse(t.anterior.em) || 0 : 0)));
  const fila = [...porLoja.entries()]
    .sort((a, b) => idade(a[1]) - idade(b[1]))
    .slice(0, Math.max(1, opts.limiteLojas ?? porLoja.size));

  const { data: lojas, error: erroLojas } = await admin
    .from("stores")
    .select("id, user_id, shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .in(
      "id",
      fila.map(([id]) => id)
    );
  if (erroLojas) throw new Error(`[sensor] falha ao ler as lojas: ${erroLojas.message}`);
  type Loja = {
    id: string;
    user_id: string;
    shop_domain: string;
    client_id: string | null;
    client_secret: string | null;
    access_token: string | null;
    uninstalled_at: string | null;
  };
  const lojaPorId = new Map(((lojas || []) as Loja[]).map((l) => [l.id, l]));
  const callbackUrl = urlDosWebhooks();

  await runWithConcurrency(fila, 3, async ([storeId, lista]) => {
    const loja = lojaPorId.get(storeId);
    // O cliente e admin: o dono da rota tem que ser o dono da loja, ou o
    // sensor estaria lendo (e inscrevendo webhook) na loja de outra pessoa.
    const minhas = loja ? lista.filter((t) => t.userId === loja.user_id) : [];
    if (!loja || minhas.length === 0) return;
    resultado.lojas += 1;

    const topicos = [...new Set(minhas.map((t) => t.topico))];
    let porTopico: Record<string, InscricaoWebhook>;
    if (loja.uninstalled_at || !loja.client_id || !loja.client_secret) {
      const motivo = loja.uninstalled_at ? "app removido da loja" : "loja sem credencial do app";
      porTopico = Object.fromEntries(topicos.map((t) => [t, { em: agoraIso, estado: "loja_fora" as const, motivo }]));
    } else {
      porTopico = await conferirLoja(
        {
          shopDomain: loja.shop_domain,
          clientId: loja.client_id,
          clientSecret: loja.client_secret,
          accessToken: loja.access_token,
        },
        topicos,
        callbackUrl,
        agoraIso
      );
    }

    for (const t of minhas) {
      const valor = porTopico[t.topico];
      if (!valor) continue;
      if (valor.estado === "inscrito") resultado.inscritos += 1;
      else if (valor.estado === "sem_permissao") resultado.semPermissao += 1;
      else if (valor.estado === "loja_fora") resultado.foraDoAr += 1;
      else resultado.falhas += 1;
      await gravarInscricao(admin, t, valor);
    }
  });

  return resultado;
}

/**
 * checkouts/create na VITRINE: um comprador escapou da rota.
 *
 * Grava em routed_checkout_fallbacks (reason "checkout_na_vitrine") so os
 * itens -- SKU, variante, quantidade. E-mail, telefone, endereco e nome do
 * payload nao saem daqui.
 *
 * Nao conta quando a loja tambem e loja de checkout de alguma rota ligada: ai
 * o checkout dela pode ser o carrinho que outra vitrine mandou, e nao da para
 * separar um do outro.
 *
 * Erro do banco LANCA: o webhook responde 503 e a Shopify reentrega.
 */
export async function registrarCheckoutNaVitrine(
  admin: Admin,
  loja: { id: string; user_id: string; shop_domain: string },
  payload: Record<string, unknown>
): Promise<{ gravado: boolean; motivo?: string }> {
  const { data: rotas, error } = await admin
    .from("routed_checkout_configs")
    .select("id")
    .eq("user_id", loja.user_id)
    .eq("source_store_id", loja.id)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`falha ao ler a rota da vitrine: ${error.message}`);
  const rota = (rotas || [])[0] as { id: string } | undefined;
  if (!rota) return { gravado: false, motivo: "loja nao e vitrine de rota ligada" };

  const [comoDestino, comoLegado] = await Promise.all([
    admin
      .from("routed_checkout_targets")
      .select("id, route:route_id(enabled, user_id)")
      .eq("target_store_id", loja.id)
      .eq("enabled", true),
    admin
      .from("routed_checkout_configs")
      .select("id")
      .eq("user_id", loja.user_id)
      .eq("target_store_id", loja.id)
      .eq("enabled", true)
      .limit(1),
  ]);
  if (comoDestino.error) throw new Error(`falha ao ler os destinos: ${comoDestino.error.message}`);
  if (comoLegado.error) throw new Error(`falha ao ler as rotas: ${comoLegado.error.message}`);
  type RotaDoDestino = { enabled?: boolean | null; user_id?: string | null };
  const recebe =
    ((comoDestino.data || []) as { route?: RotaDoDestino | RotaDoDestino[] | null }[]).some((linha) => {
      const r = Array.isArray(linha.route) ? linha.route[0] : linha.route;
      return Boolean(r?.enabled && r.user_id === loja.user_id);
    }) || (comoLegado.data || []).length > 0;
  if (recebe) return { gravado: false, motivo: "loja tambem e checkout de rota" };

  const itens = itensDoCheckout(payload);
  if (itens.length === 0) return { gravado: false, motivo: "checkout sem itens" };

  // Uso unico por checkout, pela PK de shopify_webhook_events (ver
  // chaveDoEscape): sem coluna nem tabela nova.
  const token =
    typeof payload.token === "string" && payload.token
      ? payload.token
      : payload.id != null
        ? String(payload.id)
        : "";
  let trava: string | null = null;
  if (token) {
    trava = chaveDoEscape(loja.id, token);
    const { error: erroTrava } = await admin.from("shopify_webhook_events").insert({
      webhook_id: trava,
      topic: "checkouts/create:token",
      shop_domain: loja.shop_domain,
      store_id: loja.id,
    });
    // 23505 = este checkout ja foi contado (outra entrega, outra inscricao).
    if (erroTrava?.code === "23505") return { gravado: false, motivo: "checkout ja contado" };
    if (erroTrava) throw new Error(`falha ao travar o checkout: ${erroTrava.message}`);
  }

  const { error: erroEvento } = await admin.from("routed_checkout_fallbacks").insert({
    route_config_id: rota.id,
    target_id: null,
    reason: MOTIVO_ESCAPE,
    detail: detalheDoEscape(itens),
    page_url: null,
  });
  if (erroEvento) {
    // Sem soltar a trava, a reentrega cairia em "ja contado" e o escape sumia.
    if (trava) await admin.from("shopify_webhook_events").delete().eq("webhook_id", trava);
    throw new Error(`falha ao gravar o escape: ${erroEvento.message}`);
  }
  return { gravado: true };
}
