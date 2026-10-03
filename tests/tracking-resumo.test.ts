import { describe, expect, it } from "vitest";
import type { DestinoNaTela, LojaTracking } from "../src/lib/tracking/queries";
import type { DiagnosticoLoja } from "../src/lib/tracking/diagnostico";
import { saudeDaLoja } from "../src/app/(dashboard)/tracking/saude";
import {
  coberturaDaLoja,
  colunaDaPlataforma,
  formatarFracao,
  linhaDaLoja,
  ordenarLinhas,
  problemasDaLoja,
  proximoPassoDesligada,
  resumoDaTela,
  textoDaColuna,
  textoPrecisam,
} from "../src/app/(dashboard)/tracking/resumo";

// A tela nova mostra UM problema por loja, com UM botao. A regra de saude e a
// de saude.ts; o que este teste trava e que a traducao nao descola dela: cada
// motivo vira um problema, na mesma ordem e com o mesmo tom, e a loja vermelha
// nunca aparece com "Nada a fazer agora".

function destino(p: Partial<DestinoNaTela> = {}): DestinoNaTela {
  return {
    id: "g1",
    plataforma: "google",
    nome: "Principal",
    conta: "AW-1",
    labels: { purchase: "abc" },
    testEventCode: null,
    idTemplate: null,
    ativo: true,
    temToken: false,
    completo: true,
    criadoEm: "2026-09-01T00:00:00Z",
    ...p,
    contagem: {
      enviados: 0,
      falharam: 0,
      pendentes: 0,
      semAtribuicao: 0,
      ultimoErro: null,
      porEvento: { purchase: 3 },
      semAtribPorEvento: {},
      pedidosComCompra: ["1", "2", "3"],
      pedidosNaFila: [],
      ...p.contagem,
    },
  };
}

function meta(p: Partial<DestinoNaTela> = {}): DestinoNaTela {
  return destino({ id: "m1", plataforma: "meta", conta: "123", labels: {}, temToken: true, ...p });
}

function loja(p: Partial<LojaTracking> = {}): LojaTracking {
  return {
    storeId: "s1",
    nome: "Loja",
    dominio: "loja.myshopify.com",
    ligado: true,
    desinstalada: false,
    pixelCheckoutAtivo: true,
    pixelCheckoutDesatualizado: false,
    tetoAtingidoRecente: false,
    contagemIndisponivel: false,
    destinos: [destino()],
    ultimoEnvio: null,
    ...p,
  };
}

function diag(p: Partial<DiagnosticoLoja> = {}): DiagnosticoLoja {
  return {
    pedidos7d: 3,
    pedidoIds: ["1", "2", "3"],
    pedidoCriadoEm: {
      "1": "2026-09-20T00:00:00Z",
      "2": "2026-09-21T00:00:00Z",
      "3": "2026-09-22T00:00:00Z",
    },
    temWebhook: true,
    temSnippet: true,
    snippetComId: true,
    temRemarketing: true,
    problema: null,
    ...p,
  };
}

const casos: Record<string, { loja: LojaTracking; diag: DiagnosticoLoja | null; temDiag?: boolean }> = {
  tudoOk: { loja: loja(), diag: diag() },
  desinstalada: { loja: loja({ desinstalada: true }), diag: null, temDiag: false },
  semDestino: { loja: loja({ destinos: [] }), diag: diag() },
  todosDesativados: { loja: loja({ destinos: [destino({ ativo: false })] }), diag: diag() },
  umPedidoFaltando: {
    loja: loja({ destinos: [destino({ contagem: { pedidosComCompra: ["1", "2"] } as never })] }),
    diag: diag(),
  },
  faltandoComRecusa: {
    loja: loja({
      destinos: [
        meta({
          contagem: {
            pedidosComCompra: [],
            falharam: 3,
            ultimoErro: "Invalid OAuth access token",
          } as never,
        }),
      ],
    }),
    diag: diag(),
  },
  faltandoSemAviso: {
    loja: loja({ destinos: [destino({ contagem: { pedidosComCompra: ["1"] } as never })] }),
    diag: diag({ temWebhook: false }),
  },
  teto: { loja: loja({ tetoAtingidoRecente: true }), diag: diag() },
  contagemIndisponivel: {
    loja: loja({
      contagemIndisponivel: true,
      destinos: [destino({ contagem: { pedidosComCompra: [], porEvento: {} } as never })],
    }),
    diag: diag(),
  },
  soMetaEmTeste: { loja: loja({ destinos: [meta({ testEventCode: "TEST1" })] }), diag: diag() },
  umMetaEmTeste: {
    loja: loja({ destinos: [destino(), meta({ testEventCode: "TEST1" })] }),
    diag: diag(),
  },
  semScript: { loja: loja(), diag: diag({ temSnippet: false, snippetComId: false }) },
  scriptAntigo: { loja: loja(), diag: diag({ snippetComId: false }) },
  semPixel: { loja: loja({ pixelCheckoutAtivo: false }), diag: diag() },
  pixelAntigo: { loja: loja({ pixelCheckoutDesatualizado: true }), diag: diag() },
  incompleto: {
    loja: loja({ destinos: [destino(), meta({ temToken: false, completo: false })] }),
    diag: diag(),
  },
  falhasSoltas: {
    loja: loja({ destinos: [destino({ contagem: { falharam: 2, ultimoErro: "timeout" } as never })] }),
    diag: diag(),
  },
  semClique: {
    loja: loja({
      destinos: [destino({ contagem: { semAtribPorEvento: { purchase: 3 } } as never })],
    }),
    diag: diag(),
  },
  shopifyNaoRespondeu: {
    loja: loja(),
    diag: diag({ pedidos7d: null, pedidoIds: null, pedidoCriadoEm: null, problema: "failed" }),
  },
  conferenciaFalhou: { loja: loja(), diag: null },
};

