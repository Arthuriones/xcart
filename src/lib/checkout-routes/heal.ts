import {
  addProductVariants,
  completarVariantes,
  createProduct,
  getProducts,
  MAX_VARIANTES_POR_PRODUTO,
  shopifyRestGet,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import {
  fetchPublicShopifyProducts,
  LojaComSenhaError,
  toShopifyCreateProductInput,
  type PublicShopifyProduct,
} from "@/lib/shopify/public-store";
import { normalizarSkus } from "@/lib/shopify/sku-stamp";
import { produtoNoDestino } from "@/lib/checkout-routes/produto-no-destino";
import {
  conferirPares,
  decidirCriacao,
  mensagemDeCriacaoPendente,
  parPeloMapaAntigo,
  podarMapas,
  type ConferenciaDosPares,
  type ParParaConferir,
} from "@/lib/checkout-routes/conserto-regras";
import {
  foraDoAr,
  mensagemForaDoAr,
  motivoDaSaude,
  type ForaDoAr,
  type LadoDaRota,
  type MotivoForaDoAr,
} from "@/lib/checkout-routes/loja-fora-do-ar";
import {
  sincronizarTemaDaRota,
  type ResultadoTema,
} from "@/lib/checkout-routes/tema-vitrine";
import { verificarParDaRota } from "@/lib/shopify/store-health";
import { neutralizeProductForDestination } from "@/lib/ai/product-neutralizer";
import {
  enqueueImageNeutralizeJobs,
  requestImageQueueDrain,
} from "@/lib/jobs/image-neutralize-processor";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_COST, logAiUsage } from "@/lib/billing/usage";

// ============================================================================
// Conserto de uma rota de checkout.
//
// Antes isto morava dentro de /api/checkout-routes/repair e so rodava quando
// alguem clicava. Mas uma rota se degrada sozinha: basta o lojista cadastrar um
// produto na mao no Shopify e ele nasce fora da rota — sem SKU, sem par na loja
// de checkout — e o dono so descobre pelo funil, semanas depois.
//
// Extraido para lib para o cron rodar o mesmo conserto sem sessao de usuario.
// ============================================================================

function numericId(gid: string | number | undefined | null): string | null {
  if (gid === undefined || gid === null) return null;
  return String(gid).match(/(\d+)$/)?.[1] || null;
}

interface TargetVariantInfo {
  variantId: string; // numerico
  productId: string;
  productTitle: string;
  options: string[];
  sku: string;
  /** Para a conferencia dos pares (conferirPares): o conserto nao mexe. */
  price?: string | null;
  productStatus?: string | null;
  /** false = produto fora do canal Loja virtual. Ausente = nao veio. */
  naLojaVirtual?: boolean;
  disponivel?: boolean;
}

/**
 * Chave de combinacao de opcoes dentro de um produto: "gid...|preto|38".
 *
 * A Shopify recusa duas variantes com a MESMA combinacao de opcoes no mesmo
 * produto -- independente do SKU. Indexar so por SKU (como era) deixava o
 * conserto cego para essa regra.
 */
function chaveDeOpcoes(productId: string, valores: (string | null | undefined)[]) {
  return (
    productId +
    "|" +
    valores.map((v) => (v || "").trim().toLowerCase()).join("|")
  );
}

interface ProdutoDoIndice {
  id: string;
  title: string;
  status?: string | null;
  onlineStoreUrl?: string | null;
  options?: { name: string }[];
  variants?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } | null;
    nodes?: {
      id: string;
      sku?: string | null;
      price?: string | null;
      availableForSale?: boolean;
      selectedOptions?: { name: string; value: string }[];
    }[];
  } | null;
}

async function getAllTargetVariants(creds: ShopifyCredentials) {
  // false = o indice pode nao ter toda variante do checkout (paginacao parou
  // no teto, ou a leitura das variantes de um produto grande falhou). Ai "nao
  // achei pelo id" nao prova que a variante foi apagada, e o conserto nao
  // tira par do mapa por isso (ver podarMapas).
  let completo = true;
  const bySku = new Map<string, TargetVariantInfo>();
  // Segundo indice, pela combinacao de opcoes. Aqui entra TODA variante,
  // inclusive a sem SKU -- que e justamente a que o indice por SKU perdia.
  const byOpcoes = new Map<string, TargetVariantInfo>();
  // Terceiro indice, pelo id: e por ele que o variant_map aponta. Sem este
  // indice o conserto nao sabia se o par antigo ainda existia no checkout.
  const byId = new Map<string, TargetVariantInfo>();
  // Quantas variantes cada produto do checkout ja tem: o teto da Shopify e
  // 2048 por produto, e estender passando dele falha o lote inteiro.
  const variantesPorProduto = new Map<string, number>();
  let after: string | null = null;
  for (let page = 0; page < 60; page += 1) {
    const data = await getProducts(creds, { first: 250, after });
    const nodes = (data?.products?.nodes || []) as ProdutoDoIndice[];
    // A consulta traz 50 variantes por produto. Produto maior vinha cortado
    // e as que faltavam pareciam "nao existe no checkout": o conserto tentava
    // criar de novo (a Shopify recusa a combinacao repetida) ou deixava sem
    // par -- as 16 da rota Yarden Store -> pauments.
    try {
      await completarVariantes(creds, nodes);
    } catch (erro) {
      console.warn(
        "[heal] nao li as variantes de um produto grande:",
        erro instanceof Error ? erro.message : erro
      );
    }
    for (const product of nodes) {
      const options = (product.options || []).map(
        (option: { name: string }) => option.name
      );
      const variantes = product.variants?.nodes || [];
      // Sobrou pagina sem ler (a leitura acima falhou neste produto).
      if (product.variants?.pageInfo?.hasNextPage) completo = false;
      variantesPorProduto.set(product.id, variantes.length);
      for (const variant of variantes) {
        const info: TargetVariantInfo = {
          variantId: numericId(variant.id) as string,
          productId: product.id,
          productTitle: product.title,
          options,
          sku: (variant.sku || "").trim(),
          price: variant.price ?? null,
          productStatus: product.status ?? null,
          ...("onlineStoreUrl" in product
            ? { naLojaVirtual: Boolean(product.onlineStoreUrl) }
            : {}),
          ...(typeof variant.availableForSale === "boolean"
            ? { disponivel: variant.availableForSale }
            : {}),
        };
        if (info.variantId) byId.set(info.variantId, info);

        const selecionadas = (variant.selectedOptions || []) as {
          name: string;
          value: string;
        }[];
        if (selecionadas.length) {
          const chave = chaveDeOpcoes(
            product.id,
            selecionadas.map((o) => o.value)
          );
          if (!byOpcoes.has(chave)) byOpcoes.set(chave, info);
        }

        if (!variant.sku) continue;
        const key = variant.sku.trim().toLowerCase();
        if (!bySku.has(key)) bySku.set(key, info);
      }
    }
    const pageInfo = data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) {
      return { bySku, byOpcoes, byId, variantesPorProduto, completo };
    }
    after = pageInfo.endCursor;
  }
  // Saiu pelo teto de paginas: sobrou produto sem ler.
  return { bySku, byOpcoes, byId, variantesPorProduto, completo: false };
}

