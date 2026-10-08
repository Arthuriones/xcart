"use client";

import { useMemo } from "react";
import { HelpCircle, Layers } from "lucide-react";
import type { LinhaCampanha, NivelGranularidade, TotaisResumo } from "./tipos";
import { MAPA_COLUNAS } from "./colunas-config";

interface TabelaCampanhasProps {
  linhas: LinhaCampanha[];
  nivel: NivelGranularidade;
  colunasAtivas: string[];
  carregando: boolean;
}

function formatarMoeda(v: number): string {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarNumero(v: number): string {
  return (v || 0).toLocaleString("pt-BR");
}

function formatarPorcentagem(v: number): string {
  return `${(v || 0).toFixed(1)}%`;
}

export function TabelaCampanhas({
  linhas,
  nivel,
  colunasAtivas,
  carregando,
}: TabelaCampanhasProps) {
  // Cálculo da linha agregada de totais
  const totais = useMemo<TotaisResumo>(() => {
    let gastos = 0;
    let faturamento = 0;
    let lucro = 0;
    let vendas = 0;
    let cliques = 0;
    let impressoes = 0;

    for (const l of linhas) {
      gastos += Number(l.gastos || 0);
      faturamento += Number(l.faturamento || 0);
      lucro += Number(l.lucro || 0);
      vendas += Number(l.vendas || 0);
      cliques += Number(l.cliques || 0);
      impressoes += Number(l.impressoes || 0);
    }

    const cpaMedio = vendas > 0 ? gastos / vendas : 0;
    const roasMedio = gastos > 0 ? faturamento / gastos : 0;
    const margemMedia = faturamento > 0 ? (lucro / faturamento) * 100 : 0;

    return {
      contas: new Set(linhas.map((l) => l.contaId)).size,
      campanhas: linhas.length,
      grupos: 0,
      anuncios: 0,
      gastos,
      faturamento,
      lucro,
      vendas,
      cliques,
      impressoes,
      cpaMedio,
      roasMedio,
      margemMedia,
    };
  }, [linhas]);

  function renderValorCelula(linha: LinhaCampanha, colId: string) {
    switch (colId) {
      case "tipo":
        return <span className="font-mono text-t2">{linha.tipo || "CBO"}</span>;
      case "orcamento":
        return <span className="font-medium text-ink">{formatarMoeda(linha.orcamento)}</span>;
      case "custo_produto":
        return <span className="text-t2">{formatarMoeda(linha.custoProduto)}</span>;
      case "cpa_desejado":
        return <span className="text-t2">{linha.cpaDesejado ? formatarMoeda(linha.cpaDesejado) : "—"}</span>;
      case "cpt":
      case "cpp":
      case "cpa":
        return <span className="font-medium text-ink">{formatarMoeda(linha.cpa)}</span>;
      case "vendas_totais":
      case "vendas":
        return <span className="font-bold text-ink">{formatarNumero(linha.vendas)}</span>;
      case "vendas_pendentes":
        return <span className="text-warn">{formatarNumero(linha.vendasPendentes || 0)}</span>;
      case "gastos":
        return <span className="font-semibold text-err">{formatarMoeda(linha.gastos)}</span>;
      case "faturamento":
        return <span className="font-semibold text-ok">{formatarMoeda(linha.faturamento)}</span>;
      case "lucro":
        const positivo = linha.lucro >= 0;
        return (
          <span className={`font-bold ${positivo ? "text-ok" : "text-err"}`}>
            {formatarMoeda(linha.lucro)}
          </span>
        );
      case "roas":
        return (
          <span
            className={`font-semibold ${
              linha.roas >= 2 ? "text-ok" : linha.roas >= 1 ? "text-warn" : "text-err"
            }`}
          >
            {linha.roas.toFixed(2)}x
          </span>
        );
      case "margem":
        return (
          <span className={linha.margem >= 0 ? "text-ok" : "text-err"}>
            {formatarPorcentagem(linha.margem)}
          </span>
        );
      case "roi":
        return (
          <span className={linha.roi >= 0 ? "text-ok" : "text-err"}>
            {formatarPorcentagem(linha.roi)}
          </span>
        );
      case "cpc":
        return <span className="text-t2">{formatarMoeda(linha.cpc)}</span>;
      case "impressoes":
        return <span className="text-t2">{formatarNumero(linha.impressoes)}</span>;
      case "cliques":
        return <span className="text-t2">{formatarNumero(linha.cliques)}</span>;
      case "ctr":
        return <span className="text-t2">{formatarPorcentagem(linha.ctr)}</span>;
      case "cpm":
        return <span className="text-t2">{formatarMoeda(linha.cpm)}</span>;
      case "ic":
        return <span className="text-t2">{formatarNumero(linha.ic)}</span>;
      case "cpi":
        return <span className="text-t2">{formatarMoeda(linha.cpi)}</span>;
      case "vis_video":
        return <span className="text-t2">{formatarNumero(linha.visVideo || 0)}</span>;
      case "vis_3s":
        return <span className="text-t2">{formatarNumero(linha.vis3s || 0)}</span>;
      case "retencao_75":
        return <span className="text-t2">{formatarPorcentagem(linha.retencao75 || 0)}</span>;
      case "hook_rate":
        return <span className="text-t2">{formatarPorcentagem(linha.hookRate || 0)}</span>;
      case "hold_rate":
        return <span className="text-t2">{formatarPorcentagem(linha.holdRate || 0)}</span>;
      case "frequencia":
        return <span className="text-t2">{(linha.frequencia || 1).toFixed(2)}</span>;
      default:
        return <span className="text-t3">—</span>;
    }
  }

  function renderValorTotais(colId: string) {
    switch (colId) {
      case "tipo":
        return <span className="text-t3 font-mono">{linhas.length} itens</span>;
      case "orcamento":
        return <span className="text-t3">—</span>;
      case "cpa":
        return <span className="font-semibold text-ink">{formatarMoeda(totais.cpaMedio)}</span>;
      case "vendas":
      case "vendas_totais":
        return <span className="font-bold text-ink">{formatarNumero(totais.vendas)}</span>;
      case "gastos":
        return <span className="font-bold text-err">{formatarMoeda(totais.gastos)}</span>;
      case "faturamento":
        return <span className="font-bold text-ok">{formatarMoeda(totais.faturamento)}</span>;
      case "lucro":
        const pos = totais.lucro >= 0;
        return (
          <span className={`font-bold ${pos ? "text-ok" : "text-err"}`}>
            {formatarMoeda(totais.lucro)}
          </span>
        );
      case "roas":
        return <span className="font-bold text-ink">{totais.roasMedio.toFixed(2)}x</span>;
      case "margem":
        return <span className="font-semibold text-ink">{formatarPorcentagem(totais.margemMedia)}</span>;
      case "cliques":
        return <span className="text-ink">{formatarNumero(totais.cliques)}</span>;
      case "impressoes":
        return <span className="text-ink">{formatarNumero(totais.impressoes)}</span>;
      default:
        return <span className="text-t3">—</span>;
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
                    {col?.rotulo || colId}
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
          <tbody className="divide-y divide-border/40">
            {carregando ? (
              <tr>
                <td colSpan={colunasAtivas.length + 3} className="py-16 text-center text-t2">
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                    <span>Carregando métricas de tráfego...</span>
                  </div>
                </td>
              </tr>
            ) : linhas.length === 0 ? (
              <tr>
                <td colSpan={colunasAtivas.length + 3} className="py-16 text-center text-t2">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <div className="rounded-full bg-surface p-3 text-t3">
                      <Layers className="h-6 w-6" />
                    </div>
                    <span className="text-sm font-semibold text-ink">Nenhum dado encontrado</span>
                    <p className="text-xs text-t3 text-balance">
                      Não encontramos nenhuma {nivel} com os filtros selecionados ou as contas ainda não
                      possuem dados veiculados no período.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              linhas.map((linha) => {
                const ativa = linha.status === "ACTIVE";
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
                        {ativa ? "Ativa" : "Pausada"}
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
                          <span className="truncate">{linha.contaNome}</span>
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
        <div className="flex items-center gap-1.5 hover:text-t2 transition cursor-pointer">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Por que as campanhas não estão aparecendo?</span>
        </div>
        <div>
          Mostrando <span className="font-medium text-ink">{linhas.length}</span> registros
        </div>
      </div>
    </div>
  );
}
