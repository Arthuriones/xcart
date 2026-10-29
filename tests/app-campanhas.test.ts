import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivar, somarLinhas, somasVazias, type LinhaCampanha, type SomasCampanha } from "@/lib/campanhas/metricas";
import {
  FILTRO_CAMPANHAS_PADRAO,
  filtrarLinhas,
  filtroDeParametros,
  semDetalheDoFiltro,
  totalDasLinhas,
  type FiltroCampanhas,
} from "@/lib/campanhas/filtrar";
import type { DadosCampanhas } from "@/lib/leitura/campanhas";
import type { ResultadoCampanhas } from "@/lib/campanhas/montar";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// Campanhas e "eu" no APP DO CELULAR.
//   - o filtro da tela (nivel, plataforma, conta, status, busca) saiu do
//     navegador para src/lib/campanhas/filtrar.ts: a tela e a rota do app usam
//     a mesma funcao, e o total e o somarLinhas + derivar da tabela;
//   - GET /api/app/v1/campanhas: a leitura da tela (lerCampanhas) + o filtro +
//     o total, parametro torto vira o padrao;
//   - GET /api/app/v1/eu: usuario, lojas/checkouts e as opcoes do seletor,
//     sem plano, preco, assinatura nem admin.
// ============================================================================

const mundo = vi.hoisted(() => ({
  token: "jwt" as string | null,
  usuario: { id: "u1", email: "lojista@exemplo.com" } as { id: string; email?: string } | null,
  acesso: true,
  dados: null as unknown,
  erroLeitura: false,
  lojas: [] as unknown[],
  checkouts: [] as unknown[],
  erroLojas: false,
  banco: null as unknown as FakeSupabase,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  tokenDoApp: async () => mundo.token,
  createClient: async () => mundo.banco.client,
}));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => mundo.usuario }));
vi.mock("@/lib/billing/access", () => ({ userHasAccess: async () => mundo.acesso }));
vi.mock("@/lib/leitura/campanhas", () => ({
  lerCampanhas: async () => {
    if (mundo.erroLeitura) throw new Error("Falha ao ler o gasto das campanhas: timeout");
    return mundo.dados;
  },
}));
vi.mock("@/lib/filtro-global", () => ({
  listarLojasDoUsuario: async () => {
    if (mundo.erroLojas) throw new Error("Falha ao ler as lojas: timeout");
    return mundo.lojas;
  },
  listarCheckoutsDoUsuario: async () => mundo.checkouts,
}));

const META = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GOOGLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "120246483388030139";
const C2 = "120246483388030140";

function linha(p: Partial<LinhaCampanha> & Pick<LinhaCampanha, "nivel" | "objetoId">, somas: Partial<SomasCampanha> = {}): LinhaCampanha {
  const s = { ...somasVazias(), ...somas };
  return {
    id: `${p.nivel}:${p.contaId ?? META}:${p.objetoId}`,
    nome: `Nome ${p.objetoId}`,
    status: "ACTIVE",
    plataforma: "meta",
    contaId: META,
    contaNome: "CA 01",
    campanhaId: p.nivel === "campanha" ? p.objetoId : null,
    campanhaNome: null,
    grupoId: p.nivel === "grupo" ? p.objetoId : null,
    grupoNome: null,
    tipo: null,
    orcamento: null,
    cpaDesejado: null,
    ...s,
    ...derivar(s),
    ...p,
  };
}

