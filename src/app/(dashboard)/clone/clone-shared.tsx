"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";

// Tipos e utilitarios compartilhados entre a tela de importacao e o
// assistente, que virou modulo proprio para sair do primeiro download.

export interface StoreOption {
  id: string;
  name: string;
  shop_domain: string;
}

export interface PreviewProduct {
  id: number;
  title: string;
  handle: string;
  images: { src: string }[];
  variants: { id: number; sku: string | null; price: string }[];
  sourceUrl: string;
  collectionHandles?: string[];
}

// Ordenacao da lista de preview. "source" mantem a ordem em que a loja de
// origem publicou os produtos (padrao); "recent" usa o id, que na Shopify
// cresce com o tempo de criacao.
export type PreviewSort =
  | "source"
  | "title_asc"
  | "title_desc"
  | "price_asc"
  | "price_desc"
  | "recent";

export function previewPrice(product: PreviewProduct) {
  const prices = (product.variants || [])
    .map((variant) => Number.parseFloat(variant.price))
    .filter((value) => Number.isFinite(value) && value > 0);
  return prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

export interface TransformedPreviewProduct {
  source: {
    title: string;
    handle: string;
    images: { src: string }[];
  };
  transformed: {
    title: string;
    descriptionHtml: string;
    tags: string[];
    seo?: { title?: string; description?: string };
    images: { src: string; altText?: string | null }[];
    variants: { price?: string; compareAtPrice?: string; options?: string[] }[];
  };
  neutralized: boolean;
  logoAppliedCount: number;
  warnings: string[];
}

export interface SourceCollection {
  id: number;
  title: string;
  handle: string;
  image?: string | null;
  productsUrl: string;
  /** Quantos produtos a colecao tem na origem (vem da /collections.json). */
  productsCount?: number | null;
}


export interface CloneRun {
  id: string;
  source_domain: string;
  action: string;
  status: string;
  product_count: number;
  result: {
    createdCount?: number;
    skippedCount?: number;
    failedCount?: number;
    skuMapCount?: number;
    variantMapCount?: number;
  } | null;
  created_at: string;
}

export interface CloneApplyProgress {
  phase: "analyzing" | "importing" | "routing" | "done";
  current: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  message: string;
}

// O roteamento saiu daqui: vive na propria tela (clone/routed-checkout/page.tsx).
export type CloneView = "overview" | "shopify";
export type InventoryMode = "not_tracked" | "tracked";
export type ImportMode = "single" | "bulk";



export const DEFAULT_CLONE_LIMIT = 250;
export const MAX_CLONE_LIMIT = 5000;
export const CLONE_BATCH_SIZE = 5;


export function parseCloneLimit(value: string) {
  const numeric = Number(value || DEFAULT_CLONE_LIMIT);
  if (!Number.isFinite(numeric)) return DEFAULT_CLONE_LIMIT;
  return Math.min(Math.max(Math.floor(numeric), 1), MAX_CLONE_LIMIT);
}

export function parseInventoryQuantity(value: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

export function parseAiMediaLimit(value: string) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.floor(numeric), 1), 20);
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function stripPreviewHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function TransformedPreviewCard({
  preview,
}: {
  preview: TransformedPreviewProduct;
}) {
  const firstImage = preview.transformed.images?.[0]?.src;
  const firstPrice = preview.transformed.variants?.[0]?.price;
  const description = stripPreviewHtml(preview.transformed.descriptionHtml || "");

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/8 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Visualizacao IA
          </p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            Como este produto vai ficar
          </h3>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {preview.neutralized && (
            <Badge variant="secondary" className="rounded-md">
              Neutralizado
            </Badge>
          )}
          {preview.logoAppliedCount > 0 && (
            <Badge variant="secondary" className="rounded-md">
              Logo aplicada
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[96px_minmax(0,1fr)]">
        <div className="h-24 w-24 overflow-hidden rounded-lg border border-border/60 bg-background/70">
          {firstImage ? (
            <img src={firstImage} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">Original</p>
          <p className="truncate text-xs text-muted-foreground">
            {preview.source.title}
          </p>
          <p className="mt-2 text-sm font-semibold leading-5 text-foreground">
            {preview.transformed.title}
          </p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
            {description || "Sem descricao gerada."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{preview.transformed.images.length} midia(s)</span>
            <span>{preview.transformed.variants.length} variante(s)</span>
            {firstPrice ? <span>Preco: {firstPrice}</span> : null}
          </div>
        </div>
      </div>

      {preview.transformed.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {preview.transformed.tags.slice(0, 6).map((tag) => (
            <Badge key={tag} variant="outline" className="rounded-md text-[11px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {preview.warnings.length > 0 && (
        <p className="mt-3 text-xs leading-5 text-amber-500">
          {preview.warnings.length} aviso(s) na transformacao. A importacao em massa
          ainda pode continuar usando as midias originais quando a IA falhar.
        </p>
      )}
    </div>
  );
}

export function cloneSourceKey(sourceValue: string, limitValue: number) {
  return `${sourceValue.trim().toLowerCase()}::${limitValue}`;
}


export function looksLikeGeneratedId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function looksLikeDomain(value: string) {
  return /\.|myshopify\.com|shopify\.com/i.test(value);
}

export function formatDomainLabel(value?: string | null) {
  if (!value) return "";
  const clean = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^admin\.shopify\.com\/store\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .replace(/\.myshopify\.com$/i, "");

  const base = clean.includes(".") ? clean.split(".")[0] : clean;
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


export function formatStoreLabel(store?: StoreOption) {
  if (!store) return "Selecione uma loja";
  const name = store.name?.trim();
  if (name && name !== store.id && !looksLikeGeneratedId(name) && !looksLikeDomain(name)) {
    return name;
  }
  const domainLabel = formatDomainLabel(store.shop_domain || name);
  if (domainLabel) return domainLabel;
  return `Loja ${store.id.slice(0, 8)}`;
}
