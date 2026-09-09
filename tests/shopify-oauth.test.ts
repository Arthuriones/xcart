import { describe, expect, it } from "vitest";
import {
  COOKIE_STATE,
  lerEstado,
  nonceConfere,
  novoNonce,
  opcoesCookie,
  serializarEstado,
  VALIDADE_SEGUNDOS,
} from "@/lib/shopify/oauth-state";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import { assertShopDomainPublico, ShopDomainError } from "@/lib/shopify/safe-shop";

/**
 * O `state` do OAuth era o `store.id`. Um UUID de linha do banco nao e nonce:
 * nao e imprevisivel, nao expira e serve mais de uma vez. Estes testes trancam
 * as tres propriedades que o state precisa ter.
 */
describe("nonce do OAuth", () => {
  it("e imprevisivel e nao repete", () => {
    const vistos = new Set(Array.from({ length: 500 }, () => novoNonce()));
    expect(vistos.size).toBe(500);
  });

  it("tem entropia suficiente (32 bytes em hex)", () => {
    const n = novoNonce();
    expect(n).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("estado no cookie", () => {
  it("ida e volta preserva nonce e storeId", () => {
    const estado = { nonce: novoNonce(), storeId: "11111111-2222-3333-4444-555555555555" };
    expect(lerEstado(serializarEstado(estado))).toEqual(estado);
  });

  it("storeId com ponto nao quebra a leitura", () => {
    // O separador e o PRIMEIRO ponto; o resto e todo storeId. Cortar no
    // ultimo ponto truncaria silenciosamente um id que contivesse um.
    const estado = { nonce: "abc", storeId: "id.com.ponto" };
    expect(lerEstado(serializarEstado(estado))).toEqual(estado);
  });

  it("cookie ausente ou malformado nao vira estado valido", () => {
    for (const ruim of [undefined, "", "semponto", ".soStore", "soNonce."]) {
      expect(lerEstado(ruim)).toBeNull();
    }
  });
});

describe("nonceConfere", () => {
  it("aceita o par certo", () => {
    const n = novoNonce();
    expect(nonceConfere(n, n)).toBe(true);
  });

  it("recusa nonce diferente, ausente ou vazio", () => {
    const n = novoNonce();
    expect(nonceConfere(novoNonce(), n)).toBe(false);
    expect(nonceConfere(null, n)).toBe(false);
    expect(nonceConfere("", n)).toBe(false);
    expect(nonceConfere(n, "")).toBe(false);
  });

  it("recusa prefixo do nonce certo", () => {
    // timingSafeEqual joga com tamanhos diferentes; a guarda de tamanho tem
    // que vir antes, senao isto vira excecao em vez de "false".
    const n = novoNonce();
    expect(nonceConfere(n.slice(0, 32), n)).toBe(false);
  });

  it("um store.id nao passa como state (o formato antigo)", () => {
    const estado = { nonce: novoNonce(), storeId: "loja-123" };
    expect(nonceConfere(estado.storeId, estado.nonce)).toBe(false);
  });
});

describe("cookie do state", () => {
  it("e HttpOnly, Lax, com escopo no proprio fluxo e com expiracao", () => {
    const o = opcoesCookie(true);
    expect(o.httpOnly).toBe(true);
    expect(o.secure).toBe(true);
    // Strict nao mandaria o cookie no salto de volta vindo do dominio da
    // Shopify, e o callback quebraria para todo mundo.
    expect(o.sameSite).toBe("lax");
    expect(o.path).toBe("/api/shopify/auth");
    expect(o.maxAge).toBe(VALIDADE_SEGUNDOS);
    expect(o.maxAge).toBeGreaterThan(0);
    expect(o.maxAge).toBeLessThanOrEqual(15 * 60);
  });

  it("em http local nao marca secure, senao o cookie nem e gravado", () => {
    expect(opcoesCookie(false).secure).toBe(false);
  });

  it("o nome do cookie e estavel", () => {
    expect(COOKIE_STATE).toBe("shopify_oauth_state");
  });
});

/**
 * `normalizeShopDomain` valida FORMATO. O servidor manda client_secret e
 * access token para esse host, entao formato nao basta -- quem decide o
 * destino e o IP resolvido.
 */
describe("assertShopDomainPublico", () => {
  const internos = [
    "metadata.google.internal",
    "admin.svc.cluster.local",
    "redis.local",
    "169.254.169.254.nip.io",
    "10.0.0.1.sslip.io",
    "127.0.0.1.nip.io",
  ];

  it("normalizeShopDomain sozinha aprovava todos esses (o bug)", () => {
    for (const host of internos) {
      expect(normalizeShopDomain(host), host).not.toBeNull();
    }
  });

  it("recusa cada um deles", async () => {
    for (const host of internos) {
      await expect(assertShopDomainPublico(host), host).rejects.toBeInstanceOf(
        ShopDomainError
      );
    }
  }, 20000);

  it("recusa dominio invalido", async () => {
    for (const ruim of ["", "nao-e-dominio", "http://[::1]/"]) {
      await expect(assertShopDomainPublico(ruim)).rejects.toBeInstanceOf(ShopDomainError);
    }
  });

  it("aceita myshopify.com sem sequer consultar DNS", async () => {
    // Caminho quente: toda chamada da Admin API passa por aqui.
    await expect(assertShopDomainPublico("loja-que-nao-existe.myshopify.com")).resolves.toBe(
      "loja-que-nao-existe.myshopify.com"
    );
  });

  it("aceita dominio customizado publico de verdade", async () => {
    await expect(assertShopDomainPublico("www.blockstore.cl")).resolves.toBe(
      "www.blockstore.cl"
    );
  }, 15000);

  it("normaliza URL completa para hostname", async () => {
    await expect(
      assertShopDomainPublico("https://minha-loja.myshopify.com/admin")
    ).resolves.toBe("minha-loja.myshopify.com");
  });
});