const LINHAS: LinhaCampanha[] = [
  linha({ nivel: "conta", objetoId: "111", nome: "CA 01", status: null }, { gastos: 300, impressoes: 30000, cliques: 300 }),
  linha({ nivel: "campanha", objetoId: C1, nome: "Tênis Verão [CBO]" }, { gastos: 200, impressoes: 20000, cliques: 200, vendas: 4, faturamento: 800, lucroPedidos: 350, custoProduto: 300, detalhe: true, gastoDetalhe: 200, impressoesDetalhe: 20000, ic: 10 }),
  linha({ nivel: "campanha", objetoId: C2, nome: "Bota Inverno", status: "PAUSED" }, { gastos: 100, impressoes: 10000, cliques: 100, vendas: 1, faturamento: 150, lucroPedidos: 60, custoProduto: 70 }),
  linha({ nivel: "campanha", objetoId: "999", nome: "Só gasto", status: null }, { gastos: 50 }),
  linha({ nivel: "campanha", objetoId: "777", nome: "Search Marca", plataforma: "google", contaId: GOOGLE, contaNome: "Google 222" }, { gastos: 80, cliques: 40, impressoes: 900 }),
  linha({ nivel: "grupo", objetoId: "G1", nome: "Conjunto A", campanhaId: C1, campanhaNome: "Tênis Verão [CBO]" }, { gastos: 120 }),
  linha({ nivel: "grupo", objetoId: "G2", nome: "Conjunto B", campanhaId: C2 }, { gastos: 100 }),
  linha({ nivel: "anuncio", objetoId: "A1", nome: "Vídeo 1", campanhaId: C1, grupoId: "G1" }, { gastos: 120 }),
];

const ids = (ls: LinhaCampanha[]) => ls.map((l) => l.objetoId);
const filtro = (p: Partial<FiltroCampanhas>): FiltroCampanhas => ({ ...FILTRO_CAMPANHAS_PADRAO, ...p });

describe("filtrarLinhas (a regra da tela e do app)", () => {
  it("nivel: so as linhas do nivel escolhido", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({})))).toEqual([C1, C2, "999", "777"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "conta" })))).toEqual(["111"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "grupo" })))).toEqual(["G1", "G2"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "anuncio" })))).toEqual(["A1"]);
  });

  it("plataforma e conta", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({ plataforma: "google" })))).toEqual(["777"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ plataforma: "tiktok" })))).toEqual([]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ conta: GOOGLE })))).toEqual(["777"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ conta: META })))).toEqual([C1, C2, "999"]);
  });

  it("status: sem status (so gasto) nao e ativa nem pausada", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({ status: "ativa" })))).toEqual([C1, "777"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ status: "pausada" })))).toEqual([C2]);
  });

  it("busca: nome e conta sem caixa, id colado do gerenciador, espacos nas pontas", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({ busca: "  tênis " })))).toEqual([C1]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ busca: "GOOGLE 222" })))).toEqual(["777"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ busca: "030140" })))).toEqual([C2]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ busca: "   " })))).toEqual([C1, C2, "999", "777"]);
  });

  it("campanhaId: a campanha, os conjuntos e os anuncios dela", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({ campanhaId: C1 })))).toEqual([C1]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "grupo", campanhaId: C1 })))).toEqual(["G1"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "anuncio", campanhaId: C1 })))).toEqual(["A1"]);
    expect(ids(filtrarLinhas(LINHAS, filtro({ nivel: "conta", campanhaId: C1 })))).toEqual([]);
  });

  it("criterios juntos", () => {
    expect(ids(filtrarLinhas(LINHAS, filtro({ conta: META, status: "ativa", busca: "verão" })))).toEqual([C1]);
  });

  it("total: as somas cruas das linhas visiveis e o derivar delas (nunca media de razoes)", () => {
    const visiveis = filtrarLinhas(LINHAS, filtro({ conta: META }));
    const t = totalDasLinhas(visiveis);
    const somas = somarLinhas(visiveis);
    expect(t).toEqual({ ...somas, ...derivar(somas) });
    expect(t.gastos).toBe(350);
    expect(t.vendas).toBe(5);
    expect(t.lucro).toBe(410 - 350);
    expect(t.roas).toBeCloseTo(950 / 350);
    expect(t.cpa).toBe(70);
    expect(t.detalhe).toBe(true);
    expect(totalDasLinhas([])).toMatchObject({ gastos: 0, roas: null, cpa: null, lucro: 0 });
  });

  it("aviso sem detalhe: so em conjunto e anuncio, e so da conta escolhida", () => {
    const sd = [
      { contaId: META, contaNome: "CA 01", dias: 3 },
      { contaId: GOOGLE, contaNome: "Google 222", dias: 7 },
    ];
    expect(semDetalheDoFiltro(sd, { nivel: "campanha", conta: "todas" })).toEqual([]);
    expect(semDetalheDoFiltro(sd, { nivel: "grupo", conta: "todas" })).toEqual(sd);
    expect(semDetalheDoFiltro(sd, { nivel: "anuncio", conta: GOOGLE })).toEqual([sd[1]]);
  });
});

