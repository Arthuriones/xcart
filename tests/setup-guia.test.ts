import { describe, expect, it } from "vitest";
import {
  caminhoDoGuia,
  listarNomes,
  montarGuia,
  porcentagem,
  quandoNaFrase,
  resumoDoFluxo,
  type FotoGuia,
  type IdPasso,
} from "@/lib/leitura/guia-passos";

// 03/10/2026 15:00 em Sao Paulo.
const AGORA = new Date("2026-10-03T18:00:00Z");

const VAZIA: FotoGuia = {
  lojas: [],
  rastreamentoLigado: [],
  destinos: [],
  contas: [],
  custos: { comTaxa: [], comCusto: [] },
  ultimaVenda: { em: null, plataforma: null },
  rotas: [],
  destinosComSku: 0,
  scriptVisto: { em: null },
  carrinhoRoteado: { em: null },
};

/** A conta do Arthur: duas lojas ativas, uma desinstalada, sem vitrine. */
const ARTHUR: FotoGuia = {
  ...VAZIA,
  lojas: [
    { id: "lash", nome: "Lash Bestie", semAcesso: false },
    { id: "soft", nome: "Softnook", semAcesso: false },
    { id: "goto", nome: "Gotoku", semAcesso: true },
  ],
  rastreamentoLigado: ["lash"],
  destinos: [
    { storeId: "lash", plataforma: "meta", ativo: true, recebeCompra: true, modoTeste: false },
    { storeId: "lash", plataforma: "google", ativo: true, recebeCompra: true, modoTeste: false },
  ],
  contas: [
    { plataforma: "meta", storeId: "lash", ativo: true, comErro: false },
    { plataforma: "google", storeId: null, ativo: true, comErro: false },
  ],
  custos: { comTaxa: ["lash"], comCusto: ["lash", "soft"] },
  ultimaVenda: { em: "2026-10-03T17:28:00Z", plataforma: "meta" },
};

function passo(foto: FotoGuia, id: IdPasso, caminho: "direto" | "vitrine" = "direto") {
  const p = montarGuia(foto, caminho, AGORA).passos.find((x) => x.id === id);
  if (!p) throw new Error(`passo ${id} nao existe no caminho ${caminho}`);
  return p;
}

describe("caminhoDoGuia", () => {
  it("a URL vence o cookie, e o cookie vence a conta", () => {
    expect(caminhoDoGuia("vitrine", "direto", false)).toBe("vitrine");
    expect(caminhoDoGuia(null, "vitrine", false)).toBe("vitrine");
    expect(caminhoDoGuia("qualquer", "direto", true)).toBe("direto");
  });

  it("sem escolha, quem tem rota cai no caminho com vitrine", () => {
    expect(caminhoDoGuia(null, null, true)).toBe("vitrine");
    expect(caminhoDoGuia(undefined, "", false)).toBe("direto");
  });
});

