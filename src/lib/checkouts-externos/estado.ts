import { diaNoFuso } from "@/lib/financeiro/tipos";
import { niveisDoAnuncio, plataformaDe as plataformaDaOrigem } from "@/lib/tracking/utm";
import type { EventoNormalizado } from "./plataformas/tipos";
import type { SituacaoExterna } from "./tipos";

// ============================================================================
// O estado de um pedido externo a partir dos eventos, em qualquer ordem.
//
// A plataforma manda cada movimentacao uma vez, com 1 retentativa -- e nada
// garante a ordem de chegada. Entao o pedido guarda o ULTIMO estado e cada
// evento passa por aplicarEvento(atual, novo):
//
//   1. Evento mais velho que o ultimo aplicado (data_evento) nao muda a
//      situacao -- a retentativa atrasada nao desfaz o que ja andou. Mas ele
//      ainda preenche o que faltava (a data de aprovacao, o produto).
//   2. Nunca volta para "pendente": pendente e so o comeco.
//   3. Pago nunca volta para aprovado (pago ja foi aprovado).
//   4. No mesmo instante, vence a ordem pendente < aprovado < pago <
//      expirado < revertido.
//   5. Qualquer evento cria o pedido com todos os campos: se o pedido.criado
//      se perdeu, a comissao.aprovada cria o pedido.
//
// Venda (Cakto, 072): as datas da venda (vencimento, reembolso, chargeback,
// reembolso pedido) seguem a regra das datas de etapa -- a primeira que veio
// fica, venca o evento ou nao. Grupo, oferta, referencia e UTMs sao da
// cobranca: o primeiro que trouxe fica. Na Sphere sao todas null.
//
// Puro: testado em tests/checkout-externo-estado.test.ts e
// tests/checkout-externo-cakto.test.ts.
// ============================================================================

const ORDEM: Record<SituacaoExterna, number> = {
  pendente: 0,
  aprovado: 1,
  pago: 2,
  expirado: 3,
  revertido: 4,
};

/** O pedido como a tabela guarda (pedidos_externos), sem chaves nem versao. */
export interface EstadoPedido {
  situacao: SituacaoExterna;
  status_comissao: string | null;
  status_pedido: string | null;
  metodo_pagamento: string | null;
  produto: string | null;
  pais: string | null;
  programa: string | null;
  moeda: string;
  valor: number;
  receita: number;
  moeda_receita: string | null;
  criado_em: string;
  dia_local: string;
  aprovado_em: string | null;
  pago_em: string | null;
  perdido_em: string | null;
  atualizado_em: string;
  // --- Venda (072): null na Sphere ---
  referencia: string | null;
  taxa: number | null;
  comissoes: number | null;
  grupo: string | null;
  oferta_tipo: string | null;
  vence_em: string | null;
  reembolsado_em: string | null;
  chargeback_em: string | null;
  reembolso_pedido_em: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campanha_id: string | null;
  conjunto_id: string | null;
  anuncio_id: string | null;
}

/** As colunas da venda: a repo so as grava no modelo venda (sem a 072, a Sphere segue gravando). */
export const CAMPOS_VENDA = [
  "referencia",
  "taxa",
  "comissoes",
  "grupo",
  "oferta_tipo",
  "vence_em",
  "reembolsado_em",
  "chargeback_em",
  "reembolso_pedido_em",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campanha_id",
  "conjunto_id",
  "anuncio_id",
] as const satisfies readonly (keyof EstadoPedido)[];

const CAMPOS_UTM = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campanha_id",
  "conjunto_id",
  "anuncio_id",
] as const satisfies readonly (keyof EstadoPedido)[];

/** O dia do pedido no fuso do checkout: o periodo do Dashboard le por ele. */
export function diaDoPedido(criadoEm: string, fuso: string | null | undefined): string {
  return diaNoFuso(new Date(criadoEm), fuso || "UTC");
}

/** As datas de cada etapa que este evento prova. */
function marcos(s: SituacaoExterna, quando: string) {
  return {
    aprovado_em: s === "aprovado" || s === "pago" ? quando : null,
    pago_em: s === "pago" ? quando : null,
    perdido_em: s === "expirado" || s === "revertido" ? quando : null,
  };
}

