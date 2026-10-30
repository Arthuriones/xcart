"use client";

import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import type { AlteracaoTela } from "@/lib/ads/regras-tipos";
import { ROTULO_CAMPO, ROTULO_NIVEL, quando, valorDoHistorico } from "./apresentar";

// ============================================================================
// Historico: toda mudanca que o Panda Track fez no Meta (a mao ou por regra),
// a mais nova primeiro. A falha fica na lista tambem -- a regra que tentou
// pausar e o Meta recusou precisa aparecer, senao o lojista acha que pausou.
// ============================================================================

// Tipo, nao interface: a DataTable pede Record<string, unknown>.
type Linha = {
  id: number;
  criadoEm: string;
  conta: string;
  objeto: string;
  mudanca: string;
  origem: string;
  item: AlteracaoTela;
};

const COLUNAS: ColunaTabela<Linha>[] = [
  {
    chave: "criadoEm",
    titulo: "Quando",
    direcaoInicial: "desc",
    className: "whitespace-nowrap",
    celula: (l) => <span className="num text-t1">{quando(l.criadoEm)}</span>,
  },
  {
    chave: "objeto",
    titulo: "Objeto",
    className: "min-w-48 max-w-72",
    celula: (l) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-ink" title={l.objeto}>
          {l.objeto}
        </span>
        <span className="text-label text-t3">
          {ROTULO_NIVEL[l.item.nivel]} · {l.conta}
        </span>
      </div>
    ),
  },
  {
    chave: "mudanca",
    titulo: "O que mudou",
    // O erro do Meta pode ter uma frase inteira: quebra linha em vez de esticar a tabela.
    className: "min-w-56 max-w-md whitespace-normal py-2",
    celula: (l) => (
      <div className="flex min-w-0 flex-col">
        <span className={l.item.ok ? "text-ink" : "text-t2 line-through decoration-err/60"}>{l.mudanca}</span>
        {!l.item.ok ? (
          <span className="text-label font-medium text-err">{l.item.erro || "O Meta recusou a alteração."}</span>
        ) : null}
      </div>
    ),
  },
  {
    chave: "origem",
    titulo: "Origem",
    className: "min-w-32",
    celula: (l) => <span className={l.item.origem === "regra" ? "text-ink" : "text-t2"}>{l.origem}</span>,
  },
];

function linhaDe(h: AlteracaoTela): Linha {
  return {
    id: h.id,
    criadoEm: h.criadoEm,
    conta: h.contaNome,
    objeto: h.objetoNome || h.objetoId,
    mudanca: `${ROTULO_CAMPO[h.campo]}: ${valorDoHistorico(h.campo, h.antes)} → ${valorDoHistorico(h.campo, h.depois)}`,
    origem: h.origem === "regra" ? `Regra: ${h.regraNome || "apagada"}` : "Manual",
    item: h,
  };
}

export function Historico({ historico }: { historico: readonly AlteracaoTela[] }) {
  return (
    <DataTable
      colunas={COLUNAS}
      linhas={historico.map(linhaDe)}
      legenda="Últimas alterações feitas pelo Panda Track no Meta"
      ordenacaoInicial={[{ chave: "criadoEm", direcao: "desc" }]}
      alturaMaxima={520}
      vazio={
        <EmptyState
          variante="simples"
          titulo="Nenhuma alteração ainda"
          descricao="Pausas e mudanças de orçamento feitas pelo Panda Track aparecem aqui."
        />
      }
    />
  );
}
