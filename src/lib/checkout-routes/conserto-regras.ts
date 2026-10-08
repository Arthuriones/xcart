// ============================================================================
// Regras do conserto que nao dependem de rede: ficam aqui para serem testadas
// sem Shopify nem banco. Quem chama e src/lib/checkout-routes/heal.ts.
// ============================================================================

function idNumerico(valor: string | number | null | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  return String(valor).match(/(\d+)$/)?.[1] || null;
}

// ---------------------------------------------------------------------------
// Par pelo variant_map antigo
// ---------------------------------------------------------------------------

/**
 * Variante da vitrine que nao casou por SKU, mas que o variant_map do destino
 * ja apontava para uma variante que continua viva no checkout.
 *
 * O conserto decidia "falta" so pelo SKU. Mas o loader roteia pelo
 * variant_map primeiro (cart-routing.ts): o comprador continuava indo para a
 * variante certa, e o conserto, sem achar o SKU novo no checkout, CRIAVA o
 * produto de novo -- IA de texto, credito de imagem, duplicata publicada e o
 * antigo orfao. Acontecia quando o SKU da vitrine mudava (app de fornecedor,
 * reimportacao, o proprio carimbo de desduplicacao) e na vitrine sem SKU
 * ligada pelo create-destination, cuja loja de checkout ficou sem SKU: na
 * primeira passada o carimbo "xc-<id>" fazia o catalogo inteiro parecer novo.
 *
 * Devolve o id numerico da variante do checkout a adotar, ou null. Nao adota
 * quando a variante do checkout:
 *  - ja e par de outra variante da vitrine nesta passada (`reivindicadas`);
 *  - carrega um SKU que pertence a OUTRA variante viva da vitrine -- ai o
 *    mapa antigo e que esta errado (o conserto do prefixo "xc" deixou disso).
 */
export function parPeloMapaAntigo(entrada: {
  varianteId: string | number;
  mapaAntigo: Readonly<Record<string, string | number>>;
  /** Variantes vivas do checkout, por id numerico, com o SKU delas. */
  checkoutPorId: ReadonlyMap<string, { sku?: string | null }>;
  reivindicadas: ReadonlySet<string>;
  /** SKUs (minusculos) de todas as variantes da vitrine. */
  skusDaVitrine: ReadonlySet<string>;
}): string | null {
  const numero = idNumerico(entrada.varianteId);
  if (!numero) return null;
  const bruto =
    entrada.mapaAntigo[numero] ??
    entrada.mapaAntigo[`gid://shopify/ProductVariant/${numero}`];
  const alvo = idNumerico(bruto as string | number | undefined);
  if (!alvo) return null;

  const variante = entrada.checkoutPorId.get(alvo);
  if (!variante) return null; // apagada no checkout: ai sim falta
  if (entrada.reivindicadas.has(alvo)) return null;

  const skuDela = (variante.sku || "").trim().toLowerCase();
  if (skuDela && entrada.skusDaVitrine.has(skuDela)) return null;

  return alvo;
}

// ---------------------------------------------------------------------------
// Tirar do mapa o par morto ou errado
// ---------------------------------------------------------------------------

/**
 * O mapa gravado depois do conserto, sem os pares que levariam o comprador
 * ao lugar errado.
 *
 * O conserto montava `{ ...mapaAntigo, ...pares desta passada }`: so
 * acrescentava. E o loader e o resolve leem o variant_map ANTES do sku_map.
 * Quando a trava de criacao segura o produto, ou quando o par antigo e
 * recusado (outra variante ja tem aquele par, ou o SKU dele e de outro
 * produto da vitrine), a entrada velha ficava para sempre:
 *  - variante apagada no checkout -> /cart/<id morto>:1, carrinho vazio;
 *  - variante de OUTRO produto -> o comprador da bolsa B paga pela bolsa A.
 * Sem a entrada, a linha cai no sku_map ou na API (hidratacao por SKU, ou o
 * aviso de erro), que e melhor que entregar o produto trocado.
 *
 * Tira:
 *  - de qualquer chave, o par cujo alvo nao existe mais no checkout -- so com
 *    `checkoutCompleto` (indice paginado ate o fim e sem produto cortado nas
 *    50 variantes da consulta): com o indice incompleto, "nao achei" nao
 *    prova que morreu;
 *  - das variantes vivas da vitrine que ficaram SEM par nesta passada, o par
 *    antigo (id numerico, gid e SKU) cujo alvo ja e de outra variante ou
 *    carrega o SKU de outra variante da vitrine.
 * Variante que nao aparece no products.json (produto despublicado) so perde
 * o par se o alvo morreu.
 */
