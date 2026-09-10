"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import { textos } from "@/lib/textos";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ImageQueueProgress {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

interface SwapImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  storeLabel: string;
}

export function SwapImagesDialog({
  open,
  onOpenChange,
  storeId,
  storeLabel,
}: SwapImagesDialogProps) {
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<"stock-neutralize" | "external-references">(
    "stock-neutralize"
  );
  const [progress, setProgress] = useState<ImageQueueProgress | null>(null);
  const [canceling, setCanceling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = textos("clone.swapImages");
  const tCredit = textos("clone.imageNeutralize");
  const [estimate, setEstimate] = useState<{
    estimatedCredits: number;
    billingEnforced: boolean;
    creditBalance: number | null;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);

  function stopPoll() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // A limpeza do formulario acontece no RENDER, o efeito fica so com o que e
  // efeito de verdade (parar o poll, disparar as consultas).
  //
  // Antes os quatro setState de reset rodavam sincronos dentro do efeito toda
  // vez que o dialog fechava: quatro atualizacoes em cascata para chegar a um
  // estado que o render ja sabia calcular na transicao aberto -> fechado.
  const [abertoAntes, setAbertoAntes] = useState(open);
  if (open !== abertoAntes) {
    setAbertoAntes(open);
    if (open) {
      // A estimativa comeca junto com a abertura; ligar a flag aqui evita o
      // mesmo set sincrono dentro do efeito.
      setEstimating(true);
    } else {
      setStarted(false);
      setStarting(false);
      setProgress(null);
      setEstimate(null);
    }
  }

  useEffect(() => {
    if (!open) {
      stopPoll();
      return;
    }
    // Ao abrir, ja consulta se ha uma fila em andamento para esta loja.
    void poll();
    // ...e quantos creditos esse disparo vai custar, antes do clique.
    // (a flag `estimating` ja foi ligada na transicao de abertura, acima)
    fetch("/api/jobs/neutralize-store-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, dryRun: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setEstimate({
          estimatedCredits: data.estimatedCredits ?? 0,
          billingEnforced: data.billingEnforced === true,
          creditBalance: typeof data.creditBalance === "number" ? data.creditBalance : null,
        });
      })
      .catch(() => undefined)
      .finally(() => setEstimating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeId]);

  useEffect(() => () => stopPoll(), []);

  async function poll() {
    stopPoll();
    try {
      const res = await fetch(
        `/api/jobs/neutralize-store-images?storeId=${encodeURIComponent(storeId)}`
      );
      const data = await res.json();
      if (res.ok && data.progress) {
        const p = data.progress as ImageQueueProgress;
        setProgress(p.total > 0 ? p : null);
        const running = p.pending + p.processing > 0;
        if (running) {
          // Garante que o dreno continue mesmo se o servidor tiver parado.
          if (p.pending > 0 && p.processing === 0) {
            fetch("/api/jobs/neutralize-images", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ storeId }),
            }).catch(() => {});
          }
          pollRef.current = setTimeout(() => poll(), 5000);
        }
      }
    } catch {
      // silencioso
    }
  }

  async function handleStart() {
    setStarting(true);
    try {
      const res = await fetch("/api/jobs/neutralize-store-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, mode, customInstructions: instructions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao iniciar.");
      if (data.queued === 0) {
        toast(data.message || "Nada para trocar.");
      } else {
        toast.success(`${data.queued} imagem(ns) na fila. Trocando aos poucos.`);
      }
      setStarted(true);
      void poll();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao iniciar a troca."
      );
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    stopPoll();
    try {
      const res = await fetch(
        `/api/jobs/neutralize-store-images?storeId=${encodeURIComponent(storeId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao cancelar.");
      if (data.progress) {
        const p = data.progress as ImageQueueProgress;
        setProgress(p.total > 0 ? p : null);
      }
      toast(
        `Cancelado. ${data.canceled || 0} imagem(ns) na fila foram paradas. As já trocadas continuam.`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao cancelar.");
      void poll();
    } finally {
      setCanceling(false);
    }
  }

  const done = progress ? progress.completed + progress.failed : 0;
  const pct = progress
    ? Math.round((done / Math.max(progress.total, 1)) * 100)
    : 0;
  const running = progress ? progress.pending + progress.processing > 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            Trocar imagens da loja checkout
          </DialogTitle>
          <DialogDescription>
            {t("description", { cost: "0.04" })} (
            <span className="font-medium text-foreground">{storeLabel}</span>)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <span className="block text-xs font-medium text-foreground">
              O que fazer com a imagem
            </span>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="swapMode"
                checked={mode === "stock-neutralize"}
                onChange={() => setMode("stock-neutralize")}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-foreground">
                  Neutralizar marca (stock)
                </span>
                <span className="text-xs text-muted-foreground">
                  Remove logos/marcas do produto e recria a foto limpa.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="swapMode"
                checked={mode === "external-references"}
                onChange={() => setMode("external-references")}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-foreground">
                  Só tirar marca d&apos;água/selo de vendedor
                </span>
                <span className="text-xs text-muted-foreground">
                  Mantém o produto como está, remove watermark do AliExpress.
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="swap-instructions" className="text-xs">
              Instruções extras (opcional)
            </Label>
            <Textarea
              id="swap-instructions"
              rows={2}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Ex.: manter o escudo do time, remover só o selo do vendedor."
              className="bg-background/70 text-xs"
            />
          </div>

          {!progress?.total && (
            <p
              className={`rounded-md border px-2 py-1.5 text-xs ${
                estimate &&
                estimate.billingEnforced &&
                estimate.creditBalance !== null &&
                estimate.estimatedCredits > estimate.creditBalance
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border/60 bg-muted/40 text-muted-foreground"
              }`}
            >
              {estimating || !estimate
                ? tCredit("estimateLoading")
                : !estimate.billingEnforced
                  ? tCredit("estimateUnlimited")
                  : estimate.creditBalance !== null &&
                      estimate.estimatedCredits > estimate.creditBalance
                    ? tCredit("estimateLowBalance", {
                        count: estimate.estimatedCredits,
                        balance: estimate.creditBalance,
                      })
                    : tCredit("estimate", {
                        count: estimate.estimatedCredits,
                        balance: estimate.creditBalance ?? 0,
                      })}
            </p>
          )}

          {progress && progress.total > 0 && (
            <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {progress.completed}/{progress.total} trocadas
                  {progress.failed > 0 ? ` · ${progress.failed} falharam` : ""}
                </span>
                <span>{running ? "processando…" : "concluído"}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Pode fechar — as imagens terminam em background.
              </p>
            </div>
          )}

          {running ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCancel}
              disabled={canceling}
            >
              {canceling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              Cancelar troca de imagens
            </Button>
          ) : (
            <Button className="w-full" onClick={handleStart} disabled={starting}>
              {starting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {started ? "Trocar de novo" : "Trocar imagens agora"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
