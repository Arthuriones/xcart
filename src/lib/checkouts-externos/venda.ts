import type { SituacaoExterna } from "./tipos";

// ============================================================================
// O modelo VENDA do checkout externo (Cakto, 072): o lojista e o produtor.
//
//   valor     = faturamento (baseAmount - discount; a taxa que o comprador
//               paga a Cakto fica fora)
//   receita   = o liquido do produtor: o que entra no bolso, como a comissao
//               da Sphere -- toda soma de "receita" que ja existe segue certa
//   taxa      = a taxa da Cakto; comissoes = afiliado e coprodutor
//
// Situacao do pedido (estado.ts, a mesma ordem da Sphere):
//   pendente  = Pix/boleto gerado. A Cakto NAO avisa quando vence: passou do
//               vence_em (mais a folga do metodo), conta como perdido. Sem
//               vence_em, a janela padrao do metodo.
//   pago      = aprovado. Com reembolso_pedido_em, "em risco".
//   expirado  = recusado ou cancelado. O Pix/boleto que a Hubla avisa que
//               venceu (status "overdue") e vencida, como o pendente vencido.
//   revertido = reembolso ou chargeback (pela data que veio).
//
// O pedido do Dashboard e a COBRANCA (grupo), nao o item: order bump e
// upsell entram no pedido do principal -- senao o CPA caia pela metade.
//
// Puro e importado pelo cliente: testado em tests/checkout-externo-cakto.test.ts.
// ============================================================================

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** Sem vence_em: quanto o Pix e o boleto costumam valer na Cakto. */
export const VENCIMENTO_PADRAO_MS: Record<string, number> = {
  pix: DIA_MS,
  pix_auto: DIA_MS,
  picpay: DIA_MS,
  openfinance_nubank: DIA_MS,
  boleto: 3 * DIA_MS,
};
const VENCIMENTO_OUTROS_MS = 2 * DIA_MS;

/** Boleto pago no ultimo dia compensa em ate 3 dias uteis: so depois disso e perdido. */
export const FOLGA_MS: Record<string, number> = { boleto: 4 * DIA_MS };

export type EstadoVenda = "aguardando" | "vencida" | "paga" | "em_risco" | "recusada" | "reembolsada" | "chargeback";

export const ROTULO_ESTADO_VENDA: Record<EstadoVenda, string> = {
  aguardando: "Aguardando pagamento",
  vencida: "Vencida",
  paga: "Paga",
  em_risco: "Reembolso pedido",
  recusada: "Recusada",
  reembolsada: "Reembolsada",
  chargeback: "Chargeback",
};

export const TOM_ESTADO_VENDA: Record<EstadoVenda, "ok" | "warn" | "err" | "info" | "neutral"> = {
  aguardando: "info",
  vencida: "neutral",
  paga: "ok",
  em_risco: "warn",
  recusada: "err",
  reembolsada: "err",
  chargeback: "err",
};

/** O que as regras leem de um pedido (pedidos_externos). */
export interface PedidoDeVenda {
  situacao: SituacaoExterna;
  criado_em?: string | null;
  metodo_pagamento?: string | null;
  vence_em?: string | null;
  reembolsado_em?: string | null;
  chargeback_em?: string | null;
  reembolso_pedido_em?: string | null;
  /** O status da plataforma (Hubla "overdue", Eve "expired": a cobranca venceu). */
  status_comissao?: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : null;
}

function chaveDoMetodo(metodo: string | null | undefined): string {
  return String(metodo || "").trim().toLowerCase();
}

/** Ate quando o pendente ainda pode ser pago (ms), ja com a folga. null = sem data nenhuma. */
export function limiteDoPendente(p: PedidoDeVenda): number | null {
  const metodo = chaveDoMetodo(p.metodo_pagamento);
  const folga = FOLGA_MS[metodo] ?? 0;
  const vence = ms(p.vence_em);
  if (vence !== null) return vence + folga;
  const criado = ms(p.criado_em);
  if (criado === null) return null;
  return criado + (VENCIMENTO_PADRAO_MS[metodo] ?? VENCIMENTO_OUTROS_MS) + folga;
}

/** Pendente que passou do limite: a venda nao veio. */
export function pendenteVencida(p: PedidoDeVenda, agoraMs: number): boolean {
  if (p.situacao !== "pendente") return false;
  const limite = limiteDoPendente(p);
  return limite !== null && agoraMs > limite;
}

export function estadoDaVenda(p: PedidoDeVenda, agoraMs: number): EstadoVenda {
  switch (p.situacao) {
    case "pendente":
      return pendenteVencida(p, agoraMs) ? "vencida" : "aguardando";
    case "aprovado":
    case "pago":
      return p.reembolso_pedido_em ? "em_risco" : "paga";
    case "expirado": {
      // A Hubla ("overdue") e o Eve ("expired") avisam o vencimento: o
      // Pix/boleto que nao foi pago venceu, nao foi recusado. O cartao que
      // falhou e o Pix cancelado seguem recusados.
      const metodo = chaveDoMetodo(p.metodo_pagamento);
      const status = String(p.status_comissao || "").toLowerCase();
      const venceu = (status === "overdue" || status === "expired") && (metodo === "pix" || metodo === "boleto");
      return venceu ? "vencida" : "recusada";
    }
    case "revertido": {
      // Chargeback vence o reembolso quando os dois vieram: e o que custa mais.
      return p.chargeback_em ? "chargeback" : "reembolsada";
    }
  }
}

/** O que ja e do lojista: paga, inclusive com reembolso pedido (ainda e dele). */
export function vendaRecebida(e: EstadoVenda): boolean {
  return e === "paga" || e === "em_risco";
}

/** O que nao vem mais: vencida, recusada, reembolsada, chargeback. */
export function vendaPerdida(e: EstadoVenda): boolean {
  return e === "vencida" || e === "recusada" || e === "reembolsada" || e === "chargeback";
}

/** A chave da cobranca: o grupo (refId do principal) ou, sem ele, o proprio pedido. */
export function chaveDaCobranca(p: { checkout_id: string; grupo?: string | null; pedido_id?: string | null }): string {
  return `${p.checkout_id}\u0000${p.grupo || p.pedido_id || ""}`;
}

/** "pix" -> "Pix", "credit_card" -> "Cartão". O desconhecido fica como veio. */
export function rotuloDoMetodo(metodo: string | null | undefined): string {
  const m = chaveDoMetodo(metodo);
  if (!m) return "—";
  if (m === "pix" || m === "pix_auto") return "Pix";
  if (m === "boleto") return "Boleto";
  if (m === "credit_card" || m === "threeds" || m === "card") return "Cartão";
  if (m === "debit_card") return "Débito";
  if (m === "picpay") return "PicPay";
  if (m.startsWith("openfinance")) return "Open Finance";
  if (m === "applepay") return "Apple Pay";
  if (m === "googlepay") return "Google Pay";
  return String(metodo).slice(0, 40);
}

/** "Pix gerado", "Boleto gerado": o titulo do aviso de cobranca gerada. */
export function rotuloDaCobranca(metodo: string | null | undefined): string {
  const m = chaveDoMetodo(metodo);
  if (m === "pix" || m === "pix_auto") return "Pix gerado";
  if (m === "boleto") return "Boleto gerado";
  return "Cobrança gerada";
}
