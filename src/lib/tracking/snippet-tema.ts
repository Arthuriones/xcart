import "server-only";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { getPublicAppUrl } from "@/lib/public-url";

// ============================================================================
// A tag do xcart dentro do theme.liquid.
//
// Mora aqui, e nao no script, porque agora sao dois chamadores: o script de
// operacao e o botao da tela. Duplicar a montagem da tag em dois lugares
// significaria, um dia, uma tag com `data-xcart-store` e outra sem -- e ai o
// coletor volta a adivinhar entre contas que cadastraram o mesmo dominio.
// ============================================================================

/** Marca propria, para achar e trocar sem depender do conteudo. */
const MARCA = "xcart-click";

/** `g` fora de proposito: com flag global o `.test()` guarda lastIndex entre
 *  chamadas e alterna resultado. Quem precisa de global cria a sua. */
const RE_TAG = /<script\b[^>]*data-xcart-click[^>]*>\s*<\/script>\s*/;

function reGlobal() {
  return new RegExp(RE_TAG.source, "g");
}

export interface CredsLoja {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string | null;
}

export interface EstadoDoSnippet {
  temaId: string;
  temaNome: string;
  conteudo: string;
  instalado: boolean;
  comStoreId: boolean;
  comRemarketing: boolean;
}

/**
 * Le o theme.liquid do tema PUBLICADO.
 *
 * Sempre o de role MAIN: instalar num tema de rascunho e o jeito mais facil de
 * passar uma tarde jurando que o rastreamento esta instalado enquanto o
 * comprador ve outro tema.
 */
export async function lerEstado(creds: CredsLoja): Promise<EstadoDoSnippet> {
  const temas = (await shopifyGraphQL(
    creds,
    `{ themes(first: 20) { nodes { id name role } } }`
  )) as { themes?: { nodes?: { id?: string; name?: string; role?: string }[] } };

  const principal = (temas?.themes?.nodes || []).find((t) => t.role === "MAIN");
  if (!principal?.id) throw new Error("tema principal nao encontrado");

  const arquivo = (await shopifyGraphQL(
    creds,
    `query($id: ID!, $n: [String!]) {
       theme(id: $id) {
         files(filenames: $n, first: 5) {
           nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
         }
       }
     }`,
    { id: principal.id, n: ["layout/theme.liquid"] }
  )) as { theme?: { files?: { nodes?: { body?: { content?: string } }[] } } };

  const conteudo = arquivo?.theme?.files?.nodes?.[0]?.body?.content || "";
  if (!conteudo) throw new Error("theme.liquid vazio ou inacessivel");

  return {
    temaId: principal.id,
    temaNome: principal.name || "(sem nome)",
    conteudo,
    instalado: RE_TAG.test(conteudo),
    comStoreId: conteudo.includes("data-xcart-store"),
    comRemarketing: conteudo.includes("data-xcart-remarketing"),
  };
}

/**
 * Monta a tag.
 *
 * `defer` e nao `async`: o snippet precisa de `window.Shopify.routes.root`, que
 * o tema define no head. Com async ele pode correr antes e montar a URL do
 * carrinho errada em loja com Markets por sub-caminho (/ja, /en).
 *
 * `data-xcart-store` carrega a LINHA de loja, nao so o dominio -- o mesmo
 * dominio pode estar cadastrado por mais de uma conta, e sem o id o coletor
 * teria que adivinhar entre elas. Adivinhar errado manda conversao para a conta
 * de anuncios de outra pessoa.
 *
 * `data-xcart-remarketing` liga a tag do Google NO NAVEGADOR, que e a unica
 * forma de montar publico -- o ping de conversao sai do servidor e nao coloca
 * ninguem em lista. Ela NAO dispara conversao; se passasse a disparar, a venda
 * contaria duas vezes e o Google nao deduplica entre os dois caminhos.
 *
 * O remarketing aceita VARIAS contas, separadas por virgula, porque cada conta
 * de anuncio monta a sua propria lista: publico criado na conta A nao serve na
 * conta B. Com cinco contas anunciando a mesma loja -- o caso do Arthur --
 * mandar so a primeira deixaria quatro sem publico nenhum.
 */
