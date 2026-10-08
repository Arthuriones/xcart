import type { CheckoutRouteLine } from "@/lib/shopify/cart-routing";
import { resolveVariantIdsBySku } from "@/lib/shopify/public-store";
import { computeCoverage, type RouteTarget } from "@/lib/checkout-routes/rotation";

/**
 * Quanto o /resolve espera o products.json da loja de checkout.
 *
 * PAR com PRAZO_REDE_MS de public/routed-checkout-loader.js (15 s). O loader
 * desiste do /resolve nesse prazo e mostra erro ao comprador. Sem orcamento
 * aqui, a primeira leitura do indice de SKU de uma loja de checkout grande
 * (ate 20 paginas de products.json em serie, pelo proxy -- ha destino com
 * 9.538 SKUs) passava disso com facilidade: o loader cortava em 15 s uma rota
 * que o servidor ainda terminaria. O orcamento deixa folga para o banco, o
 * cold start e a rede do comprador. tests/resolve-orcamento.test.ts trava a
 * relacao entre os dois numeros.
 */
export const ORCAMENTO_HIDRATACAO_MS = 8000;

export interface OpcoesHidratacao {
  /** Padrao: ORCAMENTO_HIDRATACAO_MS. */
  orcamentoMs?: number;
  /**
   * Recebe a leitura que estourou o orcamento, para ela seguir depois da
   * resposta (o /resolve passa `after` do Next). Ela termina e aquece o
   * cache do indice: a proxima tentativa do comprador acha o SKU na hora.
   */
  continuarDepois?: (leitura: Promise<unknown>) => void;
}

/**
 * Completa o sku_map do destino, em memoria, com o que der para resolver no
 * products.json publico dele. Nao grava nada -- quem consolida o mapa e o
 * heal; aqui e so para o carrinho da vez nao perder item.
 *
 * Se a leitura nao cabe no orcamento, devolve o destino como esta: o mesmo
 * desfecho de quando a loja esta fora do ar.
 */
export async function hydrateTargetBySku(
  target: RouteTarget,
  lines: CheckoutRouteLine[],
  opcoes: OpcoesHidratacao = {}
): Promise<RouteTarget> {
  const [coverage] = computeCoverage([target], lines);
  const missing = coverage.resolved
    .filter((line) => !line.variantId && line.sku)
    .map((line) => line.sku);

  if (missing.length === 0 || !target.domain) return target;

  // resolveVariantIdsBySku ja devolve mapa vazio em erro; o catch e para nada
  // escapar como rejeicao sem dono depois que o orcamento estourar.
  const leitura = resolveVariantIdsBySku(target.domain, missing).catch(
    () => new Map<string, number>()
  );

  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<null>((resolver) => {
    relogio = setTimeout(() => resolver(null), opcoes.orcamentoMs ?? ORCAMENTO_HIDRATACAO_MS);
  });
  const bySku = await Promise.race([leitura, estouro]);
  clearTimeout(relogio);

  if (bySku === null) {
    try {
      opcoes.continuarDepois?.(leitura);
    } catch {
      // `after` fora do escopo da requisicao lanca. A leitura segue solta,
      // como antes; o que nao pode e virar 500 no checkout do comprador.
    }
    return target;
  }
  if (bySku.size === 0) return target;

  const skuMap = { ...target.skuMap };
  for (const [sku, variantId] of bySku.entries()) {
    skuMap[String(sku).trim().toLowerCase()] = String(variantId);
  }
  return { ...target, skuMap };
}
