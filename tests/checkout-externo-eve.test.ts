import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ID_TESTE, VERSAO, assinarEve, autenticarEve, eve, exemploEve, lerTodosEve } from "@/lib/checkouts-externos/plataformas/eve";
import { TOLERANCIA_FUTURO_S, TOLERANCIA_PASSADO_S } from "@/lib/checkouts-externos/plataformas/cakto";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import type { EventoNormalizado } from "@/lib/checkouts-externos/plataformas";
import {
  comoReenviar,
  comoTentaDeNovo,
  receberEvento,
  type CheckoutParaReceber,
  type MarcaCheckout,
  type PedidoGravado,
  type RepositorioCheckout,
} from "@/lib/checkouts-externos/receber";
import type { DestinoDoCheckout, EnvioGravado, EnvioNovo, RastreioCheckout } from "@/lib/checkouts-externos/compra";
import { vendaDoPedidoExterno } from "@/lib/checkouts-externos/notificar";
import { estadoDaVenda } from "@/lib/checkouts-externos/venda";
import { CONTAS_COM_EVE, plataformaLiberada, plataformasDaConta } from "@/lib/checkouts-externos/liberadas";
import {
  GATILHOS_EVE,
  HOST_DO_CHECKOUT,
  MOEDA_PADRAO,
  PLATAFORMAS_CHECKOUT,
  modeloDaPlataforma,
  nomeDoSegredo,
  rastreiaCompra,
  rotuloDoEvento,
  scriptDaPonteDoCheckout,
  usaSegredo,
} from "@/lib/checkouts-externos/tipos";
import { OPCOES_CONECTAR } from "@/lib/conectar-operacao";
import type { EventoCapi } from "@/lib/tracking/meta-capi";

// O Eve (PixKit): o checkout Pix PROPRIO do Arthur, terceiro checkout de
// venda. O contrato v1 (o mesmo do lado PHP): o estado inteiro do pedido a
// cada aviso, centavos inteiros, HMAC-SHA256 de "{timestamp}.{corpo cru}" no
// X-Eve-Signature. O status manda na situacao; o teste nunca vira pedido; CPF
// nunca e lido; e SO a conta do Arthur ve e cadastra.

const AGORA = new Date("2026-10-24T05:10:00.000Z");
const SECRET = "9f1c4e2a7b3d4c8ea1f52d6b8e0c3a719f1c4e2a7b3d4c8ea1f52d6b8e0c3a71";
const TOKEN_PEDIDO = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ARTHUR = "55c773d6-873a-456a-8695-296ff1433a53";
const OUTRA_CONTA = "0b7e3c2a-1d4f-4e5a-9b8c-7d6e5f4a3b2c";

const CRIADO = "2026-10-24T05:00:00.000Z";
const PAGO = "2026-10-24T05:03:10.000Z";
const VENCE = "2026-10-24T05:30:00.000Z";
const ENVIADO = "2026-10-24T05:09:00.000Z";
/** A trava do Pix gerado de aberto(): o prazo (VENCE em unix) e o total em centavos. */
const TRAVA_DO_PIX = `pix.gerado:${Math.floor(Date.parse(VENCE) / 1000)}:9700`;

/** Como o Eve escreve as datas (Y-m-d\TH:i:s\Z). */
const z = (iso: string) => `${iso.slice(0, 19)}Z`;

/** O que nunca pode aparecer em nada que o xcart grava ou loga. */
const DADOS_DO_COMPRADOR = ["Ana", "Souza", "ana.souza", "provedor.com.br", "5534988887777", "39053344705", "30140071", "Belo Horizonte"];

type Dados = Record<string, unknown>;

function pedido(extra: Dados = {}): Dados {
  return {
    id: TOKEN_PEDIDO,
    numero: 123,
    origem: "external",
    status: "paid",
    metodo: "pix",
    moeda: "BRL",
    subtotal_centavos: 9700,
    desconto_centavos: 0,
    frete_centavos: 0,
    total_centavos: 9700,
    criado_em: z(CRIADO),
    pago_em: z(PAGO),
    vence_em: z(VENCE),
    cancelado_em: null,
    reembolsado_em: null,
    atualizado_em: z(PAGO),
    itens: [{ id: "8123456789", titulo: "Panela Mônaco 5 peças", variante: "Grafite", quantidade: 1, preco_centavos: 9700, total_centavos: 9700 }],
    // O contrato nunca manda; se mandar, nada le.
    cpf: "39053344705",
    ...extra,
  };
}

/** O Pix acabou de ser gerado. */
function aberto(extra: Dados = {}): Dados {
  return pedido({ status: "pix_generated", pago_em: null, atualizado_em: z(CRIADO), ...extra });
}

function aviso(evento: string, p: Dados = pedido(), extra: Dados = {}): Dados {
  return {
    versao: 1,
    evento,
    enviado_em: z(ENVIADO),
    teste: false,
    loja: { id: "lj_9f8e7d6c", nome: "Panela Mônaco" },
    pedido: p,
    comprador: {
      nome: "Ana Souza",
      email: "Ana.Souza@provedor.com.br",
      telefone: "+5534988887777",
      cidade: "Belo Horizonte",
      estado: "MG",
      cep: "30140071",
      pais: "BR",
      cpf: "39053344705",
      documento: "39053344705",
    },
    rastreio: {
      utm_source: "FB",
      utm_medium: "120211234567890123",
      utm_campaign: "Campanha X|120219876543210987",
      utm_content: "Anuncio Y|120215555555555555",
      utm_term: "Instagram_Feed",
      src: "ig",
      sck: "lista-quente",
      fbclid: "IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
      gclid: null,
      ttclid: "E.C.P.1234567890abcdef1234567890abcdef",
      fbp: "fb.1.1761282000000.1234567890",
      fbc: "fb.1.1761282000000.IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
      url: "https://panelamonaco.shop/oferta",
    },
    ...extra,
  };
}

function ler(c: unknown, headers?: Headers, agora: Date = AGORA): EventoNormalizado[] {
  const r = lerTodosEve(c, agora, headers);
  if (!r.ok) throw new Error(r.erro);
  return r.eventos;
}

function lerUm(c: unknown, headers?: Headers): EventoNormalizado {
  const evs = ler(c, headers);
  expect(evs).toHaveLength(1);
  return evs[0];
}

function erroDe(c: unknown, headers?: Headers): string {
  const r = lerTodosEve(c, AGORA, headers);
  if (r.ok) throw new Error("esperava erro");
  return r.erro;
}

// ---------------------------------------------------------------------------
// O adaptador
// ---------------------------------------------------------------------------

