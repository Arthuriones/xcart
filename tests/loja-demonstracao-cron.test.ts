import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Loja de demonstracao: o cron que a mantem em dia (api/jobs/demonstracao,
// src/lib/demonstracao/atualizar.ts + gravacao.ts). O que trava aqui:
//   - o cron completa ate AGORA e da o mesmo banco que o `semear` do script
//     no mesmo instante (o mesmo gerador); duas rodadas no mesmo instante =
//     o mesmo banco;
//   - so a loja marcada E do gerador: outra loja (real ou marcada de outro
//     dono) fica intocada, e nada sai do banco (fetch nunca e chamado);
//   - sem loja marcada (ou sem a 074), sai na primeira consulta;
//   - teto por rodada (o resto vai nas seguintes, sem perder nada) e trava de
//     tamanho (nao grava acima do teto de linhas);
//   - pedido gravado que o gerador nao conhece: nao grava (duplicaria a loja);
//   - fuso de Brasilia: o dia vira na meia-noite de Brasilia, e a troca de fuso
//     regrava a janela no lugar (mesmos ids, so o instante anda), sem
//     duplicar -- tambem com teto, em varias rodadas, com o "Hoje" primeiro;
//   - o teto de linhas cobre o pico do plano.
// ============================================================================

const mundo = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.client }));

import { diaNoFuso, type FxRateRow } from "@/lib/financeiro/tipos";
import {
  ARTHUR,
  CAMPANHAS,
  CONTA_GOOGLE,
  CONTA_META,
  DESTINO_META,
  DOMINIO,
  FUSO,
  HORAS_DE_FUNIL,
  LOJA_ID,
  MAIOR_JANELA,
  diaLocal,
  gerarPlano,
  inicioDaJanela,
  instanteLocal,
  somarDia,
} from "@/lib/demonstracao/plano";
import { funilDoDia, montarCambio } from "@/lib/demonstracao/linhas";
import { contasDaLoja, montar } from "@/lib/demonstracao/semeadura";
import {
  DIAS_REGRAVADOS,
  TETO_DE_LINHAS,
  lerCambio,
  lerEstado,
  modoDaRodada,
  passaDoTeto,
  type Estado,
} from "@/lib/demonstracao/gravacao";
import { atualizarLoja, atualizarLojasDeDemonstracao, semearAgora } from "@/lib/demonstracao/atualizar";
import { bancoFalso, retrato, type BancoFalso } from "./_banco-demonstracao";

type Linha = Record<string, unknown>;

// A linha de log de cada rodada (o que a Vercel mostra) nao polui a saida.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const H = 3_600_000;
/** 12:00 de Brasilia de 25/07/2026: a janela vai do lancamento (22/07) ate hoje. */
const T0 = Date.parse("2026-07-25T15:00:00.000Z");
const CONTAS = [CONTA_META.id, CONTA_GOOGLE.id];
const REAL = "22222222-2222-4222-8222-222222222222";
const OUTRA = "33333333-3333-4333-8333-333333333333";
const TABELAS = [
  "fin_orders",
  "fin_order_origem",
  "tracking_events",
  "ad_spend_daily",
  "ad_insights_granular",
  "fin_sync_state",
  "ad_accounts",
  "tracking_destinations",
  "tracking_configs",
];

function cambio(): FxRateRow[] {
  const linhas: FxRateRow[] = [];
  for (let d = "2026-07-10"; d <= "2026-08-31"; d = somarDia(d, 1)) {
    const i = Number(d.slice(8, 10));
    linhas.push(
      { data: d, moeda: "CAD", por_usd: 1.37 + i / 10_000, fonte: "frankfurter" },
      { data: d, moeda: "GBP", por_usd: 0.76 + i / 10_000, fonte: "frankfurter" },
      { data: d, moeda: "AUD", por_usd: 1.52 + i / 10_000, fonte: "frankfurter" },
      { data: d, moeda: "EUR", por_usd: 0.86 + i / 10_000, fonte: "frankfurter" },
      { data: d, moeda: "BRL", por_usd: 5.4 + i / 1000, fonte: "ptax" }
    );
  }
  return linhas;
}

