import { criarConversor } from "@/lib/financeiro/calculo";
import { diaNoFuso, paraNumero, type FxRateRow, type Intervalo } from "@/lib/financeiro/tipos";
import { quandoCurto } from "@/lib/leitura/pedidos";
import { nomeDe } from "@/lib/tracking/utm";
import {
  ROTULO_SITUACAO_EXTERNA,
  situacaoPerdida,
  situacaoRecebida,
  type ModeloCheckout,
  type PedidoExternoRow,
  type SituacaoExterna,
} from "./tipos";
import {
  ROTULO_ESTADO_VENDA,
  TOM_ESTADO_VENDA,
  chaveDaCobranca,
  estadoDaVenda,
  rotuloDoMetodo,
  vendaPerdida,
  vendaRecebida,
  type EstadoVenda,
} from "./venda";

// ============================================================================
// A tela Pedidos de um checkout externo: uma linha por pedido. Puro: a
// leitura e src/lib/leitura/pedidos-externos.ts, o teste e
// tests/financeiro-checkout-externo.test.ts (comissao) e
// tests/checkout-externo-cakto.test.ts (venda).
//
// Comissao (Sphere): produto, pais, valor do pedido, comissao, situacao e
// campanha/anuncio (do postback, 086). A
// comissao vai para a moeda do relatorio pela cotacao do dia do pedido (a
// mesma do Dashboard); o valor do pedido fica na moeda dele, so referencia.
//
// Venda (Cakto): metodo, valor, taxa, liquido, situacao e campanha/anuncio,
// tudo na moeda do relatorio. O resumo conta a COBRANCA (order bump e
// upsell entram no pedido do principal), como o Dashboard.
// ============================================================================

export type TomSituacao = "ok" | "warn" | "err" | "info" | "neutral";

/** Os tons do contra entrega (TOM_COD em src/lib/leitura/pedidos.ts). */
export const TOM_SITUACAO_EXTERNA: Record<SituacaoExterna, TomSituacao> = {
  pendente: "info",
  aprovado: "ok",
  pago: "ok",
  expirado: "err",
  revertido: "err",
};

export interface CheckoutDaTela {
  id: string;
  nome: string;
  fuso: string;
  moeda_receita: string;
  /** Ausente = comissao (o modelo da 069). */
  modelo?: ModeloCheckout;
}

export interface PedidoExternoTela {
  chave: string;
  pedido: string;
  checkout: string;
  quando: string;
  /** Para ordenar: o instante do pedido. */
  criadoEm: string;
  produto: string | null;
  pais: string | null;
  valor: number;
  moedaPedido: string;
  /** A receita na moeda do relatorio: a comissao (Sphere) ou o liquido (venda). null = sem cotacao. */
  comissao: number | null;
  comissaoOriginal: number;
  moedaComissao: string;
  situacao: SituacaoExterna;
  rotulo: string;
  tom: TomSituacao;
  modelo: ModeloCheckout;
  // --- Venda: na moeda do relatorio; null na comissao ou sem cotacao ---
  /** "Pix", "Cartão"... */
  metodo: string | null;
  valorRelatorio: number | null;
  taxa: number | null;
  comissoes: number | null;
  estado: EstadoVenda | null;
  /** O nome (formato "nome|id") ou o id da campanha e do anuncio. */
  campanha: string | null;
  anuncio: string | null;
  /** "orderbump", "upsell"... null no principal. */
  oferta: string | null;
}

export interface ResumoPedidosExternos {
  pedidos: number;
  recebido: number;
  aReceber: number;
  perdido: number;
  pendentes: number;
  perdidos: number;
  /** Pedidos cuja comissao ficou fora da soma (moeda sem cotacao). */
  semCotacao: number;
  cambioAproximado: boolean;
  /** Venda: faturamento e taxa (com as comissoes) dos pagos. 0 sem venda. */
  faturamento: number;
  taxas: number;
}

const ROTULO_OFERTA: Record<string, string> = {
  orderbump: "order bump",
  upsell: "upsell",
  downsell: "downsell",
};

