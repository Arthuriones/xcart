import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// O conserto (healRoute) inteiro, com Shopify e banco falsos. Trava tres
// defeitos que levaram as reclamacoes da NORAH:
//
//  1. Ele despejava o catalogo da vitrine em qualquer loja ligada a rota --
//     loja de outro nicho, com peso 0, com 1 SKU casado -- e recriava depois
//     que o lojista apagava. Agora mapear e sempre; criar so com o par de
//     lojas passando na trava, ou com o lojista confirmando.
//  2. Decidia "falta" so pelo SKU: SKU trocado na vitrine (com o variant_map
//     ainda apontando para a variante certa) virava produto duplicado.
//  3. Em SKU repetido, ficava com o SKU o produto MAIS NOVO do products.json,
//     e a copia B herdava a rota da bolsa A.
// ============================================================================

type Linha = Record<string, unknown>;

const db: Record<string, Linha[]> = {};
const escritas: { tabela: string; patch: Linha }[] = [];
// Leitura de routed_checkout_targets devolvendo erro (banco fora).
const falharDestinos = { sim: false };

function consulta(tabela: string) {
  const filtros: ((l: Linha) => boolean)[] = [];
  let patch: Linha | null = null;
  let head = false;
  let limite: number | undefined;

  async function executar() {
    if (falharDestinos.sim && tabela === "routed_checkout_targets" && !patch) {
      return { data: null, count: null, error: { message: "timeout" } };
    }
    const linhas = (db[tabela] || []).filter((l) => filtros.every((f) => f(l)));
    if (patch) {
      for (const l of linhas) Object.assign(l, patch);
      escritas.push({ tabela, patch });
      return { data: linhas, error: null };
    }
    if (head) return { data: null, count: linhas.length, error: null };
    return { data: limite ? linhas.slice(0, limite) : linhas, error: null };
  }

  const api = {
    select: (_colunas?: string, opcoes?: { head?: boolean }) => {
      if (opcoes?.head) head = true;
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      filtros.push((l) => l[coluna] === valor);
      return api;
    },
    in: (coluna: string, valores: unknown[]) => {
      filtros.push((l) => valores.includes(l[coluna]));
      return api;
    },
    or: () => api,
    order: () => api,
    limit: (n: number) => {
      limite = n;
      return api;
    },
    update: (p: Linha) => {
      patch = p;
      return api;
    },
    single: async () => {
      const r = await executar();
      const linha = Array.isArray(r.data) ? r.data[0] : null;
      return { data: linha ?? null, error: linha ? null : { message: "nao achou" } };
    },
    maybeSingle: async () => {
      const r = await executar();
      return { data: (Array.isArray(r.data) ? r.data[0] : null) ?? null, error: null };
    },
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (tabela: string) => consulta(tabela) }),
}));

const shopify = vi.hoisted(() => ({
  checkout: [] as {
    id: string;
    title: string;
    options: { name: string }[];
    variants: { nodes: { id: string; sku: string | null; selectedOptions: { name: string; value: string }[] }[] };
  }[],
  criados: [] as unknown[],
  estendidos: [] as unknown[],
  skusGravados: [] as { productId: string; updates: { variantId: string; sku: string }[] }[],
  recusarSku: false,
}));

vi.mock("@/lib/shopify/client", () => ({
  getProducts: async () => ({
    products: { nodes: shopify.checkout, pageInfo: { hasNextPage: false, endCursor: null } },
  }),
  addProductVariants: async (_c: unknown, productId: string, _o: unknown, variantes: unknown[]) => {
    shopify.estendidos.push({ productId, variantes });
    return variantes.map((_v, i) => ({ id: `gid://shopify/ProductVariant/${8000 + i}` }));
  },
  createProduct: async (_c: unknown, input: { variants: { options: string[]; sku?: string }[] }) => {
    shopify.criados.push(input);
    const n = shopify.criados.length;
    return {
      syncedProduct: {
        id: `gid://shopify/Product/${9900 + n}`,
        variants: {
          nodes: input.variants.map((v, i) => ({
            id: `gid://shopify/ProductVariant/${99000 + n * 10 + i}`,
            selectedOptions: v.options.map((value) => ({ name: "Cor", value })),
          })),
        },
      },
    };
  },
  updateVariantSkus: async (_c: unknown, productId: string, updates: { variantId: string; sku: string }[]) => {
    if (shopify.recusarSku) throw new Error("ACCESS_DENIED");
    shopify.skusGravados.push({ productId, updates });
  },
}));