/**
 * A vitrine esta com senha? Pergunta a Admin API (shop.json traz
 * password_enabled). O products.json sozinho nao prova: HTML no lugar do
 * JSON tambem pode ser pagina de bloqueio do proxy. Sem resposta = nao sei.
 */
async function vitrineComSenha(creds: ShopifyCredentials): Promise<boolean | null> {
  try {
    const r = await shopifyRestGet<{ shop?: { password_enabled?: boolean } }>(
      creds,
      "shop.json"
    );
    return typeof r?.shop?.password_enabled === "boolean" ? r.shop.password_enabled : null;
  } catch {
    return null;
  }
}

export interface HealRouteResult {
  /** Destino consertado. null = rota legada, sem linha de destino. */
  targetId?: string | null;
  /**
   * A loja de checkout deste resultado, para a tela dizer EM QUAL loja falta
   * produto -- com rodizio, o "Criar N produtos" vale para uma loja so.
   */
  targetStoreName?: string | null;
  targetShopDomain?: string | null;
  ok: true;
  routeId: string;
  stampedSkuCount: number;
  dedupedSkuCount: number;
  fixedWrongCount: number;
  extendedCount: number;
  /** Variantes que ja existiam no destino e so entraram no mapa. */
  adoptedVariantCount: number;
  /**
   * Pares tirados do mapa sem substituto: alvo apagado no checkout, ou alvo
   * que e de outra variante (ver podarMapas).
   */
  removedPairCount: number;
  /**
   * Variantes sem par porque o produto do checkout onde entrariam mistura
   * produtos da vitrine: o conserto nao acrescenta nada nele.
   */
  mixedBlockedVariantCount: number;
  createdProductCount: number;
  createdVariantCount: number;
  imageQueueCount: number;
  finalMappedCount: number;
  /** % das variantes da vitrine (com SKU) com par, antes de criar. */
  coveragePercent: number;
  /**
   * Produtos/variantes que faltam no checkout e NAO foram criados porque o
   * par de lojas nao passou na trava (ver decidirCriacao). So o lojista
   * confirmando (`criarFaltantes`) cria.
   */
  pendingProductCount: number;
  pendingVariantCount: number;
  creationBlockedReason: string | null;
  /** O xcart-config.json do tema da vitrine depois deste conserto. */
  theme?: ResultadoTema;
  /**
   * Pares casados com preco diferente da vitrine, ou que o checkout nao
   * vende (inativo, fora da Loja virtual, sem estoque). So contados.
   */
  conferencia?: ConferenciaDosPares;
  warnings: string[];
  /** true quando nada precisou mudar — o cron usa para nao poluir o log. */
  noop: boolean;
}

export class HealRouteError extends Error {
  status: number;
  /** Loja que o conserto nao atende: o cron espera para tentar de novo. */
  foraDoAr?: ForaDoAr;
  constructor(message: string, status = 500, fora?: ForaDoAr) {
    super(message);
    this.status = status;
    if (fora) this.foraDoAr = fora;
  }
}

interface HealRouteInput {
  routeId: string;
  /**
   * Qual loja de checkout consertar. Uma rota pode ter varias (rodizio), e
   * cada uma tem o SEU mapa -- consertar "a rota" sem dizer qual destino
   * consertaria sempre o mesmo e deixaria os outros apodrecendo.
   * Omitido = o primeiro destino ligado.
   */
  targetId?: string;
  /** Restringe ao dono. Omitido no cron, que ja seleciona as rotas. */
  userId?: string;
  /** Origem da app, para acordar a fila de imagens. */
  origin?: string;
  cookie?: string;
  /**
   * Gera imagem sem marca para os produtos criados. Consome 1 credito por
   * imagem — a fila ja bloqueia e devolve o credito quando falta saldo.
   * Deixar o produto novo com a foto de marca na loja de checkout e pior do
   * que gastar o credito, entao o padrao e ligado.
   */
  neutralizeImages?: boolean;
  /**
   * O lojista confirmou que quer criar o que falta, mesmo com a trava do par
   * de lojas barrando (ver decidirCriacao). O cron nunca passa isto.
   */
  criarFaltantes?: boolean;
}

// O painel so dizia a verdade sobre uma rota se o usuario clicasse
// "Verificar" nela. Com o conserto rodando de hora em hora, o resultado fica
// guardado e o card mostra o estado sozinho.
//
// Vive em settings (jsonb que ja existe) de proposito: e dado derivado. Se
// algo sobrescrever, a proxima passada do cron reconstroi em ate uma hora —
// nao vale uma coluna e uma migration.
export interface UltimoConserto {
  at: string;
  ok: boolean;
  /** Motivo curto quando ok=false, pronto para o card. */
  message?: string;
  mappedCount?: number;
  /**
   * Loja que o conserto nao atende (pausada, sem app, vitrine com senha):
   * o motivo tipado para a tela, de qual lado e quando o cron volta a tentar.
   */
  motivo?: MotivoForaDoAr;
  lado?: LadoDaRota;
  proximaTentativa?: string;
}

/**
 * O mesmo, por loja de checkout, em routed_checkout_targets.settings.last_heal.
 * O da rota (routed_checkout_configs.settings.last_heal) e da ultima passada
 * de QUALQUER destino; com rodizio, so este diz o estado de cada loja.
 */
export interface UltimoConsertoDoDestino extends UltimoConserto {
  conferencia?: ConferenciaDosPares;
}

async function gravarStatus(
  admin: ReturnType<typeof createAdminClient>,
  routeId: string,
  settings: Record<string, unknown> | null,
  status: UltimoConserto
) {
  await admin
    .from("routed_checkout_configs")
    .update({ settings: { ...(settings || {}), last_heal: status } })
    .eq("id", routeId);
}

/**
 * Loja fora do ar: grava o motivo na rota e no destino, com a espera do cron,
 * e para. Erro de gravacao nao muda a resposta -- o conserto ja nao roda.
 */
