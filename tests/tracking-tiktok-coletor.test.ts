import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATRASO_CHECKOUT_EXPRESSO_MS, idDoCheckoutExpresso } from "../src/lib/tracking/eventos";
import { sha256 } from "../src/lib/tracking/normalizar";

// ============================================================================
// O coletor com um destino TikTok, rodando o POST de verdade contra um banco
// de mentira. O que trava:
//   - uma linha de fila por destino, Meta e TikTok, com o MESMO event_id;
//   - o payload do TikTok: nome padrao, ttclid e _ttp do corpo (ou da
//     identidade, no checkout), IP, user agent, page.url -- e NADA de valor;
//   - o payload do Meta continua o mesmo;
//   - ttclid TESTE_* marca teste, e o TikTok sem codigo de teste nao recebe;
//   - o checkout expresso vale para o TikTok como vale para o Meta.
// ============================================================================

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";
const AGORA = Date.parse("2026-10-06T12:00:00Z");

interface Linha {
  destination: string;
  destination_id: string;
  event_name: string;
  event_id: string;
  payload: Record<string, unknown>;
  proximaTentativaEm: Date | null;
}

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  destinos: [] as Record<string, unknown>[],
  fila: [] as Linha[],
  /** Saiu na hora (entregar do coletor). */
  saiu: [] as string[],
  /** registrarSemEnviar: o teste que fica na fila sem sair. */
  semEnviar: [] as Record<string, unknown>[],
  /** O que publicarIdentidade escreveu em tracking_identities. */
  identidades: [] as Record<string, unknown>[],
  /** O que a identidade do checkout devolve por clientId. */
  identidadeDoCliente: null as Record<string, unknown> | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => mundo.destinos,
  destinoAceita: (d: { ativo: boolean; token?: string | null }) => d.ativo && Boolean(d.token),
}));
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async (
    _a: unknown,
    e: {
      destination: string;
      destinationId: string;
      evento: { event_name: string; event_id: string };
      payload: Record<string, unknown>;
      proximaTentativaEm?: Date | null;
    }
  ) => {
    mundo.fila.push({
      destination: e.destination,
      destination_id: e.destinationId,
      event_name: e.evento.event_name,
      event_id: e.evento.event_id,
      payload: e.payload,
      proximaTentativaEm: e.proximaTentativaEm ?? null,
    });
    return { id: `l${mundo.fila.length}`, duplicado: false };
  },
  entregar: async (_a: unknown, l: { destination: string }) => {
    mundo.saiu.push(l.destination);
    return { ok: true };
  },
}));
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async () => mundo.identidadeDoCliente,
}));

/** So o que o coletor consulta neste caminho. */
function bancoFalso() {
  mundo.admin = {
    from(tabela: string) {
      let op = "select";
      let campos: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        update: (c: Record<string, unknown>) => {
          op = "update";
          campos = c;
          return b;
        },
        upsert: (c: Record<string, unknown>) => {
          op = "upsert";
          campos = c;
          return b;
        },
        insert: (c: Record<string, unknown>) => {
          op = "insert";
          campos = c;
          return b;
        },
        eq: () => b,
        is: () => b,
        in: () => b,
        gte: () => b,
        not: () => b,
        like: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown) => {
          let data: unknown = null;
          if (tabela === "stores") data = [{ id: STORE }];
          else if (tabela === "tracking_configs" && op === "select") {
            // Pixel do checkout visto ha muito: o begin_checkout do tema sai.
            data = [{ store_id: STORE, enabled: true, web_pixel_visto_em: null, web_pixel_com_id_em: null }];
          } else if (tabela === "tracking_identities" && op === "update") {
            mundo.identidades.push(campos);
            data = [{ id: "i1" }];
          } else if (tabela === "tracking_events" && op === "insert") {
            mundo.semEnviar.push(campos);
          } else if (tabela === "tracking_events") {
            data = [];
          }
          return Promise.resolve({ data, count: 0, error: null }).then(ok);
        },
      });
      return b;
    },
  };
}

const destino = (plataforma: "meta" | "tiktok", over: Record<string, unknown> = {}) => ({
  id: plataforma === "meta" ? "dest-meta-0001" : "dest-tiktok-01",
  storeId: STORE,
  plataforma,
  nome: null,
  conta: plataforma === "meta" ? "123456" : "CUSG5HBC77UD11VVRQEG",
  labels: {},
  testEventCode: null,
  idTemplate: null,
  ativo: true,
  token: plataforma === "meta" ? "EAAB" : "tok-tt",
  ...over,
});

async function postar(corpo: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/tracking/collect/route");
  const { NextRequest } = await import("next/server");
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/tracking/collect", {
      method: "POST",
      body: JSON.stringify({ shop: SHOP, storeId: STORE, ...corpo }),
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (iPhone)",
        "x-forwarded-for": "203.0.113.50, 10.0.0.1",
      },
    })
  );
  return (await r.json()) as Record<string, unknown>;
}

