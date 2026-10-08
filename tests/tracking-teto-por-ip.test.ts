import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chaveDoIp, hashDoIp } from "../src/lib/tracking/ip-balde";

// ============================================================================
// Teto por IP no coletor publico.
//
// O teto da loja e um balde so por hora, e storeId/shop estao no HTML do tema:
// uma origem so, com um visitorId novo a cada POST, enchia o balde de outra
// pessoa e todo evento real caia em "teto da loja" ate a hora virar. O que
// trava aqui:
//   - IPv6 conta pelo /64 (trocar o fim do endereco nao foge do teto);
//   - o teto por IP vem ANTES do da loja, e o que para nele nao vira linha;
//   - a linha da fila leva o ip_hash (e o que a contagem le);
//   - identidade nova tambem tem teto por IP;
//   - sem a migration 065 (contagem com erro) o evento segue: cego, nao fechado.
// ============================================================================

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";
const IP = "203.0.113.50";

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  /** count devolvido por consulta, pela "cara" dela. */
  contagem: { ip: 0, loja: 0, visitante: 0, identIp: 0, identLoja: 0 },
  /** Contagem do IP devolve erro (coluna ainda nao existe). */
  semColuna: false,
  fila: [] as Record<string, unknown>[],
  identidades: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => [
    {
      id: "dest-meta-0001",
      storeId: STORE,
      plataforma: "meta",
      nome: null,
      conta: "123456",
      labels: {},
      testEventCode: null,
      idTemplate: null,
      ativo: true,
      token: "EAAB",
    },
  ],
  destinoAceita: () => true,
}));
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async (_a: unknown, e: Record<string, unknown>) => {
    mundo.fila.push(e);
    return { id: `l${mundo.fila.length}`, duplicado: false };
  },
  entregar: async () => ({ ok: true }),
}));
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async () => null,
}));

function bancoFalso() {
  mundo.admin = {
    from(tabela: string) {
      let op = "select";
      let campos: Record<string, unknown> = {};
      const eqs: Record<string, unknown> = {};
      const nots: string[] = [];
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        update: (c: Record<string, unknown>) => ((op = "update"), (campos = c), b),
        upsert: (c: Record<string, unknown>) => ((op = "upsert"), (campos = c), b),
        insert: (c: Record<string, unknown>) => ((op = "insert"), (campos = c), b),
        eq: (k: string, v: unknown) => ((eqs[k] = v), b),
        not: (k: string) => (nots.push(k), b),
        is: () => b,
        in: () => b,
        gte: () => b,
        like: () => b,
        limit: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown) => {
          let data: unknown = null;
          let count = 0;
          let error: { message: string } | null = null;
          if (tabela === "stores") data = [{ id: STORE }];
          else if (tabela === "tracking_configs" && op === "select") {
            data = [{ store_id: STORE, enabled: true, web_pixel_visto_em: null, web_pixel_com_id_em: null }];
          } else if (tabela === "tracking_identities" && op === "update") {
            data = []; // visitante novo
          } else if (tabela === "tracking_identities" && op === "upsert") {
            mundo.identidades.push(campos);
          } else if (tabela === "tracking_identities") {
            if ("ip_hash" in eqs) {
              if (mundo.semColuna) error = { message: "column tracking_identities.ip_hash does not exist" };
              else count = mundo.contagem.identIp;
            } else count = mundo.contagem.identLoja;
          } else if (tabela === "tracking_events" && op === "select") {
            if ("ip_hash" in eqs) {
              if (mundo.semColuna) error = { message: "column tracking_events.ip_hash does not exist" };
              else count = mundo.contagem.ip;
            } else if ("visitor_id" in eqs) count = mundo.contagem.visitante;
            else if (nots.includes("visitor_id")) count = mundo.contagem.loja;
            data = [];
          }
          return Promise.resolve({ data, count, error }).then(ok);
        },
      });
      return b;
    },
  };
}

async function postar(corpo: Record<string, unknown>, ip = IP) {
  const { POST } = await import("../src/app/api/tracking/collect/route");
  const { NextRequest } = await import("next/server");
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/tracking/collect", {
      method: "POST",
      body: JSON.stringify({ shop: SHOP, storeId: STORE, ...corpo }),
      headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": `${ip}, 10.0.0.1` },
    })
  );
  return (await r.json()) as Record<string, unknown>;
}

