import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Campanhas e Integracoes (Meta, Google) leem o banco DENTRO de um Suspense:
 * o cabecalho sai na hora. Em Integracoes o Suspense tem a key do filtro do
 * topo (trocar loja, periodo ou moeda mostra o esqueleto de novo). Em
 * Campanhas NAO: a key remontaria o CampanhasTela e o lojista perderia nivel,
 * busca e filtros a cada troca de periodo; ali o topo esmaece o numero velho.
 * Campanhas tem loading.tsx com a forma dela (o prefetch para ali) e os links
 * vao direto a /integracoes/meta (/integracoes so redireciona).
 *
 * Le o fonte: as paginas importam next/headers e o cliente do Supabase, que
 * nao sobem no vitest.
 */
const RAIZ = path.join(__dirname, "..");
const caminho = (...p: string[]) => path.join(RAIZ, "src", "app", "(dashboard)", ...p);
const ler = (...p: string[]) => readFileSync(caminho(...p), "utf8");

/** O corpo da funcao exportada por default (dali ate o fim do arquivo). */
function paginaDefault(fonte: string): string {
  const i = fonte.indexOf("export default");
  expect(i).toBeGreaterThan(-1);
  return fonte.slice(i);
}

describe("Campanhas", () => {
  const pagina = ler("campanhas", "page.tsx");
  const esqueleto = ler("campanhas", "esqueleto.tsx");

  it("le as campanhas no Conteudo, dentro do Suspense SEM key (a tela guarda nivel, busca e filtros)", () => {
    const def = paginaDefault(pagina);
    expect(def).not.toContain("lerCampanhas");
    expect(def).toMatch(/<Suspense fallback={<EsqueletoCampanhas \/>}>\s*<Conteudo \/>/);
    // Key no Suspense remontaria o CampanhasTela a cada troca do topo.
    expect(def).not.toMatch(/<Suspense[^>]*\bkey=/);
    const conteudo = pagina.slice(pagina.indexOf("async function Conteudo"), pagina.indexOf("export default"));
    expect(conteudo).toContain("await lerCampanhas()");
    // O cabecalho fica fora do Suspense: sai antes da leitura.
    expect(def.indexOf("<CabecalhoCampanhas />")).toBeLessThan(def.indexOf("<Suspense"));
  });

  it("tem loading.tsx na largura total, com o mesmo cabecalho e esqueleto", () => {
    expect(existsSync(caminho("campanhas", "loading.tsx"))).toBe(true);
    const carregando = ler("campanhas", "loading.tsx");
    expect(carregando).toContain('data-largura="total"');
    expect(carregando).toContain("<CabecalhoCampanhas />");
    expect(carregando).toContain("<EsqueletoCampanhas />");
  });

  it("os links de integracoes vao direto ao Meta", () => {
    for (const fonte of [pagina, esqueleto]) {
      expect(fonte).not.toMatch(/href="\/integracoes"/);
    }
    expect(esqueleto).toContain('href="/integracoes/meta"');
    expect(pagina).toContain('href="/integracoes/meta"');
  });
});

describe("Integracoes Meta e Google", () => {
  for (const [pasta, rotulo] of [
    ["meta", "Carregando as contas do Meta"],
    ["google", "Carregando as contas do Google"],
  ] as const) {
    it(`${pasta}: le as contas dentro do Suspense com a key do filtro`, () => {
      const fonte = ler("integracoes", pasta, "page.tsx");
      const def = paginaDefault(fonte);
      expect(def).not.toContain("carregarAnuncios");
      expect(def).toContain(
        `<Suspense key={JSON.stringify(filtro)} fallback={<EsqueletoContas rotulo="${rotulo}" />}>`
      );
      // O fallback e o mesmo do loading.tsx: a troca nao muda o desenho.
      expect(ler("integracoes", pasta, "loading.tsx")).toContain(`rotulo="${rotulo}"`);
    });
  }
});
