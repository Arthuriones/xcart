import { updateVariantSkus, type ShopifyCredentials } from "@/lib/shopify/client";

// ============================================================================
// Normalizacao de SKU da vitrine.
//
// O roteamento casa vitrine -> loja checkout exclusivamente por SKU. Quando o
// lojista cria um produto na mao no Shopify, o SKU vem vazio: aquele produto
// simplesmente nunca roteia, e o app so descobria isso depois, olhando o
// funil. Um usuario ficou com 27% de cobertura por causa disso.
//
// Em vez de exigir que ele preencha 483 SKUs na mao, o app carimba sozinho.
//
// Dois defeitos sao corrigidos aqui:
//  1. Variante sem SKU  -> nao roteia (cliente cai no checkout da vitrine).
//  2. SKU repetido em variantes diferentes -> roteia para o produto ERRADO
//     (o cliente paga por um item e recebe outro). Este e o pior dos dois.
//
// O SKU gerado e derivado do id numerico da variante, que e unico na loja:
// isso torna a operacao idempotente (rodar de novo nao gera SKU novo) e nao
// vaza marca nenhuma para a loja de checkout.
// ============================================================================

const PREFIXO = "xc";

function idNumerico(id: string | number): string {
  return String(id).match(/(\d+)$/)?.[1] || "";
}

// Os ids chegam como gid (API autenticada) ou como numero cru (products.json
// publico, usado pelo repair). As mutations so aceitam gid.
function paraGid(id: string | number, tipo: "Product" | "ProductVariant"): string {
  const texto = String(id);
  if (texto.startsWith("gid://")) return texto;
  const numero = idNumerico(texto);
  return numero ? `gid://shopify/${tipo}/${numero}` : "";
}

export function skuNeutro(variantId: string | number): string {
  const numero = idNumerico(variantId);
  if (!numero) return "";
  return `${PREFIXO}-${BigInt(numero).toString(36)}`;
}

interface ProdutoComVariantes {
  id: string | number;
  title: string;
  variants?:
    | { nodes?: { id: string | number; sku?: string | null }[] }
    | { id: string | number; sku?: string | null }[];
}

// products.json devolve variants como array; a API autenticada devolve
// { nodes: [...] }. Aceita os dois para nao duplicar esta logica nos callers.
function variantesDe(produto: ProdutoComVariantes) {
  const v = produto.variants;
  if (!v) return [];
  return Array.isArray(v) ? v : v.nodes || [];
}

export interface ResultadoCarimbo {
  /** Variantes que estavam sem SKU e ganharam um. */
  carimbadas: number;
  /** Variantes cujo SKU repetido foi trocado por um unico. */
  desduplicadas: number;
  /** SKUs que estavam repetidos, para mostrar no relatorio. */
  skusRepetidos: string[];
  /** variantId (gid) -> SKU final. Inclui as que ja tinham SKU valido. */
  skuPorVariante: Map<string, string>;
  falhas: string[];
}

/** Menor id numerico primeiro. Ids da Shopify nao cabem em Number com folga. */
function compararIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface OpcoesCarimbo {
  /**
   * Variantes da vitrine (id numerico ou gid) que JA tem par na loja de
   * checkout -- as chaves do variant_map do destino.
   *
   * Em SKU repetido, quem fica com o SKU e quem ja esta mapeada; as outras
   * ganham SKU proprio. Sem isso, o dono era "quem aparece primeiro", e o
   * conserto le a vitrine pelo products.json publico, que vem do produto MAIS
   * NOVO para o mais antigo: o lojista duplicava a bolsa A para cadastrar a
   * bolsa B (a copia leva os SKUs), B ficava com o SKU e casava com a variante
   * de A no checkout -- o comprador de B pagava pelo produto A -- e A ganhava
   * SKU novo e uma duplicata na loja de checkout.
   */
  mapeadas?: Iterable<string | number>;
  /**
   * So carimba quem esta SEM SKU; SKU repetido fica como esta. Para quem ve
   * um pedaco do catalogo (um lote do create-destination) e nao tem como
   * saber quem e o dono de um SKU que se repete em outro lote -- isso fica
   * para o conserto, que le a vitrine inteira.
   */
  soSemSku?: boolean;
}

/**
 * Quem fica com o SKU repetido: a variante ja mapeada; sem nenhuma (ou com
 * varias), a de menor id -- a mais antiga. Deterministico, e o mesmo nos dois
 * chamadores (conserto pelo products.json e connect-by-sku pela Admin API,
 * que leem a vitrine em ordens opostas).
 */
export function donoDoSkuRepetido<T extends { numero: string }>(
  candidatas: readonly T[],
  mapeadas: ReadonlySet<string>
): T {
  const preferidas = candidatas.filter((c) => mapeadas.has(c.numero));
  const fila = (preferidas.length > 0 ? preferidas : [...candidatas]).sort((a, b) =>
    compararIds(a.numero, b.numero)
  );
  return fila[0];
}

