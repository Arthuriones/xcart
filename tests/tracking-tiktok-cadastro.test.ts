import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Cadastro de destino TikTok em /api/tracking/destinos.
//
// O que trava:
//   - o Pixel Code e alfanumerico: nao pode ter as letras arrancadas, como o
//     id do Meta tem;
//   - o token e obrigatorio e e CONFERIDO no TikTok antes de gravar, com um
//     evento custom (nunca uma compra), no codigo de teste do lojista quando ha;
//   - recusa do TikTok nao cria destino; o TikTok sem resposta da 503;
//   - o token vai para tracking_destination_secrets, como o do Meta;
//   - trocar o token devolve a fila o que caiu pela credencial, com o filtro
//     do formato de resposta do TikTok.
// ============================================================================

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  usuario: { id: "u1" } as { id: string } | null,
  rede: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mundo.usuario } }) },
  }),
}));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: (url: string, init?: RequestInit) => mundo.rede(url, init),
}));

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

interface Escrita {
  tabela: string;
  op: string;
  valores: Record<string, unknown> | null;
  ou?: string;
}

/** Banco falso: responde por tabela e anota toda escrita. */
function bancoFalso(atual: Record<string, unknown> | null = null) {
  const escritas: Escrita[] = [];
  mundo.admin = {
    from(tabela: string) {
      const e: Escrita = { tabela, op: "select", valores: null };
      const b: Record<string, unknown> = {};
      const escreve = (op: string) => (v: Record<string, unknown>) => {
        e.op = op;
        e.valores = v;
        return b;
      };
      Object.assign(b, {
        select: () => b,
        insert: escreve("insert"),
        upsert: escreve("upsert"),
        update: escreve("update"),
        delete: () => {
          e.op = "delete";
          return b;
        },
        eq: () => b,
        gte: () => b,
        in: () => b,
        or: (f: string) => {
          e.ou = f;
          return b;
        },
        maybeSingle: () => b,
        single: () => b,
        then: (ok: (v: unknown) => unknown) => {
          if (e.op !== "select") escritas.push(e);
          let data: unknown = null;
          if (tabela === "stores") data = { id: STORE, user_id: "u1" };
          else if (tabela === "tracking_destinations" && e.op === "insert") data = { id: "dest-tt" };
          else if (tabela === "tracking_destinations" && e.op === "select") data = atual;
          else if (tabela === "tracking_destination_secrets" && e.op === "select") {
            data = { access_token: "tok-velho" };
          } else if (tabela === "tracking_configs" && e.op === "select") data = { enabled: true };
          else if (tabela === "tracking_events" && e.op === "update") {
            data = [{ event_name: "Purchase" }, { event_name: "add_to_cart" }];
          }
          return Promise.resolve({ data, count: 0, error: null }).then(ok);
        },
      });
      return b;
    },
  };
  return escritas;
}

const chamadas: { url: string; init?: RequestInit }[] = [];
function tiktokResponde(corpo: unknown) {
  mundo.rede = async (url, init) => {
    chamadas.push({ url, init });
    if (corpo instanceof Error) throw corpo;
    return new Response(JSON.stringify(corpo), { status: 200 });
  };
}

