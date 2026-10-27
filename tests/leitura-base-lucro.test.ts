import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diaNoFuso, somarDias } from "@/lib/financeiro/tipos";

// ============================================================================
// lerBaseLucro (src/lib/leitura/base-lucro.ts) le em rodadas paralelas: o
// estado da sincronizacao e as contas junto com o filtro, o gasto junto com
// os pedidos, e as amostras (COD e checkouts) junto com o cambio. Aqui fica
// travado que o que ela devolve continua o mesmo da leitura em serie: estado
// so das lojas do filtro, gasto so das contas delas, cada amostra falhando
// sozinha, e a falha das taxas ainda derrubando a leitura.
// ============================================================================

type Linha = Record<string, unknown>;
type Estado = { tabela: string; select: string; eq: [string, unknown][]; in: [string, unknown[]][] };

const tabelas: Record<string, Linha[]> = {};
const consultas: Estado[] = [];
let erroDe: (e: Estado) => { message: string } | null = () => null;

function consulta(tabela: string) {
  const e: Estado = { tabela, select: "", eq: [], in: [] };
  const b: Record<string, unknown> = {
    select: (c: string) => ((e.select = c), b),
    eq: (col: string, v: unknown) => (e.eq.push([col, v]), b),
    in: (col: string, vs: unknown[]) => (e.in.push([col, vs]), b),
    then: (ok: (v: unknown) => unknown, falha: (x: unknown) => unknown) => {
      consultas.push(e);
      const erro = erroDe(e);
      const data = (tabelas[tabela] ?? []).filter(
        (l) => e.eq.every(([c, v]) => l[c] === v) && e.in.every(([c, vs]) => vs.includes(l[c]))
      );
      return Promise.resolve(erro ? { data: null, error: erro } : { data, error: null }).then(ok, falha);
    },
  };
  for (const m of ["gte", "lte", "order", "range", "limit", "overrideTypes"]) b[m] = () => b;
  return b;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: consulta }) }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));

const A = "loja-a";
const B = "loja-b";
const CK = "checkout-1";

vi.mock("@/lib/filtro-global", () => ({
  filtroResolvido: async () => ({
    filtro: { lojaId: "todas", periodo: "7d", moeda: "BRL" },
    lojas: [
      { id: A, nome: "A", dominio: "a.myshopify.com" },
      { id: B, nome: "B", dominio: "b.myshopify.com" },
    ],
    // A fora do filtro (a loja de demonstracao em Todas, por exemplo).
    lojaIds: [B],
    checkouts: [{ id: CK, nome: "Sphere", dominio: "Sphere", tipo: "checkout", modelo: "comissao" }],
    checkoutIds: [CK],
    checkout: null,
  }),
  lerCheckoutsDoUsuario: async () => [
    {
      id: CK,
      nome: "Sphere",
      plataforma: "sphere",
      ativo: true,
      fuso: "America/Sao_Paulo",
      moeda_receita: "EUR",
      taxa_aprovacao_padrao: 70,
      modelo: "comissao",
    },
  ],
}));

const { lerBaseLucro } = await import("../src/lib/leitura/base-lucro");

const diaDaAmostra = somarDias(diaNoFuso(new Date(), "America/Sao_Paulo"), -10);

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  consultas.length = 0;
  erroDe = () => null;
  tabelas.fin_sync_state = [
    { store_id: A, user_id: "u1", fuso: "Asia/Tokyo", moeda: "JPY" },
    { store_id: B, user_id: "u1", fuso: "Europe/Prague", moeda: "CZK" },
  ];
  tabelas.ad_accounts = [
    { id: "act-a", user_id: "u1", store_id: A, checkout_id: null },
    { id: "act-b", user_id: "u1", store_id: B, checkout_id: null },
    { id: "act-ck", user_id: "u1", store_id: null, checkout_id: CK },
  ];
  tabelas.ad_spend_daily = [
    { ad_account_id: "act-a", nivel: "conta", moeda: "JPY", data: diaDaAmostra },
    { ad_account_id: "act-b", nivel: "conta", moeda: "CZK", data: diaDaAmostra },
    { ad_account_id: "act-ck", nivel: "conta", moeda: "EUR", data: diaDaAmostra },
    { ad_account_id: "act-b", nivel: "campanha", moeda: "CZK", campanha_id: "c1", data: diaDaAmostra },
  ];
  tabelas.fin_store_settings = [{ store_id: B, contra_entrega: true }];
  tabelas.pedidos_externos = [{ checkout_id: CK, situacao: "aprovado", dia_local: diaDaAmostra, moeda: "EUR" }];
});

