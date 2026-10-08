import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Autorizacao do webhook da Pagou, dois caminhos:
//  - webhook do painel: X-Pagou-Timestamp + X-Pagou-Signature =
//    "sha256=" + HMAC_SHA256(Security Token, `${timestamp}.${corpoCru}`) em hex,
//    timestamp a no maximo 5 min do relogio;
//  - postback da notify_url (sem assinatura): ?t= com PAGOU_WEBHOOK_TOKEN.

const eventos = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const api = {
        insert: async (linha: Record<string, unknown>) => {
          if (eventos.has(String(linha.id))) return { error: { code: "23505" } };
          eventos.set(String(linha.id), { ...linha, processed_at: null });
          return { error: null };
        },
        update: () => api,
        eq: () => api,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      };
      return api;
    },
  }),
}));

const getSubscription = vi.fn();
const getTransaction = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  getTransaction: (...a: unknown[]) => getTransaction(...a),
}));

const TOKEN = "token-da-notify-url";
const SEGREDO = "security-token-do-painel";

const { POST } = await import("@/app/api/billing/pagou/webhook/route");

const URL_BASE = "http://localhost/api/billing/pagou/webhook";
const agora = () => Math.floor(Date.now() / 1000);

function assinar(timestamp: string, corpoCru: string, segredo = SEGREDO) {
  return "sha256=" + createHmac("sha256", segredo).update(`${timestamp}.${corpoCru}`).digest("hex");
}

function assinado(corpoCru: string, headers: Record<string, string>, url = URL_BASE) {
  return POST(new NextRequest(url, { method: "POST", body: corpoCru, headers }));
}

// Evento de familia que o handler so registra: o teste e da porta, nao do resto.
const corpo = (id: string) => JSON.stringify({ id, event: "outro", data: { id: "x_1" } });

beforeEach(() => {
  eventos.clear();
  getSubscription.mockReset();
  getTransaction.mockReset();
  process.env.PAGOU_WEBHOOK_TOKEN = TOKEN;
  process.env.PAGOU_WEBHOOK_SECRET = SEGREDO;
});

afterEach(() => {
  delete process.env.PAGOU_WEBHOOK_TOKEN;
  delete process.env.PAGOU_WEBHOOK_SECRET;
});

describe("webhook da Pagou: assinatura HMAC", () => {
  it("assinatura valida passa e registra o evento", async () => {
    const cru = corpo("ev_ok");
    const ts = String(agora());
    const r = await assinado(cru, { "X-Pagou-Timestamp": ts, "X-Pagou-Signature": assinar(ts, cru) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true });
    expect(eventos.has("ev_ok")).toBe(true);
  });

  it("o corpo cru e o que vale: espacos e ordem das chaves fazem parte da assinatura", async () => {
    const cru = '{ "data": {"id":"x_1"},  "event":"outro", "id":"ev_cru" }';
    const ts = String(agora());
    const r = await assinado(cru, { "x-pagou-timestamp": ts, "x-pagou-signature": assinar(ts, cru) });
    expect(r.status).toBe(200);
    expect(eventos.has("ev_cru")).toBe(true);
  });

  it("assinatura invalida responde 401", async () => {
    const cru = corpo("ev_ruim");
    const ts = String(agora());
    const r = await assinado(cru, {
      "X-Pagou-Timestamp": ts,
      "X-Pagou-Signature": assinar(ts, cru, "outro-segredo"),
    });
    expect(r.status).toBe(401);
    expect(eventos.size).toBe(0);
  });

  it("timestamp velho (mais de 5 min) responde 401, mesmo com HMAC certo", async () => {
    const cru = corpo("ev_velho");
    const ts = String(agora() - 6 * 60);
    const r = await assinado(cru, { "X-Pagou-Timestamp": ts, "X-Pagou-Signature": assinar(ts, cru) });
    expect(r.status).toBe(401);
    expect(eventos.size).toBe(0);
  });

  it("timestamp no futuro alem de 5 min responde 401", async () => {
    const cru = corpo("ev_futuro");
    const ts = String(agora() + 6 * 60);
    const r = await assinado(cru, { "X-Pagou-Timestamp": ts, "X-Pagou-Signature": assinar(ts, cru) });
    expect(r.status).toBe(401);
  });

  it("sem X-Pagou-Timestamp responde 401", async () => {
    const cru = corpo("ev_sem_ts");
    const r = await assinado(cru, { "X-Pagou-Signature": assinar(String(agora()), cru) });
    expect(r.status).toBe(401);
  });

  it("corpo alterado depois de assinado responde 401", async () => {
    const original = corpo("ev_orig");
    const adulterado = JSON.stringify({ id: "ev_orig", event: "transaction", data: { id: "tx_forjada" } });
    const ts = String(agora());
    const r = await assinado(adulterado, {
      "X-Pagou-Timestamp": ts,
      "X-Pagou-Signature": assinar(ts, original),
    });
    expect(r.status).toBe(401);
    expect(getTransaction).not.toHaveBeenCalled();
    expect(eventos.size).toBe(0);
  });

  it("assinatura nao vale sem PAGOU_WEBHOOK_SECRET configurado", async () => {
    delete process.env.PAGOU_WEBHOOK_SECRET;
    const cru = corpo("ev_sem_segredo");
    const ts = String(agora());
    const r = await assinado(cru, { "X-Pagou-Timestamp": ts, "X-Pagou-Signature": assinar(ts, cru) });
    expect(r.status).toBe(401);
  });

  it("so com PAGOU_WEBHOOK_SECRET (sem token) a assinatura basta", async () => {
    delete process.env.PAGOU_WEBHOOK_TOKEN;
    const cru = corpo("ev_so_segredo");
    const ts = String(agora());
    const r = await assinado(cru, { "X-Pagou-Timestamp": ts, "X-Pagou-Signature": assinar(ts, cru) });
    expect(r.status).toBe(200);
  });
});

describe("webhook da Pagou: caminho do token (notify_url)", () => {
  it("?t= continua passando, sem assinatura", async () => {
    const r = await assinado(corpo("ev_t"), {}, `${URL_BASE}?t=${TOKEN}`);
    expect(r.status).toBe(200);
    expect(eventos.has("ev_t")).toBe(true);
  });

  it("?t= errado e sem assinatura responde 401", async () => {
    const r = await assinado(corpo("ev_t_ruim"), {}, `${URL_BASE}?t=errado`);
    expect(r.status).toBe(401);
  });

  it("sem token nem assinatura responde 401", async () => {
    const r = await assinado(corpo("ev_nada"), {});
    expect(r.status).toBe(401);
  });

  it("sem PAGOU_WEBHOOK_TOKEN e sem PAGOU_WEBHOOK_SECRET responde 503", async () => {
    delete process.env.PAGOU_WEBHOOK_TOKEN;
    delete process.env.PAGOU_WEBHOOK_SECRET;
    const r = await assinado(corpo("ev_503"), {}, `${URL_BASE}?t=${TOKEN}`);
    expect(r.status).toBe(503);
  });
});
