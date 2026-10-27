"use client";

import { useState } from "react";
import { X, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TODAS_AS_COLUNAS, MAPA_COLUNAS } from "./colunas-config";

interface ModalPersonalizarColunasProps {
  aberto: boolean;
  colunasAtivas: string[];
  aoFechar: () => void;
  aoSalvar: (novasColunas: string[]) => void;
}

/**
 * O Dialog (base-ui) prende o foco, fecha no Esc e devolve o foco a quem abriu.
 * O rascunho mora no corpo, que so monta com o dialog aberto: cancelar e
 * reabrir comeca de novo das colunas salvas.
 */
export function ModalPersonalizarColunas({
  aberto,
  colunasAtivas,
  aoFechar,
  aoSalvar,
}: ModalPersonalizarColunasProps) {
  return (
    <Dialog open={aberto} onOpenChange={(abrir) => !abrir && aoFechar()}>
      <DialogContent size="lg" className="max-w-4xl">
        <CorpoModal colunasAtivas={colunasAtivas} aoSalvar={aoSalvar} />
      </DialogContent>
    </Dialog>
  );
}

function CorpoModal({
  colunasAtivas,
  aoSalvar,
}: Pick<ModalPersonalizarColunasProps, "colunasAtivas" | "aoSalvar">) {
  const [selecionadas, setSelecionadas] = useState<string[]>(colunasAtivas);
  const [filtroTexto, setFiltroTexto] = useState("");

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
    <>
      <DialogHeader>
        <DialogTitle>Personalize as colunas</DialogTitle>
        <DialogDescription>Escolha como você quer visualizar as colunas na tabela.</DialogDescription>
      </DialogHeader>

      {/* Corpo: Duas colunas (Checkboxes à esquerda | Ordem à direita) */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/80 rounded-card border border-border overflow-hidden">
        {/* Lado Esquerdo: Lista de Seleção com Checkboxes */}
        <div className="flex flex-col min-h-0 p-4">
          <div className="mb-3">
            <Input
              type="search"
              aria-label="Buscar métrica"
              placeholder="Pesquisar métricas..."
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              className="text-dense"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-1 max-h-64 md:max-h-[460px] custom-scrollbar">
            {colunasFiltradas.map((coluna) => (
              <Checkbox
                key={coluna.id}
                rotulo={coluna.rotulo}
                checked={selecionadas.includes(coluna.id)}
                onCheckedChange={() => alternarColuna(coluna.id)}
                className="w-full px-3 py-2 hover:bg-hover"
              />
            ))}
            {colunasFiltradas.length === 0 && (
              <p className="py-8 text-center text-label text-t3">Nenhuma métrica com esse nome.</p>
            )}
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

          <div className="flex-1 overflow-y-auto pr-2 space-y-1.5 max-h-64 md:max-h-[480px] custom-scrollbar">
            {/* Item Fixo (Identificador da linha) */}
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-2 px-3 py-2 text-xs text-t2 select-none opacity-80">
              <div className="flex items-center gap-2">
                <GripVertical aria-hidden className="h-3.5 w-3.5 text-t3" />
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
                  className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-1 text-xs text-ink transition hover:border-border-subtle group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical aria-hidden className="h-3.5 w-3.5 text-t3 shrink-0" />
                    <span className="truncate">{col.rotulo}</span>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mover(idx, "cima")}
                      disabled={idx === 0}
                      aria-label={`Mover ${col.rotulo} para cima`}
                      className="text-t2"
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => mover(idx, "baixo")}
                      disabled={idx === selecionadas.length - 1}
                      aria-label={`Mover ${col.rotulo} para baixo`}
                      className="text-t2"
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remover(colId)}
                      aria-label={`Remover ${col.rotulo}`}
                      className="text-t2 hover:text-err"
                    >
                      <X aria-hidden />
                    </Button>
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
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancelar</DialogClose>
        <Button onClick={() => aoSalvar(selecionadas)}>Salvar</Button>
      </DialogFooter>
    </>
  );
}
