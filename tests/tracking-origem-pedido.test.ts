import { describe, expect, it } from "vitest";
import {
  CAMPOS_ORIGEM,
  calcularOrigem,
  mesclarOrigens,
  mesmaOrigem,
  origemDoSync,
  origemDoWebhook,
  type OrigemDoPedido,
} from "../src/lib/tracking/origem-pedido";

// ============================================================================
// Campanha, conjunto e anuncio NO PEDIDO: de qual fonte, com qual janela.
//
// Casos tirados do medido nas lojas do Arthur (10/2026):
//   - Softnook: landing_site cortado (o fbclid do Meta vem antes das UTMs e a
//     campanha nao sobrevive), jornada da Shopify com os tres ids;
//   - AmpleStep: pedido do Releasit (COD) sem landing_site, sem jornada e com
//     a nota cheia de dado pessoal;
//   - o cookie e a identidade duram 90 dias, a janela e de 7.
// ============================================================================

const PEDIDO_EM = "2026-10-08T19:30:00Z";
const DIA = 864e5;
const antes = (dias: number) => new Date(Date.parse(PEDIDO_EM) - dias * DIA).toISOString();

const CAMP = "120252293723770706";
const CONJ = "120252293728570706";
const ANUN = "120252293729160706";
const FBCLID = "IwZXh0bgNhZW0BMABhZGlkAasdf_aem_AbCdEfGhIjKlMnOpQrStUv";

/** O Meta poe o fbclid primeiro (~200 caracteres): o landing_site corta as UTMs. */
const LANDING_CORTADO = `/products/blanket?fbclid=${FBCLID}${"x".repeat(150)}&utm_medium=paid&utm_source=fb&utm_id=12025`.slice(0, 255);

const IDS_DO_META = { utm_campaign: CAMP, utm_medium: null, utm_content: ANUN, utm_term: CONJ };