async function pararComLojaForaDoAr(
  admin: ReturnType<typeof createAdminClient>,
  config: { id: string; settings: unknown },
  targetRow: { id: string; settings?: unknown } | null,
  motivo: MotivoForaDoAr,
  lado: LadoDaRota,
  dominio: string
): Promise<never> {
  const fora = foraDoAr(motivo, lado);
  const status: UltimoConserto = {
    at: new Date().toISOString(),
    ok: false,
    message: mensagemForaDoAr(motivo, lado, dominio),
    ...fora,
  };
  await gravarStatus(admin, config.id, config.settings as Record<string, unknown> | null, status);
  if (targetRow) {
    const { error } = await admin
      .from("routed_checkout_targets")
      .update({
        settings: {
          ...((targetRow.settings as Record<string, unknown> | null) || {}),
          last_heal: status,
        },
      })
      .eq("id", targetRow.id);
    if (error) console.warn("[heal] nao gravei o estado do destino:", error.message);
  }
  throw new HealRouteError(status.message as string, 409, fora);
}

/** Depois disto, um conserto travado e considerado abandonado. */
const CLAIM_ABANDONADO_MS = 20 * 60 * 1000;

/**
 * Reserva o destino para este conserto, de forma atomica.
 *
 * O UPDATE condicional E a trava: o Postgres serializa a linha, entao de duas
 * execucoes simultaneas exatamente uma volta com linha. Mesmo padrao do
 * claimJob da fila de importacao.
 *
 * Sem isso, duas execucoes concorrentes (cron entregue em duplicidade, cron
 * que passou da hora, ou o lojista clicando "Corrigir agora" enquanto o cron
 * roda) pegavam o MESMO destino: criavam o mesmo produto duas vezes na loja de
 * checkout e faziam read-modify-write no sku_map, onde quem grava por ultimo
 * apaga o que o outro mapeou.
 */
async function reservarDestino(
  admin: ReturnType<typeof createAdminClient>,
  targetId: string
): Promise<boolean> {
  const agora = new Date();
  const limite = new Date(agora.getTime() - CLAIM_ABANDONADO_MS).toISOString();

  const { data, error } = await admin
    .from("routed_checkout_targets")
    .update({ healing_since: agora.toISOString() })
    .eq("id", targetId)
    // Livre, ou preso ha tempo demais (a funcao morreu no meio).
    .or(`healing_since.is.null,healing_since.lt.${limite}`)
    .select("id");

  if (error) {
    // Coluna ausente (migration 034 nao aplicada): nao trava o conserto, que
    // e quem mantem a rota funcionando. Volta ao comportamento antigo.
    console.warn("[heal] nao consegui reservar o destino:", error.message);
    return true;
  }
  return Array.isArray(data) && data.length > 0;
}

async function liberarDestino(
  admin: ReturnType<typeof createAdminClient>,
  targetId: string
) {
  const { error } = await admin
    .from("routed_checkout_targets")
    .update({ healing_since: null })
    .eq("id", targetId);
  if (error) console.warn("[heal] nao consegui liberar o destino:", error.message);
}

export class HealBusyError extends Error {
  constructor() {
    super("Ja existe um conserto em andamento para esta loja de checkout.");
    this.name = "HealBusyError";
  }
}

/**
 * O conserto de verdade. So e chamado com o destino ja reservado -- ver o
 * healRoute exportado logo abaixo.
 */
