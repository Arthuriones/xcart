"use client";

import { useState } from "react";
import { X, GripVertical, Check, ArrowUp, ArrowDown } from "lucide-react";
import { TODAS_AS_COLUNAS, MAPA_COLUNAS } from "./colunas-config";

interface ModalPersonalizarColunasProps {
  aberto: boolean;
  colunasAtivas: string[];
  aoFechar: () => void;
  aoSalvar: (novasColunas: string[]) => void;
}

export function ModalPersonalizarColunas({
  aberto,
  colunasAtivas,
  aoFechar,
  aoSalvar,
}: ModalPersonalizarColunasProps) {
  const [selecionadas, setSelecionadas] = useState<string[]>(colunasAtivas);
  const [filtroTexto, setFiltroTexto] = useState("");

  if (!aberto) return null;

  function alternarColuna(id: string) {
    if (selecionadas.includes(id)) {
      setSelecionadas(selecionadas.filter((c) => c !== id));
    } else {
      setSelecionadas([...selecionadas, id]);
    }
  }

  function mover(index: number, direcao: "cima" | "baixo") {
    const novoIndex = direcao === "cima" ? index - 1 : index + 1;
    if (novoIndex < 0 || novoIndex >= selecionadas.length) return;
    const copia = [...selecionadas];
    const item = copia[index];
    copia[index] = copia[novoIndex];
    copia[novoIndex] = item;
    setSelecionadas(copia);
  }

  function remover(id: string) {
    setSelecionadas(selecionadas.filter((c) => c !== id));
  }

  const colunasFiltradas = TODAS_AS_COLUNAS.filter((c) =>
    c.rotulo.toLowerCase().includes(filtroTexto.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface text-ink shadow-2xl overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Personalize as colunas</h3>
            <p className="text-xs text-t2">Escolha como você quer visualizar as colunas na tabela.</p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-t2 transition hover:bg-hover hover:text-ink"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo: Duas colunas (Checkboxes à esquerda | Ordem à direita) */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/80 overflow-hidden flex-1">
          {/* Lado Esquerdo: Lista de Seleção com Checkboxes */}
          <div className="flex flex-col min-h-0 p-4">
            <div className="mb-3">
              <input
                type="text"
                placeholder="Pesquisar métricas..."
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-ink placeholder-t3 outline-none focus:border-brand"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-1 max-h-[460px] custom-scrollbar">
              {colunasFiltradas.map((coluna) => {
                const ativo = selecionadas.includes(coluna.id);
                return (
                  <label
                    key={coluna.id}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-xs transition cursor-pointer select-none ${
                      ativo
                        ? "bg-brand/10 text-ink font-medium"
                        : "text-t1 hover:bg-hover hover:text-ink"
                    }`}
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                        ativo
                          ? "border-brand bg-brand text-white"
                          : "border-border bg-surface"
                      }`}
                    >
                      {ativo && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                    <span className="truncate">{coluna.rotulo}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Lado Direito: Lista Reordenável das Colunas Selecionadas */}
          <div className="flex flex-col min-h-0 p-4 bg-surface-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-t2">
                Colunas selecionadas ({selecionadas.length})
              </span>
              <button
                type="button"
                onClick={() => setSelecionadas([])}
                className="text-[11px] text-brand hover:underline"
              >
                Limpar todas
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-1.5 max-h-[480px] custom-scrollbar">
              {/* Item Fixo (Identificador da linha) */}
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-2 px-3 py-2 text-xs text-t2 select-none opacity-80">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-3.5 w-3.5 text-t3" />
                  <span className="font-medium text-t1">Nome / Identificador</span>
                </div>
                <span className="text-[10px] text-t3 uppercase font-mono">Fixo</span>
              </div>

              {selecionadas.map((colId, idx) => {
                const col = MAPA_COLUNAS.get(colId);
                if (!col) return null;
                return (
                  <div
                    key={colId}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink transition hover:border-border-subtle group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="h-3.5 w-3.5 text-t3 shrink-0" />
                      <span className="truncate">{col.rotulo}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => mover(idx, "cima")}
                        disabled={idx === 0}
                        className="rounded p-1 text-t3 hover:text-ink disabled:opacity-30"
                        title="Mover para cima"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => mover(idx, "baixo")}
                        disabled={idx === selecionadas.length - 1}
                        className="rounded p-1 text-t3 hover:text-ink disabled:opacity-30"
                        title="Mover para baixo"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remover(colId)}
                        className="rounded p-1 text-t3 hover:text-err"
                        title="Remover coluna"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {selecionadas.length === 0 && (
                <div className="py-12 text-center text-xs text-t3">
                  Nenhuma coluna selecionada. Escolha as métricas à esquerda.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé: Ações */}
        <div className="flex items-center justify-end gap-3 border-t border-border/80 px-6 py-3.5 bg-surface">
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-t1 hover:bg-hover hover:text-ink transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => aoSalvar(selecionadas)}
            className="rounded-lg bg-brand px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand/90 transition"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
