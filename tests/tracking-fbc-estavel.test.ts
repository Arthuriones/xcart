import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sinaisDoPedido } from "../src/lib/tracking/purchase";

// ============================================================================
// O `_fbc` tem que ser O MESMO em todos os eventos do mesmo clique.
//
// O formato e `fb.1.<instante do clique>.<fbclid>` e o Meta trata o valor
// inteiro como UM identificador. Enquanto o servidor reconstruia com a hora de
// agora, cada evento saia com um valor diferente -- medido em producao: um
// visitante com 11 eventos mandou 11 `_fbc` distintos, o mesmo clique parecendo
// 11 cliques. O funil deixava de se ligar a compra.
//
// O carimbo certo e o instante em que o clique foi OBSERVADO, que so o
// navegador conhece. Por isso ele e montado uma vez no snippet e guardado em
// cookie. Estes testes travam as duas pontas dessa decisao.
// ============================================================================

const snippet = readFileSync(
  path.join(process.cwd(), "public", "xcart-click.js"),
  "utf8"
);

describe("o snippet guarda o _fbc em vez de remontar", () => {
  it("persiste o valor montado em cookie proprio", () => {
    // Sem isto, cada carregamento de pagina inventa um carimbo novo.
    expect(snippet).toContain('gravarCookie(PREFIXO + "fbc", fbc)');
  });

  it("le o cookie do proprio Meta antes do nosso", () => {
    // Com o pixel do navegador instalado, o valor dele e a verdade.
    expect(snippet).toMatch(/lerCookie\("_fbc"\)\s*\|\|\s*lerCookie\(PREFIXO \+ "fbc"\)/);
  });

  it("so monta quando ha fbclid", () => {
    // `_fbc` afirma um clique em anuncio. Sem fbclid na URL, inventar um seria
    // afirmar uma origem que nao aconteceu.
    expect(snippet).toMatch(/if \(achados\.fbclid &&/);
  });

  it("refaz quando chega um fbclid novo", () => {
    // Clique novo e atribuicao mais recente; manter o antigo creditaria o
    // anuncio errado.
    expect(snippet).toContain("fbclidDoFbc(fbc) !== achados.fbclid");
  });

  it("fbclid novo na URL vence ate o cookie do Meta", () => {
    // Com o pixel desligado, o `_fbc` do Meta que sobrou e fossil do clique
    // anterior. Antes, a existencia dele bloqueava o refazer e o clique novo
    // era creditado ao anuncio velho. Comportamento coberto de ponta a ponta
    // em tests/tracking-snippet-carrinho.test.ts.
    expect(snippet).toMatch(/frescos\.fbclid \|\| !fbcDoMeta/);
  });

  it("reusa o _fbc ja montado para o mesmo clique, sem carimbo novo", () => {
    expect(snippet).toContain("fbclidDoFbc(fbcNosso) === achados.fbclid");
  });
});

describe("o pedido le o _fbc que veio do carrinho", () => {
  it("prefere o atributo _fbc ao fbclid cru", () => {
    const sinais = sinaisDoPedido({
      note_attributes: [
        { name: "_fbc", value: "fb.1.1700000000000.ABC" },
        { name: "fbclid", value: "ABC" },
      ],
    });
    expect(sinais.fbc).toBe("fb.1.1700000000000.ABC");
  });

  it("sem o atributo, sobra o fbclid para o servidor reconstruir", () => {
    const sinais = sinaisDoPedido({
      note_attributes: [{ name: "fbclid", value: "ABC" }],
    });
    expect(sinais.fbc).toBeNull();
    expect(sinais.fbclid).toBe("ABC");
  });
});
