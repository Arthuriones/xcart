"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Liga/pausa a rota pela rota de sempre (PATCH /api/checkout-routes/toggle)
 * e SO mostra sucesso quando a resposta confirma o novo estado. Antes o
 * "Parar/Voltar" dizia "Rota pausada" mesmo quando o servidor recusava.
 */
async function enviarLigada(id: string, enabled: boolean): Promise<void> {
  const r = await fetch("/api/checkout-routes/toggle", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, enabled }),
  });
  const d = (await r.json().catch(() => null)) as { config?: { enabled?: boolean } } | null;
  if (!r.ok || d?.config?.enabled !== enabled) throw new Error("toggle");
}

/** Pausar/Ligar e Apagar, no cabecalho do detalhe da rota. */
export function AcoesRota({ id, nome, ligada }: { id: string; nome: string; ligada: boolean }) {
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [ligando, setLigando] = useState(false);
  const [pausar, setPausar] = useState(false);
  const [apagar, setApagar] = useState(false);

  async function ligar() {
    setLigando(true);
    try {
      await enviarLigada(id, true);
      toast.success(`Rota “${nome}” ligada.`);
      startTransition(() => router.refresh());
    } catch {
      toast.error("Não deu para ligar a rota. Nada mudou; tente de novo.");
    } finally {
      setLigando(false);
    }
  }

  async function confirmarPausa() {
    await enviarLigada(id, false);
    toast.success(`Rota “${nome}” pausada.`);
    startTransition(() => router.refresh());
  }

  async function confirmarApagar() {
    const r = await fetch(`/api/checkout-routes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error("delete");
    toast.success(`Rota “${nome}” apagada.`);
    startTransition(() => router.push("/clone/routed-checkout"));
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {ligada ? (
        <Button variant="secondary" size="sm" pending={atualizando} onClick={() => setPausar(true)}>
          Pausar rota
        </Button>
      ) : (
        <Button size="sm" pending={ligando || atualizando} onClick={ligar}>
          Ligar rota
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon-sm" variant="ghost" aria-label={`Mais ações da rota ${nome}`} />}
        >
          <MoreHorizontalIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem variant="destructive" onClick={() => setApagar(true)}>
            Apagar rota…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={pausar}
        onOpenChange={setPausar}
        tom="normal"
        titulo={`Pausar a rota “${nome}”?`}
        descricao="Com a rota pausada, o checkout da vitrine fica travado: o comprador vê um aviso e não finaliza a compra. As lojas e os produtos ligados ficam guardados para quando você ligar de novo."
        confirmar="Pausar rota"
        mensagemErro="Não deu para pausar a rota. Nada mudou; tente de novo."
        onConfirmar={confirmarPausa}
      />
      <ConfirmDialog
        open={apagar}
        onOpenChange={setApagar}
        titulo={`Apagar a rota “${nome}”?`}
        descricao="A vitrine volta a mandar o comprador para o próprio checkout, que não cobra. A divisão e o mapa de produtos desta rota somem; os produtos nas lojas Shopify continuam lá."
        confirmar="Apagar rota"
        mensagemErro="Não deu para apagar a rota. Ela continua como estava; tente de novo."
        onConfirmar={confirmarApagar}
      />
    </div>
  );
}
