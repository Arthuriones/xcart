import { beforeEach, describe, expect, it, vi } from "vitest";

// queries.ts tem "server-only" e fala com o Supabase; aqui so interessa a regra
// de contagem e QUAL cliente le a fila. Mesmo padrao de store-ownership.test.ts.
const chamadas: { cliente: string; fn: string; args: unknown }[] = [];
let linhasDoPainel: unknown[] = [];
/** Erro que a RPC devolve, por funcao (ex.: a 055 ainda nao aplicada). */
const erroDaRpc: Record<string, { code: string; message: string }> = {};

function consulta(dados: unknown, erroDaLeitura: unknown = null) {
  const b: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve(
        erroDaLeitura ? { data: null, error: erroDaLeitura } : { data: dados, error: null }
      ).then(ok, erro),
  };
  for (const m of ["select", "in", "is", "eq", "gte", "order", "range"]) {
    b[m] = () => b;
  }
  return b;
}

const tabelas: Record<string, unknown[]> = {};

const clienteDoUsuario = {
  from: (t: string) => consulta(tabelas[t] ?? []),
  rpc: (fn: string, args: unknown) => {
    chamadas.push({ cliente: "usuario", fn, args });
    return consulta(linhasDoPainel, erroDaRpc[fn] ?? null);
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clienteDoUsuario }));
vi.mock("@/lib/supabase/current-user", () => ({
  getCurrentUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // A fila NUNCA pode ser lida pelo admin: a funcao e INVOKER e e a RLS que
    // impede ler a loja dos outros.
    rpc: (fn: string, args: unknown) => {
      chamadas.push({ cliente: "admin", fn, args });
      return consulta([]);
    },
  }),
}));

const destinos = new Map<string, unknown[]>();
vi.mock("@/lib/tracking/destinos", () => ({
  destinosParaTela: async () => destinos,
}));

const { contagensDoPainel, mapaLegado, getPainelTracking } = await import(
  "../src/lib/tracking/queries"
);
type LinhaPainel = Parameters<typeof contagensDoPainel>[0][number];

function linha(p: Partial<LinhaPainel>): LinhaPainel {
  return {
    store_id: "loja1",
    destination_id: "g1",
    destination: "google",
    event_key: "view_item",
    status: "enviado",
    n: 1,
    n_sem_atribuicao: 0,
    ultimo_envio: null,
    ultimo_erro: null,
    ultimo_erro_em: null,
    order_ids: [],
    ...p,
  };
}

