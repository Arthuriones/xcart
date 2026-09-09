import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { dominioDeDestino } from "@/lib/net/url-guard";

/**
 * A trava de dominio existe DUAS vezes: em src/lib/net/url-guard.ts (servidor)
 * e dentro de public/routed-checkout-loader.js (inline, no tema da vitrine).
 *
 * Esse era o problema original. O servidor validava, o loader nao -- e o
 * loader e quem decide para onde o comprador vai na maioria dos carrinhos,
 * porque o caminho inline nem chama a API. Quando dois validadores discordam,
 * quem manda e o mais fraco.
 *
 * Este teste le a funcao REAL do loader do disco e compara decisao a decisao.
 * Se alguem afrouxar um lado, quebra aqui e nao numa venda.
 */

const loaderSrc = readFileSync(
  path.resolve(__dirname, "../public/routed-checkout-loader.js"),
  "utf8"
);

/** Recorta uma funcao do loader pelo nome, casando chaves. */
function extrairFuncao(nome: string): string {
  const inicio = loaderSrc.indexOf(`function ${nome}(`);
  if (inicio === -1) throw new Error(`funcao ${nome} nao encontrada no loader`);
  let nivel = 0;
  let vistoAbre = false;
  for (let i = inicio; i < loaderSrc.length; i += 1) {
    const c = loaderSrc[i];
    if (c === "{") {
      nivel += 1;
      vistoAbre = true;
    } else if (c === "}") {
      nivel -= 1;
      if (vistoAbre && nivel === 0) return loaderSrc.slice(inicio, i + 1);
    }
  }
  throw new Error(`nao consegui fechar a funcao ${nome}`);
}

const dominioDoLoader = new Function(
  `${extrairFuncao("dominioSeguro")}; return dominioSeguro;`
)() as (entrada: unknown) => string | null;

/** Todo caso do pentest, mais os legitimos. */
const CASOS: string[] = [
  // esquemas
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "file:///etc/passwd",
  "ftp://evil.com/x",
  "blob:https://evil.com/uuid",
  "vbscript:msgbox(1)",
  "gopher://127.0.0.1:6379/_INFO",
  // barras
  "//evil.com",
  "///evil.com",
  "\\\\evil.com",
  "/\\evil.com",
  "https:\\\\evil.com",
  "http:/\\evil.com",
  // codificacao
  "%6a%61%76%61%73%63%72%69%70%74:alert(1)",
  "%25%36%61avascript:alert(1)",
  "%2f%2fevil.com",
  "аррӏе.com",
  "xn--80ak6aa92e.com",
  "lojа.myshopify.com",
  // autoridade
  "https://google.com@evil.com",
  "google.com@evil.com",
  "user:pass@evil.com",
  "loja.myshopify.com@evil.com",
  "evil.com#",
  "evil.com?",
  "evil.com#@loja.myshopify.com",
  "evil.com?x=1",
  "evil.com/caminho",
  "loja.myshopify.com:8080",
  "evil.com:22",
  "evil.com.",
  "evil.com..",
  "-evil.com",
  "evil-.com",
  "ev..il.com",
  // interno
  "http://127.0.0.1",
  "127.0.0.1",
  "http://localhost",
  "localhost",
  "169.254.169.254",
  "http://[::1]",
  "169.254.169.254.nip.io",
  "10.0.0.1.sslip.io",
  "metadata.google.internal",
  "redis.local",
  "2130706433",
  // CRLF e lixo
  "loja.myshopify.com\r\nX-Injected: 1",
  "loja.myshopify.com\n",
  "loja myshopify com",
  "",
  "   ",
  ".",
  "..",
  "com",
  ".com",
  "evil",
  "evil.c",
  "evil.123",
  // legitimos
  "loja.myshopify.com",
  "q2mdgs-ag.myshopify.com",
  "elise-boutique-5439.myshopify.com",
  "LOJA.MYSHOPIFY.COM",
  "  loja.myshopify.com  ",
  "https://loja.myshopify.com",
  "http://loja.myshopify.com",
  "https://loja.myshopify.com/",
  "www.blockstore.cl",
  "checkout.minhaloja.com.br",
  "a.co",
  "loja.myshopify.com.evil.com",
];

describe("paridade loader x servidor", () => {
  for (const entrada of CASOS) {
    it(`decide igual para ${JSON.stringify(entrada)}`, () => {
      expect(dominioDoLoader(entrada), "loader").toBe(dominioDeDestino(entrada));
    });
  }

  it("tipo errado tambem concorda, sem lancar dos dois lados", () => {
    for (const lixo of [null, undefined, 42, {}, []]) {
      expect(() => dominioDoLoader(lixo)).not.toThrow();
      expect(dominioDoLoader(lixo)).toBe(dominioDeDestino(lixo));
    }
  });

  it("concordam para qualquer string (propriedade)", () => {
    // Os casos escritos a mao cobrem o que ja sabemos. Esta propriedade cobre
    // o que ninguem pensou: gera string arbitraria e exige a MESMA decisao.
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        return dominioDoLoader(s) === dominioDeDestino(s);
      }),
      { numRuns: 3000 }
    );
  });

  it("concordam para hosts plausiveis montados por partes (propriedade)", () => {
    const pedaco = fc.constantFrom(
      "loja",
      "myshopify",
      "com",
      "evil",
      "@",
      ":8080",
      "//",
      "\\",
      "#",
      "?",
      ".",
      "..",
      "xn--abc",
      "127",
      "0",
      "1",
      "%2f",
      "\t",
      "-"
    );
    fc.assert(
      fc.property(fc.array(pedaco, { minLength: 1, maxLength: 8 }), (partes) => {
        const s = partes.join("");
        return dominioDoLoader(s) === dominioDeDestino(s);
      }),
      { numRuns: 3000 }
    );
  });
});
