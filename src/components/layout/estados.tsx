"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { APP_HOME } from "@/lib/app-home";
import { abrirBusca } from "./paleta-comandos";

// ============================================================================
// Estados da casca: carregando, erro e pagina nao encontrada. Usados por
// loading.tsx, error.tsx e not-found.tsx do (dashboard); cada tela pode trocar
// o esqueleto pelo seu, com a geometria do proprio conteudo.
// ============================================================================

const BOTAO_SOLIDO =
  "inline-flex h-ctl-md min-w-35 items-center justify-center rounded-control bg-solid px-4 text-dense font-medium text-on-solid hover:bg-solid-hover hover:text-on-solid disabled:cursor-wait";
const BOTAO_LINHA =
  "inline-flex h-ctl-md items-center rounded-control border border-border-strong bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:text-ink";

/** Faixa cinza com brilho que corre; parada com movimento reduzido. */
function Barra({ className }: { className: string }) {
  return (
    <span
      className={
        "block rounded-control bg-linear-to-r from-skeleton via-skeleton-hi to-skeleton bg-size-[200%_100%] motion-safe:animate-[xc-shimmer_1.6s_ease-in-out_infinite] " +
        className
      }
    />
  );
}

/**
 * Esqueleto generico: titulo, quatro numeros e um bloco grande. So aparece
 * depois de 300 ms -- carregamento rapido nao pisca.
 */
export function EsqueletoTela() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando a tela"
      className="flex flex-col gap-6 motion-safe:animate-[xc-in_140ms_ease-out_300ms_both]"
    >
      <div className="hidden flex-col gap-2 md:flex">
        <Barra className="h-5.5 w-40" />
        <Barra className="h-3.5 w-[min(420px,80%)]" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-30 flex-col gap-3 rounded-card border border-border bg-surface p-4"
          >
            <Barra className="h-3 w-1/2" />
            <Barra className="h-6.5 w-3/4" />
            <Barra className="h-3 w-2/5" />
          </div>
        ))}
      </div>
      <div className="h-80 rounded-card border border-border bg-surface p-4">
        <Barra className="h-full w-full" />
      </div>
    </div>
  );
}

/** Erro de uma tela: mensagem humana, tentar de novo e o detalhe recolhido. */
export function TelaComErro({
  onTentar,
  referencia,
  detalhe,
}: {
  onTentar: () => void;
  /** error.digest: casa com o log do servidor. */
  referencia?: string;
  detalhe?: string;
}) {
  const [tentando, startTransition] = useTransition();
  const [quando] = useState(() =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(Date.now())
  );

  return (
    <div
      role="alert"
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center"
    >
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-full border border-err-border bg-err-bg text-err"
      >
        <TriangleAlert className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="text-page font-semibold text-ink">Esta tela não abriu</h1>
      <p className="max-w-115 text-body text-t1">
        O resto do xcart continua funcionando e nenhum dado foi perdido. Tente de novo; se
        repetir, volte para o Lucro.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => startTransition(onTentar)}
          disabled={tentando}
          aria-busy={tentando}
          className={BOTAO_SOLIDO}
        >
          {tentando ? "Tentando…" : "Tentar de novo"}
        </button>
        <Link href={APP_HOME} className={BOTAO_LINHA}>
          Ir para o Lucro
        </Link>
      </div>
      <details className="mt-2 text-label text-t2">
        <summary className="cursor-pointer">Detalhes para o suporte</summary>
        <p suppressHydrationWarning className="mt-1.5 font-mono">
          {referencia ? `ref. ${referencia} · ` : ""}
          {quando}
        </p>
        {detalhe && <p className="mt-1 max-w-115 break-words font-mono">{detalhe}</p>}
      </details>
    </div>
  );
}

/** 404 dentro da casca: o menu continua ali, e a busca tambem. */
export function TelaNaoEncontrada() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span className="font-mono text-label text-t2">Erro 404</span>
      <h1 className="text-page font-semibold text-ink">Página não encontrada</h1>
      <p className="max-w-115 text-body text-t1">
        O endereço pode ter mudado ou não existe mais. Nada da sua conta foi afetado.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href={APP_HOME} className={BOTAO_SOLIDO}>
          Ir para o Lucro
        </Link>
        <button
          type="button"
          onClick={abrirBusca}
          className="inline-flex h-ctl-md items-center gap-1.5 rounded-control px-3 text-dense text-t1 hover:text-ink"
        >
          ou busque com
          <kbd className="rounded-control border border-border px-1.5 font-mono text-label">Ctrl K</kbd>
        </button>
      </div>
    </div>
  );
}
