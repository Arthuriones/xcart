import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWithConcurrency } from "@/lib/concurrency";
import { getOrdersSummary, MAX_ORDER_DAYS } from "@/lib/shopify/orders";
import { paraCentavosBRL, conhecida } from "@/lib/sales/cambio";
import type { SalesPeriod } from "@/lib/sales/types";
import type {
  FaturamentoAdmin,
  LojaFaturamento,
  UsuarioFaturamento,
} from "@/lib/sales/admin-types";

// Re-exporta para quem ja importava daqui nao precisar saber da divisao.
export type { FaturamentoAdmin, LojaFaturamento, UsuarioFaturamento };

const DIAS: Record<SalesPeriod, number> = { "7": 7, "30": 30, "60": 60 };

/**
 * Quantas lojas perguntamos ao mesmo tempo.
 *
 * Cada loja e um app diferente na Shopify, entao o limite de chamadas nao e
 * compartilhado entre elas — o teto aqui existe por causa do nosso lado
 * (memoria e tempo da rota), nao do lado deles. Seis mantem a pagina abrindo
 * em poucos segundos mesmo com dezenas de lojas.
 */
const EM_PARALELO = 6;

interface LinhaLoja {
  id: string;
  user_id: string;
  name: string | null;
  shop_domain: string;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  uninstalled_at: string | null;
}

/**
 * Faturamento por usuario do xcart, olhando so as lojas que recebem comprador
 * por roteamento.
 *
 * Continua sem tabela de pedidos, igual a tela do usuario: perguntamos a cada
 * loja de checkout na hora. Copiar pedido para ca criaria uma segunda verdade
 * que envelhece a cada reembolso — e aqui o problema seria maior, porque o
 * numero serve para ranquear gente.
 *
 * "Faturando no roteamento" = pedido pago na LOJA DE CHECKOUT. Nao e possivel
 * separar, dentro dela, o pedido que veio da vitrine do que veio de outro
 * lugar: o pedido nao carrega essa marca. Na pratica a loja de checkout so
 * recebe trafego por roteamento, entao os numeros coincidem — mas vale saber
 * que a atribuicao e da loja, nao da rota.
 */
