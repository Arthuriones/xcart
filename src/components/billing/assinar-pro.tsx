"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, CreditCard, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { CobrancaPix } from "@/components/billing/pix-dialog";
import { PRO_PRICE_CENTS } from "@/lib/billing/plans";
import { cpfValido, digitos } from "@/lib/billing/documento";
import { BENEFICIOS_PRO } from "@/components/billing/beneficios";
import { CampoCpf } from "@/components/billing/campo-cpf";
import { Escolha } from "@/components/billing/escolha";
import { ERRO_PADRAO, brl, mensagemDeErro, type ErroNaTela } from "@/components/billing/regras";

// So aparecem depois de escolher a forma de pagamento. Somados sao 16 KB que
// todo mundo baixava para ver o botao de assinar.
const PagouCardForm = dynamic(
  () => import("@/components/billing/pagou-card-form").then((m) => m.PagouCardForm),
  { ssr: false }
);
const PixDialog = dynamic(
  () => import("@/components/billing/pix-dialog").then((m) => m.PixDialog),
  { ssr: false }
);

// ============================================================================
// Assinar o Pro. Usado na Assinatura e no paywall.
//
// Dois caminhos, porque o processador nao tem um so que sirva para todo mundo:
//  - Cartao: assinatura de verdade, renova sozinha.
//  - Pix: cobranca avulsa que libera 30 dias. Nao renova (a recorrencia so
//    existe no cartao).
// Os corpos das chamadas sao os de antes: { packId: "pro_month", document? }
// para o Pix e o token do cartao em /api/billing/subscribe.
// ============================================================================

type Via = "cartao" | "pix";

export function AssinarPro({
  onPronto,
  somentePix = false,
  temDocumento,
  mostrarResumo = true,
}: {
  /** Pagamento confirmado (cartao aceito ou Pix pago). */
  onPronto: () => void;
  /** So o Pix: renovar quem ja paga por Pix (os dias se somam). */
  somentePix?: boolean;
  /** O CPF ja esta salvo? undefined = nao se sabe (pede so se o servidor pedir). */
  temDocumento?: boolean;
  /** Resumo com preco e o que inclui. */
  mostrarResumo?: boolean;
}) {
  const [via, setVia] = useState<Via | null>(somentePix ? "pix" : null);
  const [cpf, setCpf] = useState("");
  const [pedirCpf, setPedirCpf] = useState(temDocumento === false);
  const [erroCpf, setErroCpf] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroNaTela | null>(null);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<CobrancaPix | null>(null);
  const pixPago = useRef(false);
  // Estavel: o PixDialog reinicia a consulta quando onPago muda.
  const marcarPago = useCallback(() => {
    pixPago.current = true;
  }, []);

  async function gerarPix() {
    setErro(null);
    // CPF conferido aqui antes de ir ao servidor: o erro aparece no campo.
    if (pedirCpf && !cpfValido(digitos(cpf))) {
      setErroCpf(digitos(cpf) ? "CPF inválido. Confira os números." : "Informe o CPF do pagador.");
      return;
    }
    setErroCpf(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: "pro_month",
          ...(cpf.trim() ? { document: cpf } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsDocument) {
          setPedirCpf(true);
          setErroCpf(pedirCpf ? mensagemDeErro(res.status, data.error, "Confira o CPF.").texto : null);
          return;
        }
        setErro(mensagemDeErro(res.status, data.error, ERRO_PADRAO.pix));
        return;
      }
      setPedirCpf(false);
      setPix({
        transactionId: data.transactionId,
        credits: data.credits,
        amountCents: data.amountCents,
        kind: "pro_month",
        pix: data.pix,
      });
    } catch {
      setErro({ texto: ERRO_PADRAO.pix, detalhe: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    // @container: os cartoes de forma de pagamento ficam lado a lado so quando
    // o bloco e largo (Assinatura), e empilhados na coluna estreita do paywall.
    <div className="@container flex flex-col gap-4">
      {mostrarResumo ? (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-section text-ink">Plano Pro</span>
            <span className="flex items-baseline gap-1">
              <span className="num text-page text-ink">{brl(PRO_PRICE_CENTS)}</span>
              <span className="text-dense text-t2">por mês</span>
            </span>
          </div>
          <ul aria-label="O que o Pro inclui" className="flex flex-col gap-1.5 border-t border-border-subtle pt-3">
            {BENEFICIOS_PRO.map((item) => (
              <li key={item} className="flex items-start gap-2 text-dense text-t1">
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!somentePix ? (
        <div className="flex flex-col gap-2">
          <p id="forma-pagamento" className="text-dense font-medium text-ink">
            Como você prefere pagar?
          </p>
          <Escolha<Via>
            rotulo="Forma de pagamento"
            valor={via}
            onValor={(v) => {
              setVia(v);
              setErro(null);
            }}
            className="@md:grid-cols-2"
            opcoes={[
              {
                valor: "cartao",
                titulo: "Cartão de crédito",
                descricao: "Renova sozinho todo mês",
                icone: <CreditCard />,
              },
              {
                valor: "pix",
                titulo: "Pix",
                descricao: "Libera 30 dias na hora, sem renovação automática",
                icone: <QrCode />,
              },
            ]}
          />
        </div>
      ) : null}

      {via === "cartao" ? (
        <PagouCardForm
          // O botao diz o que acontece e quanto custa, em vez de um
          // "Assinar agora" que esconde o valor.
          labelBotao={`Assinar por ${brl(PRO_PRICE_CENTS)} por mês`}
          onSuccess={(dados) => {
            const pendente = (dados as { pending?: boolean } | null)?.pending === true;
            if (pendente) toast.info("Pagamento em processamento. O Pro libera assim que o banco confirmar.");
            else toast.success("Assinatura confirmada.");
            onPronto();
          }}
        />
      ) : null}

      {via === "pix" ? (
        <div className="flex flex-col gap-3">
          {pedirCpf ? (
            <CampoCpf
              valor={cpf}
              onValor={(v) => {
                setCpf(v);
                setErroCpf(null);
              }}
              erro={erroCpf}
              onEnter={gerarPix}
              autoFocus={temDocumento !== false}
            />
          ) : null}
          {erro ? (
            <Callout tom="err" titulo={erro.texto} role="alert">
              {erro.detalhe ? (
                <details className="text-label text-t2">
                  <summary className="cursor-pointer">Detalhes para o suporte</summary>
                  <p className="mt-1 break-words font-mono">{erro.detalhe}</p>
                </details>
              ) : null}
            </Callout>
          ) : null}
          <Button size="lg" className="w-full" onClick={gerarPix} pending={busy}>
            {busy ? null : <QrCode aria-hidden />}
            Gerar Pix de {brl(PRO_PRICE_CENTS)}
          </Button>
          <p className="text-center text-label text-t2">
            {somentePix
              ? "Mais 30 dias de Pro, somados aos que ainda faltam. Não renova sozinho."
              : "Libera 30 dias de Pro assim que o pagamento cair. Não renova sozinho: quando acabar, é só pagar de novo."}
          </p>
        </div>
      ) : null}

      {pix ? (
        <PixDialog
          cobranca={pix}
          onPago={marcarPago}
          // A tela de tras so muda quando o lojista sai do "Pagamento
          // confirmado". Fechar sem pagar nao libera nada: so tira o QR.
          onFechar={() => {
            setPix(null);
            if (pixPago.current) {
              pixPago.current = false;
              onPronto();
            }
          }}
        />
      ) : null}
    </div>
  );
}
