import { describe, expect, it } from "vitest";
import {
  CORTE_LANDING,
  JANELA_ORIGEM_MS,
  PARAMETROS_URL,
  caminhoDeEntrada,
  cliquesDosAtributos,
  idDe,
  instanteDe,
  limparValor,
  niveisDoAnuncio,
  nomeDe,
  nomesDaUtm,
  parametrosDaUrl,
  plataformaDe,
  utmDaPagina,
  utmDeParametros,
  utmDoCorpo,
  utmDosAtributos,
} from "../src/lib/tracking/utm";

// ============================================================================
// O parser das UTMs do anuncio. Os casos vem do que foi medido nas lojas do
// Arthur (10/2026): o Meta acrescenta sozinho os ids dos tres niveis, com o
// CONJUNTO em utm_term; a Utmify (e o nosso modelo) poe o conjunto em
// utm_medium, as vezes como "nome|id".
// ============================================================================

const META_AUTOMATICO =
  "/products/blanket?fbclid=IwZXh0bgNhZW0BMABhZGlkAasdf_aem_AbCdEfGhIjKlMnOpQrStUv&utm_medium=paid&utm_source=fb&utm_id=120252293723770706&utm_content=120252293729160706&utm_term=120252293728570706&utm_campaign=120252293723770706";

describe("valores", () => {
  it("id puro, nome|id e so nome", () => {
    expect(idDe("120252293723770706")).toBe("120252293723770706");
    expect(idDe("CBO cilios | escala|120252293723770706")).toBe("120252293723770706");
    expect(nomeDe("CBO cilios | escala|120252293723770706")).toBe("CBO cilios | escala");
    expect(idDe("Google Shopping")).toBeNull();
    expect(nomeDe("Google Shopping")).toBe("Google Shopping");
    expect(nomeDe("120252293723770706")).toBeNull();
    // Numero curto demais nao e id de anuncio.
    expect(idDe("2024")).toBeNull();
  });

  it("macro que a plataforma nao trocou vira nada", () => {
    for (const m of ["{{campaign.id}}", "{campaignid}", "__CAMPAIGN_ID__", "{{adset.name}}"]) {
      expect(limparValor(m), m).toBeNull();
      expect(idDe(m), m).toBeNull();
    }
  });

  it("valor com @ e descartado: UTM de e-mail nao vira dado pessoal guardado", () => {
    expect(limparValor("cliente@exemplo.com")).toBeNull();
    expect(utmDeParametros(new URLSearchParams("utm_source=klaviyo&utm_term=ana@x.com"))).toEqual({
      source: "klaviyo",
    });
  });

  it("corta em 200 e tira caractere de controle", () => {
    expect(limparValor("a".repeat(500))).toHaveLength(200);
    expect(limparValor("abc\u0000\n")).toBe("abc");
  });
});

describe("os dois formatos do Meta", () => {
  it("automatico do Meta: conjunto vem do utm_term", () => {
    const utm = utmDeParametros(parametrosDaUrl(META_AUTOMATICO));
    const plataforma = plataformaDe(utm);
    expect(plataforma).toBe("meta");
    expect(niveisDoAnuncio(utm, plataforma)).toEqual({
      campanha: "120252293723770706",
      conjunto: "120252293728570706",
      anuncio: "120252293729160706",
      posicionamento: null,
    });
  });

  it("formato Utmify: conjunto em utm_medium (nome|id), utm_term e posicionamento", () => {
    const utm = utmDeParametros(
      new URLSearchParams(
        "utm_source=FB&utm_campaign=CBO|111111&utm_medium=Conjunto 1|222222&utm_content=Anuncio A|333333&utm_term=Instagram_Reels"
      )
    );
    expect(niveisDoAnuncio(utm, plataformaDe(utm))).toEqual({
      campanha: "111111",
      conjunto: "222222",
      anuncio: "333333",
      posicionamento: "Instagram_Reels",
    });
    expect(nomesDaUtm(utm)).toEqual({ campanha: "CBO", conjunto: "Conjunto 1", anuncio: "Anuncio A" });
  });

  it("so com nome: guarda como veio, sem id; o meio 'paid' nao vira nome de conjunto", () => {
    const utm = utmDeParametros(new URLSearchParams("utm_source=ig&utm_medium=paid&utm_campaign=Escala+Cilios"));
    expect(niveisDoAnuncio(utm, "meta")).toMatchObject({ campanha: null, conjunto: null });
    expect(nomesDaUtm(utm)).toEqual({ campanha: "Escala Cilios", conjunto: null, anuncio: null });
  });

  it("chave repetida: vale a primeira (o modelo colado vem antes do automatico)", () => {
    const utm = utmDeParametros(new URLSearchParams("utm_medium=222222&utm_medium=paid"));
    expect(utm.medium).toBe("222222");
  });
});

