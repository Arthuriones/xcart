import { Suspense } from "react";
import { lerAssinatura } from "@/lib/leitura/assinatura";
import { CabecalhoAssinatura } from "./cabecalho";
import { EsqueletoAssinatura } from "./esqueleto";
import { TelaAssinatura } from "./tela-assinatura";

export const dynamic = "force-dynamic";

/**
 * /billing: o plano, o saldo de creditos, a recarga por Pix e o historico.
 *
 * O cabecalho sai na hora; o resto vem de uma leitura so (perfil, uso do mes
 * e compras) no Suspense. Se o perfil nao vem, a tela diz que a leitura falhou
 * -- a antiga mostrava "Free" e 0 creditos. Os fluxos de pagamento (cartao,
 * Pix, cancelar) chamam as mesmas rotas, com os mesmos corpos.
 */
async function Conteudo({ querComprar }: { querComprar: boolean }) {
  const d = await lerAssinatura();
  if (!d.perfil) console.error("[billing] perfil não veio", d.erros.perfil);
  return <TelaAssinatura d={d} querComprar={querComprar} />;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  // ?comprar=1: veio de um "Comprar fotos" (falta de saldo numa tela de gasto).
  const querComprar = (await searchParams).comprar === "1";
  return (
    <>
      <CabecalhoAssinatura />
      <Suspense fallback={<EsqueletoAssinatura />}>
        <Conteudo querComprar={querComprar} />
      </Suspense>
    </>
  );
}
