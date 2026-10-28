import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  PLANOS as PLANOS_COBRADOS,
  PRO_INCLUDED_CREDITS,
} from "@/lib/billing/plans";
import { recursosDoPlano } from "@/components/billing/beneficios";
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

// A landing nao escreve numero a mao: preco, limites, creditos e pacotes saem
// do arquivo que cobra. O cartao curto de cada plano (especificacoes e os tres
// recursos) e travado em lp-planos.test.ts. E vende primeiro Lucro,
// Rastreamento e Alertas.

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
    expect(PLANOS.map((p) => [p.id, p.nome, p.valor])).toEqual([
      ["roteamento", "Roteamento", "197,00"],
      ["completo", "Completo", "497,00"],
      ["ilimitado_v2", "Ilimitado", "997,00"],
    ]);
    expect(limpo(PRECO_A_PARTIR)).toBe("R$ 197,00");
    // O em destaque e o Completo; os planos anteriores nao aparecem.
    expect(PLANOS.filter((p) => p.destaque).map((p) => p.id)).toEqual(["completo"]);
    expect(PLANOS.map((p) => p.id)).not.toContain("lojas3");
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

// A lista completa de /billing e do paywall (recursosDoPlano). A landing mostra
// so o cartao curto, que sai dos mesmos limites.
describe("o que cada plano inclui", () => {
  it("o rastreamento diz por onde cada rede recebe (Google pela tag)", () => {
    const comRastreio = recursosDoPlano(PLANOS_COBRADOS[1].limites);
    const linha = comRastreio.find((b) => /^Rastreamento/.test(b));
    expect(linha).toMatch(/Meta e ao TikTok pelo servidor/);
    expect(linha).toMatch(/Google pela tag/);
  });

  it("cita as fotos com IA inclusas com o número do plano, uma vez em cada plano", () => {
    for (const p of PLANOS_COBRADOS) {
      const comCreditos = recursosDoPlano(p.limites).filter((b) => b.includes("fotos com IA"));
      expect(comCreditos).toHaveLength(1);
      expect(comCreditos[0].startsWith(`${PRO_INCLUDED_CREDITS} fotos com IA`)).toBe(true);
    }
  });
});

describe("texto da landing", () => {
  const todos = [
    ...PLANOS_COBRADOS.flatMap((p) => recursosDoPlano(p.limites)),
    ...PLANOS.flatMap((p) => [...p.especificacoes.map((e) => e.valor), ...p.recursos]),
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
