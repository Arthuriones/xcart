"use client";

import { useState } from "react";
import { CircleCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AssinarPro } from "@/components/billing/assinar-pro";
import { APP_HOME } from "@/lib/app-home";

type Fase = "assinar" | "liberando" | "liberado" | "demorando";

const TENTATIVAS = 12;
const INTERVALO_MS = 2500;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * O formulario de assinatura do paywall e o que vem depois do pagamento.
 *
 * O layout do painel manda todo mundo sem acesso para ca, entao NAO da para
 * so linkar /billing: a rota esta atras da mesma trava e o usuario voltaria
 * para esta pagina em loop. O formulario de cartao mora aqui mesmo.
 *
 * Antes, depois de pagar, a tela esperava 900 ms e recarregava sem dizer
 * nada -- e com o cartao ainda processando, o recarregar caia aqui de novo.
 * Agora ela mostra "Liberando acesso…", confere o plano em GET
 * /api/billing/me e so entao abre o app. Se o banco demorar, diz isso.
 */
export function AssinarNoPaywall({ temDocumento }: { temDocumento?: boolean }) {
  const [fase, setFase] = useState<Fase>("assinar");

  async function conferir() {
    setFase("liberando");
    for (let i = 0; i < TENTATIVAS; i++) {
      try {
        const res = await fetch("/api/billing/me", { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          if (d.plan === "pro") {
            setFase("liberado");
            // Recarrega de verdade: o layout reavalia o acesso e libera o app.
            window.location.replace(APP_HOME);
            return;
          }
        }
      } catch {
        /* rede instavel: tenta de novo */
      }
      await esperar(INTERVALO_MS);
    }
    setFase("demorando");
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-5">
      {fase === "assinar" ? (
        <AssinarPro onPronto={conferir} temDocumento={temDocumento} />
      ) : fase === "liberando" ? (
        <div role="status" className="flex min-h-60 flex-col items-center justify-center gap-3 text-center">
          <Spinner size={20} />
          <p className="text-section text-ink">Liberando seu acesso…</p>
          <p className="max-w-80 text-dense text-t1">
            Conferindo o pagamento. Leva alguns segundos; não feche esta página.
          </p>
        </div>
      ) : fase === "liberado" ? (
        <div role="status" className="flex min-h-60 flex-col items-center justify-center gap-3 text-center">
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-full border border-ok-border bg-ok-bg text-ok"
          >
            <CircleCheck className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-section text-ink">Acesso liberado</p>
          <p className="text-dense text-t1">Abrindo o xcart…</p>
        </div>
      ) : (
        <div role="status" className="flex min-h-60 flex-col items-center justify-center gap-3 text-center">
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-full border border-info-border bg-info-bg text-info"
          >
            <Clock className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-section text-ink">O pagamento ainda está sendo processado</p>
          <p className="max-w-80 text-dense text-t1">
            Assim que o banco confirmar, o acesso libera. Não precisa pagar de novo.
          </p>
          <Button onClick={conferir}>Conferir de novo</Button>
        </div>
      )}
    </div>
  );
}

/** Sair da conta. Rota de API: evita puxar o cliente Supabase para esta tela. */
export function BotaoSair() {
  const [saindo, setSaindo] = useState(false);
  async function sair() {
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  return (
    <Button variant="ghost" pending={saindo} onClick={sair}>
      Sair da conta
    </Button>
  );
}
