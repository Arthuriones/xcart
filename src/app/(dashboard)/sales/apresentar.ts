import { formatarDinheiro } from "@/lib/financeiro/tipos";
import { repartirCem } from "@/lib/sales/share";
import type { SalesPeriod, SalesRow } from "@/lib/sales/types";

// ============================================================================
// Regras da tela Vendas por rota, sem React e sem banco. Puro para o vitest.
//
// O cuidado principal e a MOEDA. Cada loja de checkout fatura na sua (BRL,
// USD, CLP...). Somar centavos de moedas diferentes da um numero sem sentido,
// e a fatia da receita feita em cima dele tambem. Entao:
//   - uma moeda so: total, ticket, lider e % da receita normais;
//   - mais de uma: total por moeda, e o que exigiria cambio vira "—".
// Loja sem nenhum pedido no periodo nao conta como moeda: a Shopify nao diz
// a moeda dela e o resumo devolve "BRL" so como padrao.
// ============================================================================

export function periodoValido(v: string | undefined | null): SalesPeriod {
  return v === "7" || v === "60" ? v : "30";
}

/** Valor completo; sem centavos a partir de 10 mil (igual a tabela de Lojas). */
export function dinheiroCentavos(centavos: number, moeda: string): string {
  const v = centavos / 100;
  return formatarDinheiro(v, moeda || "BRL", Math.abs(v) >= 10_000 ? 0 : 2);
}

export function inteiro(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** A loja respondeu (a Shopify devolveu os pedidos dela)? */
export function respondeu(r: Pick<SalesRow, "problem">): boolean {
  return r.problem === null;
}

export interface ResumoVendas {
  /** Lojas que nao liberam os pedidos (conectadas antes da permissao). */
  negadas: SalesRow[];
  /** Lojas que nao responderam agora (erro da Shopify ou da conexao). */
  semResposta: SalesRow[];
  /** Moedas das lojas que venderam, sem repetir, na ordem da tabela. */
  moedas: string[];
  /** A moeda unica da tela, ou null quando ha mais de uma. */
  moeda: string | null;
  totalPedidos: number;
  /** Centavos, so com moeda unica; null quando ha mais de uma. */
  totalReceita: number | null;
  porMoeda: { moeda: string; centavos: number }[];
  /** % da receita por loja (storeId); null = nao da para dizer. */
  fatiaReceita: Record<string, number | null>;
  /** Maior receita do periodo (so com moeda unica e alguma venda). */
  lider: SalesRow | null;
  /** Ticket medio em centavos; null sem pedido ou com moedas misturadas. */
  ticket: number | null;
}

export function resumirVendas(rows: SalesRow[], moedaPadrao = "BRL"): ResumoVendas {
  const ok = rows.filter(respondeu);
  const moedas: string[] = [];
  const porMoeda = new Map<string, number>();
  for (const r of ok) {
    if (r.revenueCents <= 0) continue;
    if (!moedas.includes(r.currency)) moedas.push(r.currency);
    porMoeda.set(r.currency, (porMoeda.get(r.currency) ?? 0) + r.revenueCents);
  }

  const unica = moedas.length <= 1;
  const moeda = unica ? (moedas[0] ?? moedaPadrao) : null;
  const totalPedidos = ok.reduce((s, r) => s + r.orders, 0);
  const totalReceita = unica ? ok.reduce((s, r) => s + r.revenueCents, 0) : null;

  const fatiaReceita: Record<string, number | null> = {};
  if (totalReceita !== null && totalReceita > 0) {
    const fatias = repartirCem(ok.map((r) => r.revenueCents));
    ok.forEach((r, i) => (fatiaReceita[r.storeId] = fatias[i]));
  }
  for (const r of rows) if (!(r.storeId in fatiaReceita)) fatiaReceita[r.storeId] = null;

  const lider =
    totalReceita !== null && totalReceita > 0
      ? ok.reduce<SalesRow | null>((m, r) => (!m || r.revenueCents > m.revenueCents ? r : m), null)
      : null;

  return {
    negadas: rows.filter((r) => r.problem === "denied"),
    semResposta: rows.filter((r) => r.problem === "failed"),
    moedas,
    moeda,
    totalPedidos,
    totalReceita,
    porMoeda: moedas.map((m) => ({ moeda: m, centavos: porMoeda.get(m) ?? 0 })),
    fatiaReceita,
    lider,
    ticket: totalReceita !== null && totalPedidos > 0 ? Math.round(totalReceita / totalPedidos) : null,
  };
}

/** "R$ 12.300 · US$ 1.200,00": o total de cada moeda, quando ha mais de uma. */
export function textoPorMoeda(porMoeda: ResumoVendas["porMoeda"]): string {
  return porMoeda.map((p) => dinheiroCentavos(p.centavos, p.moeda)).join(" · ");
}

/** Lista de nomes para frase: "A", "A e B", "A, B e C". */
export function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Ticket de uma loja, em centavos; null sem pedido. */
export function ticketDaLoja(r: Pick<SalesRow, "orders" | "revenueCents">): number | null {
  return r.orders > 0 ? Math.round(r.revenueCents / r.orders) : null;
}

/**
 * A soma do % do trafego da tabela: 100 quando alguma loja recebe comprador,
 * 0 quando todas estao pausadas (dai o rodape mostra "—").
 */
export function somaTrafego(rows: Pick<SalesRow, "trafficPercent">[]): number {
  return rows.reduce((s, r) => s + r.trafficPercent, 0);
}