export function podarMapas(e: {
  skuMap: Readonly<Record<string, string | number>>;
  variantMap: Readonly<Record<string, string | number>>;
  /**
   * Os pares desta passada, que entram por cima do que sobrar. Chave antiga
   * que volta com par novo foi trocada, nao tirada: nao conta em `removidos`.
   */
  novos: {
    skuMap: Readonly<Record<string, string>>;
    variantMap: Readonly<Record<string, string>>;
  };
  /** Variantes vivas da vitrine que terminaram a passada sem par. */
  semPar: readonly { id: number | string; sku: string | null | undefined }[];
  /** Variantes do checkout, por id numerico, com o SKU delas. */
  checkoutPorId: ReadonlyMap<string, { sku?: string | null }>;
  checkoutCompleto: boolean;
  /** Variantes do checkout que ja sao par de alguem nesta passada. */
  reivindicadas: ReadonlySet<string>;
  /** SKUs (minusculos) de todas as variantes da vitrine. */
  skusDaVitrine: ReadonlySet<string>;
}): {
  /** O mapa final: o antigo podado, com os pares novos por cima. */
  skuMap: Record<string, string | number>;
  variantMap: Record<string, string | number>;
  /** Pares tirados sem substituto (variante da vitrine ou SKU). */
  removidos: number;
} {
  const morto = (alvo: string | null) =>
    !!alvo && e.checkoutCompleto && !e.checkoutPorId.has(alvo);
  // Alvo vivo, mas de outra variante (o morto e com `morto`).
  const deOutro = (alvo: string | null) => {
    if (!alvo) return false;
    const variante = e.checkoutPorId.get(alvo);
    if (!variante) return false;
    if (e.reivindicadas.has(alvo)) return true;
    const sku = (variante.sku || "").trim().toLowerCase();
    return !!sku && e.skusDaVitrine.has(sku);
  };

  const skuMap: Record<string, string | number> = {};
  const variantMap: Record<string, string | number> = {};
  const removidos = new Set<string>();

  // Variantes sem par: chaves numerica e gid, e o SKU (sem caixa) -> id,
  // para contar a variante uma vez so quando sai pelos dois mapas.
  const idsSemPar = new Set<string>();
  const skusSemPar = new Map<string, string>();
  for (const v of e.semPar) {
    const id = idNumerico(v.id);
    if (id) idsSemPar.add(id);
    const sku = (v.sku || "").trim().toLowerCase();
    if (sku && id) skusSemPar.set(sku, id);
  }

  // O sku_map guarda a chave com a caixa da vitrine e o loader compara sem
  // caixa: "ABC" velho e "abc" novo sao o mesmo par.
  const skusNovos = new Set(
    Object.keys(e.novos.skuMap).map((k) => k.trim().toLowerCase())
  );

  for (const [chave, valor] of Object.entries(e.variantMap)) {
    const alvo = idNumerico(valor);
    const origem = idNumerico(chave);
    const tirar =
      morto(alvo) || (!!origem && idsSemPar.has(origem) && deOutro(alvo));
    if (!tirar) variantMap[chave] = valor;
    else if (!(chave in e.novos.variantMap)) removidos.add(`v:${origem ?? chave}`);
  }

  for (const [chave, valor] of Object.entries(e.skuMap)) {
    const alvo = idNumerico(valor);
    const sku = chave.trim().toLowerCase();
    const dono = skusSemPar.get(sku);
    const tirar = morto(alvo) || (!!dono && deOutro(alvo));
    if (!tirar) skuMap[chave] = valor;
    else if (!skusNovos.has(sku)) removidos.add(dono ? `v:${dono}` : `s:${sku}`);
  }

  return {
    skuMap: { ...skuMap, ...e.novos.skuMap },
    variantMap: { ...variantMap, ...e.novos.variantMap },
    removidos: removidos.size,
  };
}

// ---------------------------------------------------------------------------
// Quando o conserto pode CRIAR produto na loja de checkout
// ---------------------------------------------------------------------------

/**
 * Abaixo disto o par de lojas nao parece o certo: o conserto so mapeia.
 * Uma loja de checkout de outro nicho, ligada a vitrine por engano, casa um
 * punhado de SKUs curtos ("1", "3", "101") e mais nada.
 */
export const COBERTURA_MINIMA_PARA_CRIAR = 0.7;

