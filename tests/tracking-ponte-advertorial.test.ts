import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A ponte roda no advertorial e o snippet roda na loja -- dois arquivos, dois
 * dominios, e nenhum deles sabe do outro em tempo de execucao.
 *
 * O acordo entre eles e uma LISTA DE NOMES de parametro. Se a ponte encaminhar
 * `gclid` e a loja passar a ler outra coisa (ou o contrario), o comprador chega
 * na loja sem click id e a venda vira "direto". A conversao ainda sai, entao nao
 * ha erro nem fila parada -- so o anuncio deixando de receber o credito.
 *
 * Mesma classe de falha do sorteio do rodizio, e travada do mesmo jeito: lendo
 * os dois arquivos do disco e comparando.
 */

const raiz = path.resolve(__dirname, "..", "public");
const ponte = readFileSync(path.join(raiz, "xcart-bridge.js"), "utf8");
const snippet = readFileSync(path.join(raiz, "xcart-click.js"), "utf8");

/** Extrai o array literal de uma `var NOME = [...]`. */
function listaDe(fonte: string, nome: string): string[] {
  const m = fonte.match(new RegExp(`var\\s+${nome}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`nao achei a lista ${nome}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("ponte e snippet falam dos mesmos parametros", () => {
  const daPonte = listaDe(ponte, "CLICK_IDS");
  const doSnippet = listaDe(snippet, "CHAVES");

  it("as duas listas foram encontradas", () => {
    // Guarda contra o teste passar por nao ter achado nada, se alguem renomear.
    expect(daPonte.length).toBeGreaterThan(2);
    expect(doSnippet.length).toBeGreaterThan(2);
  });

  it("a ponte encaminha exatamente o que a loja le", () => {
    expect([...daPonte].sort()).toEqual([...doSnippet].sort());
  });

  it("os tres do Google estao nos dois lados", () => {
    // gbraid/wbraid substituem o gclid no trafego de iOS. Esquecer um deles
    // deixa essa parte inteira da campanha sem atribuicao.
    for (const chave of ["gclid", "gbraid", "wbraid"]) {
      expect(daPonte, `ponte: ${chave}`).toContain(chave);
      expect(doSnippet, `snippet: ${chave}`).toContain(chave);
    }
  });

  it("o fbclid esta nos dois lados", () => {
    // Sem ele o servidor nao reconstroi o _fbc, e o evento do Meta chega sem
    // ligacao com o anuncio.
    expect(daPonte).toContain("fbclid");
    expect(doSnippet).toContain("fbclid");
  });
});

describe("a ponte nao vaza click id para terceiro", () => {
  it("exige a lista de destinos e sai sem ela", () => {
    // Reescrever "todo link externo" mandaria o gclid para o Instagram, o
    // WhatsApp e qualquer outro link da pagina.
    expect(ponte).toContain("data-xcart-destinos");
    expect(ponte).toMatch(/DESTINOS\.length\s*===\s*0\)\s*return/);
  });

  it("nao tem curinga", () => {
    // Um "*" aceito na lista anularia a protecao inteira.
    expect(ponte).not.toMatch(/===\s*["']\*["']/);
    expect(ponte).not.toMatch(/indexOf\(["']\*["']\)/);
  });

  it("casa subdominio pelo ponto, nao por sufixo solto", () => {
    // `host.endsWith(d)` aprovaria "naolinguo.shop" para o destino
    // "linguo.shop". O ponto e o que separa os dois casos.
    expect(ponte).toContain('"." + d');
  });

  it("so encaminha em http(s)", () => {
    // `javascript:` e `data:` num href viram execucao, nao navegacao.
    expect(ponte).toMatch(/protocol !== "http:" && u\.protocol !== "https:"/);
  });
});

describe("a ponte preserva o que a pagina ja definiu", () => {
  it("click id nosso vence, utm da pagina nao", () => {
    // O click id e do clique que esta acontecendo agora, entao manda. Ja um utm
    // escrito naquele botao foi decisao de quem montou a pagina.
    expect(ponte).toMatch(/u\.searchParams\.set\(c, guardados\[c\]\)/);
    expect(ponte).toMatch(/!u\.searchParams\.has\(m\)/);
  });
});
