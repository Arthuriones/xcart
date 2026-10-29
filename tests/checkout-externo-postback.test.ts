import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { casarPeloId, casarPostback, lerPostback, origemDoAnuncio, JANELA_POSTBACK_MS } from "@/lib/checkouts-externos/postback";
import { decidirPostbacks, receberPostback } from "@/lib/checkouts-externos/postback-supabase";
import { montarPedidosExternos } from "@/lib/checkouts-externos/pedidos";
import { SUFIXO_POSTBACK_SPHERE, type PedidoExternoRow } from "@/lib/checkouts-externos/tipos";
import { idDe, nomeDe } from "@/lib/tracking/utm";
import { fakeSupabase } from "./_fake-supabase";

// O postback da Sphere (086): o webhook dela nao traz o clique, o postback
// GET do programa traz o sub1 (`{clickid}`, o id do anuncio nos url_tags).
// Casa com o pedido pelo `{t}` na hora, ou pela hora do aviso do webhook so
// com a janela fechada (o cron). Atribuir errado e pior que nao atribuir:
// dois na janela, comissao diferente ou aviso sem pedido = nao casa.

const CK = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const ANUNCIO = "120255889731580350";
const CONJUNTO = "120255889728880350";
const CAMPANHA = "120255889727850350";

const q = (s: string) => new URLSearchParams(s);

describe("lerPostback", () => {
  it("le o que a URL do xcart manda; o clickid so vira anuncio se for id", () => {
    const r = lerPostback(q(`clickid=${ANUNCIO}&t=6824013332735&sum=33.00&currency=eur&status=Approved&type=Purchase`));
    expect(r).toEqual({
      ok: true,
      postback: {
        clickid: ANUNCIO,
        anuncioId: ANUNCIO,
        pedidoRef: "6824013332735",
        soma: 33,
        moeda: "EUR",
        status: "approved",
      },
    });
    const hex = lerPostback(q("clickid=6ad52420b4af675a77481833&type=Purchase"));
    expect(hex.ok && hex.postback.anuncioId).toBeNull();
    expect(hex.ok && hex.postback.clickid).toBe("6ad52420b4af675a77481833");
  });

  it("macro sem trocar, e-mail e lixo nao entram", () => {
    const r = lerPostback(q("clickid={clickid}&t=a b&sum=abc&currency=EURO&status=x@y.com"));
    expect(r.ok && r.postback).toEqual({
      clickid: null,
      anuncioId: null,
      pedidoRef: null,
      soma: null,
      moeda: null,
      status: null,
    });
  });

  it("o postback de InitiateCheckout fica de fora (nao tem pedido)", () => {
    expect(lerPostback(q(`clickid=${ANUNCIO}&type=InitiateCheckout&sum=0`))).toEqual({ ok: false, ignorado: "tipo" });
    // Outro nome de compra ainda e compra.
    expect(lerPostback(q(`clickid=${ANUNCIO}&type=Purchase%20(COD)`)).ok).toBe(true);
  });

  it("recusa nao entra: sai na hora da recusa, sem aviso do pedido ao lado", () => {
    expect(lerPostback(q(`clickid=${ANUNCIO}&status=declined&type=Purchase`))).toEqual({ ok: false, ignorado: "status" });
    expect(lerPostback(q(`clickid=${ANUNCIO}&status=Cancelled`))).toEqual({ ok: false, ignorado: "status" });
  });

  it("a URL que a tela da e a que a rota le", () => {
    expect(SUFIXO_POSTBACK_SPHERE.startsWith("?")).toBe(true);
    const chaves = [...new URLSearchParams(SUFIXO_POSTBACK_SPHERE.slice(1)).keys()];
    expect(chaves).toEqual(["clickid", "t", "sum", "currency", "status", "type"]);
  });
});

