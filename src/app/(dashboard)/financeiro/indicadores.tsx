import type { TomStatus } from "@/components/ui/status-badge";
import { calcularVariacao, type BomQuando, type FormatoVariacao } from "@/components/ui/variacao";
import { semaforoDe, type ResumoEntrega, type Totais } from "@/lib/financeiro/calculo";
import { AMOSTRA_MINIMA, DIAS_SEM_RETORNO } from "@/lib/financeiro/contra-entrega";
import {
  METRICAS,
  SEMAFORO,
  dinheiro,
  formatarMetrica,
  inteiro,
  porcento,
  vezes,
  type ComposicaoCod,
  type IdMetrica,
  type IdSerie,
} from "./lucro-dados";

// ============================================================================
// Os numeros do Dashboard (mockup "design novo/Dashboard.dc.html"), prontos
// para a tela: o do destaque e os da faixa de KPIs.
//   - Loja online: Lucro estimado no destaque; Faturamento, Gasto em anuncios,
//     ROAS real (com o de equilibrio), Margem, Pedidos (com a cobertura de
//     custo), Ticket medio, CPA, Custos totais, Custo de produto e Taxas.
//   - Contra entrega: Lucro previsto no destaque; Recebido, A receber,
//     Previsto, Lucro realizado, Taxa de entrega, Gasto, ROAS previsto e o de
//     equilibrio, Pedidos, CPA e produto + devolucoes (ou, so com checkout de
//     comissao, Perdido e Valor dos pedidos).
// Puro e sem JSX: o servidor monta, o painel (client) so desenha. A variacao
// contra o periodo anterior sai pronta daqui.
// ============================================================================

export interface BaseIndicadores {
  moeda: string;
  atual: Totais;
  anterior: Totais;
  /** false = sem comparacao (escolha do usuario ou periodo anterior sem movimento). */
  compara: boolean;
  /** Avisos que so explicam um numero, na Dica do indicador afetado. */
  dicas: Partial<Record<IdMetrica, string[]>>;
  /** Taxa de entrega do filtro: so os indicadores de contra entrega usam. */
  entrega?: ResumoEntrega;
  /**
   * Contra entrega: o que o filtro soma (composicaoCod). So checkout: "Taxa
   * de aprovação" e Perdido no lugar de custo de produto e devoluções. Loja +
   * checkout: os textos somam a comissao, e a taxa diz se e de aprovacao, de
   * entrega ou a media das duas. Ausente = so loja.
   */
  composicao?: ComposicaoCod;
  /**
   * Checkout de venda (Cakto) no filtro: "so" ele, ou "junto" de loja e
   * comissao. Os textos de Faturamento, Taxas e Pedidos dizem o que entra.
   */
  venda?: "so" | "junto";
  /**
   * Nenhuma loja Shopify no filtro (so checkouts). Em contra entrega, a venda
   * (Cakto) junto da comissao conta como "ambos" na composicao, mas produto,
   * frete e devolucao sao de loja: entram os do checkout de comissao.
   */
  semLoja?: boolean;
}

type Tipo = "dinheiro" | "vezes" | "numero" | "pct";

export interface Indicador {
  id: string;
  rotulo: string;
  valor: number | null;
  /** Sempre o valor exato, com centavos: o lojista confere com a Shopify. */
  texto: string;
  /** undefined = sem comparacao; null = sem base (anterior zero ou sem valor). */
  variacao?: number | null;
  bom: BomQuando;
  formato?: FormatoVariacao;
  /** O valor do periodo anterior: cheio (destaque) e compacto (faixa). null = sem valor. */
  anterior?: { cheio: string; compacto: string } | null;
  definicao: string;
  /** Avisos que explicam o numero (custo padrao, cambio, fuso). */
  notas?: string[];
  /** Linha no lugar do "vs." anterior: Meta e Google, ROAS de equilibrio. */
  sub?: string;
  /** O que o numero junta ou deixa de fora ("+ 2 reenvios", "Previsto R$ ..."). */
  detalhe?: string;
  /** Destaque: o semaforo. Faixa: a cobertura de custo dos Pedidos. */
  selo?: { texto: string; tom: TomStatus };
  /** A serie diaria que desenha o indicador. Sem ela, a celula nao troca o grafico. */
  serie?: IdSerie;
  /** Quando a linha nao e o proprio numero (Lucro previsto desenha o realizado). */
  rotuloSerie?: string;
}

