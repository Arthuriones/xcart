"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_CLONE_LIMIT,
  TransformedPreviewCard,
  formatStoreLabel,
} from "./clone-shared";
import type {
  CloneApplyProgress,
  ImportMode,
  InventoryMode,
  PreviewProduct,
  PreviewSort,
  SourceCollection,
  StoreOption,
  TransformedPreviewProduct,
} from "./clone-shared";

const CustomPromptDialog = dynamic(
  () =>
    import("@/components/products/CustomPromptDialog").then(
      (m) => m.CustomPromptDialog
    ),
  { ssr: false }
);

/**
 * O assistente de importação.
 *
 * Passo a passo na própria página, não em diálogo: a importação é o trabalho
 * da tela, e uma janela por cima só encolhia o espaço da lista de produtos.
 *
 * Os números dos passos são internos: 1 destino, 2 escopo, 3 origem,
 * 4 seleção (só em massa), 5 opções, 6 revisão. Quem importa um produto só
 * pula o 4 -- não há lista para escolher.
 */

const PASSO = {
  DESTINO: 1,
  ESCOPO: 2,
  ORIGEM: 3,
  SELECAO: 4,
  OPCOES: 5,
  REVISAO: 6,
} as const;

// ---------------------------------------------------------------- peças

/** Bolinha de seleção do design: anel interno na cor da superfície. */
function Radio({ on }: { on: boolean }) {
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full"
      style={{
        border: `1px solid ${on ? "var(--solid)" : "var(--control-border)"}`,
        background: on ? "var(--solid)" : "var(--surface)",
        boxShadow: "inset 0 0 0 2.5px var(--surface-2)",
      }}
      aria-hidden
    />
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-5 w-[34px] shrink-0 rounded-[11px] transition-colors"
      style={{
        border: on ? "0" : "1px solid var(--control-border)",
        background: on ? "var(--solid)" : "var(--surface)",
      }}
    >
      <span
        className="absolute top-0.5 block rounded-full transition-all"
        style={
          on
            ? { right: 2, width: 16, height: 16, background: "var(--surface)" }
            : { left: 2, width: 14, height: 14, background: "var(--control-border)" }
        }
      />
    </button>
  );
}

