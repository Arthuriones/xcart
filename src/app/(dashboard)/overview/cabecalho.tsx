import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CONSOLE } from "./apresentar";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoVisao() {
  return (
    <PageHeader
      title="Visão da rota"
      description="O caminho do comprador da vitrine até a loja que cobra: quem recebe, a divisão do rodízio e o que precisa de atenção."
    >
      <Link href={CONSOLE} className={buttonVariants({ variant: "secondary" })}>
        Abrir o console de rotas
      </Link>
    </PageHeader>
  );
}
