"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import clsx from "clsx";
import { Dica } from "@/components/ui/dica";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  descreverVariacao,
  direcaoVariacao,
  formatarVariacao,
  tomVariacao,
  type BomQuando,
  type FormatoVariacao,
} from "@/components/ui/variacao";
import type { PontoDia } from "@/lib/leitura/serie-diaria";
import { GraficoLinha, type LinhaExtra } from "./grafico-faturamento";
// So o tipo: os indicadores sao montados no servidor.
import type { Indicador } from "./indicadores";
import {
  COR_SERIE,
  dinheiro,
  granularidadePadrao,
  granularidades,
  inteiro,
  montarSerieLinha,
  porcento,
  temMovimento,
  tipoDaSerie,
  trilhaSparkline,
  valorComSinal,
  valorDaSerie,
  valoresDaSerie,
  vaoDaCelula,
  vezes,
  type DefinicaoMetrica,
  type Granularidade,
  type IdSerie,
} from "./lucro-dados";

// ============================================================================
// O destaque do Dashboard e a faixa de KPIs (mockup "design novo/
// Dashboard.dc.html"): um numero grande com o semaforo e a variacao, o grafico
// de linha com o periodo anterior tracejado e, embaixo, os KPIs. Clicar num KPI
// troca a metrica do destaque e do grafico (clicar de novo volta ao lucro). A
// composicao do lucro vem pronta do servidor e so ocupa a coluna da direita.
//
// Os numeros vem prontos (indicadores.tsx); aqui so a escolha da metrica, o
// agrupamento e o desenho.
// ============================================================================

/** "anterior": compara e ha base; "sem-base": compara, mas o anterior nao teve movimento. */
export type ModoComparacao = "anterior" | "sem-base" | "nenhuma";

const COR_TOM = { ok: "text-ok", err: "text-err", neutral: "text-t2" } as const;
const FUNDO_TOM = { ok: "bg-ok-bg", err: "bg-err-bg", neutral: "bg-neutral-bg" } as const;

/** Grade de 2 colunas no celular e de 4 a partir de 912px de painel: a ultima linha nao deixa buraco. */
const VAO_2: Record<number, string> = { 1: "", 2: "col-span-2" };
const VAO_4: Record<number, string> = {
  1: "@min-[912px]:col-span-1",
  2: "@min-[912px]:col-span-2",
  3: "@min-[912px]:col-span-3",
  4: "@min-[912px]:col-span-4",
};

/** Seta, numero e a frase para o leitor de tela. `pilula`: com fundo (destaque). */
function Variacao({
  valor,
  bom,
  formato,
  pilula = false,
}: {
  valor: number | null;
  bom: BomQuando;
  formato?: FormatoVariacao;
  pilula?: boolean;
}) {
  const semBase = valor === null || !Number.isFinite(valor);
  const tom = semBase ? "neutral" : tomVariacao(valor, bom);
  const direcao = semBase ? "estavel" : direcaoVariacao(valor);
  const Icone = direcao === "sobe" ? ArrowUp : direcao === "desce" ? ArrowDown : Minus;
  return (
    <span
      className={clsx(
        "num inline-flex shrink-0 items-center gap-0.5 font-semibold",
        COR_TOM[tom],
        pilula && ["h-5 rounded-sm px-1.5", FUNDO_TOM[tom]]
      )}
    >
      <Icone aria-hidden className="size-3" strokeWidth={2.25} />
      <span aria-hidden>{formatarVariacao(semBase ? null : valor, formato)}</span>
      <span className="sr-only">{descreverVariacao(semBase ? null : valor, formato)}</span>
    </span>
  );
}

function Explicacao({ c }: { c: Indicador }) {
  return (
    <span className="flex flex-col gap-1.5">
      <span>{c.definicao}</span>
      {c.notas?.map((n) => (
        <span key={n} className="font-semibold">
          {n}
        </span>
      ))}
    </span>
  );
}

function formatarSerie(v: number, tipo: DefinicaoMetrica["tipo"], moeda: string): string {
  if (tipo === "dinheiro") return dinheiro(v, moeda);
  if (tipo === "vezes") return vezes(v);
  if (tipo === "pct") return porcento(v);
  return inteiro(v);
}

