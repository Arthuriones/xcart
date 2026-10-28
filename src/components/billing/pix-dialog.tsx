"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Copy, Check, Clock, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
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
// contador do prazo do codigo, e fechar no meio da espera pergunta antes -- um
// clique fora nao some mais com o QR.
//
// O fim nunca e declarado pelo relogio local: "Nada foi cobrado" so quando a
// Pagou diz que o codigo morreu. No fim do prazo sai uma consulta, e o que ela
// nao decidir vira "se ja pagou, nao pague de novo" -- e a consulta continua
// (pago no fim do prazo cai segundos depois), ate CONSULTA_POS_PRAZO_MS. No
// celular o JS fica parado enquanto o lojista esta no app do banco: a volta
// para a aba consulta na hora.
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

const INTERVALO_MS = 4000; // entre o FIM de uma consulta e o comeco da proxima
const PRAZO_CONSULTA_MS = 8000; // consulta pendurada vira falha, nao segura a fila
const LIMITE_MS = 12 * 60 * 1000; // prazo de reserva, quando o expiresAt nao serve
const CONSULTA_POS_PRAZO_MS = 30 * 60 * 1000; // depois do prazo, consulta sozinha ate aqui
const FALHAS_PARA_AVISO = 3; // consultas seguidas sem resposta antes do aviso
const LADO_QR = 240; // px — casa com o box do modal em telas pequenas

/**
 * Prazo do codigo (ms). O expiresAt da Pagou so vale se cair entre 1 min e
 * 2 h depois de agora: data sem fuso e lida como hora local e erraria em
 * horas. Ilegivel ou fora da faixa: agora + LIMITE_MS.
 */
export function limiteDoPix(expiresAt: string | null | undefined, agora: number): number {
  // O Safari recusa "AAAA-MM-DD HH:MM:SS" (com espaco).
  const lido = expiresAt ? Date.parse(expiresAt.trim().replace(" ", "T")) : NaN;
  if (Number.isFinite(lido) && lido >= agora + 60_000 && lido <= agora + 2 * 60 * 60_000) {
    return lido;
  }
  return agora + LIMITE_MS;
}

/** O que uma resposta do PATCH /api/billing/credits diz sobre o Pix. */
export type ConsultaPix =
  | { tipo: "pago"; aplicado: boolean }
  | { tipo: "encerrado" } // a Pagou diz que o codigo nao vale mais
  | { tipo: "aguardando" } // a Pagou respondeu e ainda nao caiu
  | { tipo: "falhou"; sessao: boolean }; // nao deu para conferir

const ENCERRADOS = ["refused", "canceled", "expired"];

export function lerConsulta(ok: boolean, http: number, corpo: unknown): ConsultaPix {
  const dados = corpo && typeof corpo === "object" ? (corpo as { status?: unknown; aplicado?: unknown }) : {};
  // Erro (401, 404, 502, 503...) vem sem status: e falha, nunca desfecho.
  if (!ok || typeof dados.status !== "string") return { tipo: "falhou", sessao: http === 401 };
  // aplicado === false: a Pagou confirmou, mas o RPC falhou (o PATCH repete).
  if (dados.status === "paid") return { tipo: "pago", aplicado: dados.aplicado !== false };
  if (ENCERRADOS.includes(dados.status)) return { tipo: "encerrado" };
  return { tipo: "aguardando" };
}

export type StatusPix =
  | "aguardando"
  | "liberando" // pago, ainda aplicando
  | "pago"
  | "expirado" // a Pagou encerrou: nada foi cobrado
  | "tempo_acabou" // prazo local acabou e a Pagou ainda nao confirmou
  | "nao_confirmado"; // prazo acabou sem conseguir consultar

/**
 * Para onde a tela vai depois de uma consulta (null = segue esperando).
 * `venceu` = esta era a consulta do fim do prazo.
 */
export function proximoStatus(c: ConsultaPix, venceu: boolean): StatusPix | null {
  if (c.tipo === "pago") return c.aplicado ? "pago" : "liberando";
  if (c.tipo === "encerrado") return "expirado";
  if (!venceu) return null;
  return c.tipo === "falhou" ? "nao_confirmado" : "tempo_acabou";
}

/**
 * Daqui a quanto sai a proxima consulta sozinha (null = so na volta para a
 * aba). Esperando, o tique do fim cai no prazo exato. Depois do prazo
 * (tempo_acabou, nao_confirmado) segue consultando: o lojista que pagou no fim
 * ve a confirmacao aqui, e quem abriu o Pix nao oferece outro -- mas so ate
 * CONSULTA_POS_PRAZO_MS, para modal esquecido aberto nao consultar a Pagou
 * para sempre. Pago e expirado param.
 */
