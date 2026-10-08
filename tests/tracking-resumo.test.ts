import { describe, expect, it } from "vitest";
import type { DestinoNaTela, LojaTracking } from "../src/lib/tracking/queries";
import type { DiagnosticoLoja } from "../src/lib/tracking/diagnostico";
import { saudeDaLoja } from "../src/app/(dashboard)/tracking/saude";
import {
  colunaDaPlataforma,
  formatarFracao,
  linhaDaLoja,
  ordenarLinhas,
  resumoDaTela,
} from "../src/app/(dashboard)/tracking/resumo";
import {
  avisosDaLoja,
  comprasDoPixel,
  estadoDoPixel,
  instalacaoDaLoja,
  pontosDaLinha,
  subDaLinha,
} from "../src/app/(dashboard)/tracking/vista";
import { respostaJson } from "../src/app/(dashboard)/tracking/resposta";

// A lista mostra so um ponto de cor e um numero por plataforma; o motivo de
// um problema aparece dentro da loja, no pixel afetado ou na instalacao. A
// regra de saude e a de saude.ts; o que este teste trava e que a traducao nao
// descola dela: loja amarela ou vermelha sempre tem um motivo visivel no
// detalhe, e o Google nunca ganha numero do servidor.

// O destino padrao e Meta: so ele passa pela fila do servidor e tem contagem.
// O Google vai pela tag do navegador (`google()`, e "Google pela tag" abaixo).
function destino(p: Partial<DestinoNaTela> = {}): DestinoNaTela {
  return {
    id: "d1",
    plataforma: "meta",
    nome: "Principal",
    conta: "999",
    labels: {},
    testEventCode: null,
    idTemplate: null,
    ativo: true,
    temToken: true,
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

function google(p: Partial<DestinoNaTela> = {}): DestinoNaTela {
  return destino({
    id: "g1",
    plataforma: "google",
    conta: "AW-1",
    labels: { purchase: "abc" },
    temToken: false,
    ...p,
  });
}

function loja(p: Partial<LojaTracking> = {}): LojaTracking {
  return {
    storeId: "s1",
    nome: "Loja",
    dominio: "loja.myshopify.com",
    ligado: true,
    desinstalada: false,
    pixelCheckoutAtivo: true,
    pixelCheckoutVistoEm: "2026-10-04T00:00:00Z",
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
  semPixel: { loja: loja({ pixelCheckoutAtivo: false, pixelCheckoutVistoEm: null }), diag: diag() },
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
  // Duas contas Google empatadas em compras: a primeira nao e dona do clique
  // ('nao_e_desta_conta', deAnuncio 0), a segunda creditou. Sem alarme.
  duasContasGoogle: {
    loja: loja({
      destinos: [
        destino({
          id: "gA",
          contagem: { porEvento: { purchase: 1 }, deAnuncioPorEvento: { purchase: 0 } } as never,
        }),
        destino({
          id: "gB",
          conta: "AW-2",
          contagem: { porEvento: { purchase: 1 }, deAnuncioPorEvento: { purchase: 1 } } as never,
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

/** Os tons que o detalhe da loja mostra: avisos, pixels e campos. */
function tonsDoDetalhe(c: { loja: LojaTracking; diag: DiagnosticoLoja | null; temDiag?: boolean }) {
  const falhou = (c.temDiag ?? true) && c.diag === null;
  const inst = instalacaoDaLoja(c.loja, c.diag, falhou);
  return [
    ...avisosDaLoja(c.loja, inst).map((a) => a.tom),
    ...c.loja.destinos.map((d) => estadoDoPixel(d, c.loja, c.diag).tom),
    inst.tom,
  ];
}

describe("o detalhe sempre mostra o motivo", () => {
  for (const [nome, c] of Object.entries(casos)) {
    it(nome, () => {
      const s = saudeDaLoja(c.loja, c.loja.ligado, c.diag, c.temDiag ?? true);
      const tons = tonsDoDetalhe(c);
      if (s.saude === "ok") expect(tons.every((t) => t === "ok" || t === "neutral")).toBe(true);
      else expect(tons.some((t) => t === "warn" || t === "err")).toBe(true);
      if (s.saude === "parado") expect(tons).toContain("err");
    });
  }

  it("o pixel diz o problema em poucas palavras", () => {
    const recusa = casos.faltandoComRecusa;
    expect(estadoDoPixel(recusa.loja.destinos[0], recusa.loja, recusa.diag)).toEqual({
      nota: "Envio recusado",
      tom: "err",
      erro: "Invalid OAuth access token",
    });
    // Sem o aviso de pedidos, o motivo esta no campo da loja.
    const semAviso = casos.faltandoSemAviso;
    expect(estadoDoPixel(semAviso.loja.destinos[0], semAviso.loja, semAviso.diag).nota).toBe(
      "Sem aviso de pedidos"
    );
    expect(instalacaoDaLoja(semAviso.loja, semAviso.diag, false).itens.aviso?.tom).toBe("err");
    const incompleto = casos.incompleto.loja;
    expect(estadoDoPixel(incompleto.destinos[1], incompleto, diag()).nota).toBe("Sem token");
    expect(estadoDoPixel(destino(), loja(), diag())).toEqual({ nota: null, tom: "ok", erro: null });
  });

  it("duas contas: alguma creditou, nada de 'sem clique de anuncio'", () => {
    const c = casos.duasContasGoogle;
    for (const d of c.loja.destinos) {
      expect(estadoDoPixel(d, c.loja, c.diag).nota).not.toBe("Sem clique de anúncio");
    }
  });

  it("conferencia que falhou pede 'tentar de novo', nao acusa falta", () => {
    const i = instalacaoDaLoja(loja(), null, true);
    expect(i.semConferir).toBe(true);
    expect(i.itens.aviso?.tom).toBe("neutral");
    expect(avisosDaLoja(loja(), i).map((a) => a.acao)).toContain("conferir");
  });

  it("remarketing sai pelo script: ativo com a loja ligada, sem a marca no tema", () => {
    const l = loja({ destinos: [google()] });
    const i = instalacaoDaLoja(l, diag({ temRemarketing: false }), false);
    expect(i.itens.remarketing?.valor).toBe("Ativo");
    expect(i.tom).toBe("ok");
    const off = loja({ ligado: false, destinos: [google()] });
    expect(instalacaoDaLoja(off, null, false).itens.remarketing?.valor).toBe("Desligado com a loja");
    expect(instalacaoDaLoja(loja(), diag(), false).itens.remarketing).toBeNull();
  });

  it("loja desligada: Google nunca verde e o aviso oferece ligar", () => {
    const off = loja({ ligado: false, destinos: [google()] });
    expect(estadoDoPixel(off.destinos[0], off, null)).toEqual({ nota: null, tom: "neutral", erro: null });
    expect(comprasDoPixel(off.destinos[0], off, null)).toBeNull();
    expect(avisosDaLoja(off, instalacaoDaLoja(off, null, false))).toContainEqual({
      tom: "warn",
      texto: "Rastreamento desligado: nenhuma compra é enviada.",
      acao: "ligar",
    });
    // O lojista acabou de ligar: o aviso some antes de a tela recarregar.
    expect(avisosDaLoja(off, instalacaoDaLoja(off, null, false), true).map((a) => a.acao)).not.toContain(
      "ligar"
    );
  });

  it("Google sem o pixel do checkout nao fica verde", () => {
    const l = loja({ destinos: [google()], pixelCheckoutAtivo: false, pixelCheckoutVistoEm: null });
    expect(estadoDoPixel(l.destinos[0], l, diag())).toMatchObject({
      nota: "Falta o pixel do checkout",
      tom: "warn",
    });
    expect(comprasDoPixel(l.destinos[0], l, diag())).toBeNull();
    expect(pontosDaLinha(linhaDaLoja(l, diag(), true))).toEqual([
      { plataforma: "google", tom: "warn", rotulo: "Google Ads: falta o pixel do checkout" },
    ]);
  });

  it("pixel visto ha mais de 24 h esta instalado, nao faltando", () => {
    const l = loja({ pixelCheckoutAtivo: false, pixelCheckoutVistoEm: "2026-09-01T00:00:00Z" });
    const i = instalacaoDaLoja(l, diag(), false);
    expect(i.itens.pixel?.valor).toMatch(/^Instalado · último checkout /);
    expect(i.itens.pixel?.tom).toBe("ok");
    expect(saudeDaLoja(l, true, diag(), true).saude).toBe("ok");
    const nunca = loja({ pixelCheckoutAtivo: false, pixelCheckoutVistoEm: null });
    expect(instalacaoDaLoja(nunca, diag(), false).itens.pixel?.valor).toBe("Faltando");
  });

  it("o limite de eventos e aviso sem botao", () => {
    const l = casos.teto.loja;
    expect(avisosDaLoja(l, instalacaoDaLoja(l, diag(), false))).toEqual([
      {
        tom: "warn",
        texto: "A loja passou do limite de eventos por hora nas últimas 24 h.",
        acao: null,
      },
    ]);
  });

  it("loja ligada sem pixel nenhum: o aviso abre o Adicionar pixel", () => {
    const nova = loja({ destinos: [] });
    expect(avisosDaLoja(nova, instalacaoDaLoja(nova, diag(), false)).map((a) => a.acao)).toContain(
      "adicionar"
    );
    // Com pixel cadastrado e desativado, adicionar outro nao e o caminho.
    const parada = loja({ destinos: [meta({ ativo: false })] });
    const avisos = avisosDaLoja(parada, instalacaoDaLoja(parada, diag(), false));
    expect(avisos).toContainEqual({ tom: "err", texto: "Nenhum pixel recebe a compra.", acao: null });
  });
});

describe("pontos da lista", () => {
  it("Meta: chegaram de esperados; Google: so a tag", () => {
    const l = linhaDaLoja(
      loja({
        destinos: [meta({ contagem: { pedidosComCompra: ["1", "2"] } as never }), google()],
      }),
      diag(),
      true
    );
    expect(pontosDaLinha(l).map((p) => [p.plataforma, p.tom, p.rotulo])).toEqual([
      ["meta", "warn", "Meta: 2 de 3 compras"],
      ["google", "ok", "Google Ads: tag ativa"],
    ]);
  });

  it("loja desligada nao tem ponto; a linha diz desligado", () => {
    const off = loja({ ligado: false });
    expect(pontosDaLinha(linhaDaLoja(off, null, false))).toEqual([]);
    expect(subDaLinha(off, null)).toBe("Rastreamento desligado");
    expect(subDaLinha(loja(), diag())).toBe("3 pedidos em 7 dias");
    expect(subDaLinha(loja(), null)).toBeNull();
  });

  it("modo teste, sem token e sem rotulo da compra ficam amarelos", () => {
    const tom = (l: LojaTracking) => pontosDaLinha(linhaDaLoja(l, diag(), true))[0].tom;
    expect(tom(casos.soMetaEmTeste.loja)).toBe("warn");
    expect(tom(loja({ destinos: [meta({ temToken: false, completo: false })] }))).toBe("warn");
    expect(tom(loja({ destinos: [google({ labels: { add_to_cart: "x" } })] }))).toBe("warn");
  });

  it("nenhuma compra chegou fica vermelho", () => {
    const c = casos.faltandoComRecusa;
    expect(pontosDaLinha(linhaDaLoja(c.loja, c.diag, true))[0].tom).toBe("err");
  });
});

describe("compras do pixel", () => {
  it("Meta: chegaram de esperados; falha de leitura nunca vira zero", () => {
    expect(comprasDoPixel(destino(), loja(), diag())).toBe("3 de 3 compras");
    const l = casos.contagemIndisponivel.loja;
    expect(comprasDoPixel(l.destinos[0], l, diag())).toBe("—");
    expect(comprasDoPixel(destino(), loja(), null)).toBe("3 compras");
  });

  it("Google: nunca numero do servidor", () => {
    const g = google();
    expect(comprasDoPixel(g, loja({ destinos: [g] }), diag())).toBe("pela tag");
  });
});

describe("ordem e numeros do topo", () => {
  const linhas = [
    linhaDaLoja(loja({ storeId: "ok" }), diag(), true),
    linhaDaLoja(loja({ storeId: "off", ligado: false }), null, false),
    linhaDaLoja(loja({ storeId: "warn", pixelCheckoutAtivo: false, pixelCheckoutVistoEm: null }), diag(), true),
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
      porPlataforma: { meta: { chegaram: 7, esperados: 9, lojas: 3 }, google: null },
      lojasForaDaCobertura: 0,
    });
  });

  it("o Google pela tag nao entra na cobertura nem esconde o Meta sem receber", () => {
    const l = linhaDaLoja(
      loja({
        destinos: [google(), meta({ contagem: { pedidosComCompra: [] } as never })],
      }),
      diag(),
      true
    );
    const r = resumoDaTela([l], { s1: diag() });
    expect(r.porPlataforma.meta).toEqual({ chegaram: 0, esperados: 3, lojas: 1 });
    expect(r.porPlataforma.google).toBeNull();
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
    expect(r.porPlataforma).toEqual({ meta: null, google: null, tiktok: null });
  });

  it("formata como o lojista le", () => {
    expect(formatarFracao(0.745)).toBe("74,5%");
  });

  it("com varias contas vale a pior", () => {
    const l = loja({
      destinos: [
        destino({ id: "a" }),
        destino({ id: "b", contagem: { pedidosComCompra: ["1"] } as never }),
      ],
    });
    expect(colunaDaPlataforma(l, diag(), "meta")).toMatchObject({
      tipo: "razao",
      chegaram: 1,
      esperados: 3,
      faltam: 2,
      contas: 2,
    });
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

// ---------------------------------------------------------------------------
// O Google sai do navegador, pela tag do Google: a coluna dele mostra a tag,
// nunca "x de y" do servidor, e linha 'google' antiga na fila nao vira falha.
// ---------------------------------------------------------------------------
describe("Google pela tag", () => {
  it("a coluna diz tag ativa, sem contagem", () => {
    const l = loja({ destinos: [google(), google({ id: "g2", conta: "AW-2" })] });
    expect(colunaDaPlataforma(l, diag(), "google")).toEqual({ tipo: "tag", contas: 2 });
    expect(pontosDaLinha(linhaDaLoja(l, diag(), true))).toEqual([
      { plataforma: "google", tom: "ok", rotulo: "Google Ads: tag ativa" },
    ]);
  });

  it("so Google: nada a fazer, e as compras enviadas nao contam o Google", () => {
    const l = linhaDaLoja(
      loja({
        destinos: [
          google({
            contagem: {
              porEvento: { purchase: 9 },
              falharam: 3,
              ultimoErro: "o Google vai pelo navegador (tag do Google), não pelo servidor",
            } as never,
          }),
        ],
      }),
      diag(),
      true
    );
    expect(l.saude).toBe("ok");
    expect(estadoDoPixel(l.loja.destinos[0], l.loja, diag())).toMatchObject({
      nota: null,
      tom: "ok",
    });
    expect(resumoDaTela([l], { s1: diag() }).enviadas).toBe(0);
  });
});