export function montarTag(
  storeId: string,
  remarketing?: string | string[] | null,
  idTemplate?: string | null
): string {
  // Vai para dentro de um atributo HTML. Os ids ja sao validados na API, mas a
  // mesma funcao e chamada por script de operacao -- filtrar aqui e o que
  // garante que nenhum valor fecha a aspa.
  const contas = (Array.isArray(remarketing) ? remarketing : [remarketing])
    .map((c) => (c || "").trim().replace(/[^A-Za-z0-9_-]/g, ""))
    .filter(Boolean);

  // `ecomm_prodid` e montado AQUI, no navegador, e tem que casar com o id do
  // Merchant Center igual aos eventos do servidor -- entao o formato viaja
  // dentro da tag. Mesma filtragem: o valor vai para dentro de um atributo.
  const template = (idTemplate || "").trim().replace(/[^A-Za-z0-9_.{}-]/g, "");

  return (
    `<script src="${getPublicAppUrl()}/${MARCA}.js" data-xcart-click` +
    ` data-xcart-store="${storeId}"` +
    (contas.length ? ` data-xcart-remarketing="${contas.join(",")}"` : "") +
    (template ? ` data-xcart-id-template="${template}"` : "") +
    ` defer></script>`
  );
}

export interface ResultadoAplicar {
  mudou: boolean;
  instalado: boolean;
  comRemarketing: boolean;
  temaNome: string;
  /** O theme.liquid resultante, para o modo de ensaio do script. */
  conteudo: string;
}

/** Aplica (ou simula) a tag no tema publicado. */
export async function aplicarSnippet(
  creds: CredsLoja,
  opcoes: {
    storeId: string;
    /** AW-XXXXXXXXX para ligar o remarketing; varios ligam um por conta. */
    remarketing?: string | string[] | null;
    /** Formato do id de produto do remarketing. Vazio = {variant_id}. */
    idTemplate?: string | null;
    /** Tira a tag em vez de por. */
    remover?: boolean;
    /** Calcula e nao grava. */
    ensaio?: boolean;
  }
): Promise<ResultadoAplicar> {
  const estado = await lerEstado(creds);

  const novo = opcoes.remover
    ? estado.conteudo.replace(reGlobal(), "")
    : estado.instalado
      ? estado.conteudo.replace(
          reGlobal(),
          montarTag(opcoes.storeId, opcoes.remarketing, opcoes.idTemplate)
        )
      : estado.conteudo.replace(
          "</head>",
          `  ${montarTag(opcoes.storeId, opcoes.remarketing, opcoes.idTemplate)}\n</head>`
        );

  const mudou = novo !== estado.conteudo;
  const resultado: ResultadoAplicar = {
    mudou,
    instalado: !opcoes.remover && mudou ? true : estado.instalado && !opcoes.remover,
    comRemarketing:
      !opcoes.remover &&
      (Array.isArray(opcoes.remarketing)
        ? opcoes.remarketing.length > 0
        : Boolean(opcoes.remarketing)),
    temaNome: estado.temaNome,
    conteudo: novo,
  };

  if (!mudou || opcoes.ensaio) return resultado;

  const r = (await shopifyGraphQL(
    creds,
    `mutation($id: ID!, $f: [OnlineStoreThemeFilesUpsertFileInput!]!) {
       themeFilesUpsert(themeId: $id, files: $f) {
         userErrors { filename message }
       }
     }`,
    {
      id: estado.temaId,
      f: [{ filename: "layout/theme.liquid", body: { type: "TEXT", value: novo } }],
    }
  )) as { themeFilesUpsert?: { userErrors?: { message?: string }[] } };

  const erros = r?.themeFilesUpsert?.userErrors || [];
  if (erros.length) {
    throw new Error(erros.map((e) => e.message).join("; ") || "falha ao gravar o tema");
  }

  return resultado;
}