const vitrine = vi.hoisted(() => ({ produtos: [] as unknown[] }));
vi.mock("@/lib/shopify/public-store", () => ({
  fetchPublicShopifyProducts: async () => ({ products: vitrine.produtos }),
  toShopifyCreateProductInput: () => ({}),
}));
vi.mock("@/lib/shopify/store-health", () => ({ verificarParDaRota: async () => ({ ok: true }) }));
vi.mock("@/lib/ai/product-neutralizer", () => ({ neutralizeProductForDestination: vi.fn() }));
vi.mock("@/lib/jobs/image-neutralize-processor", () => ({
  enqueueImageNeutralizeJobs: async () => ({ queued: 0 }),
  requestImageQueueDrain: async () => {},
}));
vi.mock("@/lib/billing/usage", () => ({ AI_COST: { text: 0 }, logAiUsage: async () => {} }));
const tema = vi.hoisted(() => ({ chamadas: 0 }));
vi.mock("@/lib/checkout-routes/tema-vitrine", () => ({
  sincronizarTemaDaRota: async () => {
    tema.chamadas += 1;
    return { estado: "atualizado" };
  },
}));

import { healRoute, HealRouteError } from "@/lib/checkout-routes/heal";
import { skuNeutro } from "@/lib/shopify/sku-stamp";

// --------------------------------------------------------------- montagem

function produtoVitrine(id: number, handle: string, variantes: { id: number; sku: string | null; cor?: string }[]) {
  return {
    id,
    title: handle,
    handle,
    descriptionHtml: "",
    vendor: null,
    productType: null,
    tags: [],
    options: ["Cor"],
    images: [],
    sourceUrl: "",
    variants: variantes.map((v) => ({
      id: v.id,
      title: v.cor || "Preto",
      sku: v.sku,
      price: "100.00",
      compareAtPrice: null,
      optionValues: [v.cor || "Preto"],
    })),
  };
}

function produtoCheckout(id: number, variantes: { id: number; sku: string | null; cor?: string }[]) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Produto ${id}`,
    options: [{ name: "Cor" }],
    variants: {
      nodes: variantes.map((v) => ({
        id: `gid://shopify/ProductVariant/${v.id}`,
        sku: v.sku,
        selectedOptions: [{ name: "Cor", value: v.cor || "Preto" }],
      })),
    },
  };
}

function montar(opcoes: {
  rotaLigada?: boolean;
  destino?: { enabled?: boolean; weight?: number };
  skuMap?: Linha;
  variantMap?: Linha;
}) {
  db.routed_checkout_configs = [
    {
      id: "rota",
      user_id: "u1",
      name: "NORAH",
      enabled: opcoes.rotaLigada ?? true,
      sku_map: {},
      variant_map: {},
      settings: {},
      source_store_id: "vitrine",
      target_store_id: "checkout",
    },
  ];
  db.routed_checkout_targets = [
    {
      id: "destino",
      route_id: "rota",
      target_store_id: "checkout",
      enabled: opcoes.destino?.enabled ?? true,
      weight: opcoes.destino?.weight ?? 1,
      sku_map: opcoes.skuMap || {},
      variant_map: opcoes.variantMap || {},
      position: 0,
      healing_since: null,
    },
  ];
  db.stores = [
    { id: "vitrine", user_id: "u1", shop_domain: "vitrine.myshopify.com", client_id: "a", client_secret: "b" },
    { id: "checkout", user_id: "u1", shop_domain: "checkout.myshopify.com", client_id: "c", client_secret: "d", target_language: "pt-BR" },
  ];
}

function destinoGravado() {
  return db.routed_checkout_targets[0] as { sku_map: Record<string, string>; variant_map: Record<string, string> };
}

function ultimoConserto() {
  return (db.routed_checkout_configs[0].settings as { last_heal?: { ok: boolean; message?: string } }).last_heal;
}