describe("casarPostback (janela ja fechada)", () => {
  const T = Date.parse("2026-10-29T19:46:13Z");
  const c = (pedidoId: string, avisosMs: number[], receita: number | null = 33, gravado = true) => ({
    pedidoId,
    gravado,
    receita: gravado ? receita : null,
    avisosMs,
  });
  const p = (x: Partial<{ pedidoRef: string | null; soma: number | null }> = {}) => ({
    recebidoMs: T,
    pedidoRef: null,
    soma: null,
    ...x,
  });

  it("o `{t}` igual ao id do pedido casa direto, fora da janela", () => {
    expect(casarPostback(p({ pedidoRef: "34190" }), [c("34190", []), c("34191", [T])])).toEqual({ tipo: "casado", pedidoId: "34190" });
    expect(casarPeloId("34190", [c("34190", [], 33, false)])).toBeNull();
  });

  it("um pedido com aviso na janela casa; nenhum, nao casa", () => {
    expect(casarPostback(p(), [c("34190", [T - 5_000])])).toEqual({ tipo: "casado", pedidoId: "34190" });
    expect(casarPostback(p(), [c("34190", [T - JANELA_POSTBACK_MS - 1])])).toEqual({ tipo: "nenhum" });
    expect(casarPostback(p(), [])).toEqual({ tipo: "nenhum" });
  });

  it("o aviso do proprio pedido chegou DEPOIS do postback: com a janela fechada os dois contam", () => {
    // B (outra pessoa) 1 min antes; A, o do postback, 1 s depois.
    expect(casarPostback(p(), [c("B", [T - 60_000]), c("A", [T + 1_000])])).toEqual({ tipo: "ambiguo" });
  });

  it("comissao diferente do {sum} nao e o pedido; mesma comissao nos dois nao casa", () => {
    const dois = [c("1", [T - 1_000], 33), c("2", [T + 2_000], 28)];
    expect(casarPostback(p(), dois)).toEqual({ tipo: "ambiguo" });
    expect(casarPostback(p({ soma: 28 }), dois)).toEqual({ tipo: "casado", pedidoId: "2" });
    expect(casarPostback(p({ soma: 33 }), [c("1", [T], 33), c("2", [T], 33)])).toEqual({ tipo: "ambiguo" });
    expect(casarPostback(p({ soma: 10 }), dois)).toEqual({ tipo: "nenhum" });
    expect(casarPostback(p({ soma: 33 }), [c("1", [T], 28)])).toEqual({ tipo: "nenhum" });
  });

  it("aviso sem pedido gravado ainda: espera, nunca deixa o outro sozinho", () => {
    expect(casarPostback(p(), [c("B", [T - 60_000]), c("A", [T - 1_000], null, false)])).toEqual({ tipo: "esperar" });
  });
});

describe("origemDoAnuncio", () => {
  it("nome|id do anuncio, do conjunto e da campanha, no formato que o xcart le", () => {
    const o = origemDoAnuncio(ANUNCIO, {
      plataforma: "meta",
      anuncioNome: "V7",
      conjuntoId: CONJUNTO,
      conjuntoNome: "PT | V7",
      campanhaId: CAMPANHA,
      campanhaNome: "[FB] [CA 02] [MANDURA] [PT]",
    });
    expect(o).toEqual({
      utm_source: "facebook",
      utm_medium: `PT | V7|${CONJUNTO}`,
      utm_campaign: `[FB] [CA 02] [MANDURA] [PT]|${CAMPANHA}`,
      utm_content: `V7|${ANUNCIO}`,
      utm_term: null,
      campanha_id: CAMPANHA,
      conjunto_id: CONJUNTO,
      anuncio_id: ANUNCIO,
    });
    expect(nomeDe(o.utm_medium)).toBe("PT | V7");
    expect(idDe(o.utm_medium)).toBe(CONJUNTO);
  });

  it("anuncio que a sincronizacao nao viu fica so com o id", () => {
    expect(origemDoAnuncio(ANUNCIO, null)).toMatchObject({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: ANUNCIO,
      anuncio_id: ANUNCIO,
      campanha_id: null,
    });
  });

  it("nome comprido nao corta o id; nome com e-mail fica so com o id", () => {
    const o = origemDoAnuncio(ANUNCIO, {
      plataforma: "meta",
      anuncioNome: "x".repeat(400),
      conjuntoId: null,
      conjuntoNome: null,
      campanhaId: CAMPANHA,
      campanhaNome: "promo a@b.com",
    });
    expect(idDe(o.utm_content)).toBe(ANUNCIO);
    expect(o.utm_content!.length).toBeLessThanOrEqual(200);
    expect(o.utm_campaign).toBe(CAMPANHA);
  });
});

