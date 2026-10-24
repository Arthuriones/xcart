import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import {
  ESPERA_FORA_DO_AR_MS,
  MAX_PAGINAS_CARGA_INICIAL,
  MAX_PAGINAS_SEGUNDA_VOLTA,
  cronEsperaALoja,
  lojaForaDoArNoSync,
  ordenarParaRodizio,
  paginasDaRodada,
  prazoDaSegundaVolta,
} from "../src/lib/financeiro/sync-rodada";
import { ehNegado } from "../src/lib/financeiro/mapear-pedido";
import type { FinSyncStateRow } from "../src/lib/financeiro/tipos";
import { ShopifyClientError, TIMEOUT_SHOPIFY_MS, shopifyGraphQL } from "../src/lib/shopify/client";

// ============================================================================
// Rodada do cron de pedidos (/api/jobs/financeiro/pedidos):
//   - rodizio: quem esta ha mais tempo sem tentativa vai primeiro;
//   - loja fora do ar na Shopify (401, 402, sem o app, fechada) espera 6 h,
//     como a negada; timeout e 5xx nao esperam;
//   - carga inicial anda 10 paginas na primeira volta do cron e continua na
//     segunda com a sobra do orcamento; o "Atualizar agora" le o padrao;
//   - o GraphQL e o token da Shopify tem prazo de 25 s, e o estouro e falha
//     comum da loja;
//   - 5xx/429/desafio do Cloudflare no pedido do token e falha comum, nunca
//     "App nao esta instalado".
// As frases sao as que estao em fin_sync_state.ultimo_erro em producao.
// ============================================================================

const mundo = vi.hoisted(() => ({
  banco: null as unknown as { client: never },
  usuario: null as { id: string } | null,
  lidas: [] as { loja: string; paginas: number | undefined }[],
  /** O `limiteEm` de cada chamada, na ordem de `lidas`. */
  prazos: [] as (number | undefined)[],
  falhas: new Map<string, unknown>(),
  /** Lojas cuja leitura para no teto (carga que nao terminou). */
  naoTermina: new Set<string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.banco.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mundo.usuario } }) } }),
}));
// O DNS nao e o assunto: o host passa como veio.
vi.mock("@/lib/shopify/safe-shop", () => ({
  ShopDomainError: class extends Error {},
  assertShopDomainPublico: async (d: string) => d,
}));
// A rota com o sync de mentira: grava a ordem e as paginas pedidas, ou falha
// com o erro que o teste escolher. A carga em pedacos usa o de verdade.
vi.mock("@/lib/financeiro/shopify-pedidos", () => ({
  sincronizarLoja: async (
    _a: unknown,
    loja: { shop_domain: string },
    _e: unknown,
    paginas?: number,
    limiteEm?: number
  ) => {
    mundo.lidas.push({ loja: loja.shop_domain, paginas });
    mundo.prazos.push(limiteEm);
    const falha = mundo.falhas.get(loja.shop_domain);
    if (falha) throw falha;
    return { pedidos: 0, terminou: !mundo.naoTermina.has(loja.shop_domain), comOrigem: true };
  },
  recuperarOrigens: async () => null,
  faltaRecuperarOrigens: () => false,
}));

const ERRO_401 =
  'Shopify API error: 401 Unauthorized - {"errors":"[API] Invalid API key or access token (unrecognized login or wrong password)"}';
const ERRO_402 =
  "A Shopify recusou a chamada API com 402 Payment Required. Normalmente isso acontece quando a loja esta pausada, congelada, sem plano ativo ou com restricao de billing. Ative um plano/trial valido nessa loja e tente novamente.";
const ERRO_SEM_APP =
  "App nao esta instalado nessa loja. Instale o app primeiro: no dev.shopify.com, va em seu App > Distribution > gere o link de Custom Distribution e instale na loja.";
const ERRO_SEM_APP_2 =
  "App nao esta instalado nessa loja. Crie o app no dev.shopify.com, gere o link de Custom Distribution para esta loja e instale antes de conectar.";
