import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// O conserto (healRoute) com Shopify e banco falsos, travando os achados da
// auditoria de producao de 08/10/2026:
//
//  1. Produto com mais de 50 variantes: a consulta trazia 50 e o resto
//     parecia faltar (rota Yarden Store -> pauments: 16 variantes sem par).
//  2. Loja que nao da para atender (pausada pela Shopify, sem o app, vitrine
//     com senha): o motivo fica gravado, tipado, e o cron espera 12 h.
//  3. Preco diferente e variante que o checkout nao vende: contados, nunca
//     mexidos.
//  4. Produto criado na loja de checkout nao leva o vendor da vitrine.
// ============================================================================

type Linha = Record<string, unknown>;

const db: Record<string, Linha[]> = {};

function consulta(tabela: string) {
  const filtros: ((l: Linha) => boolean)[] = [];
  let patch: Linha | null = null;
  let head = false;
  let limite: number | undefined;

  async function executar() {
    const linhas = (db[tabela] || []).filter((l) => filtros.every((f) => f(l)));
    if (patch) {
      for (const l of linhas) Object.assign(l, JSON.parse(JSON.stringify(patch)));
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
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (tabela: string) => consulta(tabela) }),
}));

interface VarianteCheckout {
  id: string;
  sku: string | null;
  price?: string;
  availableForSale?: boolean;
  selectedOptions: { name: string; value: string }[];
}
interface ProdutoCheckout {
  id: string;
  title: string;
  status?: string;
  onlineStoreUrl?: string | null;
  options: { name: string }[];
  variants: { nodes: VarianteCheckout[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } };
}

const shopify = vi.hoisted(() => ({
  checkout: [] as ProdutoCheckout[],
  /** O que completarVariantes traz depois da 50a variante, por produto. */
  resto: {} as Record<string, VarianteCheckout[]>,
  criados: [] as { vendor?: string | null; variants: unknown[] }[],
  estendidos: [] as { productId: string; variantes: unknown[] }[],
  skusGravados: [] as unknown[],
  senha: false as boolean | null,
}));

vi.mock("@/lib/shopify/client", () => ({
  MAX_VARIANTES_POR_PRODUTO: 2048,
  getProducts: async () => ({
    products: { nodes: shopify.checkout, pageInfo: { hasNextPage: false, endCursor: null } },
  }),
  completarVariantes: async (_c: unknown, produtos: ProdutoCheckout[]) => {
    for (const p of produtos) {
      if (!p.variants.pageInfo?.hasNextPage) continue;
      p.variants.nodes.push(...(shopify.resto[p.id] || []));
      p.variants.pageInfo = { hasNextPage: false, endCursor: null };
    }
  },
  shopifyRestGet: async () =>
    shopify.senha === null ? Promise.reject(new Error("timeout")) : { shop: { password_enabled: shopify.senha } },
  addProductVariants: async (_c: unknown, productId: string, _o: unknown, variantes: unknown[]) => {
    shopify.estendidos.push({ productId, variantes });
    return variantes.map((_v, i) => ({ id: `gid://shopify/ProductVariant/${80000 + i}` }));
  },
  createProduct: async (_c: unknown, input: { vendor?: string | null; variants: { options: string[] }[] }) => {
    shopify.criados.push(input);
    const n = shopify.criados.length;
    return {
      syncedProduct: {
        id: `gid://shopify/Product/${9900 + n}`,
        variants: {
          nodes: input.variants.map((v, i) => ({
            id: `gid://shopify/ProductVariant/${99000 + n * 100 + i}`,
            selectedOptions: v.options.map((value) => ({ name: "Cor", value })),
          })),
        },
      },
    };
  },
  updateVariantSkus: async (_c: unknown, productId: string, updates: unknown[]) => {
    shopify.skusGravados.push({ productId, updates });
  },
}));

const vitrine = vi.hoisted(() => ({ produtos: [] as unknown[], erro: null as unknown }));
vi.mock("@/lib/shopify/public-store", () => {
  class LojaComSenhaError extends Error {}
  return {
    LojaComSenhaError,
    fetchPublicShopifyProducts: async () => {
      if (vitrine.erro) throw vitrine.erro;
      return { products: vitrine.produtos };
    },
    // O que o conserto espalha no produto novo: o vendor da vitrine vem daqui.
    toShopifyCreateProductInput: (p: { vendor: string | null }) => ({ vendor: p.vendor || undefined }),
  };
});