/** Mais que isto numa passada so com o lojista confirmando. */
export const MAX_PRODUTOS_POR_PASSADA = 20;

export interface DecisaoDeCriacao {
  /** Pode criar produto novo na loja de checkout. */
  criarProdutos: boolean;
  /** Pode acrescentar variante em produto que ja existe la. */
  estenderProdutos: boolean;
  /** Por que nao criou, pronto para a tela. null = nada barrado. */
  motivo: string | null;
}

/**
 * Separa MAPEAR (sempre) de CRIAR (so com o par confirmado).
 *
 * O conserto despejava o catalogo da vitrine em qualquer loja ligada a rota:
 * a NORAH OUTLET ganhou chinelos e tenis de uma rota com a vitrine errada --
 * e ganhou de novo depois de apagar, porque o cron recriava de hora em hora.
 * "Adicionar loja" pendurava a loja com 1 casamento e peso 0, e o peso 0
 * ("fora do rodizio ate revisar") nao impedia o cron de criar tudo.
 *
 * Sem o lojista confirmar, so cria quando a rota e o destino estao ligados,
 * o destino esta no rodizio, a vitrine ja casa bem com ele e a leva e pequena.
 */
export function decidirCriacao(e: {
  /** O lojista pediu para criar (botao de confirmar). */
  confirmado: boolean;
  rotaLigada: boolean;
  destinoLigado: boolean;
  peso: number;
  /** Variantes da vitrine com par no checkout antes de criar qualquer coisa. */
  variantesComPar: number;
  /** Variantes da vitrine com SKU. */
  variantesTotal: number;
  /** Produtos da vitrine sem nenhuma variante no checkout. */
  produtosNovos: number;
}): DecisaoDeCriacao {
  if (e.confirmado) {
    return { criarProdutos: true, estenderProdutos: true, motivo: null };
  }

  const barrado = (motivo: string): DecisaoDeCriacao => ({
    criarProdutos: false,
    estenderProdutos: false,
    motivo,
  });

  if (!e.rotaLigada) return barrado("a rota está pausada");
  if (!e.destinoLigado || e.peso <= 0) {
    return barrado("esta loja de checkout está fora do rodízio");
  }
  if (e.variantesTotal > 0) {
    const cobertura = e.variantesComPar / e.variantesTotal;
    if (cobertura < COBERTURA_MINIMA_PARA_CRIAR) {
      return barrado(
        `só ${Math.floor(cobertura * 100)}% da vitrine tem par nesta loja de checkout; confira se é o par certo de lojas`
      );
    }
  }
  if (e.produtosNovos > MAX_PRODUTOS_POR_PASSADA) {
    return {
      criarProdutos: false,
      estenderProdutos: true,
      motivo: `são ${e.produtosNovos} produtos de uma vez`,
    };
  }
  return { criarProdutos: true, estenderProdutos: true, motivo: null };
}

/**
 * A frase do card quando sobrou produto sem criar. `loja` diz qual: com
 * rodizio, cada loja de checkout tem a sua pendencia.
 */
export function mensagemDeCriacaoPendente(
  produtos: number,
  variantes: number,
  motivo: string,
  loja?: string | null
): string {
  const onde = loja ? `na loja de checkout ${loja}` : "na loja de checkout";
  const oQue =
    produtos > 0
      ? produtos === 1
        ? `1 produto da vitrine falta ${onde} e não foi criado sozinho`
        : `${produtos} produtos da vitrine faltam ${onde} e não foram criados sozinhos`
      : variantes === 1
        ? `1 variante da vitrine falta ${onde} e não foi criada sozinha`
        : `${variantes} variantes da vitrine faltam ${onde} e não foram criadas sozinhas`;
  return `${oQue} (${motivo}). Confira e confirme em Diagnóstico.`;
}

// ---------------------------------------------------------------------------
// Par casado que nao vende como a vitrine: preco diferente, produto inativo
// ---------------------------------------------------------------------------

/**
 * Quantos exemplos de cada problema ficam guardados. O suficiente para o
 * lojista achar o produto; a contagem diz o tamanho.
 */
export const EXEMPLOS_POR_CONFERENCIA = 3;

export type MotivoIndisponivel = "inativo" | "fora_da_loja" | "sem_estoque";

export interface ExemploDePreco {
  produto: string;
  variante: string;
  sku: string;
  vitrine: string;
  checkout: string;
}