describe("plataforma pela fonte e pelo click id", () => {
  it("fonte", () => {
    expect(plataformaDe({ source: "FB" })).toBe("meta");
    expect(plataformaDe({ source: "ig" })).toBe("meta");
    expect(plataformaDe({ source: "google" })).toBe("google");
    expect(plataformaDe({ source: "tiktok" })).toBe("tiktok");
    expect(plataformaDe({ source: "tt" })).toBe("tiktok");
    expect(plataformaDe({ source: "klaviyo" })).toBe("outra");
    expect(plataformaDe({})).toBeNull();
  });

  it("click id da propria visita vence a fonte", () => {
    expect(plataformaDe({ source: "facebook" }, { gclid: "Cj0K" })).toBe("google");
    expect(plataformaDe({}, { fbclid: "IwAR" })).toBe("meta");
    expect(plataformaDe({}, { gbraid: "x" })).toBe("google");
    expect(plataformaDe({}, { wbraid: "x" })).toBe("google");
    expect(plataformaDe({}, { ttclid: "E.C.P" })).toBe("tiktok");
  });

  it("Google sem modelo: a campanha vem do gad_campaignid", () => {
    const p = parametrosDaUrl("/?utm_source=google&utm_medium=cpc&utm_campaign=Google+Shopping&gad_campaignid=21234567890&gclid=Cj0");
    const utm = utmDeParametros(p);
    expect(plataformaDe(utm)).toBe("google");
    expect(niveisDoAnuncio(utm, "google")).toEqual({
      campanha: "21234567890",
      conjunto: null,
      anuncio: null,
      posicionamento: null,
    });
  });
});

describe("landing_site cortado em 255", () => {
  it("o ultimo parametro cortado sai (utm_source=i era o ig pela metade)", () => {
    const cortado = "/products/x?fbclid=" + "a".repeat(223) + "&utm_source=i";
    expect(cortado.length).toBe(255);
    expect(parametrosDaUrl(cortado, CORTE_LANDING).has("utm_source")).toBe(false);
    // Sem a regra (URL inteira da jornada), fica.
    expect(parametrosDaUrl(cortado).get("utm_source")).toBe("i");
  });

  it("URL curta nao perde nada; URL torta nao lanca", () => {
    expect(parametrosDaUrl("/?utm_campaign=123456", CORTE_LANDING).get("utm_campaign")).toBe("123456");
    expect(() => parametrosDaUrl("/?utm_source=%E0%A4%A", CORTE_LANDING)).not.toThrow();
  });
});

describe("os modelos de Parametros de URL", () => {
  // O que cada plataforma poe no lugar das macros.
  const trocar = (t: string) =>
    t
      .replace("{{campaign.id}}", "120200000000000001")
      .replace("{{adset.id}}", "120200000000000002")
      .replace("{{ad.id}}", "120200000000000003")
      .replace("{{placement}}", "Instagram_Stories")
      .replace("{campaignid}", "21000000001")
      .replace("{adgroupid}", "160000000002")
      .replace("{creative}", "700000000003")
      .replace("{keyword}", "cilios+postiços")
      .replace("__CAMPAIGN_ID__", "1800000000000001")
      .replace("__AID__", "1800000000000002")
      .replace("__CID__", "1800000000000003")
      .replace("__PLACEMENT__", "TikTok");

  it("o parser le cada nivel de cada modelo", () => {
    const esperado = {
      meta: ["meta", "120200000000000001", "120200000000000002", "120200000000000003", "Instagram_Stories"],
      google: ["google", "21000000001", "160000000002", "700000000003", "cilios postiços"],
      tiktok: ["tiktok", "1800000000000001", "1800000000000002", "1800000000000003", "TikTok"],
    } as const;
    for (const [plat, [p, c, g, a, pos]] of Object.entries(esperado)) {
      const utm = utmDeParametros(new URLSearchParams(trocar(PARAMETROS_URL[plat as keyof typeof PARAMETROS_URL])));
      const plataforma = plataformaDe(utm);
      expect(plataforma, plat).toBe(p);
      expect(niveisDoAnuncio(utm, plataforma), plat).toEqual({ campanha: c, conjunto: g, anuncio: a, posicionamento: pos });
    }
  });

  it("curtos: cabem no landing_site junto de um caminho de produto", () => {
    for (const t of Object.values(PARAMETROS_URL)) expect(t.length).toBeLessThan(140);
  });

  it("macro sem troca (preview do anuncio) nao vira id", () => {
    const utm = utmDeParametros(new URLSearchParams(PARAMETROS_URL.meta));
    expect(niveisDoAnuncio(utm, plataformaDe(utm))).toEqual({
      campanha: null,
      conjunto: null,
      anuncio: null,
      posicionamento: null,
    });
  });
});

