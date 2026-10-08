import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  PRO_INCLUDED_CREDITS,
  PRO_PRICE_CENTS,
} from "@/lib/billing/plans";
import { BENEFICIOS_PRO } from "@/components/billing/beneficios";
import { PACOTES, POLITICA_TESTE, PRECO_PRO } from "@/app/lp/plano";
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

describe("preço na landing", () => {
  it("sai do plano que cobra, com centavos e no formato do Brasil", () => {
    const reais = Math.floor(PRO_PRICE_CENTS / 100);
    const centavos = String(PRO_PRICE_CENTS % 100).padStart(2, "0");
    expect(limpo(PRECO_PRO)).toBe(`R$ ${reais},${centavos}`);
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
