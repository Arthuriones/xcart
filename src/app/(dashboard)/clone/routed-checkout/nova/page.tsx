import Link from "next/link";
import { getRouteGraph } from "@/lib/checkout-routes/graph";
import { getPublicAppUrl } from "@/lib/public-url";
import { ConectarLojaProvider } from "@/app/(dashboard)/stores/conectar-loja";
import { ErroConsole } from "../estados";
import { Assistente } from "./assistente";

export const dynamic = "force-dynamic";

/**
 * Nova rota: o assistente "Conectar vitrine à loja de checkout" em pagina
 * propria. Antes era um modal estreito com rolagem de 60vh e o pedido
 * "mantenha esta janela aberta"; aqui a pagina inteira e dele, e sair no meio
 * do processo pede confirmacao.
 */
export default async function NovaRotaPage() {
  let lojas: { id: string; nome: string; dominio: string }[];
  try {
    const grafo = await getRouteGraph();
    lojas = grafo.stores.map((s) => ({ id: s.id, nome: s.name || s.shopDomain, dominio: s.shopDomain }));
  } catch (erro) {
    console.error("[rotas] nova rota: falha ao ler lojas", erro);
    return <ErroConsole />;
  }

  return (
    <ConectarLojaProvider>
      <nav aria-label="Caminho" className="mb-3 flex min-w-0 items-center gap-1.5 text-dense">
        <Link
          href="/clone/routed-checkout"
          className="rounded-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Rotas
        </Link>
        <span aria-hidden className="text-t3">
          /
        </span>
        <span aria-current="page" className="truncate text-t1">
          Nova rota
        </span>
      </nav>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-page font-semibold text-ink">Conectar vitrine à loja de checkout</h1>
        <p className="max-w-[62ch] text-body text-t2">
          A vitrine recebe o anúncio; a loja de checkout cobra. O xcart monta ou liga os produtos das duas pelo
          SKU e ativa a rota.
        </p>
      </div>
      <Assistente lojas={lojas} origem={getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "")} />
    </ConectarLojaProvider>
  );
}
