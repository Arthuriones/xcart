import type { ReactNode } from "react";

interface PageHeaderProps {
  /** O titulo da tela: o mesmo nome do menu. */
  title: string;
  description?: string;
  /** Acao primaria da tela (um botao, no maximo dois). */
  children?: ReactNode;
}

/**
 * Cabecalho de pagina: um titulo por tela.
 *
 * No celular o titulo ja esta no topo da casca (top-nav.tsx), entao aqui ele
 * so aparece do md para cima -- nunca duas vezes na mesma tela. A descricao e
 * a acao aparecem sempre.
 */
export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="hidden text-page font-semibold text-ink md:block">{title}</h1>
        {description && <p className="max-w-[62ch] text-body text-t2">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
