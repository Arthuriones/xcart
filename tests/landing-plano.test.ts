import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  PLANOS as PLANOS_COBRADOS,
  PRO_INCLUDED_CREDITS,
} from "@/lib/billing/plans";
import { BENEFICIOS_PRO } from "@/components/billing/beneficios";
import { PACOTES, PLANOS, POLITICA_TESTE, PRECO_A_PARTIR } from "@/app/lp/plano";
import {
  COMPARACAO,
  CONECTA_COM,
  OUTROS_RECURSOS,
  PASSOS,
  PERGUNTAS,
  PROBLEMAS,
  PROBLEMA_FECHO,
  PROVAS,
  RECURSOS_PRINCIPAIS,
  ROTEAMENTO,
} from "@/app/lp/conteudo";

// A landing nao escreve numero a mao: preco, creditos e pacotes saem do
// arquivo que cobra. E vende primeiro Lucro, Rastreamento e Alertas.

const NBSP = / /g;
const limpo = (s: string) => s.replace(NBSP, " ");

const emReais = (c: number) => `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`;

describe("preço na landing", () => {
  it("os três planos saem do catálogo que cobra, com centavos e no formato do Brasil", () => {
    expect(PLANOS.map((p) => p.id)).toEqual(PLANOS_COBRADOS.map((p) => p.id));
    for (const [i, p] of PLANOS.entries()) {
      const cobrado = PLANOS_COBRADOS[i];
      expect(p.nome).toBe(cobrado.nome);
      expect(p.valor).toBe(emReais(cobrado.precoCentavos));
      expect(p.selo ?? null).toBe(cobrado.selo);
    }
    expect(PLANOS.map((p) => p.valor)).toEqual(["79,90", "119,90", "169,90"]);
    expect(limpo(PRECO_A_PARTIR)).toBe("R$ 79,90");
  });

  it("cada cartão abre com os limites reais de loja", () => {
    expect(PLANOS.map((p) => p.itens.slice(0, 2))).toEqual([
      ["1 loja com rastreamento.", "Até 6 lojas no roteamento."],
      ["3 lojas com rastreamento.", "Até 12 lojas no roteamento."],
      ["Rastreamento sem limite de lojas.", "Roteamento sem limite de lojas."],
    ]);
    for (const p of PLANOS) expect(p.itens.join(" ")).not.toMatch(/loja disponível|lojas disponíveis/);
  });

  it("mostra todos os pacotes, na mesma ordem, com centavos", () => {
    expect(PACOTES.map((p) => p.id)).toEqual(CREDIT_PACKS.map((p) => p.id));
    for (const [i, p] of PACOTES.entries()) {
      const c = CREDIT_PACKS[i].amountCents;
      expect(limpo(p.preco)).toMatch(/^R\$ [\d.]+,\d{2}$/);
      expect(limpo(p.preco).endsWith(`,${String(c % 100).padStart(2, "0")}`)).toBe(true);
    }
  });
});

// A landing le a mesma lista de /billing e do paywall (decisao 2).
describe("lista de benefícios do plano", () => {
  it("começa por lucro, rastreamento e alertas (decisão 2)", () => {
    expect(BENEFICIOS_PRO[0]).toMatch(/^Lucro/);
    expect(BENEFICIOS_PRO[1]).toMatch(/Meta e ao TikTok/);
    expect(BENEFICIOS_PRO[1]).toMatch(/Google/);
    expect(BENEFICIOS_PRO[2]).toMatch(/^Alertas/);
  });

  it("cita os créditos inclusos com o número do plano", () => {
    const comCreditos = BENEFICIOS_PRO.filter((b) => b.includes("créditos"));
    expect(comCreditos).toHaveLength(1);
    expect(comCreditos[0].startsWith(`${PRO_INCLUDED_CREDITS} créditos`)).toBe(true);
  });

  it("deixa o roteamento como módulo, depois de lucro, rastreamento e alertas", () => {
    expect(BENEFICIOS_PRO.findIndex((b) => /^Roteamento/.test(b))).toBeGreaterThan(2);
  });
});

describe("texto da landing", () => {
  const todos = [
    ...BENEFICIOS_PRO,
    ...RECURSOS_PRINCIPAIS.flatMap((r) => [r.titulo, r.resumo, ...r.pontos]),
    ...OUTROS_RECURSOS.flatMap((r) => [r.titulo, r.texto]),
    ...PERGUNTAS.flatMap((p) => [p.pergunta, p.resposta]),
    ...PROBLEMAS.flatMap((p) => [p.origem, p.titulo, p.texto]),
    PROBLEMA_FECHO,
    ...COMPARACAO.map((l) => l.item),
    ...PASSOS.flatMap((p) => [p.titulo, p.texto]),
    ...ROTEAMENTO,
    POLITICA_TESTE.curta,
    POLITICA_TESTE.longa,
  ];

  it("vende primeiro lucro, rastreamento e alertas", () => {
    expect(RECURSOS_PRINCIPAIS.map((r) => r.id)).toEqual(["lucro", "rastreamento", "alertas"]);
  });

  it("diz com clareza a política de teste, a mesma no hero e nas perguntas", () => {
    const resposta = PERGUNTAS.find((p) => /teste grátis/i.test(p.pergunta));
    expect(resposta?.resposta).toBe(POLITICA_TESTE.longa);
  });

  it("não traz plural com (s), nem moeda em dólar", () => {
    for (const t of todos) {
      expect(t).not.toMatch(/\(s\)/);
      expect(t).not.toMatch(/\$\s?\d|US\$|USD/);
    }
  });

  it("cita o TikTok Ads entre as integrações", () => {
    expect(CONECTA_COM).toContain("TikTok Ads");
  });

  it("não inventa prova social", () => {
    expect(PROVAS).toEqual([]);
  });
});