describe("lerTodosEve: o estado inteiro do pedido vira o pedido do xcart", () => {
  it("pedido pago: valor e receita = total em reais, sem taxa; data do pagamento; o token e a cobranca", () => {
    const ev = lerUm(aviso("pedido.pago"));
    expect(ev).toMatchObject({
      evento: "pedido.pago",
      dataEvento: PAGO,
      pedidoId: TOKEN_PEDIDO,
      pedido: { status: "paid", metodo: "pix", produto: "Panela Mônaco 5 peças", pais: "BR", moeda: "BRL", valor: 97, criadoEm: CRIADO },
      receita: { valor: 97, moeda: "BRL", situacao: "pago", statusOriginal: "paid" },
      conta: null,
      programa: null,
      teste: false,
      venda: {
        taxa: null,
        comissoes: null,
        referencia: "123",
        grupo: TOKEN_PEDIDO,
        produtoId: "8123456789",
        ofertaTipo: "main",
        venceEm: VENCE,
        reembolsadoEm: null,
        chargebackEm: null,
        reembolsoPedidoEm: null,
        cobrancaGerada: false,
        recorrencia: false,
      },
    });
  });

  it("cada status: a situacao e a data da propria etapa", () => {
    const cancelado = "2026-10-24T05:30:05.000Z";
    const reembolsado = "2026-10-24T05:08:00.000Z";
    const casos: [string, Dados, string, string][] = [
      ["pix.gerado", aberto(), "pendente", CRIADO],
      ["pix.gerado", aberto({ status: "awaiting_payment" }), "pendente", CRIADO],
      ["pedido.pago", pedido(), "pago", PAGO],
      ["pix.expirado", aberto({ status: "expired", cancelado_em: z(cancelado), atualizado_em: z(cancelado) }), "expirado", cancelado],
      ["pedido.cancelado", aberto({ status: "cancelled", cancelado_em: z(cancelado), atualizado_em: z(cancelado) }), "expirado", cancelado],
      ["pedido.reembolsado", pedido({ status: "refunded", reembolsado_em: z(reembolsado), atualizado_em: z(reembolsado) }), "revertido", reembolsado],
    ];
    for (const [evento, p, situacao, data] of casos) {
      const ev = lerUm(aviso(evento, p));
      expect(ev.receita.situacao, `${evento}/${String(p.status)}`).toBe(situacao);
      expect(ev.dataEvento, `${evento}/${String(p.status)}`).toBe(data);
    }
    const r = lerUm(aviso("pedido.reembolsado", pedido({ status: "refunded", reembolsado_em: z(reembolsado) })));
    expect(r.venda).toMatchObject({ reembolsadoEm: reembolsado, chargebackEm: null });
  });

  it("numero do pedido: inteiro ou texto de digitos vira a referencia; sem pedido no Eve, null", () => {
    expect(lerUm(aviso("pedido.pago", pedido({ numero: "456" }))).venda?.referencia).toBe("456");
    expect(lerUm(aviso("pix.gerado", aberto({ numero: null }))).venda?.referencia).toBeNull();
    expect(lerUm(aviso("pedido.pago", pedido({ numero: "12a" }))).venda?.referencia).toBeNull();
  });

  it("o status manda, o nome do evento so serve para a trava: um pix.gerado que chega ja pago e pago", () => {
    const ev = lerUm(aviso("pix.gerado", pedido()));
    expect(ev).toMatchObject({ evento: TRAVA_DO_PIX, dataEvento: PAGO, receita: { situacao: "pago" }, venda: { cobrancaGerada: true } });
  });

  it("a trava do pix.gerado e a cobranca (prazo e valor); os outros eventos travam pelo nome", () => {
    expect(TRAVA_DO_PIX).toBe("pix.gerado:1792819800:9700");
    expect(lerUm(aviso("pix.gerado", aberto())).evento).toBe(TRAVA_DO_PIX);
    expect(lerUm(aviso("pix.gerado", aberto({ vence_em: z("2026-10-24T05:40:00.000Z") }))).evento).toBe("pix.gerado:1792820400:9700");
    expect(lerUm(aviso("pix.gerado", aberto({ total_centavos: "24700" }))).evento).toBe("pix.gerado:1792819800:24700");
    expect(lerUm(aviso("pix.gerado", aberto({ vence_em: null }))).evento).toBe("pix.gerado:0:9700");
    // O maior valor aceito cabe nos 40 caracteres da trava (e do ultimo_evento).
    expect(lerUm(aviso("pix.gerado", aberto({ total_centavos: 10_000_000 }))).evento.length).toBeLessThanOrEqual(40);
    expect(lerUm(aviso("pedido.pago")).evento).toBe("pedido.pago");
    expect(lerUm(aviso("pix.expirado", aberto({ status: "expired" }))).evento).toBe("pix.expirado");
  });

  it("cobrancaGerada so no pix.gerado", () => {
    expect(lerUm(aviso("pix.gerado", aberto())).venda?.cobrancaGerada).toBe(true);
    for (const e of ["pedido.pago", "pix.expirado", "pedido.cancelado", "pedido.reembolsado"]) {
      const p = e === "pedido.pago" ? pedido() : e === "pedido.reembolsado" ? pedido({ status: "refunded" }) : aberto({ status: "expired" });
      expect(lerUm(aviso(e, p)).venda?.cobrancaGerada, e).toBe(false);
    }
  });

  it("data da etapa faltando: atualizado_em, depois enviado_em, depois agora", () => {
    expect(lerUm(aviso("pedido.pago", pedido({ pago_em: null }))).dataEvento).toBe(PAGO);
    expect(lerUm(aviso("pedido.pago", pedido({ pago_em: null, atualizado_em: null }))).dataEvento).toBe(ENVIADO);
    const semNada = aviso("pedido.pago", pedido({ pago_em: null, atualizado_em: null }));
    delete semNada.enviado_em;
    expect(lerUm(semNada).dataEvento).toBe(AGORA.toISOString());
  });

  it("data torta ou fora da janela: recusa (e o dia do lucro)", () => {
    expect(erroDe(aviso("pedido.pago", pedido({ pago_em: "ontem" })))).toBe("pago_em invalido ou fora da janela");
    expect(erroDe(aviso("pedido.pago", pedido({ criado_em: "2024-01-01T00:00:00Z" })))).toBe("criado_em invalido ou fora da janela");
    expect(erroDe(aviso("pedido.pago", pedido({ atualizado_em: "2026-10-27T00:00:00Z" })))).toBe("atualizado_em invalido ou fora da janela");
    expect(erroDe(aviso("pedido.pago", pedido(), { enviado_em: "x" }))).toBe("enviado_em invalido ou fora da janela");
    // O vencimento pode ficar dias a frente; semanas nao.
    expect(lerUm(aviso("pix.gerado", aberto({ vence_em: "2026-10-27T05:00:00Z" }))).venda?.venceEm).toBe("2026-10-27T05:00:00.000Z");
    expect(erroDe(aviso("pix.gerado", aberto({ vence_em: "2026-12-01T05:00:00Z" })))).toBe("vence_em invalido ou fora da janela");
  });

  it("dinheiro: centavos INTEIROS; fracao, negativo, lixo, acima do teto ou total ausente recusam", () => {
    expect(lerUm(aviso("pedido.pago", pedido({ total_centavos: 19999 }))).pedido.valor).toBe(199.99);
    // O PDO pode devolver o inteiro como texto.
    expect(lerUm(aviso("pedido.pago", pedido({ total_centavos: "9750" }))).pedido.valor).toBe(97.5);
    expect(lerUm(aviso("pedido.pago", pedido({ total_centavos: 0 }))).pedido.valor).toBe(0);
    for (const torto of [97.5, -100, "97.00", "abc", 10_000_000_01, null]) {
      expect(erroDe(aviso("pedido.pago", pedido({ total_centavos: torto }))), String(torto)).toBe(
        "pedido.total_centavos ausente ou invalido (centavos inteiros)"
      );
    }
    expect(erroDe(aviso("pedido.pago", pedido({ desconto_centavos: 1.5 })))).toBe("pedido.desconto_centavos invalido (centavos inteiros)");
    expect(erroDe(aviso("pedido.pago", pedido({ frete_centavos: "x" })))).toBe("pedido.frete_centavos invalido (centavos inteiros)");
  });

  it("moeda: a do pedido; ausente vale a do checkout; torta recusa. Pais do comprador, BR quando falta", () => {
    expect(lerUm(aviso("pedido.pago", pedido({ moeda: "usd" }))).pedido.moeda).toBe("USD");
    const sem = lerUm(aviso("pedido.pago", pedido({ moeda: undefined })));
    expect(sem.pedido.moeda).toBe("");
    expect(sem.receita.moeda).toBeNull();
    expect(erroDe(aviso("pedido.pago", pedido({ moeda: "real" })))).toBe("pedido.moeda invalida");
    const semPais = aviso("pedido.pago");
    (semPais.comprador as Dados).pais = null;
    expect(lerUm(semPais).pedido.pais).toBe("BR");
  });

  it("versao diferente de 1: erro claro, antes de tudo (inclusive do teste)", () => {
    expect(VERSAO).toBe(1);
    expect(erroDe({ ...aviso("pedido.pago"), versao: 2 })).toBe("versao 2 do contrato; o xcart le a versao 1");
    expect(erroDe({ ...aviso("pedido.pago"), versao: "1" })).toBe('versao "1" do contrato; o xcart le a versao 1');
    const sem = aviso("pedido.pago");
    delete sem.versao;
    expect(erroDe(sem)).toBe("versao ausente do contrato; o xcart le a versao 1");
    expect(erroDe({ ...aviso("pedido.pago"), versao: 2, teste: true })).toMatch(/versao 2/);
  });

  it("evento fora do contrato, status desconhecido, pedido ausente: recusa", () => {
    expect(erroDe(aviso("pedido.criado"))).toBe("evento desconhecido: pedido.criado");
    expect(erroDe(aviso("pedido.pago", pedido({ status: "chargeback" })))).toBe("status desconhecido: chargeback");
    expect(erroDe(aviso("pedido.pago", pedido({ id: "../x" })))).toBe("pedido.id invalido");
    expect(erroDe({ ...aviso("pedido.pago"), pedido: null })).toBe("pedido ausente");
    expect(erroDe("[]")).toBe("corpo nao e um objeto JSON");
  });

  it("X-Eve-Event diferente do corpo: recusa (o header nao e assinado; os dois lados montam igual)", () => {
    expect(lerUm(aviso("pedido.pago"), new Headers({ "X-Eve-Event": "pedido.pago" })).evento).toBe("pedido.pago");
    expect(erroDe(aviso("pedido.pago"), new Headers({ "X-Eve-Event": "pix.gerado" }))).toBe("X-Eve-Event diferente do evento do corpo");
  });

  it("lead sem Pix (started) e pedido da loja Shopify: 200 sem gravar (contaria duas vezes)", () => {
    expect(lerTodosEve(aviso("pix.gerado", aberto({ status: "started" })), AGORA)).toEqual({ ok: true, eventos: [], ignorado: "status started" });
    expect(lerTodosEve(aviso("pedido.pago", pedido({ origem: "shopify" })), AGORA)).toEqual({ ok: true, eventos: [], ignorado: "origem shopify" });
    // A origem api (o Pix gerado pela Eve) vale como a external.
    expect(lerUm(aviso("pedido.pago", pedido({ origem: "api" }))).receita.situacao).toBe("pago");
  });

  it("rastreio: UTMs, sck, click ids, fbp/fbc e a URL sem query; sem IP, user agent nem vid da ponte", () => {
    const ev = lerUm(aviso("pedido.pago"));
    expect(ev.rastreio).toEqual({
      utm: { source: "FB", medium: "120211234567890123", campaign: "Campanha X|120219876543210987", content: "Anuncio Y|120215555555555555", term: "Instagram_Feed" },
      sck: "lista-quente",
      callback: null,
      fbc: "fb.1.1761282000000.IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
      fbp: "fb.1.1761282000000.1234567890",
      fbclid: "IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
      ttclid: "E.C.P.1234567890abcdef1234567890abcdef",
      checkoutUrl: "https://panelamonaco.shop/oferta",
      vidNaUrl: null,
    });
    const comQuery = aviso("pedido.pago");
    (comQuery.rastreio as Dados).url = "https://panelamonaco.shop/oferta?email=ana.souza%40provedor.com.br#topo";
    expect(lerUm(comQuery).rastreio?.checkoutUrl).toBe("https://panelamonaco.shop/oferta");
    // O que a Utmify gruda nas UTMs sai; o click id dela vira o fbclid.
    const utmify = aviso("pedido.pago", pedido(), { rastreio: { utm_source: "FBjLj123abc", utm_content: "Anuncio|120215555555555555::IwARutmify::" } });
    expect(lerUm(utmify).rastreio).toMatchObject({ utm: { source: "FB", content: "Anuncio|120215555555555555" }, fbclid: "IwARutmify" });
    // Sem bloco de rastreio: tudo vazio, nada quebra.
    const sem = aviso("pedido.pago");
    delete sem.rastreio;
    expect(lerUm(sem).rastreio).toMatchObject({ utm: {}, sck: null, fbclid: null, checkoutUrl: null });
  });

  it("comprador so em memoria, e o CPF/documento nunca e lido", () => {
    const ev = lerUm(aviso("pedido.pago"));
    expect(ev.comprador).toEqual({
      nome: "Ana Souza",
      email: "ana.souza@provedor.com.br",
      telefone: "+5534988887777",
      pais: "BR",
      estado: "MG",
      cidade: "Belo Horizonte",
      cep: "30140071",
    });
    expect(JSON.stringify(ev)).not.toContain("39053344705");
  });
});

