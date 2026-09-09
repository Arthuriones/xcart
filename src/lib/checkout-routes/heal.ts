import {
  addProductVariants,
  createProduct,
  getProducts,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import {
  fetchPublicShopifyProducts,
  toShopifyCreateProductInput,
  type PublicShopifyProduct,
} from "@/lib/shopify/public-store";
import { normalizarSkus } from "@/lib/shopify/sku-stamp";
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
}

async function getAllTargetVariants(creds: ShopifyCredentials) {
  const bySku = new Map<string, TargetVariantInfo>();
  let after: string | null = null;
  for (let page = 0; page < 60; page += 1) {
    const data = await getProducts(creds, { first: 250, after });
    const nodes = data?.products?.nodes || [];
    for (const product of nodes) {
      const options = (product.options || []).map(
        (option: { name: string }) => option.name
      );
      for (const variant of product.variants?.nodes || []) {
        if (!variant.sku) continue;
        const key = variant.sku.trim().toLowerCase();
        if (!bySku.has(key)) {
          bySku.set(key, {
            variantId: numericId(variant.id) as string,
            productId: product.id,
            productTitle: product.title,
            options,
          });
        }
      }
    }
    const pageInfo = data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
    after = pageInfo.endCursor;
  }
  return bySku;
}

export interface HealRouteResult {
  /** Destino consertado. null = rota legada, sem linha de destino. */
  targetId?: string | null;
  ok: true;
  routeId: string;
  stampedSkuCount: number;
  dedupedSkuCount: number;
  fixedWrongCount: number;
  extendedCount: number;
  createdProductCount: number;
  createdVariantCount: number;
  imageQueueCount: number;
  finalMappedCount: number;
  warnings: string[];
  /** true quando nada precisou mudar — o cron usa para nao poluir o log. */
  noop: boolean;
}

export class HealRouteError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
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

