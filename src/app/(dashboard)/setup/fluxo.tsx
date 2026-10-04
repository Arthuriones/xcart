import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { ResumoFluxo } from "@/lib/leitura/guia-passos";

// ============================================================================
// O desenho ao lado dos passos, so no caminho com vitrine: por onde passa o
// comprador, com os nomes reais das lojas. Sem numero -- so quem e quem. A
// caixa escura e o xcart: e nele que algo acontece, nao e so mais um cartao.
// No anuncio direto nao ha desenho: o caminho e obvio (anuncio -> loja).
// ============================================================================

function Caixa({ titulo, detalhe, ponto }: { titulo: ReactNode; detalhe: string; ponto?: "vitrine" | "checkout" }) {
  return (
    <div className="block rounded-card border border-border bg-surface px-3.5 py-3">
      <span className="flex min-w-0 items-center gap-2">
        {ponto ? (
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", ponto === "vitrine" ? "bg-vitrine" : "bg-checkout")}
          />
        ) : null}
        <span className="min-w-0 truncate text-dense font-medium text-ink">{titulo}</span>
      </span>
      <span className={cn("mt-0.5 block text-label text-t2", ponto && "pl-3.5")}>{detalhe}</span>
    </div>
  );
}

function CaixaXcart({ detalhe }: { detalhe: string }) {
  return (
    <div className="rounded-card bg-solid px-3.5 py-3 text-on-solid">
      <span className="block text-dense font-semibold">xcart</span>
      <span className="mt-0.5 block text-label">{detalhe}</span>
    </div>
  );
}

function Seta() {
  return (
    <span aria-hidden className="flex justify-center text-t3">
      <ArrowDown className="size-4" strokeWidth={1.75} />
    </span>
  );
}

function Lista({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <aside aria-label={titulo} className="flex flex-col gap-2">
      <p className="text-label font-semibold text-t2">{titulo}</p>
      {children}
    </aside>
  );
}

/** Nomes ou o rotulo generico, quando a leitura falhou ou nao ha nenhum. */
function nomes(lista: string[] | null, generico: string): string {
  if (!lista || lista.length === 0) return generico;
  return lista.length <= 2 ? lista.join(" e ") : `${lista[0]} e mais ${lista.length - 1}`;
}

/** Com vitrine: a vitrine recebe, o xcart escolhe a loja de checkout pelo SKU. */
export function FluxoVitrine({ resumo }: { resumo: ResumoFluxo }) {
  const checkouts = resumo.checkouts ?? [];
  return (
    <Lista titulo="O que você está montando">
      <Caixa titulo="Anúncio" detalhe="Meta e Google levam o comprador" />
      <Seta />
      <Caixa
        titulo={nomes(resumo.vitrines, "Sua vitrine")}
        detalhe={resumo.vitrines?.length ? "recebe o tráfego e monta o carrinho" : "escolhida ao criar a rota"}
        ponto="vitrine"
      />
      <Seta />
      <CaixaXcart
        detalhe={
          resumo.rotaNoAr
            ? "leva cada carrinho para uma loja de checkout pelo SKU"
            : "vai levar o carrinho para a loja de checkout quando a rota for ligada"
        }
      />
      <Seta />
      {checkouts.length > 0 ? (
        checkouts.map((nome) => <Caixa key={nome} titulo={nome} detalhe="cobra o pedido" ponto="checkout" />)
      ) : (
        <div className="rounded-card border border-dashed border-border-strong px-3.5 py-3">
          <span className="text-label text-t2">
            {resumo.checkouts ? "Nenhuma loja de checkout ainda" : "Não deu para ler as lojas de checkout"}
          </span>
        </div>
      )}
    </Lista>
  );
}
