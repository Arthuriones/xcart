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
import { bomComParcial, terminaHoje, textoDoAnterior } from "./comparacao-parcial";
import { GraficoBarras, hachura, type LinhaExtra } from "./grafico-barras";
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
// O destaque do Dashboard e a faixa de KPIs (design do Panda Track, "design
// novo/Panda Track - App.dc.html"): em cima, uma aba por metrica do grafico
// (Lucro, Faturamento, Gasto e ROAS, cada uma com o numero e a variacao);
// embaixo, a frase do periodo e o grafico de barras, com o mesmo ponto do
// periodo anterior como um traco. Depois, a faixa com os outros KPIs. Clicar
// numa aba ou num KPI com serie troca a metrica do grafico (clicar de novo no
// KPI volta ao lucro). A composicao do lucro vem pronta do servidor e so ocupa
// a coluna da direita.
//
// Os numeros vem prontos (indicadores.tsx); aqui so a escolha da metrica, o
// agrupamento e o desenho.
// ============================================================================

/** "anterior": compara e ha base; "sem-base": compara, mas o anterior nao teve movimento. */
export type ModoComparacao = "anterior" | "sem-base" | "nenhuma";

const COR_TOM = { ok: "text-ok", err: "text-err", neutral: "text-t2" } as const;

/** Grade de 2 colunas no celular e de 4 a partir de 912px de painel: a ultima linha nao deixa buraco. */
const VAO_2: Record<number, string> = { 1: "", 2: "col-span-2" };
const VAO_4: Record<number, string> = {
  1: "@min-[912px]:col-span-1",
  2: "@min-[912px]:col-span-2",
  3: "@min-[912px]:col-span-3",
  4: "@min-[912px]:col-span-4",
};

/**
 * As abas do destaque, nesta ordem, depois do numero principal (o lucro): as
 * celulas com estas series saem da faixa de KPIs e viram aba. Em contra
 * entrega o ROAS previsto nao tem serie, e ficam tres abas.
 */
const SERIES_DAS_ABAS: IdSerie[] = ["receita", "gasto", "roas"];

/** Rotulo da aba no cartao estreito: "Gasto em anúncios" quebrava em duas linhas. */
const ROTULO_CURTO_ABA: Record<string, string> = { gasto: "Gasto" };

/** Colunas das abas: 2 x 2 no destaque estreito, todas lado a lado a partir de 640px. */
const COLUNAS_ABAS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @min-[640px]:grid-cols-3",
  4: "grid-cols-2 @min-[640px]:grid-cols-4",
};

/** Seta, numero e a frase para o leitor de tela. */
function Variacao({ valor, bom, formato }: { valor: number | null; bom: BomQuando; formato?: FormatoVariacao }) {
  const semBase = valor === null || !Number.isFinite(valor);
  const tom = semBase ? "neutral" : tomVariacao(valor, bom);
  const direcao = semBase ? "estavel" : direcaoVariacao(valor);
  const Icone = direcao === "sobe" ? ArrowUp : direcao === "desce" ? ArrowDown : Minus;
  return (
    <span
      className={clsx("num inline-flex shrink-0 items-center gap-0.5 font-semibold", COR_TOM[tom])}
    >
      <Icone aria-hidden className="size-3" strokeWidth={2.25} />
      <span aria-hidden>{formatarVariacao(semBase ? null : valor, formato)}</span>
      <span className="sr-only">{descreverVariacao(semBase ? null : valor, formato)}</span>
    </span>
  );
}