describe("filtroDeParametros (a URL do app)", () => {
  const p = (q: string) => filtroDeParametros(new URLSearchParams(q), [META, GOOGLE]);

  it("valores validos passam", () => {
    expect(p(`nivel=grupo&plataforma=meta&conta=${META}&status=pausada&q=+bota+&campanhaId=${C2}`)).toEqual({
      nivel: "grupo",
      plataforma: "meta",
      conta: META,
      status: "pausada",
      busca: "bota",
      campanhaId: C2,
    });
  });

  it("valor torto vira o padrao, conta alheia vira todas, nunca erro", () => {
    expect(p("")).toEqual(FILTRO_CAMPANHAS_PADRAO);
    expect(
      p("nivel=CAMPANHA&plataforma=bing&conta=cccccccc-cccc-4ccc-8ccc-cccccccccccc&status=1&campanhaId=x'%20or%201=1")
    ).toEqual(FILTRO_CAMPANHAS_PADRAO);
    expect(p(`q=${"a".repeat(500)}`).busca).toHaveLength(200);
  });
});

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

const RESULTADO: ResultadoCampanhas = {
  linhas: LINHAS,
  atribuicao: {
    identificadas: { vendas: 5, vendasPendentes: 0, faturamento: 950 },
    semId: { vendas: 2, vendasPendentes: 1, faturamento: 300 },
    idDesconhecido: { vendas: 0, vendasPendentes: 0, faturamento: 0 },
  },
  semDetalhe: [{ contaId: GOOGLE, contaNome: "Google 222", dias: 7 }],
  diasNoPeriodo: 7,
  moedasSemCotacao: ["CZK"],
  cambioAproximado: false,
  sincronizadoEm: "2026-10-29T10:00:00Z",
  contraEntrega: false,
};

const DADOS: DadosCampanhas = {
  contas: [
    { id: META, nome: "CA 01", plataforma: "meta" },
    { id: GOOGLE, nome: "Google 222", plataforma: "google" },
  ],
  resultado: RESULTADO,
  colunasSalvas: ["gastos"],
  moeda: "BRL",
  periodo: "Últimos 7 dias (23/10–29/10)",
};

