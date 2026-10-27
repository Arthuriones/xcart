"use client";

import { useMemo, type ReactNode } from "react";
import { HelpCircle, Layers } from "lucide-react";
import { formatarDinheiro } from "@/lib/financeiro/tipos";
import { derivar, somarLinhas, tomDoRoas, type MetricasCampanha, type SomasCampanha } from "@/lib/campanhas/metricas";
import { vezes } from "../financeiro/lucro-dados";
import type { LinhaCampanha, NivelGranularidade } from "./tipos";
import { MAPA_COLUNAS, ROTULOS_CONTRA_ENTREGA } from "./colunas-config";

interface TabelaCampanhasProps {
  linhas: LinhaCampanha[];
  nivel: NivelGranularidade;
  colunasAtivas: string[];
  /** Moeda do relatorio. */
  moeda: string;
  /** Visao contra entrega: Vendas sao os pedidos gerados, valores previstos. */
  contraEntrega?: boolean;
}

/** Sem dado (sem base, sem detalhe): "—", nunca 0. */
const TRACO = <span className="text-t3">—</span>;

function formatarNumero(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function formatarPorcentagem(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** effective_status do Meta (e o da conta) em palavras. */
function rotuloStatus(status: string | null): { texto: string; ativa: boolean } {
  switch ((status ?? "").toUpperCase()) {
    case "":
      return { texto: "—", ativa: false };
    case "ACTIVE":
      return { texto: "Ativa", ativa: true };
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return { texto: "Pausada", ativa: false };
    case "ARCHIVED":
      return { texto: "Arquivada", ativa: false };
    case "DELETED":
      return { texto: "Excluída", ativa: false };
    case "DISAPPROVED":
      return { texto: "Reprovada", ativa: false };
    case "PENDING_REVIEW":
    case "IN_PROCESS":
      return { texto: "Em análise", ativa: false };
    case "WITH_ISSUES":
      return { texto: "Com problema", ativa: false };
    case "CLOSED":
      return { texto: "Fechada", ativa: false };
    default:
      return { texto: status ?? "—", ativa: false };
  }
}

type Valores = SomasCampanha & MetricasCampanha;

export function TabelaCampanhas({
  linhas,
  nivel,
  colunasAtivas,
  moeda,
  contraEntrega = false,
}: TabelaCampanhasProps) {
  // Linha de total: das somas cruas das linhas visiveis, com a mesma conta das linhas.
  const totais = useMemo<Valores>(() => {
    const somas = somarLinhas(linhas);
    return { ...somas, ...derivar(somas) };
  }, [linhas]);

  const dinheiro = (v: number | null, classe = "text-t2") =>
    v === null ? TRACO : <span className={classe}>{formatarDinheiro(v, moeda)}</span>;
  const pct = (v: number | null, classe = "text-t2") =>
    v === null ? TRACO : <span className={classe}>{formatarPorcentagem(v)}</span>;
  /** IC e video so existem nos dias com detalhe. */
  const doDetalhe = (v: Valores, n: number) =>
    v.detalhe ? <span className="text-t2">{formatarNumero(n)}</span> : TRACO;

  /** As colunas de numero: as mesmas para a linha e para o total. */
  function renderNumeros(v: Valores, colId: string, total: boolean): ReactNode {
    const forte = total ? "font-bold" : "font-semibold";
    switch (colId) {
      case "custo_produto":
        return dinheiro(v.custoProduto);
      case "cpt":
        return dinheiro(v.cpt, "font-medium text-ink");
      case "cpp":
        return dinheiro(v.cpp, "font-medium text-ink");
      case "cpa":
        return dinheiro(v.cpa, "font-medium text-ink");
      case "vendas_totais":
        return <span className="font-bold text-ink">{formatarNumero(v.vendasTotais)}</span>;
      case "vendas":
        return <span className="font-bold text-ink">{formatarNumero(v.vendas)}</span>;
      case "vendas_pendentes":
        return <span className={v.vendasPendentes > 0 ? "text-warn" : "text-t2"}>{formatarNumero(v.vendasPendentes)}</span>;
      // Gastar nao e erro: cor so em Lucro, Margem, ROI e ROAS.
      case "gastos":
        return <span className={`${forte} text-ink`}>{formatarDinheiro(v.gastos, moeda)}</span>;
      case "faturamento":
        return <span className={`${forte} text-ink`}>{formatarDinheiro(v.faturamento, moeda)}</span>;
      case "lucro":
        return (
          <span className={`font-bold ${v.lucro >= 0 ? "text-ok" : "text-err"}`}>{formatarDinheiro(v.lucro, moeda)}</span>
        );
      case "roas": {
        if (v.roas === null) return TRACO;
        const tom = tomDoRoas(v);
        return (
          <span className={`font-semibold ${tom === "ok" ? "text-ok" : tom === "err" ? "text-err" : "text-t2"}`}>
            {vezes(v.roas)}
          </span>
        );
      }
      case "margem":
        return pct(v.margem, v.margem !== null && v.margem >= 0 ? "text-ok" : "text-err");
      case "roi":
        return pct(v.roi, v.roi !== null && v.roi >= 0 ? "text-ok" : "text-err");
      case "cpc":
        return dinheiro(v.cpc);
      case "impressoes":
        return <span className="text-t2">{formatarNumero(v.impressoes)}</span>;
      case "cliques":
        return <span className="text-t2">{formatarNumero(v.cliques)}</span>;
      case "ctr":
        return pct(v.ctr);
      case "cpm":
        return dinheiro(v.cpm);
      case "ic":
        return doDetalhe(v, v.ic);
      case "cpi":
        return dinheiro(v.cpi);
      case "vis_video":
        return doDetalhe(v, v.visVideo);
      case "vis_3s":
        return doDetalhe(v, v.vis3s);
      case "retencao_75":
        return pct(v.retencao75);
      case "hook_rate":
        return pct(v.hookRate);
      case "hold_rate":
        return pct(v.holdRate);
      case "frequencia":
        return v.frequencia === null ? (
          TRACO
        ) : (
          <span className="text-t2">
            {v.frequencia.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        );
      default:
        return TRACO;
    }
  }

  function renderValorCelula(linha: LinhaCampanha, colId: string): ReactNode {
    switch (colId) {
      case "tipo":
        return linha.tipo ? <span className="font-mono text-t2">{linha.tipo}</span> : TRACO;
      case "orcamento":
        return dinheiro(linha.orcamento, "font-medium text-ink");
      case "cpa_desejado":
        return dinheiro(linha.cpaDesejado);
      default:
        return renderNumeros(linha, colId, false);
    }
  }

  function renderValorTotais(colId: string): ReactNode {
    switch (colId) {
      case "tipo":
        return <span className="text-t3 font-mono">{linhas.length} itens</span>;
      case "orcamento":
      case "cpa_desejado":
        return TRACO;
      default:
        return renderNumeros(totais, colId, true);
    }
  }

  const rotuloNivel =
    nivel === "conta"
      ? "CONTA"
      : nivel === "grupo"
        ? "GRUPO / CONJUNTO"
        : nivel === "anuncio"
          ? "ANÚNCIO"
          : "CAMPANHA";

  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface shadow-lg overflow-hidden">
      {/* Container de Tabela com Scroll Horizontal Suave */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
          {/* Cabeçalho da Tabela */}
          <thead>
            <tr className="border-b border-border/80 bg-surface-2 text-t3 uppercase font-semibold text-[10.5px] tracking-wider">
              <th className="w-10 px-3 py-3 text-center">
                <input
                  type="checkbox"
                  className="rounded border-border bg-surface cursor-pointer"
                  aria-label="Selecionar todas"
                />
              </th>
              <th className="px-3 py-3 w-24">STATUS</th>
              <th className="px-3 py-3 min-w-[220px]">{rotuloNivel}</th>

              {colunasAtivas.map((colId) => {
                const col = MAPA_COLUNAS.get(colId);
                return (
                  <th key={colId} className="px-3 py-3 text-right">
                    {(contraEntrega && ROTULOS_CONTRA_ENTREGA[colId]) || col?.rotulo || colId}
                  </th>
                );
              })}
            </tr>

            {/* Linha de Totais / Resumo Agregado */}
            <tr className="border-b border-border bg-surface-2 font-semibold text-xs text-ink">
              <td className="px-3 py-2.5 text-center text-t3">Σ</td>
              <td className="px-3 py-2.5 text-t3">TOTAL</td>
              <td className="px-3 py-2.5 text-brand font-semibold">
                {linhas.length} {nivel === "conta" ? "contas" : nivel === "grupo" ? "grupos" : nivel === "anuncio" ? "anúncios" : "campanhas"}
              </td>

              {colunasAtivas.map((colId) => (
                <td key={colId} className="px-3 py-2.5 text-right">
                  {renderValorTotais(colId)}
                </td>
              ))}
            </tr>
          </thead>

          {/* Corpo da Tabela */}
          {/* Sem spinner proprio: o "Atualizar agora" do topo (seletor-global.tsx) gira e diz "Atualizando…", e a tabela fica no lugar. */}
          <tbody className="divide-y divide-border/40">
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={colunasAtivas.length + 3} className="py-16 text-center text-t2">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <div className="rounded-full bg-surface p-3 text-t3">
                      <Layers className="h-6 w-6" />
                    </div>
                    <span className="text-sm font-semibold text-ink">Nenhum dado encontrado</span>
                    <p className="text-xs text-t3 text-balance">
                      {nivel === "conta"
                        ? "Nenhuma conta"
                        : nivel === "grupo"
                          ? "Nenhum conjunto"
                          : nivel === "anuncio"
                            ? "Nenhum anúncio"
                            : "Nenhuma campanha"}{" "}
                      com os filtros selecionados teve gasto ou venda no período.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              linhas.map((linha) => {
                const { texto: statusTexto, ativa } = rotuloStatus(linha.status);
                return (
                  <tr
                    key={linha.id}
                    className="transition hover:bg-hover text-t1 hover:text-ink group"
                  >
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        className="rounded border-border bg-surface cursor-pointer"
                      />
                    </td>

                    {/* Status Badge */}
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          ativa
                            ? "bg-ok-bg text-ok border border-ok-border"
                            : "bg-surface text-t3 border border-border"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            ativa ? "bg-ok" : "bg-t3"
                          }`}
                        />
                        {statusTexto}
                      </span>
                    </td>

                    {/* Nome + Plataforma */}
                    <td className="px-3 py-3">
                      <div className="flex flex-col min-w-0 max-w-[280px]">
                        <span className="truncate font-medium text-ink group-hover:text-brand transition" title={linha.nome}>
                          {linha.nome}
                        </span>
                        <div className="flex items-center gap-1.5 text-[10.5px] text-t3 truncate">
                          <span className="uppercase font-mono font-semibold text-brand">
                            {linha.plataforma}
                          </span>
                          <span>·</span>
                          <span className="truncate">
                            {linha.nivel === "anuncio" && linha.grupoNome
                              ? `${linha.contaNome} · ${linha.grupoNome}`
                              : linha.nivel === "grupo" && linha.campanhaNome
                                ? `${linha.contaNome} · ${linha.campanhaNome}`
                                : linha.contaNome}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Colunas Personalizadas Dinâmicas */}
                    {colunasAtivas.map((colId) => (
                      <td key={colId} className="px-3 py-3 text-right">
                        {renderValorCelula(linha, colId)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Rodapé Informativo */}
      <div className="flex items-center justify-between border-t border-border/80 bg-surface-2 px-4 py-3 text-xs text-t3">
        <div
          className="flex items-center gap-1.5"
          title="Aparece o que teve gasto ou venda no período da barra do topo, nas contas de anúncio da loja escolhida. Vendas e lucro vêm dos pedidos, ligados pela campanha, conjunto e anúncio de cada um."
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Gasto da plataforma, vendas dos pedidos</span>
        </div>
        <div>
          Mostrando <span className="font-medium text-ink">{linhas.length}</span> registros
        </div>
      </div>
    </div>
  );
}