describe("caminho direto", () => {
  it("conta nova: cinco passos, nada feito, o proximo e conectar a loja", () => {
    const g = montarGuia(VAZIA, "direto", AGORA);
    expect(g.passos.map((p) => p.id)).toEqual(["loja", "rastreamento", "contas", "custos", "venda"]);
    expect(g.feitos).toBe(0);
    expect(g.total).toBe(5);
    expect(g.completo).toBe(false);
    expect(g.proximo?.id).toBe("loja");
    expect(g.proximo?.href).toBe("/stores?conectar=1");
    expect(passo(VAZIA, "venda").detalhe).toBe("Depois de ligar o rastreamento.");
  });

  it("a operacao do Arthur fica completa, sem exigir vitrine", () => {
    const g = montarGuia(ARTHUR, "direto", AGORA);
    expect(g.passos.every((p) => p.estado === "feito")).toBe(true);
    expect(g.completo).toBe(true);
    expect(g.proximo).toBeNull();
    expect(porcentagem(g)).toBe(100);

    expect(passo(ARTHUR, "loja").detalhe).toBe("Lash Bestie e Softnook conectadas.");
    expect(passo(ARTHUR, "rastreamento").detalhe).toBe("Ligado em Lash Bestie: Meta e Google.");
    expect(passo(ARTHUR, "contas").detalhe).toBe("1 conta ligada (Meta). 1 conta está sem loja.");
    expect(passo(ARTHUR, "custos").detalhe).toBe("Completo em 1 de 2 lojas. Falta em Softnook.");
    expect(passo(ARTHUR, "venda").detalhe).toBe("Última compra enviada ao Meta hoje, 14:28.");
  });

  it("todo passo tem um botao, inclusive o feito (revisitavel)", () => {
    for (const p of montarGuia(ARTHUR, "direto", AGORA).passos) {
      expect(p.href).toMatch(/^\//);
      expect(p.cta.length).toBeGreaterThan(0);
    }
  });

  it("so lojas sem acesso: conectar loja pede atencao, nao 'feito'", () => {
    const foto = { ...VAZIA, lojas: [{ id: "a", nome: "A", semAcesso: true }] };
    const p = passo(foto, "loja");
    expect(p.estado).toBe("atencao");
    expect(p.cta).toBe("Reconectar loja");
  });

  it("rastreamento ligado em loja desinstalada nao conta", () => {
    const foto = { ...ARTHUR, rastreamentoLigado: ["goto"], destinos: [{ ...ARTHUR.destinos![0], storeId: "goto" }] };
    expect(passo(foto, "rastreamento").estado).toBe("falta");
  });

  it("Meta em modo teste nao conta como pronto", () => {
    const foto = {
      ...ARTHUR,
      destinos: [{ storeId: "lash", plataforma: "meta" as const, ativo: true, recebeCompra: true, modoTeste: true }],
    };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toMatch(/modo teste/);
  });

  it("ligado sem nenhum destino que receba a compra pede atencao", () => {
    const foto = {
      ...ARTHUR,
      destinos: [{ storeId: "lash", plataforma: "google" as const, ativo: true, recebeCompra: false, modoTeste: false }],
    };
    expect(passo(foto, "rastreamento").estado).toBe("atencao");
  });

  it("Google sem o pixel do checkout nao conta como pronto", () => {
    const google = { storeId: "lash", plataforma: "google" as const, ativo: true, recebeCompra: true, modoTeste: false };
    const semPixel = { ...ARTHUR, destinos: [google], pixelCheckoutVisto: [] };
    const p = passo(semPixel, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toMatch(/pixel do checkout/);
    expect(passo({ ...semPixel, pixelCheckoutVisto: ["lash"] }, "rastreamento").estado).toBe("feito");
    // O Meta sai pelo servidor: nao depende do pixel.
    expect(passo({ ...ARTHUR, pixelCheckoutVisto: [] }, "rastreamento").estado).toBe("feito");
  });

  it("destino cadastrado com o interruptor desligado pede atencao", () => {
    const foto = { ...ARTHUR, rastreamentoLigado: [] };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.cta).toBe("Ligar o rastreamento");
  });

  it("contas so sem loja: o gasto nao entra, atencao", () => {
    const foto = { ...VAZIA, contas: [{ plataforma: "meta" as const, storeId: null, ativo: true, comErro: false }] };
    const p = passo(foto, "contas");
    expect(p.estado).toBe("atencao");
    expect(p.cta).toBe("Ligar à loja");
  });

  it("conta pausada nao conta como ligada", () => {
    const foto = { ...VAZIA, contas: [{ plataforma: "meta" as const, storeId: "x", ativo: false, comErro: false }] };
    expect(passo(foto, "contas").estado).toBe("falta");
  });

  it("todas as contas ligadas com erro: atencao", () => {
    const foto = { ...VAZIA, contas: [{ plataforma: "google" as const, storeId: "x", ativo: true, comErro: true }] };
    expect(passo(foto, "contas").estado).toBe("atencao");
  });

  it("so a taxa ou so o custo: atencao, com o que falta", () => {
    const soTaxa = { ...ARTHUR, custos: { comTaxa: ["lash"], comCusto: [] } };
    expect(passo(soTaxa, "custos").estado).toBe("atencao");
    expect(passo(soTaxa, "custos").detalhe).toMatch(/falta o custo/);
    const soCusto = { ...ARTHUR, custos: { comTaxa: [], comCusto: ["soft"] } };
    expect(passo(soCusto, "custos").cta).toBe("Configurar taxa");
  });

  it("rastreamento pronto e nenhuma venda ainda: aguardando, nao falta", () => {
    const foto = { ...ARTHUR, ultimaVenda: { em: null, plataforma: null } };
    const g = montarGuia(foto, "direto", AGORA);
    expect(passo(foto, "venda").estado).toBe("aguardando");
    expect(g.completo).toBe(false);
    expect(g.proximo?.id).toBe("venda");
  });
});

describe("leitura que falhou", () => {
  it("vira 'nao conferido': nao conta como feito nem vira o proximo", () => {
    const foto: FotoGuia = { ...ARTHUR, lojas: null };
    const g = montarGuia(foto, "direto", AGORA);
    expect(passo(foto, "loja").estado).toBe("naoConferido");
    expect(passo(foto, "rastreamento").estado).toBe("naoConferido");
    expect(passo(foto, "custos").estado).toBe("naoConferido");
    expect(g.naoConferidos).toBe(3);
    // contas e venda nao dependem das lojas e continuam feitas
    expect(g.feitos).toBe(2);
    expect(g.completo).toBe(false);
    expect(g.proximo).toBeNull();
  });

  it("cada parte falha sozinha", () => {
    expect(passo({ ...ARTHUR, contas: null }, "contas").estado).toBe("naoConferido");
    expect(passo({ ...ARTHUR, ultimaVenda: null }, "venda").estado).toBe("naoConferido");
    expect(passo({ ...ARTHUR, destinos: null }, "rastreamento").estado).toBe("naoConferido");
    expect(passo({ ...ARTHUR, destinosComSku: null }, "skus", "vitrine").estado).toBe("naoConferido");
    expect(passo({ ...ARTHUR, scriptVisto: null }, "script", "vitrine").estado).toBe("naoConferido");
  });
});

describe("caminho com vitrine", () => {
  const COM_ROTA: FotoGuia = {
    ...ARTHUR,
    rotas: [
      // Rota velha que aponta para a propria vitrine: nao monta nada.
      { id: "r1", ligada: true, vitrineId: "soft", destinos: [{ lojaId: "soft", ativo: true, peso: 1 }] },
      // A segunda rota e a que vale -- o status antigo so olhava a primeira.
      { id: "r2", ligada: false, vitrineId: "soft", destinos: [{ lojaId: "lash", ativo: true, peso: 2 }] },
    ],
    destinosComSku: 1,
    scriptVisto: { em: "2026-10-02T12:12:00Z" },
    carrinhoRoteado: { em: null },
  };

  it("os passos da rota vem antes dos quatro do fim", () => {
    const g = montarGuia(COM_ROTA, "vitrine", AGORA);
    expect(g.passos.map((p) => p.id)).toEqual([
      "lojas",
      "rota",
      "skus",
      "divisao",
      "script",
      "teste",
      "rastreamento",
      "contas",
      "custos",
      "venda",
    ]);
    expect(g.total).toBe(10);
  });

  it("papel sai da rota: vitrine e checkout pelos nomes, olhando todas as rotas", () => {
    const p = passo(COM_ROTA, "rota", "vitrine");
    expect(p.estado).toBe("feito");
    expect(p.detalhe).toBe("Vitrine Softnook, checkout em Lash Bestie.");
  });

  it("rota que so aponta para a propria vitrine nao conta", () => {
    const foto = { ...COM_ROTA, rotas: [COM_ROTA.rotas![0]] };
    expect(passo(foto, "rota", "vitrine").estado).toBe("falta");
  });

  it("divisao pronta com a rota desligada pede atencao", () => {
    const p = passo(COM_ROTA, "divisao", "vitrine");
    expect(p.estado).toBe("atencao");
    expect(p.cta).toBe("Ligar a rota");
  });

  it("script visto e teste ainda nao feito, com o como testar", () => {
    expect(passo(COM_ROTA, "script", "vitrine").detalhe).toBe(
      "A vitrine carregou o script pela última vez ontem, 09:12."
    );
    const teste = passo(COM_ROTA, "teste", "vitrine");
    expect(teste.estado).toBe("falta");
    expect(teste.como?.length).toBe(3);
  });

  it("uma loja so: falta a outra", () => {
    const foto = { ...VAZIA, lojas: [{ id: "a", nome: "Alpha", semAcesso: false }] };
    const p = passo(foto, "lojas", "vitrine");
    expect(p.estado).toBe("falta");
    expect(p.detalhe).toBe("Alpha conectada; falta a outra loja.");
  });

  it("a compra com vitrine avisa que chega sem a origem do anuncio", () => {
    expect(passo(COM_ROTA, "venda", "vitrine").texto).toMatch(/sem a origem do anúncio/);
  });

  it("resumo do fluxo: vitrines, checkouts e se a rota esta no ar", () => {
    expect(resumoDoFluxo(COM_ROTA)).toEqual({
      lojas: ["Lash Bestie", "Softnook"],
      vitrines: ["Softnook"],
      checkouts: ["Lash Bestie"],
      rotaNoAr: false,
    });
    const noAr = { ...COM_ROTA, rotas: [{ ...COM_ROTA.rotas![1], ligada: true }] };
    expect(resumoDoFluxo(noAr).rotaNoAr).toBe(true);
    expect(resumoDoFluxo({ ...COM_ROTA, rotas: null }).vitrines).toBeNull();
  });
});

describe("textos", () => {
  it("listarNomes junta sem repetir e resume os demais", () => {
    expect(listarNomes([])).toBe("");
    expect(listarNomes(["A"])).toBe("A");
    expect(listarNomes(["A", "B", "A"])).toBe("A e B");
    expect(listarNomes(["A", "B", "C"])).toBe("A, B e C");
    expect(listarNomes(["A", "B", "C", "D", "E"])).toBe("A, B e mais 3");
  });

  it("quandoNaFrase: hoje e ontem sem 'em', outro dia com 'em'", () => {
    expect(quandoNaFrase("2026-10-03T17:28:00Z", AGORA)).toBe("hoje, 14:28");
    expect(quandoNaFrase("2026-10-02T12:12:00Z", AGORA)).toBe("ontem, 09:12");
    expect(quandoNaFrase("2026-09-12T17:28:00Z", AGORA)).toBe("em 12/09, 14:28");
    expect(quandoNaFrase(null, AGORA)).toBeNull();
  });

  it("nenhum texto com plural '(s)'", () => {
    const todos = [
      ...montarGuia(VAZIA, "direto", AGORA).passos,
      ...montarGuia(ARTHUR, "vitrine", AGORA).passos,
    ];
    for (const p of todos) {
      expect(`${p.titulo} ${p.texto} ${p.detalhe ?? ""} ${p.cta}`).not.toMatch(/\(s\)/);
    }
  });
});