export function esperaDaConsulta(status: StatusPix, agora: number, limite: number): number | null {
  if (status === "aguardando") {
    const falta = limite - agora;
    return falta > 0 ? Math.min(INTERVALO_MS, falta) : INTERVALO_MS;
  }
  if (status === "liberando") return INTERVALO_MS;
  if (status === "tempo_acabou" || status === "nao_confirmado") {
    return agora < limite + CONSULTA_POS_PRAZO_MS ? INTERVALO_MS : null;
  }
  return null;
}

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
  // Ja copiou uma vez: o passo seguinte fica na tela para a volta do banco.
  const [dica, setDica] = useState(false);
  // No celular o QR so aparece a pedido (ninguem le o QR da propria tela).
  const [verQr, setVerQr] = useState(false);
  const [status, setStatus] = useState<StatusPix>("aguardando");
  const [falhas, setFalhas] = useState(0);
  const [sessaoCaiu, setSessaoCaiu] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  // Prazo fixado quando o modal abriu: inicializador preguicoso roda uma vez so.
  const [limite] = useState(() => limiteDoPix(cobranca.pix.expiresAt, Date.now()));
  const [agora, setAgora] = useState(() => Date.now());
  const avisouPago = useRef(false);
  const ehPro = cobranca.kind === "pro_month";
  const restante = Math.max(0, limite - agora);

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
            /* se falhar, o copia-e-cola continua servindo */
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

  // Consulta ao abrir, INTERVALO_MS depois de cada resposta (nunca duas ao
  // mesmo tempo, cada uma com PRAZO_CONSULTA_MS) e na volta para a aba. Com a
  // aba oculta o tique so reagenda. Depois do prazo continua (esperaDaConsulta):
  // em tempo_acabou/nao_confirmado `venceu` sai false, entao so pago, liberando
  // ou expirado (a Pagou encerrou) trocam a tela.
  useEffect(() => {
    if (status === "pago" || status === "expirado") return;
    let vivo = true;
    let buscando = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let emCurso: AbortController | null = null;

    function agendar() {
      clearTimeout(timer);
      const espera = esperaDaConsulta(status, Date.now(), limite);
      if (espera !== null) timer = setTimeout(tique, espera);
    }

    async function consultar(): Promise<ConsultaPix> {
      const controle = new AbortController();
      emCurso = controle;
      const prazo = setTimeout(() => controle.abort(), PRAZO_CONSULTA_MS);
      try {
        const res = await fetch("/api/billing/credits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId: cobranca.transactionId }),
          signal: controle.signal,
        });
        return lerConsulta(res.ok, res.status, await res.json().catch(() => null));
      } catch {
        return { tipo: "falhou", sessao: false };
      } finally {
        clearTimeout(prazo);
        emCurso = null;
      }
    }

    async function tique() {
      clearTimeout(timer);
      if (!vivo || buscando) return;
      if (document.visibilityState === "hidden") {
        agendar();
        return;
      }
      const venceu = status === "aguardando" && Date.now() >= limite;
      buscando = true;
      const c = await consultar();
      buscando = false;
      if (!vivo) return;
      if (c.tipo === "falhou") {
        setFalhas((n) => n + 1);
        setSessaoCaiu(c.sessao);
      } else {
        setFalhas(0);
        setSessaoCaiu(false);
      }
      const proximo = proximoStatus(c, venceu);
      // Pago, aplicado ou nao: quem abriu o Pix atualiza a tela de tras ao
      // fechar (e nao oferece "Gerar Pix" de novo).
      if ((proximo === "pago" || proximo === "liberando") && !avisouPago.current) {
        avisouPago.current = true;
        onPago();
      }
      if (proximo && proximo !== status) {
        setStatus(proximo);
        setConfirmarSaida(false);
        return;
      }
      agendar();
    }

    function aoVoltar() {
      if (document.visibilityState === "visible") void tique();
    }
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("pageshow", aoVoltar);
    // Ao abrir, na hora; nos outros estados uma consulta acabou de responder.
    if (status === "aguardando") void tique();
    else agendar();

    return () => {
      vivo = false;
      clearTimeout(timer);
      emCurso?.abort();
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("pageshow", aoVoltar);
    };
  }, [cobranca.transactionId, status, onPago, limite]);

  async function copiar() {
    if (!cobranca.pix.qrCode) return;
    try {
      await navigator.clipboard.writeText(cobranca.pix.qrCode);
      setCopiado(true);
      setDica(true);
      toast.success("Código Pix copiado.");
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      toast.error("Não deu para copiar. Toque no código para selecionar e copie à mão.");
    }
  }

  // Esc, X ou "Fechar": no meio da espera, pergunta antes; depois, fecha.
  function pedirFechar() {
    if (status === "aguardando") setConfirmarSaida(true);
    else onFechar();
  }

  const nomePlano = `Plano ${cobranca.nomePlano ?? "Pro"}`;
  const oQue = ehPro ? `${nomePlano} por 30 dias` : `${creditos(cobranca.credits)} com IA`;
  const libera = ehPro ? "o plano libera" : "as fotos entram";
  const fim =
    status === "expirado"
      ? {
          titulo: "O código Pix expirou",
          texto: "Nada foi cobrado. Gere outro código quando quiser pagar.",
        }
      : status === "tempo_acabou"
        ? {
            titulo: "O tempo deste código acabou",
            texto: `Se você já pagou, não pague de novo: a confirmação chega sozinha e ${libera}. Se não pagou, gere outro código.`,
          }
        : status === "nao_confirmado"
          ? {
              titulo: sessaoCaiu ? "Sua sessão expirou" : "Não conseguimos confirmar o pagamento",
              texto: `${sessaoCaiu ? "Entre de novo. " : ""}Se você já pagou, não pague de novo: a confirmação chega sozinha em alguns minutos e ${libera}. Se não pagou, gere outro código.`,
            }
          : null;

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(aberto) => {
        if (!aberto) pedirFechar();
      }}
    >
      <DialogContent size="sm" className="grid-cols-[minmax(0,1fr)] gap-4">
        {status === "pago" || status === "liberando" ? (
          <div role="status" className="flex flex-col items-center gap-3 py-2 text-center">
            <span
              aria-hidden
              className="grid size-11 place-items-center rounded-full border border-ok-border bg-ok-bg text-ok"
            >
              <CircleCheck className="size-5" strokeWidth={1.75} />
            </span>
            <DialogTitle>{status === "pago" ? "Pagamento confirmado" : "Pagamento recebido"}</DialogTitle>
            <DialogDescription>
              {status === "liberando"
                ? ehPro
                  ? `Estamos liberando o ${nomePlano}; não precisa pagar de novo.`
                  : `Estamos lançando ${creditos(cobranca.credits)} no seu saldo; não precisa pagar de novo.`
                : ehPro
                  ? `O ${nomePlano} está ativo por mais 30 dias.`
                  : `${creditos(cobranca.credits)} entraram no seu saldo.`}
            </DialogDescription>
            {status === "liberando" ? (
              <Button variant="secondary" className="mt-1 w-full" onClick={onFechar}>
                Fechar
              </Button>
            ) : (
              <Button className="mt-1 w-full" onClick={onFechar}>
                Continuar
              </Button>
            )}
          </div>
        ) : fim ? (
          <div className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>{fim.titulo}</DialogTitle>
              <DialogDescription>{fim.texto}</DialogDescription>
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
              // Ordem: no celular o copia e cola vem primeiro e o QR fica atras
              // de um botao (quem paga no mesmo aparelho nao le o QR da propria
              // tela); do sm para cima, o QR na frente.
              <div className="flex flex-col gap-4">
                <div className={`${verQr ? "flex" : "hidden sm:flex"} order-5 justify-center sm:order-1`}>
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
                </div>

                <p className="order-2 flex items-center justify-center gap-1.5 text-label text-t2">
                  <Clock aria-hidden className="size-3.5" strokeWidth={1.75} />
                  Expira em <span className="num font-medium text-ink">{contagem(restante)}</span>
                </p>

                <ol className="order-3 flex list-decimal flex-col gap-0.5 pl-5 text-dense text-t1">
                  <li>Abra o app do seu banco e escolha pagar com Pix.</li>
                  <li>Cole o código no app do banco (ou leia o QR code em outro aparelho).</li>
                </ol>

                {!verQr ? (
                  <Button variant="ghost" className="order-4 sm:hidden" onClick={() => setVerQr(true)}>
                    <QrCode aria-hidden />
                    Mostrar QR code
                  </Button>
                ) : null}

                <div className="order-1 flex flex-col gap-1.5 sm:order-4">
                  <span className="text-label font-medium text-t1">Pix copia e cola</span>
                  {/* select-all: um toque seleciona o codigo inteiro quando a
                      copia falha (navegador embutido do Instagram, por exemplo). */}
                  <code className="line-clamp-2 select-all break-all rounded-control border border-border bg-surface-2 px-3 py-2 font-mono text-label text-t1">
                    {cobranca.pix.qrCode}
                  </code>
                  <Button size="lg" className="w-full" onClick={copiar}>
                    {copiado ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copiado ? "Copiado" : "Copiar código Pix"}
                  </Button>
                  {dica ? (
                    <p className="text-label text-t2">
                      Abra o app do banco &gt; Pix &gt; Copia e cola. Volte aqui depois: a confirmação
                      aparece sozinha.
                    </p>
                  ) : null}
                </div>
              </div>
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
            {falhas >= FALHAS_PARA_AVISO ? (
              <Callout
                tom="warn"
                role="status"
                titulo={sessaoCaiu ? "Sua sessão expirou." : "Não conseguimos conferir o pagamento agora."}
              >
                {sessaoCaiu
                  ? "Entre de novo; se você já pagou, o pagamento vale."
                  : "Se você já pagou, não pague de novo: ele entra sozinho assim que o banco confirmar."}
              </Callout>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
