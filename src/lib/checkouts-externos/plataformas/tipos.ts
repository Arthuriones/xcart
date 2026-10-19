import type { Utm } from "@/lib/tracking/utm";
import type { IdPlataformaCheckout, ModeloCheckout, SituacaoExterna } from "../tipos";

// ============================================================================
// O contrato de um adaptador de plataforma de checkout. Cada plataforma
// traduz o corpo do webhook dela para o EventoNormalizado; o resto (trava de
// idempotencia, ordem dos eventos, gravacao, Dashboard) e um so.
//
// Puro: sem banco, sem rede. Testado em tests/checkout-externo-sphere.test.ts
// e tests/checkout-externo-cakto.test.ts.
// ============================================================================

/** A venda propria (modelo "venda", Cakto). Ausente na Sphere. */
export interface VendaNormalizada {
  /** Taxa da plataforma (fees). null = nao veio. */
  taxa: number | null;
  /** Afiliado e coprodutor: faturamento - taxa - liquido, quando passa de 0,01. */
  comissoes: number | null;
  /** O id curto do painel (refId). */
  referencia: string | null;
  /** A cobranca: o refId do principal (o parent_order do order bump e do upsell). */
  grupo: string | null;
  /** O id do produto na plataforma (o `contents` da compra no Meta e no TikTok). */
  produtoId: string | null;
  ofertaTipo: "main" | "orderbump" | "upsell" | "downsell" | null;
  /** Pix/boleto: ate quando pode ser pago (ISO). */
  venceEm: string | null;
  reembolsadoEm: string | null;
  chargebackEm: string | null;
  /** refund_requested: a venda segue paga, "em risco". */
  reembolsoPedidoEm: string | null;
}

/**
 * O que a plataforma manda para atribuicao. As UTMs vao para o pedido (as
 * regras de src/lib/tracking/utm.ts); o resto fica so em memoria: e o que a
 * compra pelo servidor leva ao Meta e ao TikTok (compra.ts).
 */
export interface RastreioNormalizado {
  utm: Utm;
  sck: string | null;
  callback: string | null;
  fbc: string | null;
  fbp: string | null;
  /** Os click ids da query com que o comprador abriu o checkout (so eles, nunca o resto da query). */
  fbclid: string | null;
  ttclid: string | null;
  /** Origem e caminho, SEM a query (o pre-preenchimento do checkout leva nome e e-mail na URL). */
  checkoutUrl: string | null;
}

/**
 * O comprador, SO EM MEMORIA: para o hash do envio pelo servidor (fase
 * seguinte). Nunca vai para pedidos_externos, para o evento nem para log --
 * tests/checkout-externo-cakto.test.ts trava. CPF nem e lido.
 */
export interface CompradorNormalizado {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  pais: string | null;
  estado: string | null;
  cidade: string | null;
  cep: string | null;
}

export interface EventoNormalizado {
  /** Como a plataforma chama ("pedido.criado", "purchase_approved"...). */
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
    /** ISO 4217, maiusculo. "" = a plataforma nao disse (vale a do checkout). */
    moeda: string;
    /** Total do pedido, na moeda do pedido. Na venda, o faturamento. */
    valor: number;
    criadoEm: string;
  };
  /** O que o lojista recebe: a comissao liquida (afiliado) ou o liquido da venda. */
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
  /** O evento de teste (do xcart ou da plataforma): nunca vira pedido. */
  teste: boolean;
  venda?: VendaNormalizada;
  rastreio?: RastreioNormalizado;
  comprador?: CompradorNormalizado;
}

export type Leitura = { ok: true; evento: EventoNormalizado } | { ok: false; erro: string };

/**
 * Uma entrega com varios pedidos (a V2 da Cakto manda principal, order bump
 * e upsell juntos), ou nenhum: `ignorado` = evento que nao vira pedido
 * (abandono, assinatura) e responde 200.
 */
export type LeituraVarios = { ok: true; eventos: EventoNormalizado[]; ignorado?: string } | { ok: false; erro: string };

export type Autenticacao = { ok: true } | { ok: false; erro: string; semSegredo?: boolean };

export interface PlataformaCheckout {
  id: IdPlataformaCheckout;
  nome: string;
  /** comissao = afiliado (Sphere); venda = checkout do vendedor (Cakto). */
  modelo: ModeloCheckout;
  /** Sphere: a URL e o segredo. Cakto: a URL acha o checkout e o HMAC prova a origem. */
  autenticacao: "token_na_url" | "hmac_header";
  /**
   * Quando a plataforma manda de novo. "status": responde 503 e ela tenta
   * (Sphere). "timeout": so erro de rede ou timeout volta sozinho (Cakto) --
   * falha nossa segura a resposta ate o timeout dela.
   */
  reenvio: "status" | "timeout";
  /** Os gatilhos a marcar no painel da plataforma. */
  gatilhos: readonly string[];
  /** O evento que e "venda" no celular: "pedido.criado" (Sphere), "purchase_approved" (Cakto). */
  eventoDeVenda: string;
  /** O corpo ja em JSON. `agora` limita as datas aceitas. */
  ler(corpo: unknown, agora: Date): Leitura;
  /** Varios pedidos numa entrega. Ausente = `ler` (um pedido). */
  lerTodos?(corpo: unknown, agora: Date): LeituraVarios;
  /**
   * Confere a origem com o corpo CRU (byte a byte) e os headers. Ausente = a
   * URL basta (Sphere). `segredo` = o secret salvo da plataforma.
   */
  autenticar?(raw: string | Uint8Array, headers: Headers, segredo: string | null, agora: Date): Autenticacao;
  /** Os headers da assinatura, para o "Enviar evento de teste" passar pelo autenticar. */
  assinar?(raw: string, segredo: string, agora: Date): Record<string, string>;
  /** Corpo de exemplo, marcado como teste: o "Enviar evento de teste". */
  exemplo(agora: Date, segredo?: string | null): unknown;
}
