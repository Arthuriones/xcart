import { describe, expect, it } from "vitest";
import { contarSinais, sha256 } from "../src/lib/tracking/normalizar";
import {
  idDoEvento,
  montarPurchase,
  sinaisDoPedido,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";

/** Pedido da loja de teste (Gotoku, JPY), com os campos que a Shopify manda. */
const PEDIDO: PedidoShopify = {
  id: 5544332211,
  order_number: 1042,
  email: "Cliente@Exemplo.com",
  currency: "jpy",
  total_price: "12800",
  created_at: "2026-09-20T12:00:00Z",
  browser_ip: "203.0.113.9",
  landing_site: "/products/bolsa?fbclid=ABC123",
  customer: {
    id: 99001,
    email: "Cliente@Exemplo.com",
    phone: "090-1234-5678",
    first_name: "Yuki",
    last_name: "Tanaka",
  },
  billing_address: {
    first_name: "Yuki",
    last_name: "Tanaka",
    city: "Tokyo",
    province: "Tokyo",
    zip: "150-0001",
    country_code: "JP",
  },
  client_details: { user_agent: "Mozilla/5.0 (iPhone)", browser_ip: "203.0.113.9" },
  note_attributes: [
    { name: "_fbp", value: "fb.1.1700000000000.111" },
    { name: "fbclid", value: "ABC123" },
  ],
  line_items: [
    { product_id: 1, variant_id: 11, quantity: 2, price: "6400" },
  ],
};

describe("Purchase montado a partir do pedido", () => {
  it("o event_id vem do pedido e e estavel", () => {
    // O Web Pixel do navegador tem que mandar EXATAMENTE isto. Divergiu, o
    // Meta conta a venda duas vezes ou descarta as duas.
    expect(idDoEvento(5544332211)).toBe("purchase_5544332211");
    expect(montarPurchase(PEDIDO).evento.event_id).toBe("purchase_5544332211");
  });

  it("le os click ids dos cart attributes", () => {
    // Cookie nao chega ao checkout da Shopify: e outro dominio. O cart
    // attribute e o que faz o clique sobreviver ate o pedido.
    const s = sinaisDoPedido(PEDIDO);
    expect(s.fbp).toBe("fb.1.1700000000000.111");
    expect(s.fbclid).toBe("ABC123");
  });

  it("reconstroi o fbc quando so veio o fbclid", () => {
    const { evento } = montarPurchase(PEDIDO);
    // fb.1.{ts_do_pedido}.{fbclid}
    expect(evento.user_data.fbc).toBe(
      `fb.1.${new Date("2026-09-20T12:00:00Z").getTime()}.ABC123`
    );
  });

  it("prefere o _fbc de verdade quando ele existe", () => {
    const comCookie = {
      ...PEDIDO,
      note_attributes: [
        ...(PEDIDO.note_attributes || []),
        { name: "_fbc", value: "fb.1.1699999999999.REAL" },
      ],
    };
    expect(montarPurchase(comCookie).evento.user_data.fbc).toBe(
      "fb.1.1699999999999.REAL"
    );
  });

  it("o event_time vai em SEGUNDOS", () => {
    // Em milissegundos o Meta recusa o evento inteiro.
    const { evento } = montarPurchase(PEDIDO);
    expect(evento.event_time).toBe(
      Math.floor(new Date("2026-09-20T12:00:00Z").getTime() / 1000)
    );
    expect(String(evento.event_time)).toHaveLength(10);
  });

  it("leva o conjunto completo de identificadores", () => {
    const { evento } = montarPurchase(PEDIDO);
    const ud = evento.user_data;
    for (const campo of ["em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id"] as const) {
      expect(ud[campo]?.[0], campo).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(ud.client_ip_address).toBe("203.0.113.9");
    expect(ud.client_user_agent).toBe("Mozilla/5.0 (iPhone)");
    // Bem acima dos 2 sinais de quem so manda fbp/fbc.
    expect(contarSinais(ud)).toBeGreaterThanOrEqual(11);
  });

  it("o telefone japones recebe o DDI a partir do pais do endereco", () => {
    const { evento } = montarPurchase(PEDIDO);
    expect(evento.user_data.ph?.[0]).toBe(sha256("819012345678"));
  });

  it("valor e moeda saem como o Meta espera", () => {
    const { evento } = montarPurchase(PEDIDO);
    expect(evento.custom_data?.currency).toBe("JPY");
    expect(evento.custom_data?.value).toBe(12800);
    expect(evento.custom_data?.num_items).toBe(2);
    expect(evento.custom_data?.content_ids).toEqual(["11"]);
  });

  /**
   * O pedido pode chegar sem nada de navegador: comprador com bloqueador, ou
   * venda feita pelo admin. O Purchase tem que sair assim mesmo -- e o unico
   * evento que nao depende de JavaScript.
   */
  it("sai mesmo sem nenhum sinal de navegador", () => {
    const seco: PedidoShopify = {
      id: 777,
      email: "outro@exemplo.com",
      currency: "JPY",
      total_price: "5000",
      created_at: "2026-09-20T12:00:00Z",
    };
    const { evento } = montarPurchase(seco);
    expect(evento.event_id).toBe("purchase_777");
    expect(evento.user_data.em?.[0]).toBe(sha256("outro@exemplo.com"));
    expect(evento.user_data.fbp).toBeUndefined();
    expect(evento.custom_data?.value).toBe(5000);
  });

  it("usa a identidade guardada quando o cart attribute nao veio", () => {
    const semAtributo = { ...PEDIDO, note_attributes: [] };
    const { evento } = montarPurchase(semAtributo, {
      identidade: { fbp: "fb.1.1.guardado", clientIp: "198.51.100.7" },
    });
    expect(evento.user_data.fbp).toBe("fb.1.1.guardado");
  });

  it("nao inventa event_source_url sem dominio", () => {
    expect(montarPurchase(PEDIDO).evento.event_source_url).toBeUndefined();
    expect(
      montarPurchase(PEDIDO, { dominioLoja: "gotoku-ya.shop" }).evento.event_source_url
    ).toBe("https://gotoku-ya.shop/products/bolsa?fbclid=ABC123");
  });
});
