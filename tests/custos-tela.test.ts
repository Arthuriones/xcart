import { describe, expect, it } from "vitest";
import type { ProductCostRow } from "../src/lib/financeiro/tipos";
import type { SkuVendido } from "../src/lib/financeiro/custos-queries";
import { parseCsvCustos } from "../src/lib/financeiro/csv-custos";
import {
  destinoInterno,
  edicaoInicial,
  efeitoDeApagar,
  errosDaEdicao,
  filtrarSkus,
  formTaxasDe,
  itemDaEdicao,
  linhaDoTempo,
  mensagemDeFalha,
  montarModeloCsv,
  mudou,
  opcoesDeMoeda,
  ordenarSkus,
  paginar,
  paraCampo,
  pendenciasDaLoja,
  periodoVigente,
  resumirCustos,
  resumirPrevia,
  taxasMudaram,
  validarTaxas,
} from "../src/app/(dashboard)/financeiro/custos/apresentar";

const HOJE = "2026-10-03";

function versao(id: string, desde: string, custo: number, frete = 0, moeda = "USD"): ProductCostRow {
  return {
    id,
    store_id: "s",
    user_id: "u",
    sku: "X",
    custo_unitario: custo,
    frete_unitario: frete,
    moeda,
    valido_desde: desde,
    origem: "manual",
  };
}

function sku(nome: string, unidades: number, versoes: ProductCostRow[] = []): SkuVendido {
  const ordenadas = [...versoes].sort((a, b) => (a.valido_desde < b.valido_desde ? -1 : 1));
  const vigente = ordenadas.filter((v) => v.valido_desde <= HOJE).pop() ?? ordenadas[0] ?? null;
  return { sku: nome, unidades, receitaBruta: 0, vigente, versoes: ordenadas };
}

describe("edicao de uma linha", () => {
  it("valor inicial com virgula e data de hoje", () => {
    const s = sku("A", 3, [versao("1", "2026-09-01", 12.5, 3.2)]);
    expect(edicaoInicial(s, "BRL", HOJE)).toEqual({ custo: "12,50", frete: "3,20", moeda: "USD", desde: HOJE });
    const miudo = sku("M", 1, [versao("m", "2026-09-01", 1234.125)]);
    expect(edicaoInicial(miudo, "BRL", HOJE).custo).toBe("1234,125"); // sem milhar: volta igual pelo leitor
    expect(edicaoInicial(sku("B", 1), "BRL", HOJE)).toEqual({ custo: "", frete: "", moeda: "BRL", desde: HOJE });
  });

  it("mesmo numero escrito de outro jeito nao conta como alteracao", () => {
    const ini = { custo: "12,5", frete: "0", moeda: "USD", desde: HOJE };
    expect(mudou({ ...ini, custo: "12,50" }, ini)).toBe(false);
    expect(mudou({ ...ini, frete: "" }, ini)).toBe(false); // frete vazio = 0
    expect(mudou({ ...ini, custo: "12,6" }, ini)).toBe(true);
    expect(mudou({ ...ini, moeda: "BRL" }, ini)).toBe(true);
    expect(mudou({ ...ini, desde: "2026-10-04" }, ini)).toBe(true);
  });

  it("campo aceita virgula e mostra todos os erros de uma vez", () => {
    expect(errosDaEdicao({ custo: "12,50", frete: "1.10", moeda: "USD", desde: HOJE })).toEqual({});
    const erros = errosDaEdicao({ custo: "abc", frete: "-1", moeda: "USD", desde: "2026-02-30" });
    expect(erros).toEqual({ custo: "Não é um número", frete: "Não pode ser negativo", desde: "Data inválida" });
    expect(errosDaEdicao({ custo: "", frete: "", moeda: "USD", desde: HOJE }).custo).toBe("Informe o custo");
    expect(errosDaEdicao({ custo: "4.990", frete: "", moeda: "USD", desde: HOJE }).custo).toBe("Use 4990 ou 4,99");
  });

  it("vira o mesmo corpo que a rota sempre recebeu", () => {
    expect(itemDaEdicao("A", { custo: "12,50", frete: "", moeda: "USD", desde: HOJE }, "BRL")).toEqual({
      sku: "A",
      custo_unitario: 12.5,
      frete_unitario: 0,
      moeda: "USD",
      valido_desde: HOJE,
    });
    expect(itemDaEdicao("A", { custo: "x", frete: "", moeda: "USD", desde: HOJE }, "BRL")).toBeNull();
  });

  it("moedas: a da loja primeiro, sem repetir, e a atual se for outra", () => {
    expect(opcoesDeMoeda("BRL")).toEqual(["BRL", "USD", "EUR", "CNY"]);
    expect(opcoesDeMoeda(null, "GBP")).toEqual(["USD", "BRL", "EUR", "CNY", "GBP"]);
  });

  it("paraCampo nao poe milhar (o texto volta igual pelo leitor)", () => {
    expect(paraCampo(1234.5)).toBe("1234,5");
    expect(paraCampo(null)).toBe("");
  });
});

