import { criarConversor } from "@/lib/financeiro/calculo";
import { diaNoFuso, paraNumero, type FxRateRow, type Intervalo } from "@/lib/financeiro/tipos";
import { quandoCurto } from "@/lib/leitura/pedidos";
import {
  ROTULO_SITUACAO_EXTERNA,
  situacaoPerdida,
  situacaoRecebida,
  type PedidoExternoRow,
  type SituacaoExterna,
} from "./tipos";

// ============================================================================
// A tela Pedidos de um checkout externo: uma linha por pedido, com produto,
// pais, valor do pedido, comissao e situacao. Puro: a leitura e
// src/lib/leitura/pedidos-externos.ts, o teste e
// tests/financeiro-checkout-externo.test.ts.
//
// A comissao vai para a moeda do relatorio pela cotacao do dia do pedido (a
// mesma do Dashboard). O valor do pedido fica na moeda dele: e so referencia.
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
  /** Comissao na moeda do relatorio. null = sem cotacao. */
  comissao: number | null;
  comissaoOriginal: number;
  moedaComissao: string;
  situacao: SituacaoExterna;
  rotulo: string;
  tom: TomSituacao;
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
}

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
  };
  const linhas: PedidoExternoTela[] = [];
  for (const p of e.pedidos) {
    const ck = porId.get(p.checkout_id);
    if (!ck) continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < e.intervalo.desde || dia > e.intervalo.ate) continue;

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

    const hoje = diaNoFuso(new Date(e.agoraMs), ck.fuso);
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
    });
  }
  linhas.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));
  return { linhas, resumo };
}