describe("teste: os dois sinais valem sozinhos e saem antes das validacoes", () => {
  it("teste: true num pedido real (com valor e data tortos): teste", () => {
    const c = aviso("pedido.pago", pedido({ total_centavos: "abc", criado_em: "2020-01-01T00:00:00Z" }), { teste: true });
    expect(lerUm(c)).toMatchObject({ teste: true, pedidoId: TOKEN_PEDIDO, pedido: { valor: 0 } });
  });

  it("pedido.id eve-teste com teste: false: teste", () => {
    expect(lerUm(aviso("pedido.pago", pedido({ id: ID_TESTE }), { teste: false }))).toMatchObject({ teste: true, pedidoId: "eve-teste" });
  });

  it("teste so com o booleano true (\"true\" em texto nao conta)", () => {
    expect(lerUm(aviso("pedido.pago", pedido(), { teste: "true" })).teste).toBe(false);
  });

  it("o nosso exemplo: assinado pelo assinarEve, passa no autenticarEve e e teste", () => {
    const raw = JSON.stringify(exemploEve(AGORA));
    const h = new Headers(assinarEve(raw, SECRET, AGORA));
    expect(h.get("X-Eve-Event")).toBe("pedido.pago");
    expect(autenticarEve(raw, h, SECRET, AGORA)).toEqual({ ok: true });
    expect(lerUm(JSON.parse(raw), h)).toMatchObject({ teste: true, pedidoId: ID_TESTE, evento: "pedido.pago" });
  });
});

