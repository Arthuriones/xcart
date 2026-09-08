"use client";

import { useEffect } from "react";

/**
 * O que aparece quando um componente do app quebra.
 *
 * O app rodou ate hoje sem nenhum error boundary, e isso transformava qualquer
 * erro de um pedaco da tela num "This page couldn't load" sem explicacao --
 * foi o que aconteceu quando o menu da conta lancou por falta de um
 * <Menu.Group>. Um erro pequeno derrubava tudo e nao dizia o que era.
 *
 * Aqui o resto da tela continua de pe, o erro fica visivel e ha um botao para
 * tentar de novo sem recarregar a pagina inteira.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] erro nao tratado:", error);
  }, [error]);

  return (
    <div
      className="rounded-lg border px-6 py-8"
      style={{ borderColor: "var(--err-border)", background: "var(--err-bg)" }}
    >
      <p className="text-[15px] font-semibold text-ink">Algo quebrou nesta tela</p>
      <p className="mt-1.5 max-w-[520px] text-[12.5px] text-t2">
        O resto do xcart continua funcionando. Nada do que você fez foi perdido — esta
        parte da página não conseguiu desenhar.
      </p>
      <p className="mt-2 font-mono text-[11px] text-t3">
        {error.message}
        {error.digest ? ` · ${error.digest}` : ""}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 h-[30px] rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
      >
        Tentar de novo
      </button>
    </div>
  );
}
