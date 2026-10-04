import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  montarUserData,
  normalizarTelefone,
  sha256,
  variantesDaCidade,
  variantesDoNome,
} from "../src/lib/tracking/normalizar";
import {
  cliquesDaLanding,
  montarPurchase,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";
import type { DestinoNaTela } from "../src/lib/tracking/queries";
import type { DiagnosticoLoja } from "../src/lib/tracking/diagnostico";
import {
  pedidosEsperados,
  pedidosSemCompra,
} from "../src/app/(dashboard)/tracking/saude";

// ============================================================================
// A primeira venda de anuncio da Lash Bestie (#NM100599, 01/10/2026) saiu
// certa para o Meta e para o Google -- e a auditoria dela achou o que estes
// testes travam. A forma do pedido e a real; a PII nao.
// ============================================================================

/** fbclid no formato atual: termina em `_aem_` + 22 caracteres. */
const FBCLID =
  "PAZXh0bgNhZW0BMABwZG9mAmZkaWQWUPdfUAgIrpYck69ZRlxsnT9rp0UB-mFkaWQAAC_gviAPg3NydGMGYXBwX2lkDzEyNDAyNDU3NDI4NzQxNAABpw0sDnTXCiOYNLv1qTMNCFgLB5hMIMTP6qQeXcIzfbp7KpvqKGfmGWE2Lqmr_aem_zAAl4tVBmgYdpCcJKqS6pg";
const LANDING = `/products/breeze-wispy-lash-cluster-collection?fbclid=${FBCLID}`;

const PEDIDO: PedidoShopify = {
  id: 18921454928145,
  email: "cliente@exemplo.fr",
  currency: "USD",
  total_price: "78.79",
  created_at: "2026-10-01T10:53:47Z",
  landing_site: LANDING,
  order_status_url: "https://lashbestie.shop/86539223313/orders/abc/authenticate?key=x",
  billing_address: { first_name: "Hélène", last_name: "Martin", city: "Orléans", zip: "45000", country_code: "FR" },
  shipping_address: { first_name: "Hélène", last_name: "Martin", city: "Orléans", zip: "45000", country_code: "FR" },
  note_attributes: [],
  line_items: [
    // A oferta "compre 2 leve 4": as 2 gratis vem numa linha propria do mesmo
    // produto, com o desconto alocado a ela.
    { variant_id: 67606346727697, product_id: 1, sku: "MAX-BREEZE", quantity: 2, price: "39.39", discount_allocations: [] },
    { variant_id: 67606346727697, product_id: 1, sku: "MAX-BREEZE", quantity: 2, price: "39.39", discount_allocations: [{ amount: "78.77" }] },
  ],
};

describe("fbclid da URL de chegada perto do corte de 255", () => {
  it("o landing real tem 255 e o fbclid inteiro sobrevive", () => {
    expect(LANDING.length).toBe(255);
    expect(cliquesDaLanding(LANDING).fbclid).toBe(FBCLID);
  });

  it("fbclid cortado no meio continua descartado", () => {
    // Path 5 caracteres maior e o corte da Shopify em 255: o fbclid perde o fim.
    const cortado = LANDING.replace("/products/", "/products/aaaaa").slice(0, 255);
    expect(cortado.endsWith(FBCLID)).toBe(false);
    expect(cliquesDaLanding(cortado).fbclid).toBeNull();
  });

  it("sem cart attribute nem identidade, a compra reconstroi o fbc pela landing", () => {
    const fbc = montarPurchase(PEDIDO).evento.user_data.fbc;
    expect(fbc).toBe(`fb.1.${Date.parse("2026-10-01T10:53:47Z")}.${FBCLID}`);
  });
});

describe("contents: uma entrada por item, com o preco pago", () => {
  it("junta as linhas do mesmo produto e desconta as unidades gratis", () => {
    const { evento } = montarPurchase(PEDIDO);
    // 2 x 39.39 + (2 x 39.39 - 78.77) = 78.79, em 4 unidades.
    expect(evento.custom_data?.contents).toEqual([
      { id: "67606346727697", quantity: 4, item_price: 19.7 },
    ]);
    expect(evento.custom_data?.value).toBe(78.79);
  });

  it("brinde (pago zero) sai sem item_price", () => {
    const { evento } = montarPurchase({
      id: 1,
      line_items: [{ variant_id: 9, quantity: 1, price: "10.00", discount_allocations: [{ amount: "10.00" }] }],
    });
    expect(evento.custom_data?.contents).toEqual([{ id: "9", quantity: 1 }]);
  });
});

describe("telefone", () => {
  it("'00' e o prefixo internacional, nao tronco nacional", () => {
    expect(normalizarTelefone("0033 6 12 34 56 78", "FR")).toBe("33612345678");
    expect(normalizarTelefone("0044 7700 900123", "FR")).toBe("447700900123");
    // O caminho de sempre continua igual.
    expect(normalizarTelefone("06 12 34 56 78", "FR")).toBe("33612345678");
    expect(normalizarTelefone("+33 6 12 34 56 78", "FR")).toBe("33612345678");
  });

  it("o telefone so do endereco de entrega tambem vai", () => {
    const { userData } = montarPurchase({
      ...PEDIDO,
      shipping_address: { ...PEDIDO.shipping_address, phone: "+33 6 12 34 56 78" },
    });
    expect(userData.ph).toEqual([sha256("33612345678")]);
  });

  it("o telefone da entrega leva o DDI do pais da ENTREGA, nao o da cobranca", () => {
    // Cobranca FR sem telefone, entrega ES com numero nacional. Com o pais da
    // cobranca sairia 33612345678 -- um celular frances valido de outra pessoa.
    const { userData } = montarPurchase({
      ...PEDIDO,
      shipping_address: { ...PEDIDO.shipping_address, country_code: "ES", phone: "612 345 678" },
    });
    expect(userData.ph).toEqual([sha256("34612345678")]);
    // O pais do pedido continua o da cobranca.
    expect(userData.country).toEqual([sha256("fr")]);
  });
});

describe("nome e cidade com acento: as duas formas", () => {
  it("manda a forma UTF-8 da documentacao do Meta e a sem acento", () => {
    // O exemplo da documentacao: "Valéry" -> "valéry".
    expect(variantesDoNome("Valéry")).toEqual(["valéry", "valery"]);
    expect(variantesDoNome("D'Ávila")).toEqual(["dávila", "davila"]);
    expect(variantesDaCidade("Orléans")).toEqual(["orléans", "orleans"]);
  });

  it("sem acento continua um hash so", () => {
    expect(variantesDoNome("Martin")).toEqual(["martin"]);
    expect(montarUserData({ sobrenome: "Martin" }).ln).toEqual([sha256("martin")]);
  });

  it("escrita nao latina passa a sair", () => {
    expect(variantesDoNome("田中")).toEqual(["田中"]);
  });

  it("as vogais de escrita indiana e tailandesa ficam (sao marcas combinantes)", () => {
    // Sem elas "सुनील" (Sunil) virava "सनल" (Sanal), outro nome.
    expect(variantesDoNome("सुनील")).toEqual(["सुनील"]);
    expect(variantesDoNome("สมศักดิ์")).toEqual(["สมศักดิ์"]);
    expect(variantesDaCidade("मुंबई")).toEqual(["मुंबई"]);
  });

  it("o user_data leva os dois hashes", () => {
    const u = montarUserData({ primeiroNome: "Hélène", cidade: "Orléans" });
    expect(u.fn).toEqual([sha256("hélène"), sha256("helene")]);
    expect(u.ct).toEqual([sha256("orléans"), sha256("orleans")]);
  });
});

describe("tela: pedido com compra enviada conta, qualquer que seja a data do destino", () => {
  // Os destinos que nasceram da migration 043 tem a hora da migration como
  // cadastro. A tela mostrava "1/1" numa loja com 3 pedidos e 3 compras.
  const dest = {
    id: "m1",
    plataforma: "meta",
    criadoEm: "2026-10-01T01:26:20Z",
    contagem: { pedidosComCompra: ["a", "b", "c"], pedidosNaFila: [] },
  } as unknown as DestinoNaTela;
  const diag = {
    pedidoIds: ["a", "b", "c"],
    pedidoCriadoEm: {
      a: "2026-09-29T12:36:20Z",
      b: "2026-09-29T17:08:32Z",
      c: "2026-10-01T10:53:47Z",
    },
  } as unknown as DiagnosticoLoja;

  it("3 esperados, 0 faltando", () => {
    expect(pedidosEsperados(dest, diag)).toBe(3);
    expect(pedidosSemCompra(dest, diag)).toBe(0);
  });
});

describe("painel: sem clique vem do payload, nao do texto do aviso", () => {
  // O commit d23ed30 trocou a frase do aviso do Meta e a contagem, que
  // procurava a frase, zerou: o alarme de venda sem clique no Meta ficou mudo.
  it("a definicao vigente de tracking_painel le fbc e gclid do payload", () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const vigente = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((sql) => /create or replace function public\.tracking_painel/i.test(sql))
      .pop();
    expect(vigente).toBeDefined();
    expect(vigente).toMatch(/'user_data'\s*->>\s*'fbc'/);
    for (const k of ["gclid", "gbraid", "wbraid"]) {
      expect(vigente).toMatch(new RegExp(`payload\\s*->>\\s*'${k}'`));
    }
  });
});