const ERRO_NEGADO =
  'Shopify GraphQL error: [{"message":"Access denied for orders field.","locations":[{"line":3,"column":3}],"extensions":{"code":"ACCESS_DENIED"}}]';

const MIN = 60 * 1000;
const HORA = 60 * MIN;
const ha = (ms: number) => new Date(Date.now() - ms).toISOString();

/** O erro de verdade do cliente quando a Shopify nao responde (prazo encurtado). */
async function timeoutDaShopify(creds: { shopDomain: string; clientId: string; accessToken: string | null }) {
  const original = AbortSignal.timeout.bind(AbortSignal);
  const prazos: number[] = [];
  const espiao = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    prazos.push(ms);
    return original(5);
  });
  // A "loja travada": so responde quando o pedido e abortado.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_ok, falhar) => {
          init?.signal?.addEventListener("abort", () => falhar(init.signal?.reason));
        })
    )
  );
  try {
    const erro = await shopifyGraphQL({ ...creds, clientSecret: "s" }, "{ shop { name } }").catch((e: unknown) => e);
    return { erro, prazos };
  } finally {
    espiao.mockRestore();
    vi.unstubAllGlobals();
  }
}

/** O erro de verdade do cliente quando o pedido do token (/admin/oauth/access_token) responde assim. */
let tokensPedidos = 0;
async function erroDoToken(status: number, corpo: string, headers: Record<string, string> = {}) {
  tokensPedidos += 1;
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(corpo, { status, headers });
    })
  );
  const avisos = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
  try {
    // Dominio e client id unicos: o cache do token nao entra.
    const creds = { shopDomain: `token-${tokensPedidos}.myshopify.com`, clientId: `c-${tokensPedidos}`, clientSecret: "s", accessToken: null };
    const erro = await shopifyGraphQL(creds, "{ shop { name } }").catch((e: unknown) => e);
    return { erro: erro as ShopifyClientError, urls };
  } finally {
    for (const a of avisos) a.mockRestore();
    vi.unstubAllGlobals();
  }
}

const PAGINA_DE_ERRO = "<!DOCTYPE html><html><head><title>503 Service Unavailable</title></head><body>Try again</body></html>";

describe("pedido do token com a Shopify fora (getAccessToken)", () => {
  it("502, 503, 504 e 429 em HTML: falha comum, nunca 'App nao esta instalado'; o cron tenta na rodada seguinte", async () => {
    for (const status of [502, 503, 504, 429]) {
      const { erro, urls } = await erroDoToken(status, PAGINA_DE_ERRO, { "content-type": "text/html; charset=utf-8" });
      expect(urls[0]).toMatch(/\/admin\/oauth\/access_token$/);
      expect(erro).toBeInstanceOf(ShopifyClientError);
      expect(erro).toMatchObject({ code: "REQUEST_FAILED", message: `Falha ao autenticar na Shopify (status ${status}).` });
      expect(lojaForaDoArNoSync(erro.message), String(status)).toBe(false);
      expect(cronEsperaALoja({ ultimo_erro: erro.message, ultimo_erro_tipo: "falhou", ultimo_sync_em: ha(MIN) }, Date.now())).toBe(false);
    }
  });

  it("desafio do Cloudflare (403 com cf-mitigated: challenge): falha comum", async () => {
    const { erro } = await erroDoToken(403, "<html><body>Just a moment...</body></html>", {
      "content-type": "text/html",
      "cf-mitigated": "challenge",
    });
    expect(erro).toMatchObject({ code: "REQUEST_FAILED", message: "Falha ao autenticar na Shopify (status 403)." });
    expect(lojaForaDoArNoSync(erro.message)).toBe(false);
  });

  it("o que era da loja continua igual: 404 = sem o app, 401 e 403 sem o Cloudflare = credencial, 503 em JSON = falha comum", async () => {
    const semApp = (await erroDoToken(404, "<html>Not Found</html>", { "content-type": "text/html" })).erro;
    expect(semApp).toMatchObject({ code: "APP_NOT_INSTALLED" });
    expect(lojaForaDoArNoSync(semApp.message)).toBe(true);

    const naoAchado = (await erroDoToken(400, '{"error":"application_cannot_be_found"}')).erro;
    expect(naoAchado).toMatchObject({ code: "APP_NOT_INSTALLED" });

    for (const status of [401, 403]) {
      const { erro } = await erroDoToken(status, "<html>Forbidden</html>", { "content-type": "text/html" });
      expect(erro, String(status)).toMatchObject({ code: "INVALID_CREDENTIALS" });
      expect(lojaForaDoArNoSync(erro.message)).toBe(true);
    }

    const json = (await erroDoToken(503, '{"errors":"unavailable"}', { "content-type": "application/json" })).erro;
    expect(json).toMatchObject({ code: "REQUEST_FAILED", message: "Falha ao autenticar na Shopify (status 503)." });
  });
});

