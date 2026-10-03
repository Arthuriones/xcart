import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DestinoDaRota, EventoDaRota, RotaDaLista } from "../src/lib/leitura/visao-rota";
import type { SalesRow } from "../src/lib/sales/types";
import {
  CONSOLE,
  contarProblemas,
  destinosNaTela,
  escolherRota,
  eventoNaTela,
  haQuanto,
  nomeDaRota,
  plural,
  problemasDaRota,
  produtosLigados,
  tempoDeHoras,
  textoSinal,
} from "../src/app/(dashboard)/overview/apresentar";
import {
  dinheiroCentavos,
  listaDeNomes,
  periodoValido,
  resumirVendas,
  somaTrafego,
  textoPorMoeda,
  ticketDaLoja,
} from "../src/app/(dashboard)/sales/apresentar";

const RAIZ = path.resolve(__dirname, "..");
const AGORA = Date.parse("2026-10-03T15:00:00Z");
const HORA = 3_600_000;

function rota(p: Partial<RotaDaLista> = {}): RotaDaLista {
  return {
    id: "r1",
    nome: "",
    ativa: true,
    vitrine: { id: "v1", nome: "Vitrine A", dominio: "vitrine-a.myshopify.com" },
    estrategia: "sticky",
    ultimoConserto: null,
    destinoLegado: null,
    ...p,
  };
}

function destino(p: Partial<DestinoDaRota> = {}): DestinoDaRota {
  return {
    id: "t1",
    lojaId: "c1",
    loja: { id: "c1", nome: "Checkout 1", dominio: "c1.myshopify.com" },
    ligado: true,
    peso: 1,
    mapeados: 100,
    conferidoEm: new Date(AGORA - HORA).toISOString(),
    carrinhos: 3,
    ...p,
  };
}

function venda(p: Partial<SalesRow> = {}): SalesRow {
  return {
    storeId: "c1",
    name: "Checkout 1",
    domain: "c1.myshopify.com",
    state: "ok",
    orders: 10,
    revenueCents: 100_000,
    currency: "BRL",
    sharePercent: 0,
    trafficPercent: 50,
    problem: null,
    vitrines: ["Vitrine A"],
    ...p,
  };
}

// ---------------------------------------------------------------------------
// Visao da rota
// ---------------------------------------------------------------------------

describe("plural sem (s)", () => {
  it("singular e plural por extenso", () => {
    expect(plural(1, "carrinho falhou", "carrinhos falharam")).toBe("1 carrinho falhou");
    expect(plural(3, "carrinho falhou", "carrinhos falharam")).toBe("3 carrinhos falharam");
    expect(plural(1200, "item", "itens")).toBe("1.200 itens");
  });
});

describe("escolherRota", () => {
  const a = rota({ id: "a", ativa: false });
  const b = rota({ id: "b", ativa: true });
  it("a da URL, se for do usuario", () => expect(escolherRota([a, b], "a")?.id).toBe("a"));
  it("sem pedido: a primeira ligada", () => expect(escolherRota([a, b], null)?.id).toBe("b"));
  it("id desconhecido cai no padrao, nao em erro", () => expect(escolherRota([a, b], "xx")?.id).toBe("b"));
  it("todas pausadas: a primeira", () => expect(escolherRota([a], null)?.id).toBe("a"));
  it("sem rota: null", () => expect(escolherRota([], "a")).toBeNull());
  it("nome: o dado, ou o da vitrine", () => {
    expect(nomeDaRota(rota({ nome: "  " }))).toBe("Vitrine A");
    expect(nomeDaRota(rota({ nome: "Principal" }))).toBe("Principal");
    expect(nomeDaRota(rota({ vitrine: null }))).toBe("Rota sem nome");
  });
});

describe("destinosNaTela", () => {
  it("a fatia soma 100 (maior resto), como em Vendas", () => {
    const d = destinosNaTela(
      [destino({ id: "a", peso: 1 }), destino({ id: "b", peso: 1 }), destino({ id: "c", peso: 1 })],
      true
    );
    expect(d.map((x) => x.fatia).reduce((s, n) => s + n, 0)).toBe(100);
    expect(d.every((x) => x.estado === "ok")).toBe(true);
  });
  it("rota pausada: ninguem recebe, ativa vira pausada, atencao continua", () => {
    const d = destinosNaTela([destino({ id: "a" }), destino({ id: "b", mapeados: 0 })], false);
    expect(d.map((x) => x.fatia)).toEqual([0, 0]);
    expect(d.map((x) => x.estado)).toEqual(["paused", "attention"]);
  });
  it("desligada ou peso 0 fica fora da divisao", () => {
    const d = destinosNaTela([destino({ id: "a", peso: 3 }), destino({ id: "b", peso: 0 }), destino({ id: "c", ligado: false })], true);
    expect(d.map((x) => x.fatia)).toEqual([100, 0, 0]);
    expect(d.map((x) => x.estado)).toEqual(["ok", "paused", "paused"]);
  });
  it("loja removida nao quebra o nome", () => {
    expect(destinosNaTela([destino({ loja: null })], true)[0].nome).toBe("Loja removida");
  });
});

