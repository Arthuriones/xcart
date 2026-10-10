import type { ReactNode } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  HandCoins,
  Hourglass,
  Megaphone,
  Package,
  Percent,
  Receipt,
  ShoppingBasket,
  Target,
  Ticket,
  TrendingUp,
  Truck,
  Undo2,
  UserPlus,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { Delta } from "@/components/ui/delta";
import { Dica } from "@/components/ui/dica";
import { calcularVariacao, type BomQuando, type FormatoVariacao } from "@/components/ui/variacao";
import type { ResumoEntrega, Totais } from "@/lib/financeiro/calculo";
import { AMOSTRA_MINIMA, DIAS_SEM_RETORNO } from "@/lib/financeiro/contra-entrega";
import {
  METRICAS,
  dinheiro,
  formatarMetrica,
  inteiro,
  porcento,
  valorComSinal,
  vezes,
  type ComposicaoCod,
  type IdMetrica,
} from "./lucro-dados";

// ============================================================================
// Os cartoes do Dashboard (mockup "design novo/2.0/Dashboard.dc.html"):
//   - IndicadoresTopo: Lucro em destaque (verde/vermelho), Faturamento, Custos
//     totais, Taxas e Margem.
//   - IndicadoresKpi: Anuncios, CPA, ROAS real, ROAS de equilibrio, Custo de
//     produto, Pedidos (com o selo de cobertura de custo) e Ticket medio.
//   - IndicadoresTopoCod / IndicadoresKpiCod: a loja em "Contra entrega"
//     (Lucro previsto, Recebido, A receber, Previsto, Taxa de entrega...).
// Server components: a variacao contra o periodo anterior sai pronta daqui.
// ============================================================================

export interface BaseIndicadores {
  moeda: string;
  atual: Totais;
  anterior: Totais;
  /** false = sem comparacao (escolha do usuario ou periodo anterior sem movimento). */
  compara: boolean;
  /** Avisos que so explicam um numero, na Dica do cartao afetado. */
  dicas: Partial<Record<IdMetrica, string[]>>;
  /** Taxa de entrega do filtro: so os cartoes de contra entrega usam. */
  entrega?: ResumoEntrega;
  /**
   * Cartoes de contra entrega: o que o filtro soma (composicaoCod). So
   * checkout: "Taxa de aprovação" e Perdido no lugar de custo de produto e
   * devoluções. Loja + checkout: os textos somam a comissao, e a taxa diz se
   * e de aprovacao, de entrega ou a media das duas. Ausente = so loja.
   */
  composicao?: ComposicaoCod;
}

const SO_LOJAS: ComposicaoCod = { origem: "lojas", taxa: "entrega" };

interface Cartao {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  valor: number | null;
  texto: string;
  variacao?: number | null;
  bom: BomQuando;
  formato?: FormatoVariacao;
  definicao: string;
  notas?: string[];
  selo?: { texto: string; tom: "ok" | "warn" };
  detalhe?: string;
  classe?: string;
}

function variacaoDe(b: BaseIndicadores, atual: number | null, anterior: number | null, formato: FormatoVariacao = "pct") {
  if (!b.compara) return undefined;
  if (formato === "pp") return atual !== null && anterior !== null ? atual - anterior : null;
  return calcularVariacao(atual, anterior);
}

/** Cartao de uma metrica do catalogo (lucro-dados), com variacao e dica. */
function daMetrica(b: BaseIndicadores, id: IdMetrica, icone: LucideIcon, valor: (t: Totais) => number | null, extra?: Partial<Cartao>): Cartao {
  const d = METRICAS[id];
  const v = valor(b.atual);
  return {
    id,
    rotulo: d.rotulo,
    icone,
    valor: v,
    texto: v === null ? "—" : formatarMetrica(id, v, b.moeda),
    variacao: variacaoDe(b, v, valor(b.anterior), d.formatoVariacao),
    bom: d.bom,
    formato: d.formatoVariacao,
    definicao: v === null ? `${d.definicao} ${d.semDado}.` : d.definicao,
    notas: b.dicas[id],
    ...extra,
  };
}