const saude = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("@/lib/shopify/store-health", () => ({
  verificarParDaRota: async () => saude.valor,
}));
vi.mock("@/lib/ai/product-neutralizer", () => ({ neutralizeProductForDestination: vi.fn() }));
vi.mock("@/lib/jobs/image-neutralize-processor", () => ({
  enqueueImageNeutralizeJobs: async () => ({ queued: 0 }),
  requestImageQueueDrain: async () => {},
}));
vi.mock("@/lib/billing/usage", () => ({ AI_COST: { text: 0 }, logAiUsage: async () => {} }));
vi.mock("@/lib/checkout-routes/tema-vitrine", () => ({
  sincronizarTemaDaRota: async () => ({ estado: "atualizado" }),
}));

import { healRoute, HealRouteError } from "@/lib/checkout-routes/heal";
import { LojaComSenhaError } from "@/lib/shopify/public-store";
import { ESPERA_LOJA_FORA_DO_AR_MS } from "@/lib/checkout-routes/loja-fora-do-ar";

// --------------------------------------------------------------- montagem

function produtoVitrine(
  id: number,
  handle: string,
  variantes: { id: number; sku: string; cor: string; preco?: string }[],
  vendor: string | null = "Nike Store"
) {
  return {
    id,
    title: handle,
    handle,
    descriptionHtml: "",
    vendor,
    productType: null,
    tags: [],
    options: ["Cor"],
    images: [],
    sourceUrl: "",
    variants: variantes.map((v) => ({
      id: v.id,
      title: v.cor,
      sku: v.sku,
      price: v.preco ?? "100.00",
      compareAtPrice: null,
      optionValues: [v.cor],
    })),
  };
}

function varianteCheckout(
  id: number,
  sku: string | null,
  cor: string,
  extra: { price?: string; availableForSale?: boolean } = {}
): VarianteCheckout {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    sku,
    price: extra.price ?? "100.00",
    ...(extra.availableForSale === undefined ? {} : { availableForSale: extra.availableForSale }),
    selectedOptions: [{ name: "Cor", value: cor }],
  };
}

function produtoCheckout(
  id: number,
  variantes: VarianteCheckout[],
  extra: { status?: string; onlineStoreUrl?: string | null; maisPaginas?: boolean } = {}
): ProdutoCheckout {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Produto neutro ${id}`,
    status: extra.status ?? "ACTIVE",
    onlineStoreUrl: extra.onlineStoreUrl === undefined ? `https://c.test/products/${id}` : extra.onlineStoreUrl,
    options: [{ name: "Cor" }],
    variants: {
      nodes: variantes,
      ...(extra.maisPaginas ? { pageInfo: { hasNextPage: true, endCursor: "c50" } } : {}),
    },
  };
}

const lojasOk = (moedas: { vitrine?: string; checkout?: string } = {}) => ({
  ok: true,
  source: { ok: true, nome: "Nike Store", moeda: moedas.vitrine ?? "BRL" },
  target: { ok: true, nome: "Checkout Neutro", moeda: moedas.checkout ?? "BRL" },
});

function montar(opcoes: { settingsDoDestino?: Linha; desinstalada?: "vitrine" | "checkout" } = {}) {
  db.routed_checkout_configs = [
    {
      id: "rota",
      user_id: "u1",
      name: "Yarden",
      enabled: true,
      sku_map: {},
      variant_map: {},
      settings: { theme_sync: { estado: "atualizado" } },
      source_store_id: "vitrine",
      target_store_id: "checkout",
    },
  ];
  db.routed_checkout_targets = [
    {
      id: "destino",
      route_id: "rota",
      target_store_id: "checkout",
      enabled: true,
      weight: 1,
      sku_map: {},
      variant_map: {},
      settings: opcoes.settingsDoDestino || { checkout_domain: "pague.exemplo.com" },
      position: 0,
      healing_since: null,
    },
  ];
  db.stores = [
    {
      id: "vitrine",
      user_id: "u1",
      shop_domain: "vitrine.myshopify.com",
      client_id: "a",
      client_secret: "b",
      uninstalled_at: opcoes.desinstalada === "vitrine" ? "2026-10-01T00:00:00Z" : null,
    },
    {
      id: "checkout",
      user_id: "u1",
      name: "Nome velho no banco",
      shop_domain: "checkout.myshopify.com",
      client_id: "c",
      client_secret: "d",
      target_language: "pt-BR",
      uninstalled_at: opcoes.desinstalada === "checkout" ? "2026-10-01T00:00:00Z" : null,
    },
  ];
}

