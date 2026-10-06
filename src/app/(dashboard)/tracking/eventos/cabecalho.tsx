import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Dica } from "@/components/ui/dica";

/**
 * O cabecalho da tela, igual em todos os estados (carregando, erro, vazio e
 * com dados). A acao (Exportar CSV) so entra quando ha linhas para exportar.
 */
export function CabecalhoEventos({ children }: { children?: ReactNode }) {
  return (
    <PageHeader
      title="Eventos ao vivo"
      description="Cada evento enviado ao Meta e ao TikTok, quase em tempo real. O Google vai pela tag no navegador e é contado no Google Ads."
    >
      {children}
    </PageHeader>
  );
}

/** Por que um evento pode nao aparecer aqui. Dica, nao rodape: so le quem procura. */
export function DicaEventos() {
  return (
    <Dica rotulo="Por que um evento pode não aparecer aqui" lado="top">
      Só entram eventos que o servidor envia ao Meta e ao TikTok. O Google não aparece aqui: a tag do Google
      dispara no navegador do comprador, e a conversão é contada no Google Ads.
    </Dica>
  );
}
