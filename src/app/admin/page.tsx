import { Suspense } from "react";
import { BlocoFaturamento, EsqueletoBlocoFaturamento } from "./bloco-faturamento";
import { ErroAdmin } from "./estados-admin";
import { lerVisao } from "./ler-api";
import { Visao } from "./visao";
import { CabecalhoVisao, EsqueletoVisao } from "./visao-partes";

export const dynamic = "force-dynamic";
// O bloco de faturamento pergunta a cada loja de checkout na Shopify (a rota
// de API tem o mesmo teto).
export const maxDuration = 120;

/**
 * /admin: receita (assinatura e credito), custo de IA, margem, base, o
 * faturamento dos clientes e as listas recentes. Os numeros do mes vem de
 * GET /api/admin/overview; o faturamento dos clientes pergunta a cada loja na
 * Shopify e chega depois, no proprio Suspense, sem segurar o resto.
 */
export default function AdminVisaoPage() {
  return (
    <>
      <CabecalhoVisao />
      <Suspense fallback={<EsqueletoVisao />}>
        <Conteudo />
      </Suspense>
    </>
  );
}

async function Conteudo() {
  const r = await lerVisao();
  if (!r.ok) {
    return <ErroAdmin titulo="Não deu para carregar a visão geral" detalhe={r.detalhe} />;
  }
  return (
    <Visao
      d={r.dados}
      lidoEm={r.lidoEm}
      faturamento={
        <Suspense fallback={<EsqueletoBlocoFaturamento />}>
          <BlocoFaturamento />
        </Suspense>
      }
    />
  );
}
