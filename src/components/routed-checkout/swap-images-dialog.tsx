"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Progresso } from "@/components/routed-checkout/cartoes";

// ============================================================================
// Refazer as imagens de uma loja de checkout sem marca, em segundo plano.
// Mesmas chamadas de sempre (/api/jobs/neutralize-store-images e
// /api/jobs/neutralize-images); o que mudou foi o desenho, o custo em
// creditos (o credito e vendido em real, nao em dolar) e o botao que trava
// quando falta saldo.
// ============================================================================

interface FilaImagens {
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

type Modo = "stock-neutralize" | "external-references";

const MODOS: { valor: Modo; titulo: string; descricao: string }[] = [
  {
    valor: "stock-neutralize",
    titulo: "Tirar a marca do produto",
    descricao: "Remove logos e marcas e recria a foto limpa.",
  },
  {
    valor: "external-references",
    titulo: "Só tirar selo e marca d’água",
    descricao: "Mantém o produto como está e limpa o selo do vendedor.",
  },
];

function plural(n: number, um: string, varios: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

export function SwapImagesDialog({ open, onOpenChange, storeId, storeLabel }: SwapImagesDialogProps) {
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<Modo>("stock-neutralize");
  const [progress, setProgress] = useState<FilaImagens | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [estimate, setEstimate] = useState<{
    estimatedCredits: number;
    billingEnforced: boolean;
    creditBalance: number | null;
  } | null>(null);
  const [estimating, setEstimating] = useState(open);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idInstrucoes = useId();

  function stopPoll() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  // A limpeza do formulario acontece no RENDER, na transicao aberto/fechado;
  // o efeito fica so com o que e efeito de verdade (poll e consultas).
  const [abertoAntes, setAbertoAntes] = useState(open);
  if (open !== abertoAntes) {
    setAbertoAntes(open);
    if (open) {
      setEstimating(true);
    } else {
      setStarted(false);
      setStarting(false);
      setProgress(null);
      setEstimate(null);
      setAviso(null);
    }
  }

  useEffect(() => {
    if (!open) {
      stopPoll();
      return;
    }
    // Ao abrir: ha fila em andamento para esta loja? E quanto custa disparar?
    void poll();
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
      const res = await fetch(`/api/jobs/neutralize-store-images?storeId=${encodeURIComponent(storeId)}`);
      const data = await res.json();
      if (res.ok && data.progress) {
        const p = data.progress as FilaImagens;
        setProgress(p.total > 0 ? p : null);
        if (p.pending + p.processing > 0) {
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
      // acompanhamento: sem ele a fila segue no servidor
    }
  }

  async function handleStart() {
    setStarting(true);
    setAviso(null);
    try {
      const res = await fetch("/api/jobs/neutralize-store-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, mode, customInstructions: instructions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("start");
      setAviso({
        ok: true,
        texto:
          data.queued === 0
            ? "Nada para trocar: as imagens desta loja já estão na fila ou prontas."
            : `${plural(data.queued ?? 0, "imagem entrou", "imagens entraram")} na fila. A troca acontece aos poucos.`,
      });
      setStarted(true);
      void poll();
    } catch {
      setAviso({ ok: false, texto: "Não deu para começar a troca. Nenhuma imagem mudou; tente de novo." });
    } finally {
      setStarting(false);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    stopPoll();
    try {
      const res = await fetch(`/api/jobs/neutralize-store-images?storeId=${encodeURIComponent(storeId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("cancel");
      if (data.progress) {
        const p = data.progress as FilaImagens;
        setProgress(p.total > 0 ? p : null);
      }
      setAviso({
        ok: true,
        texto: `Troca parada: ${plural(data.canceled || 0, "imagem saiu", "imagens saíram")} da fila. As já trocadas continuam.`,
      });
    } catch {
      setAviso({ ok: false, texto: "Não deu para parar a troca. Ela continua; tente de novo." });
      void poll();
    } finally {
      setCanceling(false);
    }
  }

  const done = progress ? progress.completed + progress.failed : 0;
  const pct = progress ? Math.round((done / Math.max(progress.total, 1)) * 100) : 0;
  const running = progress ? progress.pending + progress.processing > 0 : false;
  const falta =
    !!estimate &&
    estimate.billingEnforced &&
    estimate.creditBalance !== null &&
    estimate.estimatedCredits > estimate.creditBalance;

  let textoEstimativa: string;
  if (estimating || !estimate) textoEstimativa = "Calculando quantas fotos a troca refaz…";
  else if (!estimate.billingEnforced) textoEstimativa = "Por enquanto, refazer fotos não desconta do saldo.";
  else if (estimate.estimatedCredits === 0) textoEstimativa = "Nenhuma foto será refeita.";
  else
    textoEstimativa = `Vai refazer até ${plural(estimate.estimatedCredits, "foto", "fotos")} sem marca${
      estimate.creditBalance !== null ? `. Você tem ${estimate.creditBalance.toLocaleString("pt-BR")}.` : "."
    }`;
  const faltam = falta && estimate ? estimate.estimatedCredits - (estimate.creditBalance ?? 0) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Refazer imagens sem marca</DialogTitle>
          <DialogDescription>
            Recria a imagem de cada produto de <span className="font-medium text-ink">{storeLabel}</span>, em
            segundo plano. Você pode fechar esta janela.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <RadioGroup
            rotulo="O que fazer com a imagem"
            arranjo="grade"
            className="sm:grid-cols-2"
            valor={mode}
            onValor={setMode}
            opcoes={MODOS}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={idInstrucoes}>Instruções extras (opcional)</Label>
            <Textarea
              id={idInstrucoes}
              rows={2}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Ex.: manter o escudo do time, remover só o selo do vendedor."
              className="min-h-16 text-dense"
            />
          </div>

          {/* A falta aparece tambem depois de uma troca anterior: o "Trocar de
              novo" fica bloqueado e precisa dizer por que. */}
          {falta && !running ? (
              <Callout
                tom="err"
                titulo={`${faltam === 1 ? "Falta" : "Faltam"} ${plural(faltam, "foto", "fotos")} com IA`}
                acao={
                  <Link href="/billing?comprar=1" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    Comprar fotos
                  </Link>
                }
              >
                Vai refazer até {plural(estimate?.estimatedCredits ?? 0, "foto", "fotos")}. Você tem{" "}
                {(estimate?.creditBalance ?? 0).toLocaleString("pt-BR")}.
              </Callout>
          ) : !progress?.total ? (
              <p aria-live="polite" className="text-dense text-t1">
                {textoEstimativa}
              </p>
          ) : null}

          {progress && progress.total > 0 ? (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
              <Progresso valor={pct} rotulo="Imagens trocadas" />
              <p aria-live="polite" className="text-dense text-t1">
                {progress.completed.toLocaleString("pt-BR")} de {progress.total.toLocaleString("pt-BR")} trocadas
                {progress.failed > 0 ? ` · ${plural(progress.failed, "falhou", "falharam")}` : ""}
                {running ? " · em andamento" : " · concluído"}
              </p>
            </div>
          ) : null}

          <div aria-live="polite">
            {aviso ? (
              <Callout tom={aviso.ok ? "ok" : "err"} titulo={aviso.ok ? "Pronto" : "Não deu certo"}>
                {aviso.texto}
              </Callout>
            ) : null}
          </div>

          {running ? (
            <Button variant="secondary" pending={canceling} onClick={handleCancel}>
              Parar a troca de imagens
            </Button>
          ) : (
            <Button pending={starting} disabled={falta} onClick={handleStart}>
              {started
                ? "Trocar de novo"
                : estimate && estimate.estimatedCredits > 0
                  ? `Refazer ${plural(estimate.estimatedCredits, "foto", "fotos")}`
                  : "Trocar as imagens agora"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