/** A loja do gerador sem nenhum dado ainda (o que o gravarBase do script deixa). */
function base(extra: Record<string, Linha[]> = {}): BancoFalso {
  return bancoFalso({
    stores: [{ id: LOJA_ID, user_id: ARTHUR, shop_domain: DOMINIO, demonstracao: true }],
    ad_accounts: contasDaLoja().map((c) => ({ ...c })) as unknown as Linha[],
    tracking_destinations: [{ id: DESTINO_META.id, store_id: LOJA_ID, created_at: "2026-07-16T16:40:09.000Z" }],
    tracking_configs: [{ store_id: LOJA_ID, user_id: ARTHUR, enabled: true }],
    fx_rates: cambio() as unknown as Linha[],
    ...extra,
  });
}

/** O `semear` do script no instante (a janela inteira montada, sem teto). */
async function semear(b: BancoFalso, agoraMs: number, tudo = false) {
  const admin = b.client;
  const estado = await lerEstado(admin);
  const hoje = diaLocal(agoraMs);
  const fx = await lerCambio(admin, inicioDaJanela(hoje), hoje);
  return semearAgora(admin, montar(agoraMs, montarCambio(fx), fx), fx, estado, { tudo });
}

async function rodada(b: BancoFalso, agoraMs: number, limite?: number) {
  const r = await atualizarLojasDeDemonstracao(b.client, { agoraMs, limite });
  expect(r.erros).toEqual([]);
  return r.lojas.find((l) => l.loja === DOMINIO)!;
}

/** As linhas da loja, em ordem, sem os carimbos de quando cada uma foi escrita. */
function normalizado(b: BancoFalso, semCarimbo = true): Record<string, Linha[]> {
  const chave = (t: string) => (l: Linha) =>
    t === "fin_orders" || t === "fin_order_origem"
      ? String(l.shopify_order_id)
      : t === "tracking_events" || t === "ad_accounts" || t === "tracking_destinations"
        ? String(l.id)
        : t === "ad_spend_daily"
          ? `${l.ad_account_id}|${l.data}|${l.nivel}|${l.campanha_id}`
          : t === "ad_insights_granular"
            ? `${l.ad_account_id}|${l.data}|${l.nivel}|${l.objeto_id}`
            : String(l.store_id);
  const saida: Record<string, Linha[]> = {};
  for (const t of TABELAS) {
    saida[t] = (b.tabelas[t] ?? [])
      .map((l) => {
        const c = { ...l };
        if (semCarimbo && t === "fin_orders") delete c.sincronizado_em;
        if (semCarimbo && t === "fin_order_origem") delete c.atualizado_em;
        return c;
      })
      .sort((a, b2) => (chave(t)(a) < chave(t)(b2) ? -1 : 1));
  }
  return saida;
}

/** As linhas que o gerador da no instante (o que o banco deve ter), com o cambio que o cron le. */
function doGerador(agoraMs: number) {
  const hoje = diaLocal(agoraMs);
  const fx = cambio().filter((l) => l.data >= somarDia(inicioDaJanela(hoje), -10) && l.data <= hoje);
  return montar(agoraMs, montarCambio(fx), fx);
}

/** Os mesmos instantes uma hora depois: o que o gerador em America/New_York gravou (conferido no banco de producao). */
function paraNovaYork(b: BancoFalso) {
  const mais = (v: unknown) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + H).toISOString() : v);
  const campos: Record<string, string[]> = {
    fin_orders: ["processado_em", "criado_em", "atualizado_em", "cancelado_em", "enviado_em", "entregue_em", "sincronizado_em"],
    fin_order_origem: ["pedido_em", "toque_em", "atualizado_em"],
    tracking_events: ["created_at", "next_attempt_at", "sent_at"],
    ad_spend_daily: ["sincronizado_em"],
  };
  for (const [t, cs] of Object.entries(campos)) for (const l of b.tabelas[t] ?? []) for (const c of cs) l[c] = mais(l[c]);
  const sync = b.tabelas.fin_sync_state[0];
  sync.fuso = "America/New_York";
  sync.cursor_atualizado = mais(sync.cursor_atualizado);
  for (const c of b.tabelas.ad_accounts) c.fuso = "America/New_York";
}

