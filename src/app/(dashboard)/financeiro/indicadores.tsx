"use client";

import { useState, type ReactNode } from "react";
import { Info, Pin } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { LineChart } from "@/components/ui/line-chart";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { calcularVariacao } from "@/components/ui/variacao";
// So tipos: o calculo nao entra no bundle do navegador.
import type { Totais } from "@/lib/financeiro/calculo";
import type { PontoDia } from "@/lib/leitura/serie-diaria";
import {
  METRICAS,
  derivar,
  dinheiro,
  formatarMetrica,
  formatoDoGrafico,
  granularidades,
  inteiro,
  montarGrafico,
  ordenarFixados,
  temMovimento,
  vezes,
  type Granularidade,
  type IdMetrica,
} from "./lucro-dados";
import { useListaGuardada } from "./preferencia";

// ============================================================================
// Os 8 KPIs e o grafico. Ficam juntos porque clicar num KPI leva a metrica
// para o grafico (atual x periodo anterior). O alfinete leva o KPI para o
// comeco e fica guardado neste navegador (#22).
//
// A cascata chega pronta do servidor (`cascata`) e fica ao lado do grafico.
// ============================================================================

const CHAVE_FIXADOS = "xc_lucro_kpis_fixados";
const FIXADOS_PADRAO: readonly string[] = ["lucro"];

function valorDe(t: Totais, id: IdMetrica): number | null {
  switch (id) {
    case "receita":
      return t.receita;
    case "gasto":
      return t.gasto;
    case "lucro":
      return t.lucro;
    case "roas":
      return t.roas;
    case "pedidos":
      return t.pedidos;
    case "ticket":
      return t.ticket;
    case "cpa":
      return t.cpa;
    case "margem":
      return t.margem;
  }
}

function detalheDe(t: Totais, id: IdMetrica, moeda: string): ReactNode {
  switch (id) {
    case "gasto":
      return `Meta ${dinheiro(t.gastoMeta, moeda, true)} · Google ${dinheiro(t.gastoGoogle, moeda, true)}`;
    case "lucro":
      return "Estimado · não contábil";
    case "roas":
      return `Equilíbrio ${vezes(t.roasEquilibrio)}`;
    case "pedidos":
      return t.reenvios > 0 ? `+ ${inteiro(t.reenvios)} ${t.reenvios === 1 ? "reenvio" : "reenvios"}` : undefined;
    case "ticket":
      return "Por pedido pago";
    case "cpa":
      return "Custo por pedido";
    case "margem":
      return "Lucro sobre faturamento";
    default:
      return undefined;
  }
}

