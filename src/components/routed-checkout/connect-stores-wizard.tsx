"use client";

import { useEffect, useRef, useState } from "react";
import { textos } from "@/lib/textos";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Languages,
  Loader2,
  PackageCheck,
  Route as RouteIcon,
  Store,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface StoreOption {
  id: string;
  name: string;
  shop_domain: string;
}

interface ImageQueueProgress {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

interface DestinationResult {
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  imageQueueCount: number;
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
  failedDetails?: { sourceHandle: string; error: string }[];
}

// Diagnostico devolvido por connect-by-sku. Sem isto o usuario ligava uma
// rota com 27% de cobertura sem ver nada de errado: o wizard so mostrava
// "X conexoes", que parece sucesso mesmo quando 3 de cada 4 clientes caem no
// checkout errado.
interface DiagnosticoRota {
  coveragePercent: number;
  missingSkuCount: number;
  duplicateSkuCount: number;
  duplicateSkus: string[];
  warnings: string[];
  stampedSkuCount: number;
  dedupedSkuCount: number;
  safeToEnable: boolean;
}

interface ConnectStoresWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stores: StoreOption[];
  appOrigin: string;
  onRouteCreated?: () => void;
}

function storeLabel(store?: StoreOption) {
  if (!store) return "—";
  return store.name || store.shop_domain;
}

const STEPS = ["Lojas", "Criar destino", "Ativar rota"];