export interface ExemploIndisponivel {
  /** Titulo do produto NA LOJA DE CHECKOUT: e la que o lojista corrige. */
  produto: string;
  variante: string;
  sku: string;
  motivo: MotivoIndisponivel;
}

export interface ConferenciaDosPares {
  /** Pares conferidos (variante da vitrine com par existente no checkout). */
  conferidas: number;
  /**
   * null = nao comparou: as duas lojas tem moedas diferentes, ou a moeda de
   * uma delas nao veio. Preco em BRL contra preco em USD nao diz nada.
   */
  precoDiferente: { total: number; moeda: string; exemplos: ExemploDePreco[] } | null;
  indisponiveis: {
    total: number;
    inativo: number;
    foraDaLoja: number;
    semEstoque: number;
    exemplos: ExemploIndisponivel[];
  };
}

export interface ParParaConferir {
  /** Produto e variante da vitrine. */
  produto: string;
  variante: string;
  sku: string;
  precoVitrine: string | number | null | undefined;
  checkout: {
    produto: string;
    preco?: string | number | null;
    /** ACTIVE / DRAFT / ARCHIVED. Ausente = nao sabemos, nao conta. */
    status?: string | null;
    /** false = produto fora do canal Loja virtual. Ausente = nao sabemos. */
    naLojaVirtual?: boolean | null;
    /** false = estoque rastreado, zerado e sem vender sem estoque. */
    disponivel?: boolean | null;
  };
}

function centavos(valor: string | number | null | undefined): number | null {
  const texto = String(valor ?? "").trim();
  if (!texto) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function precoLegivel(valor: string | number | null | undefined): string {
  const c = centavos(valor);
  return c === null ? String(valor ?? "") : (c / 100).toFixed(2);
}

/**
 * O que o conserto conta e NAO mexe nos pares casados.
 *
 * Preco: o conserto nao sincroniza -- o lojista pode ter mudado de proposito
 * (frete embutido, cupom, teste de preco). So conta quantos divergem.
 * Indisponivel: produto do checkout nao ACTIVE, fora do canal Loja virtual
 * (o /cart/<id> da permalink nao abre) ou sem estoque com inventario
 * rastreado. A rota leva o comprador ate la e o checkout recusa.
 * Uma variante conta num motivo so, o primeiro que vale nessa ordem.
 */
export function conferirPares(
  pares: readonly ParParaConferir[],
  moedas: { vitrine?: string | null; checkout?: string | null }
): ConferenciaDosPares {
  const moeda =
    moedas.vitrine && moedas.checkout && moedas.vitrine === moedas.checkout
      ? moedas.vitrine
      : null;
  const precos: ExemploDePreco[] = [];
  let precoTotal = 0;
  const indisponiveis: ConferenciaDosPares["indisponiveis"] = {
    total: 0,
    inativo: 0,
    foraDaLoja: 0,
    semEstoque: 0,
    exemplos: [],
  };

  for (const par of pares) {
    if (moeda) {
      const daVitrine = centavos(par.precoVitrine);
      const doCheckout = centavos(par.checkout.preco);
      if (daVitrine !== null && doCheckout !== null && daVitrine !== doCheckout) {
        precoTotal += 1;
        if (precos.length < EXEMPLOS_POR_CONFERENCIA) {
          precos.push({
            produto: par.produto,
            variante: par.variante,
            sku: par.sku,
            vitrine: precoLegivel(par.precoVitrine),
            checkout: precoLegivel(par.checkout.preco),
          });
        }
      }
    }

    const status = (par.checkout.status || "").toUpperCase();
    const motivo: MotivoIndisponivel | null =
      status && status !== "ACTIVE"
        ? "inativo"
        : par.checkout.naLojaVirtual === false
          ? "fora_da_loja"
          : par.checkout.disponivel === false
            ? "sem_estoque"
            : null;
    if (!motivo) continue;
    indisponiveis.total += 1;
    if (motivo === "inativo") indisponiveis.inativo += 1;
    else if (motivo === "fora_da_loja") indisponiveis.foraDaLoja += 1;
    else indisponiveis.semEstoque += 1;
    if (indisponiveis.exemplos.length < EXEMPLOS_POR_CONFERENCIA) {
      indisponiveis.exemplos.push({
        produto: par.checkout.produto,
        variante: par.variante,
        sku: par.sku,
        motivo,
      });
    }
  }

  return {
    conferidas: pares.length,
    precoDiferente: moeda ? { total: precoTotal, moeda, exemplos: precos } : null,
    indisponiveis,
  };
}