export async function getFaturamentoAdmin(
  period: SalesPeriod = "30"
): Promise<FaturamentoAdmin> {
  const admin = createAdminClient();
  const vazio: FaturamentoAdmin = {
    period,
    maxDays: MAX_ORDER_DAYS,
    computedAt: new Date().toISOString(),
    usuarios: [],
    totalOrders: 0,
    totalRevenueBrlCents: 0,
    deniedCount: 0,
    failedCount: 0,
    storeCount: 0,
    moedasSemTaxa: [],
  };

  // --- quais lojas recebem comprador, e de quem ----------------------------
  const { data: rotas } = await admin
    .from("routed_checkout_configs")
    .select("id, user_id, enabled, source_store_id, target_store_id")
    .eq("enabled", true);

  if (!rotas || rotas.length === 0) return vazio;

  const { data: destinos } = await admin
    .from("routed_checkout_targets")
    .select("route_id, target_store_id, enabled")
    .in(
      "route_id",
      rotas.map((r) => r.id)
    );

  // storeId da loja de checkout -> dono e as vitrines que mandam comprador
  const alvos = new Map<string, { userId: string; vitrines: Set<string> }>();

  const anotar = (storeId: string | null, userId: string, sourceId: string | null) => {
    if (!storeId) return;
    const atual = alvos.get(storeId) || { userId, vitrines: new Set<string>() };
    if (sourceId) atual.vitrines.add(sourceId);
    alvos.set(storeId, atual);
  };

  interface LinhaDestino {
    route_id: string;
    target_store_id: string | null;
    enabled: boolean;
  }

  const destinosPorRota = new Map<string, LinhaDestino[]>();
  for (const d of (destinos || []) as LinhaDestino[]) {
    const lista = destinosPorRota.get(d.route_id);
    if (lista) lista.push(d);
    else destinosPorRota.set(d.route_id, [d]);
  }

  for (const rota of rotas) {
    const lista = destinosPorRota.get(rota.id) || [];
    if (lista.length > 0) {
      for (const d of lista) {
        if (d.enabled) anotar(d.target_store_id, rota.user_id, rota.source_store_id);
      }
    } else {
      // Rota anterior a migracao 025: o destino mora na propria config.
      anotar(rota.target_store_id, rota.user_id, rota.source_store_id);
    }
  }

  if (alvos.size === 0) return vazio;

  // --- credenciais e nomes -------------------------------------------------
  const idsNecessarios = new Set<string>(alvos.keys());
  for (const info of alvos.values()) {
    for (const v of info.vitrines) idsNecessarios.add(v);
  }

  const { data: lojas } = await admin
    .from("stores")
    .select("id, user_id, name, shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .in("id", [...idsNecessarios]);

  const porId = new Map<string, LinhaLoja>((lojas || []).map((l) => [l.id, l as LinhaLoja]));

  // --- pedidos, uma pergunta por loja de checkout --------------------------
  const desde = new Date(Date.now() - DIAS[period] * 24 * 60 * 60 * 1000);
  const ids = [...alvos.keys()];

  const resumos = await runWithConcurrency(ids, EM_PARALELO, async (storeId) => {
    const loja = porId.get(storeId);
    if (!loja || !loja.client_id || !loja.client_secret) {
      return { orders: 0, revenueCents: 0, currency: "BRL", problem: "failed" as const };
    }
    // App desinstalado: o token esta morto, chamar so gera erro e demora.
    if (loja.uninstalled_at) {
      return { orders: 0, revenueCents: 0, currency: "BRL", problem: "failed" as const };
    }
    return getOrdersSummary(
      {
        shopDomain: loja.shop_domain,
        clientId: loja.client_id,
        clientSecret: loja.client_secret,
        accessToken: loja.access_token,
      },
      desde
    );
  });

  // --- agrupa por dono -----------------------------------------------------
  const porUsuario = new Map<string, UsuarioFaturamento>();
  const semTaxaGlobal = new Set<string>();
  let denied = 0;
  let failed = 0;

  ids.forEach((storeId, i) => {
    const info = alvos.get(storeId)!;
    const loja = porId.get(storeId);
    const resumo = resumos[i];
    if (resumo.problem === "denied") denied += 1;
    if (resumo.problem === "failed") failed += 1;

    const brl = resumo.revenueCents > 0 ? paraCentavosBRL(resumo.revenueCents, resumo.currency) : 0;
    if (brl === null) semTaxaGlobal.add(resumo.currency);

    const linha: LojaFaturamento = {
      storeId,
      name: loja?.name || "loja removida",
      domain: loja?.shop_domain || "",
      orders: resumo.orders,
      revenueCents: resumo.revenueCents,
      currency: resumo.currency,
      revenueBrlCents: brl,
      problem: resumo.problem,
      vitrines: [...info.vitrines].map((v) => porId.get(v)?.name || "vitrine removida"),
    };

    const atual = porUsuario.get(info.userId) || {
      userId: info.userId,
      email: "",
      plan: null,
      orders: 0,
      revenueBrlCents: 0,
      lojas: [],
      semTaxa: [],
      routeCount: 0,
      lojasComDados: 0,
    };
    atual.orders += resumo.orders;
    atual.revenueBrlCents += brl ?? 0;
    if (!resumo.problem) atual.lojasComDados += 1;
    atual.lojas.push(linha);
    if (brl === null && !atual.semTaxa.includes(resumo.currency)) {
      atual.semTaxa.push(resumo.currency);
    }
    porUsuario.set(info.userId, atual);
  });

  for (const [userId, u] of porUsuario) {
    u.routeCount = rotas.filter((r) => r.user_id === userId).length;
    u.lojas.sort((a, b) => (b.revenueBrlCents ?? 0) - (a.revenueBrlCents ?? 0));
  }

  // --- email e plano -------------------------------------------------------
  const userIds = [...porUsuario.keys()];
  const [{ data: perfis }, listaAuth] = await Promise.all([
    admin.from("profiles").select("id, plan").in("id", userIds),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const planoPorId = new Map((perfis || []).map((p) => [p.id, p.plan as string | null]));
  const emailPorId = new Map<string, string>();
  for (const u of listaAuth?.data?.users || []) {
    if (u.id && u.email) emailPorId.set(u.id, u.email);
  }
  for (const u of porUsuario.values()) {
    u.email = emailPorId.get(u.userId) || "(sem email)";
    u.plan = planoPorId.get(u.userId) ?? null;
  }

  // Quem nao respondeu vai para o fim, sempre. Ordenar so por valor colocaria
  // uma conta cega no meio da tabela, com R$ 0,00 parecendo venda zerada.
  const usuarios = [...porUsuario.values()].sort((a, b) => {
    const cegoA = a.lojasComDados === 0;
    const cegoB = b.lojasComDados === 0;
    if (cegoA !== cegoB) return cegoA ? 1 : -1;
    return b.revenueBrlCents - a.revenueBrlCents;
  });

  return {
    period,
    maxDays: MAX_ORDER_DAYS,
    computedAt: new Date().toISOString(),
    usuarios,
    totalOrders: usuarios.reduce((s, u) => s + u.orders, 0),
    totalRevenueBrlCents: usuarios.reduce((s, u) => s + u.revenueBrlCents, 0),
    deniedCount: denied,
    failedCount: failed,
    storeCount: ids.length,
    moedasSemTaxa: [...semTaxaGlobal].filter((m) => m && !conhecida(m)),
  };
}
