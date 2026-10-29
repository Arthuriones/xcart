"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { BarraFiltros } from "./barra-filtros";
import { TabelaCampanhas } from "./tabela-campanhas";

// Fora do primeiro carregamento: o modal (Dialog, Checkbox e as listas) so abre
// com clique, e pesava ~25 KB gzip a mais na tela de Campanhas.
const ModalPersonalizarColunas = dynamic(
  () => import("./modal-personalizar-colunas").then((m) => m.ModalPersonalizarColunas),
  { ssr: false }
);
import type {
  ContaSemDetalhe,
  LinhaCampanha,
  NivelGranularidade,
  PlataformaAds,
  ResumoAtribuicao,
  StatusFiltro,
} from "./tipos";
import { COLUNAS_PADRAO_IDS } from "./colunas-config";
import { filtrarLinhas, semDetalheDoFiltro } from "@/lib/campanhas/filtrar";

interface CampanhasTelaProps {
  linhas: LinhaCampanha[];
  contas: { id: string; nome: string; plataforma: string }[];
  colunasSalvas?: string[];
  /** Moeda do relatorio (a da barra do topo). */
  moeda: string;
  /** O periodo da barra do topo, por extenso. */
  periodo: string;
  atribuicao: ResumoAtribuicao;
  semDetalhe: ContaSemDetalhe[];
  diasNoPeriodo: number;
  sincronizadoEm: string | null;
  moedasSemCotacao: string[];
  /** Visao contra entrega: pedidos gerados e valores previstos. */
  contraEntrega: boolean;
}

export function CampanhasTela({
  linhas,
  contas,
  colunasSalvas,
  moeda,
  periodo,
  atribuicao,
  semDetalhe,
  diasNoPeriodo,
  sincronizadoEm,
  moedasSemCotacao,
  contraEntrega,
}: CampanhasTelaProps) {
  // Filtros da tela (o periodo e o da barra do topo)
  const [nivel, setNivel] = useState<NivelGranularidade>("campanha");
  const [plataforma, setPlataforma] = useState<PlataformaAds>("todas");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<StatusFiltro>("qualquer");
  const [contaSelecionada, setContaSelecionada] = useState("todas");

  // Estado de Colunas Personalizadas
  const [colunasAtivas, setColunasAtivas] = useState<string[]>(
    colunasSalvas && colunasSalvas.length > 0 ? colunasSalvas : COLUNAS_PADRAO_IDS
  );
  const [modalColunasAberto, setModalColunasAberto] = useState(false);

  // Filtragem local: a mesma regra da rota do app (src/lib/campanhas/filtrar.ts)
  const filtro = { nivel, plataforma, conta: contaSelecionada, status, busca };
  const linhasFiltradas = filtrarLinhas(linhas, filtro);

  async function salvarColunas(novasColunas: string[]) {
    setColunasAtivas(novasColunas);
    setModalColunasAberto(false);

    try {
      const res = await fetch("/api/campanhas/preferencias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colunas: novasColunas }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success("Colunas personalizadas salvas com sucesso!");
    } catch {
      toast.error("Erro ao salvar preferências de colunas.");
    }
  }

  const semDetalheAqui = semDetalheDoFiltro(semDetalhe, filtro);

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de Filtros e Abas */}
      <BarraFiltros
        nivelAtivo={nivel}
        aoMudarNivel={setNivel}
        plataforma={plataforma}
        aoMudarPlataforma={setPlataforma}
        busca={busca}
        aoMudarBusca={setBusca}
        status={status}
        aoMudarStatus={setStatus}
        periodo={periodo}
        contaSelecionada={contaSelecionada}
        aoMudarConta={setContaSelecionada}
        contasDisponiveis={contas}
        aoAbrirPersonalizarColunas={() => setModalColunasAberto(true)}
        atribuicao={atribuicao}
        moeda={moeda}
        sincronizadoEm={sincronizadoEm}
      />

      {moedasSemCotacao.length > 0 && (
        <p className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn">
          Sem cotação para {moedasSemCotacao.join(", ")}: os valores nessas moedas ficaram de fora.
        </p>
      )}

      {semDetalheAqui.length > 0 && (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-t2">
          Conjuntos e anúncios só aparecem nos dias com detalhe sincronizado. Sem detalhe no período:{" "}
          {semDetalheAqui.map((c) => `${c.contaNome} (${c.dias} de ${diasNoPeriodo} dias)`).join(", ")}. Nesses dias o
          gasto e as vendas contam só na campanha.
        </p>
      )}

      {/* Tabela de Campanhas / Grupos / Anúncios */}
      <TabelaCampanhas
        linhas={linhasFiltradas}
        nivel={nivel}
        colunasAtivas={colunasAtivas}
        moeda={moeda}
        contraEntrega={contraEntrega}
      />

      {/* Modal Personalizar Colunas */}
      <ModalPersonalizarColunas
        aberto={modalColunasAberto}
        colunasAtivas={colunasAtivas}
        aoFechar={() => setModalColunasAberto(false)}
        aoSalvar={salvarColunas}
      />
    </div>
  );
}