// ---------------------------------------------------------------------------
// Autenticacao (o HMAC do contrato)
// ---------------------------------------------------------------------------

/** O HMAC como o contrato manda (e como o PHP faz: hash_hmac('sha256', "$ts.$corpo", $secret)). */
function assinatura(raw: string, ts: string, secret = SECRET): string {
  return `v1=${createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex")}`;
}

describe("autenticarEve", () => {
  const raw = JSON.stringify(aviso("pedido.pago"));
  const ts = String(Math.floor(AGORA.getTime() / 1000));
  const headers = (extra: Record<string, string> = {}) =>
    new Headers({ "X-Eve-Event": "pedido.pago", "X-Eve-Timestamp": ts, "X-Eve-Signature": assinatura(raw, ts), ...extra });

  it("HMAC certo (string ou bytes): ok; e o assinarEve produz o mesmo do contrato", () => {
    expect(autenticarEve(raw, headers(), SECRET, AGORA)).toEqual({ ok: true });
    expect(autenticarEve(Buffer.from(raw, "utf8"), headers(), SECRET, AGORA)).toEqual({ ok: true });
    expect(assinarEve(raw, SECRET, AGORA)["X-Eve-Signature"]).toBe(assinatura(raw, ts));
    // Hex maiusculo e a lista com outra versao tambem passam.
    expect(autenticarEve(raw, headers({ "X-Eve-Signature": assinatura(raw, ts).toUpperCase().replace("V1=", "v1=") }), SECRET, AGORA)).toEqual({ ok: true });
    expect(autenticarEve(raw, headers({ "X-Eve-Signature": `v0=abc, ${assinatura(raw, ts)}` }), SECRET, AGORA)).toEqual({ ok: true });
  });

  it("secret errado, corpo mexido ou timestamp trocado: assinatura nao confere", () => {
    expect(autenticarEve(raw, headers({ "X-Eve-Signature": assinatura(raw, ts, "outro-secret-qualquer") }), SECRET, AGORA)).toEqual({
      ok: false,
      erro: "assinatura nao confere",
    });
    expect(autenticarEve(raw.replace("9700", "9800"), headers(), SECRET, AGORA)).toMatchObject({ ok: false, erro: "assinatura nao confere" });
    const outroTs = String(Number(ts) - 1);
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": outroTs }), SECRET, AGORA)).toMatchObject({ erro: "assinatura nao confere" });
    expect(autenticarEve(raw, headers({ "X-Eve-Signature": "sha256=abc" }), SECRET, AGORA)).toMatchObject({ erro: "assinatura nao confere" });
  });

  it("fora da janela (a da Cakto): recusa; a retentativa assina de novo, entao so a entrega velha cai", () => {
    const velho = String(Number(ts) - TOLERANCIA_PASSADO_S - 1);
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": velho, "X-Eve-Signature": assinatura(raw, velho) }), SECRET, AGORA)).toEqual({
      ok: false,
      erro: "X-Eve-Timestamp fora da janela",
    });
    const futuro = String(Number(ts) + TOLERANCIA_FUTURO_S + 1);
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": futuro, "X-Eve-Signature": assinatura(raw, futuro) }), SECRET, AGORA)).toMatchObject({
      erro: "X-Eve-Timestamp fora da janela",
    });
    const dentro = String(Number(ts) - 600);
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": dentro, "X-Eve-Signature": assinatura(raw, dentro) }), SECRET, AGORA)).toEqual({ ok: true });
  });

  it("sem header, timestamp torto ou sem secret salvo: recusa", () => {
    expect(autenticarEve(raw, new Headers({ "X-Eve-Timestamp": ts }), SECRET, AGORA)).toEqual({ ok: false, erro: "X-Eve-Signature ausente" });
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": "" }), SECRET, AGORA)).toEqual({ ok: false, erro: "X-Eve-Timestamp ausente ou invalido" });
    expect(autenticarEve(raw, headers({ "X-Eve-Timestamp": "1761282600000" }), SECRET, AGORA)).toMatchObject({ erro: "X-Eve-Timestamp ausente ou invalido" });
    expect(autenticarEve(raw, headers(), null, AGORA)).toMatchObject({ ok: false, semSegredo: true });
  });
});

describe("o registro do Eve", () => {
  it("venda, HMAC no header, reenvio por status (503 na hora), os 5 eventos do contrato", () => {
    expect(plataformaDe("eve")).toBe(eve);
    expect(eve).toMatchObject({ id: "eve", nome: "Eve", modelo: "venda", autenticacao: "hmac_header", reenvio: "status", eventoDeVenda: "pedido.pago" });
    expect([...eve.gatilhos]).toEqual(["pix.gerado", "pedido.pago", "pix.expirado", "pedido.cancelado", "pedido.reembolsado"]);
    expect(eve.gatilhos).toBe(GATILHOS_EVE);
    expect(modeloDaPlataforma("eve")).toBe("venda");
    expect(rastreiaCompra("eve")).toBe(true);
    expect(usaSegredo("eve")).toBe(true);
    expect(nomeDoSegredo("eve")).toBe("secret");
    expect(MOEDA_PADRAO.eve).toBe("BRL");
    expect(rotuloDoEvento("pix.gerado")).toBe("Pix gerado");
    // A trava do Pix gerado leva a cobranca no nome; a tela segue em "Pix gerado".
    expect(rotuloDoEvento(TRAVA_DO_PIX)).toBe("Pix gerado");
    expect(rotuloDoEvento("pedido.reembolsado")).toBe("Reembolso");
  });

  it("sem a ponte (Fase D): nenhum host, nenhum script de pagina", () => {
    expect(HOST_DO_CHECKOUT.eve).toBeUndefined();
    expect(scriptDaPonteDoCheckout("https://user.xcart.app", "ck-1", "eve")).toBeNull();
  });

  it("as frases do reenvio: a fila do Eve, nao o Reprocessar da Hubla nem o Reenviar da Cakto", () => {
    expect(comoTentaDeNovo(eve)).toMatch(/pela fila .*worker estiver no cron/);
    expect(comoReenviar(eve)).toMatch(/^use Enviar teste no painel dela para conferir a conexão; o evento que falhou só volta pela fila de jobs dela, com o worker no cron\. Sem a fila, o pedido pago não volta$/);
    // Pedido pago nao tem proxima mudanca: a tela nao promete que ele entra depois.
    expect(comoReenviar(eve)).not.toMatch(/próxima mudança/);
    expect(comoReenviar(plataformaDe("hubla")!)).toBe("use Reprocessar no histórico de eventos dela");
    expect(comoReenviar(plataformaDe("cakto")!)).toBe("use Reenviar no painel dela");
    expect(comoTentaDeNovo(plataformaDe("hubla")!)).toBe("tenta de novo por cerca de 1 minuto");
    expect(comoTentaDeNovo(plataformaDe("cakto")!)).toBe("manda de novo em alguns minutos");
  });
});

