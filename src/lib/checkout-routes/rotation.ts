import {
  resolveCheckoutLinesDetailed,
  type CheckoutRouteLine,
  type ResolvedLineDetail,
} from "@/lib/shopify/cart-routing";

export type RotationStrategy = "sticky" | "each_checkout";

export interface RotationConfig {
  strategy?: RotationStrategy;
}

export interface RouteTargetSettings {
  checkout_domain?: string;
  checkout_country?: string;
  checkout_locale?: string;
}

export interface RouteTarget {
  id: string;
  targetStoreId: string;
  /** Dominio ja resolvido (override da rota > dominio da loja). */
  domain: string;
  storeName?: string;
  weight: number;
  enabled: boolean;
  skuMap: Record<string, string | number>;
  variantMap: Record<string, string | number>;
  settings: RouteTargetSettings;
  targetLanguage?: string | null;
}

export interface TargetCoverage {
  target: RouteTarget;
  /** Linhas do carrinho que este destino consegue resolver. */
  resolved: ResolvedLineDetail[];
  resolvedCount: number;
  totalCount: number;
  /** 0..1 */
  coverage: number;
}

export interface RotationPick {
  chosen: TargetCoverage;
  /** Destinos que empataram na melhor cobertura e disputaram o sorteio. */
  eligible: TargetCoverage[];
  /** Cobertura de todos os destinos ligados, para telemetria e UI. */
  all: TargetCoverage[];
  reason: "single" | "weighted" | "best_coverage_fallback";
}

export function normalizeRotation(value: unknown): Required<RotationConfig> {
  const raw = (value || {}) as RotationConfig;
  return {
    strategy: raw.strategy === "each_checkout" ? "each_checkout" : "sticky",
  };
}

/**
 * Hash estavel (FNV-1a 32 bits) da chave de rodizio.
 *
 * Precisa ser identico ao do loader (public/routed-checkout-loader.js) para
 * que a escolha inline no navegador e a escolha no servidor caiam na MESMA
 * loja de checkout. Se divergirem, o comprador que resolve inline numa visita
 * e pela API na seguinte troca de checkout no meio da compra.
 */
export function hashRotationKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    // FNV prime 16777619, em aritmetica de 32 bits sem estourar o double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function computeCoverage(
  targets: RouteTarget[],
  lines: CheckoutRouteLine[]
): TargetCoverage[] {
  const totalCount = lines.length;
  return targets.map((target) => {
    const resolved = resolveCheckoutLinesDetailed(lines, {
      skuMap: target.skuMap,
      variantMap: target.variantMap,
    });
    const resolvedCount = resolved.filter((line) => line.variantId).length;
    return {
      target,
      resolved,
      resolvedCount,
      totalCount,
      coverage: totalCount === 0 ? 0 : resolvedCount / totalCount,
    };
  });
}

/**
 * Escolhe a loja de checkout que vai receber ESTE carrinho.
 *
 * A regra que manda em tudo: **rodizio nunca custa item de carrinho.** Um
 * destino so entra no sorteio se cobre o carrinho tao bem quanto o melhor
 * destino disponivel. Sortear "de forma justa" entre uma loja que resolve 5
 * de 5 itens e outra que resolve 3 mandaria o comprador para um checkout com
 * dois itens a menos -- o rodizio existe para diluir volume entre contas de
 * pagamento, nao para perder venda.
 *
 * Entre os que empatam na melhor cobertura, o sorteio e ponderado por `weight`
 * e ancorado em `rotationKey`:
 *   - sticky: a chave e do comprador (guardada no navegador dele), entao ele
 *     cai sempre na mesma loja -- abandonar o carrinho e voltar reencontra o
 *     mesmo checkout, e o pixel da loja de checkout nao ve o mesmo usuario
 *     pulando entre dominios.
 *   - each_checkout: a chave e aleatoria por clique.
 */
/**
 * Chave que ordena a fila do sorteio.
 *
 * PRECISA ser identica a do loader (public/routed-checkout-loader.js), que usa
 * `a.target.id || a.target.domain`. O embed-config manda `id: null` de
 * proposito para rota legada; ordenar so por id fazia o servidor comparar
 * string vazia enquanto o loader comparava dominio, e com dois destinos nessa
 * situacao as filas saem diferentes -- o comprador troca de checkout no meio da
 * compra. Coberto por tests/rotation-parity.test.ts.
 */
export function rotationOrderKey(target: { id?: string | null; domain?: string | null }) {
  return String(target.id || target.domain || "");
}

export function pickTarget(
  targets: RouteTarget[],
  lines: CheckoutRouteLine[],
  options: { rotationKey?: string; strategy?: RotationStrategy } = {}
): RotationPick | null {
  const active = targets.filter((t) => t.enabled && t.domain);
  if (active.length === 0) return null;

  const all = computeCoverage(active, lines);

  // So disputam o sorteio os destinos que empatam na melhor cobertura.
  const bestCoverage = Math.max(...all.map((c) => c.resolvedCount));
  if (bestCoverage === 0) return null;
  const bestPool = all.filter((c) => c.resolvedCount === bestCoverage);

  // Peso 0 = configurado mas fora do rodizio (conta em aquecimento, ou
  // pausada sem perder o mapa). So volta a valer se for o unico que cobre o
  // carrinho -- ai e ele ou checkout parcial.
  const weighted = bestPool.filter((c) => c.target.weight > 0);
  const pool = weighted.length > 0 ? weighted : bestPool;

  if (pool.length === 1) {
    return {
      chosen: pool[0],
      eligible: pool,
      all,
      reason: weighted.length === 0 ? "best_coverage_fallback" : "single",
    };
  }

  const strategy = options.strategy === "each_checkout" ? "each_checkout" : "sticky";
  const key =
    strategy === "sticky" && options.rotationKey
      ? options.rotationKey
      : `${Math.random()}`;

  const totalWeight = pool.reduce((sum, c) => sum + Math.max(1, c.target.weight), 0);
  // Ordem estavel: o sorteio ancorado so e reprodutivel se a fila nao muda de
  // ordem entre uma consulta e outra (o Postgres nao garante ordem sem ORDER BY,
  // e o mesmo comprador tem que cair sempre no mesmo destino).
  //
  // A chave e `id || domain`, IGUAL ao loader. Ordenar so por id divergia do
  // inline: embed-config manda `id: null` de proposito para rota legada, entao
  // o loader caia no domain e o servidor comparava string vazia. Com dois
  // destinos nessa situacao as duas filas saem em ordem diferente e o comprador
  // troca de checkout no meio da compra -- ver tests/rotation-parity.test.ts.
  const ordered = [...pool].sort((a, b) =>
    rotationOrderKey(a.target).localeCompare(rotationOrderKey(b.target))
  );
  let cursor = hashRotationKey(key) % totalWeight;

  for (const candidate of ordered) {
    cursor -= Math.max(1, candidate.target.weight);
    if (cursor < 0) {
      return { chosen: candidate, eligible: pool, all, reason: "weighted" };
    }
  }

  return { chosen: ordered[ordered.length - 1], eligible: pool, all, reason: "weighted" };
}
