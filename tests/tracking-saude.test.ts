import { describe, expect, it } from "vitest";
import type { DestinoNaTela, LojaTracking } from "../src/lib/tracking/queries";
import type { DiagnosticoLoja } from "../src/lib/tracking/diagnostico";
import {
  faltasDaLoja,
  pedidosEsperados,
  pedidosSemCompra,
  saudeDaLoja,
  textoProblema,
  vereditoDoDestino,
} from "../src/app/(dashboard)/tracking/saude";

// A saude decide a cor do card, a ordem das lojas e o "Precisam de voce" do
// topo. Os fixtures cobrem os estados que a tela distingue; o que importa
// travar e que "chegaram" e o alarme usam a mesma regra, e que falha de LEITURA
// nunca vira loja "Parado".

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

/** Os fixtures da tela, com a loja ligada e o diagnostico da carga. */
const casos: Record<string, { loja: LojaTracking; diag: DiagnosticoLoja | null }> = {
  tudoOk: { loja: loja(), diag: diag() },
  umPedidoFaltando: {
    loja: loja({
      destinos: [destino({ contagem: { pedidosComCompra: ["1", "2"] } as never })],
    }),
    diag: diag(),
  },
  contagemIndisponivel: {
    loja: loja({
      contagemIndisponivel: true,
      destinos: [destino({ contagem: { pedidosComCompra: [], porEvento: {} } as never })],
    }),
    diag: diag(),
  },
  destinoNovo: {
    // Cadastrado depois do pedido 1: esse pedido nao tinha como ter ido.
    loja: loja({
      destinos: [
        destino({
          criadoEm: "2026-09-20T12:00:00Z",
          contagem: { pedidosComCompra: ["2", "3"] } as never,
        }),
      ],
    }),
    diag: diag(),
  },
  soMetaEmTeste: {
    loja: loja({
      destinos: [
        destino({
          id: "m1",
          plataforma: "meta",
          labels: {},
          temToken: true,
          testEventCode: "TEST1",
        }),
      ],
    }),
    diag: diag(),
  },
  desinstalada: { loja: loja({ desinstalada: true }), diag: diag() },
  negado: {
    loja: loja(),
    diag: diag({
      pedidos7d: null,
      pedidoIds: null,
      pedidoCriadoEm: null,
      problema: "denied",
    }),
  },
  remarketingDesligado: { loja: loja(), diag: diag({ temRemarketing: false }) },
};

