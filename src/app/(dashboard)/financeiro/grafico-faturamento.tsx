"use client";

import { useState } from "react";
import { BarChart3, LineChart as IconeTotal } from "lucide-react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import type { PontoDia } from "@/lib/leitura/serie-diaria";
import { COR_PARTE } from "./cascata";
import { agrupar, dinheiro, granularidades, temMovimento, type Granularidade } from "./lucro-dados";

// ============================================================================
// "Faturamento": uma barra por dia (ou semana/mes), empilhada em lucro,
// anuncios, produto + frete e taxas -- ou so o faturamento. Divs com altura
// em %, sem lib de grafico. O tooltip abre no hover e no foco do teclado.
// ============================================================================

type Tipo = "barra" | "total";

interface Barra {
  rotulo: string;
  parcial: boolean;
  receita: number;
  lucro: number;
  gasto: number;
  cmv: number;
  taxas: number;
}

const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const PASSOS = [1, 2, 2.5, 5, 10];

/** Passo "redondo" para 4 linhas de grade que cubram o maximo. */
function passoDo(max: number): number {
  const bruto = max / 4;
  const ordem = 10 ** Math.floor(Math.log10(bruto));
  return (PASSOS.find((p) => p * ordem >= bruto) ?? 10) * ordem;
}

export function GraficoFaturamento({
  pontos,
  moeda,
  contexto,
}: {
  /** Periodo atual, do dia mais antigo para o mais novo. */
  pontos: PontoDia[];
  moeda: string;
  /** "Todas as lojas · Últimos 30 dias · BRL": para o leitor de tela. */
  contexto: string;
}) {
  const [tipo, setTipo] = useState<Tipo>("barra");
  const [granEscolhida, setGran] = useState<Granularidade>("dia");
  const [hov, setHov] = useState<number | null>(null);

  const dias = pontos.map((p) => p.dia);
  const opcoesGran = granularidades(dias);
  const gran = opcoesGran.find((o) => o.valor === granEscolhida && !o.desabilitado) ? granEscolhida : "dia";

  const barras: Barra[] = agrupar(pontos, dias, gran).map((g) => {
    const s = g.soma ?? { pedidos: 0, receita: 0, cmv: 0, taxas: 0, gastoMeta: 0, gastoGoogle: 0 };
    const gasto = s.gastoMeta + s.gastoGoogle;
    return {
      rotulo: g.rotulo,
      parcial: g.parcial,
      receita: s.receita,
      gasto,
      cmv: s.cmv,
      taxas: s.taxas,
      lucro: s.receita - s.cmv - s.taxas - gasto,
    };
  });

  const n = barras.length;
  // Dia de prejuizo: os custos passam do faturamento e a barra fica mais alta.
  const max = Math.max(1, ...barras.map((b) => (tipo === "total" ? b.receita : Math.max(b.receita, b.cmv + b.taxas + b.gasto))));
  const passo = passoDo(max * 1.05);
  const topo = passo * 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => compacto.format(i * passo));
  const cada = n <= 10 ? 1 : n <= 20 ? 2 : 5;
  const altura = (v: number) => `${(Math.max(0, v) / topo) * 100}%`;

  const partes = (b: Barra): [string, number, string][] =>
    tipo === "total"
      ? [["receita", b.receita, COR_PARTE.receita]]
      : (
          [
            ["lucro", b.lucro, COR_PARTE.lucro],
            ["gasto", b.gasto, COR_PARTE.gasto],
            ["cmv", b.cmv, COR_PARTE.cmv],
            ["taxas", b.taxas, COR_PARTE.taxas],
          ] as [string, number, string][]
        ).filter((p) => p[1] > 0);

  const legenda: [string, string][] =
    tipo === "total"
      ? [["Faturamento", COR_PARTE.receita]]
      : [
          ["Lucro", COR_PARTE.lucro],
          ["Anúncios", COR_PARTE.gasto],
          ["Produto + frete", COR_PARTE.cmv],
          ["Taxas", COR_PARTE.taxas],
        ];

  const hv = hov !== null ? barras[hov] : undefined;
  const linhasTip: [string, number, string][] = hv
    ? [
        ["Faturamento", hv.receita, COR_PARTE.receita],
        ["Lucro", hv.lucro, hv.lucro < 0 ? COR_PARTE.prejuizo : COR_PARTE.lucro],
        ["Anúncios", hv.gasto, COR_PARTE.gasto],
        ["Produto + frete", hv.cmv, COR_PARTE.cmv],
        ["Taxas", hv.taxas, COR_PARTE.taxas],
      ]
    : [];

  const porGran = gran === "dia" ? "por dia" : gran === "semana" ? "por semana" : "por mês";
  const semMovimento = !pontos.some((p) => temMovimento(p));
  const gap = n > 20 ? "gap-1" : "gap-2.5";

  return (
    <section
      id="grafico-lucro"
      aria-labelledby="grafico-lucro-t"
      className="flex min-w-0 scroll-mt-32 flex-col gap-3.5 rounded-overlay border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id="grafico-lucro-t" className="flex-1 text-overlay">
          Faturamento
        </h2>
        {n > 1 && pontos.length > 7 && (
          <Segmented rotulo="Agrupar por" valor={gran} onValorChange={setGran} opcoes={opcoesGran} />
        )}
        <div role="radiogroup" aria-label="Tipo de gráfico" className="flex gap-1">
          {(
            [
              ["barra", "Barras empilhadas", BarChart3],
              ["total", "Só faturamento", IconeTotal],
            ] as const
          ).map(([id, rotulo, Icone]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={tipo === id}
              aria-label={rotulo}
              title={rotulo}
              onClick={() => setTipo(id)}
              className={clsx(
                "grid size-8 place-items-center rounded-control border border-border",
                tipo === id ? "bg-info text-surface" : "bg-surface text-t1 hover:bg-hover"
              )}
            >
              <Icone aria-hidden className="size-4" strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>

      {semMovimento ? (
        <EmptyState
          variante="tracejado"
          titulo="Ainda não há vendas para desenhar"
          descricao="O gráfico aparece depois do primeiro pedido."
          className="min-h-60"
        />
      ) : (
        <>
          <div role="group" aria-label="Legenda" className="flex flex-wrap gap-3.5">
            {legenda.map(([rotulo, cor]) => (
              <span key={rotulo} className="flex items-center gap-1.5 text-label text-t1">
                <span aria-hidden className={clsx("size-2.5 rounded-[3px]", cor)} />
                {rotulo}
              </span>
            ))}
          </div>
          <div className="grid h-60 grid-cols-[44px_1fr] gap-2" onMouseLeave={() => setHov(null)}>
            <div aria-hidden className="flex flex-col justify-between pb-[22px]">
              {ticks.map((t, i) => (
                <span key={i} className="num text-right text-label leading-none text-t2">
                  {t}
                </span>
              ))}
            </div>
            <div className="relative flex flex-col">
              <div aria-hidden className="absolute inset-x-0 top-0 bottom-[22px] flex flex-col justify-between">
                {ticks.map((_, i) => (
                  <span key={i} className="h-px bg-chart-grid" />
                ))}
              </div>
              <div
                role="img"
                aria-label={`Faturamento ${porGran}, dividido em lucro, anúncios, produto e taxas, ${contexto}`}
                className={clsx("relative flex flex-1 items-end", gap)}
              >
                {barras.map((b, i) => (
                  <div
                    key={i}
                    tabIndex={0}
                    onMouseEnter={() => setHov(i)}
                    onFocus={() => setHov(i)}
                    onBlur={() => setHov(null)}
                    aria-label={`${b.rotulo}: faturamento ${dinheiro(b.receita, moeda)}, lucro ${dinheiro(b.lucro, moeda)}`}
                    className={clsx(
                      "flex h-full flex-1 cursor-pointer flex-col justify-end outline-none focus-visible:ring-2 focus-visible:ring-focus",
                      hov !== null && hov !== i && "opacity-55"
                    )}
                  >
                    {b.receita <= 0 && b.gasto + b.cmv + b.taxas <= 0 && <span className="h-0.5 rounded-[1px] bg-border-strong" />}
                    {partes(b).map(([id, v, cor], j) => (
                      <span
                        key={id}
                        className={clsx(cor, j === 0 && "rounded-t-sm", b.parcial && "opacity-60")}
                        style={{ height: altura(v) }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div aria-hidden className={clsx("flex h-[22px] items-end", gap)}>
                {barras.map((b, i) => (
                  <span key={i} className="flex-1 overflow-visible whitespace-nowrap text-center text-label text-t2">
                    {i % cada === 0 || i === n - 1 ? b.rotulo : ""}
                  </span>
                ))}
              </div>
              {hv && hov !== null && (
                <div
                  role="status"
                  className="pointer-events-none absolute top-0 z-10 flex min-w-52 flex-col gap-1.5 rounded-card border border-border bg-surface px-3 py-2.5 shadow-md"
                  style={{
                    left: `${((hov + 0.5) / n) * 100}%`,
                    transform: hov > n * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
                  }}
                >
                  <strong className="text-label">
                    {hv.rotulo}
                    {hv.parcial ? " · parcial" : ""}
                  </strong>
                  {linhasTip.map(([rotulo, v, cor]) => (
                    <span key={rotulo} className="num flex items-center gap-2 text-label">
                      <span aria-hidden className={clsx("size-2 rounded-[2px]", cor)} />
                      <span className="flex-1 text-t1">{rotulo}</span>
                      <strong className={clsx("font-semibold", v < 0 && "text-err")}>
                        {dinheiro(v, moeda).replace(/^-/, "−")}
                      </strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
