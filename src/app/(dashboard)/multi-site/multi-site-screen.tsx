"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Globe2,
  Image as ImageIcon,
  Languages,
  Loader2,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Store,
} from "lucide-react";
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
    sourceType?: string;
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

export function MultiSiteScreen({ initialStores }: { initialStores: { id: string; name: string; shop_domain: string }[] }) {
  const [sources, setSources] = useState("");
  const stores = initialStores;
  const [selectedStore, setSelectedStore] = useState("");
  // As lojas vem prontas do servidor; nao ha carregamento pendente.
  const loadingStores = false;
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [optimize, setOptimize] = useState(true);
  const [neutralize, setNeutralize] = useState(false);
  const [aiMediaLimit, setAiMediaLimit] = useState("1");
  const [neutralizationInstructions, setNeutralizationInstructions] = useState("");
  const [applyLogo, setApplyLogo] = useState(false);
  const [translateVariantOptions, setTranslateVariantOptions] = useState(true);
  const [enrichShopifyTaxonomy, setEnrichShopifyTaxonomy] = useState(true);
  const [useAiTaxonomyFallback, setUseAiTaxonomyFallback] = useState(true);
  const [publishToStorefront, setPublishToStorefront] = useState(true);
  const [perSourceLimit, setPerSourceLimit] = useState("1");
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("not_tracked");
  const [inventoryQuantity, setInventoryQuantity] = useState("100");

  const visibleJobs = useMemo(
    () => jobs.filter((job) => job.progress?.sourceType === "generic_site"),
    [jobs]
  );

  const hasRunningJobs = useMemo(
    () =>
      visibleJobs.some(
        (job) => job.status === "pending" || job.status === "processing"
      ),
    [visibleJobs]
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
      toast.error("Insira pelo menos uma URL.");
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
          sourceType: "generic_site",
          optimize,
          neutralize,
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
      if (!res.ok) throw new Error(data.error || "Falha ao iniciar importacao.");

      toast.success(`${data.queued || data.jobs?.length || sourceList.length} jobs enfileirados.`);
      setSources("");
      await loadJobs();
      void kickWorker();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar importacao.");
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
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Diversos sites
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              Nuvemshop, WooCommerce, vitrines proprias e paginas de produto com dados publicos.
            </p>
          </div>
        </div>
      </header>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg">Importação multiplataforma</CardTitle>
          <CardDescription>
            Cole ate 20 URLs. Em vitrines, o limite define quantos produtos buscar por origem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1fr_190px]">
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

            <Select value={perSourceLimit} onValueChange={(value) => setPerSourceLimit(value || "1")}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 product/source</SelectItem>
                <SelectItem value="5">5 products/source</SelectItem>
                <SelectItem value="20">20 products/source</SelectItem>
                <SelectItem value="50">50 products/source</SelectItem>
              </SelectContent>
            </Select>
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
                Padrão recomendado para produtos importados de outras vitrines.
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
                Usado só quando o rastreio estiver ativo.
              </p>
            </div>
          </div>

          <Textarea
            placeholder="https://loja.lojavirtualnuvem.com.br/produtos/camiseta-exemplo&#10;https://site.com/produto/modelo-exemplo&#10;https://marca.com/categoria/camisetas"
            rows={10}
            value={sources}
            onChange={(event) => setSources(event.target.value)}
            className="font-mono text-sm"
          />

          {neutralize && (
            <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/8 p-3">
              <p className="text-sm font-medium text-foreground">
                Comando custom para neutralização
              </p>
              <Textarea
                rows={3}
                value={neutralizationInstructions}
                onChange={(event) =>
                  setNeutralizationInstructions(event.target.value)
                }
                placeholder="Ex.: remover logo da loja e etiquetas externas; manter escudos, textura, costura, estampa e detalhes do produto."
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
                Vale para todas as imagens neutralizadas deste lote.
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
              Traduzir modelos
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
                checked={neutralize}
                onChange={(event) => setNeutralize(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Sparkles className="h-4 w-4 text-primary" />
              Recriar imagens com IA
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
              Importar
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
            Fila de diversos sites
            {hasRunningJobs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              Nenhum job ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {visibleJobs.map((job) => (
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
                        ? ` · ${job.progress.current || job.progress.total}/${job.progress.total}`
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