beforeEach(() => {
  mundo.token = "jwt";
  mundo.usuario = { id: "u1", email: "lojista@exemplo.com" };
  mundo.acesso = true;
  mundo.dados = DADOS;
  mundo.erroLeitura = false;
  mundo.erroLojas = false;
  mundo.lojas = [];
  mundo.checkouts = [];
  mundo.banco = fakeSupabase({ profiles: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function campanhas(query = "") {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../src/app/api/app/v1/campanhas/route");
  const res = await GET(new NextRequest(`https://user.xcart.app/api/app/v1/campanhas${query}`));
  return { status: res.status, cache: res.headers.get("cache-control"), corpo: await res.json() };
}

describe("GET /api/app/v1/campanhas", () => {
  it("sem o Bearer do app: 401; sem acesso: 403", async () => {
    mundo.token = null;
    expect(await campanhas()).toMatchObject({ status: 401, corpo: { ok: false, codigo: "sem_login" } });
    mundo.token = "jwt";
    mundo.acesso = false;
    expect(await campanhas()).toMatchObject({ status: 403, corpo: { ok: false, codigo: "sem_acesso" } });
  });

  it("200: linhas ja filtradas, so os campos da tela, total e avisos", async () => {
    const r = await campanhas(`?conta=${META}&status=ativa`);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    const c = r.corpo;
    expect(c).toMatchObject({ ok: true, moeda: "BRL", periodo: DADOS.periodo, contas: DADOS.contas });
    expect(c.filtro).toEqual({ nivel: "campanha", plataforma: "todas", conta: META, status: "ativa", q: "", campanhaId: null });
    expect(c.linhas.map((l: { objetoId: string }) => l.objetoId)).toEqual([C1]);

    const l = c.linhas[0];
    expect(l).toMatchObject({ nome: "Tênis Verão [CBO]", status: "ACTIVE", gastos: 200, vendas: 4, faturamento: 800, lucro: 150, roasTom: "ok", ic: 10 });
    expect(l.roas).toBeCloseTo(4);
    // Base das contas, nao coluna da tela.
    for (const campo of ["gastoDetalhe", "impressoesDetalhe", "frequenciaPeso", "impressoesFrequencia", "lucroPedidos", "detalhe"]) {
      expect(l).not.toHaveProperty(campo);
    }

    expect(c.total).toMatchObject({ quantidade: 1, gastos: 200, vendas: 4, lucro: 150 });
    expect(c.atribuicao).toEqual(RESULTADO.atribuicao);
    // Nivel campanha: o aviso de conjunto/anuncio nao aparece.
    expect(c.avisos).toEqual({
      semDetalhe: [],
      diasNoPeriodo: 7,
      moedasSemCotacao: ["CZK"],
      contraEntrega: false,
      sincronizadoEm: "2026-10-29T10:00:00Z",
    });
  });

  it("o total e o mesmo da tela (somarLinhas + derivar das linhas visiveis)", async () => {
    const { corpo } = await campanhas();
    const somas = somarLinhas(LINHAS.filter((l) => l.nivel === "campanha"));
    const d = derivar(somas);
    expect(corpo.total).toMatchObject({ quantidade: 4, gastos: somas.gastos, lucro: d.lucro, cpa: d.cpa, ctr: d.ctr, cpm: d.cpm });
    // Sem detalhe na linha, IC e video sao null (a tela mostra "—").
    const soGasto = corpo.linhas.find((l: { objetoId: string }) => l.objetoId === "999");
    expect(soGasto).toMatchObject({ ic: null, visVideo: null, vis3s: null, roas: 0, roasTom: null, cpa: null });
  });

  it("conjunto de uma campanha com o aviso de sem detalhe", async () => {
    const { corpo } = await campanhas(`?nivel=grupo&campanhaId=${C1}`);
    expect(corpo.linhas.map((l: { objetoId: string }) => l.objetoId)).toEqual(["G1"]);
    expect(corpo.avisos.semDetalhe).toEqual(RESULTADO.semDetalhe);
  });

  it("parametro torto e ignorado, nunca 500", async () => {
    const r = await campanhas("?nivel=tudo&plataforma=%00&conta=outra&status=talvez&campanhaId=%3Cscript%3E&q=");
    expect(r.status).toBe(200);
    expect(r.corpo.filtro).toEqual({ nivel: "campanha", plataforma: "todas", conta: "todas", status: "qualquer", q: "", campanhaId: null });
    expect(r.corpo.linhas).toHaveLength(4);
  });

  it("nenhuma conta de anuncio: 200 vazio, sem total", async () => {
    mundo.dados = { contas: [], resultado: null, colunasSalvas: [], moeda: "USD", periodo: "Hoje (29/10)" };
    const { status, corpo } = await campanhas();
    expect(status).toBe(200);
    expect(corpo).toMatchObject({ ok: true, contas: [], linhas: [], total: null, atribuicao: null, moeda: "USD" });
  });

  it("erro de banco: 503, nunca lista vazia, sem o texto do banco", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mundo.erroLeitura = true;
    const r = await campanhas();
    expect(r).toMatchObject({ status: 503, corpo: { ok: false, codigo: "leitura_falhou" } });
    expect(JSON.stringify(r.corpo)).not.toMatch(/timeout/);
  });
});

async function eu() {
  const { GET } = await import("../src/app/api/app/v1/eu/route");
  const res = await GET();
  return { status: res.status, corpo: await res.json() };
}

describe("GET /api/app/v1/eu", () => {
  it("sem o Bearer do app: 401; sem acesso: 403", async () => {
    mundo.token = null;
    expect(await eu()).toMatchObject({ status: 401, corpo: { codigo: "sem_login" } });
    mundo.token = "jwt";
    mundo.acesso = false;
    expect(await eu()).toMatchObject({ status: 403, corpo: { codigo: "sem_acesso" } });
  });

  it("200: usuario, lojas, checkouts e as opcoes do seletor; sem plano, preco nem admin", async () => {
    mundo.banco = fakeSupabase({
      profiles: [
        { id: "u1", nome: "Arthur", sobrenome: "Ferreira", is_admin: true, plan: "pro", plano: "completo", ai_credits: 20 },
        { id: "u2", nome: "Outro", sobrenome: "Lojista" },
      ],
    });
    mundo.lojas = [{ id: "l1", nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com" }];
    mundo.checkouts = [{ id: "c1", nome: "Cakto", dominio: "Cakto", tipo: "checkout", modelo: "venda" }];
    const { status, corpo } = await eu();
    expect(status).toBe(200);
    expect(corpo.usuario).toEqual({ id: "u1", email: "lojista@exemplo.com", nome: "Arthur", sobrenome: "Ferreira" });
    expect(corpo.lojas).toEqual([{ id: "l1", nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com" }]);
    expect(corpo.checkouts).toEqual([{ id: "c1", nome: "Cakto", plataforma: "Cakto", modelo: "venda" }]);
    expect(corpo.periodos[2]).toEqual({ id: "7d", rotulo: "Últimos 7 dias", curto: "7 dias" });
    expect(corpo.periodos.map((p: { id: string }) => p.id)).toEqual(["hoje", "ontem", "7d", "30d", "mes", "mes_passado"]);
    expect(corpo.moedas).toEqual([
      { id: "BRL", rotulo: "BRL" },
      { id: "USD", rotulo: "USD" },
      { id: "EUR", rotulo: "EUR" },
    ]);
    expect(corpo.comparacoes.map((c: { id: string }) => c.id)).toEqual(["anterior", "nenhum"]);
    expect(corpo.personalizado).toMatchObject({ tetoDias: 92 });
    expect(corpo.filtroPadrao).toEqual({ loja: "todas", periodo: "7d", moeda: "BRL", comparar: "anterior" });
    expect(JSON.stringify(corpo)).not.toMatch(/admin|plano|plan"|assin|pre[cç]o|R\$|credit/i);
  });

  it("sem a 077 (coluna ausente): sem nome, e a tela abre", async () => {
    mundo.banco = fakeSupabase({ profiles: [] }, (tabela) =>
      tabela === "profiles" ? { code: "42703", message: 'column profiles.nome does not exist' } : null
    );
    const { status, corpo } = await eu();
    expect(status).toBe(200);
    expect(corpo.usuario).toEqual({ id: "u1", email: "lojista@exemplo.com", nome: null, sobrenome: null });
  });

  it("erro de banco nas lojas: 503, nunca 'nenhuma loja'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mundo.erroLojas = true;
    expect(await eu()).toMatchObject({ status: 503, corpo: { ok: false, codigo: "leitura_falhou" } });
  });
});