export interface Indicadores {
  /** O numero em destaque: Lucro estimado, ou Lucro previsto em contra entrega. */
  principal: Indicador;
  /** A faixa de KPIs, na ordem da tela. */
  celulas: Indicador[];
}

const SO_LOJAS: ComposicaoCod = { origem: "lojas", taxa: "entrega" };

function formatar(v: number | null, tipo: Tipo, moeda: string, compacto = false): string {
  if (tipo === "dinheiro") return dinheiro(v, moeda, compacto);
  if (tipo === "vezes") return vezes(v);
  if (tipo === "pct") return porcento(v);
  return inteiro(v);
}

/**
 * Variacao e valor anterior. Ticket e CPA ficam cheios na faixa (sao valores
 * pequenos); o resto do dinheiro sai compacto ("R$ 190,1 mil").
 */
function comparar(
  b: BaseIndicadores,
  atual: number | null,
  anterior: number | null,
  tipo: Tipo,
  formato: FormatoVariacao = "pct",
  compactar = tipo === "dinheiro"
): Pick<Indicador, "variacao" | "anterior"> {
  if (!b.compara) return {};
  const variacao =
    formato === "pp"
      ? atual !== null && anterior !== null
        ? atual - anterior
        : null
      : calcularVariacao(atual, anterior);
  return {
    variacao,
    anterior:
      anterior === null || !Number.isFinite(anterior)
        ? null
        : { cheio: formatar(anterior, tipo, b.moeda), compacto: formatar(anterior, tipo, b.moeda, compactar) },
  };
}

/** Indicador de uma metrica do catalogo (lucro-dados), com variacao, dica e serie. */
function daMetrica(
  b: BaseIndicadores,
  id: IdMetrica,
  valor: (t: Totais) => number | null,
  extra?: Partial<Indicador>
): Indicador {
  const d = METRICAS[id];
  const v = valor(b.atual);
  return {
    id,
    rotulo: d.rotulo,
    valor: v,
    texto: v === null ? "—" : formatarMetrica(id, v, b.moeda),
    ...comparar(b, v, valor(b.anterior), d.tipo, d.formatoVariacao, d.tipo === "dinheiro" && id !== "ticket" && id !== "cpa"),
    bom: d.bom,
    formato: d.formatoVariacao,
    definicao: v === null ? `${d.definicao} ${d.semDado}.` : d.definicao,
    notas: b.dicas[id],
    serie: id,
    ...extra,
  };
}

const custosDe = (t: Totais) => t.cmv + t.taxas + t.gasto;

const DEFINICAO_EQUILIBRIO =
  "O ROAS em que o lucro fica em zero: faturamento dividido pelo que sobra depois de produto, frete e taxa. Abaixo dele, cada anúncio dá prejuízo.";

/** Meta e Google, compactos: o valor exato de cada um esta na composicao. */
function metaEGoogle(b: BaseIndicadores): string {
  return `Meta ${dinheiro(b.atual.gastoMeta, b.moeda, true)} · Google ${dinheiro(b.atual.gastoGoogle, b.moeda, true)}`;
}

/** O Faturamento com a venda da Cakto: o que ainda esta em Pix ou boleto aparece embaixo. */
function extraFaturamento(b: BaseIndicadores): Partial<Indicador> | undefined {
  if (!b.venda) return undefined;
  const v = b.atual.venda;
  return {
    definicao:
      b.venda === "so"
        ? "Valor das vendas pagas no checkout, sem a taxa que o comprador paga à plataforma. Reembolso e chargeback saem do dia da venda; Pix e boleto só entram quando pagos."
        : "Pedidos pagos das lojas e as vendas pagas do checkout. Pix e boleto do checkout só entram quando pagos.",
    detalhe: v.aguardando > 0 ? `${dinheiro(v.aReceber, b.moeda)} a receber · ${inteiro(v.aguardando)} aguardando` : undefined,
  };
}

