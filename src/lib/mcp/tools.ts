import { z } from "zod";
import { safeFetch } from "@/lib/net/safe-url";
import { dominioDeDestino } from "@/lib/net/url-guard";
import {
  shopifyGraphQL,
  getShopInfo,
  getProductsCount,
  getProductById,
} from "@/lib/shopify/client";
import { getStore, listStores, credsOf, type McpIdentity } from "@/lib/mcp/auth";
import {
  checkContent,
  guardError,
  assertReadOnlyQuery,
  assertProfundidadeOk,
  MAX_QUERY_GRAPHQL,
} from "@/lib/mcp/guards";
import { MAX_HTML, sanitizarHtmlDaIa } from "@/lib/ai/sanitize-html";


// Shape minimo do produto devolvido pela Admin GraphQL — so os campos lidos
// aqui. Evita `any` sem exigir o tipo gerado inteiro da Shopify.
interface NoProduto {
  id?: string;
  handle?: string;
  title?: string;
  status?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  variants?: { nodes?: { price?: string; sku?: string | null }[] };
  images?: { nodes?: { url?: string }[] };
}

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodType<Record<string, unknown>>;
  handler: (args: Record<string, unknown>, id: McpIdentity) => Promise<unknown>;
}

const storeId = z.string().describe("id da loja, obtido em list_stores");

async function resolve(id: McpIdentity, sid: string) {
  const store = await getStore(id.userId, sid);
  if (!store) throw new Error(`Loja ${sid} nao encontrada nesta conta. Chame list_stores primeiro.`);
  return store;
}