describe("loja fora do ar (regra pura)", () => {
  it("401, 402, sem o app, credencial invalida, 423 e 404: fora do ar", () => {
    for (const erro of [
      ERRO_401,
      ERRO_402,
      ERRO_SEM_APP,
      ERRO_SEM_APP_2,
      "Client ID ou Client Secret invalidos. Verifique as credenciais do app no Shopify.",
      "Shopify API error: 423 Locked",
      "Shopify API error: 404 Not Found",
      "Falha ao autenticar na Shopify (status 402).",
    ]) {
      expect(lojaForaDoArNoSync(erro), erro).toBe(true);
    }
  });

  it("timeout, 5xx, erro do GraphQL (mesmo com custo 402) e erro do banco: nao", () => {
    for (const erro of [
      "A Shopify nao respondeu em 25 s.",
      "Shopify API error: 503 Service Unavailable",
      'Shopify GraphQL error: [{"message":"Throttled","extensions":{"code":"THROTTLED","cost":{"requestedQueryCost":402}}}]',
      ERRO_NEGADO,
      "gravar pedidos: canceling statement due to statement timeout",
      "",
      null,
    ]) {
      expect(lojaForaDoArNoSync(erro), String(erro)).toBe(false);
    }
  });

  it("espera 6 h desde a ultima tentativa, como a negada", () => {
    const agora = Date.now();
    const estado = (ultimo_erro: string, ultimo_erro_tipo: "negado" | "falhou", ms: number) => ({
      ultimo_erro,
      ultimo_erro_tipo,
      ultimo_sync_em: new Date(agora - ms).toISOString(),
    });
    expect(cronEsperaALoja(estado(ERRO_402, "falhou", 30 * MIN), agora)).toBe(true);
    expect(cronEsperaALoja(estado(ERRO_401, "falhou", ESPERA_FORA_DO_AR_MS - 1), agora)).toBe(true);
    expect(cronEsperaALoja(estado(ERRO_401, "falhou", ESPERA_FORA_DO_AR_MS), agora)).toBe(false);
    expect(cronEsperaALoja(estado(ERRO_NEGADO, "negado", HORA), agora)).toBe(true);
    expect(cronEsperaALoja(estado(ERRO_NEGADO, "negado", 7 * HORA), agora)).toBe(false);
    expect(cronEsperaALoja(estado("Shopify API error: 503 Service Unavailable", "falhou", MIN), agora)).toBe(false);
    expect(cronEsperaALoja(null, agora)).toBe(false);
  });
});