describe("webhook: URL de chegada, atributos e identidade", () => {
  it("modelo colado: as UTMs vem antes do fbclid e sobrevivem no landing", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        landing_site: `/products/blanket?utm_source=FB&utm_campaign=${CAMP}&utm_medium=${CONJ}&utm_content=${ANUN}&utm_term=Instagram_Reels&fbclid=${FBCLID}`,
      },
      null
    );
    expect(o).toMatchObject({
      fonte: "landing",
      sessao: true,
      plataforma: "meta",
      clique: "meta",
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      posicionamento: "Instagram_Reels",
      pagina_entrada: "/products/blanket",
    });
  });

  it("landing cortado (formato automatico do Meta): a plataforma fica, os ids vem do cookie do carrinho", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        landing_site: LANDING_CORTADO,
        note_attributes: [
          { name: "_xc_vid", value: "abc.def" },
          { name: "_xc_utm_source", value: "fb" },
          { name: "_xc_utm_medium", value: "paid" },
          { name: "_xc_utm_campaign", value: CAMP },
          { name: "_xc_utm_content", value: ANUN },
          { name: "_xc_utm_term", value: CONJ },
          { name: "_xc_utm_em", value: String(Date.parse(antes(0.01))) },
        ],
      },
      null
    );
    expect(o).toMatchObject({
      fonte: "landing",
      plataforma: "meta",
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      posicionamento: null,
      pagina_entrada: "/products/blanket",
    });
  });

  it("Releasit (COD) sem landing_site nem atributo nosso: a identidade da cascata traz a UTM", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        landing_site: null,
        note_attributes: [
          { name: "First name", value: "Ana" },
          { name: "Phone", value: "+420777123456" },
          { name: "Address", value: "Rua A, 10" },
          { name: "Email", value: "ana@exemplo.com" },
          { name: "IP address", value: "203.0.113.9" },
        ],
      },
      { utm: { source: "fb", medium: "paid", ...{ campaign: CAMP, content: ANUN, term: CONJ } }, utmEm: antes(2) }
    );
    expect(o).toMatchObject({
      fonte: "identidade",
      sessao: false,
      plataforma: "meta",
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      toque_em: antes(2),
    });
    // Nada da nota (nome, telefone, endereco, e-mail, IP) foi para a linha.
    const texto = JSON.stringify(o);
    for (const pii of ["Ana", "+420777123456", "Rua A", "ana@exemplo.com", "203.0.113.9"]) {
      expect(texto).not.toContain(pii);
    }
  });

  it("Releasit com 'UTM Tracking' ligado: a UTM da nota e da sessao do pedido", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        note_attributes: [
          { name: "Email", value: "ana@exemplo.com" },
          { name: "utm_source", value: "fb" },
          { name: "utm_campaign", value: CAMP },
        ],
      },
      { utm: { source: "google", campaign: "21000000001" }, utmEm: antes(1) }
    );
    expect(o).toMatchObject({ fonte: "atributo", sessao: true, plataforma: "meta", campanha_id: CAMP });
  });

  it("pedido sem nada: nada para gravar", () => {
    expect(origemDoWebhook({ created_at: PEDIDO_EM, note_attributes: [{ name: "Phone", value: "1" }] }, null)).toBeNull();
    expect(origemDoWebhook({ created_at: PEDIDO_EM }, { utm: null, utmEm: null })).toBeNull();
  });

  it("visita sem anuncio: Direto (plataforma null), com a pagina de entrada", () => {
    expect(origemDoWebhook({ created_at: PEDIDO_EM, landing_site: "/collections/all?ref=x" }, null)).toMatchObject({
      fonte: "landing",
      plataforma: null,
      clique: null,
      campanha_id: null,
      pagina_entrada: "/collections/all",
    });
  });

  it("ttclid na URL de chegada: TikTok, mesmo sem UTM", () => {
    expect(origemDoWebhook({ created_at: PEDIDO_EM, landing_site: "/products/x?ttclid=E.C.P.abc" }, null)).toMatchObject({
      plataforma: "tiktok",
      clique: "tiktok",
    });
  });

  it("ttclid so no carrinho (sem hora): fica na coluna clique, nao vira plataforma", () => {
    expect(
      origemDoWebhook({ created_at: PEDIDO_EM, note_attributes: [{ name: "ttclid", value: "E.C.P.abc" }] }, null)
    ).toMatchObject({ fonte: "atributo", sessao: false, plataforma: null, clique: "tiktok", campanha_id: null });
  });
});