describe("filtro, ordem e pagina da tabela", () => {
  const lista = [
    sku("CIL-002", 5, [versao("1", "2026-09-01", 2)]),
    sku("CIL-010", 9),
    sku("CIL-001", 1),
    sku("ÓCULOS", 3, [versao("2", "2026-09-01", 2)]),
  ];

  it("sem custo primeiro, depois o que mais vende", () => {
    expect(ordenarSkus(lista, "pendentes").map((s) => s.sku)).toEqual(["CIL-010", "CIL-001", "CIL-002", "ÓCULOS"]);
    expect(ordenarSkus(lista, "vendidos").map((s) => s.sku)).toEqual(["CIL-010", "CIL-002", "ÓCULOS", "CIL-001"]);
    expect(ordenarSkus(lista, "sku").map((s) => s.sku)).toEqual(["CIL-001", "CIL-002", "CIL-010", "ÓCULOS"]);
  });

  it("situacao, busca sem acento e pelo nome do produto", () => {
    const base = { situacao: "todos" as const, busca: "", alterados: new Set<string>() };
    expect(filtrarSkus(lista, { ...base, situacao: "semCusto" }).map((s) => s.sku)).toEqual(["CIL-010", "CIL-001"]);
    expect(filtrarSkus(lista, { ...base, situacao: "alterados", alterados: new Set(["CIL-002"]) })).toHaveLength(1);
    expect(filtrarSkus(lista, { ...base, busca: "oculos" }).map((s) => s.sku)).toEqual(["ÓCULOS"]);
    const nomes = new Map([["CIL-001", "Cílios Volume Russo"]]);
    expect(filtrarSkus(lista, { ...base, busca: "russo", nomes }).map((s) => s.sku)).toEqual(["CIL-001"]);
  });

  it("pagina fica dentro do limite", () => {
    const n = Array.from({ length: 120 }, (_, i) => i);
    expect(paginar(n, 1)).toMatchObject({ pagina: 1, paginas: 3, de: 1, ate: 50, total: 120 });
    expect(paginar(n, 9)).toMatchObject({ pagina: 3, de: 101, ate: 120 });
    expect(paginar([], 2)).toMatchObject({ pagina: 1, paginas: 1, de: 0, ate: 0 });
  });
});

describe("linha do tempo do custo", () => {
  it("versao unica vale para todos os pedidos", () => {
    const t = linhaDoTempo([versao("a", "2026-09-10", 5)], HOJE);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ periodo: "Todos os pedidos", valeHoje: true, futura: false });
  });

  it("a primeira cobre o passado, cada uma vale ate a vespera da seguinte", () => {
    const t = linhaDoTempo(
      [versao("b", "2026-09-20", 6), versao("a", "2026-09-01", 5), versao("c", "2026-10-10", 7)],
      HOJE
    );
    expect(t.map((e) => [e.versao.id, e.periodo, e.valeHoje, e.futura])).toEqual([
      ["c", "A partir de 10/10/2026", false, true],
      ["b", "De 20/09/2026 a 09/10/2026", true, false],
      ["a", "Pedidos até 19/09/2026", false, false],
    ]);
  });

  it("periodo da linha sem edicao", () => {
    expect(periodoVigente(sku("A", 1), HOJE)).toBeNull();
    expect(periodoVigente(sku("A", 1, [versao("a", "2026-09-01", 5), versao("b", "2026-09-20", 6)]), HOJE)).toBe(
      "Desde 20/09/2026"
    );
  });

  it("apagar diz o que muda, com valor e data", () => {
    const vs = [versao("a", "2026-09-01", 5), versao("b", "2026-09-20", 6, 1)];
    // O Intl poe espaco inseparavel entre "US$" e o numero.
    const efeito = (id: string) => efeitoDeApagar(vs, id, false).replace(/ /g, " ");
    expect(efeito("b")).toBe("Os pedidos desde 20/09/2026 voltam a usar o custo anterior: US$ 5,00.");
    expect(efeito("a")).toBe(
      "Os pedidos até 19/09/2026 passam a usar o custo que vale desde 20/09/2026: US$ 6,00 + frete US$ 1,00."
    );
    expect(efeitoDeApagar([vs[0]], "a", true)).toMatch(/custo padrão/);
    expect(efeitoDeApagar([vs[0]], "a", false)).toMatch(/alto demais/);
  });
});

