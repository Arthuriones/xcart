import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getRouteGraph } from "@/lib/checkout-routes/graph";
import { getOrdersSummary, MAX_ORDER_DAYS } from "@/lib/shopify/orders";
import type { Sales, SalesPeriod, SalesRow } from "@/lib/sales/types";

export type { Sales, SalesPeriod, SalesRow } from "@/lib/sales/types";
export { SALES_PERIODS } from "@/lib/sales/types";

const DIAS: Record<SalesPeriod, number> = { "7": 7, "30": 30, "60": 60 };

/**
 * Reparte 100% entre as lojas sem perder nem sobrar ponto no arredondamento.
 *
 * Arredondar cada fatia sozinha faz a coluna somar 99% ou 101%, e numa tabela
 * com um "Total 100%" no rodape isso salta aos olhos. Aqui cada uma leva o
 * piso e os pontos que sobram vao para os maiores restos.
 */
function repartirCem(valores: number[]): number[] {
  const soma = valores.reduce((a, b) => a + b, 0);
  if (soma <= 0) return valores.map(() => 0);
  const cru = valores.map((v) => (v / soma) * 100);
  const piso = cru.map(Math.floor);
  let sobra = 100 - piso.reduce((a, b) => a + b, 0);
  const ordem = cru
    .map((v, i) => [v - piso[i], i] as const)
    .sort((a, b) => b[0] - a[0]);
  const fatias = piso.slice();
  for (let i = 0; i < ordem.length && sobra > 0; i += 1, sobra -= 1) {
    fatias[ordem[i][1]] += 1;
  }
  return fatias;
}

/**
 * Vendas das lojas de checkout no periodo.
 *
 * O dinheiro entra nas lojas de checkout -- e la que o pagamento acontece --
 * entao e nelas que perguntamos, uma por uma, direto na Shopify. Nao existe
 * tabela de pedidos no xcart: copiar o pedido para ca criaria uma segunda
 * verdade que envelhece a cada reembolso.
 */
export async function getSales(period: SalesPeriod = "30"): Promise<Sales> {
  const vazio: Sales = {
    period,
    rows: [],
    totalOrders: 0,
    totalRevenueCents: 0,
    currency: "BRL",
    storeCount: 0,
    deniedNames: [],
    hasRoute: false,
    routeCount: 0,
    maxDays: MAX_ORDER_DAYS,
  };

  const [user, grafo] = await Promise.all([getCurrentUser(), getRouteGraph()]);
  if (!user) return vazio;
  if (grafo.routes.length === 0) return vazio;

  const porId = new Map(grafo.stores.map((s) => [s.id, s]));

  /**
   * Uma linha por LOJA DE CHECKOUT, nao por destino de rota.
   *
   * A tela lia so grafo.routes[0] e por isso mostrava uma loja de checkout
   * numa conta com tres rotas. O pedido pertence a LOJA, nao a rota: se duas
   * vitrines mandam comprador para o mesmo checkout, o faturamento dele e um
   * so e some se contarmos por rota.
   */
  const porLoja = new Map<
    string,
    { peso: number; ligado: boolean; mapeado: number; vitrines: Set<string> }
  >();

  for (const rota of grafo.routes) {
    const vitrine = porId.get(rota.sourceStoreId)?.name || "vitrine removida";
    for (const destino of rota.targets) {
      const atual = porLoja.get(destino.storeId) || {
        peso: 0,
        ligado: false,
        mapeado: 0,
        vitrines: new Set<string>(),
      };
      // A rota parada nao manda ninguem, entao o peso dela nao conta.
      if (rota.enabled && destino.enabled) atual.peso += destino.weight;
      atual.ligado = atual.ligado || (rota.enabled && destino.enabled);
      atual.mapeado = Math.max(atual.mapeado, destino.mappedSkuCount);
      atual.vitrines.add(vitrine);
      porLoja.set(destino.storeId, atual);
    }
  }

  const ids = [...porLoja.keys()];
  if (ids.length === 0) {
    return { ...vazio, hasRoute: true, routeCount: grafo.routes.length };
  }

  // As credenciais nao estao no grafo (ele nao carrega segredo): uma consulta
  // so, filtrada pelos ids que interessam.
  const supabase = await createClient();
  const { data: linhas } = await supabase
    .from("stores")
    .select("id, shop_domain, client_id, client_secret, access_token")
    .in("id", ids);

  const credenciais = new Map(
    (linhas || []).map((l) => [
      l.id,
      {
        shopDomain: l.shop_domain,
        clientId: l.client_id,
        clientSecret: l.client_secret,
        accessToken: l.access_token,
      },
    ])
  );

  const desde = new Date(Date.now() - DIAS[period] * 24 * 60 * 60 * 1000);

  // Uma loja lenta nao pode segurar as outras: todas perguntam ao mesmo tempo.
  const resumos = await Promise.all(
    ids.map(async (id) => {
      const cred = credenciais.get(id);
      if (!cred) {
        return { orders: 0, revenueCents: 0, currency: "BRL", problem: "failed" as const };
      }
      return getOrdersSummary(cred, desde);
    })
  );

  const fatias = repartirCem(resumos.map((r) => r.revenueCents));
  const pesos = repartirCem(ids.map((id) => porLoja.get(id)!.peso));

  const rows: SalesRow[] = ids.map((id, i) => {
    const loja = porId.get(id);
    const info = porLoja.get(id)!;
    const resumo = resumos[i];
    const problema = info.ligado && info.mapeado === 0;
    return {
      storeId: id,
      name: loja?.name || "loja removida",
      domain: loja?.shopDomain || "",
      state: problema ? "attention" : info.ligado && info.peso > 0 ? "ok" : "paused",
      orders: resumo.orders,
      revenueCents: resumo.revenueCents,
      currency: resumo.currency,
      sharePercent: fatias[i],
      trafficPercent: pesos[i],
      problem: resumo.problem,
      vitrines: [...info.vitrines],
    };
  });

  // Maior faturamento primeiro: a tabela responde "quem esta vendendo" antes
  // de qualquer outra pergunta.
  rows.sort((a, b) => b.revenueCents - a.revenueCents);

  const comMoeda = rows.find((r) => r.revenueCents > 0) || rows[0];

  return {
    period,
    rows,
    totalOrders: rows.reduce((s, r) => s + r.orders, 0),
    totalRevenueCents: rows.reduce((s, r) => s + r.revenueCents, 0),
    currency: comMoeda?.currency || "BRL",
    storeCount: rows.length,
    deniedNames: rows.filter((r) => r.problem === "denied").map((r) => r.name),
    hasRoute: true,
    routeCount: grafo.routes.length,
    maxDays: MAX_ORDER_DAYS,
  };
}
