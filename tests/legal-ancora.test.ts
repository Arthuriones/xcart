import { describe, expect, it } from "vitest";
import { ancoraDaSecao, ancorasUnicas } from "@/components/legal/ancora";

describe("âncora das seções legais", () => {
  it("tira o número da frente, o acento e a pontuação", () => {
    expect(ancoraDaSecao("1. Quem somos")).toBe("quem-somos");
    expect(ancoraDaSecao("6. Retenção e exclusão")).toBe("retencao-e-exclusao");
    expect(ancoraDaSecao("4. Revogar acesso na Shopify")).toBe("revogar-acesso-na-shopify");
    expect(ancoraDaSecao("10) Uso permitido")).toBe("uso-permitido");
  });

  it("nunca devolve vazio", () => {
    expect(ancoraDaSecao("7.")).toBe("secao");
    expect(ancoraDaSecao("   ")).toBe("secao");
  });

  it("não repete id quando dois títulos dão a mesma âncora", () => {
    expect(ancorasUnicas(["1. Contato", "2. Contato", "3. Contato-2"])).toEqual([
      "contato",
      "contato-2",
      "contato-2-2",
    ]);
  });

  it("mantém a ordem e o tamanho da lista", () => {
    const titulos = ["1. Aceitação dos termos", "2. Uso permitido", "3. Recursos de IA"];
    expect(ancorasUnicas(titulos)).toEqual([
      "aceitacao-dos-termos",
      "uso-permitido",
      "recursos-de-ia",
    ]);
  });
});
