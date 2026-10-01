import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gerarCodigoDoPixel } from "../src/lib/tracking/pixel-checkout";

// ============================================================================
// O pixel do checkout tem que identificar a LINHA da loja, nao so o dominio.
//
// Achado da revisao de seguranca: o app grava `stores` pelo cliente do usuario,
// entao qualquer conta do xcart consegue criar uma linha com o dominio de outra
// loja. Identificado so pelo dominio, o pixel mandava os eventos do checkout --
// com e-mail e telefone -- para a linha do intruso, e a ponte checkout ->
// clientId tambem, o que desligava a recuperacao de clique da compra.
// ============================================================================

const ID = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";

function fonte(...partes: string[]) {
  return readFileSync(path.join(process.cwd(), ...partes), "utf8");
}

describe("o trecho colado carrega o id da loja", () => {
  it("leva store=<id> e continua uma linha so", () => {
    const codigo = gerarCodigoDoPixel({ origemDoApp: "https://user.xcart.app/", storeId: ID });
    expect(codigo).toContain(`xcart-pixel.js?store=${ID}&shop=`);
    expect(codigo).toContain("(self.ctx=this).init.data.shop.myshopifyDomain");
    expect(codigo.split("\n")).toHaveLength(1);
  });

  it("id fora do formato de uuid nao entra na string JS", () => {
    // O valor vai para dentro de uma string que o lojista cola no admin.
    const codigo = gerarCodigoDoPixel({
      origemDoApp: "https://user.xcart.app",
      storeId: '";alert(1);//',
    });
    expect(codigo).not.toContain("alert");
    expect(codigo).toContain("?store=&shop=");
  });
});

describe("o pixel manda o id, e o coletor nao adivinha", () => {
  it("xcart-pixel.js le o store do proprio src e manda storeId", () => {
    const pixel = fonte("public", "xcart-pixel.js");
    expect(pixel).toContain('SRC.searchParams.get("store")');
    expect(pixel).toMatch(/storeId: STORE_ID/);
  });

  it("sem id, duas linhas ligadas para o mesmo dominio e recusa", () => {
    // O desempate antigo era o created_at, que o proprio usuario escreve.
    const coletor = fonte("src", "app", "api", "tracking", "collect", "route.ts");
    expect(coletor).toContain("loja ambigua");
    expect(coletor).toMatch(/!idDaTag && ligadas\.length > 1/);
    expect(coletor).not.toMatch(/order\("created_at", \{ ascending: false \}\)/);
  });
});
