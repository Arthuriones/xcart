import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Dados da tela de rastreamento.
//
// Alem da configuracao, esta consulta responde a pergunta que decide se o
// rastreamento esta saudavel: "quantos pedidos entraram e quantas conversoes
// sairam?".
//
// Isso importa porque o endpoint de conversao do Google responde 200 mesmo
// quando ignora o conteudo -- "enviado" nao prova que foi contado. A unica
// forma de perceber que quebrou e a AUSENCIA: pedidos entrando e conversoes
// parando. Por isso a divergencia aparece na tela, nao so a fila.
// ============================================================================

export interface LojaTracking {
  storeId: string;
  nome: string;
  dominio: string;
  ligado: boolean;
  googleConversionId: string | null;
  googleConversionLabel: string | null;
  metaPixelId: string | null;
  /** O webhook orders/create esta inscrito? Sem ele nao entra evento nenhum. */
  temWebhook: boolean;
  /** O snippet esta no tema? Sem ele o gclid nunca chega ao pedido. */
  temSnippet: boolean;
  googleCustomerId: string | null;
  /** O lojista autorizou a conta Google? Sem isso o enhancement nao sai. */
  temAutorizacaoGoogle: boolean;
  enviados7d: number;
  falharam7d: number;
  pendentes: number;
  /** Enhanced conversions: contado separado porque falha por motivos proprios. */
  ecEnviados7d: number;
  ecFalharam7d: number;
  ecUltimoErro: string | null;
  /** Enviados sem nenhum click id: conversao que o Google nao liga a anuncio. */
  semAtribuicao7d: number;
  ultimoEnvio: string | null;
  ultimoErro: string | null;
}

export interface PainelTracking {
  lojas: LojaTracking[];
}

export async function getPainelTracking(): Promise<PainelTracking> {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return { lojas: [] };

  const { data: lojas } = await supabase
    .from("stores")
    .select("id, name, shop_domain")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: true });

  if (!lojas?.length) return { lojas: [] };

  const ids = lojas.map((l) => l.id);

  // A configuracao e lida com o cliente do usuario (RLS garante que so vem o
  // dele). A fila tambem: a policy de leitura ja limita por dono.
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: configs }, { data: eventos }] = await Promise.all([
    supabase
      .from("tracking_configs")
      .select(
        "store_id, enabled, google_conversion_id, google_conversion_label, meta_pixel_id, google_customer_id"
      )
      .in("store_id", ids),
    supabase
      .from("tracking_events")
      .select("store_id, destination, status, last_error, sent_at, created_at")
      .in("store_id", ids)
      .gte("created_at", desde)
      .order("created_at", { ascending: false }),
  ]);

  const porLoja = new Map(
    (configs || []).map((c) => [c.store_id, c])
  );

  // O refresh token mora em tracking_secrets, que so o service_role alcanca --
  // de proposito: ele da escrita na conta de anuncios do lojista. A tela nao
  // precisa do valor, so de saber se existe. As lojas ja foram filtradas por
  // RLS acima, entao este admin nao amplia o que o usuario ve.
  const comAutorizacao = new Set<string>();
  {
    const { data } = await createAdminClient()
      .from("tracking_secrets")
      .select("store_id, google_refresh_token")
      .in("store_id", ids);
    for (const l of data || []) {
      if (l.google_refresh_token) comAutorizacao.add(l.store_id);
    }
  }

  // Webhook e snippet exigem chamar a Shopify, o que e lento e nem sempre
  // possivel. A tela mostra o que da para saber do banco; o diagnostico
  // completo fica no script.
  const contagem = new Map<
    string,
    {
      enviados: number;
      falharam: number;
      pendentes: number;
      semAtrib: number;
      ultimo: string | null;
      erro: string | null;
      ecEnviados: number;
      ecFalharam: number;
      ecErro: string | null;
    }
  >();
  for (const e of eventos || []) {
    const atual = contagem.get(e.store_id) || {
      enviados: 0,
      falharam: 0,
      pendentes: 0,
      semAtrib: 0,
      ultimo: null,
      erro: null,
      ecEnviados: 0,
      ecFalharam: 0,
      ecErro: null,
    };

    // O enhancement e uma SEGUNDA chamada da mesma venda. Somado junto, ele
    // dobraria o total de "conversoes enviadas" e o numero deixaria de bater
    // com os pedidos -- que e justamente a conta que serve de alarme.
    if (e.destination === "google_ec") {
      if (e.status === "enviado") atual.ecEnviados += 1;
      else if (e.status === "falhou") {
        atual.ecFalharam += 1;
        if (!atual.ecErro && e.last_error) atual.ecErro = e.last_error;
      }
      contagem.set(e.store_id, atual);
      continue;
    }

    if (e.status === "enviado") {
      atual.enviados += 1;
      if (!atual.ultimo && e.sent_at) atual.ultimo = e.sent_at;
      // O envio grava este aviso quando nao havia click id nenhum.
      if ((e.last_error || "").includes("sem atribuicao")) atual.semAtrib += 1;
    } else if (e.status === "falhou") {
      atual.falharam += 1;
      if (!atual.erro && e.last_error) atual.erro = e.last_error;
    } else {
      atual.pendentes += 1;
    }
    contagem.set(e.store_id, atual);
  }

  return {
    lojas: lojas.map((l) => {
      const cfg = porLoja.get(l.id);
      const c = contagem.get(l.id);
      return {
        storeId: l.id,
        nome: l.name || l.shop_domain,
        dominio: l.shop_domain,
        ligado: Boolean(cfg?.enabled),
        googleConversionId: cfg?.google_conversion_id ?? null,
        googleConversionLabel: cfg?.google_conversion_label ?? null,
        metaPixelId: cfg?.meta_pixel_id ?? null,
        googleCustomerId: cfg?.google_customer_id ?? null,
        temAutorizacaoGoogle: comAutorizacao.has(l.id),
        temWebhook: false,
        temSnippet: false,
        enviados7d: c?.enviados ?? 0,
        falharam7d: c?.falharam ?? 0,
        pendentes: c?.pendentes ?? 0,
        ecEnviados7d: c?.ecEnviados ?? 0,
        ecFalharam7d: c?.ecFalharam ?? 0,
        ecUltimoErro: c?.ecErro ?? null,
        semAtribuicao7d: c?.semAtrib ?? 0,
        ultimoEnvio: c?.ultimo ?? null,
        ultimoErro: c?.erro ?? null,
      };
    }),
  };
}

/**
 * Pedidos pagos por loja nos ultimos 7 dias.
 *
 * E o outro lado da conta do alarme: sem isso, "10 conversoes enviadas" nao
 * diz nada -- pode ser 10 de 10 ou 10 de 200. Vem da Shopify, porque o xcart
 * nao guarda pedido.
 */
export async function getPedidosDaSemana(
  storeIds: string[]
): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { getOrdersSummary } = await import("@/lib/shopify/orders");
  const { runWithConcurrency } = await import("@/lib/concurrency");

  const { data: lojas } = await admin
    .from("stores")
    .select("id, shop_domain, client_id, client_secret, access_token")
    .in("id", storeIds);

  const desde = new Date(Date.now() - 7 * 864e5);
  const saida = new Map<string, number>();

  await runWithConcurrency(lojas || [], 6, async (l) => {
    if (!l.client_id || !l.client_secret) return;
    const r = await getOrdersSummary(
      {
        shopDomain: l.shop_domain,
        clientId: l.client_id,
        clientSecret: l.client_secret,
        accessToken: l.access_token,
      },
      desde
    );
    if (!r.problem) saida.set(l.id, r.orders);
  });

  return saida;
}
