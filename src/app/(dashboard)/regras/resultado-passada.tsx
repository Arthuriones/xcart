"use client";

import { MAX_ACOES_POR_PASSADA, type MetricaRegra } from "@/lib/ads/gerenciar-regras";
import type { AcaoPassada, ResultadoPassada } from "@/lib/ads/regras-tipos";
import { textoDaAcao, valorDaMetricaTexto } from "./apresentar";

// ============================================================================
// O que uma passada fez (ultimo resultado) ou faria (simulacao): a lista de
// objetos com a metrica e a acao, os que bateram mas ficaram de fora e os
// avisos. O mesmo desenho nos dois, so o verbo muda.
// ============================================================================

function LinhaAcao({
  a,
  metrica,
  moeda,
  simulacao,
}: {
  a: AcaoPassada;
  metrica: MetricaRegra;
  moeda: string | null;
  simulacao: boolean;
}) {
  const falhou = a.ok === false;
  return (
    <li className="flex flex-col gap-0.5 border-b border-border-subtle py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 font-medium break-words text-ink">{a.nome}</span>
        <span className="num text-label text-t2">{valorDaMetricaTexto(metrica, a.valorMetrica, moeda)}</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-label">
        <span className="text-t3">{a.contaNome}</span>
        <span className={falhou ? "font-medium text-err" : "text-t1"}>
          {falhou ? `Falhou: ${a.erro || "o Meta recusou"}` : textoDaAcao(a, moeda, simulacao)}
        </span>
      </div>
    </li>
  );
}

export function ResultadoDaPassada({
  resultado,
  metrica,
  moeda,
  simulacao,
}: {
  resultado: ResultadoPassada;
  metrica: MetricaRegra;
  moeda: string | null;
  simulacao: boolean;
}) {
  const { acoes, ignorados, cortados, avisos } = resultado;
  return (
    <div className="flex flex-col gap-3 text-dense">
      {acoes.length === 0 ? (
        <p className="text-t2">
          {simulacao ? "Nenhum objeto bate a condição agora: a regra não faria nada." : "Nenhum objeto bateu a condição."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {acoes.map((a) => (
            <LinhaAcao key={`${a.objetoId}-${a.acao}`} a={a} metrica={metrica} moeda={moeda} simulacao={simulacao} />
          ))}
        </ul>
      )}

      {cortados > 0 ? (
        <p className="text-label text-t2">
          {cortados} {cortados === 1 ? "outro bateu" : "outros bateram"} a condição e{" "}
          {simulacao ? "ficariam" : "ficaram"} para a próxima passada (no máximo {MAX_ACOES_POR_PASSADA} ações por
          passada).
        </p>
      ) : null}

      {ignorados.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium text-t2">Bateram a condição, mas {simulacao ? "ficariam" : "ficaram"} de fora</p>
          <ul className="flex flex-col gap-0.5 text-label">
            {ignorados.map((i) => (
              <li key={i.objetoId} className="text-t1">
                <span className="font-medium text-ink">{i.nome}</span>: {i.motivo}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {avisos.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-label font-medium text-warn">
          {avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