function CartaoKpi({ c, destaque }: { c: Cartao; destaque?: "ok" | "err" }) {
  const Icone = c.icone;
  const { texto, negativo } = valorComSinal(c.texto, c.valor);
  return (
    <div
      className={clsx(
        "flex min-h-24 items-center gap-3 rounded-overlay border p-4",
        destaque === "ok" && "border-transparent bg-ok text-surface",
        destaque === "err" && "border-transparent bg-err text-surface",
        !destaque && "border-border bg-surface text-ink",
        c.classe
      )}
    >
      <span
        aria-hidden
        className={clsx(
          // Some onde o cartao fica estreito (celular; 4-5 colunas antes do xl):
          // o valor exato, com centavos, precisa da largura.
          "hidden size-9 shrink-0 place-items-center rounded-full sm:grid lg:hidden xl:grid",
          destaque ? "bg-white/20 text-surface" : "bg-info-bg text-info"
        )}
      >
        <Icone className="size-5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={clsx("flex items-center gap-1 text-dense", destaque ? "opacity-90" : "text-t1")}>
          {c.rotulo}
          <Dica rotulo={`O que é ${c.rotulo}`} className={destaque ? "text-surface/80 hover:text-ink" : undefined}>
            <span className="flex flex-col gap-1.5">
              <span>{c.definicao}</span>
              {c.notas?.map((n) => (
                <span key={n} className="font-semibold">
                  {n}
                </span>
              ))}
            </span>
          </Dica>
        </span>
        <span
          className={clsx(
            "num whitespace-nowrap text-[clamp(16px,1.4vw,20px)] leading-7 font-bold tracking-[-0.01em]",
            negativo && !destaque && "text-err"
          )}
        >
          {texto}
        </span>
        {c.variacao !== undefined && (
          <Delta
            valor={c.variacao}
            bom={c.bom}
            formato={c.formato}
            className={clsx("text-label", destaque && "text-surface")}
          />
        )}
        {c.detalhe && <span className={clsx("text-label", destaque ? "opacity-90" : "text-t2")}>{c.detalhe}</span>}
        {c.selo && (
          <span
            className={clsx(
              "mt-1 self-start whitespace-nowrap rounded-control border px-1.5 text-label font-medium",
              destaque
                ? "border-white/40 text-surface"
                : c.selo.tom === "ok"
                  ? "border-ok-border text-ok"
                  : "border-warn-border text-warn"
            )}
          >
            {c.selo.texto}
          </span>
        )}
      </span>
    </div>
  );
}

const custosDe = (t: Totais) => t.cmv + t.taxas + t.gasto;

export function IndicadoresTopo(b: BaseIndicadores) {
  const lucro = daMetrica(b, "lucro", CircleDollarSign, (t) => t.lucro);
  const custos = custosDe(b.atual);
  const cartoes: Cartao[] = [
    daMetrica(b, "receita", CircleDollarSign, (t) => t.receita),
    {
      id: "custos",
      rotulo: "Custos totais",
      icone: ShoppingBasket,
      valor: custos,
      texto: dinheiro(custos, b.moeda),
      variacao: variacaoDe(b, custos, custosDe(b.anterior)),
      bom: "neutro",
      definicao: "Produto mais frete do fornecedor, taxas de pagamento e gasto em anúncios do período.",
    },
    {
      id: "taxas",
      rotulo: "Taxas",
      icone: Landmark,
      valor: b.atual.taxas,
      texto: dinheiro(b.atual.taxas, b.moeda),
      variacao: variacaoDe(b, b.atual.taxas, b.anterior.taxas),
      bom: "neutro",
      definicao: "Taxa de pagamento dos pedidos: o percentual mais o valor fixo configurados em Custos e taxas.",
    },
    daMetrica(b, "margem", Percent, (t) => t.margem),
  ];
  return (
    <section aria-label="Resumo do período" className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
      <CartaoKpi c={{ ...lucro, classe: "col-span-2 lg:col-span-1" }} destaque={b.atual.lucro < 0 ? "err" : "ok"} />
      {cartoes.map((c) => (
        <CartaoKpi key={c.id} c={c} />
      ))}
    </section>
  );
}

/** Selo de cobertura de custo no cartao de Pedidos. null = sem venda. */
function seloCobertura(cobertura: number | null): Cartao["selo"] {
  if (cobertura === null) return undefined;
  if (cobertura >= 0.9995) return { texto: "Todos com custo", tom: "ok" };
  return { texto: `${porcento(1 - cobertura)} das vendas sem custo`, tom: "warn" };
}