describe("o cron completa a loja ate agora", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch nao pode ser chamado pela loja de demonstracao");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("de hora em hora, atravessando a meia-noite de Brasilia: o banco e o do gerador e o do semear no mesmo instante", async () => {
    const cron = base();
    await semear(cron, T0);
    const modos: string[] = [];
    let fim = T0;
    // De hora em hora ate as 22h de Brasilia; dai de 15 em 15 min, como o
    // cron, ate as 02h (a sessao do primeiro pedido do dia comeca antes da
    // meia-noite e so nasce quando o dia entra no plano).
    const instantes: number[] = [];
    for (let t = T0 + H; t <= T0 + 10 * H; t += H) instantes.push(t);
    for (let t = T0 + 10 * H + 15 * 60_000; t <= T0 + 14 * H; t += 15 * 60_000) instantes.push(t);
    for (const t of instantes) {
      const r = await rodada(cron, t);
      expect(r.pulada).toBeUndefined();
      modos.push(r.modo!);
      fim = t;
    }
    // A primeira rodada depois da meia-noite de Brasilia (03:00 UTC) e o diario.
    expect(modos.filter((m) => m === "diario")).toHaveLength(1);
    expect(modos[modos.indexOf("diario") - 1]).toBe("incremental");
    expect(diaLocal(T0 + 12 * H)).toBe("2026-07-26");

    // O banco tem exatamente o que o gerador da agora.
    const s = doGerador(fim);
    const pedidos = cron.tabelas.fin_orders;
    expect(pedidos.map((p) => p.shopify_order_id).sort()).toEqual(s.pedidos.map((p) => p.shopify_order_id).sort());
    const porId = new Map(pedidos.map((p) => [p.shopify_order_id, p]));
    for (const p of s.pedidos) expect({ ...porId.get(p.shopify_order_id), sincronizado_em: 0 }).toEqual({ ...p, sincronizado_em: 0 });
    const eventos = new Map(cron.tabelas.tracking_events.map((e) => [e.id, e]));
    expect(eventos.size).toBe(s.compras.length + s.funil.length);
    for (const e of [...s.compras, ...s.funil]) expect(eventos.get(e.id)).toEqual(e);
    expect(cron.tabelas.ad_spend_daily).toHaveLength(s.linhasGasto.length);
    const gasto = new Map(cron.tabelas.ad_spend_daily.map((g) => [`${g.ad_account_id}|${g.data}|${g.nivel}|${g.campanha_id}`, g]));
    for (const g of s.linhasGasto) expect(gasto.get(`${g.ad_account_id}|${g.data}|${g.nivel}|${g.campanha_id}`)).toEqual(g);
    expect(cron.tabelas.fin_sync_state[0]).toMatchObject({ fuso: FUSO, cursor_atualizado: new Date(fim).toISOString(), sincronizando_desde: null });

    // E o mesmo que o script deixaria: semear no comeco e de novo no fim.
    const script = base();
    await semear(script, T0);
    await semear(script, fim);
    expect(normalizado(cron)).toEqual(normalizado(script));
  }, 120_000);

  it("a sessao do primeiro pedido do dia (antes da meia-noite, atras do ultimo evento gravado) entra na primeira rodada do dia", async () => {
    const b = base();
    // O semear um pouco antes da meia-noite de Brasilia: o funil gravado vai ate ~23:59.
    await semear(b, Date.parse("2026-07-26T02:59:30.000Z"));
    const agora = Date.parse("2026-07-26T03:05:00.000Z");
    const s = doGerador(agora);
    const ultimo = Math.max(...b.tabelas.tracking_events.filter((e) => e.event_name !== "Purchase").map((e) => Date.parse(String(e.created_at))));
    // Ha evento de hoje antes da meia-noite e mais velho que a sobreposicao com o ultimo gravado.
    expect(s.madrugada.some((e) => Date.parse(e.created_at) < ultimo - 15 * 60_000)).toBe(true);
    const r = await rodada(b, agora);
    expect(r.modo).toBe("diario");
    const ids = new Set(b.tabelas.tracking_events.map((e) => e.id));
    expect(s.funil.filter((e) => !ids.has(e.id)).map((e) => e.created_at)).toEqual([]);
  }, 60_000);

  it("duas rodadas no mesmo instante: o mesmo banco, carimbo por carimbo", async () => {
    const b = base();
    await semear(b, T0);
    await rodada(b, T0 + 3 * H);
    const antes = retrato(b, TABELAS);
    const r = await rodada(b, T0 + 3 * H);
    expect(r.modo).toBe("incremental");
    expect(retrato(b, TABELAS)).toEqual(antes);
  }, 60_000);

  it("rodar o script por cima do cron (e o cron por cima do script) nao duplica nada", async () => {
    const b = base();
    await semear(b, T0);
    await rodada(b, T0 + 2 * H);
    await semear(b, T0 + 2 * H);
    await rodada(b, T0 + 2 * H);
    // O --tudo regrava a janela inteira por cima: nenhuma linha a mais.
    const r = await semear(b, T0 + 2 * H, true);
    expect(r.modo).toBe("completo");
    expect(r.gravadas.fin_orders).toBe(b.tabelas.fin_orders.length);
    const s = doGerador(T0 + 2 * H);
    expect(b.tabelas.fin_orders).toHaveLength(s.pedidos.length);
    expect(b.tabelas.fin_order_origem).toHaveLength(s.origens.length);
    expect(b.tabelas.tracking_events).toHaveLength(s.compras.length + s.funil.length);
    expect(b.tabelas.ad_spend_daily).toHaveLength(s.linhasGasto.length);
  }, 60_000);
});