afterEach(() => vi.restoreAllMocks());

describe("lerBaseLucro em rodadas paralelas", () => {
  it("estado lido pelo dono, mas so as lojas do filtro entram", async () => {
    const base = (await lerBaseLucro())!;

    const leitura = consultas.find((c) => c.tabela === "fin_sync_state")!;
    expect(leitura.eq).toEqual([["user_id", "u1"]]);
    expect(base.estados.map((e) => e.store_id)).toEqual([B]);
    expect(base.entrada.lojas.find((l) => l.id === B)).toMatchObject({ fuso: "Europe/Prague", moeda: "CZK" });
    expect(base.entrada.lojas.some((l) => l.id === A)).toBe(false);
  });

  it("gasto so das contas da loja e do checkout do filtro; cambio com as moedas dele", async () => {
    const base = (await lerBaseLucro())!;

    expect(base.contas.map((c) => c.id)).toEqual(["act-a", "act-b", "act-ck"]);
    expect(base.entrada.gastos.map((g) => g.ad_account_id).sort()).toEqual(["act-b", "act-ck"]);
    expect(base.gastosCampanha.map((g) => g.campanha_id)).toEqual(["c1"]);
    expect(base.erroCampanha).toBeNull();
    const cambio = consultas.find((c) => c.tabela === "fx_rates")!;
    const moedas = cambio.in.find(([c]) => c === "moeda")![1];
    expect(moedas).toEqual(expect.arrayContaining(["BRL", "USD", "CZK", "EUR"]));
    expect(moedas).not.toContain("JPY");
  });

  it("as duas amostras entram juntas", async () => {
    const base = (await lerBaseLucro())!;

    // fin_orders vazio: a do COD conta zero linha, mas rodou (objeto vazio).
    expect(base.entrada.amostraEntrega).toEqual({
      [CK]: { entregues: 1, recusados: 0, semRetorno: 0 },
    });
    const amostraCod = consultas.find((c) => c.tabela === "fin_orders" && c.select.startsWith("store_id, dia_local"));
    expect(amostraCod?.in).toEqual([["store_id", [B]]]);
  });

  it("amostra do COD que falha nao leva a dos checkouts junto", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    erroDe = (e) =>
      e.tabela === "fin_orders" && e.select.startsWith("store_id, dia_local") ? { message: "timeout" } : null;

    const base = (await lerBaseLucro())!;

    expect(base.entrada.amostraEntrega).toEqual({ [CK]: { entregues: 1, recusados: 0, semRetorno: 0 } });
    expect(log).toHaveBeenCalledWith("[lucro] amostra de entregas", expect.any(Error));
  });

  it("as duas amostras falhando: sem amostra, e a tela segue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    erroDe = (e) =>
      (e.tabela === "fin_orders" && e.select.startsWith("store_id, dia_local")) ||
      (e.tabela === "pedidos_externos" && e.select === "checkout_id, situacao, dia_local")
        ? { message: "timeout" }
        : null;

    const base = (await lerBaseLucro())!;

    expect(base.entrada.amostraEntrega).toBeUndefined();
  });

  it("gasto por campanha que falha vira erroCampanha, sem derrubar a leitura", async () => {
    erroDe = (e) =>
      e.tabela === "ad_spend_daily" && e.eq.some(([c, v]) => c === "nivel" && v === "campanha")
        ? { message: "timeout" }
        : null;

    const base = (await lerBaseLucro())!;

    expect(base.erroCampanha).toBe("Falha ao ler o gasto por campanha: timeout");
    expect(base.gastosCampanha).toEqual([]);
    expect(base.entrada.gastos).toHaveLength(2);
  });

  it("taxas que falham derrubam a leitura", async () => {
    erroDe = (e) => (e.tabela === "fin_store_settings" ? { message: "timeout" } : null);

    await expect(lerBaseLucro()).rejects.toThrow("Falha ao ler as taxas das lojas: timeout");
  });

  it("enxuta (Pedidos): sem contas, gasto nem amostra", async () => {
    const base = (await lerBaseLucro(true))!;

    expect(base.contas).toEqual([]);
    expect(base.entrada.gastos).toEqual([]);
    expect(base.entrada.amostraEntrega).toBeUndefined();
    expect(consultas.some((c) => c.tabela === "ad_accounts" || c.tabela === "ad_spend_daily")).toBe(false);
  });
});