function Explicacao({ c, extras }: { c: Indicador; extras?: string[] }) {
  return (
    <span className="flex flex-col gap-1.5">
      <span>{c.definicao}</span>
      {extras?.map((x) => (
        <span key={x} className="num">
          {x}
        </span>
      ))}
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
const MESMO_DO_ANTERIOR: Record<Granularidade, string> = {
  dia: "Mesmo dia do período anterior",
  semana: "Mesma semana do período anterior",
  mes: "Mesmo mês do período anterior",
};

export function PainelLucro({
  moeda,
  principal,
  celulas,
  veredito,
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
  /** "Lucro em 4 de 5 lojas. ROAS real 2,70× contra equilíbrio de 1,69×." */
  veredito: string | null;
  /** Periodo atual, do dia mais antigo para o mais novo. */
  atual: PontoDia[];
  /** Periodo anterior, alinhado por posicao. null = a serie nao foi lida. */
  anterior: PontoDia[] | null;
  comparacao: ModoComparacao;
  /** Periodo de um dia so: nao ha serie por hora para desenhar. */
  umDia: boolean;
  /** "Últimos 30 dias": legenda das barras. */
  rotuloPeriodo: string;
  /** "26/08–24/09": o periodo anterior. */
  rotuloAnterior: string;
  /** "Todas as lojas · Últimos 30 dias (25/09–24/10) · BRL", para o leitor de tela. */
  contexto: string;
  /** "Recebido" em contra entrega. */
  rotuloReceita: string;
  /** A serie do lucro: "Lucro estimado", ou "Lucro realizado" em contra entrega. */
  rotuloLucro: string;
  /** "Pedidos", ou "Pedidos pagos"/"Pedidos aprovados" em contra entrega (a serie conta so os que entraram). */
  rotuloPedidos: string;
  /** A composicao do lucro (server component), na coluna da direita. */
  composicao: ReactNode;
}) {
  // null = o numero principal (lucro); senao o id da aba ou da celula escolhida.
  const [escolhida, setEscolhida] = useState<string | null>(null);
  // null = o padrao do periodo: por semana quando o periodo passa de 45 dias.
  const [granEscolhida, setGran] = useState<Granularidade | null>(null);

  // As abas (o principal e as celulas das series de SERIES_DAS_ABAS) e o resto,
  // que fica na faixa de KPIs.
  const abas: Indicador[] = [
    principal,
    ...SERIES_DAS_ABAS.flatMap((s) => {
      const c = celulas.find((x) => x.serie === s);
      return c ? [c] : [];
    }),
  ];
  const daFaixa = celulas.filter((c) => !abas.includes(c));

  const m = (escolhida !== null && [...abas, ...daFaixa].find((c) => c.id === escolhida && c.serie)) || principal;
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

  const parcialHoje = serie.parcialUltimo;
  // Periodo que termina hoje contra um anterior inteiro: a variacao sai sem
  // verde nem vermelho (comparacao-parcial.ts).
  const terminaEmHoje = terminaHoje(atual);
  const corVar = `var(--${cor})`;

  /** A linha da variacao de uma aba: seta e numero, e "vs. anterior". */
  function linhaDaVariacao(a: Indicador) {
    if (comparacao === "nenhuma") return <span>Sem comparação</span>;
    if (comparacao === "sem-base" || a.variacao === undefined || (a.variacao === null && !a.anterior)) {
      return <span>Sem base de comparação</span>;
    }
    return (
      <>
        <Variacao valor={a.variacao} bom={bomComParcial(a.bom, terminaEmHoje)} formato={a.formato} />
        <span>vs. anterior</span>
      </>
    );
  }

  /**
   * A aba e estreita (4 lado a lado): na tela fica so o detalhe da celula
   * ("R$ X a receber · N aguardando" da venda, "N pagos" em contra entrega).
   * O valor do anterior e o sub (Meta e Google, que a composicao tambem
   * mostra; o equilibrio do ROAS, que o veredito diz) vao para a Dica e para
   * o leitor de tela.
   */
  const anteriorDaAba = (a: Indicador): string | undefined =>
    a.anterior && comparacao === "anterior"
      ? textoDoAnterior(a.anterior.cheio.replace(/^-/, "−"), rotuloAnterior, { umDia, parcial: terminaEmHoje })
      : undefined;
  const extrasDaAba = (a: Indicador): string[] =>
    [anteriorDaAba(a), a.sub].filter((x): x is string => Boolean(x));

  const nAbas = abas.length;
  const destaque = (
    <section
      aria-labelledby="destaque-t"
      // Celular: primeiro da tela, antes da faixa de KPIs (ver o retorno).
      // @container: as abas quebram pela largura do proprio cartao.
      className="@container flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface max-[759px]:order-first"
    >
      <h2 id="destaque-t" className="sr-only">
        {`Métrica do gráfico: ${m.rotulo}`}
      </h2>
      <div
        role="group"
        aria-label="Métrica do gráfico"
        className={clsx("grid gap-px border-b border-border bg-border", COLUNAS_ABAS[nAbas] ?? "grid-cols-2")}
      >
        {abas.map((a, i) => {
          const on = m.id === a.id;
          const corAba = `var(--${COR_SERIE[a.serie ?? "lucro"]})`;
          const v = valorComSinal(a.texto, a.valor);
          return (
            <div
              key={a.id}
              className={clsx(
                "relative flex min-w-0 flex-col gap-1 px-4 pt-3.5 pb-3 min-[760px]:pt-4 min-[760px]:pb-3.5",
                // Numero impar de abas no 2 x 2: a ultima ocupa a linha.
                nAbas % 2 === 1 && i === nAbas - 1 && "col-span-2 @min-[640px]:col-span-1",
                on ? "bg-surface" : "bg-surface-2 hover:bg-surface",
                "has-[.aba-alvo:focus-visible]:outline-2 has-[.aba-alvo:focus-visible]:-outline-offset-2 has-[.aba-alvo:focus-visible]:outline-focus"
              )}
              style={{ boxShadow: on ? `inset 0 2px 0 ${corAba}` : undefined }}
            >
              <span className="flex min-w-0 items-center gap-0.5">
                {/* O botao cobre a aba inteira (::after); a Dica fica por cima. */}
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${a.rotulo}: ${v.texto}. ${a.variacao !== undefined ? `${descreverVariacao(a.variacao ?? null, a.formato)}. ` : ""}${[...extrasDaAba(a), a.detalhe].filter(Boolean).map((x) => `${x}. `).join("")}${on ? "No gráfico." : "Mostrar no gráfico."}`}
                  onClick={() => setEscolhida(a === principal ? null : a.id)}
                  className="aba-alvo min-w-0 text-left text-dense font-medium text-pretty break-words text-t2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                >
                  {ROTULO_CURTO_ABA[a.id] ? (
                    <>
                      <span className="@min-[720px]:hidden">{ROTULO_CURTO_ABA[a.id]}</span>
                      <span className="hidden @min-[720px]:inline">{a.rotulo}</span>
                    </>
                  ) : (
                    a.rotulo
                  )}
                </button>
                <Dica rotulo={`O que é ${a.rotulo}`} className="z-10 -my-1">
                  <Explicacao c={a} extras={extrasDaAba(a)} />
                </Dica>
              </span>
              <span
                className={clsx(
                  // Cresce com o cartao (cqi = 1% da largura dele): a aba tem
                  // metade (2 x 2) ou um quarto dele, menos 32px, e o algarismo
                  // da Instrument Sans mede ~0,5em -- "R$ 209.576,33" cabe na aba
                  // de 1366px a 19px e chega a 24px no cartao largo. Numero longo
                  // ("R$ 1.209.576,33") num degrau abaixo. O que ainda nao couber
                  // quebra entre o "R$" e o numero (espaco comum no lugar do sem
                  // quebra), nunca no meio dos digitos nem em reticencias.
                  "num break-words leading-[1.25] font-semibold tracking-[-0.02em]",
                  v.texto.length > 13
                    ? "text-[length:clamp(15px,calc(6cqi_-_5px),20px)] @min-[640px]:text-[length:clamp(15px,calc(3.05cqi_-_4px),22px)]"
                    : "text-[length:clamp(16px,calc(7cqi_-_5px),22px)] @min-[640px]:text-[length:clamp(16px,calc(3.6cqi_-_5px),24px)]",
                  v.negativo ? "text-err" : on ? "text-ink" : "text-t1"
                )}
              >
                {v.texto.replace(/ /g, " ")}
              </span>
              <span className="num flex min-h-4 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label text-t3">
                {linhaDaVariacao(a)}
              </span>
              {a.detalhe && <span className="num text-label text-t3 text-pretty">{a.detalhe}</span>}
            </div>
          );
        })}
      </div>

      <div className={clsx("flex flex-1 flex-col px-5 pt-4", umDia ? "pb-5" : "pb-4")}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-dense text-t2 text-pretty">
            {principal.selo && <StatusBadge tom={principal.selo.tom} texto={principal.selo.texto} />}
            {veredito && <span>{veredito}</span>}
          </p>
          {!umDia && dias.length > 7 && (
            <Segmented rotulo="Agrupar por" valor={gran} onValorChange={setGran} opcoes={opcoesGran} />
          )}
        </div>

        {umDia ? (
          // flex-1: o cartao estica ate a altura da Composicao ao lado, e a nota
          // ocupa esse espaco em vez de deixar um vao embaixo dela. No celular
          // ela sai: 160px de caixa vazia empurravam os KPIs para baixo.
          <p className="mt-4 hidden min-h-40 flex-1 place-items-center rounded-control border border-dashed border-border-strong px-4 py-6 text-center text-dense text-t2 text-pretty min-[760px]:grid">
            Com um dia só, não há barras para comparar. Escolha 7 dias ou mais para ver a evolução.
          </p>
        ) : semMovimento ? (
          <EmptyState
            variante="tracejado"
            titulo="Ainda não há vendas para desenhar"
            descricao="O gráfico aparece depois do primeiro pedido."
            className="mt-4 min-h-60"
          />
        ) : (
          <>
            <div className="mt-2">
              <GraficoBarras
                key={`${m.id}-${gran}`}
                valores={valores}
                anteriores={anteriores}
                comparavel={serie.comparavel}
                rotulos={serie.rotulos}
                titulos={serie.titulos}
                parcialUltimo={parcialHoje}
                cor={cor}
                tipo={tipo}
                bom={m.bom}
                formato={m.formato}
                gran={gran}
                rotuloSerie={rotuloSerie}
                formatar={(v) => formatarSerie(v, tipo, moeda)}
                extras={extras}
                ariaLabel={`${rotuloSerie} ${POR_GRAN[gran]}, ${contexto}${anteriores ? ", com o mesmo ponto do período anterior" : ""}. Use as setas para ler cada ponto.`}
              />
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-label text-t2">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: corVar }} />
                {m.rotuloSerie ? `${m.rotuloSerie} · ${rotuloPeriodo}` : rotuloPeriodo}
              </span>
              {anteriores && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-3 rounded-[1px] bg-ink opacity-55" />
                  {MESMO_DO_ANTERIOR[gran]}
                </span>
              )}
              {parcialHoje && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{ background: hachura(corVar), border: `1px solid ${corVar}` }}
                  />
                  Parcial
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );

  const n = daFaixa.length;
  // Abaixo de 760px a faixa de KPIs vem logo depois do destaque e a composicao
  // por ultimo: os dois embrulhos viram `contents`, os tres cartoes ficam
  // irmaos de um flex-col e o `order` os arruma. A partir de 760px o embrulho
  // de fora e `contents` e a tela e a de sempre.
  return (
    <div className="contents max-[759px]:flex max-[759px]:flex-col max-[759px]:gap-4">
      <div className="grid items-stretch gap-4 max-[759px]:contents min-[760px]:gap-6 @min-[1032px]:grid-cols-[minmax(0,1fr)_380px]">
        {destaque}
        {composicao}
      </div>

      {n > 0 && (
        <section
          aria-label="Indicadores do período"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border max-[759px]:-order-1 @min-[912px]:grid-cols-4"
        >
          {daFaixa.map((c, i) => {
            const on = m.id === c.id;
            const corCelula = c.serie ? `var(--${COR_SERIE[c.serie]})` : undefined;
            const spark = c.serie ? trilhaSparkline(valoresDaSerie(serie.atual, c.serie), 64, 20) : "";
            const v = valorComSinal(c.texto, c.valor);
            const vs =
              c.sub ?? (c.variacao !== undefined && c.anterior ? `vs. ${c.anterior.compacto.replace(/^-/, "−")}` : undefined);
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
                  {c.variacao !== undefined && (
                    <Variacao valor={c.variacao} bom={bomComParcial(c.bom, terminaEmHoje)} formato={c.formato} />
                  )}
                  {vs && <span className="min-w-0">{vs}</span>}
                  {c.detalhe && <span className="min-w-0">{c.detalhe}</span>}
                  {c.selo && <span className={c.selo.tom === "ok" ? "text-ok" : "text-warn"}>{c.selo.texto}</span>}
                </span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
