import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acimaDoLimite,
  atualizarPerfil,
  conferirLigarRastreamento,
  conferirRoteamento,
  lerComPlano,
  lerUso,
  limitesDoPerfil,
  lojasComRastreamento,
  lojasNoRoteamento,
  mensagemDeLimite,
  passaDoLimite,
  resumoDoUso,
  semColunaPlano,
} from "@/lib/billing/limites";
import { PLANOS, planoDoValor, precoMensalCentavos, PRO_PRICE_CENTS } from "@/lib/billing/plans";

// O limite de lojas por plano (decisao de 08/10/2026):
//   1 Loja     -> 1 com rastreamento, ate 6 no roteamento
//   3 Lojas    -> 3 e 12
//   Ilimitado  -> sem limite
// Pro antigo (sem tier) e conta sem assinatura: os limites do 1 Loja.
// Admin e acesso liberado: sem limite. Nada ligado acima do limite e desligado.

const FUTURO = "2999-01-01T00:00:00Z";
const PASSADO = "2000-01-01T00:00:00Z";

describe("o catálogo de planos", () => {
  it("tem os três planos com os preços e limites decididos", () => {
    expect(PLANOS.map((p) => [p.id, p.precoCentavos, p.limites.rastreamento, p.limites.roteamento])).toEqual([
      ["loja1", 7990, 1, 6],
      ["lojas3", 11990, 3, 12],
      ["ilimitado", 16990, null, null],
    ]);
    expect(PLANOS.find((p) => p.id === "lojas3")?.selo).toBe("Custo benefício!");
    expect(PLANOS.find((p) => p.id === "ilimitado")?.selo).toBe("Maior desconto!");
  });

  it("reconhece o tier pelo valor cobrado, e não pelo R$ 89 antigo", () => {
    expect(planoDoValor(7990)).toBe("loja1");
    expect(planoDoValor(11990)).toBe("lojas3");
    expect(planoDoValor(16990)).toBe("ilimitado");
    expect(planoDoValor(PRO_PRICE_CENTS)).toBeNull();
    expect(planoDoValor(undefined)).toBeNull();
  });

  it("soma o MRR pelo preço de cada plano, e o Pro antigo pelos R$ 89", () => {
    expect(precoMensalCentavos({ plan: "pro", plano: "lojas3" })).toBe(11990);
    expect(precoMensalCentavos({ plan: "pro", plano: null })).toBe(PRO_PRICE_CENTS);
    expect(precoMensalCentavos({ plan: "free", plano: "ilimitado" })).toBe(0);
  });
});

describe("limitesDoPerfil", () => {
  it("admin e acesso liberado não têm limite", () => {
    for (const p of [{ is_admin: true }, { access_granted: true, plan: "free" }]) {
      expect(limitesDoPerfil(p)).toEqual({ origem: "liberado", plano: null, rastreamento: null, roteamento: null });
    }
  });

  it("cada tier pago vale o seu limite", () => {
    expect(limitesDoPerfil({ plan: "pro", plano: "loja1" })).toMatchObject({ origem: "plano", rastreamento: 1, roteamento: 6 });
    expect(limitesDoPerfil({ plan: "pro", plano: "lojas3" })).toMatchObject({ origem: "plano", rastreamento: 3, roteamento: 12 });
    expect(limitesDoPerfil({ plan: "pro", plano: "ilimitado" })).toMatchObject({ rastreamento: null, roteamento: null });
  });

  it("quem já assinava sem tier (Stripe ou R$ 89) fica com os limites do 1 Loja", () => {
    const stripe = limitesDoPerfil({ plan: "pro", plano: null, payment_provider: "stripe" });
    expect(stripe).toEqual({ origem: "legado", plano: "loja1", rastreamento: 1, roteamento: 6 });
    // Coluna ainda ausente (migration 064 nao aplicada): igual.
    expect(limitesDoPerfil({ plan: "pro" })).toMatchObject({ origem: "legado", rastreamento: 1 });
  });

  it("sem assinatura, e com o Pix de 30 dias vencido, valem os limites do 1 Loja", () => {
    expect(limitesDoPerfil({ plan: "free" })).toMatchObject({ origem: "sem_plano", rastreamento: 1, roteamento: 6 });
    expect(limitesDoPerfil(null)).toMatchObject({ origem: "sem_plano", rastreamento: 1 });
    const pixVencido = {
      plan: "pro",
      plano: "ilimitado",
      payment_provider: "pagou",
      pagou_subscription_id: null,
      current_period_end: PASSADO,
    };
    expect(limitesDoPerfil(pixVencido)).toMatchObject({ origem: "sem_plano", rastreamento: 1 });
    expect(limitesDoPerfil({ ...pixVencido, current_period_end: FUTURO })).toMatchObject({
      origem: "plano",
      rastreamento: null,
    });
  });

  it("tier fora do catálogo não vira plano maior", () => {
    expect(limitesDoPerfil({ plan: "pro", plano: "ouro" })).toMatchObject({ origem: "legado", rastreamento: 1 });
  });
});