const destino = () =>
  db.routed_checkout_targets[0] as {
    sku_map: Record<string, string>;
    settings: Record<string, unknown> & { last_heal?: Record<string, unknown> };
  };
const ultimoDaRota = () =>
  (db.routed_checkout_configs[0].settings as { last_heal?: Record<string, unknown> }).last_heal;

/** Uma vitrine de N cores, SKU s0..s(N-1). */
const cores = (n: number, base = 1000) =>
  Array.from({ length: n }, (_, i) => ({ id: base + i, sku: `s${i}`, cor: `cor-${i}` }));

beforeEach(() => {
  shopify.checkout = [];
  shopify.resto = {};
  shopify.criados = [];
  shopify.estendidos = [];
  shopify.skusGravados = [];
  shopify.senha = false;
  vitrine.produtos = [];
  vitrine.erro = null;
  saude.valor = lojasOk();
  delete process.env.GEMINI_API_KEY;
});

// ------------------------------------------------------- 1. mais de 50

describe("produto com mais de 50 variantes", () => {
  it("as variantes depois da 50a entram no indice e casam por SKU (nada e criado)", async () => {
    montar();
    vitrine.produtos = [produtoVitrine(100, "tenis", cores(66))];
    const todas = cores(66).map((v, i) => varianteCheckout(7000 + i, v.sku, v.cor));
    shopify.checkout = [produtoCheckout(9001, todas.slice(0, 50), { maisPaginas: true })];
    shopify.resto["gid://shopify/Product/9001"] = todas.slice(50);

    const r = await healRoute({ routeId: "rota", targetId: "destino" });

    expect(Object.keys(destino().sku_map)).toHaveLength(66);
    expect(destino().sku_map["s65"]).toBe("7065");
    expect(shopify.estendidos).toHaveLength(0);
    expect(shopify.criados).toHaveLength(0);
    expect(r.coveragePercent).toBe(100);
  });

  it("produto do checkout criado com 50 de 66: as 16 que faltam entram no MESMO produto", async () => {
    montar();
    vitrine.produtos = [produtoVitrine(100, "tenis", cores(66))];
    shopify.checkout = [
      produtoCheckout(
        9001,
        cores(50).map((v, i) => varianteCheckout(7000 + i, v.sku, v.cor))
      ),
    ];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });

    expect(shopify.criados).toHaveLength(0);
    expect(shopify.estendidos).toHaveLength(1);
    expect(shopify.estendidos[0].productId).toBe("gid://shopify/Product/9001");
    expect(shopify.estendidos[0].variantes).toHaveLength(16);
    expect(r.extendedCount).toBe(16);
    expect(Object.keys(destino().sku_map)).toHaveLength(66);
  });

  it("teto de 2048 da Shopify: estende so o que cabe e avisa do resto", async () => {
    montar();
    vitrine.produtos = [produtoVitrine(100, "camiseta", cores(2050))];
    shopify.checkout = [
      produtoCheckout(
        9001,
        cores(2040).map((v, i) => varianteCheckout(10000 + i, v.sku, v.cor))
      ),
    ];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });

    expect(shopify.estendidos[0].variantes).toHaveLength(8);
    expect(r.warnings.join(" ")).toContain("2048");
    expect(r.warnings.join(" ")).toContain("2 ficaram sem par");
  });
});

// ------------------------------------------------------- 2. fora do ar

