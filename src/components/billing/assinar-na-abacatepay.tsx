"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ERRO_PADRAO, mensagemDeErro, type ErroNaTela } from "@/components/billing/regras";

// ============================================================================
// Assinar pela pagina da AbacatePay (o cartao nao e digitado aqui).
//
// POST /api/billing/subscribe { plano, volta } devolve a `url` do checkout de
// assinatura dela; o lojista paga la (3DS e, se liberado, Pix Automatico) e
// volta para `volta` com ?assinatura=ok. Quem liga o Pro e o webhook: a tela
// de volta so confere (secao-plano.tsx, assinar-paywall.tsx).
// ============================================================================

export function AssinarNaAbacatePay({
  plano,
  rotulo,
  volta,
  comPix,
}: {
  plano: string;
  /** O que o botao diz: o plano e o valor. */
  rotulo: string;
  /** Para onde a pagina da AbacatePay devolve. */
  volta: "billing" | "paywall";
  /** O checkout aceita Pix Automatico. */
  comPix: boolean;
}) {
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<ErroNaTela | null>(null);

  async function ir() {
    setErro(null);
    setIndo(true);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano, volta }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== "string") {
        setErro(mensagemDeErro(res.status, data.error, ERRO_PADRAO.pagina));
        setIndo(false);
        return;
      }
      // O botao fica "carregando" ate a pagina da AbacatePay abrir.
      window.location.assign(data.url);
    } catch {
      setErro({ texto: ERRO_PADRAO.pagina, detalhe: null });
      setIndo(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
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
      <Button size="lg" className="w-full" onClick={ir} pending={indo}>
        {indo ? null : <ExternalLink aria-hidden />}
        {rotulo}
      </Button>
      <p className="text-center text-label text-t2">
        {comPix
          ? "Você paga com cartão ou Pix Automático na página segura da AbacatePay e volta para cá. Renova sozinho todo mês."
          : "Você paga com cartão na página segura da AbacatePay e volta para cá. Renova sozinho todo mês."}
      </p>
    </div>
  );
}