describe("janela de 7 dias: UTM herdada de clique velho nao vale", () => {
  it("identidade de 8 dias atras: o pedido nao herda o anuncio", () => {
    expect(
      origemDoWebhook({ created_at: PEDIDO_EM }, { utm: { source: "fb", campaign: CAMP }, utmEm: antes(8) })
    ).toBeNull();
    expect(
      origemDoWebhook({ created_at: PEDIDO_EM }, { utm: { source: "fb", campaign: CAMP }, utmEm: antes(6.9) })
    ).toMatchObject({ campanha_id: CAMP });
  });

  it("cookie do carrinho velho tambem nao; a compra organica fica Direto", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        landing_site: "/",
        note_attributes: [
          { name: "_xc_utm_source", value: "fb" },
          { name: "_xc_utm_campaign", value: CAMP },
          { name: "_xc_utm_em", value: String(Date.parse(antes(30))) },
        ],
      },
      null
    );
    expect(o).toMatchObject({ plataforma: null, campanha_id: null });
  });

  it("_fbc velho nao faz clique do Meta; o da janela faz, com a hora dele", () => {
    const velho = `fb.1.${Date.parse(antes(20))}.IwAR1`;
    expect(
      origemDoWebhook(
        { created_at: PEDIDO_EM, note_attributes: [{ name: "_fbc", value: velho }, { name: "fbclid", value: "IwAR1" }] },
        null
      )
    ).toBeNull();
    const novo = `fb.1.${Date.parse(antes(1))}.IwAR2`;
    expect(
      origemDoWebhook({ created_at: PEDIDO_EM, note_attributes: [{ name: "_fbc", value: novo }] }, null)
    ).toMatchObject({ plataforma: "meta", clique: "meta", toque_em: antes(1) });
  });

  it("compra organica com gclid de carrinho velho (cookie de 90 dias): Direto, nunca Google", () => {
    const o = origemDoWebhook(
      { created_at: PEDIDO_EM, landing_site: "/", note_attributes: [{ name: "gclid", value: "Cj0KCQ" }] },
      null
    );
    expect(o).toMatchObject({ fonte: "landing", sessao: true, plataforma: null, clique: "google", campanha_id: null });
  });

  it("gclid ou ttclid so na identidade (sem hora) tambem nao vira plataforma", () => {
    expect(origemDoWebhook({ created_at: PEDIDO_EM }, { gclid: "Cj0KCQ", ttclid: "E.C.P" })).toMatchObject({
      fonte: "identidade",
      sessao: false,
      plataforma: null,
      clique: "google",
    });
    // Com a visita da sessao: Direto.
    expect(
      origemDoWebhook({ created_at: PEDIDO_EM, landing_site: "/collections/all" }, { gclid: "Cj0KCQ" })
    ).toMatchObject({ plataforma: null, pagina_entrada: "/collections/all" });
  });

  it("clique novo so com gclid troca o conjunto: Meta no dia 0, Google no dia 2, pedido sem sessao no dia 3", () => {
    // O pedido nasce no dia 3: o clique do Meta (dia 0) e o do Google (dia 2)
    // estao na janela. O snippet trocou o conjunto no clique do Google
    // (_xc_utm_* do Meta vazios), mas o _fbc do dia 0 continua no carrinho.
    const pedidoEm = antes(-3);
    const dia = (n: number) => String(Date.parse(PEDIDO_EM) + n * DIA);
    const atributos = [
      { name: "_fbc", value: `fb.1.${dia(0)}.IwAR0` },
      { name: "fbclid", value: "IwAR0" },
      { name: "gclid", value: "Cj0KCQ" },
      { name: "_xc_utm_clique", value: "google" },
      { name: "_xc_utm_gad", value: "21234567890" },
      { name: "_xc_utm_em", value: dia(2) },
    ];
    expect(origemDoWebhook({ created_at: pedidoEm, note_attributes: atributos }, null)).toMatchObject({
      fonte: "atributo",
      plataforma: "google",
      clique: "google",
      campanha_id: "21234567890",
      conjunto_id: null,
      anuncio_id: null,
      toque_em: new Date(Number(dia(2))).toISOString(),
    });
    // Pedido sem atributo (app de COD): a identidade com o conjunto do Google.
    expect(
      origemDoWebhook(
        { created_at: pedidoEm },
        { utm: { clique: "google" }, utmEm: new Date(Number(dia(2))).toISOString(), fbc: `fb.1.${dia(0)}.IwAR0` }
      )
    ).toMatchObject({ fonte: "identidade", plataforma: "google", campanha_id: null });
  });

  it("o clique mais novo vence entre toques com hora", () => {
    const o = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        note_attributes: [
          { name: "_xc_utm_source", value: "google" },
          { name: "_xc_utm_campaign", value: "21000000001" },
          { name: "_xc_utm_em", value: String(Date.parse(antes(1))) },
        ],
      },
      { utm: { source: "fb", campaign: CAMP }, utmEm: antes(5) }
    );
    expect(o).toMatchObject({ fonte: "atributo", plataforma: "google", campanha_id: "21000000001" });
  });
});