describe("rodizio e carga inicial (regra pura)", () => {
  it("mais antiga primeiro, sem estado antes de todas, empate na ordem que veio", () => {
    const lojas = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const estados = new Map<string, Pick<FinSyncStateRow, "ultimo_sync_em">>([
      ["a", { ultimo_sync_em: "2026-10-24T10:00:00.000Z" }],
      ["c", { ultimo_sync_em: "2026-10-24T09:00:00.000Z" }],
      ["d", { ultimo_sync_em: "2026-10-24T10:00:00.000Z" }],
      ["e", { ultimo_sync_em: null }],
    ]);
    expect(ordenarParaRodizio(lojas, estados).map((l) => l.id)).toEqual(["b", "e", "c", "a", "d"]);
  });

  it("carga inicial: 10 paginas; loja em dia: o padrao do sync", () => {
    expect(paginasDaRodada(null)).toBe(MAX_PAGINAS_CARGA_INICIAL);
    expect(paginasDaRodada({ carga_inicial_ok: false })).toBe(10);
    expect(paginasDaRodada({ carga_inicial_ok: true })).toBeUndefined();
  });

  it("Atualizar agora (sessao): o padrao do sync tambem na carga inicial", () => {
    expect(paginasDaRodada(null, false)).toBeUndefined();
    expect(paginasDaRodada({ carga_inicial_ok: false }, false)).toBeUndefined();
    expect(paginasDaRodada({ carga_inicial_ok: false }, true)).toBe(MAX_PAGINAS_CARGA_INICIAL);
  });

  it("prazo da segunda volta: a sobra dividida pelas que faltam; a ultima vai ate o fim", () => {
    expect(prazoDaSegundaVolta(1_000, 241_000, 2)).toBe(121_000);
    expect(prazoDaSegundaVolta(1_000, 241_000, 1)).toBe(241_000);
    expect(prazoDaSegundaVolta(1_000, 241_000, 0)).toBe(241_000);
    // Orcamento ja estourado: nada a mais.
    expect(prazoDaSegundaVolta(300_000, 241_000, 3)).toBe(300_000);
  });
});

describe("prazo da Shopify", () => {
  it("GraphQL que nao responde: ShopifyClientError 504 em 25 s, e falha comum (sem espera)", async () => {
    const { erro, prazos } = await timeoutDaShopify({ shopDomain: "lenta-01.myshopify.com", clientId: "c1", accessToken: "shpat_x" });
    expect(prazos).toEqual([TIMEOUT_SHOPIFY_MS]);
    expect(TIMEOUT_SHOPIFY_MS).toBe(25_000);
    expect(erro).toBeInstanceOf(ShopifyClientError);
    expect(erro).toMatchObject({ statusCode: 504, message: "A Shopify nao respondeu em 25 s." });
    const mensagem = (erro as Error).message;
    expect(ehNegado(erro)).toBe(false);
    expect(lojaForaDoArNoSync(mensagem)).toBe(false);
    expect(cronEsperaALoja({ ultimo_erro: mensagem, ultimo_erro_tipo: "falhou", ultimo_sync_em: ha(MIN) }, Date.now())).toBe(false);
  });

  it("o pedido do token tambem tem prazo", async () => {
    const { erro, prazos } = await timeoutDaShopify({ shopDomain: "lenta-02.myshopify.com", clientId: "c2", accessToken: null });
    expect(prazos).toEqual([TIMEOUT_SHOPIFY_MS]);
    expect(erro).toMatchObject({ statusCode: 504, message: "A Shopify nao respondeu em 25 s." });
  });
});