describe("problemasDaLoja espelha a regra de saude", () => {
  for (const [nome, c] of Object.entries(casos)) {
    it(nome, () => {
      const temDiag = c.temDiag ?? true;
      const s = saudeDaLoja(c.loja, c.loja.ligado, c.diag, temDiag);
      const p = problemasDaLoja(c.loja, c.diag, temDiag);
      expect(p.map((x) => x.tom)).toEqual(s.motivos.map((m) => m.tom));
      // Loja vermelha ou amarela sempre tem um problema para mostrar.
      const linha = linhaDaLoja(c.loja, c.diag, temDiag);
      expect(linha.principal === null).toBe(s.saude === "ok");
      if (s.saude === "parado") expect(linha.principal?.tom).toBe("err");
    });
  }

  it("o primeiro problema e o mais grave, com o conserto certo", () => {
    expect(problemasDaLoja(casos.faltandoComRecusa.loja, casos.faltandoComRecusa.diag, true)[0])
      .toMatchObject({
        tom: "err",
        texto: "3 pedidos sem compra enviada ao Meta \"Principal\".",
        acao: { tipo: "editar-destino", destinoId: "m1" },
      });
    expect(problemasDaLoja(casos.faltandoComRecusa.loja, casos.faltandoComRecusa.diag, true)[0].detalhe)
      .toContain("Invalid OAuth access token");
    // Sem o aviso de pedidos, o conserto da falta e o aviso, nao o destino.
    expect(
      problemasDaLoja(casos.faltandoSemAviso.loja, casos.faltandoSemAviso.diag, true)[0].acao?.tipo
    ).toBe("webhook");
    expect(problemasDaLoja(casos.semScript.loja, casos.semScript.diag, true)[0].acao?.rotulo).toBe(
      "Instalar script"
    );
    expect(problemasDaLoja(casos.semDestino.loja, casos.semDestino.diag, true)[0].acao?.tipo).toBe(
      "adicionar-destino"
    );
    expect(
      problemasDaLoja(casos.conferenciaFalhou.loja, null, true).at(-1)?.acao?.tipo
    ).toBe("rechecar");
  });

  it("o limite de eventos nao tem botao: nao ha o que o lojista faca", () => {
    const p = problemasDaLoja(casos.teto.loja, casos.teto.diag, true);
    expect(p).toHaveLength(1);
    expect(p[0].acao).toBeNull();
    expect(p[0].texto).not.toMatch(/avise/i);
  });

  it("texto sem jargao de CAPI nem snippet", () => {
    for (const c of Object.values(casos)) {
      for (const p of problemasDaLoja(c.loja, c.diag, c.temDiag ?? true)) {
        expect(`${p.texto} ${p.detalhe ?? ""}`).not.toMatch(/CAPI|snippet|webhook|npm run/i);
      }
    }
  });
});

describe("loja desligada", () => {
  it("nao tem problema, tem o proximo passo", () => {
    expect(problemasDaLoja(loja({ ligado: false }), null, false)).toEqual([]);
    expect(proximoPassoDesligada(loja({ ligado: false })).acao?.tipo).toBe("ligar");
    expect(proximoPassoDesligada(loja({ ligado: false, destinos: [] })).acao?.tipo).toBe(
      "adicionar-destino"
    );
    expect(
      proximoPassoDesligada(
        loja({ ligado: false, destinos: [destino({ labels: { add_to_cart: "x" } })] })
      ).acao
    ).toMatchObject({ tipo: "editar-destino", destinoId: "g1" });
  });

  it("as colunas dizem desligado, sem barra", () => {
    const c = colunaDaPlataforma(loja({ ligado: false }), null, "google");
    expect(c).toEqual({ tipo: "desligado", motivo: "envio desligado nesta loja" });
    expect(textoDaColuna(c, "google").fracao).toBeNull();
  });
});

