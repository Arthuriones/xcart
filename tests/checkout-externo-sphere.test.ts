import { describe, expect, it } from "vitest";
import {
  CODIGO_TESTE,
  exemploSphere,
  lerData,
  lerSphere,
  lerValor,
  sphere,
} from "@/lib/checkouts-externos/plataformas/sphere";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";

// Adaptador da Sphere Affiliates: o corpo do webhook (doc da aba Webhooks)
// vira o EventoNormalizado. O valor vai direto para o lucro, entao a
// validacao e dura: string decimal, moeda ISO, data na janela.

const AGORA = new Date("2026-07-16T15:00:00.000Z");

/** O exemplo real da doc da Sphere. */
const DOC = {
  evento: "comissao.aprovada",
  data_evento: "2026-07-16T14:32:05.000Z",
  webhook_id: 3,
  pedido: {
    id: 12345,
    status: "created",
    metodo_pagamento: "cod",
    produto: "EVOX 3+3 Grátis",
    pais: "IT",
    moeda: "EUR",
    valor: "89.90",
    criado_em: "2026-07-14T10:15:00.000Z",
  },
  comissao: { valor: "75.00", status: "approved" },
  afiliado: { codigo: "ywq2mdhu", programa_id: "the-box-italia" },
};

function com(mudar: (c: typeof DOC) => unknown) {
  const c = structuredClone(DOC);
  return mudar(c) ?? c;
}

describe("lerSphere: o corpo da doc", () => {
  it("vira o evento normalizado, com valores em numero", () => {
    const r = lerSphere(DOC, AGORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento).toEqual({
      evento: "comissao.aprovada",
      dataEvento: "2026-07-16T14:32:05.000Z",
      pedidoId: "12345",
      pedido: {
        status: "created",
        metodo: "cod",
        produto: "EVOX 3+3 Grátis",
        pais: "IT",
        moeda: "EUR",
        valor: 89.9,
        criadoEm: "2026-07-14T10:15:00.000Z",
      },
      receita: { valor: 75, moeda: null, situacao: "aprovado", statusOriginal: "approved" },
      conta: "ywq2mdhu",
      programa: "the-box-italia",
      teste: false,
    });
  });

  it("o status da comissao manda na situacao", () => {
    const casos: [string, string][] = [
      ["pending", "pendente"],
      ["approved", "aprovado"],
      ["paid", "pago"],
      ["expired", "expirado"],
      ["reversed", "revertido"],
      ["PAID", "pago"],
    ];
    for (const [status, situacao] of casos) {
      const r = lerSphere(com((c) => void (c.comissao.status = status)), AGORA);
      expect(r.ok && r.evento.receita.situacao).toBe(situacao);
    }
  });

  it("sem status (ou status desconhecido), vale o evento", () => {
    const casos: [string, string][] = [
      ["pedido.criado", "pendente"],
      ["comissao.aprovada", "aprovado"],
      ["comissao.paga", "pago"],
      ["pedido.expirado", "expirado"],
    ];
    for (const [evento, situacao] of casos) {
      const semStatus = com((c) => {
        c.evento = evento;
        (c.comissao as Record<string, unknown>).status = undefined;
      });
      const r = lerSphere(semStatus, AGORA);
      expect(r.ok && r.evento.receita.situacao).toBe(situacao);
      const estranho = lerSphere(com((c) => ((c.evento = evento), (c.comissao.status = "on_hold"), c)), AGORA);
      expect(estranho.ok && estranho.evento.receita.situacao).toBe(situacao);
    }
  });

  it("evento novo da Sphere com status conhecido passa; sem nenhum dos dois, nao", () => {
    expect(lerSphere(com((c) => void (c.evento = "comissao.estornada")), AGORA).ok).toBe(true);
    const r = lerSphere(com((c) => ((c.evento = "comissao.estornada"), (c.comissao.status = "x"), c)), AGORA);
    expect(r).toEqual({ ok: false, erro: "evento desconhecido: comissao.estornada" });
  });

  it("pais e moeda em minusculo sao normalizados; pais torto vira null", () => {
    const r = lerSphere(com((c) => ((c.pedido.moeda = "eur"), (c.pedido.pais = "it"), c)), AGORA);
    expect(r.ok && [r.evento.pedido.moeda, r.evento.pedido.pais]).toEqual(["EUR", "IT"]);
    const p = lerSphere(com((c) => void (c.pedido.pais = "ITA")), AGORA);
    expect(p.ok && p.evento.pedido.pais).toBeNull();
  });

  it("id do pedido pode vir como texto", () => {
    const r = lerSphere(com((c) => void ((c.pedido as Record<string, unknown>).id = "SPH-12345")), AGORA);
    expect(r.ok && r.evento.pedidoId).toBe("SPH-12345");
  });

  it("sem data_evento vale agora; sem criado_em vale a data do evento", () => {
    const r = lerSphere(
      com((c) => {
        (c as Record<string, unknown>).data_evento = undefined;
        (c.pedido as Record<string, unknown>).criado_em = undefined;
      }),
      AGORA
    );
    expect(r.ok && [r.evento.dataEvento, r.evento.pedido.criadoEm]).toEqual([AGORA.toISOString(), AGORA.toISOString()]);
  });
});