const CARRINHO = {
  evento: "add_to_cart",
  eventId: "add_to_cart_vid-1_1759752000000",
  visitorId: "vid-1",
  clientId: "cli-1",
  ttclid: "E.C.P.CLIQUE_DE_VERDADE",
  ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
  fbp: "fb.1.1.2",
  pageUrl: "https://loja.shop/products/camisa?ttclid=E.C.P.CLIQUE_DE_VERDADE",
  produto: { variante: "11", produto: "7", sku: "S" },
  // Valor forjado: o coletor ignora.
  value: 9999,
  currency: "USD",
};

const daPlataforma = (p: string) => mundo.fila.filter((l) => l.destination === p);

describe("coletor com destino TikTok", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    mundo.destinos = [destino("meta"), destino("tiktok")];
    mundo.fila.length = 0;
    mundo.saiu.length = 0;
    mundo.semEnviar.length = 0;
    mundo.identidades.length = 0;
    mundo.identidadeDoCliente = null;
    bancoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uma linha por plataforma, com o mesmo event_id, e as duas saem na hora", async () => {
    const r = await postar(CARRINHO);
    expect(r.destinos).toEqual({ "meta:dest-met": "enviado", "tiktok:dest-tik": "enviado" });
    expect(mundo.fila.map((l) => [l.destination, l.event_name, l.event_id])).toEqual([
      ["meta", "add_to_cart", CARRINHO.eventId],
      ["tiktok", "add_to_cart", CARRINHO.eventId],
    ]);
    expect(mundo.saiu).toEqual(["meta", "tiktok"]);
  });

  /**
   * Anuncio direto para o permalink (/cart/ID:1): nenhum tema roda, e o unico
   * lugar onde o clique existe e o que o pixel trouxe (atributo ou URL do
   * checkout). O pixel passa a PUBLICAR a identidade nesse caso, senao a compra
   * desse comprador nao acha o clique por lugar nenhum. Sem clique, o pixel
   * segue so consultando, como antes.
   */
  it("pixel com clique publica a identidade pelo clientId; sem clique, nao", async () => {
    const doPixel = {
      evento: "begin_checkout",
      fonte: "pixel",
      eventId: "begin_checkout_ck_tok-1",
      visitorId: "cli-9",
      clientId: "cli-9",
      checkoutToken: "tok-1",
      pageUrl: "https://loja.shop/checkouts/cn/abc/en-us?fbclid=IwZXh0CLIQUE",
    };
    await postar({ ...doPixel, fbclid: "IwZXh0CLIQUE" });
    expect(mundo.identidades.length).toBe(1);
    expect(mundo.identidades[0]).toMatchObject({ shopify_client_id: "cli-9", fbclid: "IwZXh0CLIQUE" });

    mundo.identidades.length = 0;
    mundo.fila.length = 0;
    await postar({ ...doPixel, eventId: "begin_checkout_ck_tok-2", checkoutToken: "tok-2" });
    expect(mundo.identidades).toEqual([]);
  });

  it("payload do TikTok: nome padrao, ttclid e _ttp, IP e UA, page.url -- sem valor", async () => {
    await postar(CARRINHO);
    const [tt] = daPlataforma("tiktok");
    expect(tt.payload).toEqual({
      event: "AddToCart",
      event_time: Math.floor(AGORA / 1000),
      event_id: CARRINHO.eventId,
      user: {
        external_id: [sha256("vid-1"), sha256("cli-1")],
        ttclid: "E.C.P.CLIQUE_DE_VERDADE",
        ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
        ip: "203.0.113.50",
        user_agent: "Mozilla/5.0 (iPhone)",
      },
      // O ttclid sai da URL: inteiro, ele ja vai em user.ttclid.
      page: { url: "https://loja.shop/products/camisa" },
      properties: { content_type: "product", contents: [{ content_id: "11" }] },
    });
    expect(JSON.stringify(tt.payload)).not.toMatch(/"value"|"currency"|9999/);
  });

  it("o payload do Meta continua o de sempre", async () => {
    await postar(CARRINHO);
    const [meta] = daPlataforma("meta");
    expect(meta.payload).toMatchObject({
      event_name: "AddToCart",
      event_id: CARRINHO.eventId,
      action_source: "website",
      event_source_url: CARRINHO.pageUrl,
      custom_data: { content_type: "product", content_ids: ["11"] },
    });
    expect(Object.keys(meta.payload.user_data as object)).not.toContain("ttclid");
    expect(JSON.stringify(meta.payload)).not.toContain("UqBuLHl7");
  });

  it("a identidade do visitante guarda o ttclid e o _ttp", async () => {
    await postar(CARRINHO);
    expect(mundo.identidades[0]).toMatchObject({
      ttclid: "E.C.P.CLIQUE_DE_VERDADE",
      ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
    });
    // Sem _ttp, a escrita nem cita a coluna (059).
    mundo.identidades.length = 0;
    await postar({ ...CARRINHO, eventId: "add_to_cart_vid-1_2", ttp: null });
    expect(mundo.identidades[0]).not.toHaveProperty("ttp");
  });

  it("no checkout (Web Pixel), o clique do TikTok vem da identidade; e-mail e telefone em hash", async () => {
    mundo.identidadeDoCliente = { visitorId: "vid-1", ttclid: "E.C.P.DA_IDENTIDADE", ttp: "TTP_ID" };
    await postar({
      evento: "payment_info",
      fonte: "pixel",
      eventId: "payment_info_e1",
      visitorId: "cli-1",
      clientId: "cli-1",
      checkoutToken: "T1",
      email: "Comprador@Exemplo.com",
      telefone: "11 98765-4321",
      pais: "BR",
      pageUrl: "https://loja.shop/checkouts/cn/T1",
    });
    const [tt] = daPlataforma("tiktok");
    expect(tt.event_id).toBe("payment_info_ck_T1");
    expect(tt.payload).toMatchObject({
      event: "AddPaymentInfo",
      event_id: "payment_info_ck_T1",
      user: {
        email: sha256("comprador@exemplo.com"),
        phone: sha256("+5511987654321"),
        ttclid: "E.C.P.DA_IDENTIDADE",
        ttp: "TTP_ID",
        external_id: [sha256("vid-1"), sha256("cli-1")],
      },
    });
  });

  it("ttclid TESTE_* marca teste: o TikTok sem codigo de teste nao recebe", async () => {
    const r = await postar({ ...CARRINHO, ttclid: "TESTE_TT" });
    expect(r.destinos).toEqual({
      "meta:dest-met": "teste: nao enviado",
      "tiktok:dest-tik": "teste: nao enviado",
    });
    expect(mundo.fila).toEqual([]);
    const tt = mundo.semEnviar.find((l) => l.destination === "tiktok")!;
    expect(tt.payload).toMatchObject({ event: "AddToCart", teste: true });
  });

  it("com codigo de teste no destino, o teste do TikTok sai (para a aba Test Events)", async () => {
    mundo.destinos = [destino("tiktok", { testEventCode: "TEST123" })];
    const r = await postar({ ...CARRINHO, ttclid: "TESTE_TT" });
    expect(r.destinos).toEqual({ "tiktok:dest-tik": "enviado" });
    // Sai cru: a marca so entra na linha que nao sai.
    expect(daPlataforma("tiktok")[0].payload).not.toHaveProperty("teste");
  });

  it("loja so com TikTok: o evento entra", async () => {
    mundo.destinos = [destino("tiktok")];
    expect((await postar(CARRINHO)).destinos).toEqual({ "tiktok:dest-tik": "enviado" });
  });

  it("TikTok sem token nao entra na fila", async () => {
    mundo.destinos = [destino("tiktok", { token: null })];
    expect(await postar(CARRINHO)).toMatchObject({ ignorado: "evento nao configurado" });
  });

  it("ttclid acima de 1000 caracteres fica de fora, em vez de ir cortado", async () => {
    await postar({ ...CARRINHO, ttclid: `E.C.P.${"x".repeat(1000)}` });
    expect(daPlataforma("tiktok")[0].payload.user).not.toHaveProperty("ttclid");
  });

  it("checkout expresso: o TikTok tambem espera o pixel, com os itens do carrinho", async () => {
    const r = await postar({
      evento: "begin_checkout",
      eventId: "qualquer",
      visitorId: "vid-1",
      clientId: "cli-1",
      ttclid: "E.C.P.X",
      origem: "expresso",
      produtos: [{ variante: "11" }, { variante: "12" }],
      pageUrl: "https://loja.shop/cart",
    });
    expect(r.destinos).toEqual({
      "meta:dest-met": "aguardando o pixel",
      "tiktok:dest-tik": "aguardando o pixel",
    });
    expect(mundo.saiu).toEqual([]);
    const [tt] = daPlataforma("tiktok");
    expect(tt.event_id).toBe(idDoCheckoutExpresso("vid-1", AGORA));
    expect(tt.proximaTentativaEm?.getTime()).toBe(AGORA + ATRASO_CHECKOUT_EXPRESSO_MS);
    expect(tt.payload).toMatchObject({
      event: "InitiateCheckout",
      event_id: idDoCheckoutExpresso("vid-1", AGORA),
      properties: { contents: [{ content_id: "11" }, { content_id: "12" }] },
    });
  });
});
