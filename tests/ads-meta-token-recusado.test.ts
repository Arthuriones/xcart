import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import {
  ERRO_SEM_PERMISSAO,
  ERRO_TOKEN_RECUSADO,
  ESPERA_TOKEN_RECUSADO_MS,
  contaPedeTokenNovo,
  cronPulaConta,
} from "../src/lib/ads/meta-espera";

// ============================================================================
// Conta do Meta com o token recusado (190) ou sem ads_read: o cron do gasto
// para de chamar o Meta por ela ate o token mudar (ou 1x por dia), e o
// ultimo_erro fica para Integracoes e o alerta "Gasto do Meta sem atualizar".
// O botao "Atualizar agora" nunca espera.
// ============================================================================

const mundo = vi.hoisted(() => ({
  banco: null as unknown as { client: never },
  usuario: null as { id: string } | null,
  chamadas: [] as string[],
  falharCom: null as number | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.banco.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mundo.usuario } }) } }),
}));
type BancoDoMock = {
  from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: string) => PromiseLike<unknown> } };
};

// O sync de verdade: falha com o codigo do Meta, ou grava o sucesso como o
// meta-sync.ts (ultimo_erro null).
vi.mock("@/lib/ads/meta-sync", async () => {
  const { ErroGraph } = await import("../src/lib/ads/meta-graph");
  return {
    sincronizarContaMeta: async (admin: BancoDoMock, conta: { id: string; external_id: string }, _t: string, agora: Date) => {
      mundo.chamadas.push(conta.external_id);
      if (mundo.falharCom !== null) throw new ErroGraph("Error validating access token", mundo.falharCom, 463);
      const iso = agora.toISOString();
      await admin
        .from("ad_accounts")
        .update({ ultimo_sync_em: iso, ultimo_sync_ok_em: iso, ultimo_erro: null })
        .eq("id", conta.id);
      return { linhas: 1, granular: 0, erroGranular: null };
    },
  };
});

const HORA = 60 * 60 * 1000;
const agoraMenos = (ms: number) => new Date(Date.now() - ms).toISOString();

function montarBanco(conta: Record<string, unknown>, tokenSalvoEm: string): FakeSupabase {
  return fakeSupabase({
    stores: [],
    ad_accounts: [
      {
        id: "a1",
        user_id: "u1",
        store_id: "s1",
        plataforma: "meta",
        external_id: "111111",
        nome: "Conta",
        ativo: true,
        ultimo_sync_em: agoraMenos(15 * 60 * 1000),
        ultimo_sync_ok_em: agoraMenos(15 * HORA),
        sincronizando_desde: null,
        ultimo_erro: ERRO_TOKEN_RECUSADO,
        ...conta,
      },
    ],
    ad_account_secrets: [{ ad_account_id: "a1", meta_access_token: "EAA-x", updated_at: tokenSalvoEm }],
  });
}

async function chamar(doCron: boolean) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest("https://user.xcart.app/api/jobs/ads/meta", {
    method: "POST",
    headers: doCron ? { authorization: "Bearer segredo" } : {},
  });
  const { POST } = await import("../src/app/api/jobs/ads/meta/route");
  return (await (await POST(req)).json()) as { ok: boolean; processadas: number; puladas: number; erros: string[] };
}

describe("cronPulaConta (regra pura)", () => {
  const agora = Date.parse("2026-10-24T12:00:00.000Z");
  const tentou = "2026-10-24T11:45:00.000Z";
  const tokenVelho = "2026-10-24T03:41:38.121+00:00";

  it("190 ou ads_read marca a conta; outro erro nao", () => {
    expect(contaPedeTokenNovo(ERRO_TOKEN_RECUSADO)).toBe(true);
    expect(contaPedeTokenNovo(ERRO_SEM_PERMISSAO)).toBe(true);
    expect(contaPedeTokenNovo("Limite de taxa do Meta; tento de novo na próxima rodada.")).toBe(false);
    expect(contaPedeTokenNovo("Sem token: cole o token em Contas de anúncio.")).toBe(false);
    expect(contaPedeTokenNovo(null)).toBe(false);
  });

  it("marcada, token velho, tentativa recente: pula", () => {
    expect(cronPulaConta({ ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: tentou }, tokenVelho, agora)).toBe(true);
    expect(cronPulaConta({ ultimo_erro: ERRO_SEM_PERMISSAO, ultimo_sync_em: tentou }, tokenVelho, agora)).toBe(true);
    // Sem a linha do segredo: nada mudou, segue pulando.
    expect(cronPulaConta({ ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: tentou }, undefined, agora)).toBe(true);
  });

  it("token gravado depois da tentativa (ou ate 10 min antes do fim dela): tenta", () => {
    const conta = { ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: tentou };
    expect(cronPulaConta(conta, "2026-10-24T11:50:00.000Z", agora)).toBe(false);
    expect(cronPulaConta(conta, "2026-10-24T11:40:00.000Z", agora)).toBe(false);
    expect(cronPulaConta(conta, "2026-10-24T11:30:00.000Z", agora)).toBe(true);
  });

  it("24 h desde a tentativa: confere de novo", () => {
    const conta = { ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: tentou };
    expect(cronPulaConta(conta, tokenVelho, Date.parse(tentou) + ESPERA_TOKEN_RECUSADO_MS - 1)).toBe(true);
    expect(cronPulaConta(conta, tokenVelho, Date.parse(tentou) + ESPERA_TOKEN_RECUSADO_MS)).toBe(false);
  });

  it("conta sem erro ou sem hora de tentativa: nunca pula", () => {
    expect(cronPulaConta({ ultimo_erro: null, ultimo_sync_em: tentou }, tokenVelho, agora)).toBe(false);
    expect(cronPulaConta({ ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: null }, tokenVelho, agora)).toBe(false);
  });
});

