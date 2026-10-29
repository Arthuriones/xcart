import { beforeEach, describe, expect, it, vi } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import { TODAS, diaNoFuso, type AdAccountRow, type FinOrderRow, type FinSyncStateRow, type Intervalo, type LinhaPedido, type ProductCostRow } from "@/lib/financeiro/tipos";
import {
  montarConexao,
  montarPainel,
  painelDoApp,
  type ConexaoLucro,
  type DadosLucro,
} from "@/lib/financeiro/painel";
import { nomeDoPeriodo, rotuloDoPeriodo, rotuloFuso, rotuloIntervalo, type Comparacao } from "@/components/layout/contexto";
import { montarIndicadores, type BaseIndicadores } from "@/app/(dashboard)/financeiro/indicadores";
import {
  CUSTOS_SEM_CUSTO,
  composicaoCod,
  montarDicas,
  montarPendencias,
  nomeDaLoja,
  porcento,
  rotuloLeitura,
  situacaoDasLojas,
  temMovimento,
  type Pendencia,
} from "@/app/(dashboard)/financeiro/lucro-dados";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// Dashboard no APP DO CELULAR.
//   - montarPainel (src/lib/financeiro/painel.ts) e a montagem que a tela
//     fazia no corpo dela: a referencia abaixo e o codigo da tela antes da
//     mudanca, e as duas tem de dar o MESMO (COD, comparacao, sem comparacao);
//   - painelDoApp recorta para o celular, com as regras de apresentacao da
//     tela (variacao neutra com o periodo terminando hoje, "vs." do anterior,
//     aba Loja);
//   - GET /api/app/v1/dashboard e /dashboard/serie: a porta do app (401, 403),
//     o vazio, o erro de banco (503, nunca zero) e o formato.
// ============================================================================