export function ConnectStoresWizard({
  open,
  onOpenChange,
  stores,
  appOrigin,
  onRouteCreated,
}: ConnectStoresWizardProps) {
  const t = textos("clone.imageNeutralize");
  const [step, setStep] = useState(1);

  // "generate" = neutraliza da vitrine. "reuse" = copia uma loja checkout ja
  // neutralizada e conecta por SKU. "connect" = as duas lojas ja tem os
  // produtos (importados), so casa por SKU e gera o script.
  const [wizardMode, setWizardMode] = useState<"generate" | "reuse" | "connect">(
    "generate"
  );
  const [reuseFromStoreId, setReuseFromStoreId] = useState("");
  const [reuseMatched, setReuseMatched] = useState<number | null>(null);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoRota | null>(null);
  const [routeId, setRouteId] = useState("");
  const [ligando, setLigando] = useState(false);
  const [completando, setCompletando] = useState(false);

  // Passo 1
  const [sourceStoreId, setSourceStoreId] = useState("");
  const [targetStoreId, setTargetStoreId] = useState("");
  const [neutralize, setNeutralize] = useState(true);
  // "queue" = recria a imagem sem marca em background. "none" = nao gera imagem
  // nenhuma (mantem a original e o usuario recria depois em outro app).
  const [imageMode, setImageMode] = useState<"queue" | "none">("queue");
  const [genericizeText, setGenericizeText] = useState(true);
  const [translate, setTranslate] = useState(false);
  const [translateVariants, setTranslateVariants] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [inventoryTracked, setInventoryTracked] = useState(false);
  const [inventoryQuantity, setInventoryQuantity] = useState("100");

  const [outputLanguage, setOutputLanguage] = useState("pt-BR");

  // Estimativa de creditos pra "Recriar imagem em background": 1 credito por
  // produto (1 imagem cada). Busca a contagem da vitrine + saldo atual do
  // usuario pra avisar antes de comecar, nao depois de gastar.
  const [sourceProductCount, setSourceProductCount] = useState<number | null>(
    null
  );
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [billingEnforced, setBillingEnforced] = useState(false);

  // Passo 2
  const [creatingDestination, setCreatingDestination] = useState(false);
  const [destinationResult, setDestinationResult] =
    useState<DestinationResult | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    processed: number;
    total: number;
    created: number;
    skipped: number;
    failed: number;
    canceled?: boolean;
  } | null>(null);
  const [imageProgress, setImageProgress] = useState<ImageQueueProgress | null>(
    null
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const imagePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);

  // Passo 3
  const [creatingRoute, setCreatingRoute] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [routeToken, setRouteToken] = useState("");
  const routeRequestedRef = useRef(false);

  const sourceStore = stores.find((store) => store.id === sourceStoreId);
  const targetStore = stores.find((store) => store.id === targetStoreId);

  function stopImagePoll() {
    if (imagePollRef.current) {
      clearTimeout(imagePollRef.current);
      imagePollRef.current = null;
    }
  }

  // Saldo de creditos: carrega 1x quando o wizard abre.
  useEffect(() => {
    if (!open) return;
    fetch("/api/billing/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCreditBalance(typeof data.aiCredits === "number" ? data.aiCredits : null);
        setBillingEnforced(data.billingEnforced === true);
      })
      .catch(() => undefined);
  }, [open]);

  // Estimativa de produtos da vitrine (1 credito = 1 imagem = 1 produto), pra
  // avisar o custo ANTES de clicar em criar destino, nao depois.
  // Vale contar? Deriva das mesmas condicoes que o efeito checava.
  //
  // O efeito fazia setSourceProductCount(null) no ramo de saida e
  // setCountingProducts(true) no de entrada -- dois setState sincronos. O
  // primeiro nem precisava existir: "nao se aplica" e calculavel. E a flag
  // `countingProducts` saiu junto -- com a contagem derivada, "ainda nao
  // voltou" e simplesmente `contagemVisivel === null`.
  const contagemSeAplica =
    open &&
    wizardMode === "generate" &&
    imageMode === "queue" &&
    Boolean(sourceStoreId) &&
    Boolean(targetStoreId);
  const contagemVisivel = contagemSeAplica ? sourceProductCount : null;

  useEffect(() => {
    if (!contagemSeAplica) return;
    let cancelled = false;
    fetch("/api/checkout-routes/create-destination", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceStoreId, targetStoreId, countOnly: true }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setSourceProductCount(
          typeof data?.totalCount === "number" ? data.totalCount : null
        );
      })
      .catch(() => {
        if (!cancelled) setSourceProductCount(null);
      })
      .finally(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [open, wizardMode, imageMode, sourceStoreId, targetStoreId]);

  // Reseta tudo ao abrir e pre-seleciona vitrine/loja checkout.
  //
  // No RENDER, nao em efeito: eram ONZE setState sincronos disparando de uma
  // vez dentro do efeito toda vez que o assistente abria -- o caso mais caro
  // da regra set-state-in-effect no projeto inteiro. Na transicao de abertura,
  // o React aplica tudo numa passada so, antes de pintar.
  //
  // O que sobra no efeito e o unico efeito de verdade aqui: parar o poll de
  // imagens quando fecha.
  const [abertoAntes, setAbertoAntes] = useState(open);
  if (open !== abertoAntes) {
    setAbertoAntes(open);
    if (open) {
      setStep(1);
      setDestinationResult(null);
      setBatchProgress(null);
      setImageProgress(null);
      setCreateError(null);
      setRouteToken("");
      setRouteName("");
      setReuseMatched(null);
      routeRequestedRef.current = false;
      setSourceStoreId((current) => current || stores[0]?.id || "");
      setTargetStoreId((current) => current || stores[1]?.id || "");
      setReuseFromStoreId((current) => current || stores[1]?.id || "");
    }
  }

  useEffect(() => {
    if (!open) stopImagePoll();
  }, [open, stopImagePoll]);

  useEffect(() => () => stopImagePoll(), []);

  async function refreshImageQueue(storeId: string) {
    if (!storeId) return;
    stopImagePoll();
    try {
      const res = await fetch(
        `/api/jobs/neutralize-images?storeId=${encodeURIComponent(storeId)}`
      );
      const data = await res.json();
      if (!res.ok || !data.progress) return;
      const progress = data.progress as ImageQueueProgress;
      setImageProgress(progress.total > 0 ? progress : null);

      if (progress.pending > 0 || progress.processing > 0) {
        if (progress.pending > 0 && progress.processing === 0) {
          fetch("/api/jobs/neutralize-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId }),
          }).catch(() => {});
        }
        imagePollRef.current = setTimeout(
          () => refreshImageQueue(storeId),
          5000
        );
      }
    } catch {
      // silencioso
    }
  }

  async function handleCreateDestination() {
    if (!sourceStoreId || !targetStoreId) {
      toast.error("Escolha a vitrine e a loja checkout.");
      return;
    }
    if (sourceStoreId === targetStoreId) {
      toast.error("A loja checkout precisa ser diferente da vitrine.");
      return;
    }
    if (wizardMode === "reuse") {
      if (!reuseFromStoreId) {
        toast.error("Escolha a loja checkout que será copiada.");
        return;
      }
      if (
        reuseFromStoreId === targetStoreId ||
        reuseFromStoreId === sourceStoreId
      ) {
        toast.error("A loja checkout de origem precisa ser diferente das outras.");
        return;
      }
    }

    const controller = new AbortController();
    createAbortRef.current = controller;
    setCreatingDestination(true);
    setCreateError(null);
    setStep(2);
    setBatchProgress({ processed: 0, total: 0, created: 0, skipped: 0, failed: 0 });

    // Base do payload por modo. Reuse copia a loja checkout ja neutralizada (sem IA).
    const basePayload =
      wizardMode === "reuse"
        ? {
            sourceStoreId: reuseFromStoreId,
            targetStoreId,
            inventoryMode: inventoryTracked ? "tracked" : "not_tracked",
            inventoryQuantity: Number(inventoryQuantity) || 0,
            neutralizeProducts: false,
            translateProducts: false,
            translateVariantOptions: false,
          }
        : {
            sourceStoreId,
            targetStoreId,
            inventoryMode: inventoryTracked ? "tracked" : "not_tracked",
            inventoryQuantity: Number(inventoryQuantity) || 0,
            neutralizeProducts: neutralize,
            imageNeutralizeMode: imageMode,
            aiMediaLimit: 1,
            genericizeText,
            neutralizationInstructions: instructions,
            translateProducts: translate,
            translateVariantOptions: translateVariants,
            targetLanguage: outputLanguage,
          };

    const agg = {
      created: 0,
      skipped: 0,
      failed: 0,
      imageQueueCount: 0,
      skuMap: {} as Record<string, string>,
      variantMap: {} as Record<string, string>,
      failedDetails: [] as { sourceHandle: string; error: string }[],
    };
    let cursor: string | null = null;
    let total = 0;
    let first = true;
    let enqueuedImages = false;

    try {
      // Contagem rapida primeiro: a barra ja aparece com "0 de N" antes do
      // primeiro lote pesado de IA, deixando claro que esta funcionando.
      try {
        const countRes = await fetch(
          "/api/checkout-routes/create-destination",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({ ...basePayload, countOnly: true }),
          }
        );
        const countData = (await countRes.json()) as {
          totalCount?: number | null;
        };
        if (countRes.ok && typeof countData.totalCount === "number") {
          total = countData.totalCount;
          first = false;
          setBatchProgress({
            processed: 0,
            total,
            created: 0,
            skipped: 0,
            failed: 0,
          });
        }
      } catch {
        // Sem contagem previa caimos no withCount do primeiro lote.
      }

      type BatchData = {
        error?: string;
        createdCount?: number;
        skippedCount?: number;
        failedCount?: number;
        imageQueueCount?: number;
        skuMap?: Record<string, string>;
        variantMap?: Record<string, string>;
        failed?: { sourceHandle: string; error: string }[];
        totalCount?: number | null;
        nextCursor?: string | null;
        hasMore?: boolean;
      };

      // Busca um lote com ate 3 tentativas em erro transitorio (rede, 5xx,
      // timeout). Aborts e erros 4xx (ex.: perfil incompleto) sobem na hora.
      // Assim um soluco no Gemini/Shopify nao joga tudo fora.
      async function fetchBatch(): Promise<BatchData> {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          if (controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          try {
            const res: Response = await fetch(
              "/api/checkout-routes/create-destination",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({ ...basePayload, cursor, withCount: first }),
              }
            );
            const data = (await res.json().catch(() => ({}))) as BatchData;
            if (res.ok) return data;
            // 4xx: erro definitivo do pedido, nao adianta repetir.
            if (res.status >= 400 && res.status < 500) {
              const fatal = new Error(data.error || "Falha ao criar destino.");
              fatal.name = "FatalRequestError";
              throw fatal;
            }
            throw new Error(data.error || `Erro ${res.status} ao criar destino.`);
          } catch (err) {
            if (
              controller.signal.aborted ||
              (err instanceof DOMException && err.name === "AbortError") ||
              (err instanceof Error && err.name === "FatalRequestError")
            ) {
              throw err;
            }
            lastError = err instanceof Error ? err : new Error("Falha de rede.");
            if (attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
            }
          }
        }
        throw lastError || new Error("Falha ao criar destino.");
      }

      // Processa um lote por vez ate acabar, atualizando a barra de progresso.
      for (;;) {
        if (controller.signal.aborted) break;
        const data = await fetchBatch();

        agg.created += data.createdCount || 0;
        agg.skipped += data.skippedCount || 0;
        agg.failed += data.failedCount || 0;
        agg.imageQueueCount += data.imageQueueCount || 0;
        Object.assign(agg.skuMap, data.skuMap || {});
        Object.assign(agg.variantMap, data.variantMap || {});
        if (data.failed?.length) agg.failedDetails.push(...data.failed);
        if (first && typeof data.totalCount === "number") total = data.totalCount;
        first = false;
        if (data.imageQueueCount) enqueuedImages = true;

        const processed = agg.created + agg.skipped + agg.failed;
        setBatchProgress({
          processed,
          total,
          created: agg.created,
          skipped: agg.skipped,
          failed: agg.failed,
        });

        cursor = data.nextCursor || null;
        if (!data.hasMore) break;
      }

      const canceled = controller.signal.aborted;
      setBatchProgress((current) =>
        current ? { ...current, canceled } : current
      );
      setDestinationResult({
        createdCount: agg.created,
        skippedCount: agg.skipped,
        failedCount: agg.failed,
        imageQueueCount: agg.imageQueueCount,
        skuMap: agg.skuMap,
        variantMap: agg.variantMap,
        failedDetails: agg.failedDetails,
      });
      if (enqueuedImages) refreshImageQueue(targetStoreId);
      if (canceled) {
        toast("Cancelado. Os produtos já criados foram mantidos.");
      } else {
        toast.success(
          `${agg.created} criados, ${agg.skipped} reaproveitados.`
        );
      }
    } catch (error) {
      const isAbort =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      if (isAbort) {
        setBatchProgress((current) =>
          current ? { ...current, canceled: true } : current
        );
        setDestinationResult({
          createdCount: agg.created,
          skippedCount: agg.skipped,
          failedCount: agg.failed,
          imageQueueCount: agg.imageQueueCount,
          skuMap: agg.skuMap,
          variantMap: agg.variantMap,
          failedDetails: agg.failedDetails,
        });
        if (enqueuedImages) refreshImageQueue(targetStoreId);
        toast("Cancelado. Os produtos já criados foram mantidos.");
      } else {
        const message =
          error instanceof Error ? error.message : "Falha ao criar destino.";
        toast.error(message);
        // Fica no passo 2 mostrando o erro (e o que ja foi criado), em vez de
        // voltar mudo pro passo 1. O usuario pode tentar de novo de onde parou.
        setCreateError(message);
        if (agg.created + agg.skipped > 0) {
          setDestinationResult({
            createdCount: agg.created,
            skippedCount: agg.skipped,
            failedCount: agg.failed,
            imageQueueCount: agg.imageQueueCount,
            skuMap: agg.skuMap,
            variantMap: agg.variantMap,
            failedDetails: agg.failedDetails,
          });
          if (enqueuedImages) refreshImageQueue(targetStoreId);
        }
      }
    } finally {
      setCreatingDestination(false);
      createAbortRef.current = null;
    }
  }

  function cancelCreateDestination() {
    createAbortRef.current?.abort();
  }

  async function handleActivateRoute() {
    if (routeRequestedRef.current) return;
    routeRequestedRef.current = true;
    setCreatingRoute(true);
    setStep(3);

    const name =
      routeName.trim() ||
      `${storeLabel(sourceStore)} -> ${storeLabel(targetStore)}`;

    try {
      if (wizardMode === "reuse" || wizardMode === "connect") {
        // Vitrine e loja checkout ja populadas: casa por SKU e cria rota.
        const res = await fetch("/api/checkout-routes/connect-by-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sourceStoreId, targetStoreId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha ao conectar por SKU.");
        if (!data.route?.public_token) {
          throw new Error(
            "Nenhuma variante casou por SKU. Confira se a vitrine já tem os produtos importados."
          );
        }
        setReuseMatched(data.matchedCount || 0);
        setDiagnostico({
          coveragePercent: data.coveragePercent ?? 100,
          missingSkuCount: data.missingSkuCount ?? 0,
          duplicateSkuCount: data.duplicateSkuCount ?? 0,
          duplicateSkus: data.duplicateSkus || [],
          warnings: data.warnings || [],
          stampedSkuCount: data.stampedSkuCount ?? 0,
          dedupedSkuCount: data.dedupedSkuCount ?? 0,
          safeToEnable: data.safeToEnable !== false,
        });
        setRouteName(name);
        setRouteId(data.route.id || "");
        setRouteToken(data.route.public_token);
        onRouteCreated?.();
        // Sobrou produto sem par na loja de checkout: em vez de reportar
        // "X% de cobertura" e deixar o lojista se virar, cria os que faltam
        // agora — e o mesmo conserto do botao "Corrigir".
        if ((data.unmatchedCount ?? 0) > 0 && data.route?.id) {
          const completado = await completarDestino(data.route.id);
          if (completado) {
            data.coveragePercent = completado.coveragePercent;
            data.warnings = completado.warnings;
            data.safeToEnable = completado.safeToEnable;
            data.matchedCount = completado.matchedCount;
          }
        }

        const consertos = (data.stampedSkuCount ?? 0) + (data.dedupedSkuCount ?? 0);
        if (consertos > 0) {
          toast.info(
            `${consertos} SKU(s) corrigidos automaticamente na vitrine.`
          );
        }
        // Rota incompleta nao e "sucesso": avisa com o tom certo.
        if (data.safeToEnable === false) {
          toast.warning(
            `Rota criada DESLIGADA — só ${data.coveragePercent ?? 0}% das variantes casaram.`
          );
        } else {
          toast.success(
            `${data.matchedCount || 0} variantes conectadas por SKU.`
          );
        }
        return;
      }

      const res = await fetch("/api/checkout-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceStoreId,
          targetStoreId,
          mode: "enterprise_static",
          skuMap: destinationResult?.skuMap || {},
          variantMap: destinationResult?.variantMap || {},
          settings: { generatedBy: "connect_wizard" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao criar rota.");

      setRouteName(name);
      setRouteToken(data.config?.public_token || "");
      onRouteCreated?.();
      toast.success("Rota criada. Copie o script para a vitrine.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao criar rota."
      );
      routeRequestedRef.current = false;
      // Em "connect" nao existe passo 2 (nada e criado): volta pro passo 1.
      setStep(wizardMode === "connect" ? 1 : 2);
    } finally {
      setCreatingRoute(false);
    }
  }

  // Cria na loja de checkout os produtos que so existem na vitrine e devolve
  // a cobertura ja recalculada. Best-effort: falhar aqui nao derruba a rota,
  // so mantem o aviso de cobertura baixa.
  async function completarDestino(id: string) {
    setCompletando(true);
    try {
      const res = await fetch("/api/checkout-routes/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const reparo = await res.json();
      if (!res.ok) return null;

      const criados =
        (reparo.createdProductCount || 0) + (reparo.extendedCount || 0);
      if (criados > 0) {
        toast.info(
          `${reparo.createdProductCount || 0} produto(s) e ${
            reparo.extendedCount || 0
          } variante(s) criados na loja de checkout.`
        );
      }

      const saude = await fetch("/api/checkout-routes/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const h = await saude.json();
      if (!saude.ok) return null;

      const avisos: string[] = [];
      if (h.noSkuCount > 0) {
        avisos.push(`${h.noSkuCount} variante(s) da vitrine continuam sem SKU.`);
      }
      if (h.missingCount > 0) {
        avisos.push(
          `${h.missingCount} produto(s) ainda sem par na loja de checkout.`
        );
      }
      if (h.wrongCount > 0) {
        avisos.push(
          `${h.wrongCount} produto(s) apontando para o item errado no checkout.`
        );
      }
      if (h.shipping && h.shipping.ok === false) {
        avisos.push(
          "A loja de checkout nao entrega no pais desta rota — o cliente trava no frete."
        );
      }

      // A rota so fica ligada de verdade quando o conserto fechou tudo.
      const seguro = avisos.length === 0;
      if (seguro) {
        await fetch("/api/checkout-routes/toggle", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, enabled: true }),
        });
      }

      return {
        coveragePercent: h.coveragePercent ?? 100,
        warnings: avisos,
        safeToEnable: seguro,
        matchedCount: h.mappedCount ?? 0,
      };
    } catch {
      return null;
    } finally {
      setCompletando(false);
    }
  }

  // O usuario pode discordar do diagnostico e ligar assim mesmo — o que nao
  // pode e ligar sem ter visto o aviso.
  async function ligarMesmoAssim() {
    if (!routeId || ligando) return;
    setLigando(true);
    try {
      const res = await fetch("/api/checkout-routes/toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: routeId, enabled: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao ligar a rota.");
      setDiagnostico((d) => (d ? { ...d, safeToEnable: true } : d));
      onRouteCreated?.();
      toast.success("Rota ligada.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao ligar a rota."
      );
    } finally {
      setLigando(false);
    }
  }

  const installSnippet = `<script
  src="${appOrigin}/routed-checkout-loader.js"
  data-token="${routeToken || "COLE_O_TOKEN_DA_ROTA"}"
  async>
</script>`;

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(installSnippet);
      toast.success("Script copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  const imagesDone = imageProgress
    ? imageProgress.completed + imageProgress.failed
    : 0;
  const imagesPct = imageProgress
    ? Math.round((imagesDone / Math.max(imageProgress.total, 1)) * 100)
    : 0;
  const imagesRunning = imageProgress
    ? imageProgress.pending + imageProgress.processing > 0
    : false;

  const busy = creatingDestination || creatingRoute;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Nao deixa fechar no meio da criacao (Escape/clique fora): evita o
        // usuario perder a visao do progresso achando que travou.
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RouteIcon className="h-4 w-4 text-primary" />
            Conectar vitrine à loja checkout
          </DialogTitle>
          <DialogDescription>
            Cria os produtos na loja checkout, conecta por SKU e gera o script de
            checkout roteado.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const active = step === number;
            const done = step > number;
            return (
              <div key={label} className="flex flex-1 items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    done && "bg-primary/15 text-primary",
                    active && "bg-primary text-primary-foreground",
                    !active && !done && "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : number}
                </div>
                <span
                  className={cn(
                    "truncate text-xs",
                    active ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Passo 1 — Lojas e opções */}
        {step === 1 && (
          <div className="max-h-[60vh] overflow-y-auto"><div className="space-y-4">
            {stores.length < 2 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive">
                Conecte pelo menos duas lojas (uma vitrine e uma loja checkout).
              </div>
            )}

            {/* Como montar a loja checkout */}
            <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setWizardMode("generate")}
                className={cn(
                  "rounded-md px-2 py-1.5 font-semibold transition-colors",
                  wizardMode === "generate"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Gerar
              </button>
              <button
                type="button"
                onClick={() => setWizardMode("reuse")}
                className={cn(
                  "rounded-md px-2 py-1.5 font-semibold transition-colors",
                  wizardMode === "reuse"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Reaproveitar
              </button>
              <button
                type="button"
                onClick={() => setWizardMode("connect")}
                className={cn(
                  "rounded-md px-2 py-1.5 font-semibold transition-colors",
                  wizardMode === "connect"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Só conectar
              </button>
            </div>
            {wizardMode === "generate" && (
              <p className="-mt-2 text-[11px] leading-4 text-muted-foreground">
                Cria os produtos na loja checkout a partir da vitrine,
                neutralizando marca e (opcional) imagem.
              </p>
            )}
            {wizardMode === "reuse" && (
              <p className="-mt-2 text-[11px] leading-4 text-muted-foreground">
                Copia os produtos já neutralizados de uma loja checkout existente
                para uma nova, sem rodar IA. Depois conecta a vitrine à nova
                loja checkout por SKU automaticamente.
              </p>
            )}
            {wizardMode === "connect" && (
              <p className="-mt-2 text-[11px] leading-4 text-muted-foreground">
                As duas lojas já têm os produtos (você importou). Não cria nada:
                só casa as variantes por SKU e gera o script. Use quando a
                vitrine e a loja checkout já estão prontas.
              </p>
            )}

            {/* No modo "reaproveitar" o layout e diferente: origem → destino → vitrine */}
            {wizardMode === "reuse" ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <PackageCheck className="h-3.5 w-3.5 text-primary" /> loja checkout existente
                    </Label>
                    <Select
                      value={reuseFromStoreId}
                      onValueChange={(value) => setReuseFromStoreId(value || "")}
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="Escolha">
                          {(value: string) => {
                            const selected = stores.find((store) => store.id === value);
                            return selected ? storeLabel(selected) : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {stores.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {storeLabel(store)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Tem os produtos já prontos (ex.: Northmere). Será copiada.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <PackageCheck className="h-3.5 w-3.5" /> Nova loja checkout
                    </Label>
                    <Select
                      value={targetStoreId}
                      onValueChange={(value) => setTargetStoreId(value || "")}
                    >
                      <SelectTrigger className="w-full min-w-0">
                        <SelectValue placeholder="Escolha">
                          {(value: string) => {
                            const selected = stores.find((store) => store.id === value);
                            return selected ? storeLabel(selected) : value;
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {stores.map((store) => (
                          <SelectItem key={store.id} value={store.id}>
                            {storeLabel(store)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Vazia, vai receber os produtos copiados e o checkout.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5" /> Vitrine
                  </Label>
                  <Select
                    value={sourceStoreId}
                    onValueChange={(value) => setSourceStoreId(value || "")}
                  >
                    <SelectTrigger className="w-full min-w-0">
                      <SelectValue placeholder="Escolha">
                        {(value: string) => {
                          const selected = stores.find((store) => store.id === value);
                          return selected ? storeLabel(selected) : value;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {stores.map((store) => (
                        <SelectItem key={store.id} value={store.id}>
                          {storeLabel(store)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Onde o cliente compra. Será conectada à nova loja checkout por SKU.
                  </p>
                </div>
                {reuseFromStoreId && targetStoreId && sourceStoreId && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{storeLabel(stores.find((s) => s.id === reuseFromStoreId))}</span>
                    {" → copiar produtos → "}
                    <span className="font-medium text-foreground">{storeLabel(stores.find((s) => s.id === targetStoreId))}</span>
                    {" · checkout roteado de "}
                    <span className="font-medium text-foreground">{storeLabel(stores.find((s) => s.id === sourceStoreId))}</span>
                    {" → "}
                    <span className="font-medium text-foreground">{storeLabel(stores.find((s) => s.id === targetStoreId))}</span>
                  </div>
                )}
              </div>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5" /> Vitrine
                </Label>
                <Select
                  value={sourceStoreId}
                  onValueChange={(value) => setSourceStoreId(value || "")}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Escolha">
                      {(value: string) => {
                        const selected = stores.find((store) => store.id === value);
                        return selected ? storeLabel(selected) : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {storeLabel(store)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Onde o cliente compra.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <PackageCheck className="h-3.5 w-3.5" /> loja checkout
                </Label>
                <Select
                  value={targetStoreId}
                  onValueChange={(value) => setTargetStoreId(value || "")}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Escolha">
                      {(value: string) => {
                        const selected = stores.find((store) => store.id === value);
                        return selected ? storeLabel(selected) : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {stores.map((store) => (
                      <SelectItem key={store.id} value={store.id}>
                        {storeLabel(store)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Recebe os produtos e o checkout.
                </p>
              </div>
            </div>
            )}


            {wizardMode === "generate" && (
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={neutralize}
                  onChange={(event) => setNeutralize(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <WandSparkles className="h-3.5 w-3.5 text-primary" />
                    Neutralizar produtos (stock/sem marca)
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Remove marcas do texto e da imagem. Ideal para réplicas.
                  </span>
                </span>
              </label>

              {neutralize && (
                <div className="ml-6 space-y-2 border-l border-border/60 pl-3">
                  <div className="space-y-1">
                    <span className="block text-xs font-medium text-foreground">
                      Imagens
                    </span>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="imageMode"
                        checked={imageMode === "queue"}
                        onChange={() => setImageMode("queue")}
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span>
                        <span className="block text-foreground">
                          {t("queueTitle")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("queueDesc", { cost: "0.04" })}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="imageMode"
                        checked={imageMode === "none"}
                        onChange={() => setImageMode("none")}
                        className="mt-0.5 h-4 w-4 accent-primary"
                      />
                      <span>
                        <span className="block text-foreground">
                          {t("noneTitle")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("noneDesc")}
                        </span>
                      </span>
                    </label>
                    {imageMode === "queue" && (
                      <p
                        className={cn(
                          "ml-6 rounded-md border px-2 py-1.5 text-xs",
                          billingEnforced &&
                            contagemVisivel !== null &&
                            creditBalance !== null &&
                            contagemVisivel > creditBalance
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : "border-border/60 bg-muted/40 text-muted-foreground"
                        )}
                      >
                        {/* null enquanto a contagem nao voltou: cobre o estado de carregando
                            sem precisar de uma flag propria. */}
                        {contagemVisivel === null ? (
                          t("estimateLoading")
                        ) : !billingEnforced ? (
                          t("estimateUnlimited")
                        ) : creditBalance !== null &&
                          contagemVisivel > creditBalance ? (
                          t("estimateLowBalance", {
                            count: contagemVisivel,
                            balance: creditBalance,
                          })
                        ) : (
                          t("estimate", {
                            count: contagemVisivel,
                            balance: creditBalance ?? 0,
                          })
                        )}
                      </p>
                    )}
                  </div>
                  <label className="flex items-start gap-2 border-t border-border/60 pt-2 text-sm">
                    <input
                      type="checkbox"
                      checked={genericizeText}
                      onChange={(event) =>
                        setGenericizeText(event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span className="text-xs text-muted-foreground">
                      Genericizar nome/descrição (ex.: Air Jordan → Tênis
                      esportivo).
                    </span>
                  </label>
                  <Textarea
                    rows={2}
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="Instruções extras (opcional). Ex.: manter escudo do time, remover só selo de vendedor."
                    className="bg-background/70 text-xs"
                  />
                </div>
              )}

              <label className="flex items-start gap-2 border-t border-border/60 pt-2 text-sm">
                <input
                  type="checkbox"
                  checked={translate}
                  onChange={(event) => setTranslate(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  Traduzir textos para o idioma da loja checkout
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={translateVariants}
                  onChange={(event) =>
                    setTranslateVariants(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  Traduzir cores e tamanhos (variantes) para português
                </span>
              </label>
            </div>
            )}

            {wizardMode === "generate" && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5" /> Idioma dos produtos
                </Label>
                <Select
                  value={outputLanguage}
                  onValueChange={(value) => setOutputLanguage(value || "pt-BR")}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                    <SelectItem value="es">Espanhol</SelectItem>
                    <SelectItem value="es-CL">Espanhol (Chile)</SelectItem>
                    <SelectItem value="es-MX">Espanhol (México)</SelectItem>
                    <SelectItem value="en">Inglês</SelectItem>
                    <SelectItem value="ja">日本語 (Japonês)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Título, descrição, tags e SEO saem nesse idioma.
                </p>
              </div>
            )}

            <div
              className={cn(
                "flex items-center gap-2",
                wizardMode === "connect" && "hidden"
              )}
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={inventoryTracked}
                  onChange={(event) =>
                    setInventoryTracked(event.target.checked)
                  }
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-xs text-muted-foreground">
                  Controlar estoque
                </span>
              </label>
              {inventoryTracked && (
                <Input
                  type="number"
                  min={0}
                  value={inventoryQuantity}
                  onChange={(event) => setInventoryQuantity(event.target.value)}
                  className="h-8 w-24 text-sm"
                />
              )}
            </div>

            <Button
              className="w-full"
              disabled={
                stores.length < 2 ||
                !sourceStoreId ||
                !targetStoreId ||
                sourceStoreId === targetStoreId ||
                (wizardMode === "reuse" &&
                  (!reuseFromStoreId ||
                    reuseFromStoreId === targetStoreId ||
                    reuseFromStoreId === sourceStoreId))
              }
              onClick={
                wizardMode === "connect"
                  ? handleActivateRoute
                  : handleCreateDestination
              }
            >
              {wizardMode === "connect"
                ? "Conectar por SKU e gerar script"
                : wizardMode === "reuse"
                  ? "Copiar para a loja checkout"
                  : "Criar destino na loja checkout"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div></div>
        )}

        {/* Passo 2 — Criar destino / progresso */}
        {step === 2 && (
          <div className="max-h-[60vh] overflow-y-auto"><div className="space-y-4">
            {creatingDestination && (
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/45 p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {wizardMode === "reuse"
                        ? "Copiando produtos para a loja checkout…"
                        : "Criando produtos na loja checkout…"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {batchProgress && batchProgress.total > 0
                        ? `${batchProgress.processed} de ${batchProgress.total} processados`
                        : batchProgress && batchProgress.processed > 0
                          ? `${batchProgress.processed} processados…`
                          : "Contando os produtos da origem…"}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={cancelCreateDestination}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                </div>

                {batchProgress && batchProgress.total > 0 && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((batchProgress.processed / Math.max(batchProgress.total, 1)) * 100))}%`,
                      }}
                    />
                  </div>
                )}

                {batchProgress && (batchProgress.created > 0 || batchProgress.failed > 0) && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {batchProgress.created} criados
                    </span>
                    {batchProgress.skipped > 0 && (
                      <span>{batchProgress.skipped} reaproveitados</span>
                    )}
                    {batchProgress.failed > 0 && (
                      <span className="text-destructive">
                        {batchProgress.failed} falhas
                      </span>
                    )}
                  </div>
                )}

                <p className="text-[11px] leading-4 text-muted-foreground">
                  Mantenha esta janela aberta até terminar. Lojas grandes podem
                  levar alguns minutos — a barra avança a cada lote. Você pode
                  cancelar a qualquer momento; os produtos já criados ficam
                  salvos.
                </p>
              </div>
            )}

            {createError && !creatingDestination && (
              <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/8 p-4">
                <div className="flex items-start gap-2">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-destructive">
                      A criação parou por um erro
                    </p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {createError}
                    </p>
                    {batchProgress && batchProgress.processed > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {batchProgress.created} já criados foram mantidos. Tentar
                        de novo continua de onde parou (pula os existentes).
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setCreateError(null);
                      setStep(1);
                    }}
                  >
                    Voltar
                  </Button>
                  <Button className="flex-1" onClick={handleCreateDestination}>
                    Tentar de novo
                  </Button>
                </div>
              </div>
            )}

            {destinationResult && !createError && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border/60 bg-background/45 p-3 text-center">
                    <p className="text-lg font-semibold text-foreground">
                      {destinationResult.createdCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">criados</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/45 p-3 text-center">
                    <p className="text-lg font-semibold text-foreground">
                      {destinationResult.skippedCount}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      reaproveitados
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/45 p-3 text-center">
                    <p className="text-lg font-semibold text-foreground">
                      {Object.keys(destinationResult.variantMap).length}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      conexões
                    </p>
                  </div>
                </div>

                {destinationResult.failedCount > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-destructive">
                      {destinationResult.failedCount} produto(s) falharam — clique em &quot;Tentar de novo&quot; para reprocessar.
                    </p>
                    {destinationResult.failedDetails && destinationResult.failedDetails.length > 0 && (
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {destinationResult.failedDetails.slice(0, 5).map((f, i) => (
                          <p key={i} className="text-[11px] text-destructive/80 font-mono">
                            {f.sourceHandle}: {f.error}
                          </p>
                        ))}
                        {destinationResult.failedDetails.length > 5 && (
                          <p className="text-[11px] text-muted-foreground">+ {destinationResult.failedDetails.length - 5} outros</p>
                        )}
                      </div>
                    )}
                    <Button size="sm" variant="outline" className="w-full border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleCreateDestination}>
                      Tentar de novo (só os que falharam)
                    </Button>
                  </div>
                )}

                {imageProgress && imageProgress.total > 0 && (
                  <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Imagens neutralizadas: {imageProgress.completed}/
                        {imageProgress.total}
                        {imageProgress.failed > 0
                          ? ` · ${imageProgress.failed} falharam`
                          : ""}
                      </span>
                      <span>{imagesRunning ? "processando…" : "concluído"}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-primary/15">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${imagesPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Pode continuar — as imagens terminam em background.
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep(1)}
                  >
                    Voltar
                  </Button>
                  <Button className="flex-1" onClick={handleActivateRoute}>
                    Ativar rota
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div></div>
        )}

        {/* Passo 3 — Ativar rota e script */}
        {step === 3 && (
          <div className="space-y-4">
            {creatingRoute && (
              <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/45 p-4 text-sm">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-medium text-foreground">
                    {completando
                      ? "Completando a loja de checkout…"
                      : "Criando rota…"}
                  </p>
                  {completando && (
                    <p className="text-xs text-muted-foreground">
                      Criando os produtos que faltavam para a rota fechar 100%.
                    </p>
                  )}
                </div>
              </div>
            )}

            {routeToken && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 p-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="text-foreground">
                    Rota <span className="font-semibold">{routeName}</span> criada
                  </span>
                  <Badge variant="secondary" className="ml-auto rounded-md">
                    {wizardMode === "reuse" || wizardMode === "connect"
                      ? reuseMatched ?? 0
                      : Object.keys(destinationResult?.variantMap || {}).length}{" "}
                    conexões
                  </Badge>
                </div>

                {diagnostico &&
                  (diagnostico.stampedSkuCount > 0 ||
                    diagnostico.dedupedSkuCount > 0) && (
                    <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/8 p-3">
                      <WandSparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
                        <p className="text-sm font-medium text-foreground">
                          SKUs corrigidos automaticamente
                        </p>
                        {diagnostico.stampedSkuCount > 0 && (
                          <p>
                            {diagnostico.stampedSkuCount} variante(s) estavam sem
                            SKU — produto criado à mão no Shopify. O app gerou e
                            gravou o SKU na vitrine.
                          </p>
                        )}
                        {diagnostico.dedupedSkuCount > 0 && (
                          <p>
                            {diagnostico.dedupedSkuCount} variante(s) usavam um
                            SKU já ocupado, o que mandaria o cliente para o
                            produto errado. Cada uma recebeu um SKU próprio.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                {diagnostico && diagnostico.warnings.length > 0 && (
                  <div
                    className={cn(
                      "space-y-2 rounded-lg border p-3",
                      diagnostico.safeToEnable
                        ? "border-amber-500/30 bg-amber-500/8"
                        : "border-destructive/40 bg-destructive/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className={cn(
                          "h-4 w-4 shrink-0",
                          diagnostico.safeToEnable
                            ? "text-amber-500"
                            : "text-destructive"
                        )}
                      />
                      <p className="text-sm font-semibold text-foreground">
                        {!diagnostico.safeToEnable
                          ? `Rota criada DESLIGADA — ${diagnostico.coveragePercent}% de cobertura`
                          : diagnostico.coveragePercent < 100
                            ? `Rota ligada, mas com ${diagnostico.coveragePercent}% de cobertura`
                            : "Rota ligada — confira os pontos abaixo"}
                      </p>
                    </div>
                    <ul className="space-y-1 pl-6 text-xs leading-relaxed text-muted-foreground">
                      {diagnostico.warnings.map((aviso) => (
                        <li key={aviso} className="list-disc">
                          {aviso}
                        </li>
                      ))}
                    </ul>
                    {diagnostico.duplicateSkus.length > 0 && (
                      <p className="pl-6 font-mono text-[11px] text-muted-foreground">
                        SKUs repetidos: {diagnostico.duplicateSkus.join(", ")}
                        {diagnostico.duplicateSkuCount >
                          diagnostico.duplicateSkus.length &&
                          ` (+${
                            diagnostico.duplicateSkuCount -
                            diagnostico.duplicateSkus.length
                          })`}
                      </p>
                    )}
                    <p className="pl-6 text-xs text-foreground">
                      {diagnostico.missingSkuCount > 0
                        ? "Preencha o SKU das variantes da vitrine e rode o assistente de novo — o roteamento casa só por SKU."
                        : "Confira os produtos apontados acima antes de mandar tráfego."}
                    </p>
                    {!diagnostico.safeToEnable && routeId && (
                      <div className="pl-6">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={ligarMesmoAssim}
                          disabled={ligando}
                        >
                          {ligando && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          Ligar mesmo assim
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">
                      Cole na vitrine (antes de &lt;/body&gt; em theme.liquid)
                    </Label>
                    <Button variant="ghost" size="sm" onClick={copySnippet}>
                      <Copy className="h-3.5 w-3.5" />
                      Copiar
                    </Button>
                  </div>
                  <Textarea
                    readOnly
                    value={installSnippet}
                    className="min-h-28 resize-y font-mono text-xs leading-6"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>

                {imageProgress && imageProgress.total > 0 && imagesRunning && (
                  <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Imagens: {imageProgress.completed}/{imageProgress.total}
                      </span>
                      <span>processando…</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-primary/15">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${imagesPct}%` }}
                      />
                    </div>
                  </div>
                )}

                <Button className="w-full" onClick={() => onOpenChange(false)}>
                  Concluir
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