describe("carga inicial em pedacos (sincronizarLoja de verdade)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function rodar(cargaInicialOk: boolean) {
    const { sincronizarLoja } = await vi.importActual<typeof import("../src/lib/financeiro/shopify-pedidos")>(
      "../src/lib/financeiro/shopify-pedidos"
    );
    let paginas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        paginas += 1;
        // Loja grande: sempre ha proxima pagina.
        const data = {
          shop: { ianaTimezone: "America/Sao_Paulo", currencyCode: "USD" },
          orders: { pageInfo: { hasNextPage: true, endCursor: `cursor-${paginas}` }, nodes: [] },
        };
        return new Response(JSON.stringify({ data }), { status: 200 });
      })
    );
    const linha = {
      store_id: "s1",
      user_id: "u1",
      carga_inicial_ok: cargaInicialOk,
      cursor_atualizado: null,
      retomar_busca: null,
      retomar_cursor: null,
    };
    const banco = fakeSupabase({ fin_sync_state: [linha] });
    const loja = { id: "s1", user_id: "u1", shop_domain: "grande-01.myshopify.com", client_id: "c", client_secret: "s", access_token: "shpat_x" };
    const estado = { ...linha } as unknown as FinSyncStateRow;
    const r = await sincronizarLoja(banco.client, loja, estado, paginasDaRodada(estado));
    return { r, paginas, linha };
  }

  it("sem a carga feita: para em 10 paginas e guarda o cursor para a proxima rodada", async () => {
    const { r, paginas, linha } = await rodar(false);
    expect(paginas).toBe(10);
    expect(r.terminou).toBe(false);
    expect(linha.retomar_cursor).toBe("cursor-10");
  });

  it("loja em dia segue com as 25 paginas de antes", async () => {
    const { paginas } = await rodar(true);
    expect(paginas).toBe(25);
  });

  it("segunda volta: retoma do cursor da primeira e vai ate o fim, passando das 25 paginas", async () => {
    const { sincronizarLoja } = await vi.importActual<typeof import("../src/lib/financeiro/shopify-pedidos")>(
      "../src/lib/financeiro/shopify-pedidos"
    );
    const TOTAL = 40;
    const cursores: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const { variables } = JSON.parse(String(init?.body)) as { variables: { cursor: string | null } };
        cursores.push(variables.cursor);
        const n = cursores.length;
        const data = {
          shop: { ianaTimezone: "America/Sao_Paulo", currencyCode: "USD" },
          orders: { pageInfo: { hasNextPage: n < TOTAL, endCursor: `cursor-${n}` }, nodes: [] },
        };
        return new Response(JSON.stringify({ data }), { status: 200 });
      })
    );
    const linha = {
      store_id: "s2",
      user_id: "u1",
      carga_inicial_ok: false,
      cursor_atualizado: null,
      retomar_busca: null as string | null,
      retomar_cursor: null as string | null,
    };
    const banco = fakeSupabase({ fin_sync_state: [linha] });
    const loja = { id: "s2", user_id: "u1", shop_domain: "grande-02.myshopify.com", client_id: "c", client_secret: "s", access_token: "shpat_x" };

    const limiteEm = Date.now() + 200_000;
    const primeira = await sincronizarLoja(banco.client, loja, { ...linha } as unknown as FinSyncStateRow, paginasDaRodada(linha), limiteEm);
    expect(primeira.terminou).toBe(false);
    expect(linha.retomar_cursor).toBe("cursor-10");

    const segunda = await sincronizarLoja(
      banco.client,
      loja,
      { ...linha } as unknown as FinSyncStateRow,
      MAX_PAGINAS_SEGUNDA_VOLTA,
      prazoDaSegundaVolta(Date.now(), limiteEm, 1)
    );
    expect(segunda.terminou).toBe(true);
    expect(cursores).toHaveLength(TOTAL);
    // A segunda volta comeca exatamente onde a primeira parou.
    expect(cursores[10]).toBe("cursor-10");
    expect(linha.retomar_cursor).toBeNull();
  });
});

