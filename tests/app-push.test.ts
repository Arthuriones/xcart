import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Push de venda no app do celular (Expo) e a preferencia de notificacao.
//
// O que trava:
//   - /api/app/v1/aparelhos: so o login do app (401/403), o formato do token
//     igual ao CHECK da 084, o upsert pelo token (o celular que entrou em outra
//     conta passa para ela), o DELETE so do dono e o 503 sem a tabela;
//   - /api/app/v1/notificacoes: o MESMO alerta_config.notificar_vendas da web,
//     criando a linha quando nao existe;
//   - o envio: lotes de ate 100 no Expo, em paralelo com os webhooks, o
//     DeviceNotRegistered apaga o token, outro erro grava ultimo_erro, sucesso
//     grava ultimo_envio_em; sem a 084 os webhooks seguem identicos; o
//     liga/desliga vale para o push; nada do comprador nem o token no log.
// ============================================================================

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  token: "eyJ.app.jwt" as string | null,
  usuario: { id: "u1" } as { id: string } | null,
  acesso: true,
  rede: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/supabase/server", () => ({
  tokenDoApp: async () => mundo.token,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mundo.usuario } }) } }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => mundo.usuario }));
vi.mock("@/lib/billing/access", () => ({ userHasAccess: async () => mundo.acesso }));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: (url: string, init?: RequestInit) => mundo.rede(url, init),
}));

import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import { mensagemDaVenda, notificarVendaNosCelulares, type Venda } from "@/lib/alertas/venda-webhook";
import { tokenExpoValido } from "@/lib/alertas/push-expo";
import { DELETE, POST } from "@/app/api/app/v1/aparelhos/route";
import { GET as LER_PREF, PATCH as GRAVAR_PREF } from "@/app/api/app/v1/notificacoes/route";

const U = "u1";
const OUTRO = "u2";
const EXPO = "https://exp.host/--/api/v2/push/send";
const URL_WEBHOOK = "https://ntfy.sh/SEGREDO-W";

const tk = (n: number | string) => `ExponentPushToken[aparelho-${String(n).padStart(6, "0")}]`;
const T1 = tk(1);
const T2 = tk(2);
const T3 = tk(3);

const VENDA: Venda = {
  loja: "Softnook",
  pedido: "#1012",
  valor: 69.9,
  moeda: "USD",
  statusFinanceiro: "paid",
  produtos: ["Towel"],
};

const SEM_TABELA = { code: "PGRST205", message: "Could not find the table 'public.app_aparelhos' in the schema cache" };

// Aberto ha 1 h: dentro do prazo do aparelho (PRAZO_DO_APARELHO_MS).
const HA_UMA_HORA = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function aparelho(id: string, expo_token: string, user_id = U, atualizado_em = HA_UMA_HORA) {
  return {
    id,
    user_id,
    expo_token,
    plataforma: "ios",
    criado_em: HA_UMA_HORA,
    atualizado_em,
    ultimo_envio_em: null,
    ultimo_erro: null,
  };
}

function banco(
  aparelhos: Record<string, unknown>[],
  o: {
    ativo?: boolean | null;
    webhooks?: string[];
    semTabela?: boolean;
    erroLeitura?: boolean;
    erroWebhooks?: boolean;
  } = {}
): FakeSupabase {
  const db = fakeSupabase(
    {
      alerta_config: o.ativo === null ? [] : [{ user_id: U, notificar_vendas: o.ativo ?? true }],
      alerta_config_secrets: [{ user_id: U, venda_webhook_url: null }],
      venda_webhooks: (o.webhooks || []).map((url, i) => ({
        id: `w${i}`,
        user_id: U,
        nome: "Celular",
        url,
        created_at: "2026-10-01T00:00:00Z",
        ultimo_envio_em: null,
        ultimo_erro: null,
      })),
      app_aparelhos: aparelhos,
    },
    (tabela, op) => {
      if (tabela === "venda_webhooks" && o.erroWebhooks && op === "select") {
        return { code: "57014", message: "canceling statement due to statement timeout" };
      }
      if (tabela !== "app_aparelhos") return null;
      if (o.semTabela) return SEM_TABELA;
      if (o.erroLeitura && op === "select") return { code: "57014", message: "canceling statement due to statement timeout" };
      return null;
    }
  );
  mundo.admin = db.client;
  return db;
}