describe("produtosLigados", () => {
  it("o maior mapa e a faixa quando diferem", () => {
    expect(produtosLigados([{ mapeados: 80, ligado: true }, { mapeados: 120, ligado: true }])).toEqual({
      valor: 120,
      menor: 80,
    });
  });
  it("iguais: sem faixa; desligada nao entra", () => {
    expect(produtosLigados([{ mapeados: 50, ligado: true }, { mapeados: 0, ligado: false }])).toEqual({
      valor: 50,
      menor: null,
    });
  });
  it("sem loja: sem numero (—), nao zero", () => {
    expect(produtosLigados([])).toEqual({ valor: null, menor: null });
  });
});

describe("problemasDaRota", () => {
  const base = { falhas: 0, agora: AGORA };

  it("rota saudavel: nada", () => {
    const destinos = destinosNaTela([destino()], true);
    expect(problemasDaRota({ ...base, rota: rota(), destinos })).toEqual([]);
  });

  it("loja sem mapa recebendo trafego e critica; em 0% e aviso", () => {
    const destinos = destinosNaTela(
      [destino({ id: "a", mapeados: 0, peso: 1 }), destino({ id: "b", mapeados: 0, peso: 0 }), destino({ id: "c" })],
      true
    );
    const p = problemasDaRota({ ...base, rota: rota(), destinos });
    expect(p.find((x) => x.id === "sem-mapa-a")?.tom).toBe("err");
    expect(p.find((x) => x.id === "sem-mapa-b")?.tom).toBe("warn");
  });

  it("ninguem cobrando com a rota ligada e critico", () => {
    const destinos = destinosNaTela([destino({ peso: 0 })], true);
    const p = problemasDaRota({ ...base, rota: rota(), destinos });
    expect(p[0]).toMatchObject({ id: "ninguem-cobra", tom: "err" });
  });

  it("falhas: frase no plural certo, sem (s)", () => {
    const destinos = destinosNaTela([destino()], true);
    const um = problemasDaRota({ ...base, falhas: 1, rota: rota(), destinos });
    const tres = problemasDaRota({ ...base, falhas: 3, rota: rota(), destinos });
    expect(um[0].titulo).toBe("1 carrinho falhou ao rotear nos últimos 7 dias");
    expect(tres[0].titulo).toBe("3 carrinhos falharam ao rotear nos últimos 7 dias");
    expect(problemasDaRota({ ...base, falhas: null, rota: rota(), destinos })).toEqual([]);
  });

  it("conserto com problema: aviso, com o texto tecnico so no detalhe do suporte", () => {
    const destinos = destinosNaTela([destino()], true);
    const p = problemasDaRota({
      ...base,
      rota: rota({ ultimoConserto: { em: "2026-10-03T10:00:00Z", ok: false, mensagem: "abc: falha ao criar produto" } }),
      destinos,
    });
    expect(p[0]).toMatchObject({ id: "conserto", tom: "warn", suporte: "abc: falha ao criar produto" });
    expect(p[0].titulo).not.toContain("abc");
  });

  it("mapa velho: aviso com horas por extenso", () => {
    const destinos = destinosNaTela([destino({ conferidoEm: new Date(AGORA - 30 * HORA).toISOString() })], true);
    const p = problemasDaRota({ ...base, rota: rota(), destinos });
    expect(p[0]).toMatchObject({ id: "mapa-velho", tom: "warn" });
    expect(p[0].titulo).toBe("O mapa de produtos não é conferido há 30 horas");
    expect(tempoDeHoras(72)).toBe("3 dias");
    expect(tempoDeHoras(1)).toBe("1 hora");
  });

  it("rota pausada: so informativo, que nao conta como problema", () => {
    const destinos = destinosNaTela([destino()], false);
    const p = problemasDaRota({ ...base, rota: rota({ ativa: false }), destinos });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: "pausada", tom: "info" });
    expect(contarProblemas(p)).toBe(0);
  });

  it("ordem: critico, aviso, informativo; toda acao leva ao console", () => {
    const destinos = destinosNaTela([destino({ id: "a", mapeados: 0, peso: 0 })], false);
    const p = problemasDaRota({ ...base, falhas: 2, rota: rota({ ativa: false }), destinos });
    expect(p.map((x) => x.tom)).toEqual(["err", "warn", "info"]);
    expect(p.every((x) => x.acao.href === CONSOLE)).toBe(true);
  });
});

