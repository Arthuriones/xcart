"use client";

import {
  Folder,
  Layers,
  LayoutGrid,
  FileText,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  Search,
} from "lucide-react";
import type {
  NivelGranularidade,
  PlataformaAds,
  StatusFiltro,
  PeriodoFiltro,
} from "./tipos";

interface BarraFiltrosProps {
  nivelAtivo: NivelGranularidade;
  aoMudarNivel: (nivel: NivelGranularidade) => void;
  plataforma: PlataformaAds;
  aoMudarPlataforma: (p: PlataformaAds) => void;
  busca: string;
  aoMudarBusca: (b: string) => void;
  status: StatusFiltro;
  aoMudarStatus: (s: StatusFiltro) => void;
  periodo: PeriodoFiltro;
  aoMudarPeriodo: (p: PeriodoFiltro) => void;
  contaSelecionada: string;
  aoMudarConta: (c: string) => void;
  contasDisponiveis: { id: string; nome: string; plataforma: string }[];
  atualizando: boolean;
  aoAtualizar: () => void;
  aoAbrirPersonalizarColunas: () => void;
  ultimaAtualizacao?: string;
}

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
  aoMudarPeriodo,
  contaSelecionada,
  aoMudarConta,
  contasDisponiveis,
  atualizando,
  aoAtualizar,
  aoAbrirPersonalizarColunas,
  ultimaAtualizacao = "Atualizado agora mesmo",
}: BarraFiltrosProps) {
  const abas: { id: NivelGranularidade; rotulo: string; icone: React.ComponentType<{ className?: string }> }[] = [
    { id: "conta", rotulo: "Contas", icone: Layers },
    { id: "campanha", rotulo: "Campanhas", icone: Folder },
    { id: "grupo", rotulo: "Grupos", icone: LayoutGrid },
    { id: "anuncio", rotulo: "Anúncios", icone: FileText },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-[#11141c] p-4 text-ink shadow-sm">
      {/* 1. Abas Superiores (Contas, Campanhas, Grupos, Anúncios) */}
      <div className="flex items-center justify-between border-b border-border/80 pb-3">
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
                    : "text-t2 hover:bg-surface hover:text-white border border-transparent"
                }`}
              >
                <Icone className={`h-4 w-4 ${ativa ? "text-brand" : "text-t3"}`} />
                <span>{aba.rotulo}</span>
              </button>
            );
          })}
        </div>

        {/* Status do Rastreamento + Ação de Atualização */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Todas as vendas trackeadas</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-[11px] text-t3">{ultimaAtualizacao}</span>
            <button
              type="button"
              onClick={aoAtualizar}
              disabled={atualizando}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover transition disabled:opacity-50 cursor-pointer"
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
            className="rounded-lg border border-border bg-[#181d28] px-2.5 py-1.5 text-xs text-white outline-none focus:border-brand cursor-pointer"
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
              placeholder="Filtrar por nome..."
              value={busca}
              onChange={(e) => aoMudarBusca(e.target.value)}
              className="w-full rounded-lg border border-border bg-[#181d28] pl-8 pr-3 py-1.5 text-xs text-white placeholder-t3 outline-none focus:border-brand"
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
            className="rounded-lg border border-border bg-[#181d28] px-2.5 py-1.5 text-xs text-white outline-none focus:border-brand cursor-pointer"
          >
            <option value="qualquer">Qualquer</option>
            <option value="ativa">Ativa</option>
            <option value="pausada">Pausada</option>
          </select>
        </div>

        {/* Período */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-t3 uppercase tracking-wider">
            Período
          </label>
          <select
            value={periodo}
            onChange={(e) => aoMudarPeriodo(e.target.value as PeriodoFiltro)}
            className="rounded-lg border border-border bg-[#181d28] px-2.5 py-1.5 text-xs text-white outline-none focus:border-brand cursor-pointer"
          >
            <option value="hoje">Hoje</option>
            <option value="ontem">Ontem</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="14d">Últimos 14 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="mes_atual">Este mês</option>
            <option value="mes_passado">Mês passado</option>
          </select>
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
            className="rounded-lg border border-border bg-[#181d28] px-2.5 py-1.5 text-xs text-white outline-none focus:border-brand cursor-pointer"
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
    </div>
  );
}