export function Indicadores({
  moeda,
  atual,
  anterior,
  comparar,
  rotuloAnterior,
  pontos,
  pontosAnteriores,
  contexto,
  cascata,
}: {
  moeda: string;
  atual: Totais;
  anterior: Totais;
  comparar: "anterior" | "nenhum";
  /** "04/08–02/09": o periodo anterior, para a frase de "sem base". */
  rotuloAnterior: string;
  /** Periodo atual, do dia mais antigo para o mais novo. */
  pontos: PontoDia[];
  /** Periodo anterior; null = a leitura falhou. */
  pontosAnteriores: PontoDia[] | null;
  /** "Todas as lojas · Últimos 30 dias · BRL". */
  contexto: string;
  cascata: ReactNode;
}) {
  const [metrica, setMetrica] = useState<IdMetrica | null>(null);
  const [granEscolhida, setGran] = useState<Granularidade>("dia");
  const [fixados, gravarFixados] = useListaGuardada(CHAVE_FIXADOS, FIXADOS_PADRAO);

  const comparando = comparar === "anterior";
  const semBase = comparando && !temMovimento(anterior);
  const compara = comparando && !semBase;

  const dias = pontos.map((p) => p.dia);
  const opcoesGran = granularidades(dias);
  const gran = opcoesGran.find((o) => o.valor === granEscolhida && !o.desabilitado) ? granEscolhida : "dia";

  function escolher(id: IdMetrica) {
    setMetrica((m) => (m === id ? null : id));
    // No celular o grafico fica abaixo dos 8 cartoes: leva ate ele.
    const alvo = document.getElementById("grafico-lucro");
    if (alvo && window.matchMedia("(max-width: 1023px)").matches) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      alvo.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
    }
  }

  function alternarFixado(id: IdMetrica) {
    gravarFixados(fixados.includes(id) ? fixados.filter((x) => x !== id) : [...fixados, id]);
  }

  const kpis = ordenarFixados(fixados).map((id) => {
    const d = METRICAS[id];
    const v = valorDe(atual, id);
    const va = valorDe(anterior, id);
    let variacao: number | null | undefined;
    if (compara) {
      if (d.formatoVariacao === "pp") variacao = v !== null && va !== null ? v - va : null;
      else variacao = calcularVariacao(v, va);
    }
    const fixado = fixados.includes(id);
    return (
      <KpiCard
        key={id}
        rotulo={d.rotulo}
        valor={v === null ? null : formatarMetrica(id, v, moeda, true)}
        variacao={variacao}
        bom={d.bom}
        formatoVariacao={d.formatoVariacao}
        anterior={compara && va !== null ? formatarMetrica(id, va, moeda, true) : undefined}
        estado={
          id === "lucro" && temMovimento(atual)
            ? atual.lucro < 0
              ? { tom: "err", texto: "Prejuízo" }
              : { tom: "ok", texto: "Lucro" }
            : undefined
        }
        detalhe={detalheDe(atual, id, moeda)}
        definicao={d.definicao}
        motivoSemDado={d.semDado}
        serie={pontos.length > 1 ? pontos.map((p) => derivar(p)[id]) : undefined}
        onSelecionar={() => escolher(id)}
        selecionado={metrica === id}
        acoes={
          <button
            type="button"
            aria-pressed={fixado}
            aria-label={fixado ? `Desafixar ${d.rotulo}` : `Fixar ${d.rotulo} no começo`}
            onClick={() => alternarFixado(id)}
            className={clsx(
              "relative grid size-6 place-items-center rounded-sm after:absolute after:-inset-2.5 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              fixado ? "text-ink" : "text-t3"
            )}
          >
            <Pin aria-hidden className="size-3.5" strokeWidth={1.75} fill={fixado ? "currentColor" : "none"} />
          </button>
        }
      />
    );
  });

  // --- Grafico --------------------------------------------------------------
  const grafico = montarGrafico({
    atual: pontos,
    anterior: compara ? pontosAnteriores : null,
    gran,
    metrica,
  });
  const titulo = metrica ? `${METRICAS[metrica].rotulo}: atual e período anterior` : "Faturamento, gasto e lucro";
  const porGran = gran === "dia" ? "por dia" : gran === "semana" ? "por semana" : "por mês";
  let nota: string | null = null;
  if (compara && pontosAnteriores === null) nota = "A linha do período anterior não carregou agora. Atualize para tentar de novo.";
  else if (compara && gran === "mes") nota = "Por mês, sem a linha do período anterior: os meses dos dois períodos não têm o mesmo tamanho.";
  const semMovimento = !pontos.some((p) => temMovimento(p));

  let corpo: ReactNode;
  if (pontos.length < 2) {
    corpo = (
      <EmptyState
        variante="tracejado"
        titulo="Um dia só não forma uma linha"
        descricao="Escolha 7 ou 30 dias na barra do topo para ver a evolução."
        className="min-h-60"
      />
    );
  } else if (semMovimento) {
    corpo = (
      <EmptyState
        variante="tracejado"
        titulo="Ainda não há vendas para desenhar"
        descricao="O gráfico aparece depois do primeiro pedido sincronizado."
        className="min-h-60"
      />
    );
  } else {
    corpo = (
      <LineChart
        // Trocar a metrica ou a granularidade remonta: a legenda volta a mostrar tudo.
        key={`${metrica ?? "composto"}-${gran}`}
        rotulos={grafico.rotulos}
        series={grafico.series}
        descricao={`${titulo} ${porGran}, ${contexto}`}
        altura={240}
        formato={formatoDoGrafico(metrica, moeda)}
        parcialUltimo={grafico.parcialUltimo}
      />
    );
  }

  return (
    <>
      <section aria-label="Indicadores do período" className="flex flex-col gap-3">
        {comparando && semBase && (
          <p className="flex items-center gap-2 text-label text-t2">
            <Info aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            Sem base de comparação: não há pedidos nem gasto no período anterior ({rotuloAnterior}).
          </p>
        )}
        {!comparando && (
          <p className="flex items-center gap-2 text-label text-t2">
            <Info aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            Sem comparação escolhida. Para comparar, use “vs.” na barra do topo.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis}</div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section
          id="grafico-lucro"
          className="scroll-mt-32"
          titulo={titulo}
          descricao={contexto}
          acoes={
            <>
              {metrica && (
                <Button variant="link" size="sm" onClick={() => setMetrica(null)}>
                  Voltar para faturamento, gasto e lucro
                </Button>
              )}
              <Segmented rotulo="Agrupar por" valor={gran} onValorChange={setGran} opcoes={opcoesGran} />
            </>
          }
        >
          {corpo}
          {nota && <p className="text-label text-t2">{nota}</p>}
        </Section>
        {cascata}
      </div>
    </>
  );
}