describe("colunas Meta e Google", () => {
  it("sem destino da plataforma", () => {
    expect(colunaDaPlataforma(loja(), diag(), "meta")).toEqual({
      tipo: "desligado",
      motivo: "sem destino nesta loja",
    });
  });

  it("com varias contas vale a pior", () => {
    const l = loja({
      destinos: [
        destino({ id: "a" }),
        destino({ id: "b", contagem: { pedidosComCompra: ["1"] } as never }),
      ],
    });
    const c = colunaDaPlataforma(l, diag(), "google");
    expect(c).toMatchObject({ tipo: "razao", chegaram: 1, esperados: 3, faltam: 2, contas: 2 });
    expect(textoDaColuna(c, "google")).toEqual({
      texto: "1 de 3",
      sub: "faltam 2 · pior de 2 contas",
      fracao: 1 / 3,
      tom: "warn",
    });
  });

  it("compra sem clique aparece na sub-linha", () => {
    const c = colunaDaPlataforma(casos.semClique.loja, casos.semClique.diag, "google");
    expect(textoDaColuna(c, "google").sub).toBe("todas chegaram · 3 sem clique do Google");
  });

  it("modo teste e destino sem rotulo da compra nao recebem", () => {
    expect(colunaDaPlataforma(casos.soMetaEmTeste.loja, diag(), "meta")).toEqual({
      tipo: "nao-recebe",
      motivo: "em modo teste",
    });
    expect(
      colunaDaPlataforma(loja({ destinos: [destino({ labels: { add_to_cart: "x" } })] }), diag(), "google")
    ).toEqual({ tipo: "nao-recebe", motivo: "falta o rótulo da compra" });
  });

  it("falha de leitura nunca vira zero", () => {
    const c = colunaDaPlataforma(casos.contagemIndisponivel.loja, diag(), "google");
    expect(textoDaColuna(c, "google")).toMatchObject({ texto: "—", fracao: null });
    const s = colunaDaPlataforma(loja(), null, "google");
    expect(textoDaColuna(s, "google")).toMatchObject({
      texto: "3 compras enviadas",
      sub: "pedidos não conferidos",
    });
  });

  it("nenhuma compra chegou fica vermelho", () => {
    const c = colunaDaPlataforma(casos.faltandoComRecusa.loja, diag(), "meta");
    expect(textoDaColuna(c, "meta")).toMatchObject({ texto: "0 de 3", tom: "err", fracao: 0 });
  });
});

describe("ordem e numeros do topo", () => {
  const linhas = [
    linhaDaLoja(loja({ storeId: "ok" }), diag(), true),
    linhaDaLoja(loja({ storeId: "off", ligado: false }), null, false),
    linhaDaLoja(loja({ storeId: "warn", pixelCheckoutAtivo: false }), diag(), true),
    linhaDaLoja(
      loja({
        storeId: "err",
        destinos: [destino({ contagem: { pedidosComCompra: ["1"] } as never })],
      }),
      diag(),
      true
    ),
  ];

  it("da mais urgente para a mais tranquila", () => {
    expect(ordenarLinhas(linhas).map((l) => l.loja.storeId)).toEqual(["err", "warn", "ok", "off"]);
  });

  it("resume as lojas ligadas", () => {
    const r = resumoDaTela(linhas, { ok: diag(), warn: diag(), err: diag() });
    expect(r).toMatchObject({
      total: 4,
      rastreando: 3,
      semDestino: 0,
      pedidos: 9,
      lojasSemPedidos: 0,
      paradas: 1,
      atencao: 1,
      cobertura: { chegaram: 7, esperados: 9, lojas: 3 },
      lojasForaDaCobertura: 0,
    });
    expect(textoPrecisam(r)).toBe("1 parada · 1 com atenção");
  });

  it("vendas enviadas usam o maior destino, nao a soma", () => {
    const l = linhaDaLoja(loja({ destinos: [destino({ id: "a" }), destino({ id: "b" })] }), diag(), true);
    expect(resumoDaTela([l], { s1: diag() }).enviadas).toBe(3);
  });

  it("loja sem resposta da Shopify fica fora da soma de pedidos, nao vira zero", () => {
    const r = resumoDaTela(
      [linhaDaLoja(loja({ storeId: "a" }), diag(), true), linhaDaLoja(loja({ storeId: "b" }), null, true)],
      { a: diag() }
    );
    expect(r.pedidos).toBe(3);
    expect(r.lojasSemPedidos).toBe(1);
    expect(r.lojasForaDaCobertura).toBe(1);
  });

  it("loja ligada sem destino recebendo conta os pedidos como perdidos", () => {
    expect(coberturaDaLoja(loja({ destinos: [] }), diag())).toEqual({ chegaram: 0, esperados: 3 });
    expect(coberturaDaLoja(loja({ ligado: false }), diag())).toBeNull();
  });

  it("formata como o lojista le", () => {
    expect(formatarFracao(0.745)).toBe("74,5%");
    expect(textoPrecisam({ paradas: 0, atencao: 0 })).toBe("nenhuma loja");
    expect(textoPrecisam({ paradas: 2, atencao: 0 })).toBe("2 paradas");
  });
});
