"use client";

import {
  Folder,
  Layers,
  LayoutGrid,
  FileText,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  CircleAlert,
  Search,
  CalendarDays,
} from "lucide-react";
import { diaCurto, horaNoFuso } from "@/components/layout/contexto";
import { FUSO_RELATORIO_PADRAO, diaNoFuso, formatarDinheiro } from "@/lib/financeiro/tipos";
import type { NivelGranularidade, PlataformaAds, ResumoAtribuicao, StatusFiltro } from "./tipos";

interface BarraFiltrosProps {
  nivelAtivo: NivelGranularidade;
  aoMudarNivel: (nivel: NivelGranularidade) => void;
  plataforma: PlataformaAds;
  aoMudarPlataforma: (p: PlataformaAds) => void;
  busca: string;
  aoMudarBusca: (b: string) => void;
  status: StatusFiltro;
  aoMudarStatus: (s: StatusFiltro) => void;
  /** O periodo da barra do topo, por extenso: so mostrado aqui. */
  periodo: string;
  contaSelecionada: string;
  aoMudarConta: (c: string) => void;
  contasDisponiveis: { id: string; nome: string; plataforma: string }[];
  atualizando: boolean;
  aoAtualizar: () => void;
  aoAbrirPersonalizarColunas: () => void;
  atribuicao: ResumoAtribuicao;
  moeda: string;
  sincronizadoEm: string | null;
}

/** "24/10 07:30" no fuso do relatorio (fixo: o servidor e o navegador escrevem igual). */
function quando(iso: string): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return "";
  return `${diaCurto(diaNoFuso(instante, FUSO_RELATORIO_PADRAO))} ${horaNoFuso(instante.getTime(), FUSO_RELATORIO_PADRAO)}`;
}

const vendasTexto = (n: number) => (n === 1 ? "1 venda" : `${n} vendas`);