describe("sync: jornada da Shopify", () => {
  const jornada = (extra = {}) => ({
    ready: true,
    lastVisit: {
      occurredAt: antes(0.1),
      landingPage: `https://softnook.shop/products/blanket?fbclid=${FBCLID}&utm_medium=paid&utm_source=fb&utm_id=${CAMP}`,
      utmParameters: { source: "fb", medium: "paid", campaign: CAMP, content: ANUN, term: CONJ },
    },
    firstVisit: null,
    ...extra,
  });

  it("ultima visita com os tres ids", () => {
    expect(origemDoSync({ createdAt: PEDIDO_EM, customerJourneySummary: jornada() })).toMatchObject({
      fonte: "jornada",
      sessao: true,
      plataforma: "meta",
      clique: "meta",
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      toque_em: antes(0.1),
      pagina_entrada: "/products/blanket",
    });
  });

  it("jornada que ainda nao esta pronta nao conta", () => {
    expect(origemDoSync({ createdAt: PEDIDO_EM, customerJourneySummary: jornada({ ready: false }) })).toBeNull();
  });

  it("ultima visita direta: a primeira (com anuncio) vale se estiver na janela", () => {
    const direta = { occurredAt: antes(0.1), landingPage: "https://softnook.shop/checkouts/cn/abc", utmParameters: null };
    const primeira = (dias: number) => ({
      occurredAt: antes(dias),
      landingPage: "https://softnook.shop/products/blanket",
      utmParameters: { source: "ig", medium: "paid", campaign: CAMP, content: ANUN, term: CONJ },
    });
    expect(
      origemDoSync({ createdAt: PEDIDO_EM, customerJourneySummary: { ready: true, lastVisit: direta, firstVisit: primeira(3) } })
    ).toMatchObject({ fonte: "jornada", sessao: false, campanha_id: CAMP, toque_em: antes(3) });
    expect(
      origemDoSync({ createdAt: PEDIDO_EM, customerJourneySummary: { ready: true, lastVisit: direta, firstVisit: primeira(9) } })
    ).toMatchObject({ plataforma: null, pagina_entrada: "/checkouts" });
  });

  it("pedido do Releasit no sync: jornada vazia e nota com dado pessoal -- nada", () => {
    expect(
      origemDoSync({
        createdAt: PEDIDO_EM,
        customAttributes: [
          { key: "First name", value: "Ana" },
          { key: "Phone", value: "+420777123456" },
        ],
        customerJourneySummary: { ready: true, firstVisit: null, lastVisit: null },
      })
    ).toBeNull();
  });
});