// ---------------------------------------------------------------------------
// A trava de conta: so o Arthur ve e cadastra o Eve
// ---------------------------------------------------------------------------

describe("trava de conta do Eve", () => {
  it("plataformaLiberada: o Eve so na conta da lista; a publica em toda conta", () => {
    expect(CONTAS_COM_EVE).toEqual([ARTHUR]);
    expect(plataformaLiberada("eve", ARTHUR)).toBe(true);
    expect(plataformaLiberada("eve", OUTRA_CONTA)).toBe(false);
    expect(plataformaLiberada("eve", null)).toBe(false);
    expect(plataformaLiberada("eve", undefined)).toBe(false);
    expect(plataformaLiberada("eve", ARTHUR.toUpperCase())).toBe(false);
    for (const p of ["cakto", "hubla", "sphere"]) expect(plataformaLiberada(p, OUTRA_CONTA), p).toBe(true);
  });

  it("a escolha de plataforma: o Eve so aparece para o Arthur; fora dele, a lista publica de sempre", () => {
    expect(plataformasDaConta(ARTHUR).map((p) => p.id)).toEqual(["cakto", "hubla", "sphere", "eve", "yampi", "cartpanda", "kiwify"]);
    expect(plataformasDaConta(ARTHUR).find((p) => p.id === "eve")?.ativa).toBe(true);
    for (const conta of [OUTRA_CONTA, null, undefined]) {
      expect(plataformasDaConta(conta).map((p) => p.id)).toEqual(PLATAFORMAS_CHECKOUT.map((p) => p.id));
    }
  });

  it("fora da lista publica: /conectar, o seletor e o resto que le PLATAFORMAS_CHECKOUT nunca o veem", () => {
    expect(PLATAFORMAS_CHECKOUT.some((p) => (p.id as string) === "eve")).toBe(false);
    const checkout = OPCOES_CONECTAR.find((o) => o.id === "checkout")!;
    expect(checkout.destinos.some((d) => d.id === "eve")).toBe(false);
    expect(JSON.stringify(OPCOES_CONECTAR)).not.toMatch(/\bEve\b/);
  });

  it("o cliente nao recebe os ids: a tela e os tipos nao importam liberadas.ts", () => {
    const raiz = path.resolve(__dirname, "..");
    for (const f of ["src/app/(dashboard)/integracoes/checkouts/checkouts-tela.tsx", "src/lib/checkouts-externos/tipos.ts"]) {
      const texto = readFileSync(path.join(raiz, f), "utf8");
      expect(texto, f).not.toContain(ARTHUR);
      expect(texto, f).not.toMatch(/from ["'][^"']*liberadas["']/);
    }
    expect(readFileSync(path.join(raiz, "src/lib/checkouts-externos/liberadas.ts"), "utf8")).toMatch(/^import "server-only";/);
  });
});

// O POST /api/checkouts com a sessao e o banco falsos.
const api = {
  user: null as null | { id: string },
  inserts: [] as { tabela: string; linha: Record<string, unknown> }[],
};

vi.mock("@/lib/checkouts-externos/servidor", () => ({
  json: (status: number, corpo: Record<string, unknown>) =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } }),
  usuarioDaSessao: async () => api.user,
  novoToken: () => ({ token: "t".repeat(43), token_hash: "h" }),
  urlPublica: (token: string) => `https://user.xcart.app/api/webhooks/checkout/${token}`,
  resumoDoCheckout: (c: Record<string, unknown>) => ({ id: c.id, plataforma: c.plataforma, nome: c.nome }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: async () => ({ count: 0, error: null }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      insert: (linha: Record<string, unknown>) => {
        api.inserts.push({ tabela, linha });
        if (tabela === "checkouts_externos") {
          return { select: () => ({ single: async () => ({ data: { id: "ck-novo", ...linha }, error: null }) }) };
        }
        return Promise.resolve({ error: null });
      },
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  }),
}));

