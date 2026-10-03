"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROTAS, type ProductCostRow } from "@/lib/financeiro/tipos";
import { efeitoDeApagar, fmtDia, fmtVersao, linhaDoTempo } from "./apresentar";

// ============================================================================
// Historico de custo de um SKU, como linha do tempo. A regra de versao nao
// muda (e ela que congela o custo dos pedidos antigos); muda so o jeito de
// mostrar: que pedidos cada versao cobre, qual vale hoje, e o que acontece
// com o lucro antes de apagar uma.
//
// Apagar usa a rota de sempre (DELETE /api/financeiro/custos?id=).
// ============================================================================

export function HistoricoSku({
  sku,
  versoes,
  hoje,
  temCustoPadrao,
  onFechar,
}: {
  /** null = fechado. */
  sku: string | null;
  versoes: ProductCostRow[];
  hoje: string;
  temCustoPadrao: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const etapas = linhaDoTempo(versoes, hoje);

  async function apagar(id: string) {
    let res: Response;
    try {
      res = await fetch(`${ROTAS.apiCustos}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      throw new Error("sem conexão");
    }
    if (res.status === 404) {
      // Ja tinha sido apagada (outra aba): a tela so precisa reler.
      toast("Esta versão já tinha sido apagada");
      iniciar(() => router.refresh());
      return;
    }
    if (!res.ok || res.redirected) throw new Error(String(res.status));
    toast.success("Versão apagada", { description: "O lucro já usa o custo que ficou." });
    iniciar(() => router.refresh());
  }

  return (
    <Sheet
      open={sku !== null}
      onOpenChange={(aberto) => {
        if (!aberto) onFechar();
      }}
    >
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>Histórico de custo</SheetTitle>
          <SheetDescription>
            <span className="break-all font-mono">{sku}</span>
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-5">
          <p className="text-dense text-t1 text-pretty">
            Cada custo vale da data dele até a véspera do seguinte, e o primeiro vale também para os pedidos
            anteriores. Assim, quando o fornecedor muda o preço, o lucro dos pedidos antigos não muda.
          </p>

          {etapas.length === 0 ? (
            <EmptyState
              variante="tracejado"
              titulo="Nenhum custo lançado"
              descricao="Lance o custo na tabela ou pela planilha."
            />
          ) : (
            <ol aria-label={sku ? `Versões do custo de ${sku}` : "Versões do custo"} className="flex flex-col">
              {etapas.map((e, i) => (
                <li key={e.versao.id} className="flex gap-3">
                  <span aria-hidden className="flex flex-col items-center pt-1">
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full border-2",
                        e.valeHoje ? "border-ok bg-ok" : "border-border-strong bg-surface"
                      )}
                    />
                    {i < etapas.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
                  </span>
                  <div className={cn("flex min-w-0 flex-1 flex-col gap-1", i < etapas.length - 1 && "pb-5")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-dense font-semibold text-ink">{e.periodo}</span>
                      {e.valeHoje ? <StatusBadge tom="ok">Vale hoje</StatusBadge> : null}
                      {e.futura ? <StatusBadge tom="info">Ainda não vale</StatusBadge> : null}
                    </div>
                    <span className="num text-body text-ink">{fmtVersao(e.versao)}</span>
                    <span className="text-label text-t2">
                      {e.versao.origem === "csv" ? "Importado pela planilha" : "Lançado na tabela"}
                    </span>
                    <ConfirmDialog
                      gatilho={
                        <Button variant="destructive" size="sm" className="mt-1 h-ctl-lg w-fit sm:h-ctl-sm">
                          Apagar esta versão
                        </Button>
                      }
                      titulo={`Apagar a versão de ${fmtDia(e.versao.valido_desde)}?`}
                      descricao={efeitoDeApagar(versoes, e.versao.id, temCustoPadrao)}
                      confirmar="Apagar versão"
                      onConfirmar={() => apagar(e.versao.id)}
                      mensagemErro="Não deu para apagar agora. Nada mudou: tente de novo."
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SheetBody>
        <SheetFooter>
          <p className="text-label text-t2 sm:mr-auto sm:self-center">Para mudar o custo, edite a linha na tabela.</p>
          <SheetClose render={<Button variant="secondary" />}>Fechar</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