describe("seguranca do cron", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch nao pode ser chamado pela loja de demonstracao");
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sem loja marcada: uma consulta e mais nada", async () => {
    const b = bancoFalso({
      stores: [{ id: REAL, user_id: "u-real", shop_domain: "real-01.myshopify.com", demonstracao: false }],
      fin_orders: [{ store_id: REAL, shopify_order_id: "1", dia_local: "2026-07-25" }],
    });
    const r = await atualizarLojasDeDemonstracao(b.client, { agoraMs: T0 });
    expect(r).toEqual({ ok: true, lojas: [], erros: [] });
    expect(b.consultas).toBe(1);
    expect(b.escritas).toEqual([]);
  });

  it("sem a 074 (coluna ausente): uma consulta, nenhuma loja", async () => {
    let consultas = 0;
    const client = {
      from: () => {
        consultas += 1;
        const q = {
          select: () => q,
          eq: () => q,
          limit: async () => ({ data: null, error: { code: "42703", message: "column stores.demonstracao does not exist" } }),
        };
        return q;
      },
    } as never;
    expect(await atualizarLojasDeDemonstracao(client, { agoraMs: T0 })).toEqual({ ok: true, lojas: [], erros: [] });
    expect(consultas).toBe(1);
  });

  it("so a loja do gerador: a loja real e a marcada de outro dono ficam intocadas, e toda escrita e da loja", async () => {
    const b = base({
      stores: [
        { id: LOJA_ID, user_id: ARTHUR, shop_domain: DOMINIO, demonstracao: true },
        { id: REAL, user_id: "u-real", shop_domain: "real-01.myshopify.com", demonstracao: false },
        { id: OUTRA, user_id: "u-outro", shop_domain: "outra-01.myshopify.com", demonstracao: true },
      ],
    });
    await semear(b, T0);
    b.tabelas.fin_orders.push({ store_id: REAL, shopify_order_id: "5001", dia_local: "2026-07-25", criado_em: "2026-07-25T10:00:00.000Z" });
    b.tabelas.fin_orders.push({ store_id: OUTRA, shopify_order_id: "7001", dia_local: "2026-07-01", criado_em: "2026-07-01T10:00:00.000Z" });
    b.tabelas.tracking_events.push({ id: "ev-real", store_id: REAL, event_name: "view_item", created_at: "2026-07-01T00:00:00.000Z" });
    b.tabelas.fin_sync_state.push({ store_id: REAL, user_id: "u-real", fuso: "America/New_York", cursor_atualizado: null, sincronizando_desde: null });
    b.tabelas.ad_accounts.push({ id: "a-real", store_id: REAL, user_id: "u-real", fuso: "America/New_York" });
    b.tabelas.ad_spend_daily.push({ ad_account_id: "a-real", data: "2026-07-01", nivel: "conta", campanha_id: "", gasto: 10 });
    b.tabelas.ad_insights_granular = [{ ad_account_id: "a-real", data: "2026-07-01", nivel: "conta", objeto_id: "x" }];
    const deFora = (l: Linha) => l.store_id === REAL || l.store_id === OUTRA || l.ad_account_id === "a-real" || l.id === "a-real";
    const foraAntes = Object.fromEntries(TABELAS.map((t) => [t, structuredClone((b.tabelas[t] ?? []).filter(deFora))]));
    b.escritas.length = 0;

    const r = await atualizarLojasDeDemonstracao(b.client, { agoraMs: T0 + 2 * H });
    expect(r.ok).toBe(true);
    expect(r.lojas.find((l) => l.loja === "outra-01.myshopify.com")?.pulada).toMatch(/sem gerador/);
    expect(r.lojas.find((l) => l.loja === DOMINIO)?.gravadas?.fin_orders).toBeGreaterThan(0);
    const foraDepois = Object.fromEntries(TABELAS.map((t) => [t, (b.tabelas[t] ?? []).filter(deFora)]));
    expect(foraDepois).toEqual(foraAntes);
    for (const e of b.escritas) {
      for (const l of e.linhas) {
        const daLoja =
          l.store_id === LOJA_ID ||
          (typeof l.ad_account_id === "string" && CONTAS.includes(l.ad_account_id)) ||
          (e.tabela === "ad_accounts" && CONTAS.includes(String(l.id)));
        expect(daLoja, `${e.op} em ${e.tabela}: ${JSON.stringify(l).slice(0, 120)}`).toBe(true);
      }
    }
  }, 60_000);

  it("teto por rodada: com pouco espaco por rodada, varias rodadas chegam ao mesmo banco, sem perder linha", async () => {
    const agora = T0 + 10 * H;
    const inteiro = base();
    await semear(inteiro, T0);
    await rodada(inteiro, agora);

    const aos = base();
    await semear(aos, T0);
    const cursorAntes = aos.tabelas.fin_sync_state[0].cursor_atualizado;
    const primeira = await rodada(aos, agora, 300);
    expect(primeira.adiadas).toBeGreaterThan(0);
    const soma = (g: Record<string, number> | undefined) =>
      Object.entries(g ?? {}).filter(([k]) => k !== "ad_insights_granular").reduce((t, [, v]) => t + v, 0);
    expect(soma(primeira.gravadas)).toBeLessThanOrEqual(300);
    // Nada fechou: o cursor nao anda (a proxima continua).
    expect(aos.tabelas.fin_sync_state[0].cursor_atualizado).toBe(cursorAntes);
    let voltas = 1;
    for (let r = primeira; r.adiadas; voltas += 1) {
      r = await rodada(aos, agora, 300);
      expect(soma(r.gravadas)).toBeLessThanOrEqual(300);
      expect(voltas).toBeLessThan(80);
    }
    expect(voltas).toBeGreaterThan(2);
    expect(normalizado(aos)).toEqual(normalizado(inteiro));
  }, 120_000);

  it("trava de tamanho: a loja acima do teto de linhas nao grava nada", async () => {
    const b = base();
    await semear(b, T0);
    for (let i = 0; i < TETO_DE_LINHAS.fin_orders; i += 1) {
      b.tabelas.fin_orders.push({ store_id: LOJA_ID, shopify_order_id: `lixo-${i}`, dia_local: "2026-07-22", criado_em: "2026-07-22T12:00:00.000Z" });
    }
    const antes = retrato(b, ["fin_orders", "fin_order_origem", "ad_spend_daily"]);
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    b.escritas.length = 0;
    const r = await rodada(b, T0 + H);
    expect(r.pulada).toMatch(/teto de linhas.*fin_orders/);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
    expect(b.escritas.filter((e) => e.op === "upsert" || e.op === "insert")).toEqual([]);
    expect(retrato(b, ["fin_orders", "fin_order_origem", "ad_spend_daily"])).toEqual(antes);
    expect(b.tabelas.fin_sync_state[0].sincronizando_desde).toBeNull();
  }, 60_000);

  it("passaDoTeto: conta o que a loja tem mais o que a rodada poe", () => {
    const zero = { fin_orders: 0, fin_order_origem: 0, tracking_events: 0, ad_spend_daily: 0, ad_insights_granular: 0 };
    expect(passaDoTeto({ ...zero, fin_orders: 12_000 }, { ...zero, fin_orders: 200 })).toBeNull();
    expect(passaDoTeto({ ...zero, fin_orders: 19_900 }, { ...zero, fin_orders: 200 })).toMatch(/fin_orders 19900 \+ 200 > 20000/);
    expect(passaDoTeto({ ...zero, tracking_events: TETO_DE_LINHAS.tracking_events + 1 }, zero)).toMatch(/tracking_events/);
  });

  it("pedido gravado que o gerador nao conhece: nao grava (o id mudou, duplicaria a loja)", async () => {
    const b = base();
    await semear(b, T0);
    b.tabelas.fin_orders.push({ store_id: LOJA_ID, shopify_order_id: "999", nome: "#1", dia_local: "2026-07-25", criado_em: "2026-07-25T13:00:00.000Z" });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    b.escritas.length = 0;
    const r = await rodada(b, T0 + H);
    erro.mockRestore();
    expect(r.pulada).toMatch(/nao conhece.*999/);
    expect(b.escritas.filter((e) => e.op === "upsert" || e.op === "insert")).toEqual([]);
  }, 60_000);

  it("outra rodada com a trava: pula sem gravar", async () => {
    const b = base();
    await semear(b, T0);
    b.tabelas.fin_sync_state[0].sincronizando_desde = new Date(T0 + H - 60_000).toISOString();
    b.escritas.length = 0;
    const r = await atualizarLoja(b.client, T0 + H);
    expect(r.pulada).toMatch(/outra rodada/);
    expect(b.escritas.filter((e) => e.op !== "update")).toEqual([]);
  }, 60_000);
});