beforeEach(() => {
  shopify.checkout = [];
  shopify.criados = [];
  shopify.estendidos = [];
  shopify.skusGravados = [];
  shopify.recusarSku = false;
  vitrine.produtos = [];
  escritas.length = 0;
  tema.chamadas = 0;
  delete process.env.GEMINI_API_KEY;
});

// ------------------------------------------------------------------ testes

describe("trava: o conserto nao despeja a vitrine em loja de checkout errada", () => {
  // Vitrine de bolsas, loja de checkout de calcados: so o SKU curto "1" bate.
  function parErrado() {
    vitrine.produtos = Array.from({ length: 10 }, (_, i) =>
      produtoVitrine(100 + i, `bolsa-${i}`, [{ id: 1000 + i, sku: i === 0 ? "1" : `bolsa-${i}` }])
    );
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "1" }])];
  }

  it("loja com peso 0 (fora do rodizio): mapeia o que casa e nao cria nada", async () => {
    montar({ destino: { weight: 0 } });
    parErrado();
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(r.createdProductCount).toBe(0);
    expect(r.pendingProductCount).toBe(9);
    expect(r.creationBlockedReason).toContain("fora do rodízio");
    expect(destinoGravado().sku_map["1"]).toBe("7001");
    expect(ultimoConserto()?.ok).toBe(false);
    expect(ultimoConserto()?.message).toContain("9 produtos da vitrine faltam");
    expect(r.noop).toBe(false);
  });

  it("loja no rodizio mas com 10% de cobertura: tambem nao cria", async () => {
    montar({});
    parErrado();
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(r.coveragePercent).toBe(10);
    expect(r.creationBlockedReason).toContain("só 10%");
  });

  it("rota pausada: nao cria", async () => {
    montar({ rotaLigada: false });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
      produtoVitrine(101, "bolsa-b", [{ id: 1001, sku: "b" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "a" }])];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(r.creationBlockedReason).toContain("pausada");
  });

  it("o lojista confirmou: cria", async () => {
    montar({ destino: { weight: 0 } });
    parErrado();
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(shopify.criados).toHaveLength(9);
    expect(r.creationBlockedReason).toBeNull();
    expect(ultimoConserto()?.ok).toBe(true);
  });

  it("par certo e leva pequena: cria sozinho, como antes", async () => {
    montar({});
    vitrine.produtos = Array.from({ length: 10 }, (_, i) =>
      produtoVitrine(100 + i, `bolsa-${i}`, [{ id: 1000 + i, sku: `bolsa-${i}` }])
    );
    shopify.checkout = Array.from({ length: 8 }, (_, i) =>
      produtoCheckout(9000 + i, [{ id: 7000 + i, sku: `bolsa-${i}` }])
    );
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(2);
    expect(r.creationBlockedReason).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(ultimoConserto()?.ok).toBe(true);
  });

  it("par certo mas leva grande (mais de 20 produtos): espera confirmacao", async () => {
    montar({});
    vitrine.produtos = Array.from({ length: 100 }, (_, i) =>
      produtoVitrine(100 + i, `bolsa-${i}`, [{ id: 1000 + i, sku: `bolsa-${i}` }])
    );
    shopify.checkout = Array.from({ length: 75 }, (_, i) =>
      produtoCheckout(9000 + i, [{ id: 7000 + i, sku: `bolsa-${i}` }])
    );
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(r.pendingProductCount).toBe(25);
    expect(r.creationBlockedReason).toContain("25 produtos de uma vez");
  });

  it("rota com todas as lojas pausadas: recusa em vez de consertar a loja pausada pelo legado", async () => {
    montar({ destino: { enabled: false } });
    vitrine.produtos = [produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }])];
    await expect(healRoute({ routeId: "rota" })).rejects.toBeInstanceOf(HealRouteError);
    expect(shopify.criados).toHaveLength(0);
  });
});