async function cadastrar(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/checkouts/route");
  const r = await POST(new Request("https://user.xcart.app/api/checkouts", { method: "POST", body: JSON.stringify(corpo) }));
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

describe("POST /api/checkouts: o Eve so na conta do Arthur", () => {
  beforeEach(() => {
    api.user = null;
    api.inserts = [];
  });

  it("outra conta: a mesma resposta de plataforma desconhecida, e nada gravado", async () => {
    api.user = { id: OUTRA_CONTA };
    const eveAlheio = await cadastrar({ plataforma: "eve", nome: "Eve" });
    const desconhecida = await cadastrar({ plataforma: "qualquer", nome: "X" });
    expect(eveAlheio).toEqual({ status: 400, corpo: { ok: false, erro: "Plataforma ainda não disponível." } });
    expect(eveAlheio).toEqual(desconhecida);
    expect(api.inserts).toHaveLength(0);
  });

  it("a conta do Arthur: cadastra o Eve em BRL e devolve a URL", async () => {
    api.user = { id: ARTHUR };
    const r = await cadastrar({ plataforma: "eve", nome: "Eve Panela Mônaco" });
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ ok: true, url: expect.stringContaining("/api/webhooks/checkout/"), temSegredo: false });
    expect(api.inserts[0]).toMatchObject({ tabela: "checkouts_externos", linha: { user_id: ARTHUR, plataforma: "eve", moeda_receita: "BRL" } });
  });

  it("a Cakto segue para qualquer conta", async () => {
    api.user = { id: OUTRA_CONTA };
    expect((await cadastrar({ plataforma: "cakto", nome: "Cakto" })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// receberEvento com um repositorio em memoria
// ---------------------------------------------------------------------------

interface Memoria {
  repo: RepositorioCheckout;
  eventos: Set<string>;
  pedidos: Map<string, PedidoGravado>;
  marcas: MarcaCheckout[];
}

function memoria(opcoes: { falharInsert?: number; falharSoltar?: number; travadoEm?: () => string } = {}): Memoria {
  let falhas = opcoes.falharInsert ?? 0;
  let falhasSoltar = opcoes.falharSoltar ?? 0;
  const m: Memoria = { eventos: new Set(), pedidos: new Map(), marcas: [], repo: undefined as never };
  m.repo = {
    async travarEvento(x) {
      const k = `${x.pedido_id}|${x.evento}`;
      if (m.eventos.has(k)) return "duplicado";
      m.eventos.add(k);
      return "ok";
    },
    async soltarEvento(x) {
      if (falhasSoltar > 0) {
        falhasSoltar -= 1;
        throw new Error("banco fora");
      }
      m.eventos.delete(`${x.pedido_id}|${x.evento}`);
    },
    ...(opcoes.travadoEm ? { travaRecebidaEm: async () => opcoes.travadoEm!() } : {}),
    async lerPedido(_ck, id) {
      const p = m.pedidos.get(id);
      return p ? { ...p } : null;
    },
    async inserirPedido(x) {
      if (falhas > 0) {
        falhas -= 1;
        throw new Error("banco fora");
      }
      if (m.pedidos.has(x.pedido_id)) return "existe";
      m.pedidos.set(x.pedido_id, { ...x.pedido, versao: 0 });
      return "ok";
    },
    async atualizarPedido(x) {
      const atual = m.pedidos.get(x.pedido_id);
      if (!atual || atual.versao !== x.versao) return false;
      m.pedidos.set(x.pedido_id, { ...x.pedido, versao: x.versao + 1 });
      return true;
    },
    async reivindicarConta() {
      return "ok";
    },
    async marcarCheckout(_ck, campos) {
      m.marcas.push(campos);
    },
  };
  return m;
}

const CHECKOUT: CheckoutParaReceber = {
  id: "ck-eve",
  user_id: ARTHUR,
  plataforma: "eve",
  nome: "Eve Panela",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  notificar_pendente: false,
  notificar_estorno: false,
  compra_quando: "gerada",
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

async function receber(
  m: Memoria,
  c: Dados,
  opcoes: { checkout?: Partial<CheckoutParaReceber>; segredo?: string | null; secretDaAssinatura?: string; rastreio?: RastreioCheckout } = {}
) {
  const raw = JSON.stringify(c);
  const headers = new Headers(assinarEve(raw, opcoes.secretDaAssinatura ?? SECRET, AGORA));
  return receberEvento(
    m.repo,
    { ...CHECKOUT, ...opcoes.checkout },
    eve,
    JSON.parse(raw),
    AGORA,
    { raw, headers, segredo: opcoes.segredo === undefined ? SECRET : opcoes.segredo },
    opcoes.rastreio
  );
}

describe("receberEvento (Eve): origem, idempotencia e ordem", () => {
  it("sem secret salvo: 401 e o caminho de volta na tela", async () => {
    const m = memoria();
    const r = await receber(m, aviso("pedido.pago"), { segredo: null });
    expect(r).toEqual({ status: 401, corpo: { ok: false, erro: "nao autorizado" }, notificar: null });
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/^Cole aqui o secret do webhook da Eve e use Enviar teste no painel dela/);
    // A venda paga antes de o secret ser colado so volta pela fila: a tela nao promete outra coisa.
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/só volta pela fila de jobs dela, com o worker no cron\. Sem a fila, o pedido pago não volta\.$/);
    expect(m.marcas.at(-1)?.ultimo_erro).not.toMatch(/próxima mudança/);
    expect(m.eventos.size).toBe(0);
  });

  it("assinatura com outro secret: 401 com 'A assinatura da Eve não confere'", async () => {
    const m = memoria();
    const r = await receber(m, aviso("pedido.pago"), { secretDaAssinatura: "outro-secret-qualquer" });
    expect(r.status).toBe(401);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/A assinatura da Eve não confere \(assinatura nao confere\)\. Confira o secret/);
  });

  it("gerado -> pago -> reembolsado: cada etapa uma vez; a retentativa e duplicado", async () => {
    const m = memoria();
    const devolvido = "2026-10-24T05:08:00.000Z";
    const corpos = [
      (await receber(m, aviso("pix.gerado", aberto()))).corpo,
      (await receber(m, aviso("pedido.pago"))).corpo,
      (await receber(m, aviso("pedido.pago"))).corpo,
      (await receber(m, aviso("pedido.reembolsado", pedido({ status: "refunded", reembolsado_em: z(devolvido), atualizado_em: z(devolvido) })))).corpo,
    ];
    expect(corpos).toEqual([{ ok: true }, { ok: true }, { ok: true, duplicado: true }, { ok: true }]);
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({
      situacao: "revertido",
      criado_em: CRIADO,
      pago_em: PAGO,
      reembolsado_em: devolvido,
      valor: 97,
      receita: 97,
      taxa: null,
      metodo_pagamento: "pix",
      referencia: "123",
      grupo: TOKEN_PEDIDO,
      utm_source: "FB",
      campanha_id: "120219876543210987",
    });
    expect(estadoDaVenda(m.pedidos.get(TOKEN_PEDIDO)!, AGORA.getTime())).toBe("reembolsada");
  });

  it("o pago antes do gerado (a fila nao garante a ordem): o gerado atrasado nao volta para pendente", async () => {
    const m = memoria();
    await receber(m, aviso("pedido.pago"));
    await receber(m, aviso("pix.gerado", aberto()));
    expect(m.pedidos.get(TOKEN_PEDIDO)?.situacao).toBe("pago");
  });

  it("Pix expirado e 'Vencida'; o cancelado e 'Recusada'; pago depois de expirar vale o pago", async () => {
    const m = memoria();
    const expirou = "2026-10-24T05:30:05.000Z";
    await receber(m, aviso("pix.gerado", aberto()));
    await receber(m, aviso("pix.expirado", aberto({ status: "expired", cancelado_em: z(expirou), atualizado_em: z(expirou) })));
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ situacao: "expirado", status_comissao: "expired" });
    expect(estadoDaVenda(m.pedidos.get(TOKEN_PEDIDO)!, Date.parse("2026-10-24T06:00:00Z"))).toBe("vencida");

    const outro = "b1b2c3d4e5f60718293a4b5c6d7e8f91";
    await receber(m, aviso("pedido.cancelado", aberto({ id: outro, status: "cancelled", cancelado_em: z(expirou) })));
    expect(estadoDaVenda(m.pedidos.get(outro)!, AGORA.getTime())).toBe("recusada");

    // O Pix pago depois de vencer (o gateway confirma atrasado): o pagamento e mais novo, vale.
    const pagoTarde = "2026-10-24T05:40:00.000Z";
    await receber(m, aviso("pedido.pago", pedido({ pago_em: z(pagoTarde), cancelado_em: z(expirou), atualizado_em: z(pagoTarde) })));
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ situacao: "pago", pago_em: pagoTarde });
    expect(estadoDaVenda(m.pedidos.get(TOKEN_PEDIDO)!, AGORA.getTime())).toBe("paga");
  });

  it("o Pix vencido gerado de novo no mesmo checkout (prazo e valor novos) entra: prazo e valor do Pix novo, e avisa", async () => {
    const m = memoria();
    const pedindo = { checkout: { notificar_pendente: true } };
    // Pix 1: R$ 97, venceu as 05:05 (AGORA e 05:10). O Eve nao avisou o vencimento (worker fora do cron).
    const pix1 = aviso("pix.gerado", aberto({ vence_em: z("2026-10-24T05:05:00.000Z") }));
    await receber(m, pix1, pedindo);
    expect(estadoDaVenda(m.pedidos.get(TOKEN_PEDIDO)!, AGORA.getTime())).toBe("vencida");

    // Pix 2 no mesmo checkout: R$ 247, vale ate 05:40.
    const novo = "2026-10-24T05:40:00.000Z";
    const pix2 = aviso("pix.gerado", aberto({ subtotal_centavos: 24700, total_centavos: 24700, vence_em: z(novo) }));
    const r = await receber(m, pix2, pedindo);
    expect(r.corpo).toEqual({ ok: true });
    expect(r.notificar).toMatchObject({ tipo: "pendente", valor: 247, comissao: 247, metodo: "pix" });
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ situacao: "pendente", valor: 247, receita: 247, vence_em: novo, criado_em: CRIADO });
    expect(estadoDaVenda(m.pedidos.get(TOKEN_PEDIDO)!, AGORA.getTime())).toBe("aguardando");

    // A retentativa do Pix 2 e duplicado; a do Pix 1, atrasada, nao volta o prazo nem o valor.
    expect(await receber(m, pix2, pedindo)).toEqual({ status: 200, corpo: { ok: true, duplicado: true }, notificar: null });
    expect((await receber(m, pix1, pedindo)).corpo).toEqual({ ok: true, duplicado: true });
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ valor: 247, vence_em: novo });

    // O Pix 2 pago: o pagamento vale, com o valor dele.
    const pago2 = "2026-10-24T05:08:00.000Z";
    await receber(m, aviso("pedido.pago", pedido({ subtotal_centavos: 24700, total_centavos: 24700, vence_em: z(novo), pago_em: z(pago2), atualizado_em: z(pago2) })));
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ situacao: "pago", valor: 247, pago_em: pago2 });
    expect([...m.eventos].sort()).toEqual(
      [`${TOKEN_PEDIDO}|pedido.pago`, `${TOKEN_PEDIDO}|pix.gerado:1792818300:9700`, `${TOKEN_PEDIDO}|pix.gerado:1792820400:24700`].sort()
    );
  });

  it("o lead da pagina reenviado com outro valor e o mesmo prazo: o valor novo entra", async () => {
    const m = memoria();
    await receber(m, aviso("pix.gerado", aberto()));
    const r = await receber(m, aviso("pix.gerado", aberto({ total_centavos: 12700 })));
    expect(r.corpo).toEqual({ ok: true });
    expect(m.pedidos.get(TOKEN_PEDIDO)).toMatchObject({ situacao: "pendente", valor: 127, receita: 127, vence_em: VENCE });
  });

  it("falha nossa: 503 na hora (o Eve reenvia), sem segurar; o erro na tela fala da fila e do caminho de volta", async () => {
    const m = memoria({ falharInsert: 1 });
    const r = await receber(m, aviso("pedido.pago"));
    expect(r.status).toBe(503);
    expect(r.segurar).toBeUndefined();
    expect(m.eventos.size).toBe(0);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(
      /A Eve tenta de novo sozinha pela fila \(5 vezes em cerca de 15 minutos, se o worker estiver no cron\); se o erro ficar, use Enviar teste/
    );
    // Pedido pago nao tem proxima mudanca: a tela diz que so a fila o traz, sem prometer mais.
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/só volta pela fila de jobs dela, com o worker no cron\. Sem a fila, o pedido pago não volta\.$/);
    expect(m.marcas.at(-1)?.ultimo_erro).not.toMatch(/próxima mudança/);
    expect((await receber(m, aviso("pedido.pago"))).corpo).toEqual({ ok: true });
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_erro: null });
  });

  it("a trava presa (gravar e soltar falharam): a retentativa de 30 s responde 503, nao 'duplicado'; a de 90 s refaz", async () => {
    let travadoEm = AGORA.toISOString();
    const m = memoria({ falharInsert: 1, falharSoltar: 1, travadoEm: () => travadoEm });
    expect((await receber(m, aviso("pedido.pago"))).status).toBe(503);
    expect(m.eventos.size).toBe(1);
    travadoEm = new Date(AGORA.getTime() - 30_000).toISOString();
    expect((await receber(m, aviso("pedido.pago"))).corpo).toEqual({ ok: false, erro: "tente de novo" });
    expect(m.pedidos.size).toBe(0);
    travadoEm = new Date(AGORA.getTime() - 90_000).toISOString();
    expect((await receber(m, aviso("pedido.pago"))).corpo).toEqual({ ok: true });
    expect(m.pedidos.get(TOKEN_PEDIDO)?.situacao).toBe("pago");
    travadoEm = AGORA.toISOString();
    expect((await receber(m, aviso("pedido.pago"))).corpo).toEqual({ ok: true, duplicado: true });
  });

  it("Venda no celular: o pedido pago avisa uma vez, com o numero do painel", async () => {
    const m = memoria();
    const r = await receber(m, aviso("pedido.pago"));
    expect(r.notificar).toMatchObject({ tipo: "venda", checkout: "Eve Panela", pedido: "#123", produto: "Panela Mônaco 5 peças", valor: 97, comissao: 97, moeda: "BRL" });
    expect((await receber(m, aviso("pedido.pago"))).notificar).toBeNull();
    // Pix gerado so com o aviso ligado.
    const outro = "c1b2c3d4e5f60718293a4b5c6d7e8f92";
    expect((await receber(m, aviso("pix.gerado", aberto({ id: outro })))).notificar).toBeNull();
    const terceiro = "d1b2c3d4e5f60718293a4b5c6d7e8f93";
    expect((await receber(m, aviso("pix.gerado", aberto({ id: terceiro })), { checkout: { notificar_pendente: true } })).notificar).toMatchObject({
      tipo: "pendente",
      metodo: "pix",
    });
  });

  it("historico (pedido de antes da conexao): grava igual, sem Venda no celular e sem compra ao Meta", async () => {
    const m = memoria();
    const f = fila();
    const r = await receber(m, aviso("pedido.pago", pedido(), { historico: true }), { rastreio: f.rastreio });
    expect(r.corpo).toEqual({ ok: true });
    expect(r.notificar).toBeNull();
    expect(m.pedidos.get(TOKEN_PEDIDO)?.situacao).toBe("pago");
    expect(f.linhas).toHaveLength(0);
    // So o booleano true conta: "true" em texto avisa como venda nova.
    const outro = "a9b2c3d4e5f60718293a4b5c6d7e8f96";
    expect((await receber(m, aviso("pedido.pago", pedido({ id: outro }), { historico: "true" }))).notificar).toMatchObject({ tipo: "venda" });
  });

  it("o teste (os dois sinais e o nosso exemplo): 200 teste, nada travado nem gravado", async () => {
    const m = memoria();
    expect((await receber(m, aviso("pedido.pago", pedido(), { teste: true }))).corpo).toEqual({ ok: true, teste: true });
    expect((await receber(m, aviso("pedido.pago", pedido({ id: ID_TESTE })))).corpo).toEqual({ ok: true, teste: true });
    expect((await receber(m, exemploEve(AGORA) as Dados)).corpo).toEqual({ ok: true, teste: true });
    expect(m.pedidos.size).toBe(0);
    expect(m.eventos.size).toBe(0);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_evento_teste: true, ultimo_evento: "pedido.pago" });
  });

  it("corpo de versao errada: 400 com o erro na tela", async () => {
    const m = memoria();
    const r = await receber(m, { ...aviso("pedido.pago"), versao: 2 });
    expect(r.status).toBe(400);
    expect(m.marcas.at(-1)?.ultimo_erro).toBe("Evento recusado: versao 2 do contrato; o xcart le a versao 1");
  });
});

