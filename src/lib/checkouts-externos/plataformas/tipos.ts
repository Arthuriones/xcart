import type { Utm } from "@/lib/tracking/utm";
import type { IdPlataformaCheckout, ModeloCheckout, SituacaoExterna } from "../tipos";

// ============================================================================
// O contrato de um adaptador de plataforma de checkout. Cada plataforma
// traduz o corpo do webhook dela para o EventoNormalizado; o resto (trava de
// idempotencia, ordem dos eventos, gravacao, Dashboard) e um so.
//
// Puro: sem banco, sem rede. Testado em tests/checkout-externo-sphere.test.ts,
// tests/checkout-externo-cakto.test.ts, tests/checkout-externo-hubla.test.ts
// e tests/checkout-externo-eve.test.ts.
// ============================================================================

/** A venda propria (modelo "venda": Cakto, Hubla). Ausente na Sphere. */
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
  /**
   * A cobranca que se paga depois (Pix/boleto) acabou de nascer: a "gerada" da
   * compra pelo servidor (compra.ts). Ausente = pelo nome do evento (`*_gerado`
   * da Cakto). A Hubla tem um invoice.created so, para todo metodo.
   */
  cobrancaGerada?: boolean;
  /**
   * Renovacao, upgrade ou parcela 2+ (Hubla): entra no lucro, mas nao vai ao
   * Meta/TikTok -- nao tem clique de anuncio.
   */
  recorrencia?: boolean;
  /**
   * O item entra no lucro e na cobranca, mas nao manda a compra ao Meta/TikTok
   * sozinho: o order bump da Hotmart chega em aviso proprio, e a compra sai
   * com a principal (o bump que chegasse antes levaria o valor dele).
   */
  semCompra?: boolean;
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
  /**
   * Os click ids da query com que o comprador abriu o checkout (so eles, nunca
   * o resto da query) e, sem eles, o que a Utmify grudou no utm_content.
   */
  fbclid: string | null;
  ttclid: string | null;
  /** Origem e caminho, SEM a query (o pre-preenchimento do checkout leva nome e e-mail na URL). */
  checkoutUrl: string | null;
  /**
   * O vid da ponte (Fase D) que veio na QUERY do checkoutUrl
   * (`callback=xc.<vid>` ou `sck=xc.<vid>`), ja sem o "xc.". So ele: o resto
   * da query nao sai daqui. compra.ts o usa quando o campo `callback` falta.
   */
  vidNaUrl: string | null;
  /**
   * A sessao do pagamento (Hubla: paymentSession). Sem eles, so os da
   * identidade da ponte (Fase D). Vao em claro para o Meta e o TikTok, como os
   * da identidade.
   */
  ip?: string | null;
  userAgent?: string | null;
  ttp?: string | null;
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
  /**
   * Envio do historico (o Eve manda os pedidos de antes da conexao): grava o
   * pedido, mas nao avisa o celular nem manda a compra ao Meta/TikTok -- a
   * venda e velha e a pagina ja mandou o pixel dela.
   */
  semAviso?: boolean;
  venda?: VendaNormalizada;
  rastreio?: RastreioNormalizado;
  comprador?: CompradorNormalizado;
}

export type Leitura = { ok: true; evento: EventoNormalizado } | { ok: false; erro: string };

/**
 * Uma entrega com varios pedidos (a V2 da Cakto manda principal, order bump
 * e upsell juntos), ou nenhum: `ignorado` = evento que nao vira pedido
 * (abandono, assinatura, o status_updated da Hubla que repete um evento
 * proprio) e responde 200.
 */
export type LeituraVarios = { ok: true; eventos: EventoNormalizado[]; ignorado?: string } | { ok: false; erro: string };

export type Autenticacao = { ok: true } | { ok: false; erro: string; semSegredo?: boolean };

export interface PlataformaCheckout {
  id: IdPlataformaCheckout;
  nome: string;
  /** comissao = afiliado (Sphere); venda = checkout do vendedor (Cakto). */
  modelo: ModeloCheckout;
  /**
   * Sphere: a URL e o segredo. Cakto: a URL acha o checkout e o HMAC prova a
   * origem. Hubla: a URL acha o checkout e o token fixo do header prova.
   */
  autenticacao: "token_na_url" | "hmac_header" | "token_no_header";
  /**
   * Quando a plataforma manda de novo. "status": responde 503 e ela tenta
   * (Sphere, Hubla). "timeout": so erro de rede ou timeout volta sozinho (Cakto) --
   * falha nossa segura a resposta ate o timeout dela.
   */
  reenvio: "status" | "timeout";
  /**
   * As frases do reenvio no erro da tela, quando nao sao as da Cakto/Hubla
   * (Eve: a fila de jobs dela). `automatico` completa "A <nome> ..." (so no
   * reenvio "status"); `manual` completa "se o erro ficar, ...". Ausente = a
   * frase da Hubla (token no header) ou da Cakto.
   */
  reenvioNaTela?: { automatico: string; manual: string };
  /** Os gatilhos a marcar no painel da plataforma. */
  gatilhos: readonly string[];
  /** O evento que e "venda" no celular: "pedido.criado" (Sphere), "purchase_approved" (Cakto), "invoice.payment_succeeded" (Hubla), "pedido.pago" (Eve). */
  eventoDeVenda: string;
  /**
   * O corpo ja em JSON. `agora` limita as datas aceitas. `headers` = os da
   * entrega (a Hubla marca o teste so no header x-hubla-sandbox).
   */
  ler(corpo: unknown, agora: Date, headers?: Headers): Leitura;
  /** Varios pedidos numa entrega, ou nenhum (`ignorado`). Ausente = `ler` (um pedido). */
  lerTodos?(corpo: unknown, agora: Date, headers?: Headers): LeituraVarios;
  /**
   * Confere a origem com o corpo CRU (byte a byte) e os headers. Ausente = a
   * URL basta (Sphere). `segredo` = o secret salvo da plataforma.
   */
  autenticar?(raw: string | Uint8Array, headers: Headers, segredo: string | null, agora: Date): Autenticacao;
  /** Os headers da assinatura, para o "Enviar evento de teste" passar pelo autenticar. */
  assinar?(raw: string, segredo: string, agora: Date): Record<string, string>;
  /** Corpo de exemplo, marcado como teste: o "Enviar evento de teste". */
  exemplo(agora: Date, segredo?: string | null): unknown;
  /**
   * O formato do aviso real, guardado em checkouts_externos.ultimo_formato
   * (085): so caminhos de chave e o valor das chaves de clique, nunca dado do
   * comprador. Ausente = nada guardado (a plataforma ja tem o formato conhecido).
   */
  formato?(corpo: unknown, agora: Date): unknown;
}
