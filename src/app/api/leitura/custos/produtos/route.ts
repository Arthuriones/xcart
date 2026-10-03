import { NextResponse, type NextRequest } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { NaoAutorizado, credenciaisDe, exigirLojaDoUsuario } from "@/lib/stores/authorize";
import { ehUuid } from "@/lib/financeiro/tipos";
import { buscaPorSku, produtosDosSkus, skusDoPedido, type NoVariante } from "@/lib/leitura/sku-shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/custos/produtos?loja=<uuid>&sku=A&sku=B -- nome, variante e
 * miniatura de cada SKU, lidos da Shopify da loja (funcao #34). So leitura:
 * nada e gravado.
 *
 * A loja sai da SESSAO (exigirLojaDoUsuario): loja alheia responde 404 e a
 * credencial dela nunca e usada. No maximo 25 SKUs por pergunta; a tela pede
 * so a pagina que esta mostrando.
 *
 * Resposta: { produtos: { [sku]: { nome, variante, imagem } } }. SKU que a
 * Shopify nao achou fica de fora.
 */
const CONSULTA = `
  query produtosPorSku($busca: String!, $n: Int!) {
    productVariants(first: $n, query: $busca) {
      nodes {
        sku
        title
        image { url(transform: { maxWidth: 96, maxHeight: 96 }) }
        product {
          title
          featuredImage { url(transform: { maxWidth: 96, maxHeight: 96 }) }
        }
      }
    }
  }
`;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lojaId = params.get("loja");
  if (!ehUuid(lojaId)) {
    return NextResponse.json({ erro: "Loja inválida." }, { status: 400 });
  }
  const skus = skusDoPedido(params.getAll("sku"));

  let loja: Awaited<ReturnType<typeof exigirLojaDoUsuario>>;
  try {
    loja = await exigirLojaDoUsuario(lojaId.toLowerCase());
  } catch (e) {
    if (e instanceof NaoAutorizado) {
      return NextResponse.json(
        { erro: e.status === 401 ? "Entre na sua conta para ver os produtos." : "Loja não encontrada." },
        { status: e.status }
      );
    }
    console.error("[leitura/custos/produtos] loja", e);
    return NextResponse.json({ erro: "Não deu para ler a loja agora." }, { status: 500 });
  }

  if (skus.length === 0) return NextResponse.json({ produtos: {} });

  try {
    // A busca da Shopify acha por pedaco do SKU: pede folga e filtra exato aqui.
    const dados = await shopifyGraphQL(credenciaisDe(loja), CONSULTA, {
      busca: buscaPorSku(skus),
      n: Math.min(250, skus.length * 4),
    });
    const nos = (dados?.productVariants?.nodes ?? []) as NoVariante[];
    return NextResponse.json(
      { produtos: produtosDosSkus(nos, skus) },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (e) {
    console.error("[leitura/custos/produtos] shopify", e);
    return NextResponse.json({ erro: "A Shopify não respondeu agora." }, { status: 502 });
  }
}