/** As Taxas com a venda da Cakto: a taxa da plataforma e as comissoes de afiliado e coprodutor. */
function extraTaxas(b: BaseIndicadores): Partial<Indicador> | undefined {
  if (!b.venda) return undefined;
  const v = b.atual.venda;
  return {
    definicao:
      b.venda === "so"
        ? "Taxa da plataforma de checkout mais as comissões de afiliado e coprodutor das vendas pagas: o que não fica com você."
        : "Taxa de pagamento dos pedidos (Custos e taxas) e, no checkout, a taxa da plataforma mais as comissões de afiliado e coprodutor.",
    detalhe: `Checkout ${dinheiro(v.taxa, b.moeda)}${v.comissoes > 0.005 ? ` · comissões ${dinheiro(v.comissoes, b.moeda)}` : ""}`,
  };
}

/** Selo de cobertura de custo nos Pedidos. null = sem venda. */
function seloCobertura(cobertura: number | null): Indicador["selo"] {
  if (cobertura === null) return undefined;
  if (cobertura >= 0.9995) return { texto: "Todos com custo", tom: "ok" };
  return { texto: `${porcento(1 - cobertura)} das vendas sem custo`, tom: "warn" };
}

/** "2 reembolsos · 1 chargeback · 3 vencidos": o que saiu da venda no periodo. */
function detalheVendas(t: Totais): string | undefined {
  const v = t.venda;
  const partes = [
    v.reembolsos > 0 ? `${inteiro(v.reembolsos)} ${v.reembolsos === 1 ? "reembolso" : "reembolsos"}` : null,
    v.chargebacks > 0 ? `${inteiro(v.chargebacks)} ${v.chargebacks === 1 ? "chargeback" : "chargebacks"}` : null,
    v.vencidas > 0 ? `${inteiro(v.vencidas)} ${v.vencidas === 1 ? "Pix/boleto vencido" : "Pix/boleto vencidos"}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : undefined;
}

function indicadoresOnline(b: BaseIndicadores): Indicadores {
  const t = b.atual;
  const custos = custosDe(t);
  return {
    principal: daMetrica(b, "lucro", (x) => x.lucro, { selo: SEMAFORO[semaforoDe(t)] }),
    celulas: [
      daMetrica(b, "receita", (x) => x.receita, extraFaturamento(b)),
      daMetrica(b, "gasto", (x) => x.gasto, { sub: metaEGoogle(b) }),
      daMetrica(b, "roas", (x) => x.roas, {
        sub: `equilíbrio ${vezes(t.roasEquilibrio)}`,
        definicao: `${METRICAS.roas.definicao} ROAS de equilíbrio: ${DEFINICAO_EQUILIBRIO.charAt(0).toLowerCase()}${DEFINICAO_EQUILIBRIO.slice(1)}`,
      }),
      daMetrica(b, "margem", (x) => x.margem),
      daMetrica(b, "pedidos", (x) => x.pedidos, {
        detalhe:
          (b.venda ? detalheVendas(t) : undefined) ??
          (t.reenvios > 0 ? `+ ${inteiro(t.reenvios)} ${t.reenvios === 1 ? "reenvio" : "reenvios"}` : undefined),
        selo: seloCobertura(t.coberturaCusto),
        ...(b.venda
          ? {
              definicao:
                "Pedidos pagos. No checkout conta a cobrança: order bump e upsell entram no pedido principal. Reembolso e chargeback saem.",
            }
          : {}),
      }),
      daMetrica(b, "ticket", (x) => x.ticket),
      daMetrica(b, "cpa", (x) => x.cpa),
      {
        id: "custos",
        rotulo: "Custos totais",
        valor: custos,
        texto: dinheiro(custos, b.moeda),
        ...comparar(b, custos, custosDe(b.anterior), "dinheiro"),
        bom: "neutro",
        definicao: "Produto mais frete do fornecedor, taxas de pagamento e gasto em anúncios do período.",
        serie: "custos",
      },
      daMetrica(b, "custo", (x) => x.cmv),
      {
        id: "taxas",
        rotulo: "Taxas",
        valor: t.taxas,
        texto: dinheiro(t.taxas, b.moeda),
        ...comparar(b, t.taxas, b.anterior.taxas, "dinheiro"),
        bom: "neutro",
        definicao: "Taxa de pagamento dos pedidos: o percentual mais o valor fixo configurados em Custos e taxas.",
        serie: "taxas",
        ...extraTaxas(b),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Contra entrega: Recebido, A receber e Previsto. O realizado e o de sempre
// (receita = Recebido, lucro = Lucro realizado).
// ---------------------------------------------------------------------------

function cartaoCod(
  b: BaseIndicadores,
  id: string,
  rotulo: string,
  valor: (t: Totais) => number | null,
  tipo: Exclude<Tipo, "pct">,
  definicao: string,
  extra?: Partial<Indicador>
): Indicador {
  const v = valor(b.atual);
  return {
    id,
    rotulo,
    valor: v,
    texto: formatar(v, tipo, b.moeda),
    ...comparar(b, v, valor(b.anterior), tipo, "pct", tipo === "dinheiro" && id !== "cpaCod"),
    bom: "subir",
    definicao,
    ...extra,
  };
}

/** A taxa que o Previsto usou: a efetiva dos nao entregues, ou a da loja. */
function taxaUsada(b: BaseIndicadores): number | null {
  return b.atual.cod.taxaEntrega ?? b.entrega?.taxa ?? null;
}

function origemDaTaxa(e: ResumoEntrega | undefined, taxa: ComposicaoCod["taxa"]): string | undefined {
  if (!e || e.fonte === null) return undefined;
  if (taxa === "misto") return "Média das lojas e checkouts";
  const checkout = taxa === "aprovacao";
  if (e.fonte === "historico") return `${checkout ? "Do checkout" : "Da loja"} · ${inteiro(e.amostra)} pedidos`;
  if (e.fonte === "misto") return checkout ? "Média dos checkouts" : "Média das lojas";
  return e.amostra > 0 ? `Padrão · ${inteiro(e.amostra)} de ${AMOSTRA_MINIMA} pedidos` : "Padrão";
}

/** "Com 70% de aprovação" no Previsto. */
function detalheDaTaxa(taxa: number | null, de: ComposicaoCod["taxa"]): string | undefined {
  if (taxa === null) return undefined;
  if (de === "misto") return `Média de ${porcento(taxa)} (entrega e aprovação)`;
  return `Com ${porcento(taxa)} de ${de === "aprovacao" ? "aprovação" : "entrega"}`;
}

/** A taxa do Previsto: de entrega (loja), de aprovacao (checkout) ou a media das duas. */
function cartaoTaxa(b: BaseIndicadores, taxa: number | null, de: ComposicaoCod["taxa"]): Indicador {
  const base = { valor: taxa, texto: porcento(taxa), bom: "neutro" as const, detalhe: origemDaTaxa(b.entrega, de) };
  if (de === "aprovacao") {
    return {
      ...base,
      id: "taxaAprovacao",
      rotulo: "Taxa de aprovação",
      definicao: `Dos pedidos do checkout dos últimos 60 dias (sem a última semana), quantos tiveram a comissão aprovada. Pendente há mais de ${DIAS_SEM_RETORNO} dias conta como perdido. Com menos de ${AMOSTRA_MINIMA}, vale a taxa padrão do checkout.`,
    };
  }
  if (de === "misto") {
    return {
      ...base,
      id: "taxaEntregaAprovacao",
      rotulo: "Taxa de entrega/aprovação",
      definicao: `Média da taxa de entrega das lojas em contra entrega e da taxa de aprovação dos checkouts, cada uma dos últimos 60 dias (sem a última semana). Com menos de ${AMOSTRA_MINIMA} pedidos, vale a taxa padrão de cada uma.`,
    };
  }
  return {
    ...base,
    id: "taxaEntrega",
    rotulo: "Taxa de entrega",
    definicao: `Dos contra entrega finalizados nos últimos 60 dias (sem a última semana), quantos foram entregues. Em aberto há mais de ${DIAS_SEM_RETORNO} dias conta como não entregue. Com menos de ${AMOSTRA_MINIMA}, vale a taxa padrão de Custos e taxas.`,
  };
}

function indicadoresCod(b: BaseIndicadores): Indicadores {
  const t = b.atual;
  const taxa = taxaUsada(b);
  const { origem, taxa: taxaDe } = b.composicao ?? SO_LOJAS;
  const ck = origem === "checkouts";
  // Venda e comissao, sem loja: nada de produto, frete ou devolucao (sao de
  // loja e ficariam zerados); entram os do checkout de comissao.
  const soCheckouts = !ck && b.semLoja === true;

  const principal = cartaoCod(
    b,
    "lucroPrevisto",
    "Lucro previsto",
    (x) => x.cod.lucroPrevisto,
    "dinheiro",
    ck
      ? "Previsto menos o gasto em anúncios ligado ao checkout."
      : soCheckouts
        ? "Previsto menos as taxas da venda e o gasto em anúncios ligado aos checkouts."
        : "Previsto menos produto, frete, taxas, devoluções esperadas e anúncios.",
    {
      notas: b.dicas.lucro,
      // O semaforo de sempre (semaforoDe), com os numeros do previsto: e o
      // numero que esta no destaque.
      selo: SEMAFORO[
        semaforoDe({
          gasto: t.gasto,
          lucro: t.cod.lucroPrevisto,
          roas: t.cod.roasPrevisto,
          roasEquilibrio: t.cod.roasEquilibrioPrevisto,
        })
      ],
      // Nao ha previsto por dia: a linha e a do lucro realizado, e a legenda diz.
      serie: "lucro",
      rotuloSerie: "Lucro realizado",
    }
  );

  const celulas: Indicador[] = [
    cartaoCod(
      b,
      "recebido",
      "Recebido",
      (x) => x.receita,
      "dinheiro",
      ck
        ? "Comissão aprovada ou paga: a que já é sua."
        : origem === "ambos"
          ? "Pedidos pagos e comissão aprovada ou paga."
          : "Pedidos pagos: os online e os contra entrega marcados como pagos na Shopify.",
      {
        detalhe: ck
          ? `${inteiro(t.externo.aprovados)} ${t.externo.aprovados === 1 ? "aprovada" : "aprovadas"} · ${inteiro(t.externo.pagos)} ${t.externo.pagos === 1 ? "paga" : "pagas"}`
          : origem === "ambos"
            ? `${inteiro(t.pedidos)} ${t.pedidos === 1 ? "pago ou aprovado" : "pagos ou aprovados"}`
            : `${inteiro(t.pedidos)} ${t.pedidos === 1 ? "pago" : "pagos"}`,
        serie: "receita",
      }
    ),
    cartaoCod(
      b,
      "aReceber",
      "A receber",
      (x) => x.cod.aReceber,
      "dinheiro",
      // Loja online + checkout: so o checkout tem o que receber.
      taxaDe === "aprovacao"
        ? "Comissão pendente: pedidos ainda sem aprovação."
        : taxaDe === "misto"
          ? "Contra entrega ainda sem pagamento e comissão pendente."
          : "Contra entrega ainda sem pagamento: aguardando envio, em trânsito ou entregue.",
      {
        bom: "neutro",
        detalhe:
          taxaDe === "aprovacao"
            ? `${inteiro(t.cod.abertos)} ${t.cod.abertos === 1 ? "pendente" : "pendentes"}`
            : `${inteiro(t.cod.abertos)} em aberto`,
      }
    ),
    cartaoCod(
      b,
      "previsto",
      "Previsto",
      (x) => x.cod.previsto,
      "dinheiro",
      taxaDe === "aprovacao"
        ? "Recebido, mais a comissão pendente vezes a taxa de aprovação."
        : taxaDe === "misto"
          ? "Recebido, mais os entregues a receber, mais o que ainda vai ser entregue ou aprovado vezes a taxa de cada loja e checkout."
          : "Recebido, mais os entregues a receber, mais o que ainda vai ser entregue vezes a taxa de entrega.",
      { detalhe: detalheDaTaxa(taxa, taxaDe) }
    ),
    cartaoCod(
      b,
      "lucroRealizado",
      "Lucro realizado",
      (x) => x.lucro,
      "dinheiro",
      ck
        ? "Recebido menos o gasto em anúncios ligado ao checkout."
        : soCheckouts
          ? "Recebido menos as taxas da venda e o gasto em anúncios ligado aos checkouts."
          : "Recebido menos produto e frete do que já foi enviado, taxas, devoluções e anúncios.",
      { serie: "lucro" }
    ),
    cartaoTaxa(b, taxa, taxaDe),
    daMetrica(b, "gasto", (x) => x.gasto, { sub: metaEGoogle(b) }),
    cartaoCod(b, "roasPrevisto", "ROAS previsto", (x) => x.cod.roasPrevisto, "vezes", "Previsto dividido pelo gasto em anúncios.", {
      detalhe: `Realizado ${vezes(t.roas)}`,
    }),
    {
      id: "equilibrio",
      rotulo: "ROAS de equilíbrio",
      valor: t.cod.roasEquilibrioPrevisto,
      texto: vezes(t.cod.roasEquilibrioPrevisto),
      bom: "neutro",
      definicao:
        "O ROAS previsto em que o lucro fica em zero: previsto dividido pelo que sobra depois de produto, frete, taxas e devoluções.",
    },
    cartaoCod(
      b,
      "pedidosCod",
      "Pedidos",
      (x) => x.cod.gerados,
      "numero",
      ck
        ? "Pedidos criados no checkout no período, em qualquer situação."
        : soCheckouts
          ? "Vendas pagas e pedidos do checkout de comissão, em qualquer situação."
          : origem === "ambos"
            ? "Pedidos gerados: online pagos, contra entrega que não foi cancelado antes do envio e os do checkout."
            : "Pedidos gerados: online pagos e contra entrega que não foi cancelado antes do envio.",
      ck
        ? {
            detalhe: `${inteiro(t.externo.aprovados + t.externo.pagos)} aprovados · ${inteiro(t.externo.pendentes)} pendentes · ${inteiro(t.externo.perdidos)} perdidos`,
          }
        : soCheckouts
          ? {
              detalhe: `${inteiro(t.pedidos)} pagos ou aprovados · ${inteiro(t.cod.abertos)} em aberto · ${inteiro(t.cod.recusados)} recusados ou perdidos`,
            }
          : origem === "ambos"
            ? {
                detalhe: `${inteiro(t.pedidos)} pagos ou aprovados · ${inteiro(t.cod.abertos)} em aberto · ${inteiro(t.cod.recusados)} recusados ou perdidos`,
                selo: seloCobertura(t.cod.coberturaCusto),
              }
            : {
                detalhe: `${inteiro(t.pedidos)} ${t.pedidos === 1 ? "pago" : "pagos"} · ${inteiro(t.cod.abertos)} em aberto · ${inteiro(t.cod.recusados)} ${t.cod.recusados === 1 ? "recusado" : "recusados"}`,
                selo: seloCobertura(t.cod.coberturaCusto),
              }
    ),
    cartaoCod(b, "cpaCod", "CPA", (x) => x.cod.cpa, "dinheiro", "Gasto em anúncios dividido pelos pedidos gerados. Quanto menor, melhor.", {
      bom: "descer",
    }),
    ...(ck || soCheckouts
      ? [
          cartaoCod(
            b,
            "perdido",
            "Perdido",
            (x) => x.externo.perdido,
            "dinheiro",
            ck
              ? "Comissão de pedidos expirados (COD não pago ou não entregue) ou revertidos."
              : "Comissão de pedidos expirados ou revertidos no checkout de comissão.",
            {
              bom: "descer",
              detalhe: `${inteiro(t.externo.perdidos)} ${t.externo.perdidos === 1 ? "pedido" : "pedidos"}`,
            }
          ),
          cartaoCod(
            b,
            "valorPedidos",
            "Valor dos pedidos",
            (x) => x.externo.valorPedidos,
            "dinheiro",
            ck
              ? "Soma do total dos pedidos na plataforma. Só referência: a sua receita é a comissão."
              : "Soma do total dos pedidos do checkout de comissão. Só referência: dele, a receita é a comissão.",
            { bom: "neutro", detalhe: "Não entra no lucro" }
          ),
        ]
      : [
          daMetrica(b, "custo", (x) => x.cmv, {
            definicao: "Produto mais frete do fornecedor do que já foi enviado, pelo custo cadastrado em Custos.",
            detalhe: `Previsto ${dinheiro(t.cod.custoPrevisto, b.moeda)}`,
          }),
          cartaoCod(
            b,
            "devolucoes",
            "Devoluções",
            (x) => x.devolucoes,
            "dinheiro",
            "Custo por devolução (Custos e taxas) vezes os recusados que foram enviados.",
            { bom: "descer", detalhe: `Previsto ${dinheiro(t.cod.devolucoesPrevistas, b.moeda)}`, serie: "devolucoes" }
          ),
        ]),
  ];

  return { principal, celulas };
}

/** Os indicadores da tela: os de contra entrega quando o filtro tem COD (ou checkout de comissao). */
export function montarIndicadores(b: BaseIndicadores, contraEntrega: boolean): Indicadores {
  return contraEntrega ? indicadoresCod(b) : indicadoresOnline(b);
}