async function executarConserto(
  input: HealRouteInput
): Promise<HealRouteResult> {
  const admin = createAdminClient();

  let query = admin
    .from("routed_checkout_configs")
    .select(
      "id, user_id, name, enabled, sku_map, variant_map, settings, source_store_id, target_store_id"
    )
    .eq("id", input.routeId);
  if (input.userId) query = query.eq("user_id", input.userId);

  const { data: config, error: configError } = await query.single();
  if (configError || !config) {
    throw new HealRouteError("Rota nao encontrada.", 404);
  }

  const userId = config.user_id as string;

  // Qual destino desta rota vai ser consertado.
  let targetQuery = admin
    .from("routed_checkout_targets")
    .select("id, target_store_id, sku_map, variant_map, weight, enabled, settings")
    .eq("route_id", config.id);
  if (input.targetId) targetQuery = targetQuery.eq("id", input.targetId);
  else targetQuery = targetQuery.eq("enabled", true);

  const { data: targetRows, error: targetsError } = await targetQuery
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  // Erro do banco NAO e "rota sem destino": cair nas colunas da rota
  // consertaria (e criaria produto) no destino legado.
  if (targetsError) {
    throw new HealRouteError("Falha ao ler as lojas de checkout da rota.", 503);
  }

  const targetRow = targetRows?.[0] || null;
  if (input.targetId && !targetRow) {
    throw new HealRouteError("Loja de checkout nao encontrada nesta rota.", 404);
  }

  // Rota anterior a migracao 025 cujo destino foi apagado a mao: cai nas
  // colunas da propria rota em vez de nao consertar nada.
  const targetStoreId = targetRow?.target_store_id || config.target_store_id;
  const oldMaps = {
    skuMap: (targetRow ? targetRow.sku_map : config.sku_map) || {},
    variantMap: (targetRow ? targetRow.variant_map : config.variant_map) || {},
  };

  // O filtro por user_id NAO e redundante.
  //
  // Este e um cliente admin: a RLS nao vale aqui. Os dois ids saem de colunas
  // de `routed_checkout_configs`, e a garantia de que eles apontam para lojas
  // do mesmo dono e a policy WITH CHECK da migration 030 -- que o service_role
  // burla. Basta uma rota gravada por um caminho admin (ou anterior aquela
  // migration) apontando para a loja de outra pessoa para este SELECT devolver
  // o client_secret e o access_token dela, e o conserto seguir escrevendo
  // produtos na loja da vitima.
  //
  // Com o filtro, uma rota assim simplesmente nao acha loja e para em 404.
  const { data: stores } = await admin
    .from("stores")
    .select(
      "id, name, shop_domain, client_id, client_secret, access_token, niche, target_language, uninstalled_at"
    )
    .eq("user_id", userId)
    .in("id", [config.source_store_id, targetStoreId]);

  const sourceStore = stores?.find((s) => s.id === config.source_store_id);
  const targetStore = stores?.find((s) => s.id === targetStoreId);
  if (!sourceStore || !targetStore) {
    throw new HealRouteError(
      "Vitrine ou loja checkout nao encontrada, ou nao pertence ao dono da rota.",
      404
    );
  }

  // Loja com o app removido nao tem token valido. Sem esta parada, o cron
  // horario ficaria tentando para sempre e enchendo o log de 401 -- que era o
  // comportamento antes de existir o webhook app/uninstalled.
  //
  // Agora fica gravado como "sem_app", com a espera do cron: antes o 409
  // saia sem deixar rastro e a tela nao dizia nada.
  const desinstalada = [sourceStore, targetStore].find(
    (l) => (l as { uninstalled_at?: string | null }).uninstalled_at
  );
  if (desinstalada) {
    await pararComLojaForaDoAr(
      admin,
      config,
      targetRow,
      "sem_app",
      desinstalada === sourceStore ? "vitrine" : "checkout",
      desinstalada.shop_domain
    );
  }

  const sourceCreds: ShopifyCredentials = {
    shopDomain: sourceStore.shop_domain,
    clientId: sourceStore.client_id,
    clientSecret: sourceStore.client_secret,
    accessToken: sourceStore.access_token,
  };
  const targetCreds: ShopifyCredentials = {
    shopDomain: targetStore.shop_domain,
    clientId: targetStore.client_id,
    clientSecret: targetStore.client_secret,
    accessToken: targetStore.access_token,
  };

  // Loja congelada/desinstalada nao tem conserto por aqui: seguir adiante so
  // gastaria chamadas de API para falhar no meio e sujar o log do cron toda
  // hora. Devolve o motivo para o painel mostrar o que o lojista precisa fazer.
  const lojas = await verificarParDaRota(sourceCreds, targetCreds);
  if (!lojas.ok) {
    // Pausada (402), sem app (401/credencial revogada) ou fechada: motivo
    // tipado e o cron espera 12 h. Erro generico (rede, Shopify fora) segue
    // como antes e o cron tenta na proxima hora.
    const lado: LadoDaRota = lojas.source?.ok === false ? "vitrine" : "checkout";
    const motivo = motivoDaSaude(lado === "vitrine" ? lojas.source?.motivo : lojas.target?.motivo);
    if (motivo) {
      await pararComLojaForaDoAr(
        admin,
        config,
        targetRow,
        motivo,
        lado,
        lado === "vitrine" ? sourceStore.shop_domain : targetStore.shop_domain
      );
    }
    const mensagem = lojas.mensagem || "Loja inalcancavel.";
    await gravarStatus(
      admin,
      config.id,
      config.settings as Record<string, unknown> | null,
      { at: new Date().toISOString(), ok: false, message: mensagem }
    );
    throw new HealRouteError(mensagem, 409);
  }

  const [
    {
      bySku: targetIndex,
      byOpcoes: targetPorOpcoes,
      byId: targetPorId,
      variantesPorProduto,
      completo: checkoutCompleto,
    },
    leituraDaVitrine,
  ] =
    await Promise.all([
      getAllTargetVariants(targetCreds),
      fetchPublicShopifyProducts(sourceStore.shop_domain, { limit: 5000 }).then(
        (r) => ({ products: r.products, erro: null as unknown }),
        (erro: unknown) => ({ products: [] as PublicShopifyProduct[], erro })
      ),
    ]);

  // Vitrine com senha: o products.json nao abre (ou vem vazio) e o conserto
  // morria calado -- caso Distrito Zapas, 208 de 208 variantes sem SKU porque
  // o carimbo nunca via a vitrine. A Admin API confirma antes de chamar de
  // senha: HTML no lugar do JSON tambem pode ser bloqueio do proxy.
  if (leituraDaVitrine.erro || leituraDaVitrine.products.length === 0) {
    const comSenha = await vitrineComSenha(sourceCreds);
    if (comSenha === true) {
      await pararComLojaForaDoAr(
        admin,
        config,
        targetRow,
        "vitrine_fechada",
        "vitrine",
        sourceStore.shop_domain
      );
    }
    if (leituraDaVitrine.erro) {
      const motivo =
        leituraDaVitrine.erro instanceof LojaComSenhaError
          ? "a vitrine não entregou a lista de produtos"
          : leituraDaVitrine.erro instanceof Error
            ? leituraDaVitrine.erro.message.slice(0, 160)
            : "erro desconhecido";
      const mensagem = `Não deu para ler os produtos da vitrine (${motivo}).`;
      // Gravado: antes este erro so ia para o log do cron e a tela seguia
      // mostrando a ultima passada boa.
      await gravarStatus(admin, config.id, config.settings as Record<string, unknown> | null, {
        at: new Date().toISOString(),
        ok: false,
        message: mensagem,
      });
      throw new HealRouteError(mensagem, 502);
    }
  }
  const sourceProducts = leituraDaVitrine.products;

  // O catalogo das duas lojas acabou de ser paginado inteiro aqui. Guardar a
  // contagem agora sai de graca; buscar depois, so para a tela de lojas
  // mostrar "482 produtos", custaria a mesma paginacao de novo.
  const agoraCatalogo = new Date().toISOString();
  const variantesVitrine = sourceProducts.reduce(
    (soma, produto) => soma + (produto.variants?.length || 0),
    0
  );
  // A gravacao da contagem e enfeite: se a migration 026 nao rodou, as
  // colunas nao existem e o update falha. Isso NAO pode derrubar o
  // auto-conserto, que e quem mantem a rota funcionando.
  const [contagemVitrine, contagemCheckout] = await Promise.all([
    admin
      .from("stores")
      .update({
        product_count: sourceProducts.length,
        variant_count: variantesVitrine,
        catalog_synced_at: agoraCatalogo,
      })
      .eq("id", sourceStore.id),
    admin
      .from("stores")
      .update({
        // Por id: conta toda variante, inclusive a sem SKU.
        variant_count: targetPorId.size,
        catalog_synced_at: agoraCatalogo,
      })
      .eq("id", targetStore.id),
  ]);
  for (const resultado of [contagemVitrine, contagemCheckout]) {
    if (resultado.error) {
      console.warn("[heal] nao gravei a contagem de catalogo:", resultado.error.message);
    }
  }

  // Toda variante da vitrine precisa de SKU unico antes de qualquer comparacao.
  // O loop abaixo ignora quem esta sem SKU, entao produto criado na mao ficava
  // invisivel para o conserto e fora da rota para sempre.
  //
  // SKU repetido: quem ja tem par no checkout fica com ele (ver
  // OpcoesCarimbo.mapeadas). O products.json vem do mais novo para o mais
  // antigo, e "quem aparece primeiro" dava o SKU da bolsa A para a copia B.
  const carimbo = await normalizarSkus(sourceCreds, sourceProducts, {
    mapeadas: Object.keys(oldMaps.variantMap as Record<string, unknown>),
  });
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      const final = carimbo.skuPorVariante.get(
        `gid://shopify/ProductVariant/${variant.id}`
      );
      // Sem SKU final = o carimbo nao conseguiu gravar. Se ela era a copia de
      // um SKU repetido, manter o SKU velho em memoria a casaria com a
      // variante do DONO no checkout. Fica fora desta passada.
      variant.sku = final || null;
    }
  }

  const correctSkuMap: Record<string, string> = {};
  const correctVariantMap: Record<string, string> = {};
  let fixedWrongCount = 0;

  function recordCorrect(
    sku: string,
    sourceVariantId: number,
    targetVariantId: string
  ) {
    correctSkuMap[sku] = targetVariantId;
    correctVariantMap[String(sourceVariantId)] = targetVariantId;
    correctVariantMap[`gid://shopify/ProductVariant/${sourceVariantId}`] =
      targetVariantId;
  }

  const oldSkuMap = oldMaps.skuMap as Record<string, string | number>;
  const oldVariantMap = oldMaps.variantMap as Record<string, string | number>;

  // Par de cada variante da vitrine no checkout, decidido em duas passadas.
  const parDaVariante = new Map<number, TargetVariantInfo>();
  // Variante do checkout que ja e par de alguem nesta passada.
  const reivindicadas = new Set<string>();
  const skusDaVitrine = new Set<string>();
  let variantesComSku = 0;
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      if (!variant.sku) continue;
      variantesComSku += 1;
      skusDaVitrine.add(variant.sku.trim().toLowerCase());
    }
  }

  // 1a passada: SKU igual nas duas lojas.
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      if (!variant.sku) continue;
      const key = variant.sku.trim().toLowerCase();
      const found = targetIndex.get(key);
      if (!found) continue;
      // Compara pelo id NUMERICO dos dois lados. O mapa antigo guarda uma
      // mistura de formatos (numero cru e gid://shopify/ProductVariant/N) —
      // comparar as strings cruas marcava toda entrada em gid como "errada"
      // e inflava o relatorio: numa rota real, 29 de 3147 entradas eram so
      // diferenca de formato, com o destino correto. O loader ja normaliza
      // na leitura (numericVariantId), entao formato nao afeta o cliente.
      const antes = numericId(oldSkuMap[variant.sku] as string | undefined);
      if (antes !== found.variantId) fixedWrongCount += 1;
      recordCorrect(variant.sku, variant.id, found.variantId);
      parDaVariante.set(variant.id, found);
      reivindicadas.add(found.variantId);
    }
  }

  // 2a passada: o SKU nao casou, mas o variant_map ja apontava para uma
  // variante que continua viva no checkout -- e por ela que o comprador ja
  // estava sendo roteado. Adota em vez de criar uma duplicata (ver
  // parPeloMapaAntigo).
  //
  // Da mais antiga (menor id) para a mais nova: quando duas variantes da
  // vitrine apontam no mapa para a mesma variante do checkout (copia de
  // produto), fica com ela a original -- a mesma regra do SKU repetido. Na
  // ordem do products.json (mais novo primeiro) a copia levava, e o par da
  // original saia do mapa.
  let adotadasPeloMapa = 0;
  const candidatasPeloMapa = sourceProducts
    .flatMap((product) => product.variants)
    .filter((variant) => variant.sku && !parDaVariante.has(variant.id))
    .sort((a, b) => Number(a.id) - Number(b.id));
  for (const variant of candidatasPeloMapa) {
    if (!variant.sku) continue;
    const alvo = parPeloMapaAntigo({
      varianteId: variant.id,
      mapaAntigo: oldVariantMap,
      checkoutPorId: targetPorId,
      reivindicadas,
      skusDaVitrine,
    });
    const info = alvo ? targetPorId.get(alvo) : undefined;
    if (!alvo || !info) continue;
    recordCorrect(variant.sku, variant.id, alvo);
    parDaVariante.set(variant.id, info);
    reivindicadas.add(alvo);
    adotadasPeloMapa += 1;
  }

  const missingByHandle = new Map<string, PublicShopifyProduct>();
  const missingVariantsByHandle = new Map<
    string,
    { variant: PublicShopifyProduct["variants"][number] }[]
  >();
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      if (!variant.sku || parDaVariante.has(variant.id)) continue;
      if (!missingByHandle.has(product.handle)) {
        missingByHandle.set(product.handle, product);
      }
      if (!missingVariantsByHandle.has(product.handle)) {
        missingVariantsByHandle.set(product.handle, []);
      }
      missingVariantsByHandle.get(product.handle)?.push({ variant });
    }
  }

  // Produto do checkout de cada produto que tem variante faltando: o da
  // variante IRMA ja casada (por SKU ou pelo mapa antigo). Nenhuma = novo.
  const produtoDoFaltante = new Map<string, TargetVariantInfo | null>();
  let produtosNovos = 0;
  for (const [handle, product] of missingByHandle) {
    const existente = produtoNoDestino(product.variants, (irma) =>
      parDaVariante.get(irma.id)
    );
    produtoDoFaltante.set(handle, existente);
    if (!existente) produtosNovos += 1;
  }

  // Trava: mapear e sempre; criar so com o par de lojas confirmado.
  const decisao = decidirCriacao({
    confirmado: input.criarFaltantes === true,
    rotaLigada: config.enabled !== false,
    destinoLigado: targetRow ? targetRow.enabled !== false : true,
    peso: targetRow ? Number(targetRow.weight ?? 1) : 1,
    variantesComPar: parDaVariante.size,
    variantesTotal: variantesComSku,
    produtosNovos,
  });
  const coveragePercent =
    variantesComSku > 0
      ? Math.floor((parDaVariante.size / variantesComSku) * 100)
      : 100;

  let extendedCount = 0;
  // Variante que ja existia no destino e so precisava entrar no mapa. Conta
  // separado de extendedCount: uma coisa e criar variante na loja de checkout,
  // outra e reconhecer a que ja estava la.
  let adotadasCount = adotadasPeloMapa;
  let createdProductCount = 0;
  let createdVariantCount = 0;
  const imageQueueItems: {
    productId: string;
    imageUrl: string;
    title: string;
  }[] = [];
  const warnings: string[] = [...carimbo.falhas.slice(0, 5)];
  // O que ficou sem criar por causa da trava.
  let pendingProductCount = 0;
  let pendingVariantCount = 0;

  // Produto do checkout que recebe variantes de MAIS DE UM produto da
  // vitrine: o comprador de um paga pelo outro (reclamacao "variante do
  // produto X indo para o Y"). E o rastro do conserto antigo, que decidia o
  // produto pelo prefixo "xc-" do SKU -- na NORAH OUTLET uma "Arque" juntou
  // 5 bolsas. O SKU continua igual, entao o mapa "confere"; so o agrupamento
  // mostra. Nao da para separar sozinho sem apagar produto na loja: avisa.
  const origensPorProduto = new Map<string, { titulo: string; handles: Set<string> }>();
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      const par = parDaVariante.get(variant.id);
      if (!par) continue;
      const grupo = origensPorProduto.get(par.productId) || {
        titulo: par.productTitle,
        handles: new Set<string>(),
      };
      grupo.handles.add(product.handle);
      origensPorProduto.set(par.productId, grupo);
    }
  }
  const misturados = [...origensPorProduto.values()].filter((g) => g.handles.size > 1);
  // O conserto nao acrescenta variante nem adota par num produto assim: a
  // variante nova de um produto da vitrine entraria com o titulo e a foto do
  // outro -- a reclamacao 3 se repetindo a cada cor nova, sem ninguem pedir.
  // Fica sem par (o comprador ve o erro de roteamento) ate o lojista separar.
  const produtosMisturados = new Set(
    [...origensPorProduto.entries()]
      .filter(([, grupo]) => grupo.handles.size > 1)
      .map(([productId]) => productId)
  );
  let bloqueadasPorMistura = 0;
  const handlesBloqueados: string[] = [];
  for (const grupo of misturados.slice(0, 3)) {
    warnings.push(
      `O produto "${grupo.titulo}" da loja de checkout recebe variantes de ${grupo.handles.size} produtos da vitrine (${[...grupo.handles].slice(0, 4).join(", ")}): o comprador de um paga pelo outro. Separe-os na loja de checkout.`
    );
  }

  for (const [handle, items] of missingVariantsByHandle) {
    const product = missingByHandle.get(handle);
    if (!product) continue;

    // Pela variante IRMA ja casada, nunca pelo prefixo do SKU (ver
    // produto-no-destino.ts: o "xc-" do carimbo casava todo produto com todo).
    const existingTarget: TargetVariantInfo | null =
      produtoDoFaltante.get(handle) ?? null;

    if (existingTarget && produtosMisturados.has(existingTarget.productId)) {
      bloqueadasPorMistura += items.length;
      handlesBloqueados.push(handle);
      continue;
    }

    if (existingTarget) {
      // Produto ja existe no destino: so faltam variantes.
      //
      // "Falta" aqui foi decidido por SKU, mas a Shopify recusa duplicata por
      // COMBINACAO DE OPCOES. Variante que existe no destino com as opcoes
      // certas e SKU diferente (ou sem SKU) caia nos dois lados: nunca casava
      // pelo SKU, sempre colidia nas opcoes. O conserto tentava cria-la de
      // hora em hora e falhava de hora em hora -- "The variant 'BLACK'
      // already exists" -- deixando a rota marcada como problematica para
      // sempre.
      //
      // Entao antes de criar, procuramos pela combinacao de opcoes. Se ja
      // existe, adotamos: mapeamos o SKU da vitrine para a variante que esta
      // la. Nao mexemos no SKU dela de proposito -- variante da loja de
      // checkout pode estar mapeada por outra rota, e reescrever SKU ali
      // quebraria aquela.
      const paraCriar: typeof items = [];
      for (const item of items) {
        const jaExiste = targetPorOpcoes.get(
          chaveDeOpcoes(existingTarget.productId, item.variant.optionValues)
        );
        if (jaExiste && reivindicadas.has(jaExiste.variantId)) {
          // A variante com estas opcoes ja e par de OUTRA variante da
          // vitrine: o produto do checkout mistura produtos diferentes (o
          // conserto do prefixo "xc-" deixou disso). Adotar mandaria dois
          // produtos para a mesma variante, e criar colide nas opcoes. Fica
          // sem par e o aviso pede a limpeza do produto.
          warnings.push(
            `${handle}: a variante ${item.variant.optionValues.join(" / ")} do checkout (${existingTarget.productTitle}) ja e par de outro produto da vitrine; separe os produtos na loja de checkout.`
          );
          continue;
        }
        if (jaExiste) {
          if (item.variant.sku) {
            recordCorrect(item.variant.sku, item.variant.id, jaExiste.variantId);
            reivindicadas.add(jaExiste.variantId);
            adotadasCount += 1;
          }
        } else {
          paraCriar.push(item);
        }
      }

      if (paraCriar.length === 0) continue;
      if (!decisao.estenderProdutos) {
        pendingVariantCount += paraCriar.length;
        continue;
      }

      // Teto da Shopify: 2048 variantes por produto. Passar dele falha o lote
      // inteiro; cria o que cabe e avisa do resto.
      const jaTem = variantesPorProduto.get(existingTarget.productId) ?? 0;
      const cabem = Math.max(0, MAX_VARIANTES_POR_PRODUTO - jaTem);
      if (paraCriar.length > cabem) {
        warnings.push(
          `${handle}: o produto do checkout (${existingTarget.productTitle}) chegou ao teto de ${MAX_VARIANTES_POR_PRODUTO} variantes da Shopify; ${paraCriar.length - cabem} ficaram sem par.`
        );
        paraCriar.splice(cabem);
        if (paraCriar.length === 0) continue;
      }

      try {
        const created = await addProductVariants(
          targetCreds,
          existingTarget.productId,
          existingTarget.options,
          paraCriar.map(({ variant }) => ({
            price: variant.price,
            sku: variant.sku || undefined,
            optionValues: variant.optionValues,
          }))
        );
        for (let i = 0; i < created.length; i++) {
          const sourceVariant = paraCriar[i]?.variant;
          if (sourceVariant?.sku) {
            recordCorrect(
              sourceVariant.sku,
              sourceVariant.id,
              numericId(created[i].id) as string
            );
          }
        }
        extendedCount += created.length;
        variantesPorProduto.set(existingTarget.productId, jaTem + created.length);
      } catch (error) {
        warnings.push(
          `${handle}: falha ao estender produto existente - ${
            error instanceof Error ? error.message : "erro desconhecido"
          }`
        );
      }
      continue;
    }

    if (!decisao.criarProdutos) {
      pendingProductCount += 1;
      pendingVariantCount += items.length;
      continue;
    }

    // Produto novo: neutraliza so o texto (barato) e usa a imagem original como
    // placeholder — a fila de imagens troca depois.
    try {
      let title = product.title;
      let descriptionHtml = product.descriptionHtml;
      let tags = product.tags;
      let seoTitle = product.title.slice(0, 70);
      let seoDescription = "";

      if (process.env.GEMINI_API_KEY) {
        try {
          const neutralized = await neutralizeProductForDestination({
            userId,
            title: product.title,
            descriptionHtml: product.descriptionHtml,
            tags: product.tags,
            seo: { title: product.title, description: "" },
            images: [],
            maxImages: 0,
            targetLanguage: targetStore.target_language || "pt-BR",
            genericizeText: true,
            storageClient: admin,
          });
          title = neutralized.title;
          descriptionHtml = neutralized.descriptionHtml;
          tags = neutralized.tags;
          seoTitle = neutralized.seo.title;
          seoDescription = neutralized.seo.description;
          await logAiUsage({
            userId,
            storeId: targetStore.id,
            action: "neutralize_text",
            costUsd: AI_COST.text,
            metadata: { handle, repair: true },
          });
        } catch (neutralizeError) {
          warnings.push(
            `${handle}: neutralizacao de texto falhou (${
              neutralizeError instanceof Error
                ? neutralizeError.message
                : "erro desconhecido"
            }), criando com titulo original.`
          );
        }
      }

      const baseInput = toShopifyCreateProductInput(product);
      const result = await createProduct(targetCreds, {
        ...baseInput,
        // O vendor da vitrine e o nome dela ou a marca: na loja de checkout
        // ele aparece na pagina e liga as duas lojas. Vai o nome atual da
        // loja de checkout (o do banco pode ser velho); sem ele, vai sem
        // vendor e a Shopify decide (no admin ela poe o nome da loja).
        vendor: lojas.target?.nome || null,
        title,
        descriptionHtml,
        tags,
        seo: { title: seoTitle, description: seoDescription },
        images: product.images.slice(0, 1),
        variants: product.variants.map((variant) => ({
          price: variant.price,
          compareAtPrice: variant.compareAtPrice || undefined,
          options: variant.optionValues,
          sku: variant.sku || undefined,
        })),
        publishToStorefront: true,
      });

      const syncedVariants = result.syncedProduct?.variants?.nodes || [];
      for (const variant of syncedVariants) {
        const sourceVariant = product.variants.find((v) =>
          v.optionValues.every(
            (value, index) => value === variant.selectedOptions?.[index]?.value
          )
        );
        if (sourceVariant?.sku) {
          recordCorrect(
            sourceVariant.sku,
            sourceVariant.id,
            numericId(variant.id) as string
          );
          createdVariantCount += 1;
        }
      }
      createdProductCount += 1;

      const heroUrl = product.images[0]?.src;
      const createdProductId = result.syncedProduct?.id;
      if (heroUrl && createdProductId) {
        imageQueueItems.push({
          productId: createdProductId,
          imageUrl: heroUrl,
          title,
        });
      }
    } catch (error) {
      warnings.push(
        `${handle}: falha ao criar produto - ${
          error instanceof Error ? error.message : "erro desconhecido"
        }`
      );
    }
  }

  let imageQueueCount = 0;
  if (input.neutralizeImages !== false && imageQueueItems.length > 0) {
    const { queued } = await enqueueImageNeutralizeJobs({
      userId,
      storeId: targetStore.id,
      items: imageQueueItems.map((item) => ({
        productId: item.productId,
        imageUrl: item.imageUrl,
        title: item.title,
        mode: "stock-neutralize",
        targetLanguage: targetStore.target_language || "pt-BR",
      })),
    });
    imageQueueCount = queued;
    if (input.origin) {
      await requestImageQueueDrain({
        origin: input.origin,
        cookie: input.cookie || "",
        storeId: targetStore.id,
      });
    }
  }

  if (bloqueadasPorMistura > 0) {
    warnings.push(
      `${bloqueadasPorMistura === 1 ? "1 variante" : `${bloqueadasPorMistura} variantes`} de ${handlesBloqueados.slice(0, 4).join(", ")} ${bloqueadasPorMistura === 1 ? "ficou" : "ficaram"} sem par: o produto da loja de checkout onde ${bloqueadasPorMistura === 1 ? "ela entraria" : "elas entrariam"} mistura produtos da vitrine, e o xcart não acrescenta nada nele até ser separado.`
    );
  }

  const nomeDaLoja =
    (targetStore as { name?: string | null }).name || targetStore.shop_domain;
  const creationBlockedReason =
    pendingVariantCount > 0 ? decisao.motivo : null;
  if (creationBlockedReason) {
    // Primeiro aviso: e ele que o card da rota mostra.
    warnings.unshift(
      mensagemDeCriacaoPendente(
        pendingProductCount,
        pendingVariantCount,
        creationBlockedReason,
        nomeDaLoja
      )
    );
  }

  // O mapa antigo entra podado: par com alvo apagado no checkout, ou com
  // alvo que e de outra variante, sai (ver podarMapas). So acrescentar
  // deixava o comprador indo para /cart/<id morto> ou para o produto errado
  // sempre que a trava segurava a criacao.
  const variantesSemPar = sourceProducts.flatMap((product) =>
    product.variants
      .filter((variant) => !(String(variant.id) in correctVariantMap))
      .map((variant) => ({ id: variant.id, sku: variant.sku }))
  );
  const mapaFinal = podarMapas({
    skuMap: oldSkuMap,
    variantMap: oldVariantMap,
    novos: { skuMap: correctSkuMap, variantMap: correctVariantMap },
    semPar: variantesSemPar,
    checkoutPorId: targetPorId,
    checkoutCompleto,
    reivindicadas,
    skusDaVitrine,
  });
  const finalSkuMap = mapaFinal.skuMap;
  const finalVariantMap = mapaFinal.variantMap;
  const removedPairCount = mapaFinal.removidos;

  // Os pares que ja existiam no checkout, conferidos sem mexer: preco
  // diferente da vitrine (o lojista pode ter mudado de proposito, entao nao
  // sincroniza) e variante que o checkout nao vende. Variante criada nesta
  // passada nao esta no indice e fica de fora -- nasceu com o preco da vitrine.
  const paresParaConferir: ParParaConferir[] = [];
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      const alvo = correctVariantMap[String(variant.id)];
      const info = alvo ? targetPorId.get(alvo) : undefined;
      if (!info || !variant.sku) continue;
      paresParaConferir.push({
        produto: product.title,
        variante: variant.optionValues.filter(Boolean).join(" / ") || variant.title,
        sku: variant.sku,
        precoVitrine: variant.price,
        checkout: {
          produto: info.productTitle,
          preco: info.price,
          status: info.productStatus,
          naLojaVirtual: info.naLojaVirtual,
          disponivel: info.disponivel,
        },
      });
    }
  }
  const conferencia = conferirPares(paresParaConferir, {
    vitrine: lojas.source?.moeda,
    checkout: lojas.target?.moeda,
  });

  const agora = new Date().toISOString();
  const statusDoConserto: UltimoConserto = {
    at: agora,
    // Aviso aqui e problema que o conserto NAO resolveu sozinho
    // (produto que falhou ao criar, SKU que nao gravou).
    ok: warnings.length === 0,
    message: warnings[0],
    mappedCount: Object.keys(finalSkuMap).length,
  };

  // O mapa corrigido pertence ao DESTINO: e ele que o resolve le.
  if (targetRow) {
    const { error: targetError } = await admin
      .from("routed_checkout_targets")
      .update({
        sku_map: finalSkuMap,
        variant_map: finalVariantMap,
        last_healed_at: agora,
        // O estado DESTA loja de checkout (o da rota e da ultima passada de
        // qualquer uma). Sobrescreve o "fora do ar" de antes: a loja voltou.
        settings: {
          ...((targetRow.settings as Record<string, unknown> | null) || {}),
          last_heal: { ...statusDoConserto, conferencia } satisfies UltimoConsertoDoDestino,
        },
      })
      .eq("id", targetRow.id);
    if (targetError) {
      throw new HealRouteError("Falha ao salvar a loja de checkout corrigida.");
    }
  }

  // As colunas da rota so acompanham quando o destino consertado E o primario.
  // Sobrescrever com o mapa de um destino secundario faria o campo legado
  // apontar para variantes de outra loja -- justamente o que quebraria quem
  // ainda le dali (tema com loader antigo, rota sem linha de destino).
  const ehPrimario = !targetRow || targetRow.target_store_id === config.target_store_id;

  const { error: updateError } = await admin
    .from("routed_checkout_configs")
    .update({
      ...(ehPrimario
        ? { sku_map: finalSkuMap, variant_map: finalVariantMap }
        : {}),
      last_healed_at: agora,
      updated_at: agora,
      settings: {
        ...((config.settings as Record<string, unknown>) || {}),
        // Rota antiga sem linha de destino: a conferencia so tem onde morar
        // aqui (a tela le dali para o destino legado).
        last_heal: targetRow ? statusDoConserto : { ...statusDoConserto, conferencia },
      },
    })
    .eq("id", config.id);

  if (updateError) {
    throw new HealRouteError("Falha ao salvar a rota corrigida.");
  }

  const mudou =
    carimbo.carimbadas > 0 ||
    carimbo.desduplicadas > 0 ||
    fixedWrongCount > 0 ||
    extendedCount > 0 ||
    adotadasCount > 0 ||
    removedPairCount > 0 ||
    createdProductCount > 0;

  // O mapa mudou no banco; o tema da vitrine guarda uma copia dele
  // (xcart-config.json) que o loader le ANTES da API. Sem reenviar, o que o
  // conserto tirou ou trocou continuava valendo no caminho inline. Compara
  // pelo conteudo, entao chamar sem mudanca nao escreve nada no tema.
  const theme = await sincronizarTemaDaRota(admin, config.id);

  return {
    ok: true,
    routeId: config.id,
    targetId: targetRow?.id ?? null,
    targetStoreName: (targetStore as { name?: string | null }).name ?? null,
    targetShopDomain: targetStore.shop_domain,
    stampedSkuCount: carimbo.carimbadas,
    dedupedSkuCount: carimbo.desduplicadas,
    fixedWrongCount,
    extendedCount,
    adoptedVariantCount: adotadasCount,
    removedPairCount,
    mixedBlockedVariantCount: bloqueadasPorMistura,
    createdProductCount,
    createdVariantCount,
    imageQueueCount,
    finalMappedCount: Object.keys(finalSkuMap).length,
    coveragePercent,
    pendingProductCount,
    pendingVariantCount,
    creationBlockedReason,
    theme,
    conferencia,
    warnings,
    noop: !mudou && !creationBlockedReason,
  };
}