describe("cron de pedidos", () => {
  let banco: FakeSupabase;
  const loja = (id: string, dominio: string) => ({
    id,
    user_id: "u1",
    shop_domain: `${dominio}.myshopify.com`,
    client_id: "c",
    client_secret: "s",
    access_token: null,
    uninstalled_at: null,
    demonstracao: false,
  });
  const estado = (store_id: string, extra: Record<string, unknown>) => ({
    store_id,
    user_id: "u1",
    sincronizando_desde: null,
    ultimo_erro: null,
    ultimo_erro_tipo: null,
    ultimo_sync_ok_em: null,
    carga_inicial_ok: true,
    ...extra,
  });
  const usar = (b: FakeSupabase) => {
    banco = b;
    mundo.banco = b as unknown as { client: never };
  };
  const linhaDe = (id: string) => banco.tabelas.fin_sync_state.find((s) => s.store_id === id)!;

  async function chamar(doCron: boolean) {
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("https://user.xcart.app/api/jobs/financeiro/pedidos", {
      method: "POST",
      headers: doCron ? { authorization: "Bearer segredo" } : {},
    });
    const { POST } = await import("../src/app/api/jobs/financeiro/pedidos/route");
    return (await (await POST(req)).json()) as { ok: boolean; processadas: number; puladas: number; erros: string[] };
  }

  function bancoMisto() {
    return fakeSupabase({
      // A ordem do banco, que o rodizio nao segue.
      stores: [
        loja("1", "em-dia-a"),
        loja("2", "pausada"),
        loja("3", "em-dia-b"),
        loja("4", "nova"),
        loja("5", "negada"),
        loja("6", "sem-token-velha"),
      ],
      fin_sync_state: [
        estado("1", { ultimo_sync_em: ha(20 * MIN) }),
        estado("2", { ultimo_sync_em: ha(30 * MIN), ultimo_erro: ERRO_402, ultimo_erro_tipo: "falhou" }),
        estado("3", { ultimo_sync_em: ha(40 * MIN) }),
        estado("5", { ultimo_sync_em: ha(HORA), ultimo_erro: ERRO_NEGADO, ultimo_erro_tipo: "negado" }),
        estado("6", { ultimo_sync_em: ha(7 * HORA), ultimo_erro: ERRO_401, ultimo_erro_tipo: "falhou" }),
      ],
      fin_orders: [],
    });
  }

  beforeEach(() => {
    process.env.CRON_SECRET = "segredo";
    mundo.usuario = { id: "u1" };
    mundo.lidas.length = 0;
    mundo.prazos.length = 0;
    mundo.falhas.clear();
    mundo.naoTermina.clear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("carga inicial que parou no teto continua na segunda volta, com a sobra dividida, sem contar duas vezes", async () => {
    usar(
      fakeSupabase({
        stores: [loja("1", "em-dia"), loja("2", "nova-a"), loja("3", "nova-b")],
        fin_sync_state: [estado("1", { ultimo_sync_em: ha(20 * MIN) })],
        fin_orders: [],
      })
    );
    mundo.naoTermina.add("nova-a.myshopify.com").add("nova-b.myshopify.com");
    const r = await chamar(true);
    expect(mundo.lidas).toEqual([
      // Primeira volta: rodizio, a carga com o teto, a loja em dia na vez dela.
      { loja: "nova-a.myshopify.com", paginas: MAX_PAGINAS_CARGA_INICIAL },
      { loja: "nova-b.myshopify.com", paginas: MAX_PAGINAS_CARGA_INICIAL },
      { loja: "em-dia.myshopify.com", paginas: undefined },
      // Segunda volta: so as cargas que nao terminaram.
      { loja: "nova-a.myshopify.com", paginas: MAX_PAGINAS_SEGUNDA_VOLTA },
      { loja: "nova-b.myshopify.com", paginas: MAX_PAGINAS_SEGUNDA_VOLTA },
    ]);
    expect(r).toMatchObject({ ok: true, processadas: 3, puladas: 0, erros: [] });
    // A primeira volta vai com o orcamento da funcao; na segunda, a primeira
    // carga fica com ~metade da sobra e a ultima vai ate o fim.
    const [limiteEm] = mundo.prazos as number[];
    expect(mundo.prazos.slice(0, 3)).toEqual([limiteEm, limiteEm, limiteEm]);
    const sobraDaPrimeira = limiteEm - (mundo.prazos[3] as number);
    expect(sobraDaPrimeira).toBeGreaterThan(100_000);
    expect(sobraDaPrimeira).toBeLessThanOrEqual(120_000);
    expect(mundo.prazos[4]).toBe(limiteEm);
    // Nao terminou: a carga segue pendente para a proxima rodada.
    expect(linhaDe("2").carga_inicial_ok).toBeUndefined();
  });

  it("carga que termina na primeira volta nao ganha segunda; Atualizar agora le o padrao e nao da segunda volta", async () => {
    usar(fakeSupabase({ stores: [loja("1", "nova-pequena"), loja("2", "nova-grande")], fin_sync_state: [], fin_orders: [] }));
    mundo.naoTermina.add("nova-grande.myshopify.com");
    await chamar(false);
    expect(mundo.lidas).toEqual([
      { loja: "nova-pequena.myshopify.com", paginas: undefined },
      { loja: "nova-grande.myshopify.com", paginas: undefined },
    ]);

    mundo.lidas.length = 0;
    usar(fakeSupabase({ stores: [loja("1", "nova-pequena")], fin_sync_state: [], fin_orders: [] }));
    await chamar(true);
    expect(mundo.lidas).toEqual([{ loja: "nova-pequena.myshopify.com", paginas: MAX_PAGINAS_CARGA_INICIAL }]);
    expect(linhaDe("1").carga_inicial_ok).toBe(true);
  });

  it("503 em HTML no pedido do token: a loja e tentada de novo na rodada seguinte", async () => {
    usar(fakeSupabase({ stores: [loja("1", "instavel")], fin_sync_state: [estado("1", { ultimo_sync_em: ha(HORA) })], fin_orders: [] }));
    const { erro } = await erroDoToken(503, PAGINA_DE_ERRO, { "content-type": "text/html" });
    mundo.falhas.set("instavel.myshopify.com", erro);
    await chamar(true);
    expect(linhaDe("1")).toMatchObject({ ultimo_erro: "Falha ao autenticar na Shopify (status 503).", ultimo_erro_tipo: "falhou" });

    mundo.lidas.length = 0;
    const segunda = await chamar(true);
    expect(mundo.lidas.map((l) => l.loja)).toEqual(["instavel.myshopify.com"]);
    expect(segunda.puladas).toBe(0);
  });

  it("rodizio pela ultima tentativa; pausada e negada esperam; a fora do ar ha 7 h volta; a nova le 10 paginas", async () => {
    usar(bancoMisto());
    const r = await chamar(true);
    expect(mundo.lidas).toEqual([
      { loja: "nova.myshopify.com", paginas: 10 },
      { loja: "sem-token-velha.myshopify.com", paginas: undefined },
      { loja: "em-dia-b.myshopify.com", paginas: undefined },
      { loja: "em-dia-a.myshopify.com", paginas: undefined },
    ]);
    expect(r).toMatchObject({ ok: true, processadas: 4, puladas: 2, erros: [] });
    // Quem esperou nao foi tocado: o erro continua na tela.
    expect(linhaDe("2")).toMatchObject({ ultimo_erro: ERRO_402, ultimo_erro_tipo: "falhou", sincronizando_desde: null });
  });

  it("Atualizar agora (sessao) nao espera loja fora do ar", async () => {
    usar(bancoMisto());
    await chamar(false);
    expect(mundo.lidas.map((l) => l.loja)).toContain("pausada.myshopify.com");
    expect(mundo.lidas.map((l) => l.loja)).toContain("negada.myshopify.com");
  });

  it("402 vira espera de 6 h; o timeout tenta na rodada seguinte", async () => {
    usar(
      fakeSupabase({
        stores: [loja("1", "congelada"), loja("2", "travada")],
        fin_sync_state: [estado("1", { ultimo_sync_em: ha(HORA) }), estado("2", { ultimo_sync_em: ha(HORA) })],
        fin_orders: [],
      })
    );
    const { erro: timeout } = await timeoutDaShopify({ shopDomain: "travada.myshopify.com", clientId: "c3", accessToken: "shpat_x" });
    mundo.falhas.set("congelada.myshopify.com", new ShopifyClientError(ERRO_402, "REQUEST_FAILED", 402));
    mundo.falhas.set("travada.myshopify.com", timeout);

    const primeira = await chamar(true);
    expect(primeira.erros).toHaveLength(2);
    expect(linhaDe("1")).toMatchObject({ ultimo_erro: ERRO_402, ultimo_erro_tipo: "falhou", sincronizando_desde: null });
    expect(linhaDe("2")).toMatchObject({ ultimo_erro: "A Shopify nao respondeu em 25 s.", ultimo_erro_tipo: "falhou" });

    mundo.lidas.length = 0;
    const segunda = await chamar(true);
    expect(mundo.lidas.map((l) => l.loja)).toEqual(["travada.myshopify.com"]);
    expect(segunda.puladas).toBe(1);

    // Passadas as 6 h, a congelada e conferida de novo.
    linhaDe("1").ultimo_sync_em = ha(ESPERA_FORA_DO_AR_MS + MIN);
    mundo.lidas.length = 0;
    await chamar(true);
    expect(mundo.lidas.map((l) => l.loja)).toEqual(["congelada.myshopify.com", "travada.myshopify.com"]);
  });
});
