import { describe, expect, it } from "vitest";
import {
  abaDe,
  codigoDoScript,
  conferirDivisao,
  contarPorFiltro,
  dividirIgual,
  estadoDaLoja,
  estadoDaRota,
  estadoInstalacao,
  filtroDe,
  fraseDoConserto,
  hrefRota,
  lerPercentual,
  linhasDoTeste,
  lojasRecebendo,
  mudancasDaDivisao,
  passaNoFiltro,
  rascunhoInicial,
  testePedeConserto,
} from "@/app/(dashboard)/clone/routed-checkout/logica";

const AGORA = Date.parse("2026-10-03T12:00:00Z");
const hAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

function alvo(over: Partial<{ id: string; enabled: boolean; weight: number; sharePercent: number; mappedSkuCount: number; lastHealedAt: string | null }> = {}) {
  return {
    id: "a",
    storeId: "s",
    enabled: true,
    weight: 1,
    sharePercent: 100,
    mappedSkuCount: 50,
    lastHealedAt: hAtras(1),
    dailyLimit: null,
    orders24h: 0,
    legacy: false,
    conserto: null,
    checkout: { modo: "idioma" as const, pais: null, dominio: null },
    ...over,
  };
}

describe("estado da rota", () => {
  it("pausada ganha de tudo", () => {
    expect(estadoDaRota({ enabled: false, lastHeal: { at: "", ok: false }, targets: [alvo()] }, AGORA)).toBe("pausada");
  });
  it("loja ligada sem produto ligado e atencao", () => {
    expect(estadoDaRota({ enabled: true, lastHeal: null, targets: [alvo({ mappedSkuCount: 0 })] }, AGORA)).toBe("atencao");
  });
  it("mapa velho e atencao", () => {
    expect(estadoDaRota({ enabled: true, lastHeal: null, targets: [alvo({ lastHealedAt: hAtras(30) })] }, AGORA)).toBe("atencao");
  });
  it("checagem quebrada e atencao", () => {
    expect(estadoDaRota({ enabled: true, lastHeal: { at: hAtras(1), ok: false }, targets: [alvo()] }, AGORA)).toBe("atencao");
  });
  it("tudo certo e ativa", () => {
    expect(estadoDaRota({ enabled: true, lastHeal: { at: hAtras(1), ok: true }, targets: [alvo()] }, AGORA)).toBe("ativa");
  });
});

describe("lojas recebendo", () => {
  it("rota pausada nao tem ninguem recebendo", () => {
    expect(lojasRecebendo({ enabled: false, targets: [alvo()] })).toBe(0);
  });
  it("conta so loja ligada, com fatia e com produto", () => {
    const targets = [alvo({ id: "1" }), alvo({ id: "2", weight: 0, sharePercent: 0 }), alvo({ id: "3", enabled: false }), alvo({ id: "4", mappedSkuCount: 0 })];
    expect(lojasRecebendo({ enabled: true, targets })).toBe(1);
  });
  it("estado de cada loja diz o motivo", () => {
    expect(estadoDaLoja(false, alvo()).texto).toBe("Rota pausada");
    expect(estadoDaLoja(true, alvo({ mappedSkuCount: 0 })).texto).toBe("Sem produto ligado");
    expect(estadoDaLoja(true, alvo({ enabled: false })).texto).toBe("Pausada");
    expect(estadoDaLoja(true, alvo({ weight: 0 })).texto).toBe("Fora da divisão");
    expect(estadoDaLoja(true, alvo()).tom).toBe("ok");
  });
});

describe("filtro e abas", () => {
  it("valor desconhecido vira o padrao", () => {
    expect(filtroDe("xyz")).toBe("todas");
    expect(filtroDe(null)).toBe("todas");
    expect(abaDe("lojas")).toBe("lojas");
    expect(abaDe("vendas")).toBe("visao");
  });
  it("filtra e conta por estado", () => {
    expect(passaNoFiltro("ativa", "todas")).toBe(true);
    expect(passaNoFiltro("ativa", "atencao")).toBe(false);
    expect(passaNoFiltro("pausada", "pausadas")).toBe(true);
    expect(contarPorFiltro(["ativa", "atencao", "atencao", "pausada"])).toEqual({ todas: 4, ativas: 1, atencao: 2, pausadas: 1 });
  });
  it("a Visao nao vai na URL; as outras abas vao", () => {
    expect(hrefRota("r1")).toBe("/clone/routed-checkout?rota=r1");
    expect(hrefRota("r1", "diagnostico", { conferir: "1" })).toBe("/clone/routed-checkout?rota=r1&aba=diagnostico&conferir=1");
  });
});