export const TOOLS: Tool[] = [
  {
    name: "list_stores",
    description:
      "Lista as lojas Shopify conectadas a esta conta xcart. Chame primeiro: " +
      "todas as outras ferramentas precisam de um storeId daqui.",
    schema: z.object({}),
    handler: async (_a, id) => {
      const stores = await listStores(id.userId);
      if (!stores.length) {
        return { stores: [], aviso: "Nenhuma loja conectada. Conecte uma no painel do xcart antes." };
      }
      return {
        stores: stores.map((s) => ({
          storeId: s.id,
          nome: s.name,
          dominio: s.shop_domain,
          idioma: s.target_language,
        })),
      };
    },
  },

  {
    name: "store_overview",
    description:
      "Visao geral da loja: nome, moeda, dominio publico e quantos produtos existem por status. " +
      "Use antes de sugerir mudancas, para nao opinar sobre um catalogo que voce nao viu.",
    schema: z.object({ storeId }),
    handler: async (a, id) => {
      const store = await resolve(id, a.storeId as string);
      const creds = credsOf(store);
      const [shop, ativos, rascunhos] = await Promise.all([
        getShopInfo(creds),
        getProductsCount(creds, { status: "ACTIVE" }).catch(() => null),
        getProductsCount(creds, { status: "DRAFT" }).catch(() => null),
      ]);
      return { loja: shop, produtos: { ativos, rascunhos } };
    },
  },

  {
    name: "search_products",
    description:
      "Busca produtos da loja. 'query' aceita a sintaxe de busca da Shopify " +
      "(ex.: 'title:serum', 'vendor:medicube', 'status:draft').",
    schema: z.object({
      storeId,
      query: z.string().optional().describe("filtro no formato de busca da Shopify"),
      limit: z.number().int().min(1).max(250).optional(),
    }),
    handler: async (a, id) => {
      const store = await resolve(id, a.storeId as string);
      // Query propria em vez de getProducts(): aquela nao traz "vendor" — que
      // e a marca que vai para o Merchant Center — e traz descriptionHtml,
      // metafields e 12 imagens por produto, peso morto numa listagem.
      // get_product continua sendo o caminho para o detalhe completo.
      const r = await shopifyGraphQL(
        credsOf(store),
        `query($first: Int!, $query: String) {
           products(first: $first, query: $query) {
             pageInfo { hasNextPage endCursor }
             nodes {
               id handle title status vendor productType tags
               images(first: 1) { nodes { url } }
               variants(first: 1) { nodes { price sku } }
             }
           }
         }`,
        { first: Math.min(Math.max(1, (a.limit as number) ?? 50), 250), query: (a.query as string) || null }
      );
      // shopifyGraphQL devolve json.data, ja sem o envelope.
      const p = r?.products;
      const nodes = p?.nodes ?? [];
      return {
        total_retornado: nodes.length,
        tem_mais: p?.pageInfo?.hasNextPage ?? false,
        cursor: p?.pageInfo?.endCursor ?? null,
        produtos: nodes.map((n: NoProduto) => ({
          id: n.id,
          handle: n.handle,
          titulo: n.title,
          status: n.status,
          marca: n.vendor,
          tipo: n.productType,
          tags: n.tags,
          preco: n.variants?.nodes?.[0]?.price ?? null,
          sku: n.variants?.nodes?.[0]?.sku ?? null,
          imagem: n.images?.nodes?.[0]?.url ?? null,
        })),
      };
    },
  },

  {
    name: "get_product",
    description: "Detalhe completo de um produto: descricao, SEO, variantes, imagens e colecoes.",
    schema: z.object({ storeId, productId: z.string().describe("id numerico ou gid://") }),
    handler: async (a, id) => {
      const store = await resolve(id, a.storeId as string);
      return getProductById(credsOf(store), a.productId as string);
    },
  },

  {
    name: "update_product",
    description:
      "Atualiza campos de texto de um produto (titulo, descricao HTML, SEO, marca, tipo, tags, status). " +
      "NAO altera preco, variantes nem SKU — no xcart o SKU e a chave do checkout roteado e " +
      "mexer nele quebra a rota. Textos passam por checagem de alegacao nao comprovavel.",
    schema: z.object({
      storeId,
      productId: z.string(),
      // Todo campo tem teto. Sem isso o modelo (ou o conteudo que ele leu)
      // podia mandar megabytes num titulo -- custo de token na volta, payload
      // gigante para a Shopify, e descricao que nenhuma pagina renderiza.
      // Os numeros seguem os limites reais da Shopify.
      title: z.string().max(255).optional(),
      descriptionHtml: z.string().max(MAX_HTML).optional(),
      seoTitle: z.string().max(70).optional(),
      seoDescription: z.string().max(320).optional(),
      vendor: z.string().max(255).optional(),
      productType: z.string().max(255).optional(),
      tags: z.array(z.string().max(255)).max(250).optional(),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional(),
    }),
    handler: async (a, id) => {
      const hits = checkContent([
        a.title as string,
        a.descriptionHtml as string,
        a.seoTitle as string,
        a.seoDescription as string,
        // tag tambem e texto publico: aparece em filtro de colecao e vaza
        // para o feed do Merchant Center.
        ...((a.tags as string[]) ?? []),
      ]);
      if (hits.length) throw new Error(guardError(hits));

      const store = await resolve(id, a.storeId as string);

      // O HTML vem do MODELO e vai para uma pagina publica da loja. Passa por
      // allowlist como qualquer HTML de IA: <script>, on*, javascript: e
      // iframe nao chegam na vitrine. Ver src/lib/ai/sanitize-html.ts.
      let avisoHtml: string[] = [];
      if (a.descriptionHtml !== undefined) {
        const limpeza = sanitizarHtmlDaIa(a.descriptionHtml);
        avisoHtml = limpeza.removidos;
        a.descriptionHtml = limpeza.html;
      }

      // Monta o input so com o que foi informado. updateShopifyProduct() do
      // client exige title/descriptionHtml/tags sempre — usar ele aqui
      // apagaria os campos que o usuario nao mencionou.
      const gid = String(a.productId).startsWith("gid://")
        ? (a.productId as string)
        : `gid://shopify/Product/${a.productId}`;
      const input: Record<string, unknown> = { id: gid };
      for (const k of ["title", "descriptionHtml", "vendor", "productType", "status"] as const) {
        if (a[k] !== undefined) input[k] = a[k];
      }
      if (a.tags !== undefined) input.tags = a.tags;
      if (a.seoTitle !== undefined || a.seoDescription !== undefined) {
        const seo: Record<string, unknown> = {};
        if (a.seoTitle !== undefined) seo.title = a.seoTitle;
        if (a.seoDescription !== undefined) seo.description = a.seoDescription;
        input.seo = seo;
      }
      if (Object.keys(input).length === 1) {
        throw new Error("Informe ao menos um campo para alterar.");
      }

      const data = await shopifyGraphQL(
        credsOf(store),
        `mutation($input: ProductInput!) {
           productUpdate(input: $input) {
             product { id title handle status vendor }
             userErrors { field message }
           }
         }`,
        { input }
      );
      // shopifyGraphQL devolve json.data, ja sem o envelope. Ler data.data aqui
      // engolia userErrors: a Shopify podia recusar a escrita e a ferramenta
      // responderia "ok" com produto undefined.
      const erros = data?.productUpdate?.userErrors ?? [];
      if (erros.length) throw new Error(`Shopify recusou: ${JSON.stringify(erros)}`);
      const res = data?.productUpdate?.product;
      if (!res) throw new Error("A Shopify nao devolveu o produto atualizado.");
      return {
        ok: true,
        produto: res,
        ...(avisoHtml.length > 0
          ? {
              html_sanitizado:
                `Removi do HTML: ${avisoHtml.slice(0, 8).join(", ")}. ` +
                `Descricao de produto aceita so formatacao -- script, estilo, iframe, ` +
                `formulario e atributo de evento nao vao para a loja.`,
            }
          : {}),
        proximo_passo:
          "A Shopify serve a pagina por CDN. A alteracao leva ate ~1 minuto para aparecer. " +
          "Use verify_page para confirmar no HTML servido antes de dizer que terminou.",
      };
    },
  },

  {
    name: "verify_page",
    description:
      "Busca uma pagina publica da loja e reporta o que quebrou: erro de Liquid, " +
      "placeholder da Shopify (aquele desenho de mochila, que aparece em TODO campo de " +
      "imagem/produto/colecao deixado vazio) e um texto que voce queira confirmar. " +
      "Resposta de API dizendo 'ok' nao prova que renderizou — sempre confirme aqui.",
    schema: z.object({
      storeId,
      path: z.string().describe("caminho, ex.: /products/meu-produto"),
      expect: z.string().optional().describe("texto que deve aparecer na pagina"),
    }),
    handler: async (a, id) => {
      const store = await resolve(id, a.storeId as string);

      // O path vem do modelo. Sem travar, ele poderia mandar "//evil.com/x" ou
      // "https://evil.com" e transformar a ferramenta em buscador de URL
      // arbitraria rodando a partir do nosso servidor.
      const rawPath = String(a.path);
      if (/^[a-z][a-z0-9+.-]*:/i.test(rawPath) || rawPath.startsWith("//")) {
        throw new Error("path deve ser um caminho da propria loja, ex.: /products/meu-produto");
      }
      const caminho = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

      // Regex propria aqui era o mesmo erro do resto do app: ela nao enxerga
      // userinfo nem porta, entao "loja@evil.com" viraria destino. O guard
      // central usa o parser; linhas antigas de shop_domain podem ter valor
      // que nunca passou por validacao nenhuma.
      const dominio = dominioDeDestino(store.shop_domain);
      if (!dominio) {
        throw new Error("O dominio da loja e invalido. Reconecte a loja.");
      }
      const url = `https://${dominio}${caminho}`;
      // cache-buster: sem isso a CDN devolve a versao antiga e a verificacao mente
      const res = await safeFetch(`${url}${url.includes("?") ? "&" : "?"}_mcp=${Date.now()}`, {
        headers: { "User-Agent": "xcart-mcp/1.0" },
        cache: "no-store",
      });
      const html = await res.text();
      const conta = (re: RegExp) => (html.match(re) || []).length;
      const esperado = a.expect ? html.includes(String(a.expect)) : null;
      return {
        url,
        status: res.status,
        erros_liquid: conta(/Liquid error/g),
        placeholders: conta(/placeholder-svg|placeholder_svg/g),
        texto_esperado: a.expect ? { texto: a.expect, encontrado: esperado } : undefined,
        veredito:
          conta(/Liquid error/g) === 0 && conta(/placeholder-svg/g) === 0 && esperado !== false
            ? "pagina limpa"
            : "há problema — veja os contadores acima",
      };
    },
  },

  {
    name: "shopify_query",
    description:
      "Executa uma query GraphQL de LEITURA na Admin API da loja, para o que as outras " +
      "ferramentas nao cobrem. Mutation e recusada de proposito: escrita crua sem validacao " +
      "e a principal causa de tema e produto quebrados.",
    schema: z.object({
      storeId,
      query: z.string().max(MAX_QUERY_GRAPHQL),
      variables: z.record(z.string(), z.unknown()).optional(),
    }),
    handler: async (a, id) => {
      assertReadOnlyQuery(a.query as string);
      // Query de leitura ainda custa: aninhamento fundo faz a Shopify cobrar
      // muito ponto de rate limit e devolve payload enorme, que volta como
      // token para o modelo. Os dois sao custo do usuario.
      assertProfundidadeOk(a.query as string);
      const store = await resolve(id, a.storeId as string);
      return shopifyGraphQL(
        credsOf(store),
        a.query as string,
        a.variables as Record<string, unknown> | undefined
      );
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