describe("receberPostback e decidirPostbacks (banco)", () => {
  const T = "2026-10-29T19:46:20.000Z";
  const AGORA = new Date(T);
  /** O cron, com a janela do postback ja fechada. */
  const DEPOIS = new Date(Date.parse(T) + JANELA_POSTBACK_MS + 60_000);
  const pedido = (id: string, extra: Record<string, unknown> = {}) => ({
    checkout_id: CK,
    pedido_id: id,
    receita: "33.00",
    anuncio_id: null,
    conjunto_id: null,
    campanha_id: null,
    utm_campaign: null,
    utm_content: null,
    ...extra,
  });
  const aviso = (id: string, recebido: string, evento = "pedido.criado") => ({ checkout_id: CK, pedido_id: id, evento, recebido_em: recebido });
  const granular = {
    user_id: USER,
    nivel: "anuncio",
    objeto_id: ANUNCIO,
    data: "2026-10-29",
    plataforma: "meta",
    objeto_nome: "V7",
    grupo_id: CONJUNTO,
    grupo_nome: "PT | V7",
    campanha_id: CAMPANHA,
    campanha_nome: "[FB] [MANDURA]",
  };
  const lido = (extra: Record<string, unknown> = {}) => ({
    clickid: ANUNCIO,
    anuncioId: ANUNCIO,
    pedidoRef: "6824013332735",
    soma: 33,
    moeda: "EUR",
    status: "approved",
    ...extra,
  });
  const ck = { id: CK, user_id: USER };
  const banco = (eventos: Record<string, unknown>[], pedidos: Record<string, unknown>[]) =>
    fakeSupabase({
      checkouts_externos: [{ id: CK, user_id: USER }],
      checkout_externo_eventos: eventos,
      pedidos_externos: pedidos,
      ad_insights_granular: [granular],
    });

  it("o `{t}` e o id do pedido: casa na chegada, com os nomes do anuncio", async () => {
    const db = banco([], [pedido("34190")]);
    expect(await receberPostback(db.client, ck, lido({ pedidoRef: "34190" }), AGORA)).toBe("casado");
    expect(db.tabelas.pedidos_externos[0]).toMatchObject({
      utm_source: "facebook",
      utm_content: `V7|${ANUNCIO}`,
      utm_medium: `PT | V7|${CONJUNTO}`,
      utm_campaign: `[FB] [MANDURA]|${CAMPANHA}`,
      anuncio_id: ANUNCIO,
      conjunto_id: CONJUNTO,
      campanha_id: CAMPANHA,
    });
    expect(db.tabelas.checkout_externo_postbacks[0]).toMatchObject({ situacao: "casado", pedido_id: "34190", clickid: ANUNCIO });
  });

  it("pela hora, NADA decide na chegada: o cron decide com a janela fechada", async () => {
    const db = banco([aviso("34190", "2026-10-29T19:46:13.099Z")], [pedido("34190")]);
    expect(await receberPostback(db.client, ck, lido(), AGORA)).toBe("pendente");
    expect(db.tabelas.pedidos_externos[0].anuncio_id).toBeNull();

    // Antes de a janela fechar o cron nao pega.
    expect((await decidirPostbacks(db.client, new Date(Date.parse(T) + 60_000))).casado).toBe(0);
    expect((await decidirPostbacks(db.client, DEPOIS)).casado).toBe(1);
    expect(db.tabelas.pedidos_externos[0]).toMatchObject({ anuncio_id: ANUNCIO, campanha_id: CAMPANHA });
    expect(db.tabelas.checkout_externo_postbacks[0]).toMatchObject({ situacao: "casado", pedido_id: "34190" });
  });

  it("o postback chegou antes do aviso do proprio pedido: nunca vai para o pedido de outra pessoa", async () => {
    // B (outra pessoa) 1 min antes; o aviso de A chega 1 s depois do postback.
    const db = banco([aviso("B", "2026-10-29T19:45:20.000Z")], [pedido("B")]);
    expect(await receberPostback(db.client, ck, lido(), AGORA)).toBe("pendente");
    db.tabelas.checkout_externo_eventos.push(aviso("A", "2026-10-29T19:46:21.000Z"));
    db.tabelas.pedidos_externos.push(pedido("A"));
    expect((await decidirPostbacks(db.client, DEPOIS)).ambiguo).toBe(1);
    expect(db.tabelas.pedidos_externos.every((p) => p.anuncio_id === null)).toBe(true);
  });

  it("aprovacao e pagamento de pedido antigo nao contam; aviso sem pedido gravado faz esperar", async () => {
    const db = banco(
      [aviso("velho", "2026-10-29T19:46:00.000Z", "comissao.paga"), aviso("34190", "2026-10-29T19:46:19.000Z")],
      [pedido("velho"), pedido("34190")]
    );
    await receberPostback(db.client, ck, lido(), AGORA);
    expect((await decidirPostbacks(db.client, DEPOIS)).casado).toBe(1);
    expect(db.tabelas.pedidos_externos.find((p) => p.pedido_id === "34190")!.anuncio_id).toBe(ANUNCIO);
    expect(db.tabelas.pedidos_externos.find((p) => p.pedido_id === "velho")!.anuncio_id).toBeNull();

    const meio = banco([aviso("B", "2026-10-29T19:45:20.000Z"), aviso("A", "2026-10-29T19:46:19.000Z")], [pedido("B")]);
    await receberPostback(meio.client, ck, lido(), AGORA);
    expect((await decidirPostbacks(meio.client, DEPOIS)).pendente).toBe(1);
    expect(meio.tabelas.pedidos_externos[0].anuncio_id).toBeNull();
    expect(meio.tabelas.checkout_externo_postbacks[0].situacao).toBe("pendente");
  });

  it("pedido com outro anuncio: conflito, nada muda; com o mesmo: casado", async () => {
    const db = banco([], [pedido("34190", { anuncio_id: "111111111111", utm_content: "111111111111" })]);
    expect(await receberPostback(db.client, ck, lido({ pedidoRef: "34190" }), AGORA)).toBe("conflito");
    expect(db.tabelas.pedidos_externos[0]).toMatchObject({ anuncio_id: "111111111111", utm_content: "111111111111" });
    expect(db.tabelas.checkout_externo_postbacks[0]).toMatchObject({ situacao: "conflito", pedido_id: "34190" });

    const mesmo = banco([], [pedido("34190", { anuncio_id: ANUNCIO, utm_content: ANUNCIO })]);
    expect(await receberPostback(mesmo.client, ck, lido({ pedidoRef: "34190" }), AGORA)).toBe("casado");
  });

  it("sem pedido na janela: sem_pedido; clickid que nao e anuncio: sem_anuncio", async () => {
    const db = banco([], []);
    await receberPostback(db.client, ck, lido(), AGORA);
    expect((await decidirPostbacks(db.client, DEPOIS)).sem_pedido).toBe(1);
    expect(db.tabelas.checkout_externo_postbacks[0].situacao).toBe("sem_pedido");

    const hex = banco([aviso("34190", "2026-10-29T19:46:13Z")], [pedido("34190")]);
    expect(await receberPostback(hex.client, ck, lido({ clickid: "abc", anuncioId: null }), AGORA)).toBe("sem_anuncio");
    expect((await decidirPostbacks(hex.client, DEPOIS)).casado).toBe(0);
    expect(hex.tabelas.pedidos_externos[0].anuncio_id).toBeNull();
  });

  it("falha de banco LANCA (a rota responde 503; o drain registra)", async () => {
    const db = fakeSupabase({}, (tabela, op) => (tabela === "checkout_externo_postbacks" && op === "insert" ? { message: "fora" } : null));
    await expect(receberPostback(db.client, ck, lido(), AGORA)).rejects.toThrow(/postback/);
    const fora = fakeSupabase({}, () => ({ message: "fora" }));
    await expect(decidirPostbacks(fora.client, DEPOIS)).rejects.toThrow(/postbacks/);
  });

  it("o cron apaga o que passou dos 30 dias", async () => {
    const db = fakeSupabase({
      checkout_externo_postbacks: [
        { id: 1, checkout_id: CK, recebido_em: "2026-09-01T00:00:00.000Z", situacao: "casado" },
        { id: 2, checkout_id: CK, recebido_em: "2026-10-29T19:00:00.000Z", situacao: "casado" },
      ],
    });
    await decidirPostbacks(db.client, AGORA);
    expect(db.tabelas.checkout_externo_postbacks.map((p) => p.id)).toEqual([2]);
  });
});