describe("contagem de lojas", () => {
  const donas = new Set(["v1", "c1", "c2", "c3", "v2", "desinstalada"]);

  it("roteamento: vitrine + lojas de checkout, distintas", () => {
    const rotas = [
      { id: "r1", source_store_id: "v1", target_store_id: "c1" },
      { id: "r2", source_store_id: "v2", target_store_id: "c1" },
    ];
    const destinos = [
      { route_id: "r1", target_store_id: "c1" },
      { route_id: "r1", target_store_id: "c2" },
      { route_id: "r2", target_store_id: "c1" },
    ];
    expect([...lojasNoRoteamento(rotas, destinos, donas)].sort()).toEqual(["c1", "c2", "v1", "v2"]);
  });

  it("rota sem linha de destino conta a loja de checkout da própria rota", () => {
    const rotas = [{ id: "r1", source_store_id: "v1", target_store_id: "c3" }];
    expect([...lojasNoRoteamento(rotas, [], donas)].sort()).toEqual(["c3", "v1"]);
  });

  it("com linhas de destino, o destino legado da rota não conta de novo", () => {
    const rotas = [{ id: "r1", source_store_id: "v1", target_store_id: "c3" }];
    const destinos = [{ route_id: "r1", target_store_id: "c1" }];
    expect([...lojasNoRoteamento(rotas, destinos, donas)].sort()).toEqual(["c1", "v1"]);
  });

  it("loja desinstalada conta (desinstalar e reinstalar não abre vaga); loja de outro dono, não", () => {
    const rotas = [{ id: "r1", source_store_id: "v1", target_store_id: "desinstalada" }];
    expect([...lojasNoRoteamento(rotas, [], donas)].sort()).toEqual(["desinstalada", "v1"]);
    const deOutro = [{ id: "r2", source_store_id: "v1", target_store_id: "alheia" }];
    expect([...lojasNoRoteamento(deOutro, [], donas)]).toEqual(["v1"]);
    const configs = [
      { store_id: "v1", enabled: true },
      { store_id: "desinstalada", enabled: true },
      { store_id: "alheia", enabled: true },
      { store_id: "c1", enabled: false },
    ];
    expect([...lojasComRastreamento(configs, donas)].sort()).toEqual(["desinstalada", "v1"]);
  });
});

describe("passaDoLimite (grandfather)", () => {
  const de = (...ids: string[]) => new Set(ids);

  it("barra a loja nova acima do limite", () => {
    expect(passaDoLimite(de("a"), de("a", "b"), 1)).toBe(true);
  });

  it("deixa entrar até o limite", () => {
    expect(passaDoLimite(de("a"), de("a", "b", "c"), 3)).toBe(false);
  });

  it("quem já está acima segue com o que tem, mas não liga loja nova", () => {
    // Plano mudou para baixo: 4 ligadas num limite de 1.
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c", "d"), 1)).toBe(false);
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c"), 1)).toBe(false);
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c", "d", "e"), 1)).toBe(true);
  });

  it("trocar uma loja por outra no limite passa", () => {
    expect(passaDoLimite(de("a", "b"), de("a", "c"), 2)).toBe(false);
  });

  it("sem limite, nunca barra", () => {
    expect(passaDoLimite(de(), de("a", "b", "c"), null)).toBe(false);
  });
});

