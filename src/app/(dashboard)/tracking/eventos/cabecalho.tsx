import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";

/**
 * O cabecalho da tela, igual em todos os estados (carregando, erro, vazio e
 * com dados). A acao (Exportar CSV) so entra quando ha linhas para exportar.
 */
export function CabecalhoEventos({ children }: { children?: ReactNode }) {
  return (
    <PageHeader
      title="Eventos ao vivo"
      description="Cada evento de rastreamento enviado ao Meta e ao Google, quase em tempo real. Clique numa linha para ver o detalhe."
    >
      {children}
    </PageHeader>
  );
}

/** Rodape da tela: por que um evento pode nao aparecer aqui. */
export function NotaEventos() {
  return (
    <p className="mt-3 text-label text-t2">
      Só entram eventos aceitos por algum destino: o Meta aceita todos; o Google, só os que têm
      rótulo.
    </p>
  );
}
