"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// ============================================================================
// Cobranca Pix.
//
// Pix e assincrono: o usuario paga fora do app e a confirmacao chega depois.
// Esta tela consulta o backend periodicamente em vez de depender so do webhook,
// porque o webhook pode atrasar — e quem esta olhando a tela quer feedback.
// A confirmacao sempre vem da API da Pagou, nunca do cliente.
// ============================================================================

export interface CobrancaPix {
  transactionId: string;
  credits: number;
  amountCents: number;
  kind?: "credits" | "pro_month";
  pix: { qrCode: string | null; expiresAt: string | null };
}

const INTERVALO_MS = 4000;
const LIMITE_MS = 12 * 60 * 1000; // acima disso o QR normalmente expira
const LADO_QR = 240; // px — casa com o box do modal em telas pequenas

export function PixDialog({
  cobranca,
  onPago,
  onFechar,
}: {
  cobranca: CobrancaPix;
  onPago: () => void;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [status, setStatus] = useState<"aguardando" | "pago" | "expirado">("aguardando");
  // Marcado no efeito, nao no argumento do useRef.
  //
  // `useRef(Date.now())` avalia Date.now() a CADA render (o ref so guarda o
  // primeiro valor, mas a chamada acontece sempre). O React Compiler passou a
  // recusar isso: funcao impura durante o render pode produzir resultado
  // instavel quando o componente re-renderiza. Aqui o valor certo e "quando o
  // modal abriu", que e exatamente o que um efeito de montagem da.
  const inicio = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const ehPro = cobranca.kind === "pro_month";

  // Fecha no Esc e trava o scroll do fundo enquanto o modal esta aberto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onFechar]);

  // Renderiza o QR no proprio canvas, sem enviar o payload para fora.
  useEffect(() => {
    const codigo = cobranca.pix.qrCode;
    if (!codigo || !canvasRef.current || status !== "aguardando") return;
    let vivo = true;
    import("qrcode").then((QR) => {
      const canvas = canvasRef.current;
      if (!vivo || !canvas) return;
      QR.toCanvas(canvas, codigo, {
        width: LADO_QR * 2, // 2x para nao serrilhar em tela retina
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      })
        .then(() => {
          // A lib grava width/height inline no canvas; sem isto ele renderiza
          // no tamanho do bitmap (480px) e estoura a borda do modal.
          canvas.style.width = `${LADO_QR}px`;
          canvas.style.height = `${LADO_QR}px`;
        })
        .catch(() => {
          /* se falhar, o copia-e-cola abaixo continua servindo */
        });
    });
    return () => {
      vivo = false;
    };
  }, [cobranca.pix.qrCode, status]);

  useEffect(() => {
    inicio.current = Date.now();
  }, []);

  useEffect(() => {
    if (status !== "aguardando") return;
    let vivo = true;

    const timer = setInterval(async () => {
      if (!vivo) return;
      if (Date.now() - inicio.current > LIMITE_MS) {
        setStatus("expirado");
        return;
      }
      try {
        const res = await fetch("/api/billing/credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId: cobranca.transactionId }),
        });
        const data = await res.json();
        if (!vivo) return;
        if (data.status === "paid") {
          setStatus("pago");
          onPago();
        } else if (["refused", "canceled", "expired"].includes(data.status)) {
          setStatus("expirado");
        }
      } catch {
        /* rede instavel: tenta de novo no proximo ciclo */
      }
    }, INTERVALO_MS);

    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [cobranca.transactionId, status, onPago]);

  async function copiar() {
    if (!cobranca.pix.qrCode) return;
    try {
      await navigator.clipboard.writeText(cobranca.pix.qrCode);
      setCopiado(true);
      toast.success("Código Pix copiado.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("Não foi possível copiar. Selecione o código manualmente.");
    }
  }

  const reais = (cobranca.amountCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div className="relative my-auto w-full max-w-sm rounded-2xl border border-border/60 bg-card shadow-2xl">
        <button
          onClick={onFechar}
          aria-label="Fechar"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {status === "pago" ? (
          <div className="space-y-3 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Check className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Pagamento confirmado</h3>
            <p className="text-sm text-muted-foreground">
              {ehPro
                ? "Seu plano Pro está ativo por 30 dias."
                : `${cobranca.credits} créditos entraram na sua conta.`}
            </p>
            <Button className="w-full" onClick={onFechar}>
              Continuar
            </Button>
          </div>
        ) : status === "expirado" ? (
          <div className="space-y-3 p-8 text-center">
            <h3 className="text-lg font-semibold">Cobrança expirada</h3>
            <p className="text-sm text-muted-foreground">
              O código Pix não foi pago a tempo. Nada foi cobrado — é só gerar
              outro.
            </p>
            <Button className="w-full" variant="outline" onClick={onFechar}>
              Fechar
            </Button>
          </div>
        ) : (
          <div className="p-6">
            <div className="mb-1 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pagamento via Pix
              </span>
            </div>
            <h3 className="text-2xl font-semibold text-foreground">{reais}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {ehPro ? "xcart Pro — 30 dias" : `${cobranca.credits} créditos de IA`}
            </p>

            {cobranca.pix.qrCode ? (
              <>
                <div className="mt-5 flex justify-center">
                  <div className="rounded-xl bg-white p-3 shadow-sm">
                    {/* Desenhado localmente: mandar o payload do Pix para um
                        gerador de terceiro vazaria a cobranca. */}
                    <canvas
                      ref={canvasRef}
                      className="block max-w-full rounded"
                      style={{ width: LADO_QR, height: LADO_QR }}
                    />
                  </div>
                </div>

                <p className="mt-4 text-xs font-medium text-foreground">
                  Ou copie o código:
                </p>
                <div className="mt-1.5 flex gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {cobranca.pix.qrCode}
                  </code>
                  <Button
                    size="sm"
                    variant={copiado ? "default" : "outline"}
                    onClick={copiar}
                    className="shrink-0"
                    aria-label="Copiar código Pix"
                  >
                    {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-5 text-sm text-destructive">
                A Pagou não devolveu o código Pix. Feche e tente novamente.
              </p>
            )}

            <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border/50 bg-background/40 py-2.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Aguardando confirmação — libera sozinho
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
