import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * O fallback do menu (o <Suspense> do layout do painel) e o proprio Sidebar
 * com os dados vazios, nao um <aside> vazio: no celular a barra de baixo mora
 * dentro do Sidebar, e com o esqueleto antigo ("hidden md:block") nao havia
 * navegacao nenhuma ate perfil, alertas e o guia terminarem de ler.
 *
 * Le o fonte: sidebar-data.tsx importa next/headers e o cliente do Supabase,
 * que nao sobem no vitest.
 */
const RAIZ = path.join(__dirname, "..");
const ler = (...p: string[]) => readFileSync(path.join(RAIZ, ...p), "utf8");

describe("menu antes dos dados", () => {
  const dados = ler("src", "components", "layout", "sidebar-data.tsx");
  const layout = ler("src", "app", "(dashboard)", "layout.tsx");
  const sidebar = ler("src", "components", "layout", "sidebar.tsx");

  it("o layout usa o SidebarSkeleton como fallback do menu", () => {
    expect(layout).toMatch(/<Suspense fallback={<SidebarSkeleton recolhido={recolhido} \/>}>\s*<SidebarData \/>/);
  });

  it("o SidebarSkeleton desenha o Sidebar, sem contador, guia nem conta", () => {
    const esqueleto = dados.slice(dados.indexOf("export function SidebarSkeleton"));
    expect(esqueleto).toContain("<Sidebar");
    expect(esqueleto).not.toContain("<aside");
    for (const campo of ['nome: ""', 'email: ""', "plano: null", "creditos: 0", "alertas: 0", "guia: null", "recolhido"]) {
      expect(esqueleto, campo).toContain(campo);
    }
  });

  // A conta some so no esqueleto, marcado de proposito. Nome e e-mail vazios
  // tambem saem do SidebarData real (sessao revogada, Auth fora do ar: o
  // getUser volta null e o painel abre); ai a conta e o Sair continuam.
  it("so o esqueleto se marca como carregando", () => {
    const esqueleto = dados.slice(dados.indexOf("export function SidebarSkeleton"));
    const real = dados.slice(0, dados.indexOf("export function SidebarSkeleton"));
    expect(esqueleto).toContain("carregando: true");
    expect(real).not.toContain("carregando");
  });

  it("a conta depende da marca do esqueleto, nao do nome vazio", () => {
    expect(sidebar).toMatch(/const temConta = !dados\.carregando;/);
    expect(sidebar).not.toMatch(/temConta = !!nomeConta/);
  });

  it("o cartao do guia tambem abre a folha Mais do celular", () => {
    const folha = sidebar.slice(sidebar.indexOf("<Folha"));
    expect(folha).toContain("<CartaoGuia guia={dados.guia}");
  });
});