/**
 * Descobre qual destino esta rota vai consertar.
 *
 * Repete a selecao de executarConserto de proposito: a reserva precisa
 * acontecer ANTES de qualquer trabalho, e o id do destino e a chave dela.
 * Sao duas leituras baratas contra a chance de criar produto duplicado.
 */
async function idDoDestino(
  admin: ReturnType<typeof createAdminClient>,
  input: HealRouteInput
): Promise<string | null> {
  let q = admin
    .from("routed_checkout_targets")
    .select("id")
    .eq("route_id", input.routeId);
  if (input.targetId) q = q.eq("id", input.targetId);
  else q = q.eq("enabled", true);

  const { data, error } = await q
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  // Erro do banco nao pode virar "sem destino": o caminho sem destino cai nas
  // colunas da rota (o destino legado).
  if (error) {
    throw new HealRouteError("Falha ao ler as lojas de checkout da rota.", 503);
  }
  return data?.[0]?.id ?? null;
}

/**
 * Conserta uma rota, com o destino reservado durante todo o trabalho.
 *
 * A reserva existe porque healRoute cria produtos e depois grava o sku_map
 * inteiro. Duas execucoes ao mesmo tempo no mesmo destino criavam produto
 * duplicado na loja de checkout e uma apagava o mapa da outra. Ver a
 * migration 034 para a cronologia completa.
 */
export async function healRoute(
  input: HealRouteInput
): Promise<HealRouteResult> {
  const admin = createAdminClient();
  const targetId = await idDoDestino(admin, input);

  if (!targetId) {
    // Rota com destinos, todos pausados: nao ha loja de checkout a consertar.
    // Cair nas colunas da rota (o destino legado) consertaria -- e criaria
    // produto -- justamente na loja que o lojista pausou.
    const { count, error } = await admin
      .from("routed_checkout_targets")
      .select("id", { count: "exact", head: true })
      .eq("route_id", input.routeId);
    if (error || count === null || count === undefined) {
      throw new HealRouteError("Falha ao ler as lojas de checkout da rota.", 503);
    }
    if (count > 0) {
      throw new HealRouteError(
        "Nenhuma loja de checkout ligada nesta rota. Retome uma loja para consertar.",
        409
      );
    }
    // Rota legada sem linha de destino: nao ha o que reservar, e tambem nao
    // ha criacao de produto concorrente para proteger.
    return executarConserto(input);
  }

  if (!(await reservarDestino(admin, targetId))) {
    throw new HealBusyError();
  }
  try {
    return await executarConserto({ ...input, targetId });
  } finally {
    await liberarDestino(admin, targetId);
  }
}