describe("lerSphere: recusa", () => {
  const erros: [string, unknown][] = [
    ["corpo que nao e objeto", []],
    ["sem evento", com((c) => void ((c as Record<string, unknown>).evento = ""))],
    ["sem pedido", com((c) => void ((c as Record<string, unknown>).pedido = null))],
    ["sem id", com((c) => void ((c.pedido as Record<string, unknown>).id = undefined))],
    ["id com espaco", com((c) => void ((c.pedido as Record<string, unknown>).id = "1 2"))],
    ["id negativo", com((c) => void ((c.pedido as Record<string, unknown>).id = -5))],
    ["moeda que nao e ISO", com((c) => void (c.pedido.moeda = "EURO"))],
    ["valor que nao e numero", com((c) => void (c.pedido.valor = "abc"))],
    ["comissao negativa", com((c) => void (c.comissao.valor = "-1.00"))],
    ["comissao acima do teto", com((c) => void (c.comissao.valor = "100000.01"))],
    ["comissao com milhar", com((c) => void (c.comissao.valor = "1.234,50"))],
    ["data_evento que nao e ISO", com((c) => void (c.data_evento = "16/07/2026"))],
    ["data_evento de mais de 400 dias", com((c) => void (c.data_evento = "2025-05-01T00:00:00.000Z"))],
    ["data_evento no futuro", com((c) => void (c.data_evento = "2026-07-18T00:00:00.000Z"))],
    ["criado_em invalido", com((c) => void (c.pedido.criado_em = "ontem"))],
  ];
  for (const [nome, corpo] of erros) {
    it(nome, () => {
      expect(lerSphere(corpo, AGORA).ok).toBe(false);
    });
  }
});

describe("valores e datas", () => {
  it("string decimal vira numero, com virgula europeia", () => {
    expect(lerValor("89.90")).toBe(89.9);
    expect(lerValor("89,90")).toBe(89.9);
    expect(lerValor("75")).toBe(75);
    expect(lerValor(12.345)).toBe(12.35);
    expect(lerValor("")).toBe(0);
    expect(lerValor(null)).toBe(0);
    expect(lerValor("1e3")).toBeNull();
    expect(lerValor(Number.NaN)).toBeNull();
    expect(lerValor({})).toBeNull();
  });

  it("data vai para UTC e respeita a janela", () => {
    expect(lerData("2026-07-16T16:32:05+02:00", AGORA)).toBe("2026-07-16T14:32:05.000Z");
    expect(lerData("2026-07-16", AGORA)).toBeNull();
    expect(lerData(123, AGORA)).toBeNull();
  });
});

describe("evento de teste", () => {
  it("o exemplo do xcart e lido e vem marcado como teste", () => {
    const r = lerSphere(exemploSphere(AGORA), AGORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.evento.teste).toBe(true);
    expect(r.evento.conta).toBe(CODIGO_TESTE);
  });

  it("a doc nao e teste; o codigo de teste em qualquer evento e", () => {
    const doc = lerSphere(DOC, AGORA);
    expect(doc.ok).toBe(true);
    expect(doc.ok && doc.evento.teste).toBe(false);
    const r = lerSphere(com((c) => void (c.afiliado.codigo = CODIGO_TESTE)), AGORA);
    expect(r.ok && r.evento.teste).toBe(true);
  });

  it("o registro de plataformas acha a Sphere e so ela", () => {
    expect(plataformaDe("sphere")).toBe(sphere);
    expect(plataformaDe("yampi")).toBeNull();
    expect(plataformaDe(null)).toBeNull();
    expect(sphere.gatilhos).toEqual(["pedido.criado", "pedido.expirado", "comissao.aprovada", "comissao.paga"]);
  });
});