export function BarraFiltros({
  nivelAtivo,
  aoMudarNivel,
  plataforma,
  aoMudarPlataforma,
  busca,
  aoMudarBusca,
  status,
  aoMudarStatus,
  periodo,
  contaSelecionada,
  aoMudarConta,
  contasDisponiveis,
  atualizando,
  aoAtualizar,
  aoAbrirPersonalizarColunas,
  atribuicao,
  moeda,
  sincronizadoEm,
}: BarraFiltrosProps) {
  const abas: { id: NivelGranularidade; rotulo: string; icone: React.ComponentType<{ className?: string }> }[] = [
    { id: "conta", rotulo: "Contas", icone: Layers },
    { id: "campanha", rotulo: "Campanhas", icone: Folder },
    { id: "grupo", rotulo: "Grupos", icone: LayoutGrid },
    { id: "anuncio", rotulo: "Anúncios", icone: FileText },
  ];

  // Vendas pagas do periodo: com campanha identificada x o resto.
  const { identificadas, semId, idDesconhecido } = atribuicao;
  const foraVendas = semId.vendas + idDesconhecido.vendas;
  const totalVendas = identificadas.vendas + foraVendas;
  const foraPendentes = semId.vendasPendentes + idDesconhecido.vendasPendentes;
  const todasIdentificadas = foraVendas === 0;
  const partesFora = [
    semId.vendas > 0 ? `${vendasTexto(semId.vendas)} sem UTM de anúncio` : null,
    idDesconhecido.vendas > 0 ? `${vendasTexto(idDesconhecido.vendas)} de campanha fora das contas desta tela` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-ink shadow-sm">
      {/* 1. Abas Superiores (Contas, Campanhas, Grupos, Anúncios) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {abas.map((aba) => {
            const ativa = nivelAtivo === aba.id;
            const Icone = aba.icone;
            return (
              <button
                key={aba.id}
                type="button"
                onClick={() => aoMudarNivel(aba.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition cursor-pointer ${
                  ativa
                    ? "bg-brand/15 text-brand border border-brand/40 shadow-sm"
                    : "text-t2 hover:bg-hover hover:text-ink border border-transparent"
                }`}
              >
                <Icone className={`h-4 w-4 ${ativa ? "text-brand" : "text-t3"}`} />
                <span>{aba.rotulo}</span>
              </button>
            );
          })}
        </div>

        {/* Vendas com campanha + Ação de Atualização */}
        <div className="flex items-center gap-3">
          {totalVendas > 0 && (
            <div
              className={`hidden sm:flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium ${
                todasIdentificadas ? "border-ok-border bg-ok-bg text-ok" : "border-warn-border bg-warn-bg text-warn"
              }`}
              title="Vendas pagas do período ligadas a uma campanha pelos ids do pedido"
            >
              {todasIdentificadas ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
              <span>
                {todasIdentificadas
                  ? totalVendas === 1
                    ? "A venda do período tem campanha"
                    : `Todas as ${totalVendas} vendas com campanha`
                  : `${identificadas.vendas} de ${vendasTexto(totalVendas)} com campanha`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {sincronizadoEm && (
              <span className="hidden md:inline text-[11px] text-t3">Anúncios sincronizados {quando(sincronizadoEm)}</span>
            )}
            <button
              type="button"
              onClick={aoAtualizar}
              disabled={atualizando}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand/90 transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? "animate-spin" : ""}`} />
              <span>Atualizar</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Barra de Filtros e Ferramentas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5 pt-1">
        {/* Plataforma */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-t3 uppercase tracking-wider">
            Plataforma
          </label>
          <select
            value={plataforma}
            onChange={(e) => aoMudarPlataforma(e.target.value as PlataformaAds)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand cursor-pointer"
          >
            <option value="todas">Todas as plataformas</option>
            <option value="meta">Meta Ads</option>
            <option value="google">Google Ads</option>
            <option value="tiktok">TikTok Ads</option>
          </select>
        </div>

        {/* Busca por Nome */}
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-[10px] font-medium text-t3 uppercase tracking-wider">
            Nome da {nivelAtivo === "conta" ? "Conta" : nivelAtivo === "grupo" ? "Grupo" : nivelAtivo === "anuncio" ? "Anúncio" : "Campanha"}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-t3" />
            <input
              type="text"
              placeholder="Filtrar por nome ou id..."
              value={busca}
              onChange={(e) => aoMudarBusca(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-ink placeholder-t3 outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-t3 uppercase tracking-wider">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => aoMudarStatus(e.target.value as StatusFiltro)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand cursor-pointer"
          >
            <option value="qualquer">Qualquer</option>
            <option value="ativa">Ativa</option>
            <option value="pausada">Pausada</option>
          </select>
        </div>

        {/* Período: o da barra do topo */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-t3 uppercase tracking-wider">Período</span>
          <div
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink"
            title="O período e a loja vêm da barra do topo"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-t3" />
            <span className="truncate">{periodo}</span>
          </div>
        </div>

        {/* Conta de Anúncio / Ação Personalizar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-t3 uppercase tracking-wider">
              Conta de Anúncio
            </label>
            <button
              type="button"
              onClick={aoAbrirPersonalizarColunas}
              className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
              title="Personalizar colunas visíveis da tabela"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span>Colunas</span>
            </button>
          </div>
          <select
            value={contaSelecionada}
            onChange={(e) => aoMudarConta(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand cursor-pointer"
          >
            <option value="todas">Todas as contas</option>
            {contasDisponiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({c.plataforma.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3. O que ficou sem campanha identificada */}
      {(foraVendas > 0 || foraPendentes > 0) && (
        <p className="text-[11px] text-t2">
          <span className="font-medium text-ink">Sem campanha identificada:</span>{" "}
          {foraVendas > 0
            ? `${vendasTexto(foraVendas)} · ${formatarDinheiro(semId.faturamento + idDesconhecido.faturamento, moeda)}`
            : "nenhuma venda paga"}
          {partesFora.length > 0 && ` (${partesFora.join(" · ")})`}
          {foraPendentes > 0 && ` · ${foraPendentes} pendente${foraPendentes === 1 ? "" : "s"}`}. Não entram em nenhuma
          linha.
        </p>
      )}
    </div>
  );
}