const PRODUTO = {
  evento: "view_item",
  eventId: "view_item_vid-1_1",
  visitorId: "vid-1",
  produto: { variante: "11", produto: "7" },
};

describe("chave do IP", () => {
  it("IPv4 inteiro; lixo e vazio nao tem chave", () => {
    expect(chaveDoIp("203.0.113.50")).toBe("203.0.113.50");
    expect(chaveDoIp(" 203.0.113.50:443 ")).toBe("203.0.113.50");
    expect(chaveDoIp("::ffff:203.0.113.50")).toBe("203.0.113.50");
    expect(chaveDoIp("999.1.1.1")).toBeNull();
    expect(chaveDoIp("nao-e-ip")).toBeNull();
    expect(chaveDoIp("")).toBeNull();
    expect(chaveDoIp(null)).toBeNull();
  });

  it("IPv6 pelo /64: o fim do endereco nao muda a chave", () => {
    const a = chaveDoIp("2804:14c:5b80:8a1f:1d2:3e4f:5a6b:7c8d");
    expect(a).toBe("2804:14c:5b80:8a1f::/64");
    expect(chaveDoIp("2804:014c:5b80:8a1f::1")).toBe(a);
    expect(chaveDoIp("[2804:14c:5b80:8a1f::abcd]:443")).toBe(a);
    expect(chaveDoIp("2804:14c:5b80:8a20::1")).not.toBe(a);
    expect(chaveDoIp("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(chaveDoIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(chaveDoIp("1::2::3")).toBeNull();
  });

  it("hash com segredo: estavel, curto, e nao e o IP", () => {
    const h = hashDoIp("203.0.113.50", "s1");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(hashDoIp("203.0.113.50", "s1")).toBe(h);
    expect(hashDoIp("203.0.113.51", "s1")).not.toBe(h);
    expect(hashDoIp("203.0.113.50", "s2")).not.toBe(h);
    expect(hashDoIp("lixo", "s1")).toBeNull();
  });
});

describe("coletor com teto por IP", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-08T12:00:00Z"));
    mundo.contagem = { ip: 0, loja: 0, visitante: 0, identIp: 0, identLoja: 0 };
    mundo.semColuna = false;
    mundo.fila.length = 0;
    mundo.identidades.length = 0;
    bancoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("abaixo do teto: a linha da fila leva o ip_hash", async () => {
    const r = await postar(PRODUTO);
    expect(r.ok).toBe(true);
    expect(mundo.fila).toHaveLength(1);
    expect(mundo.fila[0].ipHash).toBe(hashDoIp(IP));
  });

  it("IP no teto: ignora sem gravar linha, e antes do teto da loja", async () => {
    mundo.contagem.ip = 1500;
    // Mesmo com a loja tambem estourada, quem responde e o teto do IP: o que
    // para aqui nao gasta o balde da loja nem carimba teto_atingido_em.
    mundo.contagem.loja = 20000;
    const r = await postar(PRODUTO);
    expect(r).toMatchObject({ ok: true, ignorado: "teto do ip" });
    expect(mundo.fila).toHaveLength(0);
  });

  it("outro IP segue passando com o balde da loja livre", async () => {
    mundo.contagem.ip = 0;
    const r = await postar(PRODUTO, "198.51.100.7");
    expect(r.ignorado).toBeUndefined();
    expect(mundo.fila).toHaveLength(1);
  });

  it("sem a coluna (065 nao aplicada): contagem erra e o evento segue", async () => {
    mundo.semColuna = true;
    mundo.contagem.ip = 99999;
    const r = await postar(PRODUTO);
    expect(r.ignorado).toBeUndefined();
    expect(mundo.fila).toHaveLength(1);
  });

  it("identidade nova: teto por IP barra, e a linha nova leva o ip_hash", async () => {
    const identidade = { evento: "identidade", eventId: "id-1", visitorId: "vid-9", clientId: "cli-9" };

    await postar(identidade);
    expect(mundo.identidades).toHaveLength(1);
    expect(mundo.identidades[0]).toMatchObject({ visitor_id: "vid-9", ip_hash: hashDoIp(IP) });

    mundo.identidades.length = 0;
    mundo.contagem.identIp = 500;
    await postar(identidade);
    expect(mundo.identidades).toHaveLength(0);
  });
});