describe("mensagens", () => {
  it("dizem o que o plano cobre e para onde ir", () => {
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "pro", plano: "loja1" }))).toBe(
      "Seu plano cobre 1 loja com rastreamento. Para ligar mais, mude para o 3 Lojas em Assinatura."
    );
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "pro", plano: "lojas3" }))).toBe(
      "Seu plano cobre 3 lojas com rastreamento. Para ligar mais, mude para o Ilimitado em Assinatura."
    );
    expect(mensagemDeLimite("roteamento", limitesDoPerfil({ plan: "pro", plano: "loja1" }))).toBe(
      "Seu plano cobre até 6 lojas no roteamento. Para usar mais lojas, mude para o 3 Lojas em Assinatura."
    );
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "free" }))).toMatch(
      /^Sem assinatura, o xcart cobre 1 loja com rastreamento\. Para ligar mais, assine o 3 Lojas/
    );
  });

  it("resumo do uso na tela de Assinatura", () => {
    expect(resumoDoUso({ rastreamento: 1, roteamento: 6 }, { rastreamento: 1, roteamento: 2 })).toBe(
      "1/1 lojas com rastreamento · 2/6 no roteamento"
    );
    expect(resumoDoUso({ rastreamento: null, roteamento: null }, { rastreamento: 1, roteamento: 4 })).toBe(
      "1 loja com rastreamento · 4 no roteamento"
    );
    expect(acimaDoLimite({ rastreamento: 1, roteamento: 6 }, { rastreamento: 2, roteamento: 0 })).toBe(true);
    expect(acimaDoLimite({ rastreamento: 1, roteamento: 6 }, { rastreamento: 1, roteamento: 6 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// As travas contra um banco em memoria
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>, opcoes: { semColunaPlano?: boolean } = {}) {
  const updates: { tabela: string; patch: Linha; filtros: Linha }[] = [];
  const from = (tabela: string) => {
    const filtros: [string, (v: unknown) => boolean][] = [];
    const eqs: Linha = {};
    let colunas = "";
    let patch: Linha | null = null;
    const resolver = () => {
      if (opcoes.semColunaPlano && /\bplano\b/.test(colunas) && tabela === "profiles") {
        return { data: null, error: { code: "42703", message: "column profiles.plano does not exist" } };
      }
      if (patch) {
        // Na escrita o PostgREST recusa a chave antes do Postgres: PGRST204.
        if (opcoes.semColunaPlano && "plano" in patch) {
          return {
            data: null,
            error: {
              code: "PGRST204",
              message: "Could not find the 'plano' column of 'profiles' in the schema cache",
            },
          };
        }
        updates.push({ tabela, patch, filtros: eqs });
        return { data: null, error: null };
      }
      const linhas = (tabelas[tabela] || []).filter((l) => filtros.every(([c, f]) => f(l[c])));
      return { data: linhas, error: null };
    };
    const api = {
      select: (c: string) => {
        colunas = c;
        return api;
      },
      update: (p: Linha) => {
        patch = p;
        return api;
      },
      eq: (c: string, v: unknown) => {
        eqs[c] = v;
        filtros.push([c, (x) => x === v]);
        return api;
      },
      is: (c: string, v: unknown) => {
        filtros.push([c, (x) => (x ?? null) === v]);
        return api;
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push([c, (x) => vs.includes(x)]);
        return api;
      },
      maybeSingle: async () => {
        const r = resolver();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, erro),
    };
    return api;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

/** Conta de Alice: 4 lojas conectadas, 1 desinstalada (a5); uma de outro dono. */
function conta(perfil: Linha, extra: Partial<Record<string, Linha[]>> = {}) {
  return {
    profiles: [{ id: "alice", ...perfil }, { id: "bob", is_admin: true }],
    stores: [
      { id: "a1", user_id: "alice", uninstalled_at: null },
      { id: "a2", user_id: "alice", uninstalled_at: null },
      { id: "a3", user_id: "alice", uninstalled_at: null },
      { id: "a4", user_id: "alice", uninstalled_at: null },
      { id: "a5", user_id: "alice", uninstalled_at: "2026-10-01T00:00:00Z" },
      { id: "b1", user_id: "bob", uninstalled_at: null },
    ],
    tracking_configs: [{ store_id: "a1", enabled: true }, { store_id: "b1", enabled: true }],
    routed_checkout_configs: [{ id: "r1", user_id: "alice", source_store_id: "a1", target_store_id: "a2" }],
    routed_checkout_targets: [{ route_id: "r1", target_store_id: "a2" }],
    ...extra,
  };
}

describe("conferirLigarRastreamento", () => {
  it("1 Loja com uma loja ligada: barra a segunda", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    const r = await conferirLigarRastreamento(db, "alice", "a2");
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
    if (!r.ok) expect(r.mensagem).toMatch(/1 loja com rastreamento/);
  });

  it("religar a loja que já está ligada passa", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    expect(await conferirLigarRastreamento(db, "alice", "a1")).toEqual({ ok: true });
  });

  it("3 Lojas deixa ligar a segunda e a terceira", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "lojas3" }));
    expect(await conferirLigarRastreamento(db, "alice", "a2")).toEqual({ ok: true });
  });

  it("admin e acesso liberado passam sempre", async () => {
    const cheio = { tracking_configs: [1, 2, 3, 4].map((n) => ({ store_id: `a${n}`, enabled: true })) };
    for (const perfil of [{ is_admin: true }, { access_granted: true, plan: "free" }]) {
      const { db } = bancoFalso(conta(perfil, cheio));
      expect(await conferirLigarRastreamento(db, "alice", "a5")).toEqual({ ok: true });
    }
  });

  it("assinante antigo, sem tier e sem a coluna plano: limites do 1 Loja", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", payment_provider: "stripe" }), { semColunaPlano: true });
    const r = await conferirLigarRastreamento(db, "alice", "a2");
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("não conta loja de outro dono", async () => {
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { tracking_configs: [{ store_id: "b1", enabled: true }] })
    );
    expect(await conferirLigarRastreamento(db, "alice", "a1")).toEqual({ ok: true });
  });

  it("loja desinstalada com o rastreamento ligado ocupa a vaga", async () => {
    // Desinstalou a1 (que seguia ligada), quer ligar a2 e depois reinstalar a1.
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { tracking_configs: [{ store_id: "a5", enabled: true }] })
    );
    expect(await conferirLigarRastreamento(db, "alice", "a2")).toMatchObject({ ok: false, status: 403 });
  });

  it("ligar numa loja desinstalada também passa pelo limite", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    expect(await conferirLigarRastreamento(db, "alice", "a5")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("conferirRoteamento", () => {
  it("1 Loja: até 6 lojas no roteamento", async () => {
    const lojas = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, user_id: "alice", uninstalled_at: null }));
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const destinos = [1, 2, 3, 4].map((n) => ({ route_id: "r1", target_store_id: `s${n}` }));
    const base = conta({ plan: "pro", plano: "loja1" }, { stores: lojas, routed_checkout_configs: rotas, routed_checkout_targets: destinos });

    // 5 lojas hoje (s0..s4): a sexta entra, a setima nao.
    const { db } = bancoFalso(base);
    expect(await conferirRoteamento(db, "alice", { adicionar: ["s0", "s5"] })).toEqual({ ok: true });
    const comSeis = bancoFalso({ ...base, routed_checkout_targets: [...destinos, { route_id: "r1", target_store_id: "s5" }] });
    const r = await conferirRoteamento(comSeis.db, "alice", { adicionar: ["s0", "s6"] });
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
    if (!r.ok) expect(r.mensagem).toMatch(/até 6 lojas no roteamento/);
    // Loja que ja esta no roteamento nao conta de novo.
    expect(await conferirRoteamento(comSeis.db, "alice", { adicionar: ["s0", "s3"] })).toEqual({ ok: true });
  });

  it("trocar a loja de uma rota, no limite, passa", async () => {
    const lojas = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, user_id: "alice", uninstalled_at: null }));
    // 6 lojas: s0..s5. s1 e checkout de tres rotas.
    const rotas = [
      { id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" },
      { id: "r2", user_id: "alice", source_store_id: "s2", target_store_id: "s1" },
      { id: "r3", user_id: "alice", source_store_id: "s4", target_store_id: "s5" },
      { id: "r4", user_id: "alice", source_store_id: "s3", target_store_id: "s1" },
    ];
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { stores: lojas, routed_checkout_configs: rotas, routed_checkout_targets: [] })
    );
    // s5 sai, s6 entra: continua em 6.
    expect(
      await conferirRoteamento(db, "alice", { trocarRota: { id: "r3", source_store_id: "s4", target_store_id: "s6" } })
    ).toEqual({ ok: true });
    // s1 continua (r1, r4) e s6 entra: 7.
    expect(
      await conferirRoteamento(db, "alice", { trocarRota: { id: "r2", source_store_id: "s2", target_store_id: "s6" } })
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("loja desinstalada na rota conta: criar rota com ela e reinstalar não abre vaga", async () => {
    const lojas = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      user_id: "alice",
      uninstalled_at: i === 5 ? "2026-10-01T00:00:00Z" : null,
    }));
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const destinos = [1, 2, 3, 4, 5].map((n) => ({ route_id: "r1", target_store_id: `s${n}` }));
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { stores: lojas, routed_checkout_configs: rotas, routed_checkout_targets: destinos })
    );
    // s0..s5 = 6 (s5 desinstalada conta): a setima nao entra.
    expect(await conferirRoteamento(db, "alice", { adicionar: ["s0", "s6"] })).toMatchObject({ ok: false, status: 403 });
  });

  it("Ilimitado e admin nem leem o uso", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "ilimitado" }));
    expect(await conferirRoteamento(db, "alice", { adicionar: ["a3", "a4"] })).toEqual({ ok: true });
  });

  it("falha de leitura vira 503, nunca libera nem barra em silêncio", async () => {
    const quebrado = {
      from: () => {
        throw new Error("sem banco");
      },
    } as unknown as SupabaseClient;
    expect(await conferirRoteamento(quebrado, "alice", { adicionar: ["a3"] })).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

describe("lerUso e gravar o perfil", () => {
  it("conta as lojas da conta", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    const uso = await lerUso(db, "alice");
    expect([...uso.rastreamento]).toEqual(["a1"]);
    expect([...uso.roteamento].sort()).toEqual(["a1", "a2"]);
  });

  it("sem a coluna plano, grava o resto (quem pagou não fica sem o Pro)", async () => {
    const { db, updates } = bancoFalso(conta({ plan: "free" }), { semColunaPlano: true });
    const r = await atualizarPerfil(db, "alice", { plan: "pro", plano: "lojas3" });
    expect(r.error).toBeNull();
    expect(updates).toEqual([{ tabela: "profiles", patch: { plan: "pro" }, filtros: { id: "alice" } }]);
  });

  it("reconhece a coluna ausente na leitura (42703) e na escrita (PGRST204)", () => {
    expect(semColunaPlano({ code: "42703", message: "column profiles.plano does not exist" })).toBe(true);
    expect(
      semColunaPlano({ code: "PGRST204", message: "Could not find the 'plano' column of 'profiles' in the schema cache" })
    ).toBe(true);
    // Outra coluna, ou outro erro: nao e o caso da 064.
    expect(semColunaPlano({ code: "PGRST204", message: "Could not find the 'nome' column" })).toBe(false);
    expect(semColunaPlano({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(semColunaPlano(null)).toBe(false);
  });

  it("lerComPlano tenta com a coluna e, sem ela, lê sem", async () => {
    const pedidos: string[] = [];
    const r = await lerComPlano(async (plano) => {
      pedidos.push(plano);
      return plano
        ? { data: null, error: { code: "42703", message: "column profiles.plano does not exist" } }
        : { data: [{ plan: "pro" }], error: null };
    });
    expect(pedidos).toEqual([", plano", ""]);
    expect(r.data).toEqual([{ plan: "pro" }]);
  });
});