describe("fuso de Brasilia", () => {
  it("o dia vira na meia-noite de Brasilia (03:00 UTC), igual a conta do app", () => {
    const antes = Date.parse("2026-10-21T02:59:59.999Z");
    const depois = Date.parse("2026-10-21T03:00:00.000Z");
    expect(FUSO).toBe("America/Sao_Paulo");
    expect(diaLocal(antes)).toBe("2026-10-20");
    expect(diaLocal(depois)).toBe("2026-10-21");
    expect(diaNoFuso(new Date(antes), FUSO)).toBe("2026-10-20");
    expect(diaNoFuso(new Date(depois), FUSO)).toBe("2026-10-21");
    // Em New York ainda era dia 20 (o que o Arthur viu as 00h de Brasilia).
    expect(diaNoFuso(new Date(depois), "America/New_York")).toBe("2026-10-20");
    expect(instanteLocal("2026-10-21", 0)).toBe(depois);
  });

  it("a primeira rodada depois da meia-noite: o dia novo ja tem pedido e gasto, e o dia velho fecha", async () => {
    const b = base();
    await semear(b, T0);
    // 02:30 de Brasilia do dia 26 (05:30 UTC): a primeira rodada do dia.
    const agora = Date.parse("2026-07-26T05:30:00.000Z");
    const r = await rodada(b, agora);
    expect(r.modo).toBe("diario");
    const virada = "2026-07-26T03:00:00.000Z";
    const doDia = (dia: string) => b.tabelas.fin_orders.filter((p) => p.dia_local === dia);
    const doGeradorHoje = doGerador(agora).pedidos.filter((p) => p.dia_local === "2026-07-26");
    expect(doGeradorHoje.length).toBeGreaterThan(0);
    expect(doDia("2026-07-26").map((p) => p.shopify_order_id).sort()).toEqual(doGeradorHoje.map((p) => p.shopify_order_id).sort());
    expect(doDia("2026-07-26").every((p) => String(p.criado_em) >= virada)).toBe(true);
    expect(doDia("2026-07-25").every((p) => String(p.criado_em) < virada)).toBe(true);
    const contaHoje = b.tabelas.ad_spend_daily.filter((g) => g.data === "2026-07-26" && g.nivel === "conta");
    expect(contaHoje).toHaveLength(2);
    expect(contaHoje.reduce((t, g) => t + Number(g.gasto), 0)).toBeGreaterThan(0);
    expect(b.tabelas.fin_sync_state[0].fuso).toBe(FUSO);
  }, 60_000);

  it("troca de fuso: o que estava em New York e regravado no lugar -- mesmos ids, nenhuma linha a mais", async () => {
    const ny = base();
    await semear(ny, T0);
    paraNovaYork(ny);
    const contagem = (b: BancoFalso) => TABELAS.slice(0, 4).map((t) => (b.tabelas[t] ?? []).length);
    const agora = T0 + H + 15 * 60_000;
    const r = await rodada(ny, agora);
    expect(r.modo).toBe("completo");
    expect(r.motivo).toMatch(/America\/New_York/);
    expect(ny.tabelas.fin_sync_state[0]).toMatchObject({ fuso: FUSO, cursor_atualizado: new Date(agora).toISOString() });
    expect(ny.tabelas.ad_accounts.every((c) => c.fuso === FUSO)).toBe(true);

    const novo = base();
    await semear(novo, agora);
    expect(contagem(ny)).toEqual(contagem(novo));
    expect(normalizado(ny, false)).toEqual(normalizado(novo, false));
  }, 60_000);

  it("troca de fuso com teto: o fuso vale ja, o 'Hoje' vem na primeira rodada, e as seguintes terminam a janela", async () => {
    const ny = base();
    await semear(ny, T0);
    paraNovaYork(ny);
    const agora = T0 + H + 15 * 60_000;
    const primeira = await rodada(ny, agora, 400);
    expect(primeira.modo).toBe("completo");
    expect(primeira.adiadas).toBeGreaterThan(0);
    expect(ny.tabelas.fin_sync_state[0]).toMatchObject({ fuso: FUSO, cursor_atualizado: null });
    // O pedido mais novo ja esta no instante de Brasilia.
    const s = doGerador(agora);
    const ultimo = s.pedidos[s.pedidos.length - 1];
    expect(ny.tabelas.fin_orders.find((p) => p.shopify_order_id === ultimo.shopify_order_id)?.criado_em).toBe(ultimo.criado_em);
    let r = primeira;
    for (let voltas = 0; r.adiadas; voltas += 1) {
      r = await rodada(ny, agora, 400);
      expect(r.modo).toBe("completo");
      expect(voltas).toBeLessThan(60);
    }
    const novo = base();
    await semear(novo, agora);
    expect(normalizado(ny, false)).toEqual(normalizado(novo, false));
    // A proxima rodada ja e a de sempre.
    expect((await rodada(ny, agora + 15 * 60_000)).modo).toBe("incremental");
  }, 120_000);
});

