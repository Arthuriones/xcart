import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./_fake-supabase";

// Alertas do roteamento (avaliar.ts R8-R10): script que sumiu da vitrine,
// carrinhos caindo no checkout da vitrine e conserto falhando. Nada para
// rota desligada ou com as lojas de checkout pausadas.

vi.mock("server-only", () => ({}));

import { coletarCondicoesDetalhado } from "@/lib/alertas/avaliar";
import { escapesDemais, rotaRecebendo, scriptSumiu, vitrineFora } from "@/lib/alertas/roteamento";

const AGORA = new Date("2026-10-08T12:00:00Z");
const HORA = 3_600_000;
const ha = (h: number) => new Date(AGORA.getTime() - h * HORA).toISOString();
const VIT = "11111111-1111-4111-8111-111111111111";
const ROTA = "33333333-3333-4333-8333-333333333333";

type Linha = Record<string, unknown>;

interface Cenario {
  ligada?: boolean;
  destinos?: Linha[];
  lastHeal?: Linha | null;
  /** Horas atras de cada loader_ready (o fake nao ordena: do mais novo ao mais velho). */
  sinais?: number[];
  /** Horas atras de cada checkout_na_vitrine. */
  escapes?: number[];
  abertoScript?: boolean;
  desinstalada?: boolean;
}

async function condicoes(c: Cenario) {
  const fallbacks: Linha[] = [
    ...[...(c.sinais ?? [])].sort((a, b) => a - b).map((h, i) => ({
      id: `r${i}`,
      route_config_id: ROTA,
      reason: "loader_ready",
      created_at: ha(h),
    })),
    ...(c.escapes ?? []).map((h, i) => ({ id: `e${i}`, route_config_id: ROTA, reason: "checkout_na_vitrine", created_at: ha(h) })),
  ];
  const banco = fakeSupabase({
    stores: [{ id: VIT, user_id: "u1", name: "NORAH", shop_domain: "r0pxre-p6.myshopify.com", uninstalled_at: c.desinstalada ? ha(5) : null }],
    routed_checkout_configs: [
      {
        id: ROTA,
        user_id: "u1",
        name: "NORAH -> NORAH OUTLET",
        source_store_id: VIT,
        enabled: c.ligada !== false,
        settings: c.lastHeal === null ? {} : { last_heal: c.lastHeal ?? { at: ha(1), ok: true, falhas: 0 } },
      },
    ],
    routed_checkout_targets: c.destinos ?? [{ route_id: ROTA, enabled: true, weight: 1 }],
    routed_checkout_fallbacks: fallbacks,
    alertas: c.abertoScript ? [{ regra: "roteamento_script_sumiu", chave: ROTA, store_id: VIT, resolvido_em: null }] : [],
  });
  const r = await coletarCondicoesDetalhado(banco.client, AGORA);
  expect(r.erros).toEqual([]);
  return r.condicoes.filter((x) => x.regra.startsWith("roteamento_"));
}

/** 40 sinais espalhados entre 7 h e 70 h atras: volume bom, nenhum nas ultimas 6 h. */
const SUMIU = Array.from({ length: 40 }, (_, i) => 7 + i * 1.5);

describe("script do roteamento sumiu", () => {
  it("tinha sinal nas 72 h, com volume, e nada nas ultimas 6 h: critico", async () => {
    const c = await condicoes({ sinais: SUMIU });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      user_id: "u1",
      store_id: VIT,
      regra: "roteamento_script_sumiu",
      chave: ROTA,
      severidade: "critico",
      titulo: "Script do roteamento sumiu da vitrine",
    });
    expect(c[0].detalhe).toContain("7 h");
  });

  it("sinal recente: nada", async () => {
    expect(await condicoes({ sinais: [2, ...SUMIU] })).toHaveLength(0);
  });

  it("vitrine com pouca visita nao acende (6 h sem ninguem e normal)", async () => {
    expect(await condicoes({ sinais: [8, 20, 40, 60] })).toHaveLength(0);
  });

  it("parado ha mais de 72 h nao e 'sumiu agora'; aberto continua ate o sinal voltar", async () => {
    expect(await condicoes({ sinais: [80, 90] })).toHaveLength(0);
    expect(await condicoes({ sinais: [80, 90], abertoScript: true })).toHaveLength(1);
    expect(await condicoes({ sinais: [1, 80], abertoScript: true })).toHaveLength(0);
  });

  it("rota desligada, lojas pausadas ou vitrine fora do ar: nada", async () => {
    expect(await condicoes({ sinais: SUMIU, ligada: false })).toHaveLength(0);
    expect(await condicoes({ sinais: SUMIU, destinos: [{ route_id: ROTA, enabled: false, weight: 1 }] })).toHaveLength(0);
    expect(await condicoes({ sinais: SUMIU, destinos: [{ route_id: ROTA, enabled: true, weight: 0 }] })).toHaveLength(0);
    // A vitrine pausada na Shopify: o alerta certo e o do conserto (falhas < 3 aqui, entao nenhum).
    expect(
      await condicoes({
        sinais: SUMIU,
        lastHeal: { at: ha(1), ok: false, falhas: 1, motivo: "loja_pausada", lado: "vitrine", message: "Loja vitrine (x): pausada ou sem plano" },
      })
    ).toHaveLength(0);
    expect(await condicoes({ sinais: SUMIU, desinstalada: true })).toHaveLength(0);
  });
});