describe("loja que o conserto nao atende", () => {
  const vitrineSimples = () => [produtoVitrine(100, "bolsa", [{ id: 1000, sku: "a", cor: "Preta" }])];

  it("loja de checkout pausada (402): motivo tipado, espera de 12 h, nada criado", async () => {
    montar();
    vitrine.produtos = vitrineSimples();
    saude.valor = {
      ok: false,
      source: { ok: true },
      target: { ok: false, motivo: "congelada", mensagem: "pausada" },
      mensagem: "Loja de checkout: pausada",
    };
    const antes = Date.now();

    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);

    expect(erro).toBeInstanceOf(HealRouteError);
    expect(erro.status).toBe(409);
    expect(erro.foraDoAr).toMatchObject({ motivo: "loja_pausada", lado: "checkout" });
    const ultimo = destino().settings.last_heal as { motivo: string; proximaTentativa: string; message: string };
    expect(ultimo.motivo).toBe("loja_pausada");
    expect(ultimo.message).toContain("checkout.myshopify.com");
    expect(Date.parse(ultimo.proximaTentativa)).toBeGreaterThanOrEqual(antes + ESPERA_LOJA_FORA_DO_AR_MS);
    // O resto do settings do destino (dominio do checkout) continua la.
    expect(destino().settings.checkout_domain).toBe("pague.exemplo.com");
    expect(ultimoDaRota()?.motivo).toBe("loja_pausada");
    // O theme_sync da rota nao some.
    expect((db.routed_checkout_configs[0].settings as Linha).theme_sync).toBeTruthy();
    expect(shopify.criados).toHaveLength(0);
  });

  it("credencial da vitrine revogada: sem_app, do lado da vitrine", async () => {
    montar();
    saude.valor = {
      ok: false,
      source: { ok: false, motivo: "sem_acesso" },
      target: { ok: true },
      mensagem: "Loja vitrine: credencial",
    };
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro.foraDoAr).toMatchObject({ motivo: "sem_app", lado: "vitrine" });
    expect(ultimoDaRota()?.lado).toBe("vitrine");
  });

  it("app desinstalado (uninstalled_at): sem_app gravado em vez de sair calado", async () => {
    montar({ desinstalada: "checkout" });
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro.foraDoAr).toMatchObject({ motivo: "sem_app", lado: "checkout" });
    expect(destino().settings.last_heal?.motivo).toBe("sem_app");
  });

  it("vitrine com senha (caso Distrito Zapas): vitrine_fechada, sem carimbar nada", async () => {
    montar();
    vitrine.erro = new LojaComSenhaError("vitrine.myshopify.com");
    shopify.senha = true;
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro.foraDoAr).toMatchObject({ motivo: "vitrine_fechada", lado: "vitrine" });
    expect(ultimoDaRota()?.message).toContain("senha");
    expect(shopify.skusGravados).toHaveLength(0);
  });

  it("products.json vazio e a Admin API diz que tem senha: vitrine_fechada", async () => {
    montar();
    vitrine.produtos = [];
    shopify.senha = true;
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro.foraDoAr?.motivo).toBe("vitrine_fechada");
  });

  it("vitrine que nao abriu SEM senha (bloqueio do proxy): erro gravado, sem espera", async () => {
    montar();
    vitrine.erro = new LojaComSenhaError("vitrine.myshopify.com");
    shopify.senha = false;
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro).toBeInstanceOf(HealRouteError);
    expect(erro.foraDoAr).toBeUndefined();
    expect(ultimoDaRota()).toMatchObject({ ok: false });
    expect(String(ultimoDaRota()?.message)).toContain("Não deu para ler os produtos da vitrine");
    expect(ultimoDaRota()?.proximaTentativa).toBeUndefined();
  });

  it("erro generico da Shopify (rede): nao espera, o cron tenta na proxima hora", async () => {
    montar();
    saude.valor = {
      ok: false,
      source: { ok: true },
      target: { ok: false, motivo: "erro" },
      mensagem: "Loja de checkout: nao respondeu",
    };
    const erro = await healRoute({ routeId: "rota", targetId: "destino" }).catch((e) => e);
    expect(erro.foraDoAr).toBeUndefined();
    expect(ultimoDaRota()?.proximaTentativa).toBeUndefined();
    expect(destino().settings.last_heal).toBeUndefined();
  });

  it("a loja voltou: a passada boa apaga o motivo e mantem o resto do settings", async () => {
    montar({
      settingsDoDestino: {
        checkout_domain: "pague.exemplo.com",
        last_heal: { at: "x", ok: false, motivo: "loja_pausada", lado: "checkout", proximaTentativa: "2999-01-01T00:00:00.000Z" },
      },
    });
    vitrine.produtos = vitrineSimples();
    shopify.checkout = [produtoCheckout(9001, [varianteCheckout(7001, "a", "Preta")])];
    await healRoute({ routeId: "rota", targetId: "destino" });
    expect(destino().settings.last_heal?.motivo).toBeUndefined();
    expect(destino().settings.last_heal?.proximaTentativa).toBeUndefined();
    expect(destino().settings.last_heal?.ok).toBe(true);
    expect(destino().settings.checkout_domain).toBe("pague.exemplo.com");
  });
});

// ------------------------------------------------------- 3. conferencia