const POR_GRAN: Record<Granularidade, string> = { dia: "por dia", semana: "por semana", mes: "por mês" };

export function PainelLucro({
  moeda,
  principal,
  celulas,
  atual,
  anterior,
  comparacao,
  umDia,
  rotuloPeriodo,
  rotuloAnterior,
  contexto,
  rotuloReceita,
  rotuloLucro,
  rotuloPedidos,
  composicao,
}: {
  moeda: string;
  principal: Indicador;
  celulas: Indicador[];
  /** Periodo atual, do dia mais antigo para o mais novo. */
  atual: PontoDia[];
  /** Periodo anterior, alinhado por posicao. null = a serie nao foi lida. */
  anterior: PontoDia[] | null;
  comparacao: ModoComparacao;
  /** Periodo de um dia so: nao ha serie por hora para desenhar. */
  umDia: boolean;
  /** "Últimos 30 dias": legenda da linha. */
  rotuloPeriodo: string;
  /** "26/08–24/09": o periodo anterior. */
  rotuloAnterior: string;
  /** "Todas as lojas · Últimos 30 dias (25/09–24/10) · BRL", para o leitor de tela. */
  contexto: string;
  /** "Recebido" em contra entrega. */
  rotuloReceita: string;
  /** A linha do lucro: "Lucro estimado", ou "Lucro realizado" em contra entrega. */
  rotuloLucro: string;
  /** "Pedidos", ou "Pedidos pagos"/"Pedidos aprovados" em contra entrega (a serie conta so os que entraram). */
  rotuloPedidos: string;
  /** A composicao do lucro (server component), na coluna da direita. */
  composicao: ReactNode;
}) {
  // null = o numero principal (lucro); senao o id da celula escolhida.
  const [escolhida, setEscolhida] = useState<string | null>(null);
  // null = o padrao do periodo: por semana quando o periodo passa de 45 dias.
  const [granEscolhida, setGran] = useState<Granularidade | null>(null);

  const m = (escolhida !== null && celulas.find((c) => c.id === escolhida && c.serie)) || principal;
  const idSerie: IdSerie = m.serie ?? "lucro";
  const cor = COR_SERIE[idSerie];
  const tipo = tipoDaSerie(idSerie);

  const dias = atual.map((p) => p.dia);
  const opcoesGran = granularidades(dias);
  const valida = (g: Granularidade | null): g is Granularidade =>
    g !== null && opcoesGran.some((o) => o.valor === g && !o.desabilitado);
  const padrao = granularidadePadrao(dias);
  const gran: Granularidade = valida(granEscolhida) ? granEscolhida : valida(padrao) ? padrao : "dia";

  const serie = montarSerieLinha({ atual, anterior: comparacao === "anterior" ? anterior : null, gran });
  const valores = valoresDaSerie(serie.atual, idSerie);
  const anteriores = serie.anterior ? valoresDaSerie(serie.anterior, idSerie) : null;
  const semMovimento = !atual.some((p) => temMovimento(p));
  const rotuloSerie = m.rotuloSerie ?? m.rotulo;

  // As outras metricas do ponto no tooltip (faturamento, gasto, lucro, pedidos).
  const ROTULO_EXTRA: Partial<Record<IdSerie, string>> = {
    receita: rotuloReceita,
    gasto: "Gasto em anúncios",
    lucro: rotuloLucro,
    pedidos: rotuloPedidos,
  };
  const extras = (i: number): LinhaExtra[] => {
    const soma = serie.atual[i];
    if (!soma) return [];
    return (["receita", "gasto", "lucro", "pedidos"] as IdSerie[])
      .filter((k) => k !== idSerie)
      .slice(0, 3)
      .map((k) => {
        const v = valorDaSerie(soma, k);
        return {
          rotulo: ROTULO_EXTRA[k] ?? k,
          texto: v === null ? "—" : formatarSerie(v, tipoDaSerie(k), moeda),
          negativo: v !== null && v < 0,
        };
      });
  };

  // O segmentado mostra Lucro, Faturamento (Recebido) e Gasto; um KPI de
  // outra metrica escolhido deixa os tres desmarcados.
  const celulaDaSerie = (s: IdSerie) => celulas.find((c) => c.serie === s);
  const segmento = escolhida === null ? "lucro" : m.serie === "receita" || m.serie === "gasto" ? m.serie : "outra";
  function escolherSegmento(v: string) {
    if (v === "lucro") setEscolhida(null);
    else setEscolhida(celulaDaSerie(v as IdSerie)?.id ?? null);
  }

  const valor = valorComSinal(m.texto, m.valor);
  const parcialHoje = serie.parcialUltimo;

  const destaque = (
    <section aria-labelledby="destaque-t" className="flex min-w-0 flex-col rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <h2 id="destaque-t" className="text-dense font-medium text-t2">
              {m.rotulo}
            </h2>
            <Dica rotulo={`O que é ${m.rotulo}`}>
              <Explicacao c={m} />
            </Dica>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={clsx(
                // A altura de linha so no celular: leading-* vale por cima da do
                // token, e no desktop o text-display tem a dele (44px).
                "num whitespace-nowrap text-[32px] font-semibold tracking-[-0.03em] max-[759px]:leading-9 min-[760px]:text-display",
                valor.negativo ? "text-err" : "text-ink"
              )}
            >
              {valor.texto}
            </span>
            {m === principal && principal.selo && <StatusBadge tom={principal.selo.tom} texto={principal.selo.texto} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-label text-t3">
            {comparacao === "nenhuma" ? (
              <span>Sem comparação</span>
            ) : comparacao === "sem-base" || m.variacao === undefined || (m.variacao === null && !m.anterior) ? (
              <span>Sem base de comparação em {rotuloAnterior}</span>
            ) : (
              <>
                <Variacao valor={m.variacao} bom={m.bom} formato={m.formato} pilula />
                {m.anterior && (
                  <span className="num">
                    vs. {m.anterior.cheio.replace(/^-/, "−")} em {rotuloAnterior}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            rotulo="Métrica do gráfico"
            valor={segmento}
            onValorChange={escolherSegmento}
            opcoes={[
              { valor: "lucro", rotulo: "Lucro" },
              { valor: "receita", rotulo: rotuloReceita },
              { valor: "gasto", rotulo: "Gasto" },
            ]}
          />
          {!umDia && dias.length > 7 && (
            <Segmented rotulo="Agrupar por" valor={gran} onValorChange={setGran} opcoes={opcoesGran} />
          )}
        </div>
      </div>

      {umDia ? (
        // flex-1: o cartao estica ate a altura da Composicao ao lado, e a nota
        // ocupa esse espaco em vez de deixar um vao embaixo dela.
        <p className="mx-5 mt-5 mb-5 grid min-h-40 flex-1 place-items-center rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-dense text-t2 text-pretty">
          Com um dia só, não há linha para desenhar. Escolha 7 dias ou mais para ver a evolução.
        </p>
      ) : semMovimento ? (
        <EmptyState
          variante="tracejado"
          titulo="Ainda não há vendas para desenhar"
          descricao="O gráfico aparece depois do primeiro pedido."
          className="m-5 min-h-60"
        />
      ) : (
        <>
          <GraficoLinha
            key={`${m.id}-${gran}`}
            valores={valores}
            anteriores={anteriores}
            rotulos={serie.rotulos}
            titulos={serie.titulos}
            parcialUltimo={parcialHoje}
            cor={cor}
            tipo={tipo}
            rotuloSerie={rotuloSerie}
            formatar={(v) => formatarSerie(v, tipo, moeda)}
            extras={extras}
            ariaLabel={`${rotuloSerie} ${POR_GRAN[gran]}, ${contexto}${anteriores ? ", com o período anterior tracejado" : ""}. Use as setas para ler cada ponto.`}
          />
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 pt-2 pb-4 text-label text-t3">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3.5 rounded-[1px]" style={{ background: `var(--${cor})` }} />
              {m.rotuloSerie ? `${m.rotuloSerie} · ${rotuloPeriodo}` : rotuloPeriodo}
            </span>
            {anteriores && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="w-3.5 border-t-2 border-dashed border-t4" />
                {rotuloAnterior}
              </span>
            )}
            {parcialHoje && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="w-3.5 border-t-2 border-dotted" style={{ borderColor: `var(--${cor})` }} />
                hoje, parcial
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );

  const n = celulas.length;
  return (
    <>
      <div className="grid items-stretch gap-4 min-[760px]:gap-6 @min-[1032px]:grid-cols-[minmax(0,1fr)_380px]">
        {destaque}
        {composicao}
      </div>

      <section
        aria-label="Indicadores do período"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border @min-[912px]:grid-cols-4"
      >
        {celulas.map((c, i) => {
          const on = m.id === c.id;
          const corCelula = c.serie ? `var(--${COR_SERIE[c.serie]})` : undefined;
          const spark = c.serie ? trilhaSparkline(valoresDaSerie(serie.atual, c.serie), 64, 20) : "";
          const v = valorComSinal(c.texto, c.valor);
          const vs = c.sub ?? (c.variacao !== undefined && c.anterior ? `vs. ${c.anterior.compacto.replace(/^-/, "−")}` : undefined);
          return (
            <div
              key={c.id}
              className={clsx(
                "relative flex min-w-0 flex-col gap-1 px-3.5 py-3 min-[760px]:px-5 min-[760px]:py-4",
                VAO_2[vaoDaCelula(i, n, 2)],
                VAO_4[vaoDaCelula(i, n, 4)],
                on ? "bg-surface-2" : "bg-surface",
                c.serie &&
                  "hover:bg-surface-2 has-[.kpi-alvo:focus-visible]:outline-2 has-[.kpi-alvo:focus-visible]:-outline-offset-2 has-[.kpi-alvo:focus-visible]:outline-focus"
              )}
              style={on ? { boxShadow: `inset 0 2px 0 ${corCelula}` } : undefined}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-0.5">
                  {c.serie ? (
                    // O botao cobre a celula inteira (::after); a Dica fica por cima.
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${c.rotulo}: ${v.texto}. ${c.variacao !== undefined ? `${descreverVariacao(c.variacao ?? null, c.formato)}. ` : ""}${on ? `No gráfico; toque para voltar ao ${principal.rotulo.toLowerCase()}.` : "Mostrar no gráfico."}`}
                      onClick={() => setEscolhida(on ? null : c.id)}
                      className="kpi-alvo truncate text-left text-label font-medium text-t2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                    >
                      {c.rotulo}
                    </button>
                  ) : (
                    <span className="truncate text-label font-medium text-t2">{c.rotulo}</span>
                  )}
                  <Dica rotulo={`O que é ${c.rotulo}`} className="z-10 -my-1">
                    <Explicacao c={c} />
                  </Dica>
                </span>
                {/* Abaixo de 760px a celula tem uns 140px: com a sparkline e a
                    Dica, o rotulo ficava com 5 letras e "Custos totais" e
                    "Custo de produto" viravam o mesmo "Custo…". */}
                {spark && (
                  <svg
                    viewBox="0 0 64 20"
                    width={64}
                    height={20}
                    aria-hidden
                    className="hidden shrink-0 overflow-visible min-[760px]:block"
                  >
                    <path
                      d={spark}
                      fill="none"
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      style={{ stroke: on ? corCelula : "var(--t4)" }}
                    />
                  </svg>
                )}
              </span>
              <span
                className={clsx(
                  // Valor nunca vira reticencias (esconderia o numero): 16px no
                  // celular cabe "US$ 591.532,01" em 360px, e o que passar
                  // disso quebra a linha em vez de sumir.
                  "num break-words text-[16px] font-semibold tracking-[-0.015em] max-[759px]:leading-6 min-[760px]:text-kpi",
                  v.negativo ? "text-err" : "text-ink"
                )}
              >
                {v.texto}
              </span>
              <span className="num flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-label text-t3">
                {c.variacao !== undefined && <Variacao valor={c.variacao} bom={c.bom} formato={c.formato} />}
                {vs && <span className="min-w-0">{vs}</span>}
                {c.detalhe && <span className="min-w-0">{c.detalhe}</span>}
                {c.selo && <span className={c.selo.tom === "ok" ? "text-ok" : "text-warn"}>{c.selo.texto}</span>}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}
