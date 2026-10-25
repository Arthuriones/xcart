import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acimaDoLimite,
  atualizarPerfil,
  bancoRecusouPlano,
  conferirLigarRastreamento,
  conferirRoteamento,
  ladosDoRoteamento,
  lerComPlano,
  lerUso,
  limitesDoPerfil,
  lojasComRastreamento,
  lojasNoRoteamento,
  mensagemDeLimite,
  passaDoLimite,
  planoAnteriorDaConta,
  resumoDoUso,
  semColunaPlano,
} from "@/lib/billing/limites";
import {
  PLANOS,
  PLANOS_ANTERIORES,
  cabeNoPlano,
  ehPlanoAVenda,
  ehPlanoId,
  planoDoValor,
  planoEmDestaque,
  planoQueCobre,
  precoMensalCentavos,
  PRO_PRICE_CENTS,
  resumoDosLimites,
  textoLimiteRastreamento,
  textoLimiteRoteamento,
} from "@/lib/billing/plans";

// Os planos (decisao de 24/10/2026):
//   Roteamento   R$ 197 -> 1 vitrine + 1 loja de checkout, rastreamento em 1 operacao (25/10)
//   Completo     R$ 497 -> ate 5 vitrines + 5 lojas de checkout, rastreamento em 5 operacoes
//   Ilimitado    R$ 997 -> sem limite
// Os anteriores (08/10/2026) sairam da venda e mantem preco e limite:
//   1 Loja     -> 1 com rastreamento, ate 6 lojas no roteamento (vitrines + checkouts)
//   3 Lojas    -> 3 e 12
//   Ilimitado  -> sem limite
// Pro antigo (sem tier) e conta sem assinatura: os limites do 1 Loja.
// Admin e acesso liberado: sem limite. Nada ligado acima do limite e desligado.

const FUTURO = "2999-01-01T00:00:00Z";
const PASSADO = "2000-01-01T00:00:00Z";
const SEM_LIMITE = { rastreamento: null, vitrines: null, checkouts: null, roteamento: null };
const usoDe = (u: Partial<Record<"rastreamento" | "vitrines" | "checkouts" | "roteamento", number>>) => ({
  rastreamento: 0,
  vitrines: 0,
  checkouts: 0,
  roteamento: 0,
  ...u,
});

