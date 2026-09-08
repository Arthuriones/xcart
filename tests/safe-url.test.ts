import { describe, expect, it } from "vitest";
import { assertUrlPublica, urlEhPublica, UnsafeUrlError } from "@/lib/net/safe-url";

/**
 * O xcart importa catalogo de "qualquer site": o usuario cola um endereco e o
 * SERVIDOR busca. Sem trava, isso e um proxy aberto de dentro da infra.
 *
 * Cada caso abaixo PASSAVA na validacao antiga, que so olhava o formato do
 * nome (normalizeShopDomain). Foram confirmados um a um antes da correcao.
 */
describe("assertUrlPublica: recusa destino interno", () => {
  const recusar = [
    ["loopback direto", "http://127.0.0.1/admin"],
    ["loopback por nome", "http://localhost:3000/"],
    ["link-local (metadados da nuvem)", "http://169.254.169.254/latest/meta-data/"],
    ["rede privada 10.x", "http://10.0.0.5/"],
    ["rede privada 192.168", "http://192.168.1.1/"],
    ["rede privada 172.16", "http://172.16.0.1/"],
    ["CGNAT", "http://100.64.0.1/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
    ["IPv6 unique-local", "http://[fd00::1]/"],
    ["IPv4 mapeado em IPv6", "http://[::ffff:127.0.0.1]/"],
    ["sufixo .internal", "http://metadata.google.internal/"],
    ["sufixo .local", "http://redis.local/"],
    ["kubernetes", "http://admin.svc.cluster.local/"],
    ["host de rotulo unico", "http://intranet/"],
    ["protocolo file", "file:///etc/passwd"],
    ["protocolo gopher", "gopher://127.0.0.1:6379/_INFO"],
    ["protocolo data", "data:text/plain,oi"],
    ["endereco quebrado", "nao-e-url"],
  ] as const;

  for (const [nome, url] of recusar) {
    it(`recusa ${nome}`, async () => {
      await expect(assertUrlPublica(url)).rejects.toBeInstanceOf(UnsafeUrlError);
    });
  }

  it("recusa nome publico que RESOLVE para IP privado", async () => {
    // nip.io e sslip.io resolvem <ip>.nip.io para o proprio <ip>. Sao o jeito
    // classico de furar validacao que so olha o texto do dominio -- e os dois
    // passavam na validacao antiga.
    expect(await urlEhPublica("http://169.254.169.254.nip.io/")).toBe(false);
    expect(await urlEhPublica("http://10.0.0.1.nip.io/")).toBe(false);
    expect(await urlEhPublica("http://127.0.0.1.sslip.io/")).toBe(false);
  }, 15000);
});

describe("assertUrlPublica: aceita destino legitimo", () => {
  it("aceita loja Shopify publica", async () => {
    const { url } = await assertUrlPublica("https://www.blockstore.cl/products.json");
    expect(url.hostname).toBe("www.blockstore.cl");
  }, 15000);

  it("aceita myshopify.com", async () => {
    await expect(
      assertUrlPublica("https://q2mdgs-ag.myshopify.com/products.json")
    ).resolves.toBeTruthy();
  }, 15000);

  it("preserva caminho e query", async () => {
    const { url } = await assertUrlPublica(
      "https://www.blockstore.cl/products.json?limit=250&page=2"
    );
    expect(url.pathname).toBe("/products.json");
    expect(url.searchParams.get("limit")).toBe("250");
  }, 15000);
});