const mundo = vi.hoisted(() => ({
  token: "jwt" as string | null,
  usuario: { id: "99999999-9999-4999-8999-999999999999" } as { id: string } | null,
  acesso: true,
  comparacao: "anterior" as "anterior" | "nenhum",
  financeiro: null as unknown,
  erroFinanceiro: false,
  base: null as unknown,
  erroBase: false,
  chamadasBase: 0,
  banco: null as unknown as FakeSupabase,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  tokenDoApp: async () => mundo.token,
  createClient: async () => mundo.banco.client,
}));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => mundo.usuario }));
vi.mock("@/lib/billing/access", () => ({ userHasAccess: async () => mundo.acesso }));
vi.mock("@/lib/filtro-global", () => ({ lerComparacao: async () => mundo.comparacao }));
vi.mock("@/lib/financeiro/queries", () => ({
  getFinanceiro: async () => {
    if (mundo.erroFinanceiro) throw new Error("canceling statement due to statement timeout");
    return mundo.financeiro;
  },
}));
vi.mock("@/lib/leitura/base-lucro", () => ({
  lerBaseLucro: async () => {
    mundo.chamadasBase += 1;
    if (mundo.erroBase) throw new Error("Falha ao ler os pedidos: timeout");
    return mundo.base;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures no molde de tests/financeiro-contra-entrega.test.ts
// ---------------------------------------------------------------------------

const USER = "99999999-9999-4999-8999-999999999999";
const LOJA_COD = "11111111-1111-4111-8111-111111111111";
const LOJA_ON = "22222222-2222-4222-8222-222222222222";
const COD = ["Cash on Delivery (COD)"];
const ATUAL: Intervalo = { desde: "2026-09-28", ate: "2026-09-30" };
const ANTERIOR: Intervalo = { desde: "2026-09-25", ate: "2026-09-27" };

/** Intl usa espaco fino/inseparavel: compara com espaco comum. */
const sp = (t: string) => t.replace(/[  ]/g, " ");

function linha(sku: string, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido {
  return { sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco, ...extra };
}

let seq = 0;
function pedido(p: Partial<FinOrderRow> = {}): FinOrderRow {
  seq += 1;
  const dia = p.dia_local ?? "2026-09-29";
  return {
    store_id: LOJA_ON,
    user_id: USER,
    shopify_order_id: String(seq),
    nome: `#${seq}`,
    processado_em: `${dia}T12:00:00Z`,
    dia_local: dia,
    criado_em: `${dia}T12:00:00Z`,
    atualizado_em: `${dia}T12:00:00Z`,
    cancelado_em: null,
    tipo: "venda",
    status_financeiro: "PAID",
    origem: "web",
    moeda: "BRL",
    moeda_cliente: "BRL",
    total_bruto: 100,
    total_atual: 100,
    imposto_atual: 0,
    taxas_alfandega: 0,
    gorjeta: 0,
    descontos: 0,
    frete_cobrado: 0,
    recebido: 100,
    reembolsado: 0,
    liquido_pago: 100,
    total_cliente: 100,
    gateways: ["shopify_payments"],
    linhas: [linha("SKU-1", 1, 100)],
    ...p,
  };
}

/** Contra entrega sem pagamento, nada enviado. */
function cod(p: Partial<FinOrderRow> = {}): FinOrderRow {
  return pedido({
    store_id: LOJA_COD,
    gateways: COD,
    status_financeiro: "PENDING",
    recebido: 0,
    liquido_pago: 0,
    linhas: [linha("SKU-1", 1, 100, { qtd_nao_enviada: 1 })],
    ...p,
  });
}

function custo(store: string): ProductCostRow {
  return {
    id: `c-${store}`,
    store_id: store,
    user_id: USER,
    sku: "SKU-1",
    custo_unitario: 30,
    frete_unitario: 10,
    moeda: "BRL",
    valido_desde: "2026-09-01",
    origem: "manual",
  };
}

const CONTA: AdAccountRow = {
  id: "conta-1",
  user_id: USER,
  store_id: LOJA_ON,
  plataforma: "meta",
  external_id: "1",
  nome: "Meta",
  moeda: "BRL",
  fuso: "America/Sao_Paulo",
  status_externo: null,
  fonte: "api",
  ativo: true,
  sincronizando_desde: null,
  ultimo_sync_em: null,
  ultimo_sync_ok_em: "2026-09-30T14:40:00Z",
  ultimo_reprocesso_em: null,
  ultimo_dado_gerado_em: null,
  ultimo_erro: null,
};

function gasto(dia: string, valor: number) {
  return {
    ad_account_id: CONTA.id,
    user_id: USER,
    data: dia,
    nivel: "conta" as const,
    campanha_id: "",
    campanha_nome: null,
    moeda: "BRL",
    gasto: valor,
    impressoes: 0,
    cliques: 0,
    compras: 0,
    valor_compras: 0,
    fonte: "api" as const,
    sincronizado_em: "2026-09-30T14:40:00Z",
  };
}

function estado(store: string, p: Partial<FinSyncStateRow> = {}): FinSyncStateRow {
  return {
    store_id: store,
    user_id: USER,
    fuso: "America/Sao_Paulo",
    moeda: "BRL",
    cursor_atualizado: null,
    sincronizando_desde: null,
    ultimo_sync_em: "2026-09-30T14:50:00Z",
    ultimo_sync_ok_em: "2026-09-30T14:50:00Z",
    ultimo_erro: null,
    ultimo_erro_tipo: null,
    carga_inicial_ok: true,
    pedidos_total: 0,
    ...p,
  };
}

const LOJAS = [
  { id: LOJA_COD, nome: "Dům parfémů", dominio: "5rinvm-i9.myshopify.com" },
  { id: LOJA_ON, nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com" },
];

function entrada(p: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: LOJAS.map((l) => ({ ...l, fuso: "America/Sao_Paulo", moeda: "BRL" })),
    pedidos: [],
    custos: [custo(LOJA_COD), custo(LOJA_ON)],
    configs: [
      { store_id: LOJA_COD, user_id: USER, taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: null, contra_entrega: true, cod_taxa_entrega: 70, cod_custo_devolucao: 10 },
      { store_id: LOJA_ON, user_id: USER, taxa_pct: 4, taxa_fixa: 0, custo_padrao_pct: null },
    ],
    contas: [CONTA],
    gastos: [],
    cambio: [],
    intervalos: { atual: ATUAL, anterior: ANTERIOR },
    moeda: "BRL",
    hoje: "2026-09-30",
    ...p,
  };
}

function dadosDe(e: EntradaFinanceiro, lojaId: string = TODAS): DadosLucro {
  const lojaIds = lojaId === TODAS ? e.lojas.map((l) => l.id) : [lojaId];
  const lojas = e.lojas.map(({ id, nome, dominio }) => ({ id, nome, dominio }));
  return {
    vazio: false,
    filtro: { lojaId, periodo: ATUAL, moeda: "BRL" },
    lojas,
    lojaIds,
    checkouts: [],
    checkoutIds: [],
    estados: lojaIds.map((id) => estado(id)),
    contas: { total: 1, semLoja: 0, comErro: [], googleSemDado3h: [] },
    resultado: calcularFinanceiro({ ...e, lojas: e.lojas.filter((l) => lojaIds.includes(l.id)) }),
    atualizadoEm: "2026-09-30T14:50:00Z",
    fuso: "America/Sao_Paulo",
  };
}

const AGORA = Date.parse("2026-09-30T15:00:00Z");

// ---------------------------------------------------------------------------
// A referencia: o que financeiro-screen.tsx montava no corpo dela (copia do
// codigo antes da mudanca, so com o "agora" vindo de fora).
// ---------------------------------------------------------------------------

function comoATelaMontava(dados: DadosLucro, comparacao: Comparacao, conexao: ConexaoLucro, agora: number) {
  const { resultado: r, filtro } = dados;
  const moeda = r.moeda;
  const lojaEscolhida =
    filtro.lojaId !== TODAS
      ? [...dados.lojas, ...dados.checkouts].find((l) => l.id === filtro.lojaId)
      : undefined;
  const rotuloLoja = lojaEscolhida ? nomeDaLoja(lojaEscolhida) : "Todas as lojas";
  const hoje = diaNoFuso(new Date(agora), dados.fuso);
  const contexto = `${rotuloLoja} · ${rotuloDoPeriodo(filtro.periodo, r.intervalos.atual, hoje)} · ${moeda}`;
  const situacoes = situacaoDasLojas(dados.lojaIds, dados.estados, conexao.desinstaladas);
  const semAcesso = (id: string) => {
    const s = situacoes.get(id)?.situacao;
    return s === "desinstalada" || s === "sem-acesso";
  };
  const mostrarLoja = filtro.lojaId === TODAS && dados.lojaIds.length + dados.checkoutIds.length >= 2;
  const contraEntrega = r.lojasContraEntrega.length > 0;
  const noFiltro = new Set(dados.checkoutIds);
  const vendaIds = dados.checkouts.filter((c) => c.modelo === "venda" && noFiltro.has(c.id)).map((c) => c.id);
  const comissaoIds = dados.checkoutIds.filter((id) => !vendaIds.includes(id));
  const composicao = composicaoCod([...dados.lojaIds, ...vendaIds], comissaoIds, r.lojasContraEntrega);
  const codShopify = r.lojasContraEntrega.some((id) => dados.lojaIds.includes(id));
  const venda: BaseIndicadores["venda"] =
    vendaIds.length === 0 ? undefined : dados.lojaIds.length === 0 && comissaoIds.length === 0 ? "so" : "junto";
  const comparando = comparacao === "anterior";
  const semBase = comparando && !temMovimento(r.anterior);
  const cobertura = contraEntrega ? r.atual.cod.coberturaCusto : r.atual.coberturaCusto;
  const base: BaseIndicadores = {
    moeda,
    atual: r.atual,
    anterior: r.anterior,
    compara: comparando && !semBase,
    dicas: montarDicas(r.avisos, cobertura, contraEntrega),
    entrega: r.entrega,
    composicao,
    venda,
    semLoja: dados.lojaIds.length === 0,
  };
  const { principal, celulas } = montarIndicadores(base, contraEntrega);
  const modo = !comparando ? "nenhuma" : semBase ? "sem-base" : "anterior";
  const pendencias = montarPendencias({
    lojas: dados.lojas,
    lojaIds: dados.lojaIds,
    estados: dados.estados,
    contas: dados.contas,
    avisos: r.avisos,
    coberturaCusto: cobertura,
    porLoja: r.porLoja.map((l) => ({ storeId: l.storeId, receita: l.receita, pedidos: l.pedidos })),
    desinstaladas: conexao.desinstaladas,
    lojasComConta: conexao.lojasComConta,
  }).filter((p) => p.id !== "custo-faltando");
  const lidoEm = conexao.atualizadoEm;
  const leitura = rotuloLeitura(lidoEm, agora, conexao.lido);
  const horaLeitura =
    lidoEm === null
      ? null
      : `Última leitura: ${new Intl.DateTimeFormat("pt-BR", {
          timeZone: dados.fuso,
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(lidoEm)}`;
  const umaLoja = filtro.lojaId !== TODAS;
  const fusoNota = umaLoja
    ? `os dias contam no ${rotuloFuso(dados.fuso)}`
    : `cada pedido conta no dia do fuso da loja, e “hoje” segue o ${rotuloFuso(dados.fuso)}`;
  // O aviso de custo, como a funcao avisoDeCusto da tela.
  const semCustoPadrao = r.avisos.lojasSemCustoPadraoComFalta.length > 0;
  const custo: Pendencia | null =
    cobertura === null || cobertura >= 0.9995
      ? null
      : {
          id: "custo",
          tom: "warn",
          titulo: `${porcento(1 - cobertura)} das vendas estão sem custo cadastrado.`,
          detalhe: semCustoPadrao
            ? "O lucro estimado aparece maior do que é."
            : "Elas usam o custo padrão da loja: o lucro é uma estimativa.",
          acao: { rotulo: "Cadastrar custos", href: CUSTOS_SEM_CUSTO },
        };

  // As props que a tela passava aos componentes.
  return {
    faixa: { custo, itens: pendencias },
    leitura: { rotulo: leitura, iso: lidoEm === null ? null : new Date(lidoEm).toISOString(), hora: horaLeitura },
    painel: {
      moeda,
      principal,
      celulas,
      comparacao: modo,
      umDia: r.intervalos.atual.desde === r.intervalos.atual.ate,
      rotuloPeriodo: nomeDoPeriodo(filtro.periodo, r.intervalos.atual, hoje),
      rotuloAnterior: rotuloIntervalo(r.intervalos.anterior),
      contexto,
      rotuloReceita: contraEntrega ? "Recebido" : "Faturamento",
      rotuloLucro: contraEntrega ? "Lucro realizado" : "Lucro estimado",
      rotuloPedidos: !contraEntrega ? "Pedidos" : codShopify ? "Pedidos pagos" : "Pedidos aprovados",
    },
    cascata: { contraEntrega, devolucoes: codShopify, venda: Boolean(venda) },
    detalhar: { rotuloLoja, mostrarLoja, semAcesso: r.porLoja.map((l) => semAcesso(l.storeId)) },
    comoCalculamos: { contraEntrega: codShopify, checkout: comissaoIds.length > 0, venda: vendaIds.length > 0 },
    fusoNota,
  };
}

/** As mesmas props, agora montadas por montarPainel (como a tela faz hoje). */
function comoATelaMonta(dados: DadosLucro, comparacao: Comparacao, conexao: ConexaoLucro, agora: number) {
  const p = montarPainel(dados, comparacao, conexao, agora);
  const semAcesso = new Set(p.lojasSemAcesso);
  return {
    faixa: { custo: p.custo, itens: p.pendencias },
    leitura: { rotulo: p.leitura, iso: p.lidoEm === null ? null : new Date(p.lidoEm).toISOString(), hora: p.horaLeitura },
    painel: {
      moeda: p.moeda,
      principal: p.principal,
      celulas: p.celulas,
      comparacao: p.comparacao,
      umDia: p.umDia,
      rotuloPeriodo: p.rotuloPeriodo,
      rotuloAnterior: p.rotuloAnterior,
      contexto: p.contexto,
      rotuloReceita: p.rotuloReceita,
      rotuloLucro: p.rotuloLucro,
      rotuloPedidos: p.rotuloPedidos,
    },
    cascata: { contraEntrega: p.contraEntrega, devolucoes: p.codShopify, venda: Boolean(p.venda) },
    detalhar: {
      rotuloLoja: p.rotuloLoja,
      mostrarLoja: p.mostrarLoja,
      semAcesso: dados.resultado.porLoja.map((l) => semAcesso.has(l.storeId)),
    },
    comoCalculamos: { contraEntrega: p.codShopify, checkout: p.comissao, venda: Boolean(p.venda) },
    fusoNota: p.fusoNota,
  };
}

/** Duas lojas: uma so contra entrega, outra online; venda e gasto nos dois periodos. */
function cenarioCod() {
  return entrada({
    pedidos: [
      cod({ dia_local: "2026-09-29" }),
      cod({ dia_local: "2026-09-30" }),
      cod({ dia_local: "2026-09-26" }),
      pedido({ dia_local: "2026-09-29", total_atual: 200, recebido: 200, liquido_pago: 200, linhas: [linha("SKU-1", 2, 100)] }),
      pedido({ dia_local: "2026-09-26" }),
    ],
    gastos: [gasto("2026-09-29", 10), gasto("2026-09-26", 8)],
  });
}

/** Uma loja online; o anterior vendeu mais, e um SKU sem custo (o aviso de custo). */
function cenarioComparacao(hoje = "2026-10-01") {
  return entrada({
    lojas: [{ ...LOJAS[1], fuso: "America/Sao_Paulo", moeda: "BRL" }],
    pedidos: [
      pedido({ dia_local: "2026-09-29" }),
      pedido({ dia_local: "2026-09-30", linhas: [linha("SKU-2", 1, 100)] }),
      pedido({ dia_local: "2026-09-25", total_atual: 300, recebido: 300, liquido_pago: 300, linhas: [linha("SKU-1", 3, 100)] }),
    ],
    gastos: [gasto("2026-09-29", 10), gasto("2026-09-26", 10)],
    hoje,
  });
}

function conexaoDe(dados: DadosLucro, p: Partial<ConexaoLucro> = {}): ConexaoLucro {
  return { ...montarConexao(dados, [CONTA], {}), ...p };
}

describe("montarPainel: a tela monta igual a antes", () => {
  it("contra entrega com duas lojas: mesmas props, mesmos textos", () => {
    const dados = dadosDe(cenarioCod());
    const conexao = conexaoDe(dados);
    const novo = comoATelaMonta(dados, "anterior", conexao, AGORA);
    expect(novo).toEqual(comoATelaMontava(dados, "anterior", conexao, AGORA));

    // E e de fato a tela de contra entrega, com a aba Loja.
    expect(novo.painel.principal.rotulo).toBe("Lucro previsto");
    expect(novo.painel.rotuloReceita).toBe("Recebido");
    expect(novo.painel.rotuloPedidos).toBe("Pedidos pagos");
    expect(novo.painel.celulas.map((c) => c.rotulo)).toContain("A receber");
    expect(novo.cascata).toEqual({ contraEntrega: true, devolucoes: true, venda: false });
    expect(novo.detalhar.mostrarLoja).toBe(true);
    expect(novo.painel.comparacao).toBe("anterior");
  });

  it("com comparacao, sem comparacao e sem base: mesmas props", () => {
    const dados = dadosDe(cenarioComparacao(), LOJA_ON);
    const conexao = conexaoDe(dados);
    for (const c of ["anterior", "nenhum"] as const) {
      expect(comoATelaMonta(dados, c, conexao, AGORA)).toEqual(comoATelaMontava(dados, c, conexao, AGORA));
    }
    const p = montarPainel(dados, "anterior", conexao, AGORA);
    expect(p.principal.variacao).toBeTypeOf("number");
    expect(p.custo?.id).toBe("custo");
    expect(p.mostrarLoja).toBe(false);
    expect(p.fusoNota).toBe("os dias contam no horário de São Paulo");
    expect(montarPainel(dados, "nenhum", conexao, AGORA).principal.variacao).toBeUndefined();

    // Anterior sem movimento: "sem-base", sem variacao.
    const semAnterior = dadosDe(
      entrada({ lojas: [{ ...LOJAS[1], fuso: "America/Sao_Paulo", moeda: "BRL" }], pedidos: [pedido()] }),
      LOJA_ON
    );
    const c2 = conexaoDe(semAnterior);
    expect(comoATelaMonta(semAnterior, "anterior", c2, AGORA)).toEqual(comoATelaMontava(semAnterior, "anterior", c2, AGORA));
    expect(montarPainel(semAnterior, "anterior", c2, AGORA).comparacao).toBe("sem-base");
  });

  it("loja desinstalada e sem contas lidas: pendencias e sem acesso iguais", () => {
    const dados = dadosDe(cenarioCod());
    const conexao = montarConexao(dados, null, { [LOJA_COD]: "2026-09-29T10:00:00Z" });
    expect(conexao.lojasComConta).toBeNull();
    expect(conexao.lido).toEqual({ pedidos: true, gasto: false });
    expect(comoATelaMonta(dados, "anterior", conexao, AGORA)).toEqual(comoATelaMontava(dados, "anterior", conexao, AGORA));
    expect(montarPainel(dados, "anterior", conexao, AGORA).lojasSemAcesso).toEqual([LOJA_COD]);
  });
});

describe("montarConexao: o que page.tsx montava das contas", () => {
  it("so conta ativa de loja do filtro; a leitura vale a mais atrasada", () => {
    const dados = dadosDe(cenarioCod());
    const contas = [
      CONTA,
      { ...CONTA, store_id: "outra-loja", ultimo_sync_ok_em: "2026-09-30T14:59:00Z" },
      { ...CONTA, store_id: LOJA_COD, ativo: false, ultimo_sync_ok_em: "2026-09-30T14:58:00Z" },
    ];
    const c = montarConexao(dados, contas, {});
    expect(c.lojasComConta).toEqual([LOJA_ON]);
    // Pedidos 14:50, gasto 14:40: vale 14:40.
    expect(c.atualizadoEm).toBe(Date.parse("2026-09-30T14:40:00Z"));
    expect(c.lido).toEqual({ pedidos: true, gasto: true });
  });
});

describe("painelDoApp: o recorte do celular", () => {
  it("cartoes com texto pronto, variacao com tom e a linha do anterior", () => {
    const dados = dadosDe(cenarioComparacao(), LOJA_ON);
    const p = montarPainel(dados, "anterior", conexaoDe(dados), AGORA);
    const app = painelDoApp(p, dados, "anterior");

    expect(app.filtro).toEqual({
      loja: LOJA_ON,
      nomeLoja: "AmpleStep",
      periodo: "2026-09-28_2026-09-30",
      moeda: "BRL",
      comparar: "anterior",
    });
    expect(app.periodo).toMatchObject({ desde: "2026-09-28", ate: "2026-09-30", terminaHoje: false, umDia: false });
    expect(app.periodo.anterior).toEqual({ ...ANTERIOR, rotulo: "25/09–27/09" });
    expect(app.comparacao).toBe("anterior");
    expect(app.principal.rotulo).toBe("Lucro estimado");
    expect(app.principal.texto).toBe(p.principal.texto.replace(/^-/, "−"));
    expect(app.principal.linha).toMatch(/^vs\. .+ em 25\/09–27\/09$/);
    // O lucro caiu contra o anterior: vermelho, para baixo.
    expect(app.principal.variacao).toMatchObject({ direcao: "desce", tom: "err" });
    expect(app.cartoes.map((c) => c.rotulo)).toEqual(p.celulas.map((c) => c.rotulo));
    const fat = app.cartoes.find((c) => c.id === "receita")!;
    expect(sp(fat.texto)).toBe("R$ 200,00");
    expect(fat.variacao).toMatchObject({ direcao: "desce", tom: "err" });
    expect(app.porLoja).toEqual([]);
    // O aviso de custo vai na lista, na ordem da faixa.
    expect(app.pendencias[0]).toMatchObject({ id: "custo", tom: "warn", acao: { href: CUSTOS_SEM_CUSTO } });
    expect(app.leitura).toEqual({
      rotulo: "Pedidos e gasto lidos há 20 min",
      hora: p.horaLeitura,
      em: "2026-09-30T14:40:00.000Z",
    });
    // Nada de serie nem de dado so do grafico web.
    expect(JSON.stringify(app)).not.toMatch(/"serie"|rotuloSerie/);
  });

  it("periodo terminando hoje: a variacao sai sem cor, e o texto diz 'hoje parcial'", () => {
    const dados = dadosDe(cenarioComparacao("2026-09-30"), LOJA_ON);
    const app = painelDoApp(montarPainel(dados, "anterior", conexaoDe(dados), AGORA), dados, "anterior");
    expect(app.periodo.terminaHoje).toBe(true);
    expect(app.principal.variacao).toMatchObject({ direcao: "desce", tom: "neutral" });
    expect(app.principal.linha).toMatch(/\(hoje parcial\)$/);
  });

  it("sem comparacao: 'Sem comparação' e nenhum cartao com variacao", () => {
    const dados = dadosDe(cenarioComparacao(), LOJA_ON);
    const app = painelDoApp(montarPainel(dados, "nenhum", conexaoDe(dados), AGORA), dados, "nenhum");
    expect(app.comparacao).toBe("nenhuma");
    expect(app.principal.linha).toBe("Sem comparação");
    expect(app.principal).not.toHaveProperty("variacao");
    expect(app.cartoes.every((c) => !("variacao" in c))).toBe(true);
  });

  it("contra entrega com Todas: aba Loja na ordem do lucro, rotulos do grafico do COD", () => {
    const dados = dadosDe(cenarioCod());
    const p = montarPainel(dados, "anterior", conexaoDe(dados), AGORA);
    const app = painelDoApp(p, dados, "anterior");
    expect(app.filtro.loja).toBe(TODAS);
    expect(app.filtro.nomeLoja).toBe("Todas as lojas");
    expect(app.contraEntrega).toBe(true);
    expect(app.grafico).toEqual({ receita: "Recebido", lucro: "Lucro realizado", pedidos: "Pedidos pagos" });
    expect(app.principal.rotulo).toBe("Lucro previsto");
    expect(app.porLoja.map((l) => l.id)).toEqual(
      [...dados.resultado.porLoja].sort((a, b) => b.lucro - a.lucro).map((l) => l.storeId)
    );
    const on = app.porLoja.find((l) => l.id === LOJA_ON)!;
    expect(on.nome).toBe("AmpleStep");
    expect(on.pedidos).toBe("1");
    expect(sp(on.faturamento)).toBe("R$ 200,00");
    expect(on.situacao.texto).toMatch(/Lucro|No limite|Prejuízo|Sem gasto/);
  });
});

// ---------------------------------------------------------------------------
// As rotas
// ---------------------------------------------------------------------------

async function chamar(caminho: "dashboard" | "serie") {
  vi.resetModules();
  const mod =
    caminho === "dashboard"
      ? await import("../src/app/api/app/v1/dashboard/route")
      : await import("../src/app/api/app/v1/dashboard/serie/route");
  const r = await mod.GET();
  return { status: r.status, cache: r.headers.get("cache-control"), corpo: await r.json() };
}

describe("GET /api/app/v1/dashboard", () => {
  beforeEach(() => {
    mundo.token = "jwt";
    mundo.usuario = { id: USER };
    mundo.acesso = true;
    mundo.comparacao = "anterior";
    mundo.erroFinanceiro = false;
    mundo.financeiro = dadosDe(cenarioCod());
    mundo.chamadasBase = 0;
    mundo.banco = fakeSupabase({
      stores: [
        { id: LOJA_COD, uninstalled_at: null, user_id: USER },
        { id: LOJA_ON, uninstalled_at: null, user_id: USER },
      ],
      ad_accounts: [{ ...CONTA }],
    });
  });

  it("sem o Bearer do app: 401 sem_login", async () => {
    mundo.token = null;
    expect(await chamar("dashboard")).toMatchObject({ status: 401, corpo: { ok: false, codigo: "sem_login" } });
  });

  it("sem acesso: 403 sem_acesso, sem ler nada", async () => {
    mundo.acesso = false;
    mundo.erroFinanceiro = true;
    expect(await chamar("dashboard")).toMatchObject({ status: 403, corpo: { codigo: "sem_acesso" } });
  });

  it("200: o painel do celular, sem cache, e sem ler a base de novo", async () => {
    const r = await chamar("dashboard");
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    const dados = mundo.financeiro as DadosLucro;
    expect(r.corpo).toMatchObject({ ok: true, vazio: false, moeda: "BRL", comparacao: "anterior", contraEntrega: true });
    expect(r.corpo.filtro).toEqual({
      loja: TODAS,
      nomeLoja: "Todas as lojas",
      periodo: "2026-09-28_2026-09-30",
      moeda: "BRL",
      comparar: "anterior",
    });
    expect(r.corpo.periodo.rotulo).toBe(nomeDoPeriodo(ATUAL, ATUAL, "2026-09-30"));
    expect(r.corpo.principal).toMatchObject({ rotulo: "Lucro previsto" });
    expect(r.corpo.cartoes).toHaveLength(montarPainel(dados, "anterior", conexaoDe(dados), AGORA).celulas.length);
    expect(r.corpo.porLoja).toHaveLength(2);
    // As contas e as lojas vieram do banco: a leitura e a da conta ativa.
    expect(r.corpo.leitura.em).toBe("2026-09-30T14:40:00.000Z");
    expect(mundo.chamadasBase).toBe(0);
  });

  it("loja desinstalada no banco: 'Sem acesso' se vendeu, fora da aba Loja se parou; pendencia nas duas", async () => {
    type Linha = { id: string; situacao: { texto: string } };
    // A online vendeu no periodo: fica na tabela, com o selo.
    mundo.banco.tabelas.stores[1].uninstalled_at = "2026-09-29T10:00:00Z";
    let r = await chamar("dashboard");
    expect(r.status).toBe(200);
    expect((r.corpo.porLoja as Linha[]).find((l) => l.id === LOJA_ON)?.situacao.texto).toBe("Sem acesso");
    expect(JSON.stringify(r.corpo.pendencias)).toMatch(/AmpleStep/);

    // A de contra entrega nao recebeu nem gastou: sai da tabela, como no site.
    mundo.banco.tabelas.stores[1].uninstalled_at = null;
    mundo.banco.tabelas.stores[0].uninstalled_at = "2026-09-29T10:00:00Z";
    r = await chamar("dashboard");
    expect((r.corpo.porLoja as Linha[]).map((l) => l.id)).toEqual([LOJA_ON]);
    expect(JSON.stringify(r.corpo.pendencias)).toMatch(/Dům parfémů/);
  });

  it("falha ao ler as contas: abre igual, sem a leitura do gasto", async () => {
    mundo.banco = fakeSupabase(
      { stores: [], ad_accounts: [] },
      (tabela) => (tabela === "ad_accounts" ? { message: "timeout" } : null)
    );
    const r = await chamar("dashboard");
    expect(r.status).toBe(200);
    expect(r.corpo.leitura.rotulo).toMatch(/^Pedidos lidos /);
  });

  it("sem loja nem checkout: vazio", async () => {
    mundo.financeiro = { vazio: true };
    expect(await chamar("dashboard")).toMatchObject({ status: 200, corpo: { ok: true, vazio: true } });
  });

  it("erro de banco no calculo: 503, nunca zero", async () => {
    mundo.erroFinanceiro = true;
    const r = await chamar("dashboard");
    expect(r).toMatchObject({ status: 503, corpo: { ok: false, codigo: "leitura_falhou" } });
    expect(JSON.stringify(r.corpo)).not.toMatch(/statement timeout/);
  });
});

describe("GET /api/app/v1/dashboard/serie", () => {
  beforeEach(() => {
    mundo.token = "jwt";
    mundo.usuario = { id: USER };
    mundo.acesso = true;
    mundo.erroBase = false;
    const e = cenarioCod();
    mundo.base = {
      entrada: e,
      filtro: { lojaId: TODAS, periodo: ATUAL, moeda: "BRL" },
      lojaIds: [LOJA_COD, LOJA_ON],
      checkoutIds: [],
    };
  });

  it("sem o Bearer do app: 401; sem acesso: 403", async () => {
    mundo.token = null;
    expect(await chamar("serie")).toMatchObject({ status: 401, corpo: { codigo: "sem_login" } });
    mundo.token = "jwt";
    mundo.acesso = false;
    expect(await chamar("serie")).toMatchObject({ status: 403, corpo: { codigo: "sem_acesso" } });
  });

  it("200: atual e anterior dia a dia com o lucro do dia, e o lucro por loja com Todas", async () => {
    const r = await chamar("serie");
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.corpo).toMatchObject({ ok: true, vazio: false, moeda: "BRL", intervalos: { atual: ATUAL, anterior: ANTERIOR } });
    expect(r.corpo.atual.map((d: { dia: string }) => d.dia)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    const dia = r.corpo.atual[1];
    expect(dia.lucro).toBeCloseTo(dia.receita - dia.cmv - dia.taxas - (dia.devolucoes ?? 0) - dia.gastoMeta - dia.gastoGoogle, 6);
    expect(r.corpo.anterior).toHaveLength(3);
    expect(r.corpo.porLoja.map((l: { storeId: string }) => l.storeId)).toEqual([LOJA_COD, LOJA_ON]);
  });

  it("uma loja so: sem o lucro por loja", async () => {
    (mundo.base as { filtro: { lojaId: string }; lojaIds: string[] }).filtro.lojaId = LOJA_ON;
    (mundo.base as { lojaIds: string[] }).lojaIds = [LOJA_ON];
    expect((await chamar("serie")).corpo.porLoja).toEqual([]);
  });

  it("sem loja: vazio; erro de banco: 503", async () => {
    mundo.base = null;
    expect(await chamar("serie")).toMatchObject({ status: 200, corpo: { ok: true, vazio: true } });
    mundo.erroBase = true;
    expect(await chamar("serie")).toMatchObject({ status: 503, corpo: { ok: false, codigo: "leitura_falhou" } });
  });
});