describe("o catálogo de planos", () => {
  it("vende os três planos novos, com os preços e limites decididos", () => {
    expect(
      PLANOS.map((p) => [p.id, p.nome, p.precoCentavos, p.limites.rastreamento, p.limites.vitrines, p.limites.checkouts, p.limites.roteamento])
    ).toEqual([
      ["roteamento", "Roteamento", 19700, 1, 1, 1, null],
      ["completo", "Completo", 49700, 5, 5, 5, null],
      ["ilimitado_v2", "Ilimitado", 99700, null, null, null, null],
    ]);
    expect(PLANOS.every((p) => p.aVenda)).toBe(true);
    expect(planoEmDestaque().id).toBe("completo");
  });

  it("os anteriores ficam fora da venda com o mesmo preço e o mesmo limite de antes", () => {
    expect(
      PLANOS_ANTERIORES.map((p) => [p.id, p.precoCentavos, p.limites.rastreamento, p.limites.roteamento, p.aVenda])
    ).toEqual([
      ["loja1", 7990, 1, 6, false],
      ["lojas3", 11990, 3, 12, false],
      ["ilimitado", 16990, null, null, false],
    ]);
    // O teto deles era de lojas distintas, vitrine e checkout juntas.
    for (const p of PLANOS_ANTERIORES) expect([p.limites.vitrines, p.limites.checkouts]).toEqual([null, null]);
  });

  it("todo id conhecido é plano; só os novos estão à venda", () => {
    for (const id of ["roteamento", "completo", "ilimitado_v2", "loja1", "lojas3", "ilimitado"]) {
      expect(ehPlanoId(id)).toBe(true);
    }
    expect(["roteamento", "completo", "ilimitado_v2"].every(ehPlanoAVenda)).toBe(true);
    expect(["loja1", "lojas3", "ilimitado", "ouro", null].some(ehPlanoAVenda)).toBe(false);
    expect(ehPlanoId("ouro")).toBe(false);
  });

  it("reconhece o tier pelo valor cobrado, dos novos e dos anteriores, e não pelo R$ 89 antigo", () => {
    expect(planoDoValor(19700)).toBe("roteamento");
    expect(planoDoValor(49700)).toBe("completo");
    expect(planoDoValor(99700)).toBe("ilimitado_v2");
    expect(planoDoValor(7990)).toBe("loja1");
    expect(planoDoValor(11990)).toBe("lojas3");
    expect(planoDoValor(16990)).toBe("ilimitado");
    expect(planoDoValor(PRO_PRICE_CENTS)).toBeNull();
    expect(planoDoValor(undefined)).toBeNull();
    // Os precos nao se repetem: o valor diz um plano so.
    const precos = [...PLANOS, ...PLANOS_ANTERIORES].map((p) => p.precoCentavos);
    expect(new Set(precos).size).toBe(precos.length);
  });

  it("soma o MRR pelo preço de cada plano, os anteriores pelo preço deles e o Pro antigo pelos R$ 89", () => {
    expect(precoMensalCentavos({ plan: "pro", plano: "completo" })).toBe(49700);
    expect(precoMensalCentavos({ plan: "pro", plano: "lojas3" })).toBe(11990);
    expect(precoMensalCentavos({ plan: "pro", plano: "ilimitado" })).toBe(16990);
    expect(precoMensalCentavos({ plan: "pro", plano: null })).toBe(PRO_PRICE_CENTS);
    expect(precoMensalCentavos({ plan: "free", plano: "ilimitado_v2" })).toBe(0);
  });

  it("textos dos limites", () => {
    expect(textoLimiteRastreamento(0)).toBe("Sem rastreamento");
    expect(textoLimiteRastreamento(5)).toBe("Rastreamento em até 5 operações (loja ou checkout)");
    expect(textoLimiteRastreamento(1)).toBe("Rastreamento em 1 operação (loja ou checkout)");
    expect(textoLimiteRastreamento(null)).toBe("Rastreamento sem limite de operações");
    const [rota, completo, ilimitado] = PLANOS.map((p) => p.limites);
    expect(textoLimiteRoteamento(rota)).toBe("1 vitrine e 1 loja de checkout no roteamento");
    expect(textoLimiteRoteamento(completo)).toBe("Até 5 vitrines e até 5 lojas de checkout no roteamento");
    expect(textoLimiteRoteamento(ilimitado)).toBe("Roteamento sem limite de lojas");
    expect(textoLimiteRoteamento(PLANOS_ANTERIORES[0].limites)).toBe("Até 6 lojas no roteamento");
    expect(resumoDosLimites(rota)).toBe(
      "Rastreamento em 1 operação (loja ou checkout) · 1 vitrine e 1 loja de checkout no roteamento"
    );
    expect(resumoDosLimites(ilimitado)).toBe("Rastreamento e roteamento sem limite");
  });

  it("o plano que cobre um uso é o mais barato à venda onde tudo cabe", () => {
    expect(planoQueCobre(usoDe({ vitrines: 1, checkouts: 1, roteamento: 2 }))?.id).toBe("roteamento");
    expect(planoQueCobre(usoDe({ rastreamento: 1, vitrines: 1, checkouts: 1, roteamento: 2 }))?.id).toBe("roteamento");
    expect(planoQueCobre(usoDe({ rastreamento: 2, vitrines: 1, checkouts: 1, roteamento: 2 }))?.id).toBe("completo");
    expect(planoQueCobre(usoDe({ vitrines: 2, checkouts: 1, roteamento: 3 }))?.id).toBe("completo");
    expect(planoQueCobre(usoDe({ vitrines: 6, checkouts: 1, roteamento: 7 }))?.id).toBe("ilimitado_v2");
    expect(planoQueCobre(usoDe({ rastreamento: 6 }))?.id).toBe("ilimitado_v2");
    // 11 lojas distintas nao cabem em 5 vitrines + 5 checkouts.
    expect(cabeNoPlano(PLANOS[1].limites, usoDe({ roteamento: 11 }))).toBe(false);
    expect(cabeNoPlano(PLANOS[1].limites, usoDe({ roteamento: 10 }))).toBe(true);
  });
});