export function IndicadoresKpi(b: BaseIndicadores) {
  const t = b.atual;
  const cartoes: Cartao[] = [
    daMetrica(b, "gasto", Megaphone, (x) => x.gasto, {
      rotulo: "Anúncios",
      detalhe: `Meta ${dinheiro(t.gastoMeta, b.moeda)} · Google ${dinheiro(t.gastoGoogle, b.moeda)}`,
    }),
    daMetrica(b, "cpa", UserPlus, (x) => x.cpa),
    daMetrica(b, "roas", TrendingUp, (x) => x.roas),
    {
      id: "equilibrio",
      rotulo: "ROAS de equilíbrio",
      icone: Target,
      valor: t.roasEquilibrio,
      texto: vezes(t.roasEquilibrio),
      bom: "neutro",
      definicao:
        "O ROAS em que o lucro fica em zero: faturamento dividido pelo que sobra depois de produto, frete e taxa. Abaixo dele, cada anúncio dá prejuízo.",
    },
    daMetrica(b, "custo", Package, (x) => x.cmv),
    daMetrica(b, "pedidos", Receipt, (x) => x.pedidos, {
      detalhe: t.reenvios > 0 ? `+ ${inteiro(t.reenvios)} ${t.reenvios === 1 ? "reenvio" : "reenvios"}` : undefined,
      selo: seloCobertura(t.coberturaCusto),
    }),
    // Ultimo da grade de 4: fecha a 2a linha em vez de deixar um buraco.
    daMetrica(b, "ticket", Ticket, (x) => x.ticket, { classe: "lg:col-span-2" }),
  ];
  return (
    <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {cartoes.map((c) => (
        <CartaoKpi key={c.id} c={c} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contra entrega: o mesmo visual, com Recebido, A receber e Previsto.
// O realizado e o de sempre (receita = Recebido, lucro = Lucro realizado).
// ---------------------------------------------------------------------------

type Formato = "dinheiro" | "vezes" | "numero";

function cartaoCod(
  b: BaseIndicadores,
  id: string,
  rotulo: string,
  icone: LucideIcon,
  valor: (t: Totais) => number | null,
  formato: Formato,
  definicao: string,
  extra?: Partial<Cartao>
): Cartao {
  const v = valor(b.atual);
  const texto = formato === "dinheiro" ? dinheiro(v, b.moeda) : formato === "vezes" ? vezes(v) : inteiro(v);
  return {
    id,
    rotulo,
    icone,
    valor: v,
    texto,
    variacao: variacaoDe(b, v, valor(b.anterior)),
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

export function IndicadoresTopoCod(b: BaseIndicadores) {
  const t = b.atual;
  const taxa = taxaUsada(b);
  const { origem, taxa: taxaDe } = b.composicao ?? SO_LOJAS;
  const soCheckout = origem === "checkouts";
  // Cobertura do previsto: conta o custo dos que ainda vao ser enviados. No
  // Lucro previsto so o aviso; o "Todos com custo" fica no cartao Pedidos.
  const cobertura = seloCobertura(t.cod.coberturaCusto);
  const lucro = cartaoCod(
    b,
    "lucroPrevisto",
    "Lucro previsto",
    CircleDollarSign,
    (x) => x.cod.lucroPrevisto,
    "dinheiro",
    soCheckout
      ? "Previsto menos o gasto em anúncios ligado ao checkout."
      : "Previsto menos produto, frete, taxas, devoluções esperadas e anúncios.",
    { notas: b.dicas.lucro, selo: cobertura?.tom === "warn" ? cobertura : undefined }
  );
  const cartoes: Cartao[] = [
    cartaoCod(
      b,
      "recebido",
      "Recebido",
      HandCoins,
      (x) => x.receita,
      "dinheiro",
      soCheckout
        ? "Comissão aprovada ou paga: a que já é sua."
        : origem === "ambos"
          ? "Pedidos pagos e comissão aprovada ou paga."
          : "Pedidos pagos: os online e os contra entrega marcados como pagos na Shopify.",
      {
        detalhe: soCheckout
          ? `${inteiro(t.externo.aprovados)} ${t.externo.aprovados === 1 ? "aprovada" : "aprovadas"} · ${inteiro(t.externo.pagos)} ${t.externo.pagos === 1 ? "paga" : "pagas"}`
          : origem === "ambos"
            ? `${inteiro(t.pedidos)} ${t.pedidos === 1 ? "pago ou aprovado" : "pagos ou aprovados"}`
            : `${inteiro(t.pedidos)} ${t.pedidos === 1 ? "pago" : "pagos"}`,
      }
    ),
    cartaoCod(
      b,
      "aReceber",
      "A receber",
      Hourglass,
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
      CalendarClock,
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
      Wallet,
      (x) => x.lucro,
      "dinheiro",
      soCheckout
        ? "Recebido menos o gasto em anúncios ligado ao checkout."
        : "Recebido menos produto e frete do que já foi enviado, taxas, devoluções e anúncios."
    ),
  ];
  return (
    <section aria-label="Resumo do período" className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
      <CartaoKpi c={{ ...lucro, classe: "col-span-2 lg:col-span-1" }} destaque={t.cod.lucroPrevisto < 0 ? "err" : "ok"} />
      {cartoes.map((c) => (
        <CartaoKpi key={c.id} c={c} />
      ))}
    </section>
  );
}

/** O cartao da taxa do Previsto: de entrega (loja), de aprovacao (checkout) ou a media das duas. */
function cartaoTaxa(b: BaseIndicadores, taxa: number | null, de: ComposicaoCod["taxa"]): Cartao {
  const base = { icone: Truck, valor: taxa, texto: porcento(taxa), bom: "neutro" as const, detalhe: origemDaTaxa(b.entrega, de) };
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

export function IndicadoresKpiCod(b: BaseIndicadores) {
  const t = b.atual;
  const taxa = taxaUsada(b);
  const { origem, taxa: taxaDe } = b.composicao ?? SO_LOJAS;
  const ck = origem === "checkouts";
  const cartoes: Cartao[] = [
    cartaoTaxa(b, taxa, taxaDe),
    daMetrica(b, "gasto", Megaphone, (x) => x.gasto, {
      rotulo: "Anúncios",
      detalhe: `Meta ${dinheiro(t.gastoMeta, b.moeda)} · Google ${dinheiro(t.gastoGoogle, b.moeda)}`,
    }),
    cartaoCod(b, "roasPrevisto", "ROAS previsto", TrendingUp, (x) => x.cod.roasPrevisto, "vezes", "Previsto dividido pelo gasto em anúncios.", {
      detalhe: `Realizado ${vezes(t.roas)}`,
    }),
    {
      id: "equilibrio",
      rotulo: "ROAS de equilíbrio",
      icone: Target,
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
      Receipt,
      (x) => x.cod.gerados,
      "numero",
      ck
        ? "Pedidos criados no checkout no período, em qualquer situação."
        : origem === "ambos"
          ? "Pedidos gerados: online pagos, contra entrega que não foi cancelado antes do envio e os do checkout."
          : "Pedidos gerados: online pagos e contra entrega que não foi cancelado antes do envio.",
      ck
        ? {
            detalhe: `${inteiro(t.externo.aprovados + t.externo.pagos)} aprovados · ${inteiro(t.externo.pendentes)} pendentes · ${inteiro(t.externo.perdidos)} perdidos`,
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
    cartaoCod(b, "cpaCod", "CPA", UserPlus, (x) => x.cod.cpa, "dinheiro", "Gasto em anúncios dividido pelos pedidos gerados. Quanto menor, melhor.", {
      bom: "descer",
    }),
    ...(ck
      ? [
          cartaoCod(
            b,
            "perdido",
            "Perdido",
            Undo2,
            (x) => x.externo.perdido,
            "dinheiro",
            "Comissão de pedidos expirados (COD não pago ou não entregue) ou revertidos.",
            {
              bom: "descer",
              detalhe: `${inteiro(t.externo.perdidos)} ${t.externo.perdidos === 1 ? "pedido" : "pedidos"}`,
            }
          ),
          cartaoCod(
            b,
            "valorPedidos",
            "Valor dos pedidos",
            Package,
            (x) => x.externo.valorPedidos,
            "dinheiro",
            "Soma do total dos pedidos na plataforma. Só referência: a sua receita é a comissão.",
            { bom: "neutro", detalhe: "Não entra no lucro" }
          ),
        ]
      : [
          daMetrica(b, "custo", Package, (x) => x.cmv, {
            definicao: "Produto mais frete do fornecedor do que já foi enviado, pelo custo cadastrado em Custos.",
            detalhe: `Previsto ${dinheiro(t.cod.custoPrevisto, b.moeda)}`,
          }),
          cartaoCod(
            b,
            "devolucoes",
            "Devoluções",
            Undo2,
            (x) => x.devolucoes,
            "dinheiro",
            "Custo por devolução (Custos e taxas) vezes os recusados que foram enviados.",
            { bom: "descer", detalhe: `Previsto ${dinheiro(t.cod.devolucoesPrevistas, b.moeda)}` }
          ),
        ]),
  ];
  return (
    <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {cartoes.map((c) => (
        <CartaoKpi key={c.id} c={c} />
      ))}
    </section>
  );
}

/** "Último dado recebido há 12 min · Sem base de comparação em 04/08–02/09". */
export function LinhaAtualizado({
  atualizado,
  semBase,
  rotuloAnterior,
}: {
  atualizado: { texto: string; iso: string } | null;
  semBase: boolean;
  rotuloAnterior: string;
}): ReactNode {
  if (!atualizado && !semBase) return null;
  return (
    <p className="flex items-center gap-1.5 text-label text-t2">
      {atualizado && <span aria-hidden className="size-1.5 rounded-full bg-ok" />}
      {atualizado && (
        <span>
          Último dado recebido <time dateTime={atualizado.iso}>{atualizado.texto}</time>
        </span>
      )}
      {atualizado && semBase && " · "}
      {semBase && <span>Sem base de comparação em {rotuloAnterior}</span>}
    </p>
  );
}