describe("a gravada e a nova se completam", () => {
  const base: OrigemDoPedido = {
    fonte: "landing",
    sessao: true,
    plataforma: "meta",
    clique: "meta",
    utm_source: "fb",
    utm_medium: "paid",
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    campanha_id: null,
    conjunto_id: null,
    anuncio_id: null,
    posicionamento: null,
    toque_em: null,
    pagina_entrada: "/products/blanket",
  };

  it("webhook (landing cortado) + sync (jornada completa): vence a jornada", () => {
    const sync = origemDoSync({
      createdAt: PEDIDO_EM,
      customerJourneySummary: {
        ready: true,
        lastVisit: {
          occurredAt: antes(0.1),
          landingPage: "https://softnook.shop/products/blanket",
          utmParameters: { source: "fb", medium: "paid", campaign: CAMP, content: ANUN, term: CONJ },
        },
      },
    })!;
    const final = mesclarOrigens(sync, base, PEDIDO_EM);
    expect(final).toMatchObject({ fonte: "jornada", campanha_id: CAMP, conjunto_id: CONJ, anuncio_id: ANUN });
  });

  it("identidade gravada pelo webhook nao e apagada por um sync que nao achou nada melhor", () => {
    const daIdentidade: OrigemDoPedido = {
      ...base,
      fonte: "identidade",
      sessao: false,
      plataforma: "meta",
      ...IDS_DO_META,
      utm_source: "fb",
      utm_medium: "paid",
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      toque_em: antes(2),
      pagina_entrada: null,
    };
    // O sync de um pedido sem jornada so viu a visita "direta".
    const direta: OrigemDoPedido = { ...base, fonte: "jornada", plataforma: null, clique: null, utm_source: null, utm_medium: null };
    const final = mesclarOrigens(direta, daIdentidade, PEDIDO_EM);
    expect(final).toMatchObject({ fonte: "identidade", campanha_id: CAMP, conjunto_id: CONJ });
  });

  it("mesclar duas vezes da o mesmo (o sync regrava sem mudar nada)", () => {
    const daIdentidade: OrigemDoPedido = {
      ...base,
      fonte: "identidade",
      sessao: false,
      utm_campaign: CAMP,
      utm_content: ANUN,
      utm_term: CONJ,
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      toque_em: antes(2),
    };
    const uma = mesclarOrigens(base, daIdentidade, PEDIDO_EM);
    // O landing cortado (sessao) vence e e completado pela identidade.
    expect(uma).toMatchObject({ fonte: "landing", campanha_id: CAMP, conjunto_id: CONJ, anuncio_id: ANUN });
    expect(mesmaOrigem(mesclarOrigens(uma, uma, PEDIDO_EM), uma)).toBe(true);
    expect(mesmaOrigem(mesclarOrigens(base, uma, PEDIDO_EM), uma)).toBe(true);
  });

  it("Direto com click id sem hora: o sync nao transforma o clique em plataforma", () => {
    const doWebhook = origemDoWebhook(
      { created_at: PEDIDO_EM, landing_site: "/", note_attributes: [{ name: "gclid", value: "Cj0KCQ" }] },
      null
    )!;
    const sync = origemDoSync({
      createdAt: PEDIDO_EM,
      customerJourneySummary: {
        ready: true,
        lastVisit: { occurredAt: antes(0.1), landingPage: "https://loja.shop/", utmParameters: null },
      },
    })!;
    const final = mesclarOrigens(sync, doWebhook, PEDIDO_EM);
    expect(final).toMatchObject({ plataforma: null, clique: "google", sessao: true });
    expect(mesmaOrigem(mesclarOrigens(final, final, PEDIDO_EM), final)).toBe(true);
  });

  it("clique com hora gravado (_fbc na janela) continua valendo ao mesclar", () => {
    const doWebhook = origemDoWebhook(
      { created_at: PEDIDO_EM, note_attributes: [{ name: "_fbc", value: `fb.1.${Date.parse(antes(1))}.IwAR2` }] },
      null
    )!;
    const sync = origemDoSync({
      createdAt: PEDIDO_EM,
      customerJourneySummary: { ready: true, lastVisit: { occurredAt: antes(0.1), landingPage: "/", utmParameters: null } },
    })!;
    expect(mesclarOrigens(sync, doWebhook, PEDIDO_EM)).toMatchObject({ plataforma: "meta", clique: "meta" });
  });

  it("completar so com a MESMA campanha: outro anuncio nao se mistura", () => {
    const comCampanha: OrigemDoPedido = { ...base, campanha_id: "999999999" };
    const outra: OrigemDoPedido = {
      ...base,
      fonte: "identidade",
      sessao: false,
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      toque_em: antes(2),
    };
    expect(mesclarOrigens(comCampanha, outra, PEDIDO_EM)).toMatchObject({
      campanha_id: "999999999",
      conjunto_id: null,
      anuncio_id: null,
    });
  });
});

describe("so ids e o caminho: nada de dado pessoal", () => {
  it("as colunas sao so estas", () => {
    expect([...CAMPOS_ORIGEM].sort()).toEqual(
      [
        "anuncio_id",
        "campanha_id",
        "clique",
        "conjunto_id",
        "fonte",
        "pagina_entrada",
        "plataforma",
        "posicionamento",
        "sessao",
        "toque_em",
        "utm_campaign",
        "utm_content",
        "utm_medium",
        "utm_source",
        "utm_term",
      ].sort()
    );
  });

  it("e-mail em UTM e query de PII na entrada nao passam", () => {
    const o = calcularOrigem({
      pedidoEm: PEDIDO_EM,
      toques: [],
      visita: null,
    });
    expect(o).toBeNull();
    const w = origemDoWebhook(
      {
        created_at: PEDIDO_EM,
        landing_site: "/pages/obrigado?utm_source=klaviyo&utm_term=ana@exemplo.com&email=ana@exemplo.com&phone=5511999",
      },
      null
    );
    const texto = JSON.stringify(w);
    expect(w).toMatchObject({ plataforma: "outra", utm_source: "klaviyo", utm_term: null, pagina_entrada: "/pages/obrigado" });
    expect(texto).not.toContain("ana@exemplo.com");
    expect(texto).not.toContain("5511999");
  });
});
