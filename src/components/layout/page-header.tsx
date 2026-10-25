import type { ReactNode } from "react";
import clsx from "clsx";

interface PageHeaderProps {
  /** O titulo da tela: o mesmo nome do menu. */
  title: string;
  description?: string;
  /** Acao primaria da tela (um botao, no maximo dois). */
  children?: ReactNode;
}

/**
 * Cabecalho de pagina: a descricao e as acoes da tela.
 *
 * No app o titulo e o h1 da barra do topo (top-nav.tsx), no desktop e no
 * celular -- aqui ele nao aparece, para a tela nao ter dois h1. Sem descricao
 * e sem acao, nada aparece.
 *
 * A casca do admin tambem usa este cabecalho e nao tem barra no desktop: la o
 * h1 continua (do md para cima; no celular o topo do admin mostra o titulo).
 * Quem separa os dois casos e o `data-casca="app"` do painel do app
 * (painel.tsx), por CSS: este componente e de servidor e nao sabe em que casca
 * esta.
 */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  const soTitulo = !description && !children;
  return (
    <div
      className={clsx(
        "mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        soTitulo && "in-data-[casca=app]:hidden"
      )}
    >
      {/* Sem descricao, no app esta coluna fica vazia. No celular ela some,
          para o gap nao sobrar acima das acoes; do md para cima fica, e e ela
          que empurra as acoes para a direita. */}
      <div
        className={clsx("flex min-w-0 flex-col gap-1", !description && "max-md:in-data-[casca=app]:hidden")}
      >
        <h1 className="text-page font-semibold text-ink max-md:hidden in-data-[casca=app]:hidden">{title}</h1>
        {description && <p className="max-w-[62ch] text-body text-t2">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
