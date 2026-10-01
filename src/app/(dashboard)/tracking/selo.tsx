import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Plataforma, Tom } from "./saude";

// ============================================================================
// Pecas pequenas da tela de rastreamento.
//
// Substitui os dois Pill que existiam (um em cada arquivo, com verde e amarelo
// fixos da paleta do Tailwind, que nao mudam no escuro). Nao reusa o EstadoLoja de store-table: ele e
// tipado no estado da ROTA e nao tem tom de erro, que aqui e o principal.
// ============================================================================

export const TOM: Record<Tom, { cor: string; fundo: string; borda: string }> = {
  ok: { cor: "var(--ok)", fundo: "var(--ok-bg)", borda: "var(--ok-border)" },
  warn: { cor: "var(--warn)", fundo: "var(--warn-bg)", borda: "var(--warn-border)" },
  err: { cor: "var(--err)", fundo: "var(--err-bg)", borda: "var(--err-border)" },
  neutro: { cor: "var(--t2)", fundo: "var(--track)", borda: "var(--border)" },
};

/** Ponto + palavra. Estado nunca so na cor: a palavra vai junto. */
export function Selo({
  tom,
  children,
  title,
}: {
  tom: Tom;
  children: ReactNode;
  title?: string;
}) {
  const t = TOM[tom];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-[7px] py-0.5 text-[11.5px] font-medium"
      style={{ color: t.cor, background: t.fundo }}
    >
      <span aria-hidden className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Ponto({
  tom,
  tamanho = 6,
  className,
}: {
  tom: Tom;
  tamanho?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ width: tamanho, height: tamanho, background: TOM[tom].cor }}
    />
  );
}

/** Neutra de proposito: cor de marca aqui competiria com a cor de estado. */
export function TagPlataforma({ plataforma }: { plataforma: Plataforma }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded border border-border bg-surface-2 px-1.5 text-[10.5px] font-semibold text-t2">
      {plataforma === "google" ? "Google" : "Meta"}
    </span>
  );
}

/** Faixa de alarme: borda e fundo carregam o estado, o titulo fica em ink. */
export function Aviso({
  tom,
  titulo,
  detalhe,
  acao,
}: {
  tom: "err" | "warn";
  titulo: ReactNode;
  detalhe?: ReactNode;
  acao?: { rotulo: string; onClick?: () => void; href?: string };
}) {
  const t = TOM[tom];
  const Icone = tom === "warn" ? AlertTriangle : CircleAlert;
  const classeAcao =
    "w-full shrink-0 rounded-md border bg-surface px-2.5 py-1 text-center text-[12px] font-medium text-ink hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 sm:ml-auto sm:w-auto";
  return (
    <div
      className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5"
      style={{ borderColor: t.borda, background: t.fundo }}
    >
      <Icone aria-hidden className="mt-px h-4 w-4 shrink-0" style={{ color: t.cor }} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">{titulo}</div>
        {detalhe && <p className="mt-0.5 text-[12px] text-t2">{detalhe}</p>}
      </div>
      {acao &&
        (acao.href ? (
          <Link href={acao.href} className={classeAcao} style={{ borderColor: t.borda }}>
            {acao.rotulo}
          </Link>
        ) : (
          <button
            type="button"
            onClick={acao.onClick}
            className={classeAcao}
            style={{ borderColor: t.borda }}
          >
            {acao.rotulo}
          </button>
        ))}
    </div>
  );
}
