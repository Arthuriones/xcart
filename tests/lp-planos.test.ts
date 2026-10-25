import { describe, expect, it } from "vitest";
import { PLANOS as PLANOS_COBRADOS, type LimitesPlano } from "@/lib/billing/plans";
import {
  NOTA_DO_PRECO,
  PACOTES_EM_TEXTO,
  PLANOS,
  POLITICA_TESTE,
  especificacoesDoPlano,
  recursosDoCartao,
  valorEmPartes,
} from "@/app/lp/plano";

// O cartao curto da landing (redesign de 24/10/2026): quatro especificacoes e
// tres recursos por plano, todos saidos dos LIMITES do plano em
// src/lib/billing/plans.ts. Mudou o limite, o texto muda junto; mudou o texto
// sem mudar o limite, este teste para.

const NBSP = / /g;
const limpo = (s: string) => s.replace(NBSP, " ");

const linhas = (p: (typeof PLANOS)[number]) =>
  p.especificacoes.map((e) => [e.rotulo, e.valor, e.incluso] as const);

describe("cartões de preço da landing", () => {
  it("Roteamento: rastreamento em 1 operação, 1 vitrine, 1 checkout, checkout fixo", () => {
    const p = PLANOS.find((x) => x.id === "roteamento")!;
    expect(linhas(p)).toEqual([
      ["Rastreamento", "1 operação", true],
      ["Vitrines", "1", true],
      ["Lojas de checkout", "1", true],
      ["Rodízio", "Checkout fixo", true],
    ]);
    expect(p.recursos).toEqual([
      "Compras no Meta, TikTok e Google",
      "Lucro por loja e aba Campanhas",
      "Checkouts externos (Cakto, Hubla e Sphere)",
    ]);
  });

  it("Completo: até 5 de tudo, rodízio com teto e 'Tudo do' Roteamento", () => {
    const p = PLANOS.find((x) => x.id === "completo")!;
    expect(linhas(p)).toEqual([
      ["Rastreamento", "Até 5 operações", true],
      ["Vitrines", "Até 5", true],
      ["Lojas de checkout", "Até 5", true],
      ["Rodízio", "Com teto por dia", true],
    ]);
    expect(p.recursos).toEqual([
      "Tudo do Roteamento",
      "Rastreamento em até 5 operações",
      "Rodízio entre até 5 lojas de checkout",
    ]);
  });

  it("Ilimitado: sem limite e 'Tudo do' o plano anterior da lista", () => {
    const p = PLANOS.find((x) => x.id === "ilimitado_v2")!;
    expect(linhas(p)).toEqual([
      ["Rastreamento", "Sem limite", true],
      ["Vitrines", "Sem limite", true],
      ["Lojas de checkout", "Sem limite", true],
      ["Rodízio", "Com teto por dia", true],
    ]);
    expect(p.recursos).toEqual([
      "Tudo do Completo",
      "Rastreamento sem limite de operações",
      "Vitrines e checkouts sem teto",
    ]);
  });

  it("três recursos e quatro especificações em todo cartão, na ordem do catálogo", () => {
    expect(PLANOS.map((p) => p.id)).toEqual(PLANOS_COBRADOS.map((p) => p.id));
    for (const p of PLANOS) {
      expect(p.recursos).toHaveLength(3);
      expect(p.especificacoes.map((e) => e.rotulo)).toEqual([
        "Rastreamento",
        "Vitrines",
        "Lojas de checkout",
        "Rodízio",
      ]);
    }
  });

  it("preço em duas partes, sem mudar o número cobrado", () => {
    expect(PLANOS.map((p) => [p.inteiro, p.centavos])).toEqual([
      ["197", ",00"],
      ["497", ",00"],
      ["997", ",00"],
    ]);
    for (const p of PLANOS) expect(`${p.inteiro}${p.centavos}`).toBe(p.valor);
    expect(valorEmPartes("1.997,90")).toEqual({ inteiro: "1.997", centavos: ",90" });
    // Formato inesperado: tudo no inteiro, nunca outro valor.
    expect(valorEmPartes("197")).toEqual({ inteiro: "197", centavos: "" });
  });
});