describe("carrinhos caindo no checkout da vitrine", () => {
  it("3 escapes em 24 h: critico com o numero", async () => {
    const c = await condicoes({ sinais: [1], escapes: [1, 5, 20] });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      regra: "roteamento_escape_vitrine",
      chave: ROTA,
      severidade: "critico",
      titulo: "3 carrinhos caíram no checkout da vitrine",
    });
  });

  it("abaixo do minimo ou fora das 24 h: nada", async () => {
    expect(await condicoes({ sinais: [1], escapes: [1, 5] })).toHaveLength(0);
    expect(await condicoes({ sinais: [1], escapes: [1, 5, 30, 40] })).toHaveLength(0);
  });

  it("rota desligada: nada", async () => {
    expect(await condicoes({ ligada: false, escapes: [1, 2, 3, 4] })).toHaveLength(0);
  });
});

describe("conserto da rota falhando", () => {
  it("3 passadas seguidas com falha: critico com a mensagem", async () => {
    const c = await condicoes({ sinais: [1], lastHeal: { at: ha(1), ok: false, falhas: 3, message: "Faltam 5 produtos em NORAH OUTLET" } });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      regra: "roteamento_conserto_falhando",
      severidade: "critico",
      titulo: "Conserto automático da rota falhando",
    });
    expect(c[0].detalhe).toContain("Faltam 5 produtos");
  });

  it("duas falhas ainda nao", async () => {
    expect(await condicoes({ sinais: [1], lastHeal: { at: ha(1), ok: false, falhas: 2, message: "x" } })).toHaveLength(0);
  });

  it("credencial revogada: na hora", async () => {
    const c = await condicoes({
      sinais: [1],
      lastHeal: {
        at: ha(1),
        ok: false,
        falhas: 1,
        message: "Loja vitrine (wa0jv9-jn.myshopify.com): As credenciais dessa loja foram revogadas ou expiraram. Reconecte a loja em Lojas.",
      },
    });
    expect(c).toHaveLength(1);
    expect(c[0].titulo).toBe("Rota sem acesso a uma das lojas");
  });

  it("rota pausada nao alerta", async () => {
    expect(
      await condicoes({ ligada: false, lastHeal: { at: ha(1), ok: false, falhas: 9, motivo: "sem_app", message: "x" } })
    ).toHaveLength(0);
  });
});

describe("regras puras", () => {
  it("scriptSumiu nas bordas", () => {
    const t = AGORA.getTime();
    expect(scriptSumiu({ ultimoSinal: ha(6), sinais72h: 36, aberto: false }, t)).toBe(true);
    expect(scriptSumiu({ ultimoSinal: ha(5.9), sinais72h: 500, aberto: true }, t)).toBe(false);
    expect(scriptSumiu({ ultimoSinal: ha(72), sinais72h: 500, aberto: false }, t)).toBe(false);
    expect(scriptSumiu({ ultimoSinal: null, sinais72h: 0, aberto: false }, t)).toBe(false);
    expect(scriptSumiu({ ultimoSinal: null, sinais72h: 0, aberto: true }, t)).toBe(true);
  });

  it("escapes, lojas recebendo e vitrine fora", () => {
    expect(escapesDemais(2)).toBe(false);
    expect(escapesDemais(3)).toBe(true);
    expect(rotaRecebendo([])).toBe(true);
    expect(rotaRecebendo([{ enabled: true, weight: 0 }, { enabled: false, weight: 1 }])).toBe(false);
    expect(rotaRecebendo([{ enabled: true, weight: null }])).toBe(true);
    expect(vitrineFora({ desinstalada: false, ultimoConserto: { at: ha(1), ok: false, motivo: "sem_app" } })).toBe(true);
    expect(vitrineFora({ desinstalada: false, ultimoConserto: { at: ha(1), ok: false, message: "Faltam 3 produtos" } })).toBe(false);
  });
});
