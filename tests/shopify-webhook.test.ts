import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  assinaturaConfere,
  corpoJson,
  dentroDaJanela,
  JANELA_REPLAY_MS,
  lerCabecalhos,
} from "@/lib/shopify/webhook";

const SEGREDO = "shpss_segredo_da_loja";

function assinar(corpo: string, segredo = SEGREDO) {
  return createHmac("sha256", segredo).update(corpo, "utf8").digest("base64");
}

/**
 * O xcart nao tinha nenhum webhook da Shopify. Estes testes trancam as quatro
 * coisas que um handler de webhook erra na primeira versao: formato da
 * assinatura, corpo reserializado, comparacao ingenua e replay.
 */
describe("assinaturaConfere", () => {
  const corpo = JSON.stringify({ shop_domain: "loja.myshopify.com", id: 123 });

  it("aceita assinatura legitima", () => {
    expect(assinaturaConfere(corpo, assinar(corpo), SEGREDO)).toBe(true);
  });

  it("recusa assinatura de outro segredo", () => {
    // O segredo sai da LOJA identificada pelo header. Se o header pudesse
    // escolher a loja errada e ainda assim passar, o header viraria a
    // autorizacao -- que e o erro classico deste endpoint.
    expect(assinaturaConfere(corpo, assinar(corpo, "outro-segredo"), SEGREDO)).toBe(false);
  });

  it("recusa corpo adulterado com assinatura antiga", () => {
    const hmac = assinar(corpo);
    const adulterado = JSON.stringify({ shop_domain: "loja.myshopify.com", id: 999 });
    expect(assinaturaConfere(adulterado, hmac, SEGREDO)).toBe(false);
  });

  it("QUEBRA se o corpo for reserializado -- por isso tem que ser o corpo cru", () => {
    // Este teste existe para documentar a armadilha: `await req.json()` seguido
    // de JSON.stringify muda os bytes (espacos, ordem, escapes) e a HMAC deixa
    // de fechar. Webhook legitimo viraria 401 em producao.
    const cru = '{ "id": 123,  "nome": "acentuação" }';
    const hmac = assinar(cru);
    const reserializado = JSON.stringify(JSON.parse(cru));
    expect(assinaturaConfere(cru, hmac, SEGREDO)).toBe(true);
    expect(assinaturaConfere(reserializado, hmac, SEGREDO)).toBe(false);
  });

  it("assinatura em hex nao passa: a Shopify manda base64 no webhook", () => {
    // O callback de OAuth desta mesma app usa HEX. Sao formatos diferentes no
    // mesmo fornecedor, e trocar um pelo outro falha sempre.
    const hex = createHmac("sha256", SEGREDO).update(corpo, "utf8").digest("hex");
    expect(assinaturaConfere(corpo, hex, SEGREDO)).toBe(false);
  });

  it("recusa hmac ausente, vazio ou lixo", () => {
    expect(assinaturaConfere(corpo, null, SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, "", SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, "nao-e-base64!!!", SEGREDO)).toBe(false);
  });

  it("recusa quando o segredo esta vazio", () => {
    // Loja sem client_secret nao pode aceitar webhook por acidente.
    expect(assinaturaConfere(corpo, assinar(corpo, ""), "")).toBe(false);
  });

  it("assinatura truncada nao explode, so reprova", () => {
    // timingSafeEqual joga com tamanhos diferentes; sem a guarda isto seria
    // um 500 em vez de um 401.
    const curta = assinar(corpo).slice(0, 20);
    expect(() => assinaturaConfere(corpo, curta, SEGREDO)).not.toThrow();
    expect(assinaturaConfere(corpo, curta, SEGREDO)).toBe(false);
  });

  it("corpo vazio com assinatura correta continua valido", () => {
    expect(assinaturaConfere("", assinar(""), SEGREDO)).toBe(true);
  });
});

describe("dentroDaJanela (replay)", () => {
  const agora = Date.parse("2026-09-09T12:00:00Z");

  it("aceita entrega recente", () => {
    expect(dentroDaJanela("2026-09-09T11:58:00Z", agora)).toBe(true);
  });

  it("recusa captura antiga reenviada", () => {
    expect(dentroDaJanela("2026-09-09T11:00:00Z", agora)).toBe(false);
  });

  it("recusa data no futuro alem da janela (relogio adiantado ou forjado)", () => {
    expect(dentroDaJanela("2026-09-09T13:00:00Z", agora)).toBe(false);
  });

  it("na borda exata da janela ainda aceita", () => {
    const borda = new Date(agora - JANELA_REPLAY_MS).toISOString();
    expect(dentroDaJanela(borda, agora)).toBe(true);
  });

  it("sem o header, aceita", () => {
    // Um topico futuro que nao mande triggered_at nao pode parar de funcionar
    // por causa desta checagem.
    expect(dentroDaJanela(null, agora)).toBe(true);
  });

  it("data ilegivel nao derruba a entrega", () => {
    expect(dentroDaJanela("nao-e-data", agora)).toBe(true);
  });
});

describe("corpoJson", () => {
  it("le objeto valido", () => {
    expect(corpoJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("payload malformado devolve null em vez de lancar", () => {
    // Corpo torto com assinatura valida existe (bug do lado deles). O handler
    // precisa responder 200 e seguir, nao estourar em 500 e virar 48 h de retry.
    for (const ruim of ["", "{", "nao e json", "null", "[1,2]", '"texto"']) {
      expect(corpoJson(ruim), ruim).toBeNull();
    }
  });
});

describe("lerCabecalhos", () => {
  it("extrai os headers que importam", () => {
    const h = new Headers({
      "X-Shopify-Hmac-Sha256": "abc",
      "X-Shopify-Topic": "app/uninstalled",
      "X-Shopify-Shop-Domain": "loja.myshopify.com",
      "X-Shopify-Webhook-Id": "evt-1",
      "X-Shopify-Triggered-At": "2026-09-09T12:00:00Z",
      "X-Shopify-Api-Version": "2024-10",
    });
    expect(lerCabecalhos(h)).toEqual({
      hmac: "abc",
      topic: "app/uninstalled",
      shopDomain: "loja.myshopify.com",
      webhookId: "evt-1",
      triggeredAt: "2026-09-09T12:00:00Z",
      apiVersion: "2024-10",
    });
  });

  it("headers ausentes viram null, nao undefined", () => {
    const vazio = lerCabecalhos(new Headers());
    expect(Object.values(vazio).every((v) => v === null)).toBe(true);
  });
});