describe("atributos do pedido: lista fechada", () => {
  const RELEASIT = [
    { name: "First name", value: "Ana" },
    { name: "Last name", value: "Souza" },
    { name: "Phone", value: "+420777123456" },
    { name: "Address", value: "Rua A, 10" },
    { name: "Email", value: "ana@exemplo.com" },
    { name: "IP address", value: "203.0.113.9" },
    { name: "rsi_currency_rate", value: "23.4" },
  ];

  it("nota do Releasit sem UTM: nada sai dela", () => {
    const r = utmDosAtributos(RELEASIT);
    expect(r).toEqual({ nosso: null, externo: null });
    expect(cliquesDosAtributos(RELEASIT)).toEqual({});
    // Nenhum valor pessoal em lugar nenhum do resultado.
    const texto = JSON.stringify([r, cliquesDosAtributos(RELEASIT)]);
    for (const a of RELEASIT) expect(texto).not.toContain(a.value);
  });

  it("UTM de app ('UTM Source', utm_campaign): externo, da sessao do pedido", () => {
    const r = utmDosAtributos([...RELEASIT, { name: "UTM Source", value: "fb" }, { name: "utm_campaign", value: "120200000000000001" }]);
    expect(r.externo).toEqual({ source: "fb", campaign: "120200000000000001" });
    expect(r.nosso).toBeNull();
  });

  it("os nossos (_xc_utm_*) so valem com a hora do clique", () => {
    const sem = utmDosAtributos([{ key: "_xc_utm_source", value: "fb" }]);
    expect(sem.nosso).toBeNull();
    const com = utmDosAtributos([
      { key: "_xc_utm_source", value: "fb" },
      { key: "_xc_utm_term", value: "120200000000000002" },
      { key: "_xc_utm_em", value: "1760000000000" },
    ]);
    expect(com.nosso).toEqual({
      utm: { source: "fb", term: "120200000000000002" },
      em: new Date(1760000000000).toISOString(),
    });
  });

  it("click ids e o _fbc", () => {
    expect(
      cliquesDosAtributos([
        { name: "_fbc", value: "fb.1.1760000000000.IwAR" },
        { name: "gclid", value: "Cj0" },
        { name: "_xc_vid", value: "abc.def" },
      ])
    ).toEqual({ fbc: "fb.1.1760000000000.IwAR", gclid: "Cj0" });
  });

  it("o conjunto do clique sem UTM: _xc_utm_clique e _xc_utm_gad, com a hora", () => {
    const r = utmDosAtributos([
      { key: "_xc_utm_clique", value: "google" },
      { key: "_xc_utm_gad", value: "21234567890" },
      { key: "_xc_utm_em", value: "1760000000000" },
    ]);
    expect(r.nosso).toEqual({ utm: { clique: "google", gad: "21234567890" }, em: new Date(1760000000000).toISOString() });
    // Plataforma estranha ou gad que nao e id nao entram; sem a hora, nada.
    expect(utmDosAtributos([{ key: "_xc_utm_clique", value: "bing" }, { key: "_xc_utm_em", value: "1760000000000" }]).nosso).toBeNull();
    expect(utmDosAtributos([{ key: "_xc_utm_clique", value: "google" }]).nosso).toBeNull();
  });

  it("instante em ms ou ISO; fora do razoavel e null", () => {
    expect(instanteDe("1760000000000")).toBe(new Date(1760000000000).toISOString());
    expect(instanteDe("2026-10-08T19:17:00Z")).toBe("2026-10-08T19:17:00.000Z");
    expect(instanteDe("12")).toBeNull();
    expect(instanteDe("ontem")).toBeNull();
  });
});