describe("divisao do trafego", () => {
  it("le o que o lojista digita", () => {
    expect(lerPercentual("45")).toBe(45);
    expect(lerPercentual(" 45,6 ")).toBe(46);
    expect(lerPercentual("45.4%")).toBe(45);
    expect(lerPercentual("")).toBeNull();
    expect(lerPercentual("abc")).toBeNull();
    expect(lerPercentual("101")).toBeNull();
    expect(lerPercentual("-1")).toBeNull();
  });

  it("dividir igual sempre fecha 100", () => {
    expect(dividirIgual(["a", "b", "c"])).toEqual({ a: 34, b: 33, c: 33 });
    expect(dividirIgual(["a", "b"])).toEqual({ a: 50, b: 50 });
    expect(dividirIgual([])).toEqual({});
  });

  it("so deixa salvar com soma 100 e campos validos", () => {
    expect(conferirDivisao({ a: "45", b: "55" })).toMatchObject({ ok: true, soma: 100 });
    expect(conferirDivisao({ a: "4", b: "55" })).toMatchObject({ ok: false, motivo: "Faltam 41% para fechar 100%." });
    expect(conferirDivisao({ a: "60", b: "55" })).toMatchObject({ ok: false, motivo: "Passou 15% de 100%." });
    expect(conferirDivisao({ a: "x", b: "55" })).toMatchObject({ ok: false, invalidos: ["a"] });
    expect(conferirDivisao({ a: "0", b: "0" }).ok).toBe(false);
  });

  it("digitar 45 nao grava nada ate salvar, e salvar manda todas as lojas ligadas", () => {
    const alvos = [
      { id: "a", sharePercent: 25 },
      { id: "b", sharePercent: 25 },
      { id: "c", sharePercent: 50 },
    ];
    // Sem mudanca: nada a mandar.
    expect(mudancasDaDivisao(alvos, { a: "25", b: "25", c: "50" })).toEqual([]);
    // Mudou A e B: vao as tres (peso e relativo; C com o peso antigo quebraria a conta).
    expect(mudancasDaDivisao(alvos, { a: "30", b: "20", c: "50" })).toEqual([
      { id: "a", weight: 30 },
      { id: "b", weight: 20 },
      { id: "c", weight: 50 },
    ]);
    // Campo invalido: nada vai.
    expect(mudancasDaDivisao(alvos, { a: "x", b: "20", c: "50" })).toEqual([]);
  });

  it("o rascunho nasce do % de hoje das lojas ligadas", () => {
    expect(
      rascunhoInicial([
        { id: "a", enabled: true, sharePercent: 60 },
        { id: "b", enabled: false, sharePercent: 0 },
      ])
    ).toEqual({ a: "60" });
  });
});

describe("resultado do teste", () => {
  it("loja que nao responde vira um aviso so", () => {
    const linhas = linhasDoTeste({ ok: false, coveragePercent: 0, noSkuCount: 0, missingCount: 0, wrongCount: 0, storeIssue: { message: "A loja de checkout esta congelada." } });
    expect(linhas).toEqual([{ tom: "err", texto: "A loja de checkout esta congelada." }]);
  });
  it("lista do mais grave para o menos, sem plural com (s)", () => {
    const linhas = linhasDoTeste({ ok: false, coveragePercent: 80, noSkuCount: 1, missingCount: 3, wrongCount: 2, shipping: { ok: false } });
    expect(linhas.map((l) => l.tom)).toEqual(["err", "warn", "warn", "warn"]);
    expect(linhas[0].texto).toContain("2 SKUs apontam");
    expect(linhas[2].texto).toContain("1 variante da vitrine está");
    expect(linhas.every((l) => !l.texto.includes("(s)"))).toBe(true);
  });
  it("tudo certo diz isso", () => {
    expect(linhasDoTeste({ ok: true, coveragePercent: 100, noSkuCount: 0, missingCount: 0, wrongCount: 0 })[0].tom).toBe("ok");
  });
  it("corrigir so aparece quando ha o que corrigir", () => {
    expect(testePedeConserto({ ok: false, coveragePercent: 90, noSkuCount: 0, missingCount: 2, wrongCount: 0 })).toBe(true);
    expect(testePedeConserto({ ok: true, coveragePercent: 100, noSkuCount: 0, missingCount: 0, wrongCount: 0 })).toBe(false);
    expect(testePedeConserto({ ok: false, coveragePercent: 0, noSkuCount: 0, missingCount: 9, wrongCount: 0, storeIssue: {} })).toBe(false);
  });
  it("frase do conserto", () => {
    expect(fraseDoConserto({ noop: true })).toBe("Nada para corrigir: a rota já estava certa.");
    expect(fraseDoConserto({ createdProductCount: 1, stampedSkuCount: 4 })).toBe("Corrigida: 1 produto criado, 4 SKUs gravados na vitrine.");
  });
});

describe("instalacao", () => {
  it("estado pelo ultimo sinal do script", () => {
    expect(estadoInstalacao(hAtras(2), false).texto).toBe("Script ativo");
    expect(estadoInstalacao(null, false).tom).toBe("warn");
    expect(estadoInstalacao(null, true).tom).toBe("neutral");
  });
  it("o codigo que o lojista cola sai igual ao de antes", () => {
    expect(codigoDoScript("https://user.xcart.app", "tok-1")).toBe(
      '<script\n  src="https://user.xcart.app/routed-checkout-loader.js"\n  data-token="tok-1"\n  async>\n</script>'
    );
  });
});