describe("SKU trocado na vitrine: adota o par do variant_map em vez de duplicar", () => {
  it("variant_map aponta para variante viva no checkout: adota, nao cria", async () => {
    montar({
      skuMap: { "sku-velho": "7001" },
      variantMap: { "1000": "7001", "gid://shopify/ProductVariant/1000": "7001" },
    });
    vitrine.produtos = [produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "sku-novo" }])];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "sku-velho" }])];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(shopify.estendidos).toHaveLength(0);
    expect(r.adoptedVariantCount).toBe(1);
    expect(destinoGravado().sku_map["sku-novo"]).toBe("7001");
    expect(destinoGravado().variant_map["1000"]).toBe("7001");
  });

  it("vitrine sem SKU ligada pelo variant_map: o carimbo nao recria o catalogo", async () => {
    // create-destination com vitrine sem SKU: checkout sem SKU, mapa so por id.
    montar({ variantMap: { "1000": "7001", "1001": "7002" } });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: null }]),
      produtoVitrine(101, "bolsa-b", [{ id: 1001, sku: null }]),
    ];
    shopify.checkout = [
      produtoCheckout(9001, [{ id: 7001, sku: null }]),
      produtoCheckout(9002, [{ id: 7002, sku: null }]),
    ];

    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(r.stampedSkuCount).toBe(2);
    expect(shopify.criados).toHaveLength(0);
    expect(destinoGravado().sku_map[skuNeutro(1000)]).toBe("7001");
    expect(destinoGravado().sku_map[skuNeutro(1001)]).toBe("7002");
  });

  it("nao adota variante cujo SKU e de OUTRO produto da vitrine (mapa antigo errado)", async () => {
    // O conserto do prefixo "xc-" deixou mapa apontando a bolsa A para a
    // variante da bolsa C no checkout.
    montar({ variantMap: { "1000": "7001" } });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
      produtoVitrine(102, "bolsa-c", [{ id: 1002, sku: "c" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "c" }])];

    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(r.adoptedVariantCount).toBe(0);
    expect(destinoGravado().sku_map["c"]).toBe("7001");
    // A bolsa A ganha produto proprio no checkout.
    expect(shopify.criados).toHaveLength(1);
    expect(destinoGravado().variant_map["1000"]).not.toBe("7001");
  });

  it("variante sem par num produto misturado: avisa, nao adota nem cria", async () => {
    // Produto do checkout misturado (5 bolsas numa "Arque"): a variante
    // Preta ja e da bolsa C; a bolsa A (irma casada no mesmo produto) pede
    // uma Preta tambem.
    montar({});
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [
        { id: 1000, sku: "a-branca", cor: "Branca" },
        { id: 1001, sku: "a-preta", cor: "Preta" },
      ]),
      produtoVitrine(102, "bolsa-c", [{ id: 1002, sku: "c-preta", cor: "Preta" }]),
    ];
    shopify.checkout = [
      produtoCheckout(9001, [
        { id: 7001, sku: "a-branca", cor: "Branca" },
        { id: 7002, sku: "c-preta", cor: "Preta" },
      ]),
    ];
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(destinoGravado().sku_map["a-preta"]).toBeUndefined();
    expect(shopify.estendidos).toHaveLength(0);
    expect(r.mixedBlockedVariantCount).toBe(1);
    expect(r.warnings.join(" ")).toContain("mistura produtos da vitrine");
    // E o produto misturado aparece no aviso, com os dois produtos da vitrine.
    expect(r.warnings.join(" ")).toContain(
      'O produto "Produto 9001" da loja de checkout recebe variantes de 2 produtos da vitrine (bolsa-a, bolsa-c)'
    );
    expect(ultimoConserto()?.ok).toBe(false);
  });
});

