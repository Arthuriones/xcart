import { describe, expect, it } from "vitest";
import type { EventoFeed } from "../src/lib/financeiro/tipos";
import {
  NENHUM,
  VISAO_ATUAL,
  alternarValor,
  campoCsv,
  contarStatus,
  dataHoraCompleta,
  detalheClique,
  ehTeste,
  explicarErro,
  filtroDaUrl,
  filtroParaQuery,
  filtroVazio,
  filtrosIguais,
  formatarLatencia,
  horaDoEvento,
  idsNovos,
  juntarEventos,
  lerVisoesSalvas,
  montarCsv,
  opcoesDe,
  passa,
  rotuloChip,
  rotuloDia,
  seloDoStatus,
  temFiltro,
  textoClique,
  textoOrigem,
  urlDoPedido,
  visaoAtiva,
} from "../src/app/(dashboard)/tracking/eventos/logica";

function ev(p: Partial<EventoFeed> & { id: string }): EventoFeed {
  return {
    store_id: "loja-a",
    criado_em: "2026-10-02T17:32:05.000Z",
    enviado_em: null,
    latencia_s: null,
    evento: "view_item",
    fonte: "tema",
    plataforma: "meta",
    destino_id: "d1",
    destino_nome: "Pixel Lumen",
    status: "enviado",
    tentativas: 1,
    erro: null,
    com_clique: null,
    origem_host: null,
    utm_source: null,
    utm_campaign: null,
    pedido: null,
    ...p,
  };
}

const SP = "America/Sao_Paulo";

