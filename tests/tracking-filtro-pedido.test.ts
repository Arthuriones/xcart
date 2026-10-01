import { describe, expect, it } from "vitest";
import { motivoParaIgnorarPedido } from "../src/lib/tracking/filtro-pedido";

// O webhook e a tela usam esta mesma regra. Se divergissem, a tela acusaria
// "pedido sem compra enviada" para cada pedido de teste.

describe("pedidos que nao viram conversao", () => {
  it("ignora pedido de teste", () => {
    expect(motivoParaIgnorarPedido({ test: true, total_price: "49.00" })).toMatch(/teste/);
  });

  it("ignora PDV e draft order", () => {
    expect(motivoParaIgnorarPedido({ source_name: "pos", total_price: "10" })).toMatch(/PDV/);
    // Draft de reenvio carrega a PII do cliente real: o Meta contaria uma
    // segunda compra com valor.
    expect(
      motivoParaIgnorarPedido({ source_name: "shopify_draft_order", total_price: "10" })
    ).toMatch(/draft/);
  });

  it("ignora valor zero (reposicao gratis)", () => {
    expect(motivoParaIgnorarPedido({ total_price: "0.00" })).toMatch(/zero/);
  });

  it("deixa passar venda normal da loja online", () => {
    expect(motivoParaIgnorarPedido({ source_name: "web", total_price: "63.90" })).toBeNull();
  });

  it("deixa passar canal desconhecido: e lista de bloqueio, nao de permissao", () => {
    // App de checkout/upsell e canal Shop mandam outro source_name, as vezes
    // um numero. Sao vendas reais.
    expect(motivoParaIgnorarPedido({ source_name: "580111", total_price: "39" })).toBeNull();
    expect(motivoParaIgnorarPedido({ source_name: "shop", total_price: "39" })).toBeNull();
  });

  it("valor ausente nao e valor zero", () => {
    expect(motivoParaIgnorarPedido({ source_name: "web" })).toBeNull();
  });
});