describe("contagem do painel de rastreamento", () => {
  it("compra continua contada com milhares de view_item na janela", () => {
    // O defeito: a leitura linha a linha parava em 1000 e o funil empurrava as
    // compras para fora. Agrupado, 5000 view_item sao UMA linha.
    const { contagens } = contagensDoPainel(
      [
        linha({ event_key: "view_item", n: 5000, n_sem_atribuicao: 4800 }),
        linha({
          event_key: "purchase",
          n: 3,
          n_sem_atribuicao: 1,
          order_ids: ["101", "102", "103"],
        }),
      ],
      new Map()
    );

    const g = contagens.get("g1")!;
    expect(g.porEvento.view_item).toBe(5000);
    expect(g.porEvento.purchase).toBe(3);
    expect(g.enviados).toBe(5003);
    expect(g.semAtribPorEvento.purchase).toBe(1);
    expect(g.pedidosComCompra.sort()).toEqual(["101", "102", "103"]);
  });

  it("aceita contagem vinda como texto (bigint do PostgREST)", () => {
    const { contagens } = contagensDoPainel(
      [linha({ event_key: "purchase", n: "1200", order_ids: ["1"] })],
      new Map()
    );
    expect(contagens.get("g1")!.porEvento.purchase).toBe(1200);
  });

  it("linha sem destination_id vai para o destino mais antigo da plataforma", () => {
    const legado = mapaLegado(
      new Map([
        [
          "loja1",
          [
            { id: "meta-antigo", plataforma: "meta" },
            { id: "meta-novo", plataforma: "meta" },
            { id: "g1", plataforma: "google" },
          ],
        ],
      ])
    );

    const { contagens } = contagensDoPainel(
      [
        linha({
          destination_id: null,
          destination: "meta",
          event_key: "purchase",
          n: 2,
          order_ids: ["7", "8"],
        }),
        // A mesma conta, ja com destination_id: soma e une, nao sobrescreve.
        linha({
          destination_id: "meta-antigo",
          destination: "meta",
          event_key: "purchase",
          n: 2,
          order_ids: ["8", "9"],
        }),
      ],
      legado
    );

    const m = contagens.get("meta-antigo")!;
    expect(m.porEvento.purchase).toBe(4);
    expect(m.pedidosComCompra.sort()).toEqual(["7", "8", "9"]);
    expect(contagens.has("meta-novo")).toBe(false);
  });

  it("linha legada de plataforma sem destino e descartada", () => {
    const { contagens } = contagensDoPainel(
      [linha({ destination_id: null, destination: "meta" })],
      new Map()
    );
    expect(contagens.size).toBe(0);
  });

  it("separa compra enviada, na fila e falha, e guarda o erro mais recente", () => {
    const { contagens, ultimoDaLoja } = contagensDoPainel(
      [
        linha({
          event_key: "purchase",
          n: 1,
          order_ids: ["1"],
          ultimo_envio: "2026-09-30T10:00:00+00:00",
        }),
        linha({
          event_key: "add_to_cart",
          n: 4,
          ultimo_envio: "2026-09-30T12:00:00+00:00",
        }),
        // Reentrega do pedido 1 na fila: ja chegou, nao esta "na fila".
        linha({ event_key: "purchase", status: "pendente", n: 2, order_ids: ["1", "2"] }),
        linha({
          event_key: "purchase",
          status: "falhou",
          n: 1,
          order_ids: ["3"],
          ultimo_erro: "token antigo",
          ultimo_erro_em: "2026-09-28T00:00:00+00:00",
        }),
        linha({
          destination_id: null,
          event_key: "add_to_cart",
          status: "falhou",
          n: 1,
          ultimo_erro: "token novo",
          ultimo_erro_em: "2026-09-29T00:00:00+00:00",
        }),
      ],
      new Map([["loja1:google", "g1"]])
    );

    const g = contagens.get("g1")!;
    expect(g.pedidosComCompra).toEqual(["1"]);
    expect(g.pedidosNaFila).toEqual(["2"]);
    expect(g.pendentes).toBe(2);
    expect(g.falharam).toBe(2);
    expect(g.ultimoErro).toBe("token novo");
    // A falha nao conta como compra enviada.
    expect(g.porEvento.purchase).toBe(1);
    expect(ultimoDaLoja.get("loja1")).toBe("2026-09-30T12:00:00+00:00");
  });
});

describe("getPainelTracking", () => {
  beforeEach(() => {
    chamadas.length = 0;
    linhasDoPainel = [];
    destinos.clear();
    for (const k of Object.keys(tabelas)) delete tabelas[k];
    for (const k of Object.keys(erroDaRpc)) delete erroDaRpc[k];
  });

  it("le a fila pela funcao, com o cliente do usuario", async () => {
    tabelas.stores = [
      { id: "loja1", name: "Loja", shop_domain: "a.myshopify.com", uninstalled_at: null },
    ];
    tabelas.tracking_configs = [{ store_id: "loja1", enabled: true }];
    destinos.set("loja1", [
      {
        id: "g1",
        storeId: "loja1",
        plataforma: "google",
        nome: null,
        conta: "AW-1",
        labels: { purchase: "x" },
        testEventCode: null,
        idTemplate: null,
        ativo: true,
        temToken: false,
      },
    ]);
    linhasDoPainel = [linha({ event_key: "purchase", n: 2, order_ids: ["1", "2"] })];

    const { lojas } = await getPainelTracking();

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ cliente: "usuario", fn: "tracking_painel_v2" });
    expect(lojas[0].destinos[0].contagem.porEvento.purchase).toBe(2);
    expect(lojas[0].desinstalada).toBe(false);
  });

  it("mostra loja desinstalada so se o rastreamento ficou ligado", async () => {
    tabelas.stores = [
      { id: "ligada", name: "A", shop_domain: "a.myshopify.com", uninstalled_at: "2026-09-01" },
      { id: "desligada", name: "B", shop_domain: "b.myshopify.com", uninstalled_at: "2026-09-01" },
      { id: "instalada", name: "C", shop_domain: "c.myshopify.com", uninstalled_at: null },
    ];
    tabelas.tracking_configs = [
      { store_id: "ligada", enabled: true },
      { store_id: "desligada", enabled: false },
    ];

    const { lojas } = await getPainelTracking();

    expect(lojas.map((l) => [l.storeId, l.desinstalada])).toEqual([
      ["ligada", true],
      ["instalada", false],
    ]);
  });
});
