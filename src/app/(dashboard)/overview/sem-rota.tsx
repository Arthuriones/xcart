import Link from "next/link";
import { Route } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { APP_HOME } from "@/lib/app-home";
import { CONSOLE } from "./apresentar";

/**
 * Conta sem rota. Nao e "nada acontecendo": quem anuncia direto na loja de
 * checkout vende normalmente, e o lucro dele esta no Lucro. O roteamento e
 * opcional e o convite fica em segundo plano.
 */
export function SemRota({ tela }: { tela: "visao" | "vendas" }) {
  return (
    <EmptyState
      icone={<Route />}
      titulo="Nenhuma rota configurada, e o roteamento é opcional"
      descricao={
        tela === "vendas"
          ? "Quem vende direto na loja acompanha as vendas de cada loja no Lucro, com gasto e margem."
          : "Quem vende direto na loja acompanha as vendas e o lucro no Lucro."
      }
      acao={
        <>
          <Link href={APP_HOME} className={buttonVariants({})}>
            Ir para o Lucro
          </Link>
          <Link href={CONSOLE} className={buttonVariants({ variant: "ghost" })}>
            Como funciona o roteamento
          </Link>
        </>
      }
      className="min-h-80"
    />
  );
}

/** Tem rota, mas nenhuma loja de checkout foi ligada a ela ainda. */
export function RotaSemCheckout() {
  return (
    <EmptyState
      icone={<Route />}
      titulo="Suas rotas ainda não têm loja de checkout"
      descricao="Ligue uma loja de checkout à rota para os pedidos aparecerem aqui."
      acao={
        <Link href={CONSOLE} className={buttonVariants({})}>
          Ligar uma loja de checkout
        </Link>
      }
      className="min-h-80"
    />
  );
}