export function montarPedidosExternos(e: {
  pedidos: PedidoExternoRow[];
  checkouts: CheckoutDaTela[];
  cambio: FxRateRow[];
  moeda: string;
  intervalo: Intervalo;
  agoraMs: number;
}): { linhas: PedidoExternoTela[]; resumo: ResumoPedidosExternos } {
  const converter = criarConversor(e.cambio);
  const porId = new Map(e.checkouts.map((c) => [c.id, c]));
  const resumo: ResumoPedidosExternos = {
    pedidos: 0,
    recebido: 0,
    aReceber: 0,
    perdido: 0,
    pendentes: 0,
    perdidos: 0,
    semCotacao: 0,
    cambioAproximado: false,
    faturamento: 0,
    taxas: 0,
  };
  // Venda: cada cobranca conta uma vez em cada contador.
  const contadas = new Map<string, Set<string>>();
  const primeira = (contador: string, chave: string): number => {
    let s = contadas.get(contador);
    if (!s) contadas.set(contador, (s = new Set()));
    if (s.has(chave)) return 0;
    s.add(chave);
    return 1;
  };

  const linhas: PedidoExternoTela[] = [];
  for (const p of e.pedidos) {
    const ck = porId.get(p.checkout_id);
    if (!ck) continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < e.intervalo.desde || dia > e.intervalo.ate) continue;
    const modelo: ModeloCheckout = ck.modelo ?? "comissao";
    const hoje = diaNoFuso(new Date(e.agoraMs), ck.fuso);

    if (modelo === "venda") {
      const moedaVenda = String(p.moeda_receita || p.moeda || ck.moeda_receita || "BRL").toUpperCase();
      const fator = converter(1, moedaVenda, e.moeda, dia);
      if (fator?.aproximado) resumo.cambioAproximado = true;
      const k = fator ? fator.valor : null;
      const valor = paraNumero(p.valor);
      const liquido = paraNumero(p.receita);
      const taxa = p.taxa === null || p.taxa === undefined ? null : paraNumero(p.taxa);
      const comissoes = p.comissoes === null || p.comissoes === undefined ? null : paraNumero(p.comissoes);
      const estado = estadoDaVenda(p, e.agoraMs);
      const chave = chaveDaCobranca(p);

      resumo.pedidos += primeira("pedidos", chave);
      if (k === null) resumo.semCotacao += 1;
      else if (vendaRecebida(estado)) {
        resumo.recebido += liquido * k;
        resumo.faturamento += Math.max(valor, liquido) * k;
        resumo.taxas += Math.max(0, valor - liquido) * k;
      } else if (vendaPerdida(estado)) resumo.perdido += liquido * k;
      else resumo.aReceber += liquido * k;
      if (estado === "aguardando") resumo.pendentes += primeira("pendentes", chave);
      if (vendaPerdida(estado)) resumo.perdidos += primeira("perdidos", chave);

      linhas.push({
        chave: `${p.checkout_id}:${p.pedido_id}`,
        pedido: `#${p.referencia || p.pedido_id}`,
        checkout: ck.nome,
        quando: quandoCurto(p.criado_em, ck.fuso, hoje),
        criadoEm: p.criado_em,
        produto: p.produto,
        pais: p.pais,
        valor,
        moedaPedido: moedaVenda,
        comissao: k === null ? null : liquido * k,
        comissaoOriginal: liquido,
        moedaComissao: moedaVenda,
        situacao: p.situacao,
        rotulo: ROTULO_ESTADO_VENDA[estado],
        tom: TOM_ESTADO_VENDA[estado],
        modelo,
        metodo: p.metodo_pagamento ? rotuloDoMetodo(p.metodo_pagamento) : null,
        valorRelatorio: k === null ? null : valor * k,
        taxa: k === null || taxa === null ? null : taxa * k,
        comissoes: k === null || !comissoes ? null : comissoes * k,
        estado,
        campanha: nomeDe(p.utm_campaign) ?? p.campanha_id ?? null,
        anuncio: nomeDe(p.utm_content) ?? p.anuncio_id ?? null,
        oferta: (p.oferta_tipo && ROTULO_OFERTA[p.oferta_tipo]) || null,
      });
      continue;
    }

    const moedaComissao = String(p.moeda_receita || ck.moeda_receita || "EUR").toUpperCase();
    const original = paraNumero(p.receita);
    const c = converter(original, moedaComissao, e.moeda, dia);
    if (c?.aproximado) resumo.cambioAproximado = true;
    const comissao = c ? c.valor : null;

    resumo.pedidos += 1;
    if (comissao === null) resumo.semCotacao += 1;
    else if (situacaoRecebida(p.situacao)) resumo.recebido += comissao;
    else if (situacaoPerdida(p.situacao)) resumo.perdido += comissao;
    else resumo.aReceber += comissao;
    if (p.situacao === "pendente") resumo.pendentes += 1;
    if (situacaoPerdida(p.situacao)) resumo.perdidos += 1;

    linhas.push({
      chave: `${p.checkout_id}:${p.pedido_id}`,
      pedido: `#${p.pedido_id}`,
      checkout: ck.nome,
      quando: quandoCurto(p.criado_em, ck.fuso, hoje),
      criadoEm: p.criado_em,
      produto: p.produto,
      pais: p.pais,
      valor: paraNumero(p.valor),
      moedaPedido: String(p.moeda || "").toUpperCase(),
      comissao,
      comissaoOriginal: original,
      moedaComissao,
      situacao: p.situacao,
      rotulo: ROTULO_SITUACAO_EXTERNA[p.situacao] ?? p.situacao,
      tom: TOM_SITUACAO_EXTERNA[p.situacao] ?? "neutral",
      modelo,
      metodo: null,
      valorRelatorio: null,
      taxa: null,
      comissoes: null,
      estado: null,
      // O postback da Sphere (086) poe a origem: nome do anuncio quando a
      // sincronizacao do Meta o conhecia, senao o id.
      campanha: nomeDe(p.utm_campaign) ?? p.campanha_id ?? null,
      anuncio: nomeDe(p.utm_content) ?? p.anuncio_id ?? null,
      oferta: null,
    });
  }
  linhas.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));
  return { linhas, resumo };
}