// ---------------------------------------------------------------------------
// A compra pelo servidor: so com um pixel ligado no checkout
// ---------------------------------------------------------------------------

const META: DestinoDoCheckout = { id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true };

function fila(destinos: DestinoDoCheckout[] = [META]) {
  const linhas: EnvioGravado[] = [];
  const rastreio: RastreioCheckout = {
    async destinos() {
      return destinos;
    },
    async identidade() {
      return null;
    },
    async enfileirar(novas: EnvioNovo[]) {
      const entraram: EnvioGravado[] = [];
      for (const l of novas) {
        if (linhas.some((x) => x.destino_id === l.destino_id && x.event_id === l.event_id)) continue;
        const g = { ...l, id: `e${linhas.length + 1}`, attempts: 0 };
        linhas.push(g);
        entraram.push(g);
      }
      return entraram;
    },
  };
  return { rastreio, linhas };
}

describe("a compra pelo servidor (Eve)", () => {
  it("sem pixel ligado (o padrao): nada vai ao Meta nem ao TikTok", async () => {
    const m = memoria();
    const f = fila([]);
    await receber(m, aviso("pix.gerado", aberto()), { rastreio: f.rastreio });
    await receber(m, aviso("pedido.pago"), { rastreio: f.rastreio });
    expect(f.linhas).toHaveLength(0);
    expect(m.pedidos.size).toBe(1);
  });

  it("com o pixel ligado: uma compra no Pix gerado, purchase_eve_<token>, sem IP nem user agent; o pago nao manda de novo", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, aviso("pix.gerado", aberto()), { rastreio: f.rastreio });
    await receber(m, aviso("pedido.pago"), { rastreio: f.rastreio });
    expect(f.linhas.map((l) => l.event_id)).toEqual([`purchase_eve_${TOKEN_PEDIDO}`]);
    const meta = f.linhas[0].payload as EventoCapi;
    expect(meta).toMatchObject({
      event_id: `purchase_eve_${TOKEN_PEDIDO}`,
      event_time: Math.floor(Date.parse(CRIADO) / 1000),
      event_source_url: "https://panelamonaco.shop/oferta",
      custom_data: { currency: "BRL", value: 97, content_ids: ["8123456789"], order_id: TOKEN_PEDIDO },
    });
    expect(meta.user_data).toMatchObject({ fbp: "fb.1.1761282000000.1234567890" });
    expect(meta.user_data.client_ip_address).toBeUndefined();
    expect(meta.user_data.client_user_agent).toBeUndefined();
  });

  it("sem a URL da pagina: a do Eve; so aprovadas: o Pix gerado nao manda; o teste e o reembolso nunca", async () => {
    const m = memoria();
    const f = fila();
    const semUrl = aviso("pedido.pago");
    delete (semUrl.rastreio as Dados).url;
    await receber(m, semUrl, { rastreio: f.rastreio, checkout: { compra_quando: "aprovada" } });
    expect((f.linhas[0].payload as EventoCapi).event_source_url).toBe("https://checkouteve.shop/");

    const outro = "e1b2c3d4e5f60718293a4b5c6d7e8f94";
    await receber(m, aviso("pix.gerado", aberto({ id: outro })), { rastreio: f.rastreio, checkout: { compra_quando: "aprovada" } });
    await receber(m, aviso("pedido.reembolsado", pedido({ id: "f1b2c3d4e5f60718293a4b5c6d7e8f95", status: "refunded" })), { rastreio: f.rastreio });
    await receber(m, aviso("pedido.pago", pedido(), { teste: true }), { rastreio: f.rastreio });
    expect(f.linhas).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dado pessoal
// ---------------------------------------------------------------------------

describe("dado pessoal do comprador nunca e gravado nem logado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nada do comprador no pedido, na trava, no checkout, na notificacao ou no log", async () => {
    const logs: unknown[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void logs.push(a));
    }
    const m = memoria({ falharInsert: 1 });
    const pedindo = { checkout: { notificar_pendente: true, notificar_estorno: true } };
    const notificacoes: unknown[] = [];
    for (const c of [
      aviso("pix.gerado", aberto()),
      aviso("pix.gerado", aberto()),
      aviso("pedido.pago"),
      aviso("pedido.reembolsado", pedido({ status: "refunded" })),
      aviso("pedido.pago", pedido({ total_centavos: "abc" })),
      { ...aviso("pedido.pago"), versao: 9 },
    ]) {
      const r = await receber(m, c, pedindo);
      if (r.notificar) notificacoes.push(vendaDoPedidoExterno(r.notificar));
    }
    const gravado = JSON.stringify({ pedidos: [...m.pedidos.values()], eventos: [...m.eventos], marcas: m.marcas, notificacoes, logs });
    expect(m.pedidos.size).toBe(1);
    for (const dado of DADOS_DO_COMPRADOR) expect(gravado, dado).not.toContain(dado);
  });
});

describe("migration 076", () => {
  it("Eve nos dois CHECKs de plataforma, sem coluna nova", () => {
    const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/076_checkout_eve.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/checkouts_externos_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla', 'eve'\)\)/);
    expect(sql).toMatch(/checkout_externo_contas_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla', 'eve'\)\)/);
    expect(sql).not.toMatch(/add column/i);
  });
});