describe("limitesDoPerfil", () => {
  it("admin e acesso liberado não têm limite", () => {
    for (const p of [{ is_admin: true }, { access_granted: true, plan: "free" }]) {
      expect(limitesDoPerfil(p)).toEqual({ origem: "liberado", plano: null, ...SEM_LIMITE });
    }
  });

  it("cada plano novo vale o seu limite", () => {
    expect(limitesDoPerfil({ plan: "pro", plano: "roteamento" })).toEqual({
      origem: "plano",
      plano: "roteamento",
      rastreamento: 1,
      vitrines: 1,
      checkouts: 1,
      roteamento: null,
    });
    expect(limitesDoPerfil({ plan: "pro", plano: "completo" })).toMatchObject({
      origem: "plano",
      rastreamento: 5,
      vitrines: 5,
      checkouts: 5,
      roteamento: null,
    });
    expect(limitesDoPerfil({ plan: "pro", plano: "ilimitado_v2" })).toMatchObject({ origem: "plano", ...SEM_LIMITE });
  });

  it("os planos anteriores valem o limite de antes", () => {
    expect(limitesDoPerfil({ plan: "pro", plano: "loja1" })).toMatchObject({
      origem: "plano",
      rastreamento: 1,
      vitrines: null,
      checkouts: null,
      roteamento: 6,
    });
    expect(limitesDoPerfil({ plan: "pro", plano: "lojas3" })).toMatchObject({ origem: "plano", rastreamento: 3, roteamento: 12 });
    expect(limitesDoPerfil({ plan: "pro", plano: "ilimitado" })).toMatchObject(SEM_LIMITE);
  });

  it("quem já assinava sem tier (Stripe ou R$ 89) fica com os limites do 1 Loja", () => {
    const stripe = limitesDoPerfil({ plan: "pro", plano: null, payment_provider: "stripe" });
    expect(stripe).toEqual({ origem: "legado", plano: "loja1", rastreamento: 1, vitrines: null, checkouts: null, roteamento: 6 });
    // Coluna ainda ausente (migration 064 nao aplicada): igual.
    expect(limitesDoPerfil({ plan: "pro" })).toMatchObject({ origem: "legado", rastreamento: 1 });
  });

  it("sem assinatura, e com o Pix de 30 dias vencido, valem os limites do 1 Loja", () => {
    expect(limitesDoPerfil({ plan: "free" })).toMatchObject({ origem: "sem_plano", rastreamento: 1, roteamento: 6 });
    expect(limitesDoPerfil(null)).toMatchObject({ origem: "sem_plano", rastreamento: 1 });
    const pixVencido = {
      plan: "pro",
      plano: "ilimitado_v2",
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

describe("planoAnteriorDaConta (renovar por Pix pelo mesmo preço)", () => {
  const pix = { plan: "pro", payment_provider: "pagou", pagou_subscription_id: null, current_period_end: FUTURO };

  it("quem tem um plano anterior valendo renova nele", () => {
    expect(planoAnteriorDaConta({ ...pix, plano: "lojas3" })).toBe("lojas3");
    expect(planoAnteriorDaConta({ ...pix, plano: "ilimitado" })).toBe("ilimitado");
    // O Pro antigo, sem tier: no 1 Loja, com os mesmos limites.
    expect(planoAnteriorDaConta({ ...pix, plano: null })).toBe("loja1");
  });

  it("plano à venda, Pix vencido ou sem assinatura não abrem plano anterior", () => {
    expect(planoAnteriorDaConta({ ...pix, plano: "completo" })).toBeNull();
    expect(planoAnteriorDaConta({ ...pix, plano: "lojas3", current_period_end: PASSADO })).toBeNull();
    expect(planoAnteriorDaConta({ plan: "free", plano: "lojas3" })).toBeNull();
    expect(planoAnteriorDaConta(null)).toBeNull();
  });
});

describe("contagem de lojas", () => {
  const donas = new Set(["v1", "c1", "c2", "c3", "v2", "desinstalada"]);

  it("roteamento: vitrine + lojas de checkout, distintas, e cada lado a parte", () => {
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
    const lados = ladosDoRoteamento(rotas, destinos, donas);
    expect([...lados.vitrines].sort()).toEqual(["v1", "v2"]);
    expect([...lados.checkouts].sort()).toEqual(["c1", "c2"]);
  });

  it("rota sem linha de destino conta a loja de checkout da própria rota", () => {
    const rotas = [{ id: "r1", source_store_id: "v1", target_store_id: "c3" }];
    expect([...lojasNoRoteamento(rotas, [], donas)].sort()).toEqual(["c3", "v1"]);
    expect([...ladosDoRoteamento(rotas, [], donas).checkouts]).toEqual(["c3"]);
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

  it("limite 0 barra a primeira", () => {
    expect(passaDoLimite(de(), de("a"), 0)).toBe(true);
  });

  it("deixa entrar até o limite", () => {
    expect(passaDoLimite(de("a"), de("a", "b", "c"), 3)).toBe(false);
  });

  it("quem já está acima segue com o que tem, mas não liga loja nova", () => {
    // Plano mudou para baixo: 4 ligadas num limite de 1.
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c", "d"), 1)).toBe(false);
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c"), 1)).toBe(false);
    expect(passaDoLimite(de("a", "b", "c", "d"), de("a", "b", "c", "d", "e"), 1)).toBe(true);
    // E num limite 0 (plano sem rastreamento): a que ja estava ligada segue.
    expect(passaDoLimite(de("a"), de("a"), 0)).toBe(false);
  });

  it("trocar uma loja por outra no limite passa", () => {
    expect(passaDoLimite(de("a", "b"), de("a", "c"), 2)).toBe(false);
  });

  it("sem limite, nunca barra", () => {
    expect(passaDoLimite(de(), de("a", "b", "c"), null)).toBe(false);
  });
});

describe("mensagens", () => {
  it("o Roteamento rastreia 1 operação e aponta o Completo", () => {
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "pro", plano: "roteamento" }))).toBe(
      "Seu plano cobre 1 operação com rastreamento (loja ou checkout). Para ligar mais, mude para o Completo em Assinatura."
    );
  });

  it("limite 0 de rastreamento diz que não inclui e aponta o primeiro plano que inclui", () => {
    const zero = { origem: "plano" as const, plano: null, rastreamento: 0, vitrines: 1, checkouts: 1, roteamento: null };
    expect(mensagemDeLimite("rastreamento", zero)).toBe(
      "Seu plano não inclui rastreamento. O Roteamento inclui 1 operação. Mude em Assinatura."
    );
  });

  it("vitrines e lojas de checkout dizem o que o plano cobre e para onde ir", () => {
    const rota = limitesDoPerfil({ plan: "pro", plano: "roteamento" });
    expect(mensagemDeLimite("vitrines", rota)).toBe(
      "Seu plano cobre 1 vitrine no roteamento. Para usar mais vitrines, mude para o Completo em Assinatura."
    );
    expect(mensagemDeLimite("checkouts", rota)).toBe(
      "Seu plano cobre 1 loja de checkout no roteamento. Para usar mais lojas de checkout, mude para o Completo em Assinatura."
    );
    const completo = limitesDoPerfil({ plan: "pro", plano: "completo" });
    expect(mensagemDeLimite("vitrines", completo)).toBe(
      "Seu plano cobre até 5 vitrines no roteamento. Para usar mais vitrines, mude para o Ilimitado em Assinatura."
    );
    expect(mensagemDeLimite("rastreamento", completo)).toBe(
      "Seu plano cobre até 5 operações com rastreamento (loja ou checkout). Para ligar mais, mude para o Ilimitado em Assinatura."
    );
  });

  it("o plano sugerido é onde TODO o uso depois da mudança cabe", () => {
    const rota = limitesDoPerfil({ plan: "pro", plano: "roteamento" });
    // Quer a 2a vitrine, mas ja tem 6 lojas de checkout (o plano mudou para baixo).
    expect(mensagemDeLimite("vitrines", rota, usoDe({ vitrines: 2, checkouts: 6, roteamento: 8 }))).toMatch(
      /mude para o Ilimitado em Assinatura\.$/
    );
  });

  it("os anteriores e a conta sem assinatura", () => {
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "pro", plano: "loja1" }))).toBe(
      "Seu plano cobre 1 operação com rastreamento (loja ou checkout). Para ligar mais, mude para o Completo em Assinatura."
    );
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "pro", plano: "lojas3" }))).toBe(
      "Seu plano cobre até 3 operações com rastreamento (loja ou checkout). Para ligar mais, mude para o Completo em Assinatura."
    );
    expect(mensagemDeLimite("roteamento", limitesDoPerfil({ plan: "pro", plano: "loja1" }))).toBe(
      "Seu plano cobre até 6 lojas no roteamento. Para usar mais lojas, mude para o Completo em Assinatura."
    );
    // 13 lojas distintas nao cabem em 5 + 5.
    expect(mensagemDeLimite("roteamento", limitesDoPerfil({ plan: "pro", plano: "lojas3" }))).toMatch(
      /até 12 lojas no roteamento\. Para usar mais lojas, mude para o Ilimitado/
    );
    expect(mensagemDeLimite("rastreamento", limitesDoPerfil({ plan: "free" }))).toMatch(
      /^Sem assinatura, o xcart cobre 1 operação com rastreamento \(loja ou checkout\)\. Para ligar mais, assine o Completo/
    );
  });

  it("resumo do uso na tela de Assinatura", () => {
    const [rota, completo, ilimitado] = PLANOS.map((p) => p.limites);
    expect(resumoDoUso(rota, usoDe({ rastreamento: 1, vitrines: 1, checkouts: 1, roteamento: 2 }))).toBe(
      "1/1 operação com rastreamento · 1/1 vitrine e 1/1 loja de checkout no roteamento"
    );
    expect(resumoDoUso({ ...rota, rastreamento: 0 }, usoDe({ vitrines: 1 }))).toBe(
      "Rastreamento não incluso · 1/1 vitrine e 0/1 loja de checkout no roteamento"
    );
    expect(resumoDoUso(completo, usoDe({ rastreamento: 2, vitrines: 1, checkouts: 3, roteamento: 4 }))).toBe(
      "2/5 operações com rastreamento · 1/5 vitrines e 3/5 lojas de checkout no roteamento"
    );
    expect(resumoDoUso(ilimitado, usoDe({ rastreamento: 1, vitrines: 2, checkouts: 4, roteamento: 6 }))).toBe(
      "1 operação com rastreamento · 2 vitrines e 4 lojas de checkout no roteamento"
    );
    const loja1 = PLANOS_ANTERIORES[0].limites;
    expect(resumoDoUso(loja1, usoDe({ rastreamento: 1, vitrines: 1, checkouts: 1, roteamento: 2 }))).toBe(
      "1/1 operação com rastreamento · 2/6 lojas no roteamento"
    );
    expect(acimaDoLimite(loja1, usoDe({ rastreamento: 2 }))).toBe(true);
    expect(acimaDoLimite(loja1, usoDe({ rastreamento: 1, roteamento: 6 }))).toBe(false);
    expect(acimaDoLimite(rota, usoDe({ rastreamento: 1 }))).toBe(false);
    expect(acimaDoLimite(rota, usoDe({ rastreamento: 2 }))).toBe(true);
    expect(acimaDoLimite(rota, usoDe({ vitrines: 2 }))).toBe(true);
    expect(acimaDoLimite(completo, usoDe({ rastreamento: 5, vitrines: 5, checkouts: 5, roteamento: 10 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// As travas contra um banco em memoria
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function bancoFalso(
  tabelas: Record<string, Linha[]>,
  opcoes: { semColunaPlano?: boolean; checkAntigo?: boolean } = {}
) {
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
        // O CHECK da 064 (sem a 078) nao conhece os planos novos.
        if (opcoes.checkAntigo && "plano" in patch && !["loja1", "lojas3", "ilimitado", null].includes(patch.plano as string)) {
          return {
            data: null,
            error: {
              code: "23514",
              message: 'new row for relation "profiles" violates check constraint "profiles_plano_check"',
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

/** n lojas de Alice: s0..s{n-1}. */
const lojasDeAlice = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, user_id: "alice", uninstalled_at: null }));

describe("conferirLigarRastreamento", () => {
  it("1 Loja (anterior) com uma loja ligada: barra a segunda", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    const r = await conferirLigarRastreamento(db, "alice", "a2");
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
    if (!r.ok) expect(r.mensagem).toMatch(/1 operação com rastreamento/);
  });

  it("religar a loja que já está ligada passa", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    expect(await conferirLigarRastreamento(db, "alice", "a1")).toEqual({ ok: true });
  });

  it("3 Lojas (anterior) deixa ligar a segunda e a terceira", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "lojas3" }));
    expect(await conferirLigarRastreamento(db, "alice", "a2")).toEqual({ ok: true });
  });

  it("Roteamento liga o rastreamento em 1 operação, loja ou checkout", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "roteamento" }, { tracking_configs: [] }));
    for (const alvo of ["a1", { checkoutId: "ck1" }]) {
      expect(await conferirLigarRastreamento(db, "alice", alvo)).toEqual({ ok: true });
    }
  });

  it("Roteamento com uma operação ligada barra a segunda, em loja e em checkout", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "roteamento" }));
    expect(await conferirLigarRastreamento(db, "alice", "a1")).toEqual({ ok: true });
    for (const alvo of ["a2", { checkoutId: "ck1" }]) {
      const r = await conferirLigarRastreamento(db, "alice", alvo);
      expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
      if (!r.ok) {
        expect(r.mensagem).toBe(
          "Seu plano cobre 1 operação com rastreamento (loja ou checkout). Para ligar mais, mude para o Completo em Assinatura."
        );
      }
    }
  });

  it("Completo: até 5 operações, lojas e checkouts juntos; a sexta é recusada", async () => {
    const cinco = {
      tracking_configs: [1, 2, 3, 4].map((n) => ({ store_id: `a${n}`, enabled: true })),
      checkout_externo_destinos: [{ checkout_id: "ck1", user_id: "alice", ativo: true }],
    };
    const { db } = bancoFalso(conta({ plan: "pro", plano: "completo" }, cinco));
    const r = await conferirLigarRastreamento(db, "alice", "a5");
    expect(r).toMatchObject({ ok: false, status: 403 });
    if (!r.ok) expect(r.mensagem).toMatch(/até 5 operações com rastreamento.*Ilimitado/);
    expect(await conferirLigarRastreamento(db, "alice", { checkoutId: "ck2" })).toMatchObject({ ok: false });
    // Com 4, a quinta entra.
    const quatro = bancoFalso(conta({ plan: "pro", plano: "completo" }, { ...cinco, checkout_externo_destinos: [] }));
    expect(await conferirLigarRastreamento(quatro.db, "alice", { checkoutId: "ck1" })).toEqual({ ok: true });
  });

  it("Ilimitado, admin e acesso liberado passam sempre", async () => {
    const cheio = { tracking_configs: [1, 2, 3, 4].map((n) => ({ store_id: `a${n}`, enabled: true })) };
    for (const perfil of [{ is_admin: true }, { access_granted: true, plan: "free" }, { plan: "pro", plano: "ilimitado_v2" }]) {
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
  it("Roteamento: 1 vitrine e 1 loja de checkout; a 2a vitrine e o 2o checkout são recusados", async () => {
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const base = conta(
      { plan: "pro", plano: "roteamento" },
      { stores: lojasDeAlice(4), routed_checkout_configs: rotas, routed_checkout_targets: [{ route_id: "r1", target_store_id: "s1" }] }
    );
    const { db } = bancoFalso(base);
    // Mexer na rota que ja existe (mesmas lojas) passa.
    expect(await conferirRoteamento(db, "alice", { vitrine: "s0", checkout: "s1" })).toEqual({ ok: true });
    const vitrine = await conferirRoteamento(db, "alice", { vitrine: "s2", checkout: "s1" });
    expect(vitrine).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
    if (!vitrine.ok) expect(vitrine.mensagem).toMatch(/^Seu plano cobre 1 vitrine no roteamento\..*Completo/);
    const checkout = await conferirRoteamento(db, "alice", { vitrine: "s0", checkout: "s2" });
    expect(checkout).toMatchObject({ ok: false, status: 403 });
    if (!checkout.ok) expect(checkout.mensagem).toMatch(/^Seu plano cobre 1 loja de checkout no roteamento\..*Completo/);
    // Conta vazia: a primeira rota entra.
    const vazia = bancoFalso({ ...base, routed_checkout_configs: [], routed_checkout_targets: [] });
    expect(await conferirRoteamento(vazia.db, "alice", { vitrine: "s2", checkout: "s3" })).toEqual({ ok: true });
  });

  it("Completo: até 5 vitrines e 5 lojas de checkout; a 6a de cada é recusada", async () => {
    // 5 rotas: vitrines s0..s4, checkouts s10..s14.
    const lojas = lojasDeAlice(20);
    const rotas = [0, 1, 2, 3, 4].map((n) => ({ id: `r${n}`, user_id: "alice", source_store_id: `s${n}`, target_store_id: `s${n + 10}` }));
    const base = conta({ plan: "pro", plano: "completo" }, { stores: lojas, routed_checkout_configs: rotas, routed_checkout_targets: [] });
    const { db } = bancoFalso(base);
    const sextaVitrine = await conferirRoteamento(db, "alice", { vitrine: "s5", checkout: "s10" });
    expect(sextaVitrine).toMatchObject({ ok: false, status: 403 });
    if (!sextaVitrine.ok) expect(sextaVitrine.mensagem).toMatch(/até 5 vitrines.*Ilimitado/);
    const sextoCheckout = await conferirRoteamento(db, "alice", { vitrine: "s0", checkout: "s15" });
    expect(sextoCheckout).toMatchObject({ ok: false, status: 403 });
    if (!sextoCheckout.ok) expect(sextoCheckout.mensagem).toMatch(/até 5 lojas de checkout.*Ilimitado/);
    // Uma vitrine nova com um checkout que ja esta na conta: so a vitrine conta.
    const quatro = bancoFalso({ ...base, routed_checkout_configs: rotas.slice(0, 4) });
    expect(await conferirRoteamento(quatro.db, "alice", { vitrine: "s5", checkout: "s10" })).toEqual({ ok: true });
  });

  it("Ilimitado (novo e anterior) e admin nem leem o uso", async () => {
    for (const perfil of [{ plan: "pro", plano: "ilimitado_v2" }, { plan: "pro", plano: "ilimitado" }, { is_admin: true }]) {
      const { db } = bancoFalso(conta(perfil, { stores: lojasDeAlice(30) }));
      expect(await conferirRoteamento(db, "alice", { vitrine: "s20", checkout: "s21" })).toEqual({ ok: true });
    }
  });

  it("1 Loja (anterior): até 6 lojas no roteamento, vitrines e checkouts juntas", async () => {
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const destinos = [1, 2, 3, 4].map((n) => ({ route_id: "r1", target_store_id: `s${n}` }));
    const base = conta({ plan: "pro", plano: "loja1" }, { stores: lojasDeAlice(8), routed_checkout_configs: rotas, routed_checkout_targets: destinos });

    // 5 lojas hoje (s0..s4): a sexta entra, a setima nao.
    const { db } = bancoFalso(base);
    expect(await conferirRoteamento(db, "alice", { vitrine: "s0", checkout: "s5" })).toEqual({ ok: true });
    const comSeis = bancoFalso({ ...base, routed_checkout_targets: [...destinos, { route_id: "r1", target_store_id: "s5" }] });
    const r = await conferirRoteamento(comSeis.db, "alice", { vitrine: "s0", checkout: "s6" });
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
    if (!r.ok) expect(r.mensagem).toMatch(/até 6 lojas no roteamento/);
    // Loja que ja esta no roteamento nao conta de novo.
    expect(await conferirRoteamento(comSeis.db, "alice", { vitrine: "s0", checkout: "s3" })).toEqual({ ok: true });
    // Vitrine nova tambem conta no mesmo teto (o 1 Loja nao separa os lados).
    expect(await conferirRoteamento(comSeis.db, "alice", { vitrine: "s7", checkout: "s1" })).toMatchObject({ ok: false });
  });

  it("trocar a loja de uma rota, no limite, passa", async () => {
    // 6 lojas: s0..s5. s1 e checkout de tres rotas.
    const rotas = [
      { id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" },
      { id: "r2", user_id: "alice", source_store_id: "s2", target_store_id: "s1" },
      { id: "r3", user_id: "alice", source_store_id: "s4", target_store_id: "s5" },
      { id: "r4", user_id: "alice", source_store_id: "s3", target_store_id: "s1" },
    ];
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { stores: lojasDeAlice(8), routed_checkout_configs: rotas, routed_checkout_targets: [] })
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

  it("Roteamento: trocar a loja de checkout da única rota passa", async () => {
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "roteamento" }, { stores: lojasDeAlice(4), routed_checkout_configs: rotas, routed_checkout_targets: [] })
    );
    expect(
      await conferirRoteamento(db, "alice", { trocarRota: { id: "r1", source_store_id: "s0", target_store_id: "s2" } })
    ).toEqual({ ok: true });
  });

  it("loja desinstalada na rota conta: criar rota com ela e reinstalar não abre vaga", async () => {
    const lojas = lojasDeAlice(8).map((l, i) => ({ ...l, uninstalled_at: i === 5 ? "2026-10-01T00:00:00Z" : null }));
    const rotas = [{ id: "r1", user_id: "alice", source_store_id: "s0", target_store_id: "s1" }];
    const destinos = [1, 2, 3, 4, 5].map((n) => ({ route_id: "r1", target_store_id: `s${n}` }));
    const { db } = bancoFalso(
      conta({ plan: "pro", plano: "loja1" }, { stores: lojas, routed_checkout_configs: rotas, routed_checkout_targets: destinos })
    );
    // s0..s5 = 6 (s5 desinstalada conta): a setima nao entra.
    expect(await conferirRoteamento(db, "alice", { vitrine: "s0", checkout: "s6" })).toMatchObject({ ok: false, status: 403 });
  });

  it("falha de leitura vira 503, nunca libera nem barra em silêncio", async () => {
    const quebrado = {
      from: () => {
        throw new Error("sem banco");
      },
    } as unknown as SupabaseClient;
    expect(await conferirRoteamento(quebrado, "alice", { vitrine: "a3" })).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

describe("lerUso e gravar o perfil", () => {
  it("conta as lojas da conta, e cada lado do roteamento", async () => {
    const { db } = bancoFalso(conta({ plan: "pro", plano: "loja1" }));
    const uso = await lerUso(db, "alice");
    expect([...uso.rastreamento]).toEqual(["a1"]);
    expect([...uso.roteamento].sort()).toEqual(["a1", "a2"]);
    expect([...uso.vitrines]).toEqual(["a1"]);
    expect([...uso.checkouts]).toEqual(["a2"]);
  });

  it("sem a coluna plano, grava o resto (quem pagou não fica sem o Pro)", async () => {
    const { db, updates } = bancoFalso(conta({ plan: "free" }), { semColunaPlano: true });
    const r = await atualizarPerfil(db, "alice", { plan: "pro", plano: "lojas3" });
    expect(r.error).toBeNull();
    expect(updates).toEqual([{ tabela: "profiles", patch: { plan: "pro" }, filtros: { id: "alice" } }]);
  });

  it("com o CHECK antigo (078 pendente), grava o plano anterior e, no novo, o resto", async () => {
    const antigo = bancoFalso(conta({ plan: "free" }), { checkAntigo: true });
    await atualizarPerfil(antigo.db, "alice", { plan: "pro", plano: "lojas3" });
    expect(antigo.updates.at(-1)?.patch).toEqual({ plan: "pro", plano: "lojas3" });
    const novo = bancoFalso(conta({ plan: "free" }), { checkAntigo: true });
    const r = await atualizarPerfil(novo.db, "alice", { plan: "pro", plano: "completo" });
    expect(r.error).toBeNull();
    expect(novo.updates).toEqual([{ tabela: "profiles", patch: { plan: "pro" }, filtros: { id: "alice" } }]);
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

  it("reconhece o CHECK do plano recusando (23514), e só ele", () => {
    const check = { code: "23514", message: 'new row for relation "profiles" violates check constraint "profiles_plano_check"' };
    expect(bancoRecusouPlano(check)).toBe(true);
    expect(bancoRecusouPlano({ code: "PGRST204", message: "Could not find the 'plano' column" })).toBe(true);
    expect(bancoRecusouPlano({ code: "23514", message: 'violates check constraint "profiles_ai_credits_check"' })).toBe(false);
    expect(bancoRecusouPlano({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(bancoRecusouPlano(null)).toBe(false);
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