describe("o gerador do cron e o do script", () => {
  it("montar com selecao da as MESMAS linhas que a janela inteira, nos dias pedidos", () => {
    const agora = Date.parse("2026-08-10T18:00:00.000Z");
    const fx = cambio();
    const inteiro = montar(agora, montarCambio(fx), fx);
    const parte = montar(agora, montarCambio(fx), fx, {
      dias: (dia) => dia >= "2026-08-09",
      pedido: (p) => p.dia === "2026-08-01",
    });
    const quer = (dia: string) => dia >= "2026-08-09" || dia === "2026-08-01";
    expect(parte.pedidos).toEqual(inteiro.pedidos.filter((p) => quer(p.dia_local)));
    const ids = new Set(parte.pedidos.map((p) => p.shopify_order_id));
    expect(parte.origens).toEqual(inteiro.origens.filter((o) => ids.has(o.shopify_order_id)));
    expect(parte.compras).toEqual(inteiro.compras.filter((c) => ids.has(c.order_id)));
    // O funil de um dia do plano pode comecar antes da meia-noite (a sessao do
    // primeiro pedido) e passar dela: cada evento da selecao e o da janela
    // inteira, e todo evento depois do primeiro dia pedido esta na selecao.
    const doInteiro = new Map(inteiro.funil.map((e) => [e.id, e]));
    for (const e of parte.funil) expect(e).toEqual(doInteiro.get(e.id));
    const naParte = new Set(parte.funil.map((e) => e.id));
    expect(inteiro.funil.filter((e) => diaLocal(Date.parse(e.created_at)) >= "2026-08-10" && !naParte.has(e.id))).toEqual([]);
    expect(parte.madrugada.length).toBeGreaterThan(0);
    expect(parte.madrugada).toEqual(inteiro.madrugada);
    expect(parte.madrugada.every((e) => Date.parse(e.created_at) < instanteLocal("2026-08-10", 0))).toBe(true);
    expect(parte.linhasGasto).toEqual(inteiro.linhasGasto.filter((g) => g.data >= "2026-08-09"));
    for (const dia of ["2026-08-09", "2026-08-10"]) expect(parte.porDia.get(dia)).toEqual(inteiro.porDia.get(dia));
  }, 60_000);
});

