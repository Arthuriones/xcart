// ============================================================================
// Como o produto e identificado para a plataforma de anuncio.
//
// POR QUE ISTO E CONFIGURAVEL
//
// O id que mandamos no evento TEM que ser byte a byte o mesmo id que esta no
// catalogo da plataforma, senao ela nao liga a conversao ao produto -- e o
// sintoma e silencioso: o anuncio dinamico simplesmente nao serve aquele item,
// e o painel mostra "98% of id values didn't match your feed".
//
// E nao existe um formato certo. Medido: o feed que a Shopify manda para o
// Google Merchant Center usa `shopify_<PAIS>_<idDoProduto>_<idDaVariante>`,
// enquanto nos mandavamos o id da variante cru. Nunca casava. Catalogo do Meta
// montado por outro caminho usa outro formato ainda, e loja que exporta por
// planilha costuma usar o SKU.
//
// Por isso aqui e um TEMPLATE, nao uma lista fechada de tres opcoes: o lojista
// cola o formato que o catalogo dele ja usa.
//
// POR QUE MORA POR DESTINO
//
// Catalogo do Meta e feed do Google sao dois catalogos diferentes, e podem ter
// sido montados de formas diferentes na mesma loja. Uma configuracao por loja
// obrigaria a escolher qual das duas plataformas ficaria errada.
//
// Arquivo puro de proposito: o webhook, o coletor e o snippet do tema precisam
// concordar sobre o formato, e a regra duplicada em tres lugares ia divergir.
// ============================================================================

/** O que existe para montar um id. Campo ausente = aquele dado nao veio. */
export interface DadosDoProduto {
  variantId?: string | number | null;
  productId?: string | number | null;
  sku?: string | null;
}

/**
 * O formato de antes de isto existir.
 *
 * Continua sendo o padrao: destino sem template configurado tem que se
 * comportar exatamente como antes, senao a migracao mudaria o id de toda loja
 * que ja estava casando.
 */
export const TEMPLATE_PADRAO = "{variant_id}";

/** Os marcadores que o template entende. */
export const MARCADORES = ["variant_id", "product_id", "sku"] as const;
export type Marcador = (typeof MARCADORES)[number];

/** Atalhos da tela. O campo continua livre -- isto e so para nao digitar. */
export const TEMPLATES_SUGERIDOS: { template: string; rotulo: string; dica: string }[] =
  [
    {
      template: "{variant_id}",
      rotulo: "ID da variante",
      dica: "O padrão. Serve quando o catálogo foi montado por variante.",
    },
    {
      template: "{product_id}",
      rotulo: "ID do produto",
      dica: "Catálogo indexado por produto, sem separar variantes.",
    },
    {
      template: "{sku}",
      rotulo: "SKU",
      dica: "Comum em catálogo exportado por planilha.",
    },
    {
      template: "shopify_US_{product_id}_{variant_id}",
      rotulo: "Feed da Shopify (Google)",
      dica:
        "O formato que a Shopify usa no Merchant Center. Troque US pelo país do feed.",
    },
  ];

const RE_MARCADOR = /\{([a-z_]+)\}/g;

/**
 * O template e valido?
 *
 * Duas regras, e as duas protegem contra o mesmo estrago -- id errado chega na
 * plataforma sem erro nenhum e so aparece como campanha que nao serve:
 *
 *   - marcador desconhecido seria enviado literalmente, como "{variante}";
 *   - template SEM marcador nenhum manda o mesmo id para todo produto, e o
 *     catalogo inteiro vira um item so.
 */
export function validarTemplate(template: string): string | null {
  const texto = (template || "").trim();
  if (!texto) return "Template vazio.";
  if (texto.length > 120) return "Template longo demais.";

  const achados = [...texto.matchAll(RE_MARCADOR)].map((m) => m[1]);
  if (achados.length === 0) {
    return `Sem nenhum marcador: use ${MARCADORES.map((m) => `{${m}}`).join(", ")}.`;
  }

  const desconhecido = achados.find(
    (m) => !MARCADORES.includes(m as Marcador)
  );
  if (desconhecido) {
    return `Marcador desconhecido: {${desconhecido}}. Conhecidos: ${MARCADORES.map(
      (m) => `{${m}}`
    ).join(", ")}.`;
  }

  // Chave estranha vira id estranho. O que sobra do template vai cru para a
  // plataforma, entao so o que aparece em id de catalogo de verdade passa.
  const semMarcador = texto.replace(RE_MARCADOR, "");
  if (/[^A-Za-z0-9_\-.]/.test(semMarcador)) {
    return "Fora dos marcadores, use só letras, números, _ - e ponto.";
  }

  return null;
}

/**
 * Monta o id de um produto.
 *
 * Devolve `null` quando falta algum dado que o template pede. E de proposito:
 * `shopify_US__67606346727697`, com o id do produto faltando, nao casa com nada
 * e ainda polui o catalogo com um id que parece valido. Item sem id e melhor
 * que item com id errado -- o primeiro some da lista, o segundo mente.
 */
export function montarIdDeProduto(
  template: string | null | undefined,
  dados: DadosDoProduto
): string | null {
  const texto = (template || "").trim() || TEMPLATE_PADRAO;

  const valor = (marcador: string): string | null => {
    const bruto =
      marcador === "variant_id"
        ? dados.variantId
        : marcador === "product_id"
          ? dados.productId
          : marcador === "sku"
            ? dados.sku
            : null;
    const limpo = bruto === null || bruto === undefined ? "" : String(bruto).trim();
    return limpo || null;
  };

  let faltou = false;
  const saida = texto.replace(RE_MARCADOR, (inteiro, marcador: string) => {
    if (!MARCADORES.includes(marcador as Marcador)) {
      faltou = true;
      return inteiro;
    }
    const v = valor(marcador);
    if (v === null) {
      faltou = true;
      return "";
    }
    return v;
  });

  return faltou ? null : saida;
}

/**
 * Monta a lista de ids de varios itens, sem repetir e sem buraco.
 *
 * Item que nao rende id sai da lista em vez de virar string vazia: o Meta conta
 * `content_ids` com entrada vazia como id invalido e pode recusar o evento
 * inteiro.
 */
export function montarIdsDeProdutos(
  template: string | null | undefined,
  itens: DadosDoProduto[]
): string[] {
  const saida: string[] = [];
  for (const item of itens) {
    const id = montarIdDeProduto(template, item);
    if (id && !saida.includes(id)) saida.push(id);
  }
  return saida;
}