describe("Pedidos da Sphere com a origem do postback", () => {
  it("a linha da comissao mostra a campanha e o anuncio", () => {
    const base: PedidoExternoRow = {
      checkout_id: CK,
      user_id: USER,
      pedido_id: "34190",
      situacao: "pendente",
      status_comissao: "pending",
      status_pedido: "created",
      metodo_pagamento: "cod",
      produto: "Pedido Manual",
      pais: "PT",
      programa: "dtc-ed-portugal",
      moeda: "EUR",
      valor: "62.00",
      receita: "33.00",
      moeda_receita: "EUR",
      criado_em: "2026-10-29T19:39:00Z",
      dia_local: "2026-10-29",
      aprovado_em: null,
      pago_em: null,
      perdido_em: null,
      atualizado_em: "2026-10-29T19:39:00Z",
      versao: 0,
    };
    const { linhas } = montarPedidosExternos({
      pedidos: [
        { ...base, utm_campaign: `[FB] [MANDURA]|${CAMPANHA}`, utm_content: `V7|${ANUNCIO}`, anuncio_id: ANUNCIO, campanha_id: CAMPANHA },
        { ...base, pedido_id: "34191", anuncio_id: ANUNCIO, utm_content: ANUNCIO },
        { ...base, pedido_id: "34192" },
      ],
      checkouts: [{ id: CK, nome: "Sphere", fuso: "America/Sao_Paulo", moeda_receita: "EUR" }],
      cambio: [],
      moeda: "EUR",
      intervalo: { desde: "2026-10-23", ate: "2026-10-29" },
      agoraMs: Date.parse("2026-10-29T20:00:00Z"),
    });
    const porPedido = Object.fromEntries(linhas.map((l) => [l.pedido, { campanha: l.campanha, anuncio: l.anuncio }]));
    expect(porPedido["#34190"]).toEqual({ campanha: "[FB] [MANDURA]", anuncio: "V7" });
    expect(porPedido["#34191"]).toEqual({ campanha: null, anuncio: ANUNCIO });
    expect(porPedido["#34192"]).toEqual({ campanha: null, anuncio: null });
  });
});
