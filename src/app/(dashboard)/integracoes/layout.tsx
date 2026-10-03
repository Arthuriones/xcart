import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { lerResumoIntegracoes } from "@/lib/leitura/integracoes";
import { NavPlataformas } from "./nav-plataformas";
import { estadosDaNav } from "./regras";

// ============================================================================
// Integracoes: cada plataforma num lugar so. Meta e Google juntam o que le o
// gasto (antes em Contas de anuncio) e o que envia as compras (o destino do
// rastreamento); Shopify mostra as lojas; Notificacoes, o Telegram; Avancado,
// o Claude (antes em /claude).
//
// O titulo e o menu ficam aqui e nao piscam ao trocar de plataforma; so o
// conteudo da direita carrega (loading.tsx de cada uma).
// ============================================================================

async function NavComEstados() {
  const resumo = await lerResumoIntegracoes().catch(() => null);
  return <NavPlataformas estados={resumo ? estadosDaNav(resumo) : null} />;
}

export default function IntegracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Integrações"
        description="Cada plataforma num lugar só: o que lê quanto você gastou e o que envia as compras."
      />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <Suspense fallback={<NavPlataformas estados={null} />}>
          <NavComEstados />
        </Suspense>
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    </>
  );
}
