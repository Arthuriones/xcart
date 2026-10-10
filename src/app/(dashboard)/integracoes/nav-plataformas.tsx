"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import clsx from "clsx";
import type { TomStatus } from "@/components/ui/status-badge";
import type { EstadosNav, IdPlataforma } from "./regras";

// ============================================================================
// Menu das plataformas: coluna a esquerda no desktop, abas que rolam de lado
// no celular. O estado de cada uma (ponto + palavra) vem do servidor; ate ele
// chegar, so os nomes. No celular a palavra fica so para o leitor de tela.
// ============================================================================

const PLATAFORMAS: { id: IdPlataforma; rotulo: string }[] = [
  { id: "meta", rotulo: "Meta" },
  { id: "google", rotulo: "Google" },
  { id: "shopify", rotulo: "Shopify" },
  { id: "checkouts", rotulo: "Checkouts" },
  { id: "notificacoes", rotulo: "Notificações" },
  { id: "avancado", rotulo: "Avançado" },
];

const PONTO: Record<TomStatus, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
  neutral: "bg-neutral",
  run: "bg-run",
};

export function NavPlataformas({ estados }: { estados: EstadosNav | null }) {
  const segmento = useSelectedLayoutSegment();
  return (
    <nav
      aria-label="Plataformas"
      className="-mx-4 min-w-0 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] lg:mx-0 lg:border-0 lg:px-0"
    >
      <ul className="flex gap-0.5 pb-2 lg:flex-col lg:pb-0">
        {PLATAFORMAS.map((p) => {
          const atual = segmento === p.id;
          const estado = estados?.[p.id] ?? null;
          return (
            <li key={p.id} className="shrink-0">
              <Link
                href={`/integracoes/${p.id}`}
                aria-current={atual ? "page" : undefined}
                className={clsx(
                  "flex h-ctl-lg items-center gap-2.5 rounded-control px-2.5 text-dense whitespace-nowrap transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus lg:h-10",
                  atual ? "bg-nav-active font-semibold text-ink" : "text-t1"
                )}
              >
                <span
                  aria-hidden
                  className={clsx("size-2 shrink-0 rounded-full", estado ? PONTO[estado.tom] : "bg-track")}
                />
                <span className="flex-1">{p.rotulo}</span>
                {estado ? (
                  <span className="sr-only text-label font-normal text-t2 lg:not-sr-only">
                    <span className="sr-only">, </span>
                    {estado.texto}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
