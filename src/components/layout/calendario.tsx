"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { TETO_PERSONALIZADO_DIAS, type Intervalo } from "@/lib/financeiro/tipos";
import {
  diaBloqueado,
  escolherDia,
  limitarDia,
  limitesDoCalendario,
  mesDo,
  moverFoco,
  ordenar,
  semanasDoMes,
  somarMeses,
  somarMesesAoDia,
} from "./calendario-regras";
import { MESES_LONGOS, rotuloDatas, rotuloDias } from "./contexto";

// ============================================================================
// Calendario do periodo "Personalizado": um mes por vez, um dia ou um
// intervalo (de-ate). Sem biblioteca: uma tabela role="grid" com foco
// itinerante (so um dia entra no Tab), setas, Home/End e PageUp/PageDown.
// As regras (limites, teto, clique, teclas) moram em calendario-regras.ts.
//
// Quem usa guarda a escolha (`valor`) e decide quando aplicar: o calendario
// so avisa a cada clique. O primeiro clique ja vale um dia so.
// ============================================================================

const SEMANA: [string, string][] = [
  ["D", "domingo"],
  ["S", "segunda-feira"],
  ["T", "terça-feira"],
  ["Q", "quarta-feira"],
  ["Q", "quinta-feira"],
  ["S", "sexta-feira"],
  ["S", "sábado"],
];

const porExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function rotuloDoMes(mes: string): string {
  return `${MESES_LONGOS[Number(mes.slice(5, 7)) - 1] ?? ""} de ${mes.slice(0, 4)}`;
}