describe("juntar e detectar novos", () => {
  it("a versao nova de um id vence e a lista fica do mais novo para o mais velho", () => {
    const velho = ev({ id: "a", status: "pendente", criado_em: "2026-10-02T10:00:00Z" });
    const outro = ev({ id: "b", criado_em: "2026-10-02T09:00:00Z" });
    const atualizado = { ...velho, status: "enviado" as const };
    const novo = ev({ id: "c", criado_em: "2026-10-02T11:00:00Z" });
    const r = juntarEventos([velho, outro], [novo, atualizado]);
    expect(r.map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(r[1].status).toBe("enviado");
  });

  it("corta no teto pelo fim (os mais velhos saem)", () => {
    const lista = [1, 2, 3].map((i) => ev({ id: `e${i}`, criado_em: `2026-10-02T1${i}:00:00Z` }));
    expect(juntarEventos([], lista, 2).map((e) => e.id)).toEqual(["e3", "e2"]);
  });

  it("so pisca o id que nao estava na lista", () => {
    const a = ev({ id: "a" });
    expect(idsNovos([a], [a, ev({ id: "b" })])).toEqual(["b"]);
  });
});

describe("hora e dia no fuso", () => {
  it("formata no fuso pedido, nao no do servidor", () => {
    // 17:32:05 UTC = 14:32:05 em Sao Paulo
    expect(horaDoEvento("2026-10-02T17:32:05Z", SP)).toBe("14:32:05");
    expect(dataHoraCompleta("2026-10-02T17:32:05Z", SP)).toBe("02/10/2026 às 14:32:05");
  });

  it("hoje nao mostra data; ontem e outros dias mostram", () => {
    expect(rotuloDia("2026-10-02T17:00:00Z", "2026-10-02", SP)).toBe("");
    expect(rotuloDia("2026-10-02T02:58:10Z", "2026-10-02", SP)).toBe("01/10 · ontem");
    expect(rotuloDia("2026-09-28T15:00:00Z", "2026-10-02", SP)).toBe("28/09");
  });

  it("fuso invalido nao lanca", () => {
    expect(horaDoEvento("2026-10-02T17:32:05Z", "Lugar/Nenhum")).toBe("14:32:05");
    expect(horaDoEvento("lixo", SP)).toBe("—");
  });
});

describe("colunas", () => {
  it("latencia so no enviado, sem precisao inventada", () => {
    expect(formatarLatencia({ status: "enviado", latencia_s: 0.4 })).toBe("0,4 s");
    expect(formatarLatencia({ status: "enviado", latencia_s: 42 })).toBe("42 s");
    expect(formatarLatencia({ status: "enviado", latencia_s: 125 })).toBe("2 min");
    expect(formatarLatencia({ status: "enviado", latencia_s: 3900 })).toBe("1 h 5 min");
    expect(formatarLatencia({ status: "pendente", latencia_s: 3 })).toBe("—");
    expect(formatarLatencia({ status: "enviado", latencia_s: null })).toBe("—");
  });

  it("clique: sim, nao ou sem dado; na compra o nao explica a consequencia", () => {
    expect(textoClique({ com_clique: true })).toBe("Sim");
    expect(textoClique({ com_clique: false })).toBe("Não");
    expect(textoClique({ com_clique: null })).toBe("—");
    expect(detalheClique({ com_clique: false, plataforma: "meta", evento: "Purchase" })).toMatch(
      /sem ligação com um anúncio/
    );
    expect(detalheClique({ com_clique: false, plataforma: "meta", evento: "view_item" })).toBe("Não");
    expect(detalheClique({ com_clique: true, plataforma: "meta", evento: "view_item" })).toMatch(/fbc/);
  });

  it("origem completa, com a UTM decodificada", () => {
    expect(
      textoOrigem({ origem_host: "instagram.com", utm_source: "ig", utm_campaign: "lumin%C3%A1rias+abo" })
    ).toBe("instagram.com · ig · luminárias abo");
    expect(textoOrigem({ origem_host: null, utm_source: null, utm_campaign: null })).toBe("—");
  });

  it("link do pedido so com id numerico", () => {
    expect(urlDoPedido("loja.myshopify.com", "5891234567890")).toBe(
      "https://loja.myshopify.com/admin/orders/5891234567890"
    );
    expect(urlDoPedido("loja.myshopify.com", "../x")).toBeNull();
    expect(urlDoPedido("", "123")).toBeNull();
  });

  it("erro em palavras: enviado nao tem erro, falha traz a mensagem gravada", () => {
    expect(explicarErro({ status: "enviado", erro: "sem fbc: ...", plataforma: "meta", tentativas: 1 })).toBeNull();
    const f = explicarErro({ status: "falhou", erro: "Invalid OAuth token", plataforma: "meta", tentativas: 8 });
    expect(f?.resumo).toBe("Meta recusou o evento depois de 8 tentativas.");
    expect(f?.mensagem).toBe("Invalid OAuth token");
    expect(explicarErro({ status: "falhou", erro: "destino removido", plataforma: "google", tentativas: 1 })?.mensagem).toBeNull();
    expect(explicarErro({ status: "pendente", erro: null, plataforma: "meta", tentativas: 0 })).toBeNull();
    expect(explicarErro({ status: "pendente", erro: "timeout", plataforma: "meta", tentativas: 2 })?.resumo).toMatch(
      /tenta de novo/
    );
  });
});

describe("filtros", () => {
  const linhas = [
    ev({ id: "1", status: "falhou", plataforma: "meta", evento: "Purchase", fonte: "webhook", utm_campaign: "abo" }),
    ev({ id: "2", status: "enviado", plataforma: "google", destino_id: "d2", destino_nome: "AW-1", evento: "purchase", fonte: "webhook" }),
    ev({ id: "3", status: "enviado", plataforma: "meta", evento: "add_to_cart" }),
    ev({ id: "4", status: "pendente", plataforma: "meta", evento: "view_item", destino_id: null }),
  ];

  it("E entre dimensoes, OU dentro de uma", () => {
    let f = alternarValor(filtroVazio(), "evento", "purchase");
    expect(linhas.filter((e) => passa(e, f)).map((e) => e.id)).toEqual(["1", "2"]);
    f = alternarValor(f, "plataforma", "meta");
    expect(linhas.filter((e) => passa(e, f)).map((e) => e.id)).toEqual(["1"]);
    f = alternarValor(f, "plataforma", "google");
    expect(linhas.filter((e) => passa(e, f)).map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("campanha e destino vazios tem valor proprio", () => {
    const f = { ...filtroVazio(), campanha: [NENHUM] };
    expect(linhas.filter((e) => passa(e, f)).map((e) => e.id)).toEqual(["2", "3", "4"]);
    const g = { ...filtroVazio(), destino: [NENHUM] };
    expect(linhas.filter((e) => passa(e, g)).map((e) => e.id)).toEqual(["4"]);
  });

  it("contadores contam as linhas carregadas, sem filtro", () => {
    expect(contarStatus(linhas)).toEqual({ enviado: 2, pendente: 1, falhou: 1 });
  });

  it("a opcao conta o que traria dado o RESTO do filtro", () => {
    const f = { ...filtroVazio(), plataforma: ["meta"], status: ["falhou"] };
    const status = opcoesDe("status", linhas, f);
    expect(status.map((o) => [o.valor, o.n, o.marcada])).toEqual([
      ["enviado", 1, false],
      ["pendente", 1, false],
      ["falhou", 1, true],
    ]);
    const eventos = opcoesDe("evento", linhas, filtroVazio()).map((o) => o.valor);
    // ordem do catalogo, e "Purchase" normalizado junto de "purchase"
    expect(eventos).toEqual(["view_item", "add_to_cart", "purchase"]);
  });

  it("valor marcado que nao aparece nas linhas continua na lista para desmarcar", () => {
    const f = { ...filtroVazio(), destino: ["sumiu"] };
    const op = opcoesDe("destino", linhas, f);
    expect(op.find((o) => o.valor === "sumiu")).toMatchObject({ marcada: true, n: 0 });
    expect(op[op.length - 1].valor).toBe("sumiu");
  });

  it("rotulo do chip", () => {
    expect(rotuloChip("status", filtroVazio(), linhas)).toBe("+ Status");
    expect(rotuloChip("status", { ...filtroVazio(), status: ["falhou", "pendente"] }, linhas)).toBe(
      "Status: Falhou, Na fila"
    );
    expect(rotuloChip("destino", { ...filtroVazio(), destino: ["d2"] }, linhas)).toBe("Destino: Google · AW-1");
  });

  it("igualdade ignora a ordem", () => {
    const a = { ...filtroVazio(), status: ["falhou", "pendente"] };
    const b = { ...filtroVazio(), status: ["pendente", "falhou"] };
    expect(filtrosIguais(a, b)).toBe(true);
    expect(temFiltro(filtroVazio())).toBe(false);
  });
});

describe("URL", () => {
  it("ida e volta, com valor repetido e texto livre", () => {
    const f = { ...filtroVazio(), status: ["falhou"], campanha: ["a,b", "c d"] };
    const q = filtroParaQuery(f);
    expect(filtrosIguais(filtroDaUrl(new URLSearchParams(q)), f)).toBe(true);
  });

  it("lixo some e evento vira chave do catalogo", () => {
    const f = filtroDaUrl({ status: ["falhou", "inventado"], fonte: "lugar", evento: "Purchase" });
    expect(f.status).toEqual(["falhou"]);
    expect(f.fonte).toEqual([]);
    expect(f.evento).toEqual(["purchase"]);
  });
});

describe("visoes", () => {
  it("o filtro escolhe a visao; sem casar, e o filtro atual", () => {
    expect(visaoAtiva(filtroVazio(), [])).toBe("todos");
    expect(visaoAtiva({ ...filtroVazio(), status: ["falhou"] }, [])).toBe("falhas");
    const salva = { id: "v1", nome: "Meta", filtro: { ...filtroVazio(), plataforma: ["meta"] } };
    expect(visaoAtiva({ ...filtroVazio(), plataforma: ["meta"] }, [salva])).toBe("v1");
    expect(visaoAtiva({ ...filtroVazio(), plataforma: ["google"] }, [salva])).toBe(VISAO_ATUAL);
  });

  it("le o localStorage sem confiar nele", () => {
    expect(lerVisoesSalvas(null)).toEqual([]);
    expect(lerVisoesSalvas("{quebrado")).toEqual([]);
    const texto = JSON.stringify([
      { id: "v1", nome: "  Falhas Meta  ", filtro: { status: ["falhou"], plataforma: ["meta"] } },
      { id: "v1", nome: "repetida", filtro: { status: ["falhou"] } },
      { id: "todos", nome: "fixa", filtro: { status: ["falhou"] } },
      { id: "v2", nome: "vazia", filtro: {} },
      { id: "v3", nome: "", filtro: { status: ["falhou"] } },
      "lixo",
    ]);
    const r = lerVisoesSalvas(texto);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "v1", nome: "Falhas Meta" });
    expect(r[0].filtro.status).toEqual(["falhou"]);
  });
});

describe("CSV", () => {
  it("campo com formula vira texto; separador e aspas sao escapados", () => {
    expect(campoCsv("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(campoCsv("+55")).toBe("'+55");
    expect(campoCsv("a;b")).toBe('"a;b"');
    expect(campoCsv("normal")).toBe("normal");
  });

  it("so as colunas da tabela, no fuso, com o nome do pedido", () => {
    const csv = montarCsv(
      [
        ev({
          id: "1",
          evento: "Purchase",
          fonte: "webhook",
          latencia_s: 1.26,
          enviado_em: "2026-10-02T17:32:06.000Z",
          com_clique: true,
          origem_host: "google.com",
          utm_campaign: "=cmd",
          pedido: "5891",
        }),
      ],
      { fuso: SP, nomeLoja: () => "Lumen", nomePedido: () => "#1040" }
    );
    const [cabecalho, linha] = csv.trim().split("\r\n");
    expect(cabecalho).toBe(
      "Data e hora;Loja;Evento;Veio de;Plataforma;Destino;Status;Latência (s);Clique;Teste;Origem;Pedido"
    );
    expect(linha).toBe(
      "02/10/2026 14:32:05;Lumen;Compra;Webhook de pedido;Meta;Pixel Lumen;Enviado;1,3;Sim;;google.com · =cmd;#1040"
    );
    expect(csv).not.toMatch(/ip|user.?agent/i);
  });

  it("o teste sai marcado na coluna Teste", () => {
    const csv = montarCsv([{ ...ev({ id: "1" }), teste: true } as EventoFeed], {
      fuso: SP,
      nomeLoja: () => "Lumen",
      nomePedido: () => "",
    });
    expect(csv.trim().split("\r\n")[1].split(";")[9]).toBe("Sim");
  });

  it("linha fechada sem envio sai como Não enviado, igual ao selo", () => {
    const csv = montarCsv([ev({ id: "1", enviado_em: null })], {
      fuso: SP,
      nomeLoja: () => "Lumen",
      nomePedido: () => "",
    });
    expect(csv.trim().split("\r\n")[1].split(";")[6]).toBe("Não enviado");
  });
});

describe("teste e clique", () => {
  it("teste so com o campo do feed verdadeiro; sem o campo, nunca afirma", () => {
    expect(ehTeste({ ...ev({ id: "1" }), teste: true } as EventoFeed)).toBe(true);
    expect(ehTeste({ ...ev({ id: "1" }), teste: false } as EventoFeed)).toBe(false);
    // Feed antigo, sem a 055: a linha fica sem selo, nao some.
    expect(ehTeste(ev({ id: "1" }))).toBe(false);
  });

  it("filtra por clique, e o teste continua na lista", () => {
    const linhas = [
      { ...ev({ id: "a", com_clique: true }), teste: true } as EventoFeed,
      ev({ id: "b", com_clique: true }),
      ev({ id: "c", com_clique: false }),
      ev({ id: "d", com_clique: null, plataforma: "outro" }),
    ];
    const com = { ...filtroVazio(), clique: ["sim"] };
    expect(linhas.filter((e) => passa(e, com)).map((e) => e.id)).toEqual(["a", "b"]);
    const sem = { ...filtroVazio(), clique: ["nao"] };
    expect(linhas.filter((e) => passa(e, sem)).map((e) => e.id)).toEqual(["c"]);
    expect(opcoesDe("clique", linhas, filtroVazio()).map((o) => [o.rotulo, o.n])).toEqual([
      ["Com clique", 2],
      ["Sem clique", 1],
      ["Não se aplica", 1],
    ]);
  });

  it("o clique vem da URL e volta para ela; valor inventado e ignorado", () => {
    const f = filtroDaUrl({ clique: ["sim", "talvez"] });
    expect(f.clique).toEqual(["sim"]);
    expect(filtroParaQuery(f)).toBe("clique=sim");
  });
});

describe("selo do status", () => {
  it("enviado sem enviado_em e a fila fechando sem mandar: nem envio, nem falha", () => {
    expect(seloDoStatus(ev({ id: "1", enviado_em: null }))).toEqual({ tom: "neutral", rotulo: "Não enviado" });
    expect(seloDoStatus(ev({ id: "2", enviado_em: "2026-10-02T17:32:06.000Z" })).rotulo).toBe("Enviado");
    expect(seloDoStatus(ev({ id: "3", status: "falhou" })).rotulo).toBe("Falhou");
    expect(seloDoStatus(ev({ id: "4", status: "pendente" })).rotulo).toBe("Na fila");
  });
});