describe("modo da rodada", () => {
  const agora = Date.parse("2026-10-21T15:00:00.000Z");
  const ok: Estado = {
    fuso: FUSO,
    cursorMs: agora - 15 * 60_000,
    temPedidos: true,
    primeiroDia: inicioDaJanela("2026-10-21"),
    primeiraCompra: "2026-09-01T03:20:00.000Z",
    ultimoFunil: new Date(agora - 16 * 60_000).toISOString(),
  };
  it("incremental no mesmo dia; diario na primeira do dia; completo no fuso trocado, sem cursor, cursor velho ou comeco faltando", () => {
    expect(modoDaRodada(ok, agora).modo).toBe("incremental");
    expect(modoDaRodada({ ...ok, cursorMs: Date.parse("2026-10-21T02:50:00.000Z") }, agora).modo).toBe("diario");
    expect(modoDaRodada({ ...ok, fuso: "America/New_York" }, agora).modo).toBe("completo");
    expect(modoDaRodada({ ...ok, cursorMs: null }, agora).modo).toBe("completo");
    expect(modoDaRodada({ ...ok, cursorMs: agora - (DIAS_REGRAVADOS + 1) * 24 * H }, agora).modo).toBe("completo");
    expect(modoDaRodada({ ...ok, primeiroDia: "2026-08-15" }, agora).modo).toBe("completo");
    expect(modoDaRodada({ ...ok, primeiraCompra: "2026-09-05T12:00:00.000Z" }, agora).modo).toBe("completo");
    expect(modoDaRodada({ ...ok, temPedidos: false }, agora).modo).toBe("completo");
  });
});

