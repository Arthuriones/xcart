import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// /api/checkouts/[id]/rastreamento (073): "Remover" o pixel NAO apaga a linha
// do destino. A fila cai em cascata com o destino, e a compra ja entregue
// dela e a trava (destino_id, event_id) contra a segunda compra da mesma
// cobranca: tirar e por o pixel de novo com a linha apagada daria outro
// destino_id, e o Pix gerado antes e aprovado depois sairia outra vez (o Meta
// e o TikTok so descartam event_id repetido em 48 h). Remover = desligar e
// apagar so o token; o POST reaproveita a linha; a tela mostra "Não
// configurado"; ligar sem token e recusado.

const h = vi.hoisted(() => {
  type Linha = Record<string, unknown>;
  const tabelas: Record<string, Linha[]> = {};
  let seq = 0;

  /** O PostgREST em memoria: so o que a rota usa. */
  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let acao: "select" | "update" | "delete" | "insert" | "upsert" = "select";
    let campos: Linha = {};
    let chave = "";
    let head = false;
    const linhas = () => (tabelas[tabela] ??= []);
    const rodar = (): { data: Linha[] | null; count?: number; error: null } => {
      if (acao === "insert") {
        const nova = { id: `id-${++seq}`, ...campos };
        linhas().push(nova);
        return { data: [{ ...nova }], error: null };
      }
      if (acao === "upsert") {
        const existe = linhas().find((l) => l[chave] === campos[chave]);
        if (existe) Object.assign(existe, campos);
        else linhas().push({ ...campos });
        return { data: null, error: null };
      }
      const alvo = linhas().filter((l) => filtros.every((f) => f(l)));
      if (acao === "update") alvo.forEach((l) => Object.assign(l, campos));
      if (acao === "delete") tabelas[tabela] = linhas().filter((l) => !alvo.includes(l));
      return { data: head ? null : alvo.map((l) => ({ ...l })), count: alvo.length, error: null };
    };
    const um = async () => {
      const r = rodar();
      return { data: r.data?.[0] ?? null, error: r.error };
    };
    const api = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), api),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), api),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), api),
      gte: (c: string, v: string) => (filtros.push((l) => String(l[c]) >= v), api),
      order: () => api,
      limit: () => api,
      update: (c: Linha) => ((acao = "update"), (campos = c), api),
      delete: () => ((acao = "delete"), api),
      insert: (c: Linha) => ((acao = "insert"), (campos = c), api),
      upsert: (c: Linha, o: { onConflict: string }) => ((acao = "upsert"), (campos = c), (chave = o.onConflict), api),
      maybeSingle: um,
      single: um,
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve().then(rodar).then(ok, erro),
    };
    return api;
  }

  const json = (status: number, corpo: Record<string, unknown>) => Response.json(corpo, { status });
  return { tabelas, db: { from }, json };
});

