"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_HOME } from "@/lib/app-home";
import { BotaoConectar } from "@/app/(dashboard)/stores/conectar-loja";

/** O console carregando: lista a esquerda, detalhe com abas a direita. */
export function EsqueletoConsole() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando rotas"
      className="grid animate-xc-in gap-4 [animation-delay:300ms] lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-64 max-w-full rounded-control" />
        <div className="rounded-card border border-border bg-surface">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-15 items-center gap-3 border-b border-border-subtle px-3 last:border-b-0">
              <Skeleton className="size-2 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </div>
      <div className="hidden flex-col gap-4 rounded-card border border-border bg-surface p-4 lg:flex">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
        <div className="flex gap-4 border-b border-border pb-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-card" />
      </div>
    </div>
  );
}

/** A leitura das rotas falhou: nunca vira "Nenhuma rota". */
export function ErroConsole() {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para carregar suas rotas"
      descricao="As rotas continuam funcionando na vitrine: foi a leitura que falhou. Tente de novo em instantes."
      acao={
        <Button pending={tentando} onClick={() => startTransition(() => router.refresh())}>
          Tentar de novo
        </Button>
      }
      className="py-12"
    />
  );
}

/**
 * Conta sem rota. O roteamento e opcional: quem anuncia direto na loja que
 * cobra nao precisa de rota nenhuma, e a tela diz isso antes de vender a ideia.
 */
export function SemRotas({ lojas }: { lojas: number }) {
  const poucas = lojas < 2;
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        titulo="Nenhuma rota ainda"
        descricao={
          poucas
            ? "Uma rota liga duas lojas Shopify. Conecte a vitrine e a loja de checkout primeiro."
            : "A rota leva o carrinho da vitrine para a loja de checkout, casando os produtos pelo SKU."
        }
        acao={
          poucas ? (
            <BotaoConectar>Conectar loja</BotaoConectar>
          ) : (
            <Link href="/clone/routed-checkout/nova" className={buttonVariants({ variant: "primary" })}>
              Criar a primeira rota
            </Link>
          )
        }
        className="py-12"
      />
      <p className="mx-auto max-w-prose text-center text-dense text-t2 text-pretty">
        Rota é opcional. Se você anuncia direto na loja que cobra, não precisa dela: o lucro, o
        rastreamento e os alertas funcionam igual.{" "}
        <Link
          href={APP_HOME}
          className="rounded-sm font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ir para o Lucro
        </Link>
      </p>
    </div>
  );
}
