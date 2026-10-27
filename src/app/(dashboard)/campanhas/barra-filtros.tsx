"use client";

import { useId } from "react";
import {
  Folder,
  Layers,
  LayoutGrid,
  FileText,
  SlidersHorizontal,
  CheckCircle2,
  CircleAlert,
  Search,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { diaCurto, horaNoFuso } from "@/components/layout/contexto";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const PLATAFORMAS: Record<PlataformaAds, string> = {
  todas: "Todas as plataformas",
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
};

const STATUS: Record<StatusFiltro, string> = {
  qualquer: "Qualquer",
  ativa: "Ativa",
  pausada: "Pausada",
};

/** Rotulo dos campos: o text-label do sistema, nao o uppercase de 10px. */
const ROTULO = "text-label font-medium text-t2";

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
  aoAbrirPersonalizarColunas,
  atribuicao,
  moeda,
  sincronizadoEm,
}: BarraFiltrosProps) {
  const id = useId();
  const abas: { id: NivelGranularidade; rotulo: string; icone: LucideIcon }[] = [
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

  const rotuloDaConta = (v: string) => {
    const c = contasDisponiveis.find((x) => x.id === v);
    return c ? `${c.nome} (${c.plataforma.toUpperCase()})` : "Todas as contas";
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-ink shadow-sm">
      {/* 1. Abas Superiores (Contas, Campanhas, Grupos, Anúncios) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <Segmented
            rotulo="Nível da tabela"
            tamanho="md"
            valor={nivelAtivo}
            onValorChange={aoMudarNivel}
            opcoes={abas.map(({ id: valor, rotulo, icone: Icone }) => ({
              valor,
              rotulo: (
                <span className="flex items-center gap-1.5">
                  <Icone aria-hidden className="hidden size-3.5 sm:block" />
                  {rotulo}
                </span>
              ),
            }))}
          />
        </div>

        {/* Vendas com campanha + quando os anúncios sincronizaram (o "Atualizar agora" é o do topo) */}
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

          {sincronizadoEm && (
            <span className="hidden md:inline text-[11px] text-t3">Anúncios sincronizados {quando(sincronizadoEm)}</span>
          )}
        </div>
      </div>

      {/* 2. Barra de Filtros e Ferramentas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5 pt-1">
        {/* Plataforma */}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-plataforma`} className={ROTULO}>
            Plataforma
          </Label>
          <Select value={plataforma} onValueChange={(v) => v && aoMudarPlataforma(v as PlataformaAds)}>
            <SelectTrigger id={`${id}-plataforma`} className="text-dense">
              <SelectValue>{(v: string) => PLATAFORMAS[v as PlataformaAds] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PLATAFORMAS) as PlataformaAds[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PLATAFORMAS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Busca por Nome */}
        <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
          <Label htmlFor={`${id}-busca`} className={ROTULO}>
            Nome {nivelAtivo === "conta" ? "da conta" : nivelAtivo === "grupo" ? "do grupo" : nivelAtivo === "anuncio" ? "do anúncio" : "da campanha"}
          </Label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-t3" />
            <Input
              id={`${id}-busca`}
              type="search"
              placeholder="Filtrar por nome ou id..."
              value={busca}
              onChange={(e) => aoMudarBusca(e.target.value)}
              className="pl-8 text-dense"
            />
          </div>
        </div>

        {/* Status */}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${id}-status`} className={ROTULO}>
            Status
          </Label>
          <Select value={status} onValueChange={(v) => v && aoMudarStatus(v as StatusFiltro)}>
            <SelectTrigger id={`${id}-status`} className="text-dense">
              <SelectValue>{(v: string) => STATUS[v as StatusFiltro] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS) as StatusFiltro[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Período: o da barra do topo */}
        <div className="flex flex-col gap-1">
          <span className={ROTULO}>Período</span>
          <div
            className="flex h-ctl-md items-center gap-1.5 rounded-control border border-border bg-surface-2 px-2.5 text-dense text-ink"
            title="O período e a loja vêm da barra do topo"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-t3" />
            <span className="truncate">{periodo}</span>
          </div>
        </div>

        {/* Conta de Anúncio / Ação Personalizar */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${id}-conta`} className={ROTULO}>
              Conta de anúncio
            </Label>
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
          <Select value={contaSelecionada} onValueChange={(v) => v && aoMudarConta(String(v))}>
            <SelectTrigger id={`${id}-conta`} className="text-dense">
              <SelectValue>{(v: string) => rotuloDaConta(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as contas</SelectItem>
              {contasDisponiveis.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} ({c.plataforma.toUpperCase()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