describe("o que o snippet manda ao coletor", () => {
  const AGORA = Date.parse("2026-10-10T12:00:00Z");

  it("UTMs do cookie com a hora do clique", () => {
    const em = AGORA - 2 * 864e5;
    expect(utmDoCorpo({ utm_source: "fb", utm_campaign: "120200000000000001", em }, AGORA)).toEqual({
      utm: { source: "fb", campaign: "120200000000000001" },
      em: new Date(em).toISOString(),
    });
  });

  it("hora adiantada vira agora; mais velha que a janela nao vale", () => {
    expect(utmDoCorpo({ utm_source: "fb", em: AGORA + 3 * 864e5 }, AGORA)?.em).toBe(new Date(AGORA).toISOString());
    expect(utmDoCorpo({ utm_source: "fb", em: AGORA - JANELA_ORIGEM_MS - 1 }, AGORA)).toBeNull();
  });

  it("lixo nao vira UTM; chave estranha e ignorada", () => {
    expect(utmDoCorpo("utm_source=fb", AGORA)).toBeNull();
    expect(utmDoCorpo({ email: "a@b.com", em: AGORA }, AGORA)).toBeNull();
    expect(utmDoCorpo({ utm_source: "x@y.com" }, AGORA)).toBeNull();
  });

  it("clique novo sem UTM (so o click id, com gad_campaignid): vale, e substitui a UTM guardada", () => {
    expect(utmDoCorpo({ clique: "google", gad_campaignid: "21234567890", em: AGORA - 1000 }, AGORA)).toEqual({
      utm: { clique: "google", gad: "21234567890" },
      em: new Date(AGORA - 1000).toISOString(),
    });
    expect(utmDoCorpo({ clique: "bing", em: AGORA }, AGORA)).toBeNull();
    expect(plataformaDe({ clique: "tiktok" })).toBe("tiktok");
  });

  it("snippet antigo: tira da URL da pagina", () => {
    expect(utmDaPagina(`https://loja.shop${META_AUTOMATICO}`, AGORA)?.utm.term).toBe("120252293728570706");
    expect(utmDaPagina("https://loja.shop/products/x", AGORA)).toBeNull();
  });

  it("URL da pagina cortada em 500: o ultimo parametro, pela metade, sai", () => {
    const inteira = `https://loja.shop/products/x?fbclid=${"F".repeat(380)}&utm_source=fb&utm_campaign=Escala%7C120200000000000001&utm_content=120200000000000003`;
    const cortada = inteira.slice(0, 500);
    expect(cortada.length).toBe(500);
    const r = utmDaPagina(cortada, AGORA);
    expect(r?.utm).toMatchObject({ source: "fb", campaign: "Escala|120200000000000001" });
    expect(r?.utm.content).toBeUndefined();
    // Curta, nada sai.
    expect(utmDaPagina("https://loja.shop/?utm_content=120200000000000003", AGORA)?.utm.content).toBe("120200000000000003");
  });
});

describe("caminho de entrada sem dado do comprador", () => {
  it("so o caminho, sem query", () => {
    expect(caminhoDeEntrada("/products/blanket?fbclid=x&email=a")).toBe("/products/blanket");
    expect(caminhoDeEntrada("https://loja.shop/collections/all#top")).toBe("/collections/all");
  });

  it("checkout, status, carrinho direto e conta viram so a secao", () => {
    expect(caminhoDeEntrada("/checkouts/cn/Z2NwLXVz/information")).toBe("/checkouts");
    expect(caminhoDeEntrada("/55555/checkouts/abc123")).toBe("/checkouts");
    expect(caminhoDeEntrada("/55555/orders/abcdef0123")).toBe("/orders");
    expect(caminhoDeEntrada("/cart/4567:1?attributes[_xc_vid]=a.b")).toBe("/cart");
    expect(caminhoDeEntrada("/account/login")).toBe("/account");
    expect(caminhoDeEntrada("/pages/a@b.com")).toBeNull();
    expect(caminhoDeEntrada("")).toBeNull();
  });
});