describe("preco diferente e variante que o checkout nao vende: conta, nao mexe", () => {
  it("1 de 2 pares com preco diferente: conta, guarda o exemplo e nao cria nem estende nada", async () => {
    montar();
    vitrine.produtos = [
      produtoVitrine(100, "bolsa", [
        { id: 1000, sku: "a", cor: "Preta", preco: "100.00" },
        { id: 1001, sku: "b", cor: "Bege", preco: "120.00" },
      ]),
    ];
    shopify.checkout = [
      produtoCheckout(9001, [
        varianteCheckout(7001, "a", "Preta", { price: "90.00" }),
        varianteCheckout(7002, "b", "Bege", { price: "120.0" }),
      ]),
    ];

    const r = await healRoute({ routeId: "rota", targetId: "destino" });

    const conf = destino().settings.last_heal?.conferencia as {
      precoDiferente: { total: number; moeda: string; exemplos: { sku: string; vitrine: string; checkout: string }[] };
      indisponiveis: { total: number };
    };
    expect(conf.precoDiferente.total).toBe(1);
    expect(conf.precoDiferente.moeda).toBe("BRL");
    expect(conf.precoDiferente.exemplos[0]).toMatchObject({ sku: "a", vitrine: "100.00", checkout: "90.00" });
    expect(conf.indisponiveis.total).toBe(0);
    expect(r.conferencia?.precoDiferente?.total).toBe(1);
    expect(shopify.estendidos).toHaveLength(0);
    expect(shopify.criados).toHaveLength(0);
    // Preco diferente nao e problema do conserto: a rota segue ok.
    expect(ultimoDaRota()?.ok).toBe(true);
  });

  it("moedas diferentes: nao compara preco", async () => {
    montar();
    saude.valor = lojasOk({ vitrine: "BRL", checkout: "USD" });
    vitrine.produtos = [produtoVitrine(100, "bolsa", [{ id: 1000, sku: "a", cor: "Preta", preco: "500.00" }])];
    shopify.checkout = [produtoCheckout(9001, [varianteCheckout(7001, "a", "Preta", { price: "99.00" })])];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(r.conferencia?.precoDiferente).toBeNull();
  });

  it("inativo, fora da Loja virtual e sem estoque: cada um no seu motivo", async () => {
    montar();
    vitrine.produtos = [
      produtoVitrine(100, "bolsa-a", [{ id: 1000, sku: "a", cor: "Preta" }]),
      produtoVitrine(101, "bolsa-b", [{ id: 1001, sku: "b", cor: "Preta" }]),
      produtoVitrine(102, "bolsa-c", [{ id: 1002, sku: "c", cor: "Preta" }]),
      produtoVitrine(103, "bolsa-d", [{ id: 1003, sku: "d", cor: "Preta" }]),
    ];
    shopify.checkout = [
      produtoCheckout(9001, [varianteCheckout(7001, "a", "Preta")], { status: "DRAFT", onlineStoreUrl: null }),
      produtoCheckout(9002, [varianteCheckout(7002, "b", "Preta")], { onlineStoreUrl: null }),
      produtoCheckout(9003, [varianteCheckout(7003, "c", "Preta", { availableForSale: false })]),
      produtoCheckout(9004, [varianteCheckout(7004, "d", "Preta", { availableForSale: true })]),
    ];
    const r = await healRoute({ routeId: "rota", targetId: "destino" });
    expect(r.conferencia?.indisponiveis).toMatchObject({ total: 3, inativo: 1, foraDaLoja: 1, semEstoque: 1 });
    expect(r.conferencia?.indisponiveis.exemplos[0]).toMatchObject({
      produto: "Produto neutro 9001",
      motivo: "inativo",
    });
  });
});

// ------------------------------------------------------- 4. vendor

describe("produto criado na loja de checkout nao leva o vendor da vitrine", () => {
  function vitrineComProdutoNovo() {
    // 9 de 10 ja casam: a trava deixa criar o que falta sozinho.
    vitrine.produtos = Array.from({ length: 10 }, (_, i) =>
      produtoVitrine(100 + i, `bolsa-${i}`, [{ id: 1000 + i, sku: `b${i}`, cor: "Preta" }], "Nike Store")
    );
    shopify.checkout = Array.from({ length: 9 }, (_, i) =>
      produtoCheckout(9000 + i, [varianteCheckout(7000 + i, `b${i}`, "Preta")])
    );
  }

  it("vai o nome atual da loja de checkout (o da Shopify, nao o do banco)", async () => {
    montar();
    vitrineComProdutoNovo();
    await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados).toHaveLength(1);
    expect(shopify.criados[0].vendor).toBe("Checkout Neutro");
  });

  it("sem o nome da loja de checkout: vai sem vendor, nunca o da vitrine", async () => {
    montar();
    vitrineComProdutoNovo();
    saude.valor = { ok: true, source: { ok: true }, target: { ok: true } };
    await healRoute({ routeId: "rota", targetId: "destino" });
    expect(shopify.criados[0].vendor).toBeNull();
  });
});
