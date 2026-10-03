"use client";

import { useCallback, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { cpfValido, digitos } from "@/lib/billing/documento";
import type { CobrancaPix } from "@/components/billing/pix-dialog";
import { CampoCpf } from "@/components/billing/campo-cpf";
import { Escolha } from "@/components/billing/escolha";
import {
  ERRO_PADRAO,
  brl,
  creditos,
  mensagemDeErro,
  precoPorCredito,
  type ErroNaTela,
  type PacoteNaTela,
} from "@/components/billing/regras";

// So monta quando existe uma cobranca Pix aberta.
const PixDialog = dynamic(
  () => import("@/components/billing/pix-dialog").then((m) => m.PixDialog),
  { ssr: false }
);

/**
 * Recarga avulsa por Pix. Uma escolha (radiogroup) e UMA acao: gerar o Pix
 * do pacote marcado. O corpo do POST e o de sempre: { packId, document? }.
 * O CPF aparece com rotulo quando ainda nao ha um salvo (ou quando o
 * servidor pede), e o erro fica no campo, nao so num toast.
 */
export function ComprarCreditos({
  pacotes,
  temDocumento,
}: {
  pacotes: PacoteNaTela[];
  temDocumento: boolean;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [cpf, setCpf] = useState("");
  const [pedirCpf, setPedirCpf] = useState(!temDocumento);
  const [erroCpf, setErroCpf] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroNaTela | null>(null);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<CobrancaPix | null>(null);

  const pacote = pacotes.find((p) => p.id === escolhido) ?? null;
  // Estavel: o PixDialog reinicia a consulta quando onPago muda.
  const atualizarSaldo = useCallback(() => iniciar(() => router.refresh()), [router]);

  async function comprar() {
    if (!pacote) return;
    setErro(null);
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
          packId: pacote.id,
          ...(cpf.trim() ? { document: cpf } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Primeira compra: em vez de erro solto, abre o campo de CPF.
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
        pix: data.pix,
      });
    } catch {
      setErro({ texto: ERRO_PADRAO.pix, detalhe: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      titulo="Comprar créditos"
      descricao="Pagamento único por Pix. Os créditos entram no saldo assim que o pagamento é confirmado."
    >
      {pacotes.length === 0 ? (
        <p className="text-dense text-t2">Nenhum pacote disponível agora.</p>
      ) : (
        <Escolha
          rotulo="Pacote de créditos"
          valor={escolhido}
          onValor={(v) => {
            setEscolhido(v);
            setErro(null);
          }}
          className="lg:grid-cols-3"
          opcoes={pacotes.map((p) => ({
            valor: p.id,
            titulo: creditos(p.credits),
            descricao: (
              <span className="num">
                {precoPorCredito(p.centavosPorCredito)} por crédito
                {p.economia !== null ? ` · ${Math.round(p.economia * 100)}% a menos` : ""}
              </span>
            ),
            extra: (
              <span className="flex flex-col items-end gap-1">
                <span className="num text-dense font-semibold text-ink">{brl(p.amountCents)}</span>
                {p.melhor ? <StatusBadge tom="ok" texto="Mais vantajoso" /> : null}
              </span>
            ),
          }))}
        />
      )}

      {pedirCpf ? (
        <CampoCpf
          valor={cpf}
          onValor={(v) => {
            setCpf(v);
            setErroCpf(null);
          }}
          erro={erroCpf}
          onEnter={comprar}
          autoFocus={temDocumento}
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button onClick={comprar} pending={busy} disabled={!pacote}>
          {busy ? null : <QrCode aria-hidden />}
          {pacote ? `Gerar Pix de ${brl(pacote.amountCents)}` : "Escolha um pacote"}
        </Button>
        <span className="text-label text-t2">O código Pix vale por 12 minutos.</span>
      </div>

      {pix ? (
        <PixDialog
          cobranca={pix}
          onPago={atualizarSaldo}
          onFechar={() => {
            setPix(null);
            // Pago depois de fechar (o aviso do banco chega depois): le de novo.
            atualizarSaldo();
          }}
        />
      ) : null}
    </Section>
  );
}