export function Calendario({
  hoje,
  valor,
  aoMudar,
  grande,
  focarAoAbrir,
  rolarAoAbrir,
}: {
  /** Hoje no fuso do relatorio: depois dele, nada se escolhe. */
  hoje: string;
  /** A escolha atual (ainda nao aplicada), ou null. */
  valor: Intervalo | null;
  aoMudar: (i: Intervalo) => void;
  /** Celula de 44px (toque) em vez de 36px. */
  grande?: boolean;
  /** Leva o foco ao dia ao montar (o Pop do desktop troca a lista por isto). */
  focarAoAbrir?: boolean;
  /** Rola ate o calendario ao montar (a folha do celular, depois do toque na pilula). */
  rolarAoAbrir?: boolean;
}) {
  const limites = limitesDoCalendario(hoje);
  const inicial = limitarDia(valor?.ate ?? hoje, limites);
  const [mes, setMes] = useState(() => mesDo(inicial));
  const [foco, setFoco] = useState(inicial);
  // Primeiro clique marcado, esperando o ultimo dia.
  const [inicio, setInicio] = useState<string | null>(null);
  // Dia sob o mouse ou o foco: a previa do intervalo entre os dois cliques.
  const [sobre, setSobre] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const focar = useRef(false);
  const idTitulo = useId();

  // Na montagem (quem usa nao troca estas props depois): depois, quem move o
  // foco e o teclado.
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    if (focarAoAbrir) el.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
    else if (rolarAoAbrir) el.scrollIntoView({ block: "nearest" });
  }, [focarAoAbrir, rolarAoAbrir]);

  useEffect(() => {
    if (!focar.current) return;
    focar.current = false;
    caixa.current?.querySelector<HTMLButtonElement>(`button[data-dia="${foco}"]`)?.focus();
  }, [foco, mes]);

  const mesMin = mesDo(limites.min);
  const mesMax = mesDo(limites.max);

  function irPara(dia: string, moverFocoJunto: boolean) {
    const d = limitarDia(dia, limites);
    // Na borda (hoje, o minimo) o dia nao muda: nada a focar depois.
    focar.current = moverFocoJunto && d !== foco;
    setFoco(d);
    setMes(mesDo(d));
    if (moverFocoJunto && inicio) setSobre(d);
  }

  function trocarMes(n: number) {
    const alvo = somarMeses(mes, n);
    if (alvo < mesMin || alvo > mesMax) return;
    // O dia focavel acompanha o mes visivel; o foco fica no botao do mes.
    irPara(somarMesesAoDia(foco, n), false);
  }

  function escolher(dia: string) {
    if (diaBloqueado(dia, limites, inicio)) return;
    const r = escolherDia(inicio, dia);
    setInicio(r.inicio);
    setFoco(dia);
    aoMudar(r.intervalo);
  }

  function teclar(e: KeyboardEvent<HTMLButtonElement>, dia: string) {
    const alvo = moverFoco(dia, e.key, e.shiftKey);
    if (!alvo) return;
    e.preventDefault();
    irPara(alvo, true);
  }

  // Entre os dois cliques, a faixa vai do inicio ao dia sob o mouse/foco.
  const previa = inicio && sobre && !diaBloqueado(sobre, limites, inicio) ? sobre : inicio;
  const faixa = inicio && previa ? ordenar(inicio, previa) : valor;
  const celula = grande ? "size-ctl-lg" : "size-ctl-md";

  const aviso = inicio
    ? `Início em ${rotuloDatas({ desde: inicio, ate: inicio }, hoje)}. Escolha o último dia.`
    : valor
      ? `${rotuloDatas(valor, hoje)} · ${rotuloDias(valor)}`
      : "Escolha o primeiro dia.";

  // aria-disabled, nao disabled: o botao que trava no limite nao perde o foco.
  const botaoMes =
    "grid size-ctl-md place-items-center rounded-control text-t1 hover:bg-hover hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:text-t4 aria-disabled:hover:bg-transparent";

  return (
    <div ref={caixa} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Mês anterior"
          aria-disabled={mes <= mesMin || undefined}
          onClick={() => trocarMes(-1)}
          className={botaoMes}
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
        <h3 id={idTitulo} aria-live="polite" className="text-dense font-semibold text-ink">
          {rotuloDoMes(mes)}
        </h3>
        <button
          type="button"
          aria-label="Próximo mês"
          aria-disabled={mes >= mesMax || undefined}
          onClick={() => trocarMes(1)}
          className={botaoMes}
        >
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <table role="grid" aria-labelledby={idTitulo} className="mx-auto border-collapse" onMouseLeave={() => setSobre(null)}>
        <thead>
          <tr>
            {SEMANA.map(([curto, longo]) => (
              <th key={longo} scope="col" className="h-7 p-0 text-label font-medium text-t3">
                <span aria-hidden>{curto}</span>
                <span className="sr-only">{longo}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanasDoMes(mes).map((semana, i) => (
            <tr key={i}>
              {semana.map((dia, j) => {
                if (!dia) return <td key={j} className={clsx("p-0", celula)} />;
                const bloqueado = diaBloqueado(dia, limites, inicio);
                const naFaixa = !!faixa && dia >= faixa.desde && dia <= faixa.ate;
                const ponta = !!faixa && (dia === faixa.desde || dia === faixa.ate);
                const escolhido = !!valor && dia >= valor.desde && dia <= valor.ate;
                return (
                  <td key={j} aria-selected={escolhido} className="p-0">
                    <button
                      type="button"
                      data-dia={dia}
                      tabIndex={dia === foco ? 0 : -1}
                      aria-label={porExtenso.format(new Date(`${dia}T12:00:00Z`))}
                      aria-current={dia === hoje ? "date" : undefined}
                      aria-disabled={bloqueado || undefined}
                      onClick={() => escolher(dia)}
                      onKeyDown={(e) => teclar(e, dia)}
                      onMouseEnter={() => setSobre(dia)}
                      onFocus={() => setSobre(dia)}
                      className={clsx(
                        "num grid place-items-center text-dense outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                        celula,
                        ponta
                          ? "rounded-control bg-solid font-semibold text-on-solid"
                          : naFaixa
                            ? "bg-nav-active text-ink"
                            : bloqueado
                              ? "cursor-not-allowed rounded-control text-t4"
                              : "rounded-control text-ink hover:bg-hover",
                        dia === hoje && !ponta && "font-semibold underline underline-offset-4"
                      )}
                    >
                      {Number(dia.slice(8, 10))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 text-label">
        <span aria-live="polite" className="text-t1">
          {aviso}
        </span>
        <span className="text-t3">Até {TETO_PERSONALIZADO_DIAS} dias</span>
      </p>
    </div>
  );
}