describe("SKU repetido: o produto mapeado (ou o mais antigo) fica com o SKU", () => {
  it("a copia mais nova vem primeiro no products.json e nao herda a rota", async () => {
    montar({ skuMap: { "bolsa-a": "7001" }, variantMap: { "1000": "7001" } });
    // products.json: do mais novo para o mais antigo. B e copia de A.
    vitrine.produtos = [
      produtoVitrine(200, "bolsa-b-copia", [{ id: 2000, sku: "bolsa-a" }]),
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "bolsa-a" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "bolsa-a" }])];

    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(r.dedupedSkuCount).toBe(1);
    // Quem foi recarimbada foi a copia B.
    expect(shopify.skusGravados).toEqual([
      {
        productId: "gid://shopify/Product/200",
        updates: [{ variantId: "gid://shopify/ProductVariant/2000", sku: skuNeutro(2000) }],
      },
    ]);
    expect(destinoGravado().variant_map["1000"]).toBe("7001");
    expect(destinoGravado().variant_map["2000"]).not.toBe("7001");
    expect(shopify.criados).toHaveLength(1);
  });

  it("sem mapa nenhum, fica com o SKU a variante mais antiga (menor id)", async () => {
    montar({});
    vitrine.produtos = [
      produtoVitrine(200, "bolsa-b-copia", [{ id: 2000, sku: "bolsa-a" }]),
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "bolsa-a" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "bolsa-a" }])];
    await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(shopify.skusGravados[0].updates[0].variantId).toBe("gid://shopify/ProductVariant/2000");
    expect(destinoGravado().variant_map["1000"]).toBe("7001");
  });

  it("a Shopify recusou recarimbar a copia: ela fica de fora, nao cai na variante do dono", async () => {
    montar({});
    shopify.recusarSku = true;
    vitrine.produtos = [
      produtoVitrine(200, "bolsa-b-copia", [{ id: 2000, sku: "bolsa-a" }]),
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "bolsa-a" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "bolsa-a" }])];
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(destinoGravado().variant_map["1000"]).toBe("7001");
    expect(destinoGravado().variant_map["2000"]).toBeUndefined();
    expect(shopify.criados).toHaveLength(0);
    expect(r.warnings.join(" ")).toContain("ACCESS_DENIED");
  });
});

describe("o tema da vitrine acompanha o conserto", () => {
  it("todo conserto chama o reenvio ao tema (que compara pelo conteudo)", async () => {
    montar({});
    vitrine.produtos = [produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }])];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "a" }])];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(tema.chamadas).toBe(1);
    expect(r.theme).toEqual({ estado: "atualizado" });
  });
});

describe("o mapa gravado nao guarda par morto nem par de outra variante", () => {
  // O loader e o resolve leem o variant_map ANTES do sku_map. Com a trava
  // segurando a criacao, a entrada velha ficava para sempre.

  it("alvo apagado no checkout, criacao barrada: o par sai dos dois mapas", async () => {
    montar({
      destino: { weight: 0 },
      skuMap: { a: "7001", b: "7999" },
      variantMap: { "1001": "7999", "gid://shopify/ProductVariant/1001": "7999" },
    });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
      produtoVitrine(101, "bolsa-b", [{ id: 1001, sku: "b" }]),
    ];
    // 7999 foi apagada (o lojista limpou o produto misturado).
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "a" }])];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(0);
    expect(destinoGravado().variant_map["1001"]).toBeUndefined();
    expect(destinoGravado().variant_map["gid://shopify/ProductVariant/1001"]).toBeUndefined();
    expect(destinoGravado().sku_map["b"]).toBeUndefined();
    expect(destinoGravado().sku_map["a"]).toBe("7001");
    expect(r.removedPairCount).toBe(1);
    expect(r.noop).toBe(false);
  });

  it("par antigo recusado (SKU do alvo e de outra bolsa): sai, e o comprador da bolsa A nao paga pela C", async () => {
    montar({
      destino: { weight: 0 },
      skuMap: { a: "7001" },
      variantMap: { "1000": "7001", "gid://shopify/ProductVariant/1000": "7001" },
    });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
      produtoVitrine(102, "bolsa-c", [{ id: 1002, sku: "c" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "c" }])];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(destinoGravado().variant_map["1000"]).toBeUndefined();
    expect(destinoGravado().variant_map["gid://shopify/ProductVariant/1000"]).toBeUndefined();
    expect(destinoGravado().sku_map["a"]).toBeUndefined();
    expect(destinoGravado().sku_map["c"]).toBe("7001");
    expect(r.removedPairCount).toBe(1);
  });

  it("produto fora do products.json (despublicado) com alvo vivo: o par fica", async () => {
    montar({ variantMap: { "5555": "7002" }, skuMap: { sumida: "7002" } });
    vitrine.produtos = [produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }])];
    shopify.checkout = [
      produtoCheckout(9001, [{ id: 7001, sku: "a" }]),
      produtoCheckout(9002, [{ id: 7002, sku: "x" }]),
    ];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(destinoGravado().variant_map["5555"]).toBe("7002");
    expect(destinoGravado().sku_map["sumida"]).toBe("7002");
    expect(r.removedPairCount).toBe(0);
  });

  it("indice do checkout incompleto (produto com 50 variantes): nao conclui que o alvo morreu", async () => {
    montar({ destino: { weight: 0 }, variantMap: { "1001": "7999" }, skuMap: { b: "7999" } });
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
      produtoVitrine(101, "bolsa-b", [{ id: 1001, sku: "b" }]),
    ];
    // A consulta traz no maximo 50 variantes por produto: a 7999 pode ser a 51a.
    shopify.checkout = [
      produtoCheckout(
        9001,
        Array.from({ length: 50 }, (_, i) => ({ id: 7001 + i, sku: i === 0 ? "a" : `t${i}`, cor: `c${i}` }))
      ),
    ];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(destinoGravado().variant_map["1001"]).toBe("7999");
    expect(destinoGravado().sku_map["b"]).toBe("7999");
    expect(r.removedPairCount).toBe(0);
  });

  it("duas variantes da vitrine com o mesmo par no mapa: fica com ele a mais antiga", async () => {
    // Copia de produto: o mapa das duas aponta para 7001; o products.json
    // traz a copia (mais nova) primeiro.
    montar({ variantMap: { "1000": "7001", "2000": "7001" } });
    vitrine.produtos = [
      produtoVitrine(200, "bolsa-b-copia", [{ id: 2000, sku: "b" }]),
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "velho" }])];
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(destinoGravado().variant_map["1000"]).toBe("7001");
    expect(destinoGravado().variant_map["2000"]).not.toBe("7001");
    expect(r.adoptedVariantCount).toBe(1);
  });
});

