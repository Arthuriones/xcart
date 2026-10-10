import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// "Venda no celular" em varios celulares (migration 070).
//
// O que trava:
//   - a venda vai para TODOS os celulares, em paralelo, e um fora do ar nao
//     impede os outros; cada um grava o proprio ultimo envio/erro;
//   - notificar_vendas = false nao manda nada;
//   - sem a tabela da 070, cai na URL unica da 063 (o codigo vale antes e
//     depois da migration); outro erro de leitura NAO cai nela;
//   - o teto de celulares no envio e no cadastro;
//   - a URL (segredo: a do Pushcut tem a chave da conta) nunca volta da API,
//     nem no erro, nem vai para o log.
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

import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import {
  lerCelularesDaTela,
  notificarVendaNosCelulares,
  webhooksDeVendaDoDono,
  type Venda,
} from "@/lib/alertas/venda-webhook";
import { MAX_CELULARES, nomeDoCelular, resumoDoCanal } from "@/lib/alertas/venda-celulares";
import { GET, PATCH, POST } from "@/app/api/alertas/venda-webhook/route";
import { DELETE } from "@/app/api/alertas/venda-webhook/[id]/route";
import { POST as TESTAR } from "@/app/api/alertas/venda-webhook/[id]/teste/route";

const U = "u1";
const ID_A = "0f9e2a10-0000-4000-8000-00000000000a";
const ID_B = "0f9e2a10-0000-4000-8000-00000000000b";
const ID_C = "0f9e2a10-0000-4000-8000-00000000000c";
const ID_OUTRO = "0f9e2a10-0000-4000-8000-0000000000ff";

// Cada URL carrega um "segredo" que nunca pode sair da API nem ir para o log.
const URL_A = "https://api.pushcut.io/SEGREDO-A/notifications/Venda";
const URL_B = "https://ntfy.sh/SEGREDO-B";
const URL_C = "https://discord.com/api/webhooks/1/SEGREDO-C";
const URL_OUTRO = "https://api.pushcut.io/SEGREDO-OUTRO/notifications/Venda";

const VENDA: Venda = {
  loja: "Softnook",
  pedido: "#1012",
  valor: 69.9,
  moeda: "USD",
  statusFinanceiro: "paid",
  produtos: ["Towel"],
};

const SEM_TABELA = { code: "PGRST205", message: "Could not find the table 'public.venda_webhooks' in the schema cache" };

function celular(id: string, url: string, user_id = U, nome = "Celular") {
  return { id, user_id, nome, url, created_at: "2026-10-01T00:00:00Z", ultimo_envio_em: null, ultimo_erro: null };
}

function banco(
  celulares: Record<string, unknown>[],
  o: { ativo?: boolean; urlAntiga?: string | null; semTabela?: boolean; erroLeitura?: boolean } = {}
): FakeSupabase {
  const db = fakeSupabase(
    {
      alerta_config: [{ user_id: U, notificar_vendas: o.ativo ?? true }],
      alerta_config_secrets: [{ user_id: U, telegram_bot_token: null, venda_webhook_url: o.urlAntiga ?? null }],
      venda_webhooks: celulares,
    },
    (tabela, op) => {
      if (tabela !== "venda_webhooks") return null;
      if (o.semTabela) return SEM_TABELA;
      if (o.erroLeitura && op === "select") return { code: "57014", message: "canceling statement due to statement timeout" };
      return null;
    }
  );
  mundo.admin = db.client;
  return db;
}