export async function healRoute(
  input: HealRouteInput
): Promise<HealRouteResult> {
  const admin = createAdminClient();

  let query = admin
    .from("routed_checkout_configs")
    .select(
      "id, user_id, name, sku_map, variant_map, settings, source_store_id, target_store_id"
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
    .select("id, target_store_id, sku_map, variant_map")
    .eq("route_id", config.id);
  if (input.targetId) targetQuery = targetQuery.eq("id", input.targetId);
  else targetQuery = targetQuery.eq("enabled", true);

  const { data: targetRows } = await targetQuery
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

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
      "id, shop_domain, client_id, client_secret, access_token, niche, target_language, uninstalled_at"
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
  const desinstalada = [sourceStore, targetStore].find(
    (l) => (l as { uninstalled_at?: string | null }).uninstalled_at
  );
  if (desinstalada) {
    throw new HealRouteError(
      `O app foi removido de ${desinstalada.shop_domain}. Reinstale para voltar a rotear.`,
      409
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
    const mensagem = lojas.mensagem || "Loja inalcancavel.";
    await gravarStatus(
      admin,
      config.id,
      config.settings as Record<string, unknown> | null,
      { at: new Date().toISOString(), ok: false, message: mensagem }
    );
    throw new HealRouteError(mensagem, 409);
  }

  const [targetIndex, { products: sourceProducts }] = await Promise.all([
    getAllTargetVariants(targetCreds),
    fetchPublicShopifyProducts(sourceStore.shop_domain, { limit: 5000 }),
  ]);

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
        // targetIndex e indexado por SKU: conta variante, nao produto.
        variant_count: targetIndex.size,
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
  const carimbo = await normalizarSkus(sourceCreds, sourceProducts);
  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      const final = carimbo.skuPorVariante.get(
        `gid://shopify/ProductVariant/${variant.id}`
      );
      if (final) variant.sku = final;
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
  const missingByHandle = new Map<string, PublicShopifyProduct>();
  const missingVariantsByHandle = new Map<
    string,
    { variant: PublicShopifyProduct["variants"][number] }[]
  >();

  for (const product of sourceProducts) {
    for (const variant of product.variants) {
      if (!variant.sku) continue;
      const key = variant.sku.trim().toLowerCase();
      const found = targetIndex.get(key);
      if (found) {
        // Compara pelo id NUMERICO dos dois lados. O mapa antigo guarda uma
        // mistura de formatos (numero cru e gid://shopify/ProductVariant/N) —
        // comparar as strings cruas marcava toda entrada em gid como "errada"
        // e inflava o relatorio: numa rota real, 29 de 3147 entradas eram so
        // diferenca de formato, com o destino correto. O loader ja normaliza
        // na leitura (numericVariantId), entao formato nao afeta o cliente.
        const antes = numericId(oldSkuMap[variant.sku] as string | undefined);
        if (antes !== found.variantId) fixedWrongCount += 1;
        recordCorrect(variant.sku, variant.id, found.variantId);
      } else {
        if (!missingByHandle.has(product.handle)) {
          missingByHandle.set(product.handle, product);
        }
        if (!missingVariantsByHandle.has(product.handle)) {
          missingVariantsByHandle.set(product.handle, []);
        }
        missingVariantsByHandle.get(product.handle)?.push({ variant });
      }
    }
  }

  let extendedCount = 0;
  let createdProductCount = 0;
  let createdVariantCount = 0;
  const imageQueueItems: {
    productId: string;
    imageUrl: string;
    title: string;
  }[] = [];
  const warnings: string[] = [...carimbo.falhas.slice(0, 5)];

  for (const [handle, items] of missingVariantsByHandle) {
    const product = missingByHandle.get(handle);
    if (!product) continue;

    const prefix = product.variants[0]?.sku?.split("-")[0] || "";
    let existingTarget: TargetVariantInfo | null = null;
    for (const sku of Object.keys(correctSkuMap)) {
      if (sku.split("-")[0] === prefix) {
        const info = targetIndex.get(sku.toLowerCase());
        if (info) {
          existingTarget = info;
          break;
        }
      }
    }

    if (existingTarget) {
      // Produto ja existe no destino: so faltam variantes.
      try {
        const created = await addProductVariants(
          targetCreds,
          existingTarget.productId,
          existingTarget.options,
          items.map(({ variant }) => ({
            price: variant.price,
            sku: variant.sku || undefined,
            optionValues: variant.optionValues,
          }))
        );
        for (let i = 0; i < created.length; i++) {
          const sourceVariant = items[i]?.variant;
          if (sourceVariant?.sku) {
            recordCorrect(
              sourceVariant.sku,
              sourceVariant.id,
              numericId(created[i].id) as string
            );
          }
        }
        extendedCount += created.length;
      } catch (error) {
        warnings.push(
          `${handle}: falha ao estender produto existente - ${
            error instanceof Error ? error.message : "erro desconhecido"
          }`
        );
      }
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

  const finalSkuMap = { ...oldSkuMap, ...correctSkuMap };
  const finalVariantMap = {
    ...(oldMaps.variantMap as Record<string, string | number>),
    ...correctVariantMap,
  };

  const agora = new Date().toISOString();

  // O mapa corrigido pertence ao DESTINO: e ele que o resolve le.
  if (targetRow) {
    const { error: targetError } = await admin
      .from("routed_checkout_targets")
      .update({
        sku_map: finalSkuMap,
        variant_map: finalVariantMap,
        last_healed_at: agora,
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
        last_heal: {
          at: agora,
          // Aviso aqui e problema que o conserto NAO resolveu sozinho
          // (produto que falhou ao criar, SKU que nao gravou).
          ok: warnings.length === 0,
          message: warnings[0],
          mappedCount: Object.keys(finalSkuMap).length,
        } satisfies UltimoConserto,
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
    createdProductCount > 0;

  return {
    ok: true,
    routeId: config.id,
    targetId: targetRow?.id ?? null,
    stampedSkuCount: carimbo.carimbadas,
    dedupedSkuCount: carimbo.desduplicadas,
    fixedWrongCount,
    extendedCount,
    createdProductCount,
    createdVariantCount,
    imageQueueCount,
    finalMappedCount: Object.keys(finalSkuMap).length,
    warnings,
    noop: !mudou,
  };
}
