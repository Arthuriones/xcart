"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
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
  KPIS_MAIS,
  KPIS_PRINCIPAIS,
  METRICAS,
  derivar,
  dinheiro,
  formatarMetrica,
  formatoDoGrafico,
  granularidades,
  inteiro,
  montarGrafico,
  temMovimento,
  valorComSinal,
  vezes,
  type Granularidade,
  type IdMetrica,
} from "./lucro-dados";

// ============================================================================
// Os KPIs e o grafico. Ficam juntos porque clicar num KPI leva a metrica para
// o grafico (atual x periodo anterior). O Lucro abre em destaque; Faturamento,
// Custo de produto, Gasto e ROAS ficam ao lado e os outros 4 atras de
// "+4 métricas".
//
// A cascata chega pronta do servidor (`cascata`) e fica ao lado do grafico.
// ============================================================================

function valorDe(t: Totais, id: IdMetrica): number | null {
  switch (id) {
    case "receita":
      return t.receita;
    case "gasto":
      return t.gasto;
    case "custo":
      return t.cmv;
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

/** Sub-linha so quando traz numero que o rotulo nao diz. */
function detalheDe(t: Totais, id: IdMetrica, moeda: string): ReactNode {
  switch (id) {
    case "gasto":
      return `Meta ${dinheiro(t.gastoMeta, moeda, true)} · Google ${dinheiro(t.gastoGoogle, moeda, true)}`;
    case "roas":
      return `Equilíbrio ${vezes(t.roasEquilibrio)}`;
    case "pedidos":
      return t.reenvios > 0 ? `+ ${inteiro(t.reenvios)} ${t.reenvios === 1 ? "reenvio" : "reenvios"}` : undefined;
    default:
      return undefined;
  }
}

/** Celular: Lucro na linha toda e os outros 4 em pares. No lg, 5 por linha. */
const CLASSE_KPI: Partial<Record<IdMetrica, string>> = {
  lucro: "col-span-2 lg:col-span-1",
  // Ultimo dos 4 extras: no lg fecha a linha de 5 em vez de deixar um buraco.
  margem: "lg:col-span-2",
};

export function Indicadores({
  moeda,
  atual,
  anterior,
  comparar,
  rotuloAnterior,
  pontos,
  pontosAnteriores,
  contexto,
  dicas,
  atualizado,
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
  /** "Todas as lojas · Últimos 30 dias · BRL": so para o leitor de tela do grafico. */
  contexto: string;
  /** Avisos que so explicam um numero, na Dica do KPI afetado. */
  dicas: Partial<Record<IdMetrica, string[]>>;
  /** "há 12 min" e o instante (ISO). null = nada lido ainda. */
  atualizado: { texto: string; iso: string } | null;
  cascata: ReactNode;
}) {
  const [metrica, setMetrica] = useState<IdMetrica | null>(null);
  const [granEscolhida, setGran] = useState<Granularidade>("dia");
  const [todas, setTodas] = useState(false);

  const comparando = comparar === "anterior";
  const semBase = comparando && !temMovimento(anterior);
  const compara = comparando && !semBase;

  const dias = pontos.map((p) => p.dia);
  const opcoesGran = granularidades(dias);
  const gran = opcoesGran.find((o) => o.valor === granEscolhida && !o.desabilitado) ? granEscolhida : "dia";

  function escolher(id: IdMetrica) {
    setMetrica((m) => (m === id ? null : id));
    // No celular o grafico fica abaixo dos cartoes: leva ate ele.
    const alvo = document.getElementById("grafico-lucro");
    if (alvo && window.matchMedia("(max-width: 1023px)").matches) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      alvo.scrollIntoView({ block: "start", behavior: suave ? "smooth" : "auto" });
    }
  }

  function cartao(id: IdMetrica, extra?: string) {
    const d = METRICAS[id];
    const v = valorDe(atual, id);
    const va = valorDe(anterior, id);
    let variacao: number | null | undefined;
    if (compara) {
      if (d.formatoVariacao === "pp") variacao = v !== null && va !== null ? v - va : null;
      else variacao = calcularVariacao(v, va);
    }
    const destaque = id === "lucro";
    let valor: ReactNode = null;
    if (v !== null) {
      const { texto, negativo } = valorComSinal(formatarMetrica(id, v, moeda, true), v);
      valor =
        destaque || negativo ? (
          <span className={clsx(destaque && "text-kpi", negativo && "text-err")}>
            {texto}
          </span>
        ) : (
          texto
        );
    }
    const notas = dicas[id];
    return (
      <KpiCard
        key={id}
        className={clsx(CLASSE_KPI[id], extra)}
        rotulo={d.rotulo}
        valor={valor}
        variacao={variacao}
        bom={d.bom}
        formatoVariacao={d.formatoVariacao}
        anterior={compara && va !== null ? valorComSinal(formatarMetrica(id, va, moeda, true), va).texto : undefined}
        estado={
          destaque && temMovimento(atual)
            ? atual.lucro < 0
              ? { tom: "err", texto: "Prejuízo" }
              : { tom: "ok", texto: "Lucro" }
            : undefined
        }
        detalhe={detalheDe(atual, id, moeda)}
        definicao={
          notas?.length ? (
            <span className="flex flex-col gap-1.5">
              <span>{d.definicao}</span>
              {notas.map((n) => (
                <span key={n} className="font-semibold">
                  {n}
                </span>
              ))}
            </span>
          ) : (
            d.definicao
          )
        }
        motivoSemDado={d.semDado}
        serie={pontos.length > 1 ? pontos.map((p) => derivar(p)[id]) : undefined}
        onSelecionar={() => escolher(id)}
        selecionado={metrica === id}
      />
    );
  }

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
  if (compara && pontosAnteriores === null) nota = "A linha do período anterior não carregou. Atualize a página.";
  else if (compara && gran === "mes") nota = "Por mês, sem a linha do período anterior: os meses têm tamanhos diferentes.";
  const semMovimento = !pontos.some((p) => temMovimento(p));

  let corpo: ReactNode;
  if (pontos.length < 2) {
    corpo = (
      <EmptyState
        variante="tracejado"
        titulo="Um dia só não forma uma linha"
        descricao="Escolha 7 ou 30 dias na barra do topo."
        className="min-h-60"
      />
    );
  } else if (semMovimento) {
    corpo = (
      <EmptyState
        variante="tracejado"
        titulo="Ainda não há vendas para desenhar"
        descricao="O gráfico aparece depois do primeiro pedido."
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
      <section aria-label="Indicadores do período" className="flex flex-col gap-2">
        <div className="flex min-h-ctl-sm flex-wrap items-center gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-label text-t2">
            {atualizado && (
              <span>
                {/* Nao "Atualizado": o topo ja usa a palavra para a hora da leitura. */}
                Último dado recebido <time dateTime={atualizado.iso}>{atualizado.texto}</time>
              </span>
            )}
            {atualizado && semBase && " · "}
            {semBase && <span>Sem base de comparação em {rotuloAnterior}</span>}
          </p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={todas}
            aria-controls="kpis-lucro"
            onClick={() => setTodas((t) => !t)}
          >
            {todas ? "Menos métricas" : `+${KPIS_MAIS.length} métricas`}
            <ChevronDown aria-hidden className={clsx("transition-transform", todas && "rotate-180")} />
          </Button>
        </div>
        <div id="kpis-lucro" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {KPIS_PRINCIPAIS.map((id) => cartao(id))}
          {todas && KPIS_MAIS.map((id) => cartao(id))}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section
          id="grafico-lucro"
          className="scroll-mt-32"
          titulo={titulo}
          acoes={
            <>
              {metrica && (
                <Button variant="link" size="sm" onClick={() => setMetrica(null)}>
                  Voltar para faturamento, gasto e lucro
                </Button>
              )}
              {pontos.length > 1 && (
                <Segmented rotulo="Agrupar por" valor={gran} onValorChange={setGran} opcoes={opcoesGran} />
              )}
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