/** A data mais antiga das duas (a primeira vez que a etapa aconteceu). */
function primeira(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** As UTMs e os ids do anuncio, pelas regras de src/lib/tracking/utm.ts. */
function utmDoEvento(ev: EventoNormalizado) {
  const utm = ev.rastreio?.utm ?? {};
  const niveis = niveisDoAnuncio(utm, plataformaDaOrigem(utm, ev.rastreio?.fbc ? { fbc: ev.rastreio.fbc } : null));
  return {
    utm_source: utm.source ?? null,
    utm_medium: utm.medium ?? null,
    utm_campaign: utm.campaign ?? null,
    utm_content: utm.content ?? null,
    utm_term: utm.term ?? null,
    campanha_id: niveis.campanha,
    conjunto_id: niveis.conjunto,
    anuncio_id: niveis.anuncio,
  };
}

/** O pedido novo, so com este evento. */
export function pedidoDoEvento(ev: EventoNormalizado, fuso: string | null | undefined): EstadoPedido {
  const v = ev.venda;
  return {
    situacao: ev.receita.situacao,
    status_comissao: ev.receita.statusOriginal,
    status_pedido: ev.pedido.status,
    metodo_pagamento: ev.pedido.metodo,
    produto: ev.pedido.produto,
    pais: ev.pedido.pais,
    programa: ev.programa,
    moeda: ev.pedido.moeda,
    valor: ev.pedido.valor,
    receita: ev.receita.valor,
    moeda_receita: ev.receita.moeda,
    criado_em: ev.pedido.criadoEm,
    dia_local: diaDoPedido(ev.pedido.criadoEm, fuso),
    ...marcos(ev.receita.situacao, ev.dataEvento),
    atualizado_em: ev.dataEvento,
    referencia: v?.referencia ?? null,
    taxa: v ? v.taxa : null,
    comissoes: v ? v.comissoes : null,
    grupo: v?.grupo ?? null,
    oferta_tipo: v?.ofertaTipo ?? null,
    vence_em: v?.venceEm ?? null,
    reembolsado_em: v?.reembolsadoEm ?? null,
    chargeback_em: v?.chargebackEm ?? null,
    reembolso_pedido_em: v?.reembolsoPedidoEm ?? null,
    ...(v
      ? utmDoEvento(ev)
      : {
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          campanha_id: null,
          conjunto_id: null,
          anuncio_id: null,
        }),
  };
}

/** O evento muda a situacao do pedido? (as regras 1 a 4 do topo) */
export function eventoVence(atual: Pick<EstadoPedido, "situacao" | "atualizado_em">, novo: { situacao: SituacaoExterna; dataEvento: string }): boolean {
  if (novo.situacao === "pendente" && atual.situacao !== "pendente") return false;
  if (atual.situacao === "pago" && novo.situacao === "aprovado") return false;
  const a = Date.parse(atual.atualizado_em);
  const b = Date.parse(novo.dataEvento);
  if (b < a) return false;
  if (b > a) return true;
  return ORDEM[novo.situacao] >= ORDEM[atual.situacao];
}

/** Os campos da venda depois do evento: datas pela primeira, o resto pelo primeiro que veio. */
function vendaMesclada(atual: EstadoPedido, novo: EstadoPedido, venceu: boolean) {
  const utmAtual = CAMPOS_UTM.some((k) => atual[k] !== null && atual[k] !== undefined);
  const utm = Object.fromEntries(CAMPOS_UTM.map((k) => [k, utmAtual ? (atual[k] ?? null) : (novo[k] ?? null)])) as Pick<
    EstadoPedido,
    (typeof CAMPOS_UTM)[number]
  >;
  return {
    referencia: atual.referencia ?? novo.referencia,
    // Valor da taxa: o do evento que vence (a aprovacao traz a taxa real);
    // o velho so completa.
    taxa: venceu ? (novo.taxa ?? atual.taxa) : (atual.taxa ?? novo.taxa),
    comissoes: venceu ? (novo.comissoes ?? atual.comissoes) : (atual.comissoes ?? novo.comissoes),
    grupo: atual.grupo ?? novo.grupo,
    oferta_tipo: atual.oferta_tipo ?? novo.oferta_tipo,
    vence_em: atual.vence_em ?? novo.vence_em,
    reembolsado_em: primeira(atual.reembolsado_em, novo.reembolsado_em),
    chargeback_em: primeira(atual.chargeback_em, novo.chargeback_em),
    reembolso_pedido_em: primeira(atual.reembolso_pedido_em, novo.reembolso_pedido_em),
    ...utm,
  };
}

/**
 * O pedido depois do evento. `atual` null = primeiro evento do pedido.
 * `mudou` false = nada a gravar (evento repetido ou velho sem novidade).
 */
export function aplicarEvento(
  atual: EstadoPedido | null,
  ev: EventoNormalizado,
  fuso: string | null | undefined
): { pedido: EstadoPedido; venceu: boolean; mudou: boolean } {
  const novo = pedidoDoEvento(ev, fuso);
  if (!atual) return { pedido: novo, venceu: true, mudou: true };

  const venceu = eventoVence(atual, { situacao: ev.receita.situacao, dataEvento: ev.dataEvento });
  const m = marcos(ev.receita.situacao, ev.dataEvento);
  const base = venceu
    ? {
        ...atual,
        situacao: novo.situacao,
        status_comissao: novo.status_comissao ?? atual.status_comissao,
        status_pedido: novo.status_pedido ?? atual.status_pedido,
        metodo_pagamento: novo.metodo_pagamento ?? atual.metodo_pagamento,
        produto: novo.produto ?? atual.produto,
        pais: novo.pais ?? atual.pais,
        programa: novo.programa ?? atual.programa,
        moeda: novo.moeda,
        valor: novo.valor,
        // Comissao zero num evento que so muda a situacao nao apaga a que ja veio.
        receita: novo.receita > 0 ? novo.receita : atual.receita,
        moeda_receita: novo.moeda_receita ?? atual.moeda_receita,
        atualizado_em: ev.dataEvento,
      }
    : {
        // Velho: so completa o que faltava.
        ...atual,
        produto: atual.produto ?? novo.produto,
        pais: atual.pais ?? novo.pais,
        programa: atual.programa ?? novo.programa,
        metodo_pagamento: atual.metodo_pagamento ?? novo.metodo_pagamento,
        receita: atual.receita > 0 ? atual.receita : novo.receita,
      };
  const pedido: EstadoPedido = {
    ...base,
    ...vendaMesclada(atual, novo, venceu),
    aprovado_em: primeira(atual.aprovado_em, m.aprovado_em),
    pago_em: primeira(atual.pago_em, m.pago_em),
    // So o perdido do estado atual: comissao revertida e depois paga de novo
    // nao fica marcada como perdida.
    perdido_em:
      base.situacao === "expirado" || base.situacao === "revertido"
        ? primeira(atual.perdido_em, m.perdido_em)
        : null,
  };
  const mudou = (Object.keys(pedido) as (keyof EstadoPedido)[]).some((k) => pedido[k] !== atual[k]);
  return { pedido, venceu, mudou };
}

/** As datas de etapa: a primeira vez que cada uma vem fica (ver vendaMesclada). */
const MARCOS = [
  "aprovado_em",
  "pago_em",
  "perdido_em",
  "vence_em",
  "reembolsado_em",
  "chargeback_em",
  "reembolso_pedido_em",
] as const satisfies readonly (keyof EstadoPedido)[];

/**
 * O pedido gravado ja tem o que este evento traz? Para a trava que ficou sem
 * o pedido (a gravacao falhou e a trava nao saiu): a retentativa refaz so se
 * o evento muda a situacao ou traz uma etapa que falta. Nao compara o resto:
 * evento sem data cai na hora da chegada, e a retentativa dele mudaria o
 * atualizado_em sem ser novidade.
 */
export function eventoJaRefletido(atual: EstadoPedido | null, ev: EventoNormalizado, fuso: string | null | undefined): boolean {
  if (!atual) return false;
  const r = aplicarEvento(atual, ev, fuso);
  if (!r.mudou) return true;
  if (r.pedido.situacao !== atual.situacao) return false;
  return !MARCOS.some((k) => !atual[k] && Boolean(r.pedido[k]));
}