describe("saude da loja", () => {
  it("esperados - faltam nunca fica negativo", () => {
    for (const [nome, { loja: l, diag: d }] of Object.entries(casos)) {
      for (const dest of l.destinos) {
        const esperados = pedidosEsperados(dest, d);
        const faltam = pedidosSemCompra(dest, d);
        if (esperados === null || faltam === null) continue;
        expect(esperados - faltam, nome).toBeGreaterThanOrEqual(0);
        const v = vereditoDoDestino(dest, l, d);
        if (v.tipo === "razao") expect(v.chegaram, nome).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("pedido anterior ao destino sai de esperados E de faltam", () => {
    const { loja: l, diag: d } = casos.destinoNovo;
    const dest = l.destinos[0];
    expect(pedidosEsperados(dest, d)).toBe(2);
    expect(pedidosSemCompra(dest, d)).toBe(0);
    expect(vereditoDoDestino(dest, l, d)).toEqual({
      tipo: "razao",
      esperados: 2,
      faltam: 0,
      chegaram: 2,
    });
    expect(saudeDaLoja(l, true, d, true).saude).toBe("ok");
  });

  it("tudo ok", () => {
    const { loja: l, diag: d } = casos.tudoOk;
    expect(saudeDaLoja(l, true, d, true)).toEqual({ saude: "ok", motivos: [], faltas: [] });
    expect(vereditoDoDestino(l.destinos[0], l, d)).toEqual({
      tipo: "razao",
      esperados: 3,
      faltam: 0,
      chegaram: 3,
    });
  });

  it("um pedido sem compra para a loja", () => {
    const { loja: l, diag: d } = casos.umPedidoFaltando;
    const s = saudeDaLoja(l, true, d, true);
    expect(s.saude).toBe("parado");
    expect(s.faltas).toHaveLength(1);
    expect(s.motivos[0]).toEqual({
      tom: "err",
      texto: '1 pedido sem compra enviada em Google "Principal"',
    });
  });

  it("contagem indisponivel nao vira alarme de pedido perdido", () => {
    const { loja: l, diag: d } = casos.contagemIndisponivel;
    expect(faltasDaLoja(l, d)).toEqual([]);
    const s = saudeDaLoja(l, true, d, true);
    expect(s.saude).not.toBe("parado");
    expect(s.saude).toBe("atencao");
    expect(vereditoDoDestino(l.destinos[0], l, d)).toEqual({ tipo: "sem-contagem" });
  });

  it("parado se e somente se ha falta ou outro motivo de erro", () => {
    for (const [nome, { loja: l, diag: d }] of Object.entries(casos)) {
      const s = saudeDaLoja(l, true, d, true);
      const temErro = s.faltas.length > 0 || s.motivos.some((m) => m.tom === "err");
      expect(s.saude === "parado", nome).toBe(temErro);
    }
  });

  it("so Meta em modo teste pede atencao, nao para a loja", () => {
    const { loja: l, diag: d } = casos.soMetaEmTeste;
    const s = saudeDaLoja(l, true, d, true);
    expect(s.saude).toBe("atencao");
    expect(s.motivos[0].texto).toBe(
      "Só em modo teste — compras ainda não contam como conversão"
    );
  });

  it("app desinstalado para a loja", () => {
    const { loja: l, diag: d } = casos.desinstalada;
    const s = saudeDaLoja(l, true, d, true);
    expect(s.saude).toBe("parado");
    expect(s.motivos[0].texto).toBe("App desinstalado — nada está sendo enviado");
  });

  it("diagnostico negado: atencao, e o veredito cai para compras enviadas", () => {
    const { loja: l, diag: d } = casos.negado;
    const s = saudeDaLoja(l, true, d, true);
    expect(s.saude).toBe("atencao");
    expect(s.motivos.map((m) => m.texto)).toContain(
      "Não deu para conferir os pedidos na Shopify"
    );
    expect(vereditoDoDestino(l.destinos[0], l, d)).toEqual({
      tipo: "sem-pedidos",
      compras: 3,
    });
  });

  it("remarketing desligado nao muda a saude", () => {
    const com = saudeDaLoja(casos.tudoOk.loja, true, casos.tudoOk.diag, true);
    const sem = saudeDaLoja(
      casos.remarketingDesligado.loja,
      true,
      casos.remarketingDesligado.diag,
      true
    );
    expect(sem).toEqual(com);
  });

  it("loja ligada nesta sessao (sem diagnostico) nao acusa falha de conferencia", () => {
    const l = loja({ ligado: false });
    const s = saudeDaLoja(l, true, null, false);
    expect(s.motivos.map((m) => m.texto)).not.toContain(
      "Não deu para conferir os pedidos na Shopify"
    );
    expect(s.saude).toBe("ok");
    // Com a loja ligada na carga e sem diagnostico, a falha aparece.
    expect(saudeDaLoja(loja(), true, null, true).saude).toBe("atencao");
  });

  it("desligada e desligada, sem motivo", () => {
    expect(saudeDaLoja(casos.umPedidoFaltando.loja, false, casos.umPedidoFaltando.diag, true))
      .toEqual({ saude: "desligado", motivos: [], faltas: [] });
  });
});

describe("textoProblema", () => {
  it("traduz o codigo do diagnostico", () => {
    expect(textoProblema("denied")).toBe(
      "A loja não deu permissão para o app ler os pedidos."
    );
    expect(textoProblema("failed")).toBe("A Shopify não respondeu a tempo.");
    expect(textoProblema(null)).toBe("Webhook, tema e pedidos ficaram sem verificar.");
    expect(textoProblema("loja sem credencial do app")).toBe(
      "Loja sem credencial do app"
    );
  });
});
