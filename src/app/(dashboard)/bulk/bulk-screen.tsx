"use client";

import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Languages, Loader2, PlayCircle, RefreshCw, Sparkles, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface BulkJob {
  id: string;
  store_id: string;
  type: "bulk_import";
  status: "pending" | "processing" | "completed" | "failed";
  progress: {
    source?: string;
    step?: string;
    current?: number;
    total?: number;
    product?: { title?: string; price?: string };
  };
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

type InventoryMode = "not_tracked" | "tracked";

export function BulkScreen({ initialStores }: { initialStores: { id: string; name: string; shop_domain: string }[] }) {
  const [sources, setSources] = useState("");
  const stores = initialStores;
  const [selectedStore, setSelectedStore] = useState("");
  // As lojas vem prontas do servidor; nao ha carregamento pendente.
  const loadingStores = false;
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [optimize, setOptimize] = useState(false);
  const [neutralizeProducts, setNeutralizeProducts] = useState(false);
  const [removeExternalReferences, setRemoveExternalReferences] = useState(false);
  const [aiMediaLimit, setAiMediaLimit] = useState("1");
  const [neutralizationInstructions, setNeutralizationInstructions] = useState("");
  const [applyLogo, setApplyLogo] = useState(false);
  const [translateVariantOptions, setTranslateVariantOptions] = useState(false);
  const [enrichShopifyTaxonomy, setEnrichShopifyTaxonomy] = useState(false);
  const [useAiTaxonomyFallback, setUseAiTaxonomyFallback] = useState(true);
  const [publishToStorefront, setPublishToStorefront] = useState(true);
  const [perSourceLimit, setPerSourceLimit] = useState("1");
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("not_tracked");
  const [inventoryQuantity, setInventoryQuantity] = useState("100");

  const hasRunningJobs = useMemo(
    () => jobs.some((job) => job.status === "pending" || job.status === "processing"),
    [jobs]
  );


  async function loadJobs(opts?: { silent?: boolean }) {
    if (!selectedStore) {
      setJobs([]);
      return;
    }

    if (!opts?.silent) setJobsLoading(true);
    try {
      const params = new URLSearchParams({ storeId: selectedStore });
      const res = await fetch(`/api/jobs/bulk-import?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao carregar jobs.");
      setJobs(data.jobs || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar jobs.");
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore]);

  useEffect(() => {
    if (!hasRunningJobs) return;
    const interval = setInterval(() => {
      void loadJobs({ silent: true });
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRunningJobs, selectedStore]);

  async function handleStartBulk() {
    if (!selectedStore) {
      toast.error("Selecione uma loja.");
      return;
    }

    const sourceList = sources
      .split("\n")
      .map((source) => source.trim())
      .filter(Boolean);

    if (sourceList.length === 0) {
      toast.error("Insira pelo menos uma URL ou dominio.");
      return;
    }
    if (sourceList.length > 20) {
      toast.error("Maximo de 20 origens por vez.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: selectedStore,
          sources: sourceList,
          optimize,
          neutralizeProducts,
          removeExternalReferences,
          aiMediaLimit: Number(aiMediaLimit || 1),
          neutralizationInstructions,
          applyLogo,
          translateVariantOptions,
          enrichShopifyTaxonomy,
          useAiTaxonomyFallback,
          publishToStorefront,
          perSourceLimit: Number(perSourceLimit || 1),
          inventoryMode,
          inventoryQuantity: Number(inventoryQuantity || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao iniciar lote.");

      toast.success(`${data.queued || data.jobs?.length || sourceList.length} jobs enfileirados.`);
      setSources("");
      await loadJobs();
      void kickWorker();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar lote.");
    } finally {
      setSubmitting(false);
    }
  }

  async function kickWorker() {
    if (!selectedStore) return;

    setProcessing(true);
    try {
      const res = await fetch("/api/jobs/bulk-import/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: selectedStore, limit: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Falha ao processar fila.");
      await loadJobs({ silent: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar fila.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="border-b border-border/60 pb-5">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Importacao em lote
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Cole links de produtos, dominios Shopify, AliExpress ou outros sites. O backend importa e publica com historico em jobs; traducao por IA e opcional.
        </p>
      </header>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Configuracao</CardTitle>
          <CardDescription>Ate 20 origens por execucao.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <Select value={selectedStore} onValueChange={(value) => setSelectedStore(value || "")}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select destination store...">
                    {(value: string) => {
                      const selected = stores.find((store) => store.id === value);
                      return selected ? `${selected.name} (${selected.shop_domain})` : value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {stores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      <span className="inline-flex items-center gap-2">
                        <Store className="h-4 w-4 text-muted-foreground" />
                        {store.name} ({store.shop_domain})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Select value={perSourceLimit} onValueChange={(value) => setPerSourceLimit(value || "1")}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 product/source</SelectItem>
                  <SelectItem value="5">5 products/source</SelectItem>
                  <SelectItem value="20">20 products/source</SelectItem>
                  <SelectItem value="50">50 products/source</SelectItem>
                  <SelectItem value="100">100 products/source</SelectItem>
                  <SelectItem value="250">250 products/source</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-background/45 p-4 md:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Estoque ao importar</p>
              <Select
                value={inventoryMode}
                onValueChange={(value) =>
                  setInventoryMode(value === "tracked" ? "tracked" : "not_tracked")
                }
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_tracked">Inventory not tracked</SelectItem>
                  <SelectItem value="tracked">Definir estoque inicial</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Padrao recomendado: nao rastreia estoque na Shopify e nao envia quantidade zero.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Quantidade</p>
              <Input
                type="number"
                min={0}
                value={inventoryQuantity}
                onChange={(event) => setInventoryQuantity(event.target.value)}
                disabled={inventoryMode === "not_tracked"}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">
                Usado so quando o rastreio estiver ativo.
              </p>
            </div>
          </div>

          <Textarea
            placeholder="https://loja.com/products/produto&#10;exemplo.myshopify.com&#10;https://pt.aliexpress.com/item/123..."
            rows={10}
            value={sources}
            onChange={(event) => setSources(event.target.value)}
            className="font-mono text-sm"
          />

          {(neutralizeProducts || removeExternalReferences) && (
            <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/8 p-3">
              <p className="text-sm font-medium text-foreground">
                Instrucoes extras para limpeza por IA
              </p>
              <Textarea
                rows={3}
                value={neutralizationInstructions}
                onChange={(event) =>
                  setNeutralizationInstructions(event.target.value)
                }
                placeholder="Ex.: remover apenas o patch FIFA, manter o escudo AFA e preservar o padrao azul da camisa."
                className="bg-background/70 text-sm"
              />
              <div className="grid gap-2 pt-2 sm:grid-cols-[1fr_160px]">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Midias com IA por produto
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Use 1 para economizar IA; as outras midias seguem originais.
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={aiMediaLimit}
                  onChange={(event) => setAiMediaLimit(event.target.value)}
                  className="h-10 bg-background/70"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Essas instrucoes serao aplicadas em todos os produtos deste lote.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={optimize}
                onChange={(event) => setOptimize(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Languages className="h-4 w-4 text-primary" />
              Traduzir produto
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={translateVariantOptions}
                onChange={(event) => setTranslateVariantOptions(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Languages className="h-4 w-4 text-primary" />
              Traduzir cores/tamanhos
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={enrichShopifyTaxonomy}
                onChange={(event) => setEnrichShopifyTaxonomy(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Sparkles className="h-4 w-4 text-primary" />
              Categoria Shopify
            </label>
            {enrichShopifyTaxonomy && (
              <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={useAiTaxonomyFallback}
                  onChange={(event) => setUseAiTaxonomyFallback(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <Sparkles className="h-4 w-4 text-primary" />
                IA quando faltar
              </label>
            )}
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={neutralizeProducts}
                onChange={(event) => {
                  setNeutralizeProducts(event.target.checked);
                  if (event.target.checked) setRemoveExternalReferences(false);
                }}
                className="h-4 w-4 accent-primary"
              />
              <Sparkles className="h-4 w-4 text-primary" />
              Neutralizar produto (stock)
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={removeExternalReferences}
                onChange={(event) => {
                  setRemoveExternalReferences(event.target.checked);
                  if (event.target.checked) setNeutralizeProducts(false);
                }}
                className="h-4 w-4 accent-primary"
              />
              <Sparkles className="h-4 w-4 text-primary" />
              Limpar logos externos
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={applyLogo}
                onChange={(event) => setApplyLogo(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <ImageIcon className="h-4 w-4 text-primary" />
              Aplicar logo em massa
            </label>
            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 px-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={publishToStorefront}
                onChange={(event) => setPublishToStorefront(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Publicar na loja
            </label>
            <Button
              onClick={handleStartBulk}
              disabled={submitting || loadingStores || !selectedStore || !sources.trim()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Iniciar lote
            </Button>
            <Button variant="outline" onClick={() => loadJobs()} disabled={jobsLoading}>
              {jobsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Atualizar
            </Button>
            <Button variant="outline" onClick={kickWorker} disabled={processing || !selectedStore}>
              {processing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Processar pendentes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-lg">
            Fila de processamento
            {hasRunningJobs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              Nenhum job ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col justify-between gap-3 rounded-lg border border-border/60 bg-background/45 p-3 md:flex-row md:items-center"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {job.progress?.product?.title || job.progress?.source || job.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {job.error || job.progress?.step || "Aguardando"}
                      {job.progress?.total
                        ? ` - ${job.progress.current || job.progress.total}/${job.progress.total}`
                        : ""}
                    </p>
                  </div>
                  <span
                    className="w-fit rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
                    style={{
                      background:
                        job.status === "completed"
                          ? "color-mix(in oklch, var(--action) 16%, transparent)"
                          : job.status === "failed"
                            ? "color-mix(in oklch, var(--danger) 16%, transparent)"
                            : "color-mix(in oklch, var(--info) 16%, transparent)",
                      color:
                        job.status === "completed"
                          ? "var(--action)"
                          : job.status === "failed"
                            ? "var(--danger)"
                            : "var(--info)",
                    }}
                  >
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