describe("cron do gasto do Meta com o token recusado", () => {
  let banco: FakeSupabase;
  beforeEach(() => {
    process.env.CRON_SECRET = "segredo";
    mundo.usuario = { id: "u1" };
    mundo.chamadas.length = 0;
    mundo.falharCom = null;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  const usar = (b: FakeSupabase) => {
    banco = b;
    mundo.banco = b as unknown as { client: never };
  };
  const conta = () => banco.tabelas.ad_accounts[0];

  it("190 vira a marca; a rodada seguinte nao chama o Meta e o erro continua na conta", async () => {
    usar(montarBanco({ ultimo_erro: null, ultimo_sync_em: agoraMenos(15 * 60 * 1000) }, agoraMenos(20 * HORA)));
    mundo.falharCom = 190;
    const primeira = await chamar(true);
    expect(mundo.chamadas).toEqual(["111111"]);
    expect(primeira.erros[0]).toContain("(190)");
    expect(conta().ultimo_erro).toBe(ERRO_TOKEN_RECUSADO);
    const tentouEm = conta().ultimo_sync_em;

    const segunda = await chamar(true);
    expect(mundo.chamadas).toEqual(["111111"]);
    expect(segunda).toMatchObject({ ok: true, processadas: 0, puladas: 1, erros: [] });
    expect(conta()).toMatchObject({ ultimo_erro: ERRO_TOKEN_RECUSADO, ultimo_sync_em: tentouEm, sincronizando_desde: null });
  });

  it("sem ads_read (codigo 200) tambem espera", async () => {
    usar(montarBanco({ ultimo_erro: null }, agoraMenos(20 * HORA)));
    mundo.falharCom = 200;
    await chamar(true);
    expect(conta().ultimo_erro).toBe(ERRO_SEM_PERMISSAO);
    await chamar(true);
    expect(mundo.chamadas).toEqual(["111111"]);
  });

  it("token novo colado depois da tentativa: o cron tenta na rodada seguinte e limpa o erro", async () => {
    usar(montarBanco({}, agoraMenos(20 * HORA)));
    await chamar(true);
    expect(mundo.chamadas).toEqual([]);

    // O "conectar" e o callback do OAuth gravam updated_at no segredo.
    banco.tabelas.ad_account_secrets[0].updated_at = new Date().toISOString();
    const r = await chamar(true);
    expect(mundo.chamadas).toEqual(["111111"]);
    expect(r).toMatchObject({ processadas: 1, puladas: 0 });
    expect(conta().ultimo_erro).toBeNull();
  });

  it("24 h sem token novo: o cron confere uma vez", async () => {
    usar(montarBanco({ ultimo_sync_em: agoraMenos(25 * HORA) }, agoraMenos(30 * HORA)));
    mundo.falharCom = 190;
    await chamar(true);
    await chamar(true);
    expect(mundo.chamadas).toEqual(["111111"]);
  });

  it("Atualizar agora (sessao) nunca espera", async () => {
    usar(montarBanco({ ultimo_sync_em: agoraMenos(2 * 60 * 1000) }, agoraMenos(20 * HORA)));
    mundo.falharCom = 190;
    const r = await chamar(false);
    expect(mundo.chamadas).toEqual(["111111"]);
    expect(r.erros).toHaveLength(1);
  });
});
