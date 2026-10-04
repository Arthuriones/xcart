import { describe, expect, it } from "vitest";
import {
  avisosDaConexao,
  avisosDoTeste,
  estimativaCreditos,
  nomePadrao,
  ocupadasPorOutros,
  passosDoModo,
  porcento,
  posicaoNaTrilha,
  problemaDaEscolha,
} from "@/app/(dashboard)/clone/routed-checkout/nova/regras";

describe("trilha do assistente", () => {
  it("Só conectar nao mostra o passo de criar produtos", () => {
    expect(passosDoModo("connect")).toEqual(["Lojas", "Ativar rota"]);
    expect(passosDoModo("generate")).toHaveLength(3);
    expect(posicaoNaTrilha("connect", 3)).toBe(2);
    expect(posicaoNaTrilha("reuse", 2)).toBe(2);
  });
});

describe("papeis das lojas", () => {
  const vazia = { vitrine: "", checkout: "", origemCopia: "" };

  it("pede duas lojas antes de tudo", () => {
    expect(problemaDaEscolha("generate", vazia, 1)).toMatch(/duas lojas/);
  });
  it("nada vem escolhido e cada papel e pedido", () => {
    expect(problemaDaEscolha("generate", vazia, 3)).toBe("Escolha a vitrine.");
    expect(problemaDaEscolha("generate", { ...vazia, vitrine: "a" }, 3)).toBe("Escolha a loja de checkout.");
    expect(problemaDaEscolha("reuse", { ...vazia, vitrine: "a", checkout: "b" }, 3)).toMatch(/de onde copiar/);
  });
  it("a mesma loja nao fica em dois papeis", () => {
    expect(problemaDaEscolha("connect", { ...vazia, vitrine: "a", checkout: "a" }, 3)).toMatch(/diferentes/);
    expect(problemaDaEscolha("reuse", { vitrine: "a", checkout: "b", origemCopia: "a" }, 3)).toMatch(/diferente/);
    expect(problemaDaEscolha("reuse", { vitrine: "a", checkout: "b", origemCopia: "c" }, 3)).toBeNull();
  });
  it("o seletor de um papel desabilita as lojas dos outros", () => {
    const e = { vitrine: "a", checkout: "b", origemCopia: "c" };
    expect(ocupadasPorOutros("vitrine", "generate", e)).toEqual(["b"]);
    expect(ocupadasPorOutros("vitrine", "reuse", e)).toEqual(["b", "c"]);
    expect(ocupadasPorOutros("checkout", "connect", { ...e, vitrine: "" })).toEqual([]);
  });
});

describe("estimativa de creditos", () => {
  it("calculando enquanto a contagem nao volta", () => {
    expect(estimativaCreditos({ produtos: null, saldo: 10, cobrando: true, saldoFalhou: false }).tipo).toBe("calculando");
  });
  it("falta de saldo bloqueia", () => {
    const e = estimativaCreditos({ produtos: 40, saldo: 12, cobrando: true, saldoFalhou: false });
    expect(e.tipo).toBe("falta");
    expect(e.tipo === "falta" && e.texto).toBe("Precisa de 40 créditos (1 por produto) e você tem 12.");
  });
  it("sem cobranca ativa nao gasta", () => {
    expect(estimativaCreditos({ produtos: 40, saldo: 0, cobrando: false, saldoFalhou: false }).tipo).toBe("livre");
  });
  it("saldo que nao veio nao vira 'gratis'", () => {
    expect(estimativaCreditos({ produtos: 40, saldo: null, cobrando: false, saldoFalhou: true }).tipo).toBe("semLeitura");
  });
  it("com saldo de sobra", () => {
    const e = estimativaCreditos({ produtos: 1, saldo: 300, cobrando: true, saldoFalhou: false });
    expect(e.tipo === "ok" && e.texto).toBe("Vai usar cerca de 1 crédito (1 por produto). Você tem 300.");
  });
});

describe("avisos sem '(s)' e com acento", () => {
  it("depois de casar pelo SKU", () => {
    const a = avisosDaConexao({ coveragePercent: 80, missingSkuCount: 1, duplicateSkuCount: 3, matchedByLabel: 2 });
    expect(a).toHaveLength(4);
    expect(a[0]).toBe("1 variante continua sem SKU: a rota casa só pelo SKU.");
    expect(a.every((t) => !t.includes("(s)"))).toBe(true);
    expect(avisosDaConexao({ coveragePercent: 100 })).toEqual([]);
  });
  it("mantém o motivo de cada SKU que não gravou na vitrine", () => {
    const a = avisosDaConexao({
      missingSkuCount: 1,
      warnings: ["1 variante(s) continuam sem SKU (falha ao gravar na vitrine).", "Falha ao gravar SKU — Camisa: SKU inválido"],
    });
    expect(a).toEqual(["1 variante continua sem SKU: a rota casa só pelo SKU.", "Falha ao gravar SKU — Camisa: SKU inválido"]);
  });
  it("depois de completar a loja de checkout", () => {
    const a = avisosDoTeste({ noSkuCount: 0, missingCount: 2, wrongCount: 1, shipping: { ok: false } });
    expect(a).toEqual([
      "2 produtos ainda estão sem par na loja de checkout.",
      "1 produto aponta para o item errado no checkout.",
      "A loja de checkout não entrega no país desta rota: o comprador trava no frete.",
    ]);
  });
});

describe("miudezas", () => {
  it("nome padrao e porcentagem", () => {
    expect(nomePadrao("Vitrine A", "Checkout B")).toBe("Vitrine A → Checkout B");
    expect(porcento(5, 0)).toBe(0);
    expect(porcento(3, 4)).toBe(75);
    expect(porcento(9, 4)).toBe(100);
  });
});
