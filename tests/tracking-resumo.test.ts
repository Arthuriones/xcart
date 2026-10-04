import { describe, expect, it } from "vitest";
import type { DestinoNaTela, LojaTracking } from "../src/lib/tracking/queries";
import type { DiagnosticoLoja } from "../src/lib/tracking/diagnostico";
import { saudeDaLoja } from "../src/app/(dashboard)/tracking/saude";
import {
  colunaDaPlataforma,
  comprasQueOMetaDiz,
  contasDaTela,
  formatarFracao,
  linhaDaLoja,
  ordenarLinhas,
  problemasDaLoja,
  proximoPassoDesligada,
  resumoDaTela,
  testesNaTela,
  textoCobertura,
  textoDaColuna,
  textoPrecisam,
} from "../src/app/(dashboard)/tracking/resumo";
import { respostaJson } from "../src/app/(dashboard)/tracking/resposta";

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
      // null = sem a separacao da 055: "de anuncio" cai para "com clique".
      testesPorEvento: {},
      deAnuncioPorEvento: null,
      falhasPorEvento: {},
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
    comprasContadasPeloMeta: null,
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
  // Compra de teste com gclid TESTE: a unica "com clique". Sem teste, nenhuma
  // venda foi ligada a anuncio -- e o alarme tem de aparecer nos dois lados.
  testeComClique: {
    loja: loja({
      destinos: [
        destino({
          contagem: {
            porEvento: { purchase: 3 },
            semAtribPorEvento: { purchase: 2 },
            testesPorEvento: { purchase: 1 },
            deAnuncioPorEvento: { purchase: 0 },
          } as never,
        }),
      ],
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
      pedidosComparaveis: 9,
      porPlataforma: { google: { chegaram: 7, esperados: 9, lojas: 3 }, meta: null },
      lojasForaDaCobertura: 0,
    });
    expect(textoPrecisam(r)).toBe("1 parada · 1 com atenção");
    expect(textoCobertura(r.porPlataforma)).toBe("Google 77,8% dos pedidos");
  });

  it("uma plataforma recebendo tudo nao esconde a outra sem receber nada", () => {
    const l = linhaDaLoja(
      loja({
        destinos: [destino(), meta({ contagem: { pedidosComCompra: [] } as never })],
      }),
      diag(),
      true
    );
    const r = resumoDaTela([l], { s1: diag() });
    expect(r.porPlataforma.meta).toEqual({ chegaram: 0, esperados: 3, lojas: 1 });
    expect(r.porPlataforma.google).toEqual({ chegaram: 3, esperados: 3, lojas: 1 });
    expect(textoCobertura(r.porPlataforma)).toBe("Meta 0% · Google 100% dos pedidos");
  });

  it("vendas enviadas usam o maior destino, nao a soma", () => {
    const l = linhaDaLoja(loja({ destinos: [destino({ id: "a" }), destino({ id: "b" })] }), diag(), true);
    expect(resumoDaTela([l], { s1: diag() }).enviadas).toBe(3);
  });

  it("contagem que falhou vira \"—\", nunca zero compras enviadas", () => {
    const l = linhaDaLoja(casos.contagemIndisponivel.loja, diag(), true);
    expect(resumoDaTela([l], { s1: diag() }).enviadas).toBeNull();
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

  it("loja ligada sem destino recebendo entra nos pedidos e em nenhuma plataforma", () => {
    const r = resumoDaTela([linhaDaLoja(loja({ destinos: [] }), diag(), true)], { s1: diag() });
    expect(r.pedidosComparaveis).toBe(3);
    expect(r.porPlataforma).toEqual({ meta: null, google: null });
    expect(textoCobertura(r.porPlataforma)).toBeNull();
  });

  it("formata como o lojista le", () => {
    expect(formatarFracao(0.745)).toBe("74,5%");
    expect(textoPrecisam({ paradas: 0, atencao: 0 })).toBe("nenhuma loja");
    expect(textoPrecisam({ paradas: 2, atencao: 0 })).toBe("2 paradas");
  });

  it("varias contas sem perda nao falam em pior", () => {
    const l = loja({ destinos: [destino({ id: "a" }), destino({ id: "b" })] });
    expect(textoDaColuna(colunaDaPlataforma(l, diag(), "google"), "google").sub).toBe(
      "todas chegaram · 2 contas"
    );
  });
});

describe("respostaJson", () => {
  it("sessao vencida (pagina de login em HTML) vira erro legivel, nunca sucesso", async () => {
    const html = new Response("<html>login</html>", { status: 200 });
    Object.defineProperty(html, "redirected", { value: true });
    await expect(respostaJson(html, "falhou")).rejects.toThrow("Sua sessão expirou");
  });

  it("erro da rota passa a mensagem dela adiante", async () => {
    const r = new Response(JSON.stringify({ error: "Invalid OAuth access token" }), { status: 400 });
    await expect(respostaJson(r, "falhou")).rejects.toThrow("Invalid OAuth access token");
    const s = new Response(JSON.stringify({}), { status: 500 });
    await expect(respostaJson(s, "Não deu para salvar.")).rejects.toThrow("Não deu para salvar.");
  });

  it("sucesso devolve o corpo", async () => {
    const r = new Response(JSON.stringify({ ok: true, codigo: "x" }), { status: 200 });
    await expect(respostaJson(r, "falhou")).resolves.toEqual({ ok: true, codigo: "x" });
  });
});

describe("por conta", () => {
  it("uma linha por conta ativa de loja ligada; as contas nunca somadas", () => {
    const softnook = loja({
      storeId: "soft",
      destinos: [
        destino({ id: "g1", conta: "AW-18463882690" }),
        destino({ id: "g2", conta: "AW-18463833677" }),
        destino({ id: "g3", ativo: false }),
      ],
    });
    const desligada = loja({ storeId: "off", ligado: false });
    expect(contasDaTela([softnook, desligada]).map((c) => c.destino.id)).toEqual(["g1", "g2"]);
  });

  it("testes na tela somam as contas; leitura que falhou nao entra", () => {
    const com = loja({
      destinos: [
        destino({
          contagem: { testesPorEvento: { add_to_cart: 13, begin_checkout: 7 } } as never,
        }),
      ],
    });
    const semContagem = loja({
      storeId: "s2",
      contagemIndisponivel: true,
      destinos: [destino({ contagem: { testesPorEvento: { add_to_cart: 9 } } as never })],
    });
    expect(testesNaTela(contasDaTela([com, semContagem]))).toBe(20);
  });

  it("o que o Meta diz so aparece com um pixel na loja e dado do Meta", () => {
    const umPixel = loja({ comprasContadasPeloMeta: 4, destinos: [meta(), destino()] });
    const [m, g] = contasDaTela([umPixel]);
    expect(comprasQueOMetaDiz(m)).toBe(4);
    expect(comprasQueOMetaDiz(g)).toBeNull();

    const doisPixels = loja({
      comprasContadasPeloMeta: 4,
      destinos: [meta(), meta({ id: "m2" })],
    });
    expect(comprasQueOMetaDiz(contasDaTela([doisPixels])[0])).toBeNull();

    const semDado = loja({ destinos: [meta()] });
    expect(comprasQueOMetaDiz(contasDaTela([semDado])[0])).toBeNull();
  });
});
