"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Copy, Check, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { brl, contagem, creditos } from "@/components/billing/regras";

// ============================================================================
// Cobranca Pix.
//
// Pix e assincrono: o usuario paga fora do app e a confirmacao chega depois.
// Esta tela consulta o backend periodicamente em vez de depender so do webhook,
// porque o webhook pode atrasar — e quem esta olhando a tela quer feedback.
// A confirmacao sempre vem da API de cobranca, nunca do cliente.
//
// Redesign: Dialog da fundacao (role=dialog, aria-modal, foco preso, Esc), o
// contador dos 12 minutos, e fechar no meio da espera pergunta antes -- um
// clique fora nao some mais com o QR.
// ============================================================================

export interface CobrancaPix {
  transactionId: string;
  credits: number;
  amountCents: number;
  kind?: "credits" | "pro_month";
  /** Nome do plano do Pix de 30 dias ("3 Lojas"). */
  nomePlano?: string;
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
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  // "Quando o modal abriu": inicializador preguicoso roda uma vez so.
  const [inicio] = useState(() => Date.now());
  const [agora, setAgora] = useState(inicio);
  const ehPro = cobranca.kind === "pro_month";
  const restante = Math.max(0, inicio + LIMITE_MS - agora);

  // Renderiza o QR no proprio canvas, sem enviar o payload para fora.
  // Ref de callback, nao efeito: o Dialog monta o conteudo num portal depois
  // do primeiro render, e um efeito rodava com o canvas ainda nulo.
  const desenharQr = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      const codigo = cobranca.pix.qrCode;
      if (!canvas || !codigo) return;
      import("qrcode").then((QR) =>
        QR.toCanvas(canvas, codigo, {
          width: LADO_QR * 2, // 2x para nao serrilhar em tela retina
          margin: 1,
          // QR precisa de contraste maximo para o leitor do banco: preto no
          // branco nos dois temas (a moldura branca vem do box em volta).
          color: { dark: "#000000", light: "#ffffff" },
        })
          .then(() => {
            // A lib grava width/height inline no canvas; tirando, vale o
            // tamanho da classe (240px) e ele nao estoura o modal.
            canvas.style.removeProperty("width");
            canvas.style.removeProperty("height");
          })
          .catch(() => {
            /* se falhar, o copia-e-cola abaixo continua servindo */
          })
      );
    },
    [cobranca.pix.qrCode]
  );

  // Relogio do contador (1 s). O estado so muda no callback do intervalo.
  useEffect(() => {
    if (status !== "aguardando") return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status !== "aguardando") return;
    let vivo = true;

    const timer = setInterval(async () => {
      if (!vivo) return;
      if (Date.now() - inicio > LIMITE_MS) {
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
          setConfirmarSaida(false);
          onPago();
        } else if (["refused", "canceled", "expired"].includes(data.status)) {
          setStatus("expirado");
          setConfirmarSaida(false);
        }
      } catch {
        /* rede instavel: tenta de novo no proximo ciclo */
      }
    }, INTERVALO_MS);

    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, [cobranca.transactionId, status, onPago, inicio]);

  async function copiar() {
    if (!cobranca.pix.qrCode) return;
    try {
      await navigator.clipboard.writeText(cobranca.pix.qrCode);
      setCopiado(true);
      toast.success("Código Pix copiado.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("Não deu para copiar. Selecione o código e copie à mão.");
    }
  }

  // Esc, X ou "Fechar": no meio da espera, pergunta antes; depois, fecha.
  function pedirFechar() {
    if (status === "aguardando") setConfirmarSaida(true);
    else onFechar();
  }

  const nomePlano = `Plano ${cobranca.nomePlano ?? "Pro"}`;
  const oQue = ehPro ? `${nomePlano} por 30 dias` : creditos(cobranca.credits);

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(aberto) => {
        if (!aberto) pedirFechar();
      }}
    >
      <DialogContent size="sm" className="grid-cols-[minmax(0,1fr)] gap-4">
        {status === "pago" ? (
          <div role="status" className="flex flex-col items-center gap-3 py-2 text-center">
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-full border border-ok-border bg-ok-bg text-ok"
            >
              <CircleCheck className="size-5" strokeWidth={1.75} />
            </span>
            <DialogTitle>Pagamento confirmado</DialogTitle>
            <DialogDescription>
              {ehPro
                ? `O ${nomePlano} está ativo por mais 30 dias.`
                : `${creditos(cobranca.credits)} entraram no seu saldo.`}
            </DialogDescription>
            <Button className="mt-1 w-full" onClick={onFechar}>
              Continuar
            </Button>
          </div>
        ) : status === "expirado" ? (
          <div className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>O código Pix expirou</DialogTitle>
              <DialogDescription>
                Nada foi cobrado. Gere outro código quando quiser pagar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={onFechar}>
                Fechar
              </Button>
            </DialogFooter>
          </div>
        ) : confirmarSaida ? (
          <div className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Fechar o Pix?</DialogTitle>
              <DialogDescription>
                O código deixa de aparecer aqui. Se você já pagou, a compra entra sozinha assim que o
                banco confirmar. Se ainda não pagou, gere outro código depois.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={onFechar}>
                Fechar o Pix
              </Button>
              <Button onClick={() => setConfirmarSaida(false)}>Continuar pagando</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Pague com Pix</DialogTitle>
              <DialogDescription>
                <span className="num font-semibold text-ink">{brl(cobranca.amountCents)}</span> · {oQue}
              </DialogDescription>
            </DialogHeader>

            {cobranca.pix.qrCode ? (
              <>
                <div className="flex flex-col items-center gap-2">
                  {/* Box branco nos dois temas: o leitor do banco precisa do
                      contraste do QR. Desenhado localmente: mandar o payload
                      para um gerador de terceiro vazaria a cobranca. */}
                  <div className="rounded-control border border-border bg-white p-3">
                    <canvas
                      ref={desenharQr}
                      role="img"
                      aria-label="QR code do Pix"
                      className="block size-60 max-w-full"
                    />
                  </div>
                  <p className="flex items-center gap-1.5 text-label text-t2">
                    <Clock aria-hidden className="size-3.5" strokeWidth={1.75} />
                    Expira em <span className="num font-medium text-ink">{contagem(restante)}</span>
                  </p>
                </div>

                <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-dense text-t1">
                  <li>Abra o app do seu banco e escolha pagar com Pix.</li>
                  <li>Leia o QR code ou cole o código abaixo.</li>
                </ol>

                <div className="flex flex-col gap-1.5">
                  <span className="text-label font-medium text-t1">Pix copia e cola</span>
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-control border border-border bg-surface-2 px-3 py-2 font-mono text-label text-t1">
                      {cobranca.pix.qrCode}
                    </code>
                    <Button variant={copiado ? "primary" : "secondary"} onClick={copiar} className="shrink-0">
                      {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
                      {copiado ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <p role="alert" className="text-dense font-medium text-err">
                O código Pix não veio. Feche e gere outro; nada foi cobrado.
              </p>
            )}

            <p
              role="status"
              className="flex items-center justify-center gap-2 rounded-control border border-border bg-surface-2 px-3 py-2.5 text-dense text-t1"
            >
              <Spinner size={14} />
              Esperando o pagamento. A confirmação aparece aqui sozinha.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