function req(metodo: string, corpo?: unknown) {
  return new Request("https://user.xcart.test/api/app/v1/aparelhos", {
    method: metodo,
    body: corpo === undefined ? undefined : typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { "content-type": "application/json", authorization: "Bearer eyJ.app.jwt" },
  });
}

async function corpo(r: Response) {
  const texto = await r.text();
  return { status: r.status, json: JSON.parse(texto) as Record<string, unknown>, texto };
}

/** O Expo falso: um ticket por mensagem, pelo token. */
type Expo = { lotes: { to: string; title: string; body: string; data: unknown }[][]; webhooks: string[] };
function expoFalso(ticket: (token: string) => Record<string, unknown> = () => ({ status: "ok", id: "x" })): Expo {
  const visto: Expo = { lotes: [], webhooks: [] };
  mundo.rede = async (url, init) => {
    if (url !== EXPO) {
      visto.webhooks.push(url);
      return new Response("ok");
    }
    const mensagens = JSON.parse(String(init?.body)) as Expo["lotes"][number];
    visto.lotes.push(mensagens);
    return Response.json({ data: mensagens.map((m) => ticket(m.to)) });
  };
  return visto;
}

let logs: string[] = [];
beforeEach(() => {
  mundo.token = "eyJ.app.jwt";
  mundo.usuario = { id: U };
  mundo.acesso = true;
  mundo.rede = async () => new Response("ok");
  logs = [];
  for (const nivel of ["log", "warn", "error"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("formato do token", () => {
  it("o mesmo do CHECK da 084", () => {
    expect(tokenExpoValido("ExponentPushToken[abcdefghij]")).toBe(true);
    expect(tokenExpoValido("ExpoPushToken[AbC_123-xyz_000]")).toBe(true);
    expect(tokenExpoValido("ExponentPushToken[curto]")).toBe(false);
    expect(tokenExpoValido("ExponentPushToken[com espaco aqui]")).toBe(false);
    expect(tokenExpoValido("ExponentPushToken[abcdefghij] ")).toBe(false);
    expect(tokenExpoValido(`ExponentPushToken[${"a".repeat(201)}]`)).toBe(false);
    expect(tokenExpoValido("fcm:abcdefghijklmnop")).toBe(false);
    expect(tokenExpoValido(42)).toBe(false);
  });
});

describe("/api/app/v1/aparelhos", () => {
  it("sem o login do app: 401 e nada grava; sem acesso: nao registra, mas sai do app", async () => {
    const db = banco([aparelho("a1", T1)]);
    mundo.token = null;
    expect((await POST(req("POST", { expoToken: T2, plataforma: "ios" }))).status).toBe(401);
    mundo.token = "eyJ.app.jwt";
    mundo.acesso = false;
    const r = await corpo(await POST(req("POST", { expoToken: T2, plataforma: "ios" })));
    expect(r).toMatchObject({ status: 403, json: { ok: false, codigo: "sem_acesso" } });
    expect(db.upserts).toEqual([]);
    // Plano vencido: tirar o aparelho ao sair tem que funcionar, senao o push segue.
    expect((await DELETE(req("DELETE", { expoToken: T1 }))).status).toBe(200);
    expect(db.tabelas.app_aparelhos).toHaveLength(0);
  });

  it("registra o aparelho na conta da sessao, sem ecoar o token", async () => {
    const db = banco([]);
    const r = await corpo(await POST(req("POST", { expoToken: T1, plataforma: "android" })));
    expect(r).toMatchObject({ status: 200, json: { ok: true } });
    expect(r.texto).not.toContain("PushToken");
    expect(db.tabelas.app_aparelhos).toEqual([
      expect.objectContaining({ user_id: U, expo_token: T1, plataforma: "android", atualizado_em: expect.any(String) }),
    ]);
  });

  it("token fora do formato, plataforma errada e corpo quebrado: 400 sem gravar", async () => {
    const db = banco([]);
    const casos: [unknown, string][] = [
      [{ expoToken: "ExponentPushToken[curto]", plataforma: "ios" }, "token_invalido"],
      [{ expoToken: "nao-e-token", plataforma: "ios" }, "token_invalido"],
      [{ plataforma: "ios" }, "token_invalido"],
      [{ expoToken: T1, plataforma: "web" }, "plataforma_invalida"],
      [{ expoToken: T1 }, "plataforma_invalida"],
      ["{quebrado", "corpo_invalido"],
      [[T1], "corpo_invalido"],
    ];
    for (const [c, codigo] of casos) {
      const r = await corpo(await POST(req("POST", c)));
      expect(r, JSON.stringify(c)).toMatchObject({ status: 400, json: { ok: false, codigo } });
    }
    expect(db.upserts).toEqual([]);
  });

  it("o celular que entrou em outra conta passa para ela (uma linha so)", async () => {
    const db = banco([aparelho("a1", T1, OUTRO)]);
    const r = await corpo(await POST(req("POST", { expoToken: T1, plataforma: "ios" })));
    expect(r.status).toBe(200);
    expect(db.tabelas.app_aparelhos).toHaveLength(1);
    expect(db.tabelas.app_aparelhos[0]).toMatchObject({ id: "a1", user_id: U, expo_token: T1 });
  });

  it("DELETE tira so o aparelho daquele token, mesmo sem sessao (o token e a prova)", async () => {
    const db = banco([aparelho("a1", T1), aparelho("a2", T2, OUTRO)]);
    // Sessao caiu (senha trocada, "Sair" global): sair do app ainda tira o aparelho.
    mundo.token = null;
    const meu = await corpo(await DELETE(req("DELETE", { expoToken: T1 })));
    expect(meu).toMatchObject({ status: 200, json: { ok: true, removido: true } });
    expect(db.tabelas.app_aparelhos.map((l) => l.id)).toEqual(["a2"]);

    const deNovo = await corpo(await DELETE(req("DELETE", { expoToken: T1 })));
    expect(deNovo).toMatchObject({ status: 200, json: { ok: true, removido: false } });
    expect(db.tabelas.app_aparelhos.map((l) => l.id)).toEqual(["a2"]);

    expect((await DELETE(req("DELETE", { expoToken: "lixo" }))).status).toBe(400);
  });

  it("sem a 084: 503 com codigo proprio", async () => {
    banco([], { semTabela: true });
    const post = await corpo(await POST(req("POST", { expoToken: T1, plataforma: "ios" })));
    expect(post).toMatchObject({ status: 503, json: { ok: false, codigo: "push_indisponivel" } });
    const del = await corpo(await DELETE(req("DELETE", { expoToken: T1 })));
    expect(del).toMatchObject({ status: 503, json: { codigo: "push_indisponivel" } });
  });
});

describe("/api/app/v1/notificacoes", () => {
  it("sem login: 401; sem acesso ainda le e desliga o aviso (o push nao confere plano)", async () => {
    banco([]);
    mundo.token = null;
    expect((await LER_PREF()).status).toBe(401);
    expect((await GRAVAR_PREF(req("PATCH", { vendas: false }))).status).toBe(401);
    mundo.token = "eyJ.app.jwt";
    mundo.acesso = false;
    expect((await LER_PREF()).status).toBe(200);
    expect((await GRAVAR_PREF(req("PATCH", { vendas: false }))).status).toBe(200);
  });

  it("le o mesmo notificar_vendas da web; sem linha = ligado", async () => {
    banco([], { ativo: false });
    expect((await corpo(await LER_PREF())).json).toEqual({ ok: true, vendas: false });
    banco([], { ativo: null });
    expect((await corpo(await LER_PREF())).json).toEqual({ ok: true, vendas: true });
  });

  it("grava como a web, criando a linha que falta; corpo errado = 400", async () => {
    const db = banco([], { ativo: null });
    const r = await corpo(await GRAVAR_PREF(req("PATCH", { vendas: false })));
    expect(r.json).toEqual({ ok: true, vendas: false });
    expect(db.tabelas.alerta_config).toEqual([
      { user_id: U, notificar_vendas: false, updated_at: expect.any(String) },
    ]);
    await GRAVAR_PREF(req("PATCH", { vendas: true }));
    expect(db.tabelas.alerta_config).toHaveLength(1);
    expect(db.tabelas.alerta_config[0].notificar_vendas).toBe(true);
    expect((await GRAVAR_PREF(req("PATCH", { vendas: "sim" }))).status).toBe(400);
    expect((await GRAVAR_PREF(req("PATCH", "{quebrado"))).status).toBe(400);
  });
});

describe("envio do push de venda", () => {
  it("lotes de ate 100, com o texto do celular de hoje e nada do comprador", async () => {
    const lista = Array.from({ length: 150 }, (_, i) => aparelho(`a${i}`, tk(i)));
    const db = banco([...lista, aparelho("x", tk("outro"), OUTRO)]);
    const expo = expoFalso();

    const r = await notificarVendaNosCelulares(db.client, U, VENDA, "teste");

    expect(r).toEqual({ enviados: 150, falhas: 0 });
    expect(expo.lotes.map((l) => l.length).sort((a, b) => a - b)).toEqual([50, 100]);
    const todos = expo.lotes.flat();
    expect(todos.map((m) => m.to)).not.toContain(tk("outro"));
    const { titulo, texto } = mensagemDaVenda(VENDA);
    expect(todos[0]).toMatchObject({ title: titulo, body: texto, data: { tipo: "venda" } });
    expect(db.tabelas.app_aparelhos.filter((l) => l.user_id === U).every((l) => l.ultimo_envio_em && !l.ultimo_erro)).toBe(true);
  });

  it("vai em paralelo com os webhooks, no mesmo envio", async () => {
    const db = banco([aparelho("a1", T1)], { webhooks: [URL_WEBHOOK] });
    let iniciados = 0;
    let soltar: () => void = () => {};
    const barreira = new Promise<void>((ok) => (soltar = ok));
    let emSerie = false;
    const reserva = setTimeout(() => {
      emSerie = true;
      soltar();
    }, 1000);
    const chamadas: string[] = [];
    mundo.rede = async (url, init) => {
      chamadas.push(url);
      if (++iniciados === 2) soltar();
      await barreira;
      if (url !== EXPO) return new Response("ok");
      const n = (JSON.parse(String(init?.body)) as unknown[]).length;
      return Response.json({ data: Array.from({ length: n }, () => ({ status: "ok", id: "x" })) });
    };
    const r = await notificarVendaNosCelulares(db.client, U, VENDA, "teste");
    clearTimeout(reserva);
    expect(emSerie).toBe(false);
    expect(chamadas.sort()).toEqual([EXPO, URL_WEBHOOK].sort());
    expect(r).toEqual({ enviados: 2, falhas: 0 });
  });

  it("DeviceNotRegistered apaga o token; outro erro grava ultimo_erro; sucesso grava ultimo_envio_em", async () => {
    const db = banco([aparelho("a1", T1), aparelho("a2", T2), aparelho("a3", T3)]);
    expoFalso((t) => {
      if (t === T2) {
        return {
          status: "error",
          message: `"${T2}" is not a registered push notification recipient`,
          details: { error: "DeviceNotRegistered" },
        };
      }
      if (t === T3) return { status: "error", message: `Rate exceeded for ${T3}`, details: { error: "MessageRateExceeded" } };
      return { status: "ok", id: "x" };
    });

    const r = await notificarVendaNosCelulares(db.client, U, VENDA, "teste");

    expect(r).toEqual({ enviados: 1, falhas: 2 });
    const linha = (id: string) => db.tabelas.app_aparelhos.find((l) => l.id === id);
    expect(linha("a1")).toMatchObject({ ultimo_envio_em: expect.any(String), ultimo_erro: null });
    expect(linha("a2")).toBeUndefined();
    expect(linha("a3")).toMatchObject({ ultimo_envio_em: null, ultimo_erro: "Expo: MessageRateExceeded" });
    expect(logs.join("\n")).not.toContain("PushToken");
  });

  it("erro sem codigo: grava a mensagem sem o token; Expo fora do ar: erro em todos", async () => {
    const db = banco([aparelho("a1", T1)]);
    expoFalso((t) => ({ status: "error", message: `Something broke for ${t}` }));
    await notificarVendaNosCelulares(db.client, U, VENDA, "teste");
    expect(db.tabelas.app_aparelhos[0].ultimo_erro).toBe("Expo: Something broke for ***");

    const fora = banco([aparelho("a1", T1), aparelho("a2", T2)]);
    mundo.rede = async () => Response.json({ errors: [{ code: "INTERNAL_SERVER_ERROR", message: "x" }] }, { status: 500 });
    expect(await notificarVendaNosCelulares(fora.client, U, VENDA, "teste")).toEqual({ enviados: 0, falhas: 2 });
    expect(fora.tabelas.app_aparelhos.map((l) => l.ultimo_erro)).toEqual([
      "Expo respondeu 500 (INTERNAL_SERVER_ERROR)",
      "Expo respondeu 500 (INTERNAL_SERVER_ERROR)",
    ]);

    const lento = banco([aparelho("a1", T1)]);
    mundo.rede = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    };
    await notificarVendaNosCelulares(lento.client, U, VENDA, "teste");
    expect(lento.tabelas.app_aparelhos[0]).toMatchObject({
      ultimo_erro: "não deu para falar com o Expo: sem resposta em 4 s",
      ultimo_envio_em: null,
    });
  });

  it("sem a 084, os webhooks seguem identicos e nada vai ao Expo", async () => {
    const db = banco([], { semTabela: true, webhooks: [URL_WEBHOOK] });
    const expo = expoFalso();
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 1, falhas: 0 });
    expect(expo.webhooks).toEqual([URL_WEBHOOK]);
    expect(expo.lotes).toEqual([]);
    expect(db.updates.map((u) => u.tabela)).toEqual(["venda_webhooks"]);
    expect(logs.join("\n")).not.toMatch(/aparelhos/);
  });

  it("erro ao ler os aparelhos nao segura os webhooks (e o contrario)", async () => {
    const db = banco([aparelho("a1", T1)], { erroLeitura: true, webhooks: [URL_WEBHOOK] });
    const expo = expoFalso();
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 1, falhas: 0 });
    expect(expo.webhooks).toEqual([URL_WEBHOOK]);
    expect(logs.join("\n")).toContain("leitura dos aparelhos do app");

    const ao = banco([aparelho("a1", T1)], { erroWebhooks: true, webhooks: [URL_WEBHOOK] });
    const expo2 = expoFalso();
    expect(await notificarVendaNosCelulares(ao.client, U, VENDA, "teste")).toEqual({ enviados: 1, falhas: 0 });
    expect(expo2.webhooks).toEqual([]);
    expect(expo2.lotes).toHaveLength(1);
  });

  it("aparelho que nao abre o app ha mais de 30 dias nao recebe (sessao caida, app apagado)", async () => {
    const { PRAZO_DO_APARELHO_MS } = await import("../src/lib/alertas/push-expo");
    const velho = new Date(Date.now() - PRAZO_DO_APARELHO_MS - 60 * 1000).toISOString();
    const db = banco([aparelho("a1", T1), aparelho("a2", T2, U, velho)]);
    const expo = expoFalso();
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 1, falhas: 0 });
    expect(expo.lotes.flat().map((m) => m.to)).toEqual([T1]);
  });

  it("notificar_vendas desligado nao manda nada, nem webhook nem push", async () => {
    const db = banco([aparelho("a1", T1)], { ativo: false, webhooks: [URL_WEBHOOK] });
    const expo = expoFalso();
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 0, falhas: 0 });
    expect(expo.webhooks).toEqual([]);
    expect(expo.lotes).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(db.deletes).toEqual([]);
  });
});