function req(corpo?: unknown): never {
  return new Request("https://user.xcart.test/api/alertas/venda-webhook", {
    method: "POST",
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  }) as never;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** O texto inteiro do que a rota devolveu: o segredo nao pode estar em lugar nenhum dele. */
async function corpo(r: Response): Promise<{ status: number; json: Record<string, unknown>; texto: string }> {
  const texto = await r.text();
  return { status: r.status, json: JSON.parse(texto), texto };
}

function semSegredo(texto: string) {
  expect(texto).not.toMatch(/SEGREDO/);
  expect(texto).not.toContain("/notifications/");
}

let logs: string[] = [];
beforeEach(() => {
  mundo.usuario = { id: U };
  mundo.rede = async () => new Response("ok", { status: 200 });
  logs = [];
  for (const nivel of ["log", "warn", "error"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("envio para todos os celulares", () => {
  it("todos recebem, em paralelo, e um falhando nao impede os outros", async () => {
    const db = banco([celular(ID_A, URL_A), celular(ID_B, URL_B), celular(ID_C, URL_C)]);

    // Barreira: so responde quando os tres pedidos ja sairam. Em serie, o
    // primeiro ficaria esperando os outros e o relogio de reserva marcaria.
    let iniciados = 0;
    let soltar: () => void = () => {};
    const barreira = new Promise<void>((r) => (soltar = r));
    let emSerie = false;
    const reserva = setTimeout(() => {
      emSerie = true;
      soltar();
    }, 1000);
    const chamadas: string[] = [];
    mundo.rede = async (url) => {
      chamadas.push(url);
      if (++iniciados === 3) soltar();
      await barreira;
      if (url === URL_B) throw new Error("fetch failed");
      if (url === URL_C) return new Response("nope", { status: 500 });
      return new Response("ok", { status: 200 });
    };

    const r = await notificarVendaNosCelulares(db.client, U, VENDA, "teste");
    clearTimeout(reserva);

    expect(emSerie).toBe(false);
    expect(chamadas.sort()).toEqual([URL_A, URL_B, URL_C].sort());
    expect(r).toEqual({ enviados: 1, falhas: 2 });

    const linha = (id: string) => db.tabelas.venda_webhooks.find((l) => l.id === id)!;
    expect(linha(ID_A).ultimo_envio_em).toEqual(expect.any(String));
    expect(linha(ID_A).ultimo_erro).toBeNull();
    expect(linha(ID_B).ultimo_erro).toBe("não deu para falar com ntfy.sh: falha de rede");
    expect(linha(ID_C).ultimo_erro).toBe("discord.com respondeu 500");

    // A falha vai para o log so com o host.
    expect(logs.join("\n")).toContain("ntfy.sh");
    semSegredo(logs.join("\n"));
  });

  it("erro de rede que repete a URL nao grava nem loga o segredo", async () => {
    const db = banco([celular(ID_A, URL_A)]);
    mundo.rede = async (url) => {
      throw new Error(`connect ECONNREFUSED ao abrir ${url} (veja https://outro.exemplo/SEGREDO-X)`);
    };
    await notificarVendaNosCelulares(db.client, U, VENDA, "teste");
    const erro = String(db.tabelas.venda_webhooks[0].ultimo_erro);
    expect(erro).toContain("api.pushcut.io");
    semSegredo(erro);
    semSegredo(logs.join("\n"));
  });

  it("notificar_vendas = false nao manda para ninguem", async () => {
    const db = banco([celular(ID_A, URL_A), celular(ID_B, URL_B)], { ativo: false });
    const rede = vi.fn(async () => new Response("ok"));
    mundo.rede = rede;
    expect(await webhooksDeVendaDoDono(db.client, U)).toEqual([]);
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 0, falhas: 0 });
    expect(rede).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("sem a tabela da 070, cai na URL unica da 063 (e nao tenta gravar o ultimo envio)", async () => {
    const db = banco([], { semTabela: true, urlAntiga: URL_A });
    const chamadas: string[] = [];
    mundo.rede = async (url) => {
      chamadas.push(url);
      return new Response("ok");
    };
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 1, falhas: 0 });
    expect(chamadas).toEqual([URL_A]);
    expect(db.updates).toEqual([]);

    const tela = await lerCelularesDaTela(db.client, U);
    expect(tela.semTabela).toBe(true);
    expect(tela.celulares).toEqual([
      { id: "legado", nome: "Celular", host: "api.pushcut.io", ultimo_envio_em: null, ultimo_erro: null },
    ]);
  });

  it("outro erro ao ler os celulares NAO cai na coluna antiga: nao manda e so loga", async () => {
    const db = banco([celular(ID_A, URL_A)], { erroLeitura: true, urlAntiga: URL_B });
    const rede = vi.fn(async () => new Response("ok"));
    mundo.rede = rede;
    await expect(webhooksDeVendaDoDono(db.client, U)).rejects.toThrow(/statement timeout/);
    expect(await notificarVendaNosCelulares(db.client, U, VENDA, "teste")).toEqual({ enviados: 0, falhas: 0 });
    expect(rede).not.toHaveBeenCalled();
  });

  it(`teto: manda para no maximo ${MAX_CELULARES} celulares`, async () => {
    const muitos = Array.from({ length: MAX_CELULARES + 2 }, (_, i) =>
      celular(`0f9e2a10-0000-4000-8000-${String(i).padStart(12, "0")}`, `https://ntfy.sh/SEGREDO-${i}`)
    );
    const db = banco(muitos);
    const rede = vi.fn(async () => new Response("ok"));
    mundo.rede = rede;
    const r = await notificarVendaNosCelulares(db.client, U, VENDA, "teste");
    expect(r.enviados).toBe(MAX_CELULARES);
    expect(rede).toHaveBeenCalledTimes(MAX_CELULARES);
  });
});

describe("API dos celulares", () => {
  it("sem sessao: 401", async () => {
    banco([celular(ID_A, URL_A)]);
    mundo.usuario = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(req({ url: URL_B }))).status).toBe(401);
    expect((await DELETE(req(), params(ID_A))).status).toBe(401);
    expect((await TESTAR(req(), params(ID_A))).status).toBe(401);
  });

  it("listar devolve nome, host e o ultimo envio -- nunca a URL; so os do dono", async () => {
    banco([
      { ...celular(ID_A, URL_A, U, "Celular do Arthur"), ultimo_envio_em: "2026-10-10T12:00:00Z" },
      { ...celular(ID_B, URL_B, U, "Sócio"), ultimo_envio_em: "2026-10-10T12:00:00Z", ultimo_erro: "ntfy.sh respondeu 403" },
      celular(ID_OUTRO, URL_OUTRO, "u2"),
    ]);
    const r = await corpo(await GET());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, ativo: true, semTabela: false, maximo: MAX_CELULARES });
    expect(r.json.celulares).toEqual([
      { id: ID_A, nome: "Celular do Arthur", host: "api.pushcut.io", ultimo_envio_em: "2026-10-10T12:00:00Z", ultimo_erro: null },
      { id: ID_B, nome: "Sócio", host: "ntfy.sh", ultimo_envio_em: "2026-10-10T12:00:00Z", ultimo_erro: "ntfy.sh respondeu 403" },
    ]);
    semSegredo(r.texto);
    expect(r.texto).not.toContain("ntfy.sh/");
  });

  it("adicionar devolve o celular sem a URL; o primeiro liga o aviso", async () => {
    const db = banco([], { ativo: false });
    const r = await corpo(await POST(req({ nome: "  Celular   do sócio ", url: ` ${URL_A} ` })));
    expect(r.status).toBe(200);
    expect(r.json.celular).toMatchObject({ nome: "Celular do sócio", host: "api.pushcut.io" });
    semSegredo(r.texto);
    expect(db.tabelas.venda_webhooks).toEqual([expect.objectContaining({ user_id: U, nome: "Celular do sócio", url: URL_A })]);
    expect(db.tabelas.alerta_config[0].notificar_vendas).toBe(true);
  });

  it("adicionar sem nome vira 'Celular'; o segundo nao mexe no liga/desliga", async () => {
    const db = banco([celular(ID_A, URL_A)], { ativo: false });
    const r = await corpo(await POST(req({ url: URL_B })));
    expect(r.json.celular).toMatchObject({ nome: "Celular", host: "ntfy.sh" });
    expect(db.tabelas.alerta_config[0].notificar_vendas).toBe(false);
  });

  it("URL repetida, URL invalida e nome longo sao recusados sem ecoar a URL", async () => {
    banco([celular(ID_A, URL_A)]);
    const repetida = await corpo(await POST(req({ url: URL_A })));
    expect(repetida.status).toBe(409);
    semSegredo(repetida.texto);

    const http = await corpo(await POST(req({ url: "http://api.pushcut.io/SEGREDO-H" })));
    expect(http.status).toBe(400);
    semSegredo(http.texto);

    const nome = await POST(req({ url: URL_B, nome: "x".repeat(41) }));
    expect(nome.status).toBe(400);
  });

  it(`teto: o ${MAX_CELULARES + 1}o celular e recusado`, async () => {
    const cheios = Array.from({ length: MAX_CELULARES }, (_, i) =>
      celular(`0f9e2a10-0000-4000-8000-${String(i).padStart(12, "0")}`, `https://ntfy.sh/SEGREDO-${i}`)
    );
    const db = banco(cheios);
    const r = await corpo(await POST(req({ url: URL_A })));
    expect(r.status).toBe(409);
    expect(String(r.json.erro)).toContain(String(MAX_CELULARES));
    expect(db.inserts).toEqual([]);
  });

  it("sem a tabela da 070, adicionar responde que falta atualizar o banco", async () => {
    const db = banco([], { semTabela: true });
    const r = await corpo(await POST(req({ url: URL_A })));
    expect(r.status).toBe(409);
    expect(r.json.semTabela).toBe(true);
    expect(db.inserts).toEqual([]);
  });

  it("testar manda a venda de exemplo SO para aquele celular, mesmo com o aviso desligado", async () => {
    const db = banco([celular(ID_A, URL_A), celular(ID_B, URL_B)], { ativo: false });
    const chamadas: string[] = [];
    mundo.rede = async (url) => {
      chamadas.push(url);
      return new Response("ok");
    };
    const r = await corpo(await TESTAR(req(), params(ID_B)));
    expect(r.json).toEqual({ ok: true });
    expect(chamadas).toEqual([URL_B]);
    expect(db.tabelas.venda_webhooks.find((l) => l.id === ID_B)!.ultimo_envio_em).toEqual(expect.any(String));
    expect(db.tabelas.venda_webhooks.find((l) => l.id === ID_A)!.ultimo_envio_em).toBeNull();
  });

  it("teste que falha devolve o host, nao a URL, e grava o erro", async () => {
    const db = banco([celular(ID_A, URL_A)]);
    mundo.rede = async () => new Response("no", { status: 404 });
    const r = await corpo(await TESTAR(req(), params(ID_A)));
    expect(r.json).toEqual({ ok: false, erro: "api.pushcut.io respondeu 404" });
    semSegredo(r.texto);
    expect(db.tabelas.venda_webhooks[0].ultimo_erro).toBe("api.pushcut.io respondeu 404");
  });

  it("celular de outro usuario: 404 no testar e no remover, e nada sai nem some", async () => {
    const db = banco([celular(ID_OUTRO, URL_OUTRO, "u2")]);
    const rede = vi.fn(async () => new Response("ok"));
    mundo.rede = rede;
    expect((await TESTAR(req(), params(ID_OUTRO))).status).toBe(404);
    expect((await DELETE(req(), params(ID_OUTRO))).status).toBe(404);
    expect(rede).not.toHaveBeenCalled();
    expect(db.tabelas.venda_webhooks).toHaveLength(1);
  });

  it("remover tira o celular e limpa a coluna da 063 quando e a mesma URL", async () => {
    const db = banco([celular(ID_A, URL_A), celular(ID_B, URL_B)], { urlAntiga: URL_A });
    const r = await corpo(await DELETE(req(), params(ID_A)));
    expect(r.json).toEqual({ ok: true });
    semSegredo(r.texto);
    expect(db.tabelas.venda_webhooks.map((l) => l.id)).toEqual([ID_B]);
    expect(db.tabelas.alerta_config_secrets[0].venda_webhook_url).toBeNull();
  });

  it("remover outro celular nao mexe na coluna da 063", async () => {
    const db = banco([celular(ID_A, URL_A), celular(ID_B, URL_B)], { urlAntiga: URL_A });
    await DELETE(req(), params(ID_B));
    expect(db.tabelas.alerta_config_secrets[0].venda_webhook_url).toBe(URL_A);
  });

  it("liga/desliga geral", async () => {
    const db = banco([celular(ID_A, URL_A)]);
    const r = await corpo(await PATCH(req({ ativo: false })));
    expect(r.json).toEqual({ ok: true, ativo: false });
    expect(db.tabelas.alerta_config[0].notificar_vendas).toBe(false);
    expect((await PATCH(req({ ativo: "sim" }))).status).toBe(400);
  });
});

describe("regras da tela", () => {
  it("nome do celular", () => {
    expect(nomeDoCelular(undefined)).toBe("Celular");
    expect(nomeDoCelular("   ")).toBe("Celular");
    expect(nomeDoCelular(" iPhone  da Ana ")).toBe("iPhone da Ana");
    expect(nomeDoCelular("x".repeat(41))).toBeNull();
    expect(nomeDoCelular(42)).toBeNull();
  });

  it("status do topo", () => {
    expect(resumoDoCanal(true, 0)).toEqual({ ligado: false, texto: "Não configurado" });
    expect(resumoDoCanal(true, 1)).toEqual({ ligado: true, texto: "Ligado · 1 celular" });
    expect(resumoDoCanal(true, 3)).toEqual({ ligado: true, texto: "Ligado · 3 celulares" });
    expect(resumoDoCanal(false, 2)).toEqual({ ligado: false, texto: "Desligado" });
  });
});
