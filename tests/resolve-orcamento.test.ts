import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RouteTarget } from "@/lib/checkout-routes/rotation";

/**
 * O loader desiste do /resolve em PRAZO_REDE_MS (15 s) e mostra erro ao
 * comprador. A hidratacao pelo products.json da loja de checkout nao tinha
 * prazo nenhum: frio, o indice de SKU de um catalogo grande (ate 20 paginas
 * em serie pelo proxy) passava disso, e o loader cortava uma rota que o
 * servidor ainda terminaria.
 *
 * Aqui fica travado o par: o servidor espera no maximo
 * ORCAMENTO_HIDRATACAO_MS, com folga para o resto do /resolve antes do prazo
 * do loader, e a leitura que estoura segue depois da resposta.
 */

const { resolveVariantIdsBySku } = vi.hoisted(() => ({
  resolveVariantIdsBySku: vi.fn(),
}));
vi.mock("@/lib/shopify/public-store", () => ({ resolveVariantIdsBySku }));

import {
  ORCAMENTO_HIDRATACAO_MS,
  hydrateTargetBySku,
} from "@/lib/checkout-routes/hidratar-por-sku";

/** Banco, cold start e a rede do comprador cabem aqui. */
const FOLGA_MINIMA_MS = 5000;

function prazoDoLoader(): number {
  const loader = readFileSync(
    path.resolve(__dirname, "../public/routed-checkout-loader.js"),
    "utf8"
  );
  const m = /var PRAZO_REDE_MS = (\d+);/.exec(loader);
  if (!m) throw new Error("PRAZO_REDE_MS sumiu do loader");
  return Number(m[1]);
}

function destino(skuMap: Record<string, string> = {}): RouteTarget {
  return {
    id: "t1",
    targetStoreId: "s1",
    domain: "tdicbr-3u.myshopify.com",
    weight: 1,
    enabled: true,
    skuMap,
    variantMap: {},
    settings: {},
  };
}

const LINHAS = [{ sku: "XC-ABC", sourceVariantId: "gid://shopify/ProductVariant/111", quantity: 1 }];

afterEach(() => {
  vi.useRealTimers();
  resolveVariantIdsBySku.mockReset();
});

describe("orcamento do /resolve x prazo do loader", () => {
  it("o servidor desiste da hidratacao bem antes de o loader desistir do /resolve", () => {
    expect(ORCAMENTO_HIDRATACAO_MS + FOLGA_MINIMA_MS).toBeLessThanOrEqual(prazoDoLoader());
  });

  it("leitura que cabe no orcamento completa o sku_map", async () => {
    resolveVariantIdsBySku.mockResolvedValue(new Map([["XC-ABC", 987]]));
    const t = await hydrateTargetBySku(destino(), LINHAS);
    expect(t.skuMap["xc-abc"]).toBe("987");
  });

  it("linha que o mapa ja cobre nao le o products.json", async () => {
    const t = destino({ "xc-abc": "987" });
    expect(await hydrateTargetBySku(t, LINHAS)).toBe(t);
    expect(resolveVariantIdsBySku).not.toHaveBeenCalled();
  });

  it("leitura que estoura: devolve o destino como esta e a leitura segue depois da resposta", async () => {
    vi.useFakeTimers();
    let terminar!: (m: Map<string, number>) => void;
    resolveVariantIdsBySku.mockReturnValue(
      new Promise<Map<string, number>>((r) => {
        terminar = r;
      })
    );
    const continuarDepois = vi.fn();
    const t = destino();

    const resultado = hydrateTargetBySku(t, LINHAS, { continuarDepois });
    await vi.advanceTimersByTimeAsync(ORCAMENTO_HIDRATACAO_MS - 1);
    expect(continuarDepois).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await resultado).toBe(t);
    expect(continuarDepois).toHaveBeenCalledTimes(1);

    // A leitura entregue para depois termina normalmente (e aquece o cache).
    const leitura = continuarDepois.mock.calls[0][0] as Promise<Map<string, number>>;
    terminar(new Map([["XC-ABC", 987]]));
    await expect(leitura).resolves.toEqual(new Map([["XC-ABC", 987]]));
  });

  it("`after` que lanca nao derruba o /resolve", async () => {
    vi.useFakeTimers();
    resolveVariantIdsBySku.mockReturnValue(new Promise(() => {}));
    const t = destino();
    const resultado = hydrateTargetBySku(t, LINHAS, {
      continuarDepois: () => {
        throw new Error("after fora do escopo");
      },
    });
    await vi.advanceTimersByTimeAsync(ORCAMENTO_HIDRATACAO_MS);
    expect(await resultado).toBe(t);
  });

  it("leitura que falha depois de estourar nao vira rejeicao sem dono", async () => {
    vi.useFakeTimers();
    let falhar!: (e: unknown) => void;
    resolveVariantIdsBySku.mockReturnValue(
      new Promise<Map<string, number>>((_, rej) => {
        falhar = rej;
      })
    );
    const continuarDepois = vi.fn();
    const resultado = hydrateTargetBySku(destino(), LINHAS, { continuarDepois });
    await vi.advanceTimersByTimeAsync(ORCAMENTO_HIDRATACAO_MS);
    await resultado;

    falhar(new Error("proxy caiu"));
    const leitura = continuarDepois.mock.calls[0][0] as Promise<unknown>;
    await expect(leitura).resolves.toEqual(new Map());
  });
});
