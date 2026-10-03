import { Loader2Icon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function Kpis() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-30 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-6.5 w-3/4" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

function Bloco({ altura }: { altura: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-card border border-border bg-surface p-4 ${altura}`}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  );
}

/** Esqueleto de cada aba, com a geometria do conteudo dela. */
export function EsqueletoAba({ aba }: { aba: string }) {
  if (aba === "rastreamento") {
    // A espera aqui e a Shopify (pedidos, webhook e tema): a frase diz o porque.
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-dense text-t2">
          <Loader2Icon aria-hidden className="size-3.5 animate-xc-spin" />
          Conferindo pedidos, webhook e tema na Shopify…
        </p>
        <Bloco altura="h-36" />
        <Bloco altura="h-52" />
      </div>
    );
  }
  if (aba === "configuracao") {
    return (
      <div aria-busy="true" aria-label="Carregando a configuração" className="flex max-w-3xl flex-col gap-4">
        <Bloco altura="h-64" />
        <Bloco altura="h-56" />
      </div>
    );
  }
  return (
    <div aria-busy="true" aria-label="Carregando os números da loja" className="flex flex-col gap-4">
      <Kpis />
      <div className="grid gap-3 md:grid-cols-3">
        <Bloco altura="h-40" />
        <Bloco altura="h-40" />
        <Bloco altura="h-40" />
      </div>
    </div>
  );
}
