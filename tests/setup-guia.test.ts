import { describe, expect, it } from "vitest";
import {
  caminhoDoGuia,
  listarNomes,
  montarGuia,
  porcentagem,
  PROXIMOS_DEPOIS_DA_LOJA,
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
  pixelCheckoutVisto: [],
  scriptNoTema: {},
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
  pixelCheckoutVisto: ["lash"],
  scriptNoTema: { lash: true },
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

  it("so fica feito com destino pronto, script no tema e pixel do checkout", () => {
    expect(passo(ARTHUR, "rastreamento").estado).toBe("feito");

    // Sem o pixel do checkout: nem o Meta conta, e o link vai direto para a loja.
    const semPixel = passo({ ...ARTHUR, pixelCheckoutVisto: [] }, "rastreamento");
    expect(semPixel.estado).toBe("atencao");
    expect(semPixel.detalhe).toBe("Lash Bestie: falta o pixel do checkout.");
    expect(semPixel.href).toBe("/tracking?loja=lash");
    expect(semPixel.cta).toBe("Instalar o pixel");

    // Sem o script no tema.
    const semScript = passo({ ...ARTHUR, scriptNoTema: { lash: false } }, "rastreamento");
    expect(semScript.estado).toBe("atencao");
    expect(semScript.detalhe).toBe("Lash Bestie: falta o script no tema.");
    expect(semScript.href).toBe("/tracking?loja=lash");
    expect(semScript.cta).toBe("Instalar o script");

    // Os dois: uma frase so, na ordem de instalar.
    const semNada = passo({ ...ARTHUR, scriptNoTema: { lash: false }, pixelCheckoutVisto: [] }, "rastreamento");
    expect(semNada.detalhe).toBe("Lash Bestie: falta o script no tema e o pixel do checkout.");
    expect(semNada.cta).toBe("Instalar o script");
  });

  it("Google sem o pixel do checkout nao conta como pronto", () => {
    const google = { storeId: "lash", plataforma: "google" as const, ativo: true, recebeCompra: true, modoTeste: false };
    const semPixel = { ...ARTHUR, destinos: [google], pixelCheckoutVisto: [] };
    const p = passo(semPixel, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toMatch(/pixel do checkout/);
    expect(passo({ ...semPixel, pixelCheckoutVisto: ["lash"] }, "rastreamento").estado).toBe("feito");
  });

  it("script que nao deu para conferir: nao conferido, nunca feito nem falta", () => {
    const semResposta: FotoGuia["scriptNoTema"][] = [null, {}, { lash: null }];
    for (const scriptNoTema of semResposta) {
      const p = passo({ ...ARTHUR, scriptNoTema }, "rastreamento");
      expect(p.estado).toBe("naoConferido");
      expect(p.detalhe).toBe("Não deu para conferir o script no tema de Lash Bestie agora.");
      expect(p.href).toBe("/tracking?loja=lash");
    }
    // O que deu para conferir e falta continua aparecendo.
    const p = passo({ ...ARTHUR, scriptNoTema: null, pixelCheckoutVisto: [] }, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toBe("Lash Bestie: falta o pixel do checkout.");
  });

  it("uma loja pronta basta, mesmo com outra pela metade", () => {
    const foto = {
      ...ARTHUR,
      rastreamentoLigado: ["lash", "soft"],
      destinos: [...ARTHUR.destinos!, { storeId: "soft", plataforma: "tiktok" as const, ativo: true, recebeCompra: true, modoTeste: false }],
      scriptNoTema: { lash: true, soft: false },
    };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("feito");
    expect(p.detalhe).toBe("Ligado em Lash Bestie: Meta e Google.");
  });

  it("sem loja pronta, aponta a mais perto de pronta", () => {
    const foto = {
      ...ARTHUR,
      rastreamentoLigado: ["lash", "soft"],
      destinos: [{ storeId: "soft", plataforma: "meta" as const, ativo: true, recebeCompra: true, modoTeste: false }],
      scriptNoTema: { lash: false, soft: true },
      pixelCheckoutVisto: [],
    };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toBe("Softnook: falta o pixel do checkout.");
    expect(p.href).toBe("/tracking?loja=soft");
  });

  it("destino cadastrado com o interruptor desligado pede atencao", () => {
    const foto = { ...ARTHUR, rastreamentoLigado: [] };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.cta).toBe("Ligar o rastreamento");
    expect(p.href).toBe("/tracking?loja=lash");
  });

  it("ligado sem destino que receba a compra diz o que falta, na loja", () => {
    const foto = { ...ARTHUR, destinos: [], scriptNoTema: { lash: false } };
    const p = passo(foto, "rastreamento");
    expect(p.estado).toBe("atencao");
    expect(p.detalhe).toBe("Lash Bestie: falta um pixel do Meta/TikTok ou a conversão do Google e o script no tema.");
    expect(p.cta).toBe("Configurar rastreamento");
    expect(p.href).toBe("/tracking?loja=lash");
  });

  it("primeira venda: so Meta e TikTok, sem citar o Google, com o link de Eventos ao vivo", () => {
    for (const caminho of ["direto", "vitrine"] as const) {
      const p = passo(ARTHUR, "venda", caminho);
      expect(p.texto).toMatch(/Meta ou ao TikTok/);
      expect(`${p.texto} ${p.detalhe}`).not.toMatch(/Google/);
      expect(p.href).toBe("/tracking/eventos");
    }
    // Pronto so pelo Google (tag): nada vai aparecer em Eventos ao vivo.
    const google = { storeId: "lash", plataforma: "google" as const, ativo: true, recebeCompra: true, modoTeste: false };
    const soGoogle = { ...ARTHUR, destinos: [google], ultimaVenda: { em: null, plataforma: null } };
    expect(passo(soGoogle, "rastreamento").estado).toBe("feito");
    const v = passo(soGoogle, "venda");
    expect(v.estado).toBe("falta");
    expect(v.detalhe).not.toMatch(/Google/);
  });

  it("aviso de loja conectada: rastreamento primeiro", () => {
    expect(PROXIMOS_DEPOIS_DA_LOJA.map((p) => p.href)).toEqual([
      "/tracking",
      "/financeiro/anuncios",
      "/financeiro/custos",
    ]);
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