describe("o teto de linhas cobre o pico do plano", () => {
  it("pedidos em 93 dias, Purchase em 63, funil de 48 h no dia mais cheio, gasto e retrato de Campanhas", () => {
    const plano = gerarPlano("2027-12-31");
    const n = plano.map((d) => d.pedidos.length);
    const maiorSoma = (k: number) => {
      let soma = n.slice(0, k).reduce((a, b) => a + b, 0);
      let maior = soma;
      for (let i = k; i < n.length; i += 1) {
        soma += n[i] - n[i - k];
        maior = Math.max(maior, soma);
      }
      return maior;
    };
    // A janela mais longa + o dia antes da limpeza; a de Purchase, idem.
    expect(maiorSoma(MAIOR_JANELA + 1) * 1.15).toBeLessThan(TETO_DE_LINHAS.fin_orders);
    const purchase = maiorSoma(63);
    const cheios = [...plano].sort((a, b) => b.pedidos.length - a.pedidos.length).slice(0, 3);
    const funilDia = Math.max(...cheios.map((d) => funilDoDia(d, Date.parse("2100-01-01T00:00:00Z")).length));
    expect((purchase + (HORAS_DE_FUNIL / 24) * funilDia) * 1.15).toBeLessThan(TETO_DE_LINHAS.tracking_events);
    expect((MAIOR_JANELA + 1) * (CAMPANHAS.length + 2)).toBeLessThan(TETO_DE_LINHAS.ad_spend_daily);
    const objetos = CAMPANHAS.reduce((t, c) => t + 1 + c.conjuntos.reduce((x, k) => x + 1 + k.anuncios.length, 0), 0) + 2;
    expect(2 * objetos).toBeLessThan(TETO_DE_LINHAS.ad_insights_granular);
  }, 120_000);
});

describe("rota do cron", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("sem o segredo: 401 sem consultar nada; com o segredo: a rodada", async () => {
    process.env.CRON_SECRET = "segredo";
    const b = bancoFalso({ stores: [] });
    mundo.client = b.client;
    const { NextRequest } = await import("next/server");
    const { GET } = await import("../src/app/api/jobs/demonstracao/route");
    const sem = await GET(new NextRequest("https://user.xcart.app/api/jobs/demonstracao"));
    expect(sem.status).toBe(401);
    expect(b.consultas).toBe(0);
    const com = await GET(new NextRequest("https://user.xcart.app/api/jobs/demonstracao", { headers: { authorization: "Bearer segredo" } }));
    expect(com.status).toBe(200);
    expect(await com.json()).toEqual({ ok: true, lojas: [], erros: [] });
    expect(b.consultas).toBe(1);
  });
});