describe("taxa de pagamento", () => {
  it("vazio vale zero na taxa e nulo no custo padrao", () => {
    expect(validarTaxas({ pct: "", fixa: "", padrao: "" })).toEqual({
      erros: {},
      corpo: { taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: null },
    });
    expect(validarTaxas({ pct: "3,99", fixa: "0.39", padrao: "35" }).corpo).toEqual({
      taxa_pct: 3.99,
      taxa_fixa: 0.39,
      custo_padrao_pct: 35,
    });
  });

  it("todos os erros de uma vez, nos limites da rota", () => {
    const r = validarTaxas({ pct: "100", fixa: "abc", padrao: "101" });
    expect(r.corpo).toBeNull();
    expect(r.erros).toEqual({
      pct: "Use um número de 0 a 99,99",
      fixa: "Não é um número",
      padrao: "Use um número de 0 a 100, ou deixe vazio",
    });
    expect(validarTaxas({ pct: "", fixa: "1.000", padrao: "" }).erros.fixa).toMatch(/^Ambíguo/);
  });

  it("alteracao compara o valor", () => {
    const base = formTaxasDe({ taxa_pct: 3.99, taxa_fixa: 0, custo_padrao_pct: null });
    expect(base).toEqual({ pct: "3,99", fixa: "0", padrao: "" });
    expect(taxasMudaram({ ...base, fixa: "" }, base)).toBe(false);
    expect(taxasMudaram({ ...base, pct: "3,990" }, base)).toBe(false);
    expect(taxasMudaram({ ...base, padrao: "0" }, base)).toBe(true);
  });
});

describe("falha ao gravar", () => {
  it("nunca repassa o texto tecnico", () => {
    expect(mensagemDeFalha(null, null)).toMatch(/Sem conexão/);
    expect(mensagemDeFalha(401, { error: "Unauthorized" })).toMatch(/sessão expirou/);
    expect(mensagemDeFalha(500, { error: "Falha ao gravar os custos (0 de 3 já gravados): duplicate key" }, 3)).toMatch(
      /^Não deu para salvar agora/
    );
    expect(mensagemDeFalha(500, { gravados: 500 }, 1200)).toBe(
      "Só parte foi salva (500 de 1.200). Tente de novo para salvar o resto."
    );
    expect(mensagemDeFalha(400, { error: "Taxa fixa deve ficar entre 0 e 10.000." })).toBe(
      "Taxa fixa deve ficar entre 0 e 10.000."
    );
  });
});

describe("planilha", () => {
  it("modelo vem com o custo atual em virgula e a data vazia", () => {
    const csv = montarModeloCsv([sku("A;1", 2, [versao("a", "2026-09-01", 12.5, 3.2)]), sku("B", 1)], "BRL");
    expect(csv).toBe(
      'sku;custo_unitario;frete_unitario;moeda;valido_desde\r\n"A;1";12,5;3,2;USD;\r\nB;;;BRL;\r\n'
    );
    // E o modelo volta pelo leitor sem erro (B fica sem custo: erro esperado so nele).
    const r = parseCsvCustos(csv, "BRL");
    expect(r.itens).toEqual([{ sku: "A;1", custo_unitario: 12.5, frete_unitario: 3.2, moeda: "USD", valido_desde: null }]);
    expect(r.erros).toEqual([{ linha: 3, motivo: "custo vazio" }]);
  });

  it("previa conta prontos, erros, sem venda e repetidos", () => {
    const previa = parseCsvCustos("sku;custo\nA;1\nZ;2\nA;3\nB;x", "USD");
    expect(resumirPrevia(previa, [sku("A", 2), sku("B", 1)])).toEqual({
      prontos: 3,
      comErro: 1,
      semVenda: ["Z"],
      repetidos: 1,
    });
  });
});

describe("escolher loja", () => {
  it("progresso so conta SKU que vendeu", () => {
    const r = resumirCustos({
      skus: [sku("A", 2, [versao("a", "2026-09-01", 1)]), sku("B", 1), sku("C", 0, [versao("c", "2026-09-01", 1)])],
      config: null,
      sincronizado: true,
    });
    expect(r).toEqual({ vendidos: 2, comCusto: 1, taxa: false, sincronizado: true });
    expect(pendenciasDaLoja(r)).toBe(2);
    expect(pendenciasDaLoja(null)).toBe(0);
  });
});

describe("sair com alteracao nao salva", () => {
  const atual = "https://user.xcart.app/financeiro/custos?situacao=semCusto";
  const base = { target: null, download: false, botao: 0, modificador: false, atual };

  it("link para outra tela do app e interceptado", () => {
    expect(destinoInterno({ ...base, href: "/financeiro" })).toBe("/financeiro");
    expect(destinoInterno({ ...base, href: "https://user.xcart.app/stores?x=1#a" })).toBe("/stores?x=1#a");
  });

  it("o navegador cuida sozinho do resto", () => {
    expect(destinoInterno({ ...base, href: "https://loja.myshopify.com/admin" })).toBeNull();
    expect(destinoInterno({ ...base, href: "/financeiro", target: "_blank" })).toBeNull();
    expect(destinoInterno({ ...base, href: "/financeiro", modificador: true })).toBeNull();
    expect(destinoInterno({ ...base, href: "/financeiro", botao: 1 })).toBeNull();
    expect(destinoInterno({ ...base, href: "/financeiro/custos?situacao=semCusto#tabela" })).toBeNull();
  });
});