describe("regras do cartão, com limites que nenhum plano tem hoje", () => {
  const base: LimitesPlano = { rastreamento: 0, vitrines: 1, checkouts: 1, roteamento: null };

  it("singular e plural no rastreamento", () => {
    const um = especificacoesDoPlano({ ...base, rastreamento: 1 });
    expect(um[0]).toEqual({ rotulo: "Rastreamento", valor: "1 operação", incluso: true });
    const tres = especificacoesDoPlano({ ...base, rastreamento: 3 });
    expect(tres[0].valor).toBe("Até 3 operações");
  });

  it("mais de uma loja de checkout já tem rodízio", () => {
    const e = especificacoesDoPlano({ ...base, checkouts: 2 });
    expect(e[2].valor).toBe("Até 2");
    expect(e[3].valor).toBe("Com teto por dia");
  });

  it("sem plano antes na lista, o ilimitado não cita 'Tudo do'", () => {
    const sozinho = { id: "ilimitado_v2" as const, nome: "Ilimitado", limites: { ...base, rastreamento: null } };
    expect(recursosDoCartao(sozinho, [sozinho])).toEqual([
      "Compras no Meta, TikTok e Google",
      "Lucro por loja e aba Campanhas",
      "Checkouts externos (Cakto, Hubla e Sphere)",
    ]);
  });

  it("rastreamento sem limite com roteamento limitado diz o limite real", () => {
    const lista = [
      { id: "roteamento" as const, nome: "Roteamento", limites: { ...base, rastreamento: 1, checkouts: 3 } },
      { id: "completo" as const, nome: "Completo", limites: base },
    ];
    const plano = { id: "completo" as const, limites: { rastreamento: null, vitrines: 5, checkouts: 5, roteamento: null } };
    const r = recursosDoCartao(plano, lista);
    expect(r[0]).toBe("Tudo do Roteamento");
    expect(r[1]).toBe("Rastreamento sem limite de operações");
    expect(r[2]).toBe("Até 5 vitrines e até 5 lojas de checkout no roteamento");
  });

  it("sem rastreamento, o cartão diz o roteamento; o seguinte, o que o rastreamento traz", () => {
    const sem = { id: "roteamento" as const, nome: "Roteamento", limites: base };
    const com = { id: "completo" as const, nome: "Completo", limites: { ...base, rastreamento: 5, checkouts: 5 } };
    expect(especificacoesDoPlano(sem.limites)[0]).toEqual({ rotulo: "Rastreamento", valor: "Não incluso", incluso: false });
    expect(recursosDoCartao(sem, [sem, com])).toEqual([
      "Roteamento pelo SKU",
      "Conserto automático do mapa de produtos",
      "Diagnóstico da rota",
    ]);
    expect(recursosDoCartao(com, [sem, com])).toEqual([
      "Compras no Meta, TikTok e Google",
      "Lucro por loja e aba Campanhas",
      "Checkouts externos (Cakto, Hubla e Sphere)",
    ]);
  });
});

describe("nota abaixo dos cartões", () => {
  it("teste, formas de pagamento e os pacotes de crédito do catálogo", () => {
    expect(limpo(PACOTES_EM_TEXTO)).toBe("50 por R$ 25,00, 200 por R$ 75,00 ou 500 por R$ 150,00");
    expect(limpo(NOTA_DO_PRECO)).toBe(
      `${POLITICA_TESTE.longa} Cartão de crédito, que renova sozinho todo mês, ou Pix, que libera 30 dias e não renova. Créditos de IA extras por Pix: 50 por R$ 25,00, 200 por R$ 75,00 ou 500 por R$ 150,00.`
    );
  });
});
