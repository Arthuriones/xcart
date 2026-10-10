import type { IdPlataformaCheckout, SituacaoExterna } from "../tipos";

// ============================================================================
// O contrato de um adaptador de plataforma de checkout. Cada plataforma
// traduz o corpo do webhook dela para o EventoNormalizado; o resto (trava de
// idempotencia, ordem dos eventos, gravacao, Dashboard) e um so.
//
// Puro: sem banco, sem rede. Testado em tests/checkout-externo-sphere.test.ts.
// ============================================================================

export interface EventoNormalizado {
  /** Como a plataforma chama ("pedido.criado", "comissao.aprovada"...). */
  evento: string;
  /** ISO 8601 (UTC). A ordem dos eventos do mesmo pedido sai daqui. */
  dataEvento: string;
  /** Id do pedido na plataforma. */
  pedidoId: string;
  pedido: {
    status: string | null;
    metodo: string | null;
    produto: string | null;
    /** ISO 3166-1 alfa-2, maiusculo. */
    pais: string | null;
    /** ISO 4217, maiusculo. */
    moeda: string;
    /** Total do pedido, na moeda do pedido. */
    valor: number;
    criadoEm: string;
  };
  /** O que o lojista recebe: a comissao liquida (afiliado) ou a venda. */
  receita: {
    valor: number;
    /** null = a plataforma nao diz (vale a moeda do checkout). */
    moeda: string | null;
    situacao: SituacaoExterna;
    statusOriginal: string | null;
  };
  /** A conta do lojista na plataforma (codigo de afiliado). */
  conta: string | null;
  programa: string | null;
  /** O evento de teste do xcart: nunca vira pedido. */
  teste: boolean;
}

export type Leitura = { ok: true; evento: EventoNormalizado } | { ok: false; erro: string };

export interface PlataformaCheckout {
  id: IdPlataformaCheckout;
  nome: string;
  /** comissao = afiliado (Sphere); venda = checkout do vendedor (Yampi...). */
  modelo: "comissao" | "venda";
  /** Sphere: a URL e o segredo. As de vendedor devem ter HMAC no header. */
  autenticacao: "token_na_url" | "hmac_header";
  /** Os gatilhos a marcar no painel da plataforma. */
  gatilhos: readonly string[];
  /** O corpo ja em JSON. `agora` limita as datas aceitas. */
  ler(corpo: unknown, agora: Date): Leitura;
  /** Corpo de exemplo, marcado como teste: o "Enviar evento de teste". */
  exemplo(agora: Date): unknown;
}