describe("tempo e sinal do script", () => {
  it("haQuanto", () => {
    expect(haQuanto(new Date(AGORA - 20_000).toISOString(), AGORA)).toBe("agora há pouco");
    expect(haQuanto(new Date(AGORA - 5 * 60_000).toISOString(), AGORA)).toBe("há 5 min");
    expect(haQuanto(new Date(AGORA - 3 * HORA).toISOString(), AGORA)).toBe("há 3 h");
    expect(haQuanto(new Date(AGORA - 25 * HORA).toISOString(), AGORA)).toBe("há 1 dia");
    expect(haQuanto(new Date(AGORA - 50 * HORA).toISOString(), AGORA)).toBe("há 2 dias");
    expect(haQuanto("lixo", AGORA)).toBe("—");
  });
  it("sinal: leitura falhou, nunca visto e visto sao frases diferentes", () => {
    expect(textoSinal(null, AGORA)).toContain("Não deu para ler");
    expect(textoSinal({ em: null }, AGORA)).toBe("O script ainda não deu sinal na vitrine.");
    expect(textoSinal({ em: new Date(AGORA - 5 * 60_000).toISOString() }, AGORA)).toBe(
      "Script visto na vitrine há 5 min."
    );
  });
});

describe("eventoNaTela", () => {
  const destinos = destinosNaTela([destino({ id: "t1" })], true);
  const ev = (p: Partial<EventoDaRota>): EventoDaRota => ({
    id: "e1",
    motivo: "routed_ok",
    detalhe: null,
    em: "2026-10-03T14:00:00Z",
    destinoId: null,
    ...p,
  });

  it("carrinho roteado: itens e o nome da loja", () => {
    const e = eventoNaTela(ev({ detalhe: "3 itens -> c1.myshopify.com", destinoId: "t1" }), destinos);
    expect(e).toMatchObject({ rotulo: "Carrinho roteado", tom: "ok", descricao: "3 itens para Checkout 1." });
    expect(e.loja).toEqual({ id: "c1", nome: "Checkout 1" });
  });
  it("sem destino gravado: o dominio do detalhe acha a loja da rota", () => {
    const e = eventoNaTela(ev({ detalhe: "2 itens -> C1.myshopify.com" }), destinos);
    expect(e.descricao).toBe("2 itens para Checkout 1.");
    expect(e.loja?.id).toBe("c1");
  });
  it("dominio fora da rota: o dominio mesmo; singular certo", () => {
    expect(eventoNaTela(ev({ detalhe: "1 itens -> outra.myshopify.com" }), destinos).descricao).toBe(
      "1 item para outra.myshopify.com."
    );
    expect(eventoNaTela(ev({ detalhe: " itens -> ?" }), destinos).descricao).toBe(
      "Carrinho para a loja de checkout."
    );
  });
  it("erro: frase humana, sem o texto cru do navegador", () => {
    const e = eventoNaTela(ev({ motivo: "cart_checkout_error", detalhe: "TypeError: Failed to fetch" }), destinos);
    expect(e.tom).toBe("err");
    expect(e.descricao).not.toContain("TypeError");
  });
  it("evento desconhecido nao vira codigo na tela", () => {
    const e = eventoNaTela(ev({ motivo: "algo_novo" }), destinos);
    expect(e.rotulo).toBe("Aviso do script na vitrine");
    expect(e.rotulo).not.toContain("_");
  });
});

// ---------------------------------------------------------------------------
// Vendas por rota
// ---------------------------------------------------------------------------

describe("periodoValido", () => {
  it("7 e 60 valem; o resto cai em 30", () => {
    expect(periodoValido("7")).toBe("7");
    expect(periodoValido("60")).toBe("60");
    expect(periodoValido("90")).toBe("30");
    expect(periodoValido(undefined)).toBe("30");
  });
});