describe("produto do checkout misturado (caso Arque): o conserto nao pendura mais nada nele", () => {
  it("cor nova da bolsa 2, cuja irma esta na Arque: nao acrescenta na Arque, mesmo confirmando", async () => {
    montar({});
    vitrine.produtos = [
      produtoVitrine(100, "arque", [{ id: 1000, sku: "arque-preta", cor: "Preta" }]),
      produtoVitrine(200, "bolsa-2", [
        { id: 2000, sku: "b2-marrom", cor: "Marrom" },
        { id: 2001, sku: "b2-bege", cor: "Bege" },
      ]),
    ];
    // O conserto antigo (prefixo "xc-") pendurou a Marrom da bolsa 2 na Arque.
    shopify.checkout = [
      produtoCheckout(9001, [
        { id: 7001, sku: "arque-preta", cor: "Preta" },
        { id: 7002, sku: "b2-marrom", cor: "Marrom" },
      ]),
    ];
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(shopify.estendidos).toHaveLength(0);
    expect(shopify.criados).toHaveLength(0);
    expect(destinoGravado().sku_map["b2-bege"]).toBeUndefined();
    expect(r.mixedBlockedVariantCount).toBe(1);
    expect(r.warnings.join(" ")).toContain("bolsa-2");
    expect(ultimoConserto()?.ok).toBe(false);
  });

  it("produto que NAO mistura continua ganhando a variante nova", async () => {
    montar({});
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [
        { id: 1000, sku: "a-preta", cor: "Preta" },
        { id: 1001, sku: "a-bege", cor: "Bege" },
      ]),
    ];
    shopify.checkout = [produtoCheckout(9001, [{ id: 7001, sku: "a-preta", cor: "Preta" }])];
    const r = await healRoute({ routeId: "rota", targetId: "destino", criarFaltantes: true });
    expect(shopify.estendidos).toHaveLength(1);
    expect(r.mixedBlockedVariantCount).toBe(0);
    expect(destinoGravado().sku_map["a-bege"]).toBe("8000");
  });
});

describe("erro do banco nao vira destino legado", () => {
  it("leitura dos destinos falhou: 503, nada consertado nem criado", async () => {
    montar({});
    vitrine.produtos = [produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a" }])];
    falharDestinos.sim = true;
    try {
      await expect(healRoute({ routeId: "rota" })).rejects.toMatchObject({ status: 503 });
      expect(shopify.criados).toHaveLength(0);
      expect(escritas).toHaveLength(0);
    } finally {
      falharDestinos.sim = false;
    }
  });
});