async function chamar(metodo: "POST" | "PATCH", corpo: Record<string, unknown>) {
  const rota = await import("../src/app/api/tracking/destinos/route");
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("https://user.xcart.app/api/tracking/destinos", {
    method: metodo,
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  const r = metodo === "POST" ? await rota.POST(req) : await rota.PATCH(req);
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

const NOVO = {
  storeId: STORE,
  plataforma: "tiktok",
  nome: "Loja principal",
  conta: " CUSG5HBC77UD 11VVRQEG ",
  accessToken: " tok-tt ",
  testEventCode: "TEST123",
};

describe("POST /api/tracking/destinos (TikTok)", () => {
  beforeEach(() => {
    chamadas.length = 0;
    mundo.usuario = { id: "u1" };
  });

  it("confere o token com um evento custom no codigo de teste e grava pixel, token e loja ligada", async () => {
    const escritas = bancoFalso();
    tiktokResponde({ code: 0, message: "OK", request_id: "r1" });
    const r = await chamar("POST", NOVO);
    expect(r).toEqual({ status: 200, corpo: { ok: true, id: "dest-tt" } });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe(ENDPOINT);
    expect((chamadas[0].init?.headers as Record<string, string>)["Access-Token"]).toBe("tok-tt");
    const enviado = JSON.parse(String(chamadas[0].init?.body));
    expect(enviado).toMatchObject({
      event_source: "web",
      event_source_id: "CUSG5HBC77UD11VVRQEG",
      test_event_code: "TEST123",
    });
    expect(enviado.data.map((d: { event: string }) => d.event)).toEqual(["XcartCredentialCheck"]);

    const destino = escritas.find((e) => e.tabela === "tracking_destinations" && e.op === "insert")!;
    expect(destino.valores).toMatchObject({
      plataforma: "tiktok",
      // So o espaco saiu; as letras ficaram.
      conta: "CUSG5HBC77UD11VVRQEG",
      test_event_code: "TEST123",
      nome: "Loja principal",
    });
    expect(JSON.stringify(destino.valores)).not.toContain("tok-tt");
    expect(escritas.find((e) => e.tabela === "tracking_destination_secrets")?.valores).toEqual({
      destination_id: "dest-tt",
      access_token: "tok-tt",
    });
    expect(escritas.find((e) => e.tabela === "tracking_configs")?.valores).toMatchObject({ enabled: true });
  });

  it("token de outra conta (40001): 400 com o que fazer, e nada gravado", async () => {
    const escritas = bancoFalso();
    tiktokResponde({ code: 40001, message: "No permission to operate pixel code: CUSG5HBC77UD11VVRQEG" });
    const r = await chamar("POST", NOVO);
    expect(r.status).toBe(400);
    expect(String(r.corpo.error)).toMatch(/não tem acesso a este pixel/);
    expect(escritas).toEqual([]);
  });

  it("token invalido (40105): 400 com a mensagem do TikTok", async () => {
    const escritas = bancoFalso();
    tiktokResponde({ code: 40105, message: "Access token is invalid" });
    const r = await chamar("POST", NOVO);
    expect(r.status).toBe(400);
    expect(String(r.corpo.error)).toContain("40105: Access token is invalid");
    expect(escritas).toEqual([]);
  });

  it("TikTok sem resposta: 503, nada gravado", async () => {
    const escritas = bancoFalso();
    tiktokResponde(new Error("timeout"));
    const r = await chamar("POST", NOVO);
    expect(r.status).toBe(503);
    expect(escritas).toEqual([]);
  });

  it("Pixel Code fora do formato e token ausente sao recusados antes da rede", async () => {
    bancoFalso();
    tiktokResponde({ code: 0 });
    for (const conta of ["123", "CUSG5HBC-77UD11VVRQEG", ""]) {
      expect((await chamar("POST", { ...NOVO, conta })).status).toBe(400);
    }
    const semToken = await chamar("POST", { ...NOVO, accessToken: "" });
    expect(semToken.status).toBe(400);
    expect(String(semToken.corpo.error)).toMatch(/Access Token da Events API/);
    expect(chamadas).toHaveLength(0);
  });

  it("plataforma desconhecida continua recusada", async () => {
    bancoFalso();
    expect((await chamar("POST", { ...NOVO, plataforma: "snapchat" })).status).toBe(400);
  });
});

describe("PATCH /api/tracking/destinos (TikTok)", () => {
  const ATUAL = {
    id: "dest-tt",
    store_id: STORE,
    user_id: "u1",
    plataforma: "tiktok",
    conta: "CUSG5HBC77UD11VVRQEG",
    labels: {},
    test_event_code: null,
    id_template: null,
    ativo: true,
  };

  beforeEach(() => {
    chamadas.length = 0;
    mundo.usuario = { id: "u1" };
  });

  it("token novo conferido devolve a fila o que caiu pela credencial, pelo code do TikTok", async () => {
    const escritas = bancoFalso(ATUAL);
    tiktokResponde({ code: 0, message: "OK" });
    const r = await chamar("PATCH", { id: "dest-tt", accessToken: "tok-novo" });
    expect(r).toEqual({ status: 200, corpo: { ok: true, requeued: 2, requeuedPurchases: 1 } });
    expect(chamadas).toHaveLength(1);
    const volta = escritas.find((e) => e.tabela === "tracking_events" && e.op === "update")!;
    expect(volta.ou).toBe("response->>code.in.(40001,40102,40104,40105)");
    expect(escritas.find((e) => e.tabela === "tracking_destination_secrets")?.valores).toEqual({
      destination_id: "dest-tt",
      access_token: "tok-novo",
    });
  });

  it("editar sem token novo nao chama o TikTok nem mexe no token", async () => {
    const escritas = bancoFalso(ATUAL);
    tiktokResponde({ code: 0 });
    const r = await chamar("PATCH", { id: "dest-tt", nome: "Outro nome", testEventCode: "TEST9" });
    expect(r.status).toBe(200);
    expect(chamadas).toHaveLength(0);
    expect(escritas.some((e) => e.tabela === "tracking_destination_secrets")).toBe(false);
    expect(escritas.find((e) => e.tabela === "tracking_destinations")?.valores).toMatchObject({
      conta: "CUSG5HBC77UD11VVRQEG",
      test_event_code: "TEST9",
      nome: "Outro nome",
    });
  });
});