describe("resumirVendas", () => {
  it("uma moeda: total, ticket, lider e fatia que soma 100", () => {
    const r = resumirVendas([
      venda({ storeId: "a", name: "A", revenueCents: 200_000, orders: 4 }),
      venda({ storeId: "b", name: "B", revenueCents: 100_000, orders: 2 }),
    ]);
    expect(r.moeda).toBe("BRL");
    expect(r.totalReceita).toBe(300_000);
    expect(r.totalPedidos).toBe(6);
    expect(r.ticket).toBe(50_000);
    expect(r.lider?.storeId).toBe("a");
    expect(r.fatiaReceita).toEqual({ a: 67, b: 33 });
  });

  it("moedas diferentes nao se somam: total, ticket, lider e fatia viram —", () => {
    const r = resumirVendas([
      venda({ storeId: "a", revenueCents: 439_900_000, currency: "CLP" }),
      venda({ storeId: "b", revenueCents: 100_000, currency: "USD" }),
    ]);
    expect(r.moeda).toBeNull();
    expect(r.totalReceita).toBeNull();
    expect(r.ticket).toBeNull();
    expect(r.lider).toBeNull();
    expect(r.fatiaReceita).toEqual({ a: null, b: null });
    expect(r.porMoeda).toEqual([
      { moeda: "CLP", centavos: 439_900_000 },
      { moeda: "USD", centavos: 100_000 },
    ]);
  });

  it("loja sem venda nao conta como moeda (a Shopify devolve BRL de padrao)", () => {
    const r = resumirVendas([
      venda({ storeId: "a", revenueCents: 50_000, currency: "USD", orders: 2 }),
      venda({ storeId: "b", revenueCents: 0, currency: "BRL", orders: 0 }),
    ]);
    expect(r.moeda).toBe("USD");
    expect(r.totalReceita).toBe(50_000);
    expect(r.fatiaReceita).toEqual({ a: 100, b: 0 });
  });

  it("loja que nao respondeu: fora das contas, com fatia — e listada a parte", () => {
    const r = resumirVendas([
      venda({ storeId: "a", revenueCents: 80_000, orders: 2 }),
      venda({ storeId: "b", revenueCents: 0, orders: 0, problem: "denied", name: "B" }),
      venda({ storeId: "c", revenueCents: 0, orders: 0, problem: "failed", name: "C" }),
    ]);
    expect(r.totalPedidos).toBe(2);
    expect(r.fatiaReceita).toEqual({ a: 100, b: null, c: null });
    expect(r.negadas.map((x) => x.name)).toEqual(["B"]);
    expect(r.semResposta.map((x) => x.name)).toEqual(["C"]);
  });

  it("periodo sem venda: zero e verdadeiro, mas fatia e lider ficam —", () => {
    const r = resumirVendas([venda({ revenueCents: 0, orders: 0 })], "EUR");
    expect(r.moeda).toBe("EUR");
    expect(r.totalReceita).toBe(0);
    expect(r.ticket).toBeNull();
    expect(r.lider).toBeNull();
    expect(r.fatiaReceita).toEqual({ c1: null });
  });
});

describe("formatos de Vendas", () => {
  it("valor completo; sem centavos a partir de 10 mil", () => {
    expect(dinheiroCentavos(123_456, "BRL").replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(dinheiroCentavos(1_234_567, "BRL").replace(/\s/g, " ")).toBe("R$ 12.346");
  });
  it("total por moeda e lista de nomes", () => {
    expect(textoPorMoeda([{ moeda: "BRL", centavos: 100 }, { moeda: "USD", centavos: 250 }]).replace(/\s/g, " ")).toBe(
      "R$ 1,00 · US$ 2,50"
    );
    expect(listaDeNomes(["A"])).toBe("A");
    expect(listaDeNomes(["A", "B", "C"])).toBe("A, B e C");
  });
  it("ticket da loja e soma do trafego", () => {
    expect(ticketDaLoja({ orders: 0, revenueCents: 0 })).toBeNull();
    expect(ticketDaLoja({ orders: 3, revenueCents: 1000 })).toBe(333);
    expect(somaTrafego([{ trafficPercent: 0 }, { trafficPercent: 0 }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// As duas telas seguem as regras do redesign
// ---------------------------------------------------------------------------

describe("arquivos das telas", () => {
  const pastas = ["overview", "sales"].map((p) => path.join(RAIZ, "src", "app", "(dashboard)", p));
  const arquivos = pastas.flatMap((p) =>
    readdirSync(p)
      .filter((f) => /\.(tsx?|ts)$/.test(f))
      .map((f) => path.join(p, f))
  );

  it("existem as duas paginas e o carregando de cada uma", () => {
    for (const p of pastas) {
      expect(existsSync(path.join(p, "page.tsx"))).toBe(true);
      expect(existsSync(path.join(p, "loading.tsx"))).toBe(true);
    }
  });

  it.each(arquivos.map((a) => [path.relative(RAIZ, a), a]))("%s sem valor solto nem confirm nativo", (_, a) => {
    const fonte = readFileSync(a, "utf8");
    expect(fonte).not.toMatch(/text-\[\d/);
    expect(fonte).not.toMatch(/\[var\(--/);
    expect(fonte).not.toMatch(/window\.confirm/);
    expect(fonte).not.toMatch(/<select|type="checkbox"/);
    expect(fonte).not.toMatch(/(border|outline)-solid/);
    expect(fonte).not.toMatch(/\(s\)/);
    // Cor so por classe de token; style so para largura de barra.
    expect(fonte).not.toMatch(/style=\{\{[^}]*(color|background|border)/);
  });
});