/**
 * Garante que toda variante da loja tenha um SKU unico, escrevendo no Shopify
 * o que estiver faltando. Nao mexe em SKU que ja e unico.
 */
export async function normalizarSkus(
  creds: ShopifyCredentials,
  produtos: ProdutoComVariantes[],
  opcoes: OpcoesCarimbo = {}
): Promise<ResultadoCarimbo> {
  const skuPorVariante = new Map<string, string>();
  const falhas: string[] = [];
  const skusRepetidos = new Set<string>();
  const mapeadas = new Set<string>();
  for (const id of opcoes.mapeadas || []) {
    const numero = idNumerico(id);
    if (numero) mapeadas.add(numero);
  }

  interface Entrada {
    produtoGid: string;
    produtoTitulo: string;
    idBruto: string | number;
    varianteGid: string;
    numero: string;
    atual: string;
  }

  // Primeira passada: decide o SKU final de cada variante sem tocar na API.
  const entradas: Entrada[] = [];
  const porSku = new Map<string, Entrada[]>();
  for (const produto of produtos) {
    const produtoGid = paraGid(produto.id, "Product");
    for (const bruta of variantesDe(produto)) {
      const entrada: Entrada = {
        produtoGid,
        produtoTitulo: produto.title,
        idBruto: bruta.id,
        varianteGid: paraGid(bruta.id, "ProductVariant"),
        numero: idNumerico(bruta.id),
        atual: bruta.sku?.trim() || "",
      };
      entradas.push(entrada);
      if (!entrada.atual) continue;
      const chave = entrada.atual.toLowerCase();
      const grupo = porSku.get(chave) || [];
      grupo.push(entrada);
      porSku.set(chave, grupo);
    }
  }

  // Dono de cada SKU presente, decidido antes de qualquer carimbo.
  const donoDoSku = new Map<string, string>();
  for (const [chave, grupo] of porSku) {
    donoDoSku.set(chave, donoDoSkuRepetido(grupo, mapeadas).varianteGid);
  }

  const aEscrever = new Map<string, { variantId: string; sku: string }[]>();
  let carimbadas = 0;
  let desduplicadas = 0;

  for (const entrada of entradas) {
    const chave = entrada.atual.toLowerCase();

    // SKU presente e esta variante e a dona dele: esta bom, nao mexe.
    if (
      entrada.atual &&
      (opcoes.soSemSku || donoDoSku.get(chave) === entrada.varianteGid)
    ) {
      skuPorVariante.set(entrada.varianteGid, entrada.atual);
      continue;
    }

    const novo = skuNeutro(entrada.idBruto);
    if (!novo || !entrada.produtoGid) {
      falhas.push(`${entrada.produtoTitulo}: variante sem id numerico (${entrada.idBruto})`);
      continue;
    }
    // O SKU neutro e derivado do id da propria variante. So colide se alguem
    // gravou na mao, em OUTRA variante, exatamente "xc-<id desta>": nao da
    // para resolver sem tirar o SKU da outra, entao fica de fora e avisa.
    const donoDoNovo = donoDoSku.get(novo.toLowerCase());
    if (donoDoNovo && donoDoNovo !== entrada.varianteGid) {
      falhas.push(`${entrada.produtoTitulo}: o SKU ${novo} ja esta em outra variante`);
      continue;
    }

    if (entrada.atual) {
      skusRepetidos.add(entrada.atual);
      desduplicadas += 1;
    } else {
      carimbadas += 1;
    }

    donoDoSku.set(novo.toLowerCase(), entrada.varianteGid);
    skuPorVariante.set(entrada.varianteGid, novo);
    const lista = aEscrever.get(entrada.produtoGid) || [];
    lista.push({ variantId: entrada.varianteGid, sku: novo });
    aEscrever.set(entrada.produtoGid, lista);
  }

  // Segunda passada: grava. Um productVariantsBulkUpdate por produto, em
  // serie — a API do Shopify e cobrada por custo e estoura em paralelo alto.
  for (const [productId, updates] of aEscrever) {
    try {
      await updateVariantSkus(creds, productId, updates);
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : "erro desconhecido";
      falhas.push(`${productId}: ${msg}`);
      // Nao conseguiu gravar: o SKU planejado nao existe na loja, entao some
      // com ele do mapa para nao criar rota apontando para um SKU fantasma.
      for (const update of updates) skuPorVariante.delete(update.variantId);
    }
  }

  return {
    carimbadas,
    desduplicadas,
    skusRepetidos: [...skusRepetidos],
    skuPorVariante,
    falhas,
  };
}