/** Linha de opção: título, explicação e o interruptor à direita. */
function OptionRow({
  title,
  hint,
  on,
  onChange,
  children,
}: {
  title: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-center gap-3.5 px-[15px] py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-ink">{title}</div>
          <div className="text-[12px] text-t3">{hint}</div>
        </div>
        <Toggle on={on} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

function Titulo({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <h2 className="mb-[3px] text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mb-3 text-[12.5px] text-t2">{hint}</p>
    </>
  );
}

function Secao({ title }: { title: string }) {
  return <h3 className="mb-[9px] mt-[18px] text-[12.5px] font-semibold text-ink">{title}</h3>;
}

const CAMPO =
  "h-[34px] w-full rounded-md border border-[var(--control-border)] bg-surface px-[11px] text-[12px] text-ink outline-none focus:border-[var(--border-strong)]";
const BOTAO_SEC =
  "h-[30px] rounded-md border border-[var(--border-strong)] bg-surface px-[13px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-50";
const BOTAO_PRI =
  "h-[30px] rounded-md px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors disabled:opacity-60";

// ---------------------------------------------------------------- props

export interface ImportWizardProps {
  applyLoading: boolean;
  applyLogoToCloneImages: boolean;
  applyProgress: CloneApplyProgress | null;
  cloneAbortRef: React.RefObject<AbortController | null>;
  cloneAiMediaLimit: string;
  cloneCustomPrompt: string;
  cloneFailures: { handle: string; error: string }[];
  cloneGenericizeText: boolean;
  cloneNeutralizationInstructions: string;
  createRoutingConfig: boolean;
  duplicatePolicy: string;
  handleApply: () => void | Promise<void>;
  handlePreview: () => void | Promise<void>;
  handleTransformPreview: () => void | Promise<void>;
  importMode: ImportMode;
  importScope: "all" | "collection";
  importStep: number;
  inventoryMode: InventoryMode;
  inventoryQuantity: string;
  limit: string;
  loadSourceCollectionOptions: () => void | Promise<void>;
  loadingSourceCollections: boolean;
  neutralizeCloneProducts: boolean;
  openInlineImport: (mode: ImportMode) => void;
  preview: PreviewProduct[];
  previewCollectionOptions: { handle: string; title: string; count: number }[];
  previewCollections: string[];
  previewLoading: boolean;
  previewSearch: string;
  previewSort: PreviewSort;
  publishToStorefront: boolean;
  removeExternalReferencesCloneProducts: boolean;
  selectedProductHandles: string[];
  selectedSourceCollection: SourceCollection | null;
  selectedTarget: StoreOption | undefined;
  setApplyLogoToCloneImages: React.Dispatch<React.SetStateAction<boolean>>;
  setCloneAiMediaLimit: React.Dispatch<React.SetStateAction<string>>;
  setCloneCustomPrompt: React.Dispatch<React.SetStateAction<string>>;
  setCloneGenericizeText: React.Dispatch<React.SetStateAction<boolean>>;
  setCloneNeutralizationInstructions: React.Dispatch<React.SetStateAction<string>>;
  setCreateRoutingConfig: React.Dispatch<React.SetStateAction<boolean>>;
  setDuplicatePolicy: React.Dispatch<React.SetStateAction<string>>;
  setImportScope: React.Dispatch<React.SetStateAction<"all" | "collection">>;
  setImportStep: React.Dispatch<React.SetStateAction<number>>;
  setInventoryMode: React.Dispatch<React.SetStateAction<InventoryMode>>;
  setInventoryQuantity: React.Dispatch<React.SetStateAction<string>>;
  setLimit: React.Dispatch<React.SetStateAction<string>>;
  setNeutralizeCloneProducts: React.Dispatch<React.SetStateAction<boolean>>;
  setPreview: React.Dispatch<React.SetStateAction<PreviewProduct[]>>;
  setPreviewCollections: React.Dispatch<React.SetStateAction<string[]>>;
  setPreviewKey: React.Dispatch<React.SetStateAction<string>>;
  setPreviewSearch: React.Dispatch<React.SetStateAction<string>>;
  setPreviewSort: React.Dispatch<React.SetStateAction<PreviewSort>>;
  setPublishToStorefront: React.Dispatch<React.SetStateAction<boolean>>;
  setRemoveExternalReferencesCloneProducts: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedSourceCollection: React.Dispatch<React.SetStateAction<SourceCollection | null>>;
  setSource: React.Dispatch<React.SetStateAction<string>>;
  setTargetStoreId: React.Dispatch<React.SetStateAction<string>>;
  setTranslateCloneProducts: React.Dispatch<React.SetStateAction<boolean>>;
  setTranslateVariantOptions: React.Dispatch<React.SetStateAction<boolean>>;
  source: string;
  sourceCollectionOptions: SourceCollection[];
  sourceDomain: string;
  stores: StoreOption[];
  t: (chave: string) => string;
  targetStoreId: string;
  toggleAllProducts: (checked: boolean) => void;
  toggleProductHandle: (handle: string, checked: boolean) => void;
  transformPreviewLoading: boolean;
  transformedPreview: TransformedPreviewProduct | null;
  translateCloneProducts: boolean;
  translateVariantOptions: boolean;
  visiblePreview: PreviewProduct[];
}

export function ImportWizard({
  applyLoading,
  applyLogoToCloneImages,
  applyProgress,
  cloneAbortRef,
  cloneAiMediaLimit,
  cloneCustomPrompt,
  cloneFailures,
  cloneGenericizeText,
  cloneNeutralizationInstructions,
  createRoutingConfig,
  duplicatePolicy,
  handleApply,
  handlePreview,
  handleTransformPreview,
  importMode,
  importScope,
  importStep,
  inventoryMode,
  inventoryQuantity,
  limit,
  loadSourceCollectionOptions,
  loadingSourceCollections,
  neutralizeCloneProducts,
  openInlineImport,
  preview,
  previewCollectionOptions,
  previewCollections,
  previewLoading,
  previewSearch,
  previewSort,
  publishToStorefront,
  removeExternalReferencesCloneProducts,
  selectedProductHandles,
  selectedSourceCollection,
  selectedTarget,
  setApplyLogoToCloneImages,
  setCloneAiMediaLimit,
  setCloneCustomPrompt,
  setCloneGenericizeText,
  setCloneNeutralizationInstructions,
  setCreateRoutingConfig,
  setDuplicatePolicy,
  setImportScope,
  setImportStep,
  setInventoryMode,
  setInventoryQuantity,
  setLimit,
  setNeutralizeCloneProducts,
  setPreview,
  setPreviewCollections,
  setPreviewKey,
  setPreviewSearch,
  setPreviewSort,
  setPublishToStorefront,
  setRemoveExternalReferencesCloneProducts,
  setSelectedSourceCollection,
  setSource,
  setTargetStoreId,
  setTranslateCloneProducts,
  setTranslateVariantOptions,
  source,
  sourceCollectionOptions,
  sourceDomain,
  stores,
  t,
  targetStoreId,
  toggleAllProducts,
  toggleProductHandle,
  transformPreviewLoading,
  transformedPreview,
  translateCloneProducts,
  translateVariantOptions,
  visiblePreview,
}: ImportWizardProps) {
  const massa = importMode === "bulk";
  const escopo: "product" | "collection" | "store" = !massa
    ? "product"
    : importScope === "collection"
      ? "collection"
      : "store";

  const passos = massa
    ? [
        [PASSO.DESTINO, "Destino"],
        [PASSO.ESCOPO, "Escopo"],
        [PASSO.ORIGEM, "Origem"],
        [PASSO.SELECAO, "Seleção"],
        [PASSO.OPCOES, "Opções"],
        [PASSO.REVISAO, "Revisão"],
      ]
    : [
        [PASSO.DESTINO, "Destino"],
        [PASSO.ESCOPO, "Escopo"],
        [PASSO.ORIGEM, "Origem"],
        [PASSO.OPCOES, "Opções"],
        [PASSO.REVISAO, "Revisão"],
      ];

  const ordem = passos.map(([n]) => n as number);
  const indiceAtual = Math.max(0, ordem.indexOf(importStep));

  /** O que trava o "Continuar" em cada passo, e a explicação do porquê. */
  const trava =
    importStep === PASSO.DESTINO && !targetStoreId
      ? "Escolha a loja de destino."
      : importStep === PASSO.ORIGEM && !source.trim()
        ? "Cole o link da origem."
        : importStep === PASSO.ORIGEM && escopo === "collection" && !selectedSourceCollection
          ? "Escolha a coleção."
          : importStep === PASSO.SELECAO && preview.length > 0 && selectedProductHandles.length === 0
            ? "Selecione ao menos um produto."
            : null;

  function avancar() {
    if (trava) return;
    const proximo = ordem[Math.min(ordem.length - 1, indiceAtual + 1)];
    setImportStep(proximo);
  }

  function voltar() {
    setImportStep(ordem[Math.max(0, indiceAtual - 1)]);
  }

  /** Trocar de escopo invalida qualquer catálogo já lido da origem antiga. */
  function escolherEscopo(novo: "product" | "collection" | "store") {
    setPreview([]);
    setPreviewKey("");
    setSelectedSourceCollection(null);
    if (novo === "product") {
      openInlineImport("single");
      setImportScope("all");
      return;
    }
    openInlineImport("bulk");
    setImportScope(novo === "collection" ? "collection" : "all");
  }

  const dominioOrigem = (source || "").replace(/^https?:\/\//, "").split("/")[0];

  // A lista pode ter milhares de linhas e cada uma pergunta se esta marcada.
  // Com array isso e uma varredura por linha; com Set e uma consulta so.
  const marcados = useMemo(
    () => new Set(selectedProductHandles),
    [selectedProductHandles]
  );

  const escolhidos = preview.filter((p) => marcados.size === 0 || marcados.has(p.handle));
  const variantesEscolhidas = escolhidos.reduce((s, p) => s + p.variants.length, 0);
  const todosVisiveisMarcados =
    visiblePreview.length > 0 && visiblePreview.every((p) => marcados.has(p.handle));

  const rotuloEscopo =
    escopo === "product"
      ? "Produto único"
      : escopo === "collection"
        ? `Coleção: ${selectedSourceCollection?.title || "—"}`
        : "Loja inteira";

  const marcas = [
    publishToStorefront && "Publicar",
    translateCloneProducts && "Traduzir",
    translateVariantOptions && "Traduzir variações",
    neutralizeCloneProducts && "Neutralizar",
    removeExternalReferencesCloneProducts && "Limpar refs externas",
    applyLogoToCloneImages && "Aplicar logo",
    createRoutingConfig && "Preparar rota",
    inventoryMode === "tracked" && `Estoque: ${inventoryQuantity}`,
    duplicatePolicy === "skip" ? "Pular duplicados" : "Criar duplicados",
  ].filter(Boolean) as string[];

  return (
    <div className="flex max-w-[760px] flex-col gap-[18px]">
      {/* Trilha dos passos. Passo já vencido volta com um clique; passo à
          frente não, porque ele depende do que ainda não foi preenchido. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {passos.map(([n, rotulo], i) => {
          const numero = n as number;
          const feito = i < indiceAtual;
          const atual = numero === importStep;
          return (
            <button
              key={numero}
              type="button"
              onClick={() => (feito ? setImportStep(numero) : undefined)}
              className="flex items-center gap-[7px] py-0.5 pl-0.5 pr-2 text-[12.5px]"
              style={{
                color: atual ? "var(--ink)" : feito ? "var(--t1)" : "var(--t4)",
                fontWeight: atual ? 600 : 500,
                cursor: feito ? "pointer" : "default",
              }}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px]"
                style={{
                  border: `1px solid ${feito ? "var(--ok-border)" : atual ? "var(--solid)" : "var(--border)"}`,
                  background: feito ? "var(--ok-bg)" : atual ? "var(--solid)" : "var(--surface)",
                  color: feito ? "var(--ok)" : atual ? "var(--on-solid)" : "var(--t4)",
                }}
              >
                {feito ? "✓" : i + 1}
              </span>
              {rotulo as string}
            </button>
          );
        })}
      </div>

      {/* ---------------------------------------------------- 1. destino */}
      {importStep === PASSO.DESTINO && (
        <div>
          <Titulo
            title="Para qual loja vai importar?"
            hint="Os produtos serão criados nesta loja. Depois você liga por SKU nos checkouts."
          />
          {stores.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center">
              <p className="text-[15px] font-semibold text-ink">Nenhuma loja conectada</p>
              <p className="mx-auto mt-1.5 max-w-[360px] text-[12.5px] text-t2">
                Conecte uma loja Shopify antes de importar — é nela que os produtos
                serão criados.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-[7px]">
              {stores.map((loja) => {
                const on = targetStoreId === loja.id;
                return (
                  <button
                    key={loja.id}
                    type="button"
                    onClick={() => setTargetStoreId(loja.id)}
                    className="flex items-center gap-[11px] rounded-[7px] px-[13px] py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
                    style={{
                      border: `1px solid ${on ? "var(--solid)" : "var(--border)"}`,
                      background: on ? "var(--surface-2)" : "var(--surface)",
                    }}
                  >
                    <Radio on={on} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-ink">
                        {loja.name}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-t3">
                        {loja.shop_domain}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- 2. escopo */}
      {importStep === PASSO.ESCOPO && (
        <div>
          <Titulo
            title="Quanto do catálogo?"
            hint="Isso define o tipo de link que vamos pedir no próximo passo. Variantes acompanham os produtos."
          />
          <div className="grid grid-cols-1 gap-[9px] sm:grid-cols-3">
            {(
              [
                ["product", "Produto único", "Link direto de um produto."],
                ["collection", "Coleção", "Todos os produtos de uma coleção."],
                ["store", "Loja inteira", "Catálogo completo da origem."],
              ] as const
            ).map(([id, rotulo, desc]) => {
              const on = escopo === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => escolherEscopo(id)}
                  className="flex flex-col gap-[5px] rounded-lg px-3.5 py-[13px] text-left transition-colors hover:border-[var(--border-strong)]"
                  style={{
                    border: `1px solid ${on ? "var(--solid)" : "var(--border)"}`,
                    background: on ? "var(--surface-2)" : "var(--surface)",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Radio on={on} />
                    <span className="text-[12.5px] font-semibold text-ink">{rotulo}</span>
                  </span>
                  <span className="text-[12px] leading-[1.4] text-t3">{desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- 3. origem */}
      {importStep === PASSO.ORIGEM && (
        <div>
          <Titulo
            title={
              escopo === "product"
                ? "Cole o link do produto"
                : escopo === "collection"
                  ? "Cole o link da loja da coleção"
                  : "Cole o link da loja de origem"
            }
            hint="Lemos o catálogo público desse endereço e listamos o que pode ser importado."
          />
          <div className="flex items-center gap-[7px]">
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={
                escopo === "product"
                  ? "https://loja-origem.com/products/tenis-runner-pro"
                  : "https://loja-origem.com"
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={cn(CAMPO, "min-w-0 flex-1 font-mono")}
            />
            {escopo === "collection" && (
              <button
                type="button"
                onClick={loadSourceCollectionOptions}
                disabled={loadingSourceCollections || !source.trim()}
                className={cn(BOTAO_PRI, "inline-flex items-center gap-1.5 !h-[34px]")}
                style={{
                  background: source.trim() ? "var(--solid)" : "var(--border-strong)",
                }}
              >
                {loadingSourceCollections && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {sourceCollectionOptions.length > 0 ? "Ler de novo" : "Ler coleções"}
              </button>
            )}
          </div>
          <div className="mt-[7px] text-[11.5px] text-t4">
            Somente leitura. A loja de origem não é alterada.
          </div>

          {massa && escopo === "store" && (
            <div className="mt-3.5 flex items-end gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-t2">{t("limit_label")}</span>
                <input
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  type="number"
                  min={1}
                  max={MAX_CLONE_LIMIT}
                  inputMode="numeric"
                  className={cn(CAMPO, "w-[120px] font-mono")}
                />
              </label>
              <span className="pb-2 text-[11.5px] text-t4">
                Teto de produtos lidos da origem.
              </span>
            </div>
          )}

          {escopo === "collection" && (
            <div className="mt-3.5">
              {sourceCollectionOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-6 py-8 text-center text-[12.5px] text-t3">
                  {loadingSourceCollections
                    ? "Lendo as coleções da origem…"
                    : "Cole o link da loja e leia as coleções para escolher uma."}
                </div>
              ) : (
                <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border bg-surface">
                  {sourceCollectionOptions.map((colecao) => {
                    const on = selectedSourceCollection?.handle === colecao.handle;
                    return (
                      <button
                        key={colecao.handle}
                        type="button"
                        onClick={() => {
                          setSelectedSourceCollection(colecao);
                          setPreview([]);
                          setPreviewKey("");
                        }}
                        className="flex w-full items-center gap-[11px] border-b border-[var(--border-subtle)] px-3.5 py-[9px] text-left transition-colors last:border-b-0 hover:bg-surface-2"
                        style={{
                          background: on ? "var(--surface-2)" : "var(--surface)",
                          contentVisibility: "auto",
                          containIntrinsicSize: "0 42px",
                        }}
                      >
                        <Radio on={on} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {colecao.title}
                          </span>
                          <span className="block truncate font-mono text-[10.5px] text-t3">
                            /collections/{colecao.handle}
                          </span>
                        </span>
                        {typeof colecao.productsCount === "number" && (
                          <span className="shrink-0 text-[12px] tabular-nums text-t3">
                            {colecao.productsCount} produtos
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- 4. seleção */}
      {importStep === PASSO.SELECAO && massa && (
        <div>
          <div className="mb-[11px] flex items-end gap-3">
            <div className="flex-1">
              <h2 className="mb-[3px] text-[15px] font-semibold text-ink">
                Produtos encontrados
              </h2>
              <p className="text-[12.5px] text-t2">
                {preview.length === 0
                  ? "Leia o catálogo da origem para listar o que pode ser importado."
                  : `${selectedProductHandles.length} de ${preview.length} produtos selecionados · origem ${sourceDomain || dominioOrigem}`}
              </p>
            </div>
            {preview.length === 0 ? (
              <button
                type="button"
                onClick={handlePreview}
                disabled={
                  previewLoading ||
                  !source.trim() ||
                  (escopo === "collection" && !selectedSourceCollection)
                }
                className={cn(BOTAO_PRI, "inline-flex items-center gap-1.5")}
                style={{ background: "var(--solid)" }}
              >
                {previewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Ler catálogo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => toggleAllProducts(!todosVisiveisMarcados)}
                className="h-[27px] rounded-md border border-[var(--border-strong)] bg-surface px-2.5 text-[12px] font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                {todosVisiveisMarcados ? "Desmarcar visíveis" : "Selecionar visíveis"}
              </button>
            )}
          </div>

          {preview.length > 0 && (
            <>
              {/* Resumo do que foi lido, no formato do design: três números
                  lado a lado num cartão só. */}
              <div className="mb-[11px] overflow-hidden rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-[9px] border-b border-[var(--border-subtle)] px-4 py-[13px]">
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: "var(--ok)" }}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold text-ink">
                      Catálogo lido
                    </span>
                    <span className="block truncate font-mono text-[10.5px] text-t3">
                      {sourceDomain || dominioOrigem}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-3">
                  {[
                    ["Produtos", preview.length],
                    ["Variantes", preview.reduce((s, p) => s + p.variants.length, 0)],
                    ["Categorias", previewCollectionOptions.length],
                  ].map(([rotulo, valor]) => (
                    <div
                      key={String(rotulo)}
                      className="border-l border-[var(--border-subtle)] px-4 py-3 first:border-l-0"
                    >
                      <div className="text-[11.5px] text-t3">{rotulo}</div>
                      <div className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">
                        {valor}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Busca e ordenação: a lista pode ter milhares de linhas. */}
              <div className="mb-[11px] flex flex-col gap-[7px] sm:flex-row">
                <input
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  placeholder="Buscar por título, handle ou SKU"
                  className={cn(CAMPO, "flex-1")}
                />
                <select
                  value={previewSort}
                  onChange={(e) => setPreviewSort(e.target.value as PreviewSort)}
                  className={cn(CAMPO, "w-full sm:w-[200px]")}
                >
                  <option value="source">Ordem da origem</option>
                  <option value="recent">Mais recentes</option>
                  <option value="title_asc">Título (A-Z)</option>
                  <option value="title_desc">Título (Z-A)</option>
                  <option value="price_asc">Menor preço</option>
                  <option value="price_desc">Maior preço</option>
                </select>
              </div>

              {previewCollectionOptions.length > 0 && (
                <div className="mb-[11px] flex flex-wrap gap-[7px]">
                  <button
                    type="button"
                    onClick={() => setPreviewCollections([])}
                    className="h-[27px] rounded-md px-[11px] text-[12px] font-semibold"
                    style={{
                      border: `1px solid ${previewCollections.length === 0 ? "var(--solid)" : "var(--border)"}`,
                      background:
                        previewCollections.length === 0 ? "var(--solid)" : "var(--surface)",
                      color:
                        previewCollections.length === 0 ? "var(--on-solid)" : "var(--t2)",
                    }}
                  >
                    Todas as categorias
                  </button>
                  {previewCollectionOptions.map((colecao) => {
                    const on = previewCollections.includes(colecao.handle);
                    return (
                      <button
                        key={colecao.handle}
                        type="button"
                        onClick={() =>
                          setPreviewCollections((atual) =>
                            on
                              ? atual.filter((h) => h !== colecao.handle)
                              : [...atual, colecao.handle]
                          )
                        }
                        className="h-[27px] rounded-md px-[11px] text-[12px] font-semibold"
                        style={{
                          border: `1px solid ${on ? "var(--solid)" : "var(--border)"}`,
                          background: on ? "var(--solid)" : "var(--surface)",
                          color: on ? "var(--on-solid)" : "var(--t2)",
                        }}
                      >
                        {colecao.title}
                        <span className="ml-1.5 opacity-60">{colecao.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface">
                {visiblePreview.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12.5px] text-t3">
                    Nenhum produto corresponde ao filtro.
                  </p>
                ) : (
                  visiblePreview.map((produto) => {
                    const on = marcados.has(produto.handle);
                    return (
                      <button
                        key={produto.handle}
                        type="button"
                        onClick={() => toggleProductHandle(produto.handle, !on)}
                        className="flex w-full items-center gap-[11px] border-b border-[var(--border-subtle)] px-3.5 py-[9px] text-left transition-colors last:border-b-0 hover:bg-surface-2"
                        style={{ background: on ? "var(--surface-2)" : "var(--surface)" }}
                      >
                        <span
                          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[9px] text-[var(--on-solid)]"
                          style={{
                            border: `1px solid ${on ? "var(--solid)" : "var(--control-border)"}`,
                            background: on ? "var(--solid)" : "var(--surface)",
                          }}
                          aria-hidden
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {produto.title}
                          </span>
                          <span className="block truncate font-mono text-[11.5px] text-t3">
                            {produto.handle}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] text-t3">
                          {produto.variants.length} variantes
                        </span>
                        <span className="w-20 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-t1">
                          {produto.variants[0]?.price || "0.00"}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ----------------------------------------------------- 5. opções */}
      {importStep === PASSO.OPCOES && (
        <div>
          <Titulo
            title="Como os produtos entram"
            hint="Vale para todos os produtos desta importação. Dá para mudar depois, produto a produto."
          />

          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <OptionRow
              title="Publicar imediatamente"
              hint="Produtos entram como rascunho se desligado."
              on={publishToStorefront}
              onChange={setPublishToStorefront}
            />
            <OptionRow
              title="Traduzir produto"
              hint="Título e descrição no idioma da loja de destino."
              on={translateCloneProducts}
              onChange={setTranslateCloneProducts}
            />
            <OptionRow
              title="Traduzir variações"
              hint="blue → azul, S/small → P."
              on={translateVariantOptions}
              onChange={setTranslateVariantOptions}
            />
          </div>

          <Secao title="Conteúdo" />
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {/* Neutralizar e limpar referências se excluem: um reescreve a
                marca, o outro a preserva de propósito. */}
            <OptionRow
              title="Neutralizar (stock)"
              hint="Remove marcas, inclusive do próprio produto."
              on={neutralizeCloneProducts}
              onChange={(v) => {
                setNeutralizeCloneProducts(v);
                if (v) setRemoveExternalReferencesCloneProducts(false);
              }}
            >
              {neutralizeCloneProducts && (
                <div className="border-t border-[var(--border-subtle)] bg-surface-2 px-[15px] py-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={cloneGenericizeText}
                      onChange={(e) => setCloneGenericizeText(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--solid)]"
                    />
                    <span className="text-[12px] text-t2">
                      Genericizar nome e descrição (Air Jordan → Tênis esportivo).
                    </span>
                  </label>
                  <label className="mt-3 block">
                    <span className="text-[12px] text-t2">
                      Instruções extras para a neutralização
                    </span>
                    <textarea
                      rows={2}
                      value={cloneNeutralizationInstructions}
                      onChange={(e) => setCloneNeutralizationInstructions(e.target.value)}
                      placeholder="Ex.: remover só o patch FIFA, manter o escudo do time."
                      className="mt-1.5 w-full rounded-md border border-[var(--control-border)] bg-surface px-[11px] py-2 text-[12px] text-ink outline-none focus:border-[var(--border-strong)]"
                    />
                  </label>
                </div>
              )}
            </OptionRow>
            <OptionRow
              title="Retirar referências externas"
              hint="Mantém marcas reais, limpa origem e vendedor."
              on={removeExternalReferencesCloneProducts}
              onChange={(v) => {
                setRemoveExternalReferencesCloneProducts(v);
                if (v) setNeutralizeCloneProducts(false);
              }}
            />
            <OptionRow
              title="Aplicar logo nas imagens"
              hint="Marca as imagens em massa com o logo da loja."
              on={applyLogoToCloneImages}
              onChange={setApplyLogoToCloneImages}
            />
            {(neutralizeCloneProducts || removeExternalReferencesCloneProducts) && (
              <div className="flex items-center gap-3.5 border-t border-[var(--border-subtle)] px-[15px] py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-ink">
                    Mídias com IA por produto
                  </div>
                  <div className="text-[12px] text-t3">
                    A IA processa só as primeiras; as outras seguem originais.
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={cloneAiMediaLimit}
                  onChange={(e) => setCloneAiMediaLimit(e.target.value)}
                  className={cn(CAMPO, "w-[80px] shrink-0 text-right font-mono")}
                />
              </div>
            )}
          </div>

          <div className="mt-[9px]">
            <CustomPromptDialog
              value={cloneCustomPrompt}
              onChange={(novo) => setCloneCustomPrompt(novo)}
              className="w-full"
            />
          </div>

          <Secao title="Estoque e duplicados" />
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] px-[15px] py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">Estoque</div>
                <div className="text-[12px] text-t3">
                  Sem controle, a Shopify nunca marca o produto como esgotado.
                </div>
              </div>
              <select
                value={inventoryMode}
                onChange={(e) => setInventoryMode(e.target.value as InventoryMode)}
                className={cn(CAMPO, "w-[190px] shrink-0")}
              >
                <option value="not_tracked">Sem controle de estoque</option>
                <option value="tracked">Definir estoque inicial</option>
              </select>
              <input
                value={inventoryQuantity}
                onChange={(e) => setInventoryQuantity(e.target.value)}
                type="number"
                min={0}
                disabled={inventoryMode === "not_tracked"}
                className={cn(CAMPO, "w-[80px] shrink-0 text-right font-mono disabled:opacity-40")}
              />
            </div>
            <div className="flex items-center gap-3.5 border-b border-[var(--border-subtle)] px-[15px] py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-ink">
                  Produto que já existe no destino
                </div>
                <div className="text-[12px] text-t3">
                  Comparado pelo handle da origem.
                </div>
              </div>
              <select
                value={duplicatePolicy}
                onChange={(e) => setDuplicatePolicy(e.target.value)}
                className={cn(CAMPO, "w-[190px] shrink-0")}
              >
                <option value="skip">{t("skip_existing")}</option>
                <option value="create">{t("create_anyway")}</option>
              </select>
            </div>
            <OptionRow
              title="Preparar rota (checkout roteado)"
              hint="Já grava o mapa de SKU para usar com a vitrine."
              on={createRoutingConfig}
              onChange={setCreateRoutingConfig}
            />
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- 6. revisão */}
      {importStep === PASSO.REVISAO && (
        <div>
          <Titulo
            title="Pronto para importar"
            hint="Revise antes de iniciar. A importação pode ser interrompida a qualquer momento."
          />
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {[
              ["Escopo", rotuloEscopo],
              ["Origem", sourceDomain || dominioOrigem || "—"],
              [
                "Produtos",
                massa ? String(escolhidos.length || preview.length) : "1",
              ],
              ["Variantes", massa ? String(variantesEscolhidas) : "—"],
              ["Destino", formatStoreLabel(selectedTarget)],
            ].map(([rotulo, valor]) => (
              <div
                key={rotulo}
                className="flex justify-between gap-4 border-b border-[var(--border-subtle)] px-[15px] py-2.5 last:border-b-0"
              >
                <span className="text-[12.5px] text-t2">{rotulo}</span>
                <span className="truncate text-[12.5px] font-semibold text-ink">{valor}</span>
              </div>
            ))}
          </div>

          {marcas.length > 0 && (
            <div className="mt-[11px] flex flex-wrap gap-1.5">
              {marcas.map((marca) => (
                <span
                  key={marca}
                  className="rounded border border-border bg-surface-2 px-[7px] py-0.5 text-[11.5px] font-medium text-t2"
                >
                  {marca}
                </span>
              ))}
            </div>
          )}

          {/* Confere um produto com os critérios atuais antes de gastar
              crédito no catálogo inteiro. */}
          <Secao title="Conferir um produto" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTransformPreview}
              disabled={transformPreviewLoading || !source.trim() || !targetStoreId}
              className={cn(BOTAO_SEC, "inline-flex items-center gap-1.5")}
            >
              {transformPreviewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Visualizar 1 produto
            </button>
            {!transformedPreview && (
              <span className="text-[11.5px] text-t4">
                Mostra como fica com as opções escolhidas.
              </span>
            )}
          </div>
          {transformedPreview && (
            <div className="mt-2.5">
              <TransformedPreviewCard preview={transformedPreview} />
            </div>
          )}

          {applyProgress && (
            <div className="mt-3.5 rounded-lg border border-border bg-surface p-[22px]">
              <div className="mb-2.5 flex items-baseline gap-2.5">
                <span className="text-[15px] font-semibold text-ink">Importando</span>
                <span className="text-[12.5px] text-t3">{applyProgress.message}</span>
                <div className="flex-1" />
                <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
                  {applyProgress.total > 0
                    ? `${applyProgress.current}/${applyProgress.total}`
                    : "…"}
                </span>
              </div>
              <div
                className="h-[5px] overflow-hidden rounded-[3px]"
                style={{ background: "var(--track)" }}
              >
                <div
                  className="h-[5px] rounded-[3px] transition-[width] duration-150"
                  style={{
                    background: "var(--solid)",
                    width:
                      applyProgress.total > 0
                        ? `${Math.min(100, (applyProgress.current / applyProgress.total) * 100)}%`
                        : "8%",
                  }}
                />
              </div>
              <div className="mt-[11px] flex items-center justify-between gap-3">
                <span className="text-[12px] text-t3">
                  {applyProgress.created} criados · {applyProgress.skipped} pulados ·{" "}
                  {applyProgress.failed} falhas
                </span>
                {applyLoading && applyProgress.phase !== "done" && (
                  <button
                    type="button"
                    onClick={() => cloneAbortRef.current?.abort()}
                    className="h-[24px] rounded-[5px] border border-border bg-surface px-2 text-[11.5px] font-semibold text-t2 transition-colors hover:border-[var(--border-strong)]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          )}

          {cloneFailures.length > 0 && (
            <details
              className="mt-3.5 rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--err-border)", background: "var(--err-bg)" }}
            >
              <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">
                {cloneFailures.length} produto(s) não importado(s) — ver motivo
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                {cloneFailures.map((falha, i) => (
                  <li key={`${falha.handle}-${i}`} className="text-[11.5px] text-t2">
                    <span className="font-mono text-ink">{falha.handle}</span>: {falha.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ navegação */}
      <div className="flex items-center gap-2">
        {indiceAtual > 0 && (
          <button
            type="button"
            onClick={voltar}
            disabled={applyLoading}
            className={BOTAO_SEC}
          >
            Voltar
          </button>
        )}
        {importStep === PASSO.REVISAO ? (
          <button
            type="button"
            onClick={handleApply}
            disabled={
              applyLoading ||
              !source.trim() ||
              !targetStoreId ||
              (massa && preview.length > 0 && selectedProductHandles.length === 0)
            }
            className={cn(BOTAO_PRI, "inline-flex items-center gap-1.5")}
            style={{ background: "var(--solid)" }}
          >
            {applyLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Iniciar importação
          </button>
        ) : (
          <button
            type="button"
            onClick={avancar}
            disabled={Boolean(trava)}
            className={BOTAO_PRI}
            style={{ background: trava ? "var(--border-strong)" : "var(--solid)" }}
          >
            Continuar
          </button>
        )}
        {trava && <span className="text-[11.5px] text-t4">{trava}</span>}
      </div>
    </div>
  );
}
