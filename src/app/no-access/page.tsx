"use client";

import { useState } from "react";
import { textos } from "@/lib/textos";
import { AssinarPro } from "@/components/billing/assinar-pro";
import { APP_HOME } from "@/lib/app-home";

/**
 * Paywall. O layout do dashboard manda todo mundo sem acesso para ca, entao
 * NAO da para so linkar /billing: a rota esta atras da mesma trava e o usuario
 * voltaria para esta pagina em loop. O formulario de cartao mora aqui mesmo.
 *
 * Antes esta tela chamava /api/billing/checkout, que era o Checkout hospedado
 * do Stripe. A Pagou nao tem equivalente para assinatura, e a rota deixou de
 * existir na migracao — o botao batia em 404 e ninguem conseguia assinar.
 */
export default function NoAccessPage() {
  const t = textos("noAccess");
  const [mostrarCartao, setMostrarCartao] = useState(false);

  async function logout() {
    // Rota de API: evita puxar o cliente Supabase para o bundle desta tela.
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2">
          <span
            className="h-5 w-5 rounded-[5px]"
            style={{ background: "var(--brand)" }}
            aria-hidden
          />
          <span className="text-[14px] font-bold tracking-[0.06em] text-ink">XCART</span>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">
            {t("title")}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-t2">{t("body")}</p>

          {mostrarCartao ? (
            <div className="mt-5">
              <AssinarPro
                onPronto={() =>
                  // Recarrega para o layout reavaliar o acesso e liberar o app.
                  setTimeout(() => window.location.replace(APP_HOME), 900)
                }
              />
              <button
                onClick={() => setMostrarCartao(false)}
                className="mt-3 w-full text-[12px] text-t3 hover:text-ink"
              >
                Voltar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setMostrarCartao(true)}
              className="mt-5 h-9 w-full rounded-md bg-[var(--solid)] text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)] active:translate-y-px"
            >
              {t("subscribe")}
            </button>
          )}
        </div>

        <button
          onClick={logout}
          className="mt-4 w-full text-[12px] text-t3 hover:text-ink"
        >
          {t("logout")}
        </button>
      </div>
    </div>
  );
}
