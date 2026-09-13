// Tipos da apuracao de faturamento do painel admin.
//
// Separados de admin.ts pelo mesmo motivo que types.ts e separado de
// queries.ts: aquele arquivo e "server-only" e fala com a Shopify com
// credencial de service role. As telas do admin sao componentes de cliente e
// so precisam do FORMATO — importar de la arrastaria o modulo do servidor
// (e as credenciais) para o navegador.

export interface LojaFaturamento {
  storeId: string;
  name: string;
  domain: string;
  orders: number;
  /** Em centavos da moeda da propria loja. */
  revenueCents: number;
  currency: string;
  /** Convertido para real. `null` quando nao ha taxa para a moeda. */
  revenueBrlCents: number | null;
  problem: "denied" | "failed" | null;
  /** Vitrines que mandam comprador para esta loja. */
  vitrines: string[];
}

export interface UsuarioFaturamento {
  userId: string;
  email: string;
  plan: string | null;
  orders: number;
  revenueBrlCents: number;
  lojas: LojaFaturamento[];
  /** Moedas que ficaram de fora da conversao por falta de taxa. */
  semTaxa: string[];
  routeCount: number;
  /**
   * Quantas lojas deste usuario realmente responderam.
   *
   * Sem isto, "nao vendeu nada" e "nao conseguimos perguntar" viram o mesmo
   * R$ 0,00 — e a maioria das lojas antigas cai no segundo caso, por terem
   * sido conectadas antes do app pedir read_orders.
   */
  lojasComDados: number;
}

export interface FaturamentoAdmin {
  period: "7" | "30" | "60";
  maxDays: number;
  computedAt: string;
  usuarios: UsuarioFaturamento[];
  totalOrders: number;
  totalRevenueBrlCents: number;
  /** Lojas que existem na rota mas nao entregaram numero. */
  deniedCount: number;
  failedCount: number;
  storeCount: number;
  moedasSemTaxa: string[];
}
