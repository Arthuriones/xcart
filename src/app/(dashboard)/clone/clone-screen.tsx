"use client";

import dynamic from "next/dynamic";

import { textos } from "@/lib/textos";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Copy, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  CLONE_BATCH_SIZE,
  DEFAULT_CLONE_LIMIT,
  cloneSourceKey,
  isAbortError,
  parseAiMediaLimit,
  parseCloneLimit,
  parseInventoryQuantity,
  previewPrice,
} from "./clone-shared";

// Mil linhas que so aparecem depois de abrir o assistente: sob demanda, elas
// saem do primeiro download da tela.
const ImportWizard = dynamic(
  () => import("./import-wizard").then((m) => m.ImportWizard),
  { ssr: false }
);
import type {
  CloneApplyProgress,
  CloneView,
  ImportMode,
  InventoryMode,
  PreviewProduct,
  PreviewSort,
  SourceCollection,
  StoreOption,
  TransformedPreviewProduct,
} from "./clone-shared";



function ServiceOverview() {
  const t = textos("clone_page");
  const services = [
    {
      href: "/clone/shopify",
      icon: Copy,
      title: t("service_clone_title"),
      description: t("service_clone_desc"),
      bullets: ["Origem pública", "Prévia antes de gravar", "Aplicação em loja conectada"],
    },
    {
      href: "/clone/routed-checkout",
      icon: GitBranch,
      title: t("service_showcase_title"),
      description: t("service_showcase_desc"),
      bullets: ["SKU map", "Variant map", "Script no tema"],
    },
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {services.map((service) => (
        <Link
          key={service.href}
          href={service.href}
          className="group rounded-lg border border-border/60 bg-card p-4 transition-colors hover:border-primary/45 hover:bg-card/80"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <service.icon className="h-4 w-4" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            {service.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {service.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {service.bullets.map((bullet) => (
              <Badge key={bullet} variant="outline" className="rounded-md">
                {bullet}
              </Badge>
            ))}
          </div>
        </Link>
      ))}
    </section>
  );
}

export function CloneScreen({
  initialStores,
}: {
  initialStores: { id: string; name: string; shop_domain: string }[];
}) {
  const t = textos("clone_page");
  const pathname = usePathname();
  const stores: StoreOption[] = initialStores;
  // As lojas vêm prontas do servidor; não há carregamento pendente.
  const [source, setSource] = useState("");
  const [limit, setLimit] = useState(String(DEFAULT_CLONE_LIMIT));
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("not_tracked");
  const [inventoryQuantity, setInventoryQuantity] = useState("100");
  const [targetStoreId, setTargetStoreId] = useState(initialStores[0]?.id ?? "");
  // A loja de origem da rota preparada e sempre a primeira conectada.
  const sourceStoreId = initialStores[0]?.id ?? "";
  const [publishToStorefront, setPublishToStorefront] = useState(true);
  const [translateCloneProducts, setTranslateCloneProducts] = useState(false);
  const [translateVariantOptions, setTranslateVariantOptions] = useState(false);
  // Desligado por padrao: o import em massa serve para CLONAR replicas (ex.:
  // montar uma nova vitrine identica a outra). A neutralizacao da loja checkout
  // acontece no fluxo de "Criar destino", nao aqui.
  const [neutralizeCloneProducts, setNeutralizeCloneProducts] = useState(false);
  const [
    removeExternalReferencesCloneProducts,
    setRemoveExternalReferencesCloneProducts,
  ] = useState(false);
  const [cloneAiMediaLimit, setCloneAiMediaLimit] = useState("1");
  const [cloneGenericizeText, setCloneGenericizeText] = useState(true);
  const [cloneNeutralizationInstructions, setCloneNeutralizationInstructions] =
    useState("");
  const [cloneCustomPrompt, setCloneCustomPrompt] = useState("");
  const [applyLogoToCloneImages, setApplyLogoToCloneImages] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState("skip");
  const [createRoutingConfig, setCreateRoutingConfig] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [transformPreviewLoading, setTransformPreviewLoading] = useState(false);
  const [transformedPreview, setTransformedPreview] =
    useState<TransformedPreviewProduct | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewProduct[]>([]);
  const [sourceDomain, setSourceDomain] = useState("");
  const [previewKey, setPreviewKey] = useState("");
  const [applyProgress, setApplyProgress] = useState<CloneApplyProgress | null>(null);
  // Detalhe das falhas do ultimo import, para o usuario saber o que deu errado.
  const [cloneFailures, setCloneFailures] = useState<
    { handle: string; error: string }[]
  >([]);
  const [importMode, setImportMode] = useState<ImportMode>("bulk");
  const [sourceCollections, setSourceCollections] = useState<SourceCollection[]>([]);
  const [selectedProductHandles, setSelectedProductHandles] = useState<string[]>([]);
  // Filtros/ordenacao da lista de preview. Sao aplicados no cliente: o preview
  // ja traz collectionHandles por produto, entao da para filtrar por categoria
  // sem nenhuma chamada extra a origem.
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewSort, setPreviewSort] = useState<PreviewSort>("source");
  const [previewCollections, setPreviewCollections] = useState<string[]>([]);



  const [importStep, setImportStep] = useState(1);
  const [importScope, setImportScope] = useState<"all" | "collection">("all");
  const [selectedSourceCollection, setSelectedSourceCollection] =
    useState<SourceCollection | null>(null);
  const [sourceCollectionOptions, setSourceCollectionOptions] = useState<
    SourceCollection[]
  >([]);
  const [loadingSourceCollections, setLoadingSourceCollections] = useState(false);

  const cloneAbortRef = useRef<AbortController | null>(null);

  const activeView: CloneView =
    pathname === "/clone/shopify" || pathname.startsWith("/clone/shopify/")
      ? "shopify"
      : "overview";

  const routedImportMode: ImportMode | null = pathname.endsWith("/individual")
    ? "single"
    : pathname.endsWith("/bulk")
      ? "bulk"
      : null;
  const isCloneConfigSubpage = pathname.endsWith("/configuracao");
  const isImportSubpage = Boolean(routedImportMode);

  const selectedTarget = useMemo(
    () => stores.find((store) => store.id === targetStoreId),
    [stores, targetStoreId]
  );

  // Categorias presentes nos produtos carregados (para os filtros por coleção).
  // Sai do proprio preview, entao cobre tambem lojas cuja listagem publica de
  // colecoes falha mas cujos produtos trazem collectionHandles.
  const previewCollectionOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of preview) {
      for (const handle of product.collectionHandles || []) {
        counts.set(handle, (counts.get(handle) || 0) + 1);
      }
    }
    const titleByHandle = new Map(
      sourceCollections.map((collection) => [collection.handle, collection.title])
    );
    return [...counts.entries()]
      .map(([handle, count]) => ({
        handle,
        title: titleByHandle.get(handle) || handle,
        count,
      }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }, [preview, sourceCollections]);

  // Lista efetivamente exibida: busca + filtro de categoria + ordenação.
  // Digitar nao pode travar o campo. O termo entra na filtragem com atraso:
  // o input responde a cada tecla, a lista alcanca depois.
  const termoBusca = useDeferredValue(previewSearch);

  // Indice de busca montado uma vez por catalogo lido. Antes o texto de cada
  // produto era remontado e passado para minusculas a CADA tecla -- num
  // catalogo de mil produtos sao mil concatenacoes por caractere digitado.
  const indiceBusca = useMemo(
    () =>
      preview.map((produto) => ({
        produto,
        texto: [
          produto.title,
          produto.handle,
          ...(produto.variants || []).map((variante) => variante.sku || ""),
        ]
          .join(" ")
          .toLowerCase(),
      })),
    [preview]
  );

  const visiblePreview = useMemo(() => {
    const termo = termoBusca.trim().toLowerCase();
    // Set em vez de array: o teste de categoria roda uma vez por produto por
    // categoria marcada, e includes percorre a lista inteira em cada um.
    const categorias =
      previewCollections.length > 0 ? new Set(previewCollections) : null;

    // Categoria e texto na mesma passada, em vez de dois filter seguidos.
    const list: PreviewProduct[] = [];
    for (const item of indiceBusca) {
      if (
        categorias &&
        !(item.produto.collectionHandles || []).some((handle) => categorias.has(handle))
      ) {
        continue;
      }
      if (termo && !item.texto.includes(termo)) continue;
      list.push(item.produto);
    }

    if (previewSort === "source") return list;
    // toSorted mantem a lista de cima intacta sem a copia manual.
    return list.toSorted((a, b) => {
      switch (previewSort) {
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "title_desc":
          return b.title.localeCompare(a.title);
        case "price_asc":
          return previewPrice(a) - previewPrice(b);
        case "price_desc":
          return previewPrice(b) - previewPrice(a);
        case "recent":
          return (b.id || 0) - (a.id || 0);
        default:
          return 0;
      }
    });
  }, [indiceBusca, termoBusca, previewCollections, previewSort]);


  useEffect(() => {
    if (!routedImportMode) return;
    setImportMode(routedImportMode);
  }, [routedImportMode]);

  useEffect(() => {
    if (!isCloneConfigSubpage) return;
    setImportMode("bulk");
  }, [isCloneConfigSubpage]);

  function openInlineImport(mode: ImportMode) {
    setImportMode(mode);
  }

  async function loadSourceCollectionOptions() {
    if (!source.trim()) {
      toast.error("Informe a loja de origem primeiro.");
      return;
    }
    setLoadingSourceCollections(true);
    try {
      const res = await fetch(
        `/api/shopify/collections?source=${encodeURIComponent(source.trim())}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao ler coleções.");
      const loaded = (data.collections || []) as SourceCollection[];
      setSourceCollectionOptions(loaded);
      if (loaded.length === 0) {
        toast("Nenhuma coleção pública encontrada nessa loja.");
      } else {
        toast.success(`${loaded.length} coleção(ões) encontrada(s).`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao ler coleções."
      );
    } finally {
      setLoadingSourceCollections(false);
    }
  }

  // Sub-rotas /individual, /bulk, /configuracao abrem o assistente no
  // primeiro passo. O modo vem da propria rota; /configuracao e sempre massa.
  useEffect(() => {
    if (isImportSubpage) {
      setImportStep(1);
    } else if (isCloneConfigSubpage) {
      setImportMode("bulk");
      setImportStep(1);
    }
  }, [isImportSubpage, isCloneConfigSubpage]);




  async function runClone(
    action: "preview" | "export-json" | "export-csv" | "apply",
    signal?: AbortSignal,
    overrides?: Record<string, unknown>
  ) {
    const payload = {
      source,
      action,
      importMode,
      sourceStoreId,
      targetStoreId,
      limit: parseCloneLimit(limit),
      inventoryMode,
      inventoryQuantity: parseInventoryQuantity(inventoryQuantity),
      publishToStorefront,
      translateProducts: translateCloneProducts,
      translateVariantOptions,
      neutralizeProducts: neutralizeCloneProducts,
      removeExternalReferences: removeExternalReferencesCloneProducts,
      // Imagem sempre em background: gerar inline durante o import em massa
      // estoura o timeout e a maioria das imagens falha. A fila se auto-encadeia
      // ate terminar, independente da janela ficar aberta.
      imageNeutralizeMode: "queue",
      aiMediaLimit: parseAiMediaLimit(cloneAiMediaLimit),
      genericizeText: cloneGenericizeText,
      neutralizationInstructions: cloneNeutralizationInstructions,
      customPrompt: cloneCustomPrompt,
      applyLogoToImages: applyLogoToCloneImages,
      duplicatePolicy,
      createRoutingConfig,
      collectionHandle:
        importScope === "collection" ? selectedSourceCollection?.handle : undefined,
      ...overrides,
    };

    const res = await fetch("/api/shopify/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (action === "export-csv") {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao exportar CSV.");
      }
      return { blob: await res.blob() };
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha no clone.");
    return data;
  }

  async function handlePreview() {
    if (!source.trim()) {
      toast.error("Informe a loja de origem.");
      return;
    }

    setPreviewLoading(true);
    setTransformedPreview(null);
    const controller = new AbortController();
    cloneAbortRef.current = controller;
    try {
      const data = await runClone("preview", controller.signal);
      const loadedProducts = (data.products || []) as PreviewProduct[];
      setPreview(loadedProducts);
      setSourceDomain(data.sourceDomain || "");
      setSourceCollections((data.collections || []) as SourceCollection[]);
      setSelectedProductHandles(loadedProducts.map((product) => product.handle));
      setPreviewKey(cloneSourceKey(source, parseCloneLimit(limit)));
      toast.success(`${data.count || 0} produtos encontrados.`);
    } catch (error) {
      if (isAbortError(error)) {
        toast("Operacao cancelada.");
      } else {
        toast.error(error instanceof Error ? error.message : "Falha ao analisar loja.");
      }
    } finally {
      if (cloneAbortRef.current === controller) cloneAbortRef.current = null;
      setPreviewLoading(false);
    }
  }

  async function handleTransformPreview() {
    if (!source.trim()) {
      toast.error("Informe a loja de origem.");
      return;
    }
    if (!targetStoreId) {
      toast.error("Selecione a loja de destino para visualizar.");
      return;
    }

    setTransformPreviewLoading(true);
    const controller = new AbortController();
    cloneAbortRef.current = controller;
    try {
      const selectedHandle =
        importMode === "bulk" && selectedProductHandles.length > 0
          ? selectedProductHandles[0]
          : undefined;
      const data = await runClone("preview", controller.signal, {
        transformPreview: true,
        recordRun: false,
        limit: 1,
        pageSize: 1,
        ...(selectedHandle ? { productHandles: [selectedHandle] } : {}),
      });
      const loadedProducts = (data.products || []) as PreviewProduct[];
      if (loadedProducts.length > 0) {
        setPreview((current) => (current.length > 0 ? current : loadedProducts));
        setSelectedProductHandles((current) =>
          current.length > 0
            ? current
            : loadedProducts.map((product) => product.handle)
        );
      }
      setSourceDomain(data.sourceDomain || "");
      setSourceCollections((data.collections || []) as SourceCollection[]);
      setTransformedPreview(
        (data.transformedPreview || null) as TransformedPreviewProduct | null
      );
      toast.success("Previa transformada gerada.");
    } catch (error) {
      if (isAbortError(error)) {
        toast("Operacao cancelada.");
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : "Falha ao gerar previa transformada."
        );
      }
    } finally {
      if (cloneAbortRef.current === controller) cloneAbortRef.current = null;
      setTransformPreviewLoading(false);
    }
  }


  async function handleApply() {
    if (!source.trim() || !targetStoreId) {
      toast.error("Informe origem e destino.");
      return;
    }

    setApplyLoading(true);
    setCloneFailures([]);
    setApplyProgress({
      phase: "analyzing",
      current: 0,
      total: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      message: "Lendo produtos da origem antes de importar...",
    });
    const controller = new AbortController();
    cloneAbortRef.current = controller;
    try {
      const requestedLimit = parseCloneLimit(limit);
      const currentPreviewKey = cloneSourceKey(source, requestedLimit);
      let total =
        importMode === "single"
          ? 1
          : previewKey === currentPreviewKey
            ? preview.length
            : 0;
      let resolvedSourceDomain = sourceDomain;
      let previewForRun = previewKey === currentPreviewKey ? preview : [];
      let sourceCollectionsForRun = sourceCollections;
      let selectedHandlesForRun =
        importMode === "bulk" && previewKey === currentPreviewKey
          ? selectedProductHandles
          : [];

      if (
        (importMode === "bulk" && total === 0) ||
        (importMode === "single" && previewKey !== currentPreviewKey)
      ) {
        const previewData = await runClone("preview", controller.signal, {
          limit: requestedLimit,
          recordRun: false,
        });
        const loadedProducts = previewData.products || [];
        total = importMode === "single" ? 1 : loadedProducts.length;
        resolvedSourceDomain = previewData.sourceDomain || "";
        previewForRun = loadedProducts;
        sourceCollectionsForRun = (previewData.collections || []) as SourceCollection[];
        setPreview(loadedProducts);
        setSourceDomain(resolvedSourceDomain);
        setSourceCollections(sourceCollectionsForRun);
        selectedHandlesForRun = loadedProducts.map(
          (product: PreviewProduct) => product.handle
        );
        setSelectedProductHandles(selectedHandlesForRun);
        setPreviewKey(currentPreviewKey);
      }

      if (total === 0) {
        toast.error("Nenhum produto encontrado para importar.");
        return;
      }

      const aggregate = {
        attempted: 0,
        createdCount: 0,
        skippedCount: 0,
        failedCount: 0,
        neutralizedCount: 0,
        logoAppliedCount: 0,
        skuMap: {} as Record<string, string>,
        variantMap: {} as Record<string, string>,
        // A API ja devolve failed[] com {sourceHandle, error} por produto, mas o
        // cliente descartava tudo e mostrava so o numero. Quem via "40 produtos
        // falharam" nao tinha como saber o motivo nem quais foram.
        failures: [] as { handle: string; error: string }[],
      };

      const activeSelectedHandles =
        importMode === "bulk" && selectedHandlesForRun.length > 0
          ? selectedHandlesForRun
          : [];
      if (activeSelectedHandles.length > 0) {
        total = activeSelectedHandles.length;
      }
      const totalPages = Math.ceil(total / CLONE_BATCH_SIZE);
      for (let page = 1; page <= totalPages; page += 1) {
        if (controller.signal.aborted) {
          throw new DOMException("Operacao cancelada.", "AbortError");
        }

        const batchStart = (page - 1) * CLONE_BATCH_SIZE + 1;
        const batchEnd = Math.min(page * CLONE_BATCH_SIZE, total);
        setApplyProgress({
          phase: "importing",
          current: batchStart - 1,
          total,
          created: aggregate.createdCount,
          skipped: aggregate.skippedCount,
          failed: aggregate.failedCount,
          message: `Importando produtos ${batchStart}-${batchEnd}/${total}...`,
        });

        const handleBatch = activeSelectedHandles.slice(
          (page - 1) * CLONE_BATCH_SIZE,
          page * CLONE_BATCH_SIZE
        );
        const productCollectionBatch = Object.fromEntries(
          previewForRun
            .filter((product) =>
              handleBatch.length > 0
                ? handleBatch.includes(product.handle)
                : product.collectionHandles?.length
            )
            .map((product) => [product.handle, product.collectionHandles || []])
        );
        const data = await runClone("apply", controller.signal, {
          importMode,
          ...(handleBatch.length > 0
            ? { productHandles: handleBatch, limit: handleBatch.length }
            : {
                page,
                pageSize: CLONE_BATCH_SIZE,
                limit: CLONE_BATCH_SIZE,
              }),
          collections: sourceCollectionsForRun.map((collection) => ({
            handle: collection.handle,
            title: collection.title,
          })),
          productCollections: productCollectionBatch,
          createRoutingConfig: false,
          recordRun: false,
        });

        const attempted = Number(data.attempted || 0);
        if (attempted === 0) break;

        aggregate.attempted += attempted;
        aggregate.createdCount += Number(data.createdCount || 0);
        aggregate.skippedCount += Number(data.skippedCount || 0);
        aggregate.failedCount += Number(data.failedCount || 0);
        aggregate.neutralizedCount += Number(data.neutralizedCount || 0);
        aggregate.logoAppliedCount += Number(data.logoAppliedCount || 0);
        Object.assign(aggregate.skuMap, data.skuMap || {});
        Object.assign(aggregate.variantMap, data.variantMap || {});
        if (Array.isArray(data.failed)) {
          for (const item of data.failed as {
            sourceHandle?: string;
            handle?: string;
            error?: string;
          }[]) {
            aggregate.failures.push({
              handle: item?.sourceHandle || item?.handle || "(sem handle)",
              error: item?.error || "Erro desconhecido",
            });
          }
        }
        setCloneFailures([...aggregate.failures]);

        setApplyProgress({
          phase: "importing",
          current: Math.min(aggregate.attempted, total),
          total,
          created: aggregate.createdCount,
          skipped: aggregate.skippedCount,
          failed: aggregate.failedCount,
          message: `Importando produto ${Math.min(aggregate.attempted, total)}/${total}...`,
        });
      }

      // Registra UMA linha de historico com o agregado do lote. Cada batch
      // envia recordRun:false para nao poluir, o que antes deixava a
      // importacao em massa sem nenhum registro em "Execucoes recentes".
      try {
        await fetch("/api/shopify/clone/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceDomain: resolvedSourceDomain || source,
            targetStoreId,
            createdCount: aggregate.createdCount,
            skippedCount: aggregate.skippedCount,
            failedCount: aggregate.failedCount,
            neutralizedCount: aggregate.neutralizedCount,
            logoAppliedCount: aggregate.logoAppliedCount,
            failures: aggregate.failures,
          }),
        });
      } catch {
        // Historico e best-effort: nunca deve derrubar a importacao.
      }

      let routingConfig: unknown = null;
      if (createRoutingConfig && sourceStoreId && targetStoreId) {
        setApplyProgress({
          phase: "routing",
          current: Math.min(aggregate.attempted, total),
          total,
          created: aggregate.createdCount,
          skipped: aggregate.skippedCount,
          failed: aggregate.failedCount,
          message: "Criando rota única com os mapas importados...",
        });

        const routeRes = await fetch("/api/checkout-routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            name: `Clone ${resolvedSourceDomain || source} -> ${selectedTarget?.shop_domain || "destino"}`,
            sourceStoreId,
            targetStoreId,
            mode: "enterprise_static",
            skuMap: aggregate.skuMap,
            variantMap: aggregate.variantMap,
            settings: { generatedBy: "shopify_clone_batched" },
          }),
        });
        const routeData = await routeRes.json().catch(() => ({}));
        if (!routeRes.ok) {
          throw new Error(routeData.error || "Produtos criados, mas falhou ao criar rota.");
        }
        routingConfig = routeData.config;
      }

      setApplyProgress({
        phase: "done",
        current: Math.min(aggregate.attempted, total),
        total,
        created: aggregate.createdCount,
        skipped: aggregate.skippedCount,
        failed: aggregate.failedCount,
        message: "Importação concluída.",
      });
      toast.success(
        `${aggregate.createdCount} criados, ${aggregate.skippedCount} pulados e ${aggregate.failedCount} falharam de ${aggregate.attempted} produto(s).`
      );
      if (aggregate.failedCount) {
        toast.error(`${aggregate.failedCount} produtos falharam.`);
      }
      if (routingConfig) {
        toast.success("Rota de checkout criada com os mapas completos.");
      }
      if (aggregate.neutralizedCount) {
        toast.success(`${aggregate.neutralizedCount} produto(s) neutralizados com IA.`);
      }
      if (aggregate.logoAppliedCount) {
        toast.success(`${aggregate.logoAppliedCount} imagem(ns) receberam a logo.`);
      }
    } catch (error) {
      if (isAbortError(error)) {
        toast("Operacao cancelada.");
      } else {
        toast.error(error instanceof Error ? error.message : "Falha ao aplicar clone.");
      }
    } finally {
      if (cloneAbortRef.current === controller) cloneAbortRef.current = null;
      setApplyLoading(false);
    }
  }

  function toggleProductHandle(handle: string, checked: boolean) {
    setSelectedProductHandles((current) => {
      if (checked) return [...new Set([...current, handle])];
      return current.filter((item) => item !== handle);
    });
  }

  // Marca/desmarca apenas o que esta visivel no filtro atual, preservando a
  // selecao de itens escondidos — assim da para montar a selecao categoria por
  // categoria sem perder o que ja foi escolhido.
  function toggleAllProducts(checked: boolean) {
    const visibleHandles = visiblePreview.map((product) => product.handle);
    setSelectedProductHandles((current) => {
      if (checked) return [...new Set([...current, ...visibleHandles])];
      const visibleSet = new Set(visibleHandles);
      return current.filter((handle) => !visibleSet.has(handle));
    });
  }


  return (
    <div className="animate-fade-in">
      {activeView === "overview" && <ServiceOverview />}

      {activeView === "shopify" && (
      <section aria-labelledby="clone-shopify">
        <ImportWizard
          applyLoading={applyLoading}
          applyLogoToCloneImages={applyLogoToCloneImages}
          applyProgress={applyProgress}
          cloneAbortRef={cloneAbortRef}
          cloneAiMediaLimit={cloneAiMediaLimit}
          cloneCustomPrompt={cloneCustomPrompt}
          cloneFailures={cloneFailures}
          cloneGenericizeText={cloneGenericizeText}
          cloneNeutralizationInstructions={cloneNeutralizationInstructions}
          createRoutingConfig={createRoutingConfig}
          duplicatePolicy={duplicatePolicy}
          handleApply={handleApply}
          handlePreview={handlePreview}
          handleTransformPreview={handleTransformPreview}
          importMode={importMode}
          importScope={importScope}
          importStep={importStep}
          inventoryMode={inventoryMode}
          inventoryQuantity={inventoryQuantity}
          limit={limit}
          loadSourceCollectionOptions={loadSourceCollectionOptions}
          loadingSourceCollections={loadingSourceCollections}
          neutralizeCloneProducts={neutralizeCloneProducts}
          openInlineImport={openInlineImport}
          preview={preview}
          previewCollectionOptions={previewCollectionOptions}
          previewCollections={previewCollections}
          previewLoading={previewLoading}
          previewSearch={previewSearch}
          previewSort={previewSort}
          publishToStorefront={publishToStorefront}
          removeExternalReferencesCloneProducts={removeExternalReferencesCloneProducts}
          selectedProductHandles={selectedProductHandles}
          selectedSourceCollection={selectedSourceCollection}
          selectedTarget={selectedTarget}
          setApplyLogoToCloneImages={setApplyLogoToCloneImages}
          setCloneAiMediaLimit={setCloneAiMediaLimit}
          setCloneCustomPrompt={setCloneCustomPrompt}
          setCloneGenericizeText={setCloneGenericizeText}
          setCloneNeutralizationInstructions={setCloneNeutralizationInstructions}
          setCreateRoutingConfig={setCreateRoutingConfig}
          setDuplicatePolicy={setDuplicatePolicy}
          setImportScope={setImportScope}
          setImportStep={setImportStep}
          setInventoryMode={setInventoryMode}
          setInventoryQuantity={setInventoryQuantity}
          setLimit={setLimit}
          setNeutralizeCloneProducts={setNeutralizeCloneProducts}
          setPreview={setPreview}
          setPreviewCollections={setPreviewCollections}
          setPreviewKey={setPreviewKey}
          setPreviewSearch={setPreviewSearch}
          setPreviewSort={setPreviewSort}
          setPublishToStorefront={setPublishToStorefront}
          setRemoveExternalReferencesCloneProducts={setRemoveExternalReferencesCloneProducts}
          setSelectedSourceCollection={setSelectedSourceCollection}
          setSource={setSource}
          setTargetStoreId={setTargetStoreId}
          setTranslateCloneProducts={setTranslateCloneProducts}
          setTranslateVariantOptions={setTranslateVariantOptions}
          source={source}
          sourceCollectionOptions={sourceCollectionOptions}
          sourceDomain={sourceDomain}
          stores={stores}
          t={t}
          targetStoreId={targetStoreId}
          toggleAllProducts={toggleAllProducts}
          toggleProductHandle={toggleProductHandle}
          transformPreviewLoading={transformPreviewLoading}
          transformedPreview={transformedPreview}
          translateCloneProducts={translateCloneProducts}
          translateVariantOptions={translateVariantOptions}
          visiblePreview={visiblePreview}
        />
      </section>
      )}


    </div>
  );
}