const CK = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.db }));
vi.mock("@/lib/public-url", () => ({ getPublicAppUrl: () => "https://user.xcart.test" }));
vi.mock("@/lib/checkouts-externos/servidor", () => ({
  json: h.json,
  NAO_ENCONTRADO: () => h.json(404, { ok: false, erro: "Checkout não encontrado." }),
  usuarioDaSessao: async () => ({ id: "u-1" }),
  checkoutDaSessao: async () => ({
    id: "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f",
    user_id: "u-1",
    plataforma: "cakto",
    nome: "Cakto Curso",
    ativo: true,
    moeda_receita: "BRL",
    fuso: "America/Sao_Paulo",
    compra_quando: "gerada",
  }),
}));
vi.mock("@/lib/billing/limites", () => ({
  chaveDoCheckout: (id: string) => `checkout:${id}`,
  conferirLigarRastreamento: async () => ({ ok: true }),
  lerPerfilParaLimites: async () => null,
  limitesDoPerfil: () => ({ rastreamento: 3 }),
  lerUso: async () => ({ rastreamento: new Set<string>() }),
}));
const credencial = vi.hoisted(() => ({ conferidas: 0 }));
vi.mock("@/lib/checkouts-externos/rastreio", () => ({
  conferirCredencial: async () => {
    credencial.conferidas += 1;
    return { ok: true };
  },
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/checkouts/[id]/rastreamento/route";

const URL_DA_ROTA = `https://user.xcart.test/api/checkouts/${CK}/rastreamento`;
const ctx = () => ({ params: Promise.resolve({ id: CK }) });
const pedir = (metodo: string, corpo?: unknown, query = "") =>
  new Request(`${URL_DA_ROTA}${query}`, { method: metodo, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }) });

beforeEach(() => {
  credencial.conferidas = 0;
  for (const k of Object.keys(h.tabelas)) delete h.tabelas[k];
  h.tabelas.checkout_externo_destinos = [
    { id: "dest-meta", checkout_id: CK, user_id: "u-1", plataforma: "meta", conta: "123456789012345", test_event_code: null, ativo: true },
  ];
  h.tabelas.checkout_externo_destino_segredos = [{ destino_id: "dest-meta", access_token: "EAAtoken123456" }];
  // A compra do Pix gerado, ja entregue: a trava da cobranca 4852F91.
  h.tabelas.checkout_externo_envios = [
    {
      id: "env-1",
      checkout_id: CK,
      user_id: "u-1",
      destino_id: "dest-meta",
      plataforma: "meta",
      event_name: "Purchase",
      event_id: "purchase_cakto_4852F91",
      grupo: "4852F91",
      status: "enviado",
      attempts: 1,
      created_at: new Date().toISOString(),
    },
  ];
});

describe("Remover o pixel do checkout guarda a trava da compra", () => {
  it("desliga e apaga so o token: a linha do destino e a compra entregue ficam; a tela mostra 'Não configurado'", async () => {
    const r = await DELETE(pedir("DELETE", undefined, "?plataforma=meta"), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).destinos).toEqual([]);
    expect(h.tabelas.checkout_externo_destinos).toHaveLength(1);
    expect(h.tabelas.checkout_externo_destinos[0]).toMatchObject({ id: "dest-meta", ativo: false });
    expect(h.tabelas.checkout_externo_destino_segredos).toEqual([]);
    expect(h.tabelas.checkout_externo_envios.map((e) => [e.destino_id, e.event_id])).toEqual([["dest-meta", "purchase_cakto_4852F91"]]);
  });

  it("o removido nao liga pelo interruptor nem volta sem token", async () => {
    await DELETE(pedir("DELETE", undefined, "?plataforma=meta"), ctx());
    const ligar = await PATCH(pedir("PATCH", { plataforma: "meta", ativo: true }), ctx());
    expect(ligar.status).toBe(404);
    expect(h.tabelas.checkout_externo_destinos[0].ativo).toBe(false);
    const semToken = await POST(pedir("POST", { plataforma: "meta", conta: "123456789012345" }), ctx());
    expect(semToken.status).toBe(400);
    expect(h.tabelas.checkout_externo_destinos[0].ativo).toBe(false);
  });

  it("por o pixel de novo reaproveita a linha: o MESMO destino_id, entao a cobranca ja mandada segue travada", async () => {
    await DELETE(pedir("DELETE", undefined, "?plataforma=meta"), ctx());
    const r = await POST(pedir("POST", { plataforma: "meta", conta: "123456789012345", token: "EAAnovo1234567" }), ctx());
    expect(r.status).toBe(200);
    expect(credencial.conferidas).toBe(1);
    expect(h.tabelas.checkout_externo_destinos).toHaveLength(1);
    expect(h.tabelas.checkout_externo_destinos[0]).toMatchObject({ id: "dest-meta", ativo: true });
    expect(h.tabelas.checkout_externo_destino_segredos).toEqual([
      expect.objectContaining({ destino_id: "dest-meta", access_token: "EAAnovo1234567" }),
    ]);
    expect((await r.json()).destinos).toMatchObject([{ plataforma: "meta", ativo: true, temToken: true }]);
    // A compra da cobranca continua presa ao destino que voltou.
    expect(h.tabelas.checkout_externo_envios[0]).toMatchObject({ destino_id: "dest-meta", event_id: "purchase_cakto_4852F91" });
  });

  it("desligar pelo interruptor segue como era: aparece 'Desligado' com o token salvo e religa", async () => {
    const off = await PATCH(pedir("PATCH", { plataforma: "meta", ativo: false }), ctx());
    expect(off.status).toBe(200);
    expect((await off.json()).destinos).toMatchObject([{ plataforma: "meta", ativo: false, temToken: true }]);
    const on = await PATCH(pedir("PATCH", { plataforma: "meta", ativo: true }), ctx());
    expect(on.status).toBe(200);
    expect(h.tabelas.checkout_externo_destinos[0].ativo).toBe(true);
    const tela = await GET(pedir("GET"), ctx());
    expect((await tela.json()).envios).toMatchObject([{ evento: "Purchase", status: "enviado", grupo: "4852F91" }]);
  });
});
