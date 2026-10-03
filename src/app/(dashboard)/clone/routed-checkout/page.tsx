import { Suspense } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getPublicAppUrl } from "@/lib/public-url";
import { ConectarLojaProvider } from "@/app/(dashboard)/stores/conectar-loja";
import { Console } from "./console";
import { EsqueletoConsole } from "./estados";
import { abaDe } from "./logica";

export const dynamic = "force-dynamic";

/**
 * Rotas: o console do roteamento vitrine -> loja de checkout. A rota aberta e
 * a aba ficam na URL (?rota=&aba=), para mandar o link e para o servidor
 * buscar so o que a aba usa. Rota que nao existe (link velho, rota apagada)
 * cai no 404 da casca em vez de tela em branco.
 *
 * Os enderecos antigos (/active-routes, /create-route, /map, /neutralize,
 * /script, /create-destination) continuam redirecionando para ca.
 */
export default async function RotasPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

  return (
    <ConectarLojaProvider>
      <PageHeader
        title="Rotas"
        description="Leve o carrinho da vitrine para a loja de checkout que cobra, casando os produtos pelo SKU."
      >
        <Link href="/clone/routed-checkout/nova" className={buttonVariants({ variant: "primary" })}>
          <PlusIcon aria-hidden />
          Nova rota
        </Link>
      </PageHeader>
      <Suspense fallback={<EsqueletoConsole />}>
        <Console
          rotaParam={texto(sp.rota)}
          aba={abaDe(texto(sp.aba))}
          conferir={texto(sp.conferir) === "1"}
          origem={getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "")}
        />
      </Suspense>
    </ConectarLojaProvider>
  );
}
