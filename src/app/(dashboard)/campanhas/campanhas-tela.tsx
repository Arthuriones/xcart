"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BarraFiltros } from "./barra-filtros";
import { TabelaCampanhas } from "./tabela-campanhas";
import { ModalPersonalizarColunas } from "./modal-personalizar-colunas";
import type {
  LinhaCampanha,
  NivelGranularidade,
  PeriodoFiltro,
  PlataformaAds,
  StatusFiltro,
} from "./tipos";
import { COLUNAS_PADRAO_IDS } from "./colunas-config";

interface CampanhasTelaProps {
  linhasIniciais: LinhaCampanha[];
  contas: { id: string; nome: string; plataforma: string }[];
  colunasSalvas?: string[];
}

export function CampanhasTela({
  linhasIniciais,
  contas,
  colunasSalvas,
}: CampanhasTelaProps) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  // Estados dos Filtros
  const [nivel, setNivel] = useState<NivelGranularidade>("campanha");
  const [plataforma, setPlataforma] = useState<PlataformaAds>("todas");
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<StatusFiltro>("qualquer");
  const [periodo, setPeriodo] = useState<PeriodoFiltro>("hoje");
  const [contaSelecionada, setContaSelecionada] = useState("todas");

  // Estado de Colunas Personalizadas
  const [colunasAtivas, setColunasAtivas] = useState<string[]>(
    colunasSalvas && colunasSalvas.length > 0 ? colunasSalvas : COLUNAS_PADRAO_IDS
  );
  const [modalColunasAberto, setModalColunasAberto] = useState(false);

  // Filtragem local
  const linhasFiltradas = linhasIniciais.filter((l) => {
    // Nível
    if (l.nivel !== nivel) return false;

    // Plataforma
    if (plataforma !== "todas" && l.plataforma !== plataforma) return false;

    // Conta
    if (contaSelecionada !== "todas" && l.contaId !== contaSelecionada) return false;

    // Status
    if (status === "ativa" && l.status !== "ACTIVE") return false;
    if (status === "pausada" && l.status === "ACTIVE") return false;

    // Busca textual
    if (busca.trim()) {
      const q = busca.toLowerCase();
      const matchNome = l.nome.toLowerCase().includes(q);
      const matchConta = l.contaNome.toLowerCase().includes(q);
      if (!matchNome && !matchConta) return false;
    }

    return true;
  });

  async function salvarColunas(novasColunas: string[]) {
    setColunasAtivas(novasColunas);
    setModalColunasAberto(false);

    try {
      await fetch("/api/campanhas/preferencias", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colunas: novasColunas }),
      });
      toast.success("Colunas personalizadas salvas com sucesso!");
    } catch {
      toast.error("Erro ao salvar preferências de colunas.");
    }
  }

  function atualizarDados() {
    startTransition(() => {
      router.refresh();
      toast.success("Métricas atualizadas com o servidor.");
    });
  }

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
        aoMudarPeriodo={setPeriodo}
        contaSelecionada={contaSelecionada}
        aoMudarConta={setContaSelecionada}
        contasDisponiveis={contas}
        atualizando={pendente}
        aoAtualizar={atualizarDados}
        aoAbrirPersonalizarColunas={() => setModalColunasAberto(true)}
      />

      {/* Tabela de Campanhas / Grupos / Anúncios */}
      <TabelaCampanhas
        linhas={linhasFiltradas}
        nivel={nivel}
        colunasAtivas={colunasAtivas}
        carregando={pendente}
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
