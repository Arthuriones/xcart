// Tipos e rotulos da tela de Vendas.
//
// Vivem separados de queries.ts de proposito: aquele arquivo e "server-only" e
// fala com a Shopify. A tela e componente de cliente e precisa da lista de
// periodos -- importar de la arrastaria o modulo do servidor para o navegador.

export type SalesPeriod = "7" | "30" | "60";

export const SALES_PERIODS: { id: SalesPeriod; label: string }[] = [
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "60", label: "60 dias" },
];

export interface SalesRow {
  storeId: string;
  name: string;
  domain: string;
  /** Estado da loja no rodizio, igual ao do roteamento. */
  state: "ok" | "paused" | "attention";
  orders: number;
  revenueCents: number;
  currency: string;
  /** Fatia da RECEITA do periodo, nao do peso configurado. */
  sharePercent: number;
  /** Fatia do trafego configurada no rodizio, para comparar com a receita. */
  trafficPercent: number;
  problem: "denied" | "failed" | null;
  /** Vitrines que mandam comprador para esta loja. */
  vitrines: string[];
}

export interface Sales {
  period: SalesPeriod;
  rows: SalesRow[];
  totalOrders: number;
  totalRevenueCents: number;
  currency: string;
  /** Quantas lojas de checkout existem, mesmo as que nao responderam. */
  storeCount: number;
  /** Lojas conectadas antes do app pedir read_orders. */
  deniedNames: string[];
  hasRoute: boolean;
  /** Quantas rotas alimentam esta tela. */
  routeCount: number;
  maxDays: number;
}
