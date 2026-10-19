import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JANELA_DA_PONTE_MS,
  TETOS_DO_COLETOR,
  coletarDoCheckout,
  idDoEventoDaPonte,
  urlDaPagina,
  userAgentLimpo,
  type CheckoutDoColetor,
  type ContextoDoColetor,
  type CorpoDaPonte,
  type RepositorioDoColetor,
} from "@/lib/checkouts-externos/coletor";
import type { DestinoDoCheckout, EnvioGravado } from "@/lib/checkouts-externos/compra";
import { hashDoIp } from "@/lib/tracking/ip-balde";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";

// O ramo de CHECKOUT do coletor publico (Fase D): a pagina de vendas (VSL) que
// leva a Cakto manda, pela ponte, o PageView ao abrir e o InitiateCheckout no
// clique do botao. O coletor grava a identidade do visitante (o que a compra
// do webhook acha pelo vid) e poe os dois na fila do checkout -- sem valor
// monetario, com os mesmos tetos do coletor das lojas, so para checkout ativo
// de venda com pixel ligado.

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

const AGORA = Date.parse("2026-10-19T15:10:00.000Z");
const CK = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const VID = "mgx1k2a3.4b5c6d7e";
const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

const META: DestinoDoCheckout = { id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true };
const TIKTOK: DestinoDoCheckout = { id: "d-tt", plataforma: "tiktok", conta: "CUSG5HBC77UD11VVRQEG", token: "tt-token-1234567", testEventCode: null, ativo: true };

type Linha = EnvioGravado & { criadoMs: number };

function banco(
  opcoes: {
    checkout?: Partial<CheckoutDoColetor> | null;
    destinos?: DestinoDoCheckout[];
    /** Contagem fixa da fila (o teto), por chave. null = a consulta falhou. */
    contagem?: { visitante?: number | null; ip?: number | null; checkout?: number | null };
    identidadesNovas?: { doCheckout: number | null; doIp: number | null };
    falharIdentidade?: boolean;
  } = {}
) {
  const identidades = new Map<string, Record<string, unknown>>();
  const linhas: Linha[] = [];
  const entregues: string[] = [];
  const relogio = { ms: AGORA };
  let destinosLidos = 0;
  const repo: RepositorioDoColetor = {
    async checkout(id) {
      if (opcoes.checkout === null) return null;
      return { id, user_id: "u-1", plataforma: "cakto", ativo: true, ...opcoes.checkout };
    },
    async destinos() {
      destinosLidos += 1;
      return opcoes.destinos ?? [META, TIKTOK];
    },
    async atualizarIdentidade(_ck, vid, campos) {
      if (opcoes.falharIdentidade) throw new Error("banco fora");
      const atual = identidades.get(vid);
      if (!atual) return false;
      identidades.set(vid, { ...atual, ...campos });
      return true;
    },
    async identidadesNovas(_ck, desde, ipHash) {
      if (opcoes.identidadesNovas) return opcoes.identidadesNovas;
      const novas = [...identidades.values()].filter((l) => Number(l.criadoMs) >= Date.parse(desde));
      return { doCheckout: novas.length, doIp: ipHash ? novas.filter((l) => l.ip_hash === ipHash).length : null };
    },
    async inserirIdentidade(linha) {
      identidades.set(linha.visitor_id, { ...linha, criadoMs: relogio.ms });
    },
    async contarEnvios(f) {
      const c = opcoes.contagem;
      if (c) {
        if (f.visitorId && c.visitante !== undefined) return c.visitante;
        if (f.ipHash && c.ip !== undefined) return c.ip;
        if (!f.visitorId && !f.ipHash && c.checkout !== undefined) return c.checkout;
      }
      const desde = Date.parse(f.desde);
      return linhas.filter(
        (l) =>
          l.criadoMs >= desde &&
          (f.visitorId ? l.visitor_id === f.visitorId : f.ipHash ? l.ip_hash === f.ipHash : Boolean(l.visitor_id))
      ).length;
    },
    async inicioDesde(_ck, vid, desde) {
      return linhas.some((l) => l.visitor_id === vid && l.event_name === "InitiateCheckout" && l.criadoMs >= Date.parse(desde));
    },
    async enfileirar(novas) {
      const entraram: EnvioGravado[] = [];
      for (const l of novas) {
        if (linhas.some((x) => x.destino_id === l.destino_id && x.event_id === l.event_id)) continue;
        const g = { ...l, id: `e${linhas.length + 1}`, attempts: 0 };
        linhas.push({ ...g, criadoMs: relogio.ms });
        entraram.push(g);
      }
      return entraram;
    },
    async entregar(lista) {
      entregues.push(...lista.map((x) => x.envio.id));
      return lista.map((x) => ({ id: x.envio.id, ok: true }));
    },
  };
  return { repo, identidades, linhas, entregues, relogio, destinosLidos: () => destinosLidos };
}

function ctx(extra: Partial<ContextoDoColetor> = {}): ContextoDoColetor {
  return { agoraMs: AGORA, ip: IP, ipHash: hashDoIp(IP, "segredo-de-teste"), userAgent: UA, pais: "BR", ...extra };
}

function corpo(extra: CorpoDaPonte = {}): CorpoDaPonte {
  return {
    checkoutId: CK,
    evento: "page_view",
    visitorId: VID,
    fbp: "fb.1.1760886000000.1234567890",
    fbc: null,
    fbclid: "IwAR_clique1",
    ttclid: "E.C.P.ttclique1",
    ttp: "UqBuLHl7abc",
    gclid: "Cj0KCQjw",
    pageUrl: "https://vsl.com/oferta?fbclid=IwAR_clique1&utm_source=FB&utm_campaign=111111&email=ana%40x.com&nome=Ana",
    utm: { utm_source: "FB", utm_campaign: "111111", clique: "meta", em: AGORA - 5 * 60_000 },
    ...extra,
  };
}

const metaDe = (b: ReturnType<typeof banco>) => b.linhas.filter((l) => l.plataforma === "meta").map((l) => l.payload as EventoCapi);
const tiktokDe = (b: ReturnType<typeof banco>) => b.linhas.filter((l) => l.plataforma === "tiktok").map((l) => l.payload as EventoTiktok);

describe("a pagina de vendas do checkout: PageView ao abrir", () => {
  it("grava a identidade (IP, user agent, click ids, UTM) e poe um PageView por pixel, sem valor", async () => {
    const b = banco();
    const r = await coletarDoCheckout(b.repo, corpo(), ctx());
    expect(r).toEqual({ ok: true, detalhe: { destinos: { meta: "enviado", tiktok: "enviado" } } });

    // A identidade: o que a compra do webhook acha pelo vid.
    expect(b.identidades.get(VID)).toMatchObject({
      checkout_id: CK,
      user_id: "u-1",
      visitor_id: VID,
      fbp: "fb.1.1760886000000.1234567890",
      fbc: null,
      fbclid: "IwAR_clique1",
      ttclid: "E.C.P.ttclique1",
      ttp: "UqBuLHl7abc",
      gclid: "Cj0KCQjw",
      client_ip_address: IP,
      client_user_agent: UA,
      ip_hash: hashDoIp(IP, "segredo-de-teste"),
      utm: { source: "FB", campaign: "111111", clique: "meta" },
      utm_em: new Date(AGORA - 5 * 60_000).toISOString(),
    });

    // A fila: uma linha por pixel, o MESMO event_id, com as chaves dos tetos.
    expect(b.linhas.map((l) => [l.plataforma, l.event_name, l.event_id, l.visitor_id, l.grupo])).toEqual([
      ["meta", "PageView", idDoEventoDaPonte("page_view", VID, AGORA), VID, null],
      ["tiktok", "PageView", idDoEventoDaPonte("page_view", VID, AGORA), VID, null],
    ]);
    expect(b.linhas[0].ip_hash).toBe(hashDoIp(IP, "segredo-de-teste"));
    expect(b.entregues).toEqual(["e1", "e2"]);

    const [meta] = metaDe(b);
    expect(meta).toMatchObject({
      event_name: "PageView",
      event_time: Math.floor(AGORA / 1000),
      action_source: "website",
      // So os parametros de anuncio: o e-mail e o nome da query nao vao.
      event_source_url: "https://vsl.com/oferta?utm_source=FB&utm_campaign=111111&fbclid=IwAR_clique1",
    });
    expect(meta.user_data).toEqual({
      country: [sha("br")],
      external_id: [sha(VID)],
      fbp: "fb.1.1760886000000.1234567890",
      // Montado do fbclid com a hora do clique (o conjunto da ponte), nunca inventado sem clique.
      fbc: `fb.1.${AGORA - 5 * 60_000}.IwAR_clique1`,
      client_ip_address: IP,
      client_user_agent: UA,
    });

    const [tt] = tiktokDe(b);
    expect(tt).toMatchObject({ event: "Pageview", event_id: idDoEventoDaPonte("page_view", VID, AGORA) });
    expect(tt.user).toEqual({ external_id: [sha(VID)], ttclid: "E.C.P.ttclique1", ttp: "UqBuLHl7abc", ip: IP, user_agent: UA });
    expect(tt.page?.url).not.toContain("ttclid");

    // O coletor e publico: nenhum valor, nenhuma moeda, nada com "@".
    for (const l of b.linhas) {
      const texto = JSON.stringify(l.payload);
      expect(texto).not.toContain("value");
      expect(texto).not.toContain("currency");
      expect(texto).not.toContain("@");
    }
  });

  it("valor mandado pelo navegador e ignorado: o corpo da ponte nem tem onde por", async () => {
    const b = banco();
    await coletarDoCheckout(b.repo, { ...corpo(), value: 999, currency: "BRL" } as CorpoDaPonte, ctx());
    for (const l of b.linhas) expect(JSON.stringify(l.payload)).not.toMatch(/999|value|currency/);
  });

  it("recarregar no mesmo balde de 30 min nao repete: o unico da fila segura", async () => {
    const b = banco();
    await coletarDoCheckout(b.repo, corpo(), ctx());
    b.relogio.ms = AGORA + 60_000;
    const r = await coletarDoCheckout(b.repo, corpo(), ctx({ agoraMs: AGORA + 60_000 }));
    expect(r).toEqual({ ok: true, detalhe: { destinos: { meta: "duplicado", tiktok: "duplicado" } } });
    expect(b.linhas).toHaveLength(2);
  });

  it("o evento seguinte de quem ja tem identidade so atualiza (a UTM nao some numa pagina sem ela)", async () => {
    const b = banco();
    await coletarDoCheckout(b.repo, corpo(), ctx());
    await coletarDoCheckout(b.repo, corpo({ evento: "begin_checkout", utm: undefined, pageUrl: "https://vsl.com/oferta" }), ctx({ agoraMs: AGORA + 60_000 }));
    expect(b.identidades.size).toBe(1);
    expect(b.identidades.get(VID)).toMatchObject({ utm: { source: "FB", campaign: "111111" }, updated_at: new Date(AGORA + 60_000).toISOString() });
  });
});

describe("InitiateCheckout no clique do botao", () => {
  it("um por visitante em 30 min, inclusive atravessando o balde do event_id", async () => {
    const b = banco();
    // 1 min antes de virar o balde: o segundo clique cai no balde seguinte.
    const t0 = (Math.floor(AGORA / JANELA_DA_PONTE_MS) + 1) * JANELA_DA_PONTE_MS - 60_000;
    b.relogio.ms = t0;
    const r1 = await coletarDoCheckout(b.repo, corpo({ evento: "begin_checkout" }), ctx({ agoraMs: t0 }));
    expect(r1.ok && r1.detalhe).toEqual({ destinos: { meta: "enviado", tiktok: "enviado" } });
    expect(metaDe(b)[0]).toMatchObject({ event_name: "InitiateCheckout", event_id: idDoEventoDaPonte("begin_checkout", VID, t0) });
    expect(tiktokDe(b)[0].event).toBe("InitiateCheckout");
    expect(metaDe(b)[0].custom_data).toBeUndefined();

    b.relogio.ms = t0 + 2 * 60_000;
    const r2 = await coletarDoCheckout(b.repo, corpo({ evento: "begin_checkout" }), ctx({ agoraMs: t0 + 2 * 60_000 }));
    expect(r2).toEqual({ ok: true, detalhe: { ignorado: "checkout ja iniciado nos ultimos 30 min" } });

    b.relogio.ms = t0 + 31 * 60_000;
    await coletarDoCheckout(b.repo, corpo({ evento: "begin_checkout" }), ctx({ agoraMs: t0 + 31 * 60_000 }));
    expect(b.linhas.filter((l) => l.event_name === "InitiateCheckout")).toHaveLength(4);
  });

  it("o PageView nao conta como inicio: abrir e clicar mandam os dois", async () => {
    const b = banco();
    await coletarDoCheckout(b.repo, corpo(), ctx());
    await coletarDoCheckout(b.repo, corpo({ evento: "begin_checkout" }), ctx({ agoraMs: AGORA + 1000 }));
    expect(b.linhas.map((l) => l.event_name)).toEqual(["PageView", "PageView", "InitiateCheckout", "InitiateCheckout"]);
  });
});

describe("so checkout ativo, de venda, com pixel ligado", () => {
  const casos: [string, Parameters<typeof banco>[0], CorpoDaPonte, string][] = [
    ["checkout pausado", { checkout: { ativo: false } }, corpo(), "checkout pausado"],
    ["checkout que nao existe", { checkout: null }, corpo(), "checkout desconhecido"],
    ["a Sphere (comissao) nao rastreia", { checkout: { plataforma: "sphere" } }, corpo(), "checkout desconhecido"],
    ["sem destino", { destinos: [] }, corpo(), "rastreamento do checkout desligado"],
    ["destino desligado", { destinos: [{ ...META, ativo: false }] }, corpo(), "rastreamento do checkout desligado"],
    ["destino sem token", { destinos: [{ ...TIKTOK, token: null }] }, corpo(), "rastreamento do checkout desligado"],
    ["id de checkout torto", {}, corpo({ checkoutId: "../stores" }), "checkoutId invalido"],
    ["compra pelo navegador", {}, corpo({ evento: "purchase" }), "evento nao vale para checkout"],
    ["ViewContent (nao ha produto da Shopify)", {}, corpo({ evento: "view_item" }), "evento nao vale para checkout"],
    ["visitante fora do formato", {}, corpo({ visitorId: "<script>" }), "visitorId invalido"],
  ];
  for (const [nome, opcoes, c, motivo] of casos) {
    it(`${nome}: recusa sem gravar nada`, async () => {
      const b = banco(opcoes);
      expect(await coletarDoCheckout(b.repo, c, ctx())).toEqual({ ok: false, motivo });
      expect(b.identidades.size).toBe(0);
      expect(b.linhas).toEqual([]);
      expect(b.entregues).toEqual([]);
    });
  }

  it("so o pixel ligado recebe: Meta sem o TikTok", async () => {
    const b = banco({ destinos: [META, { ...TIKTOK, ativo: false }] });
    await coletarDoCheckout(b.repo, corpo(), ctx());
    expect(b.linhas.map((l) => l.plataforma)).toEqual(["meta"]);
  });
});

describe("os tetos do coletor das lojas", () => {
  it("os numeros sao os mesmos do coletor das lojas (route.ts)", () => {
    const rota = readFileSync(path.resolve(__dirname, "..", "src", "app", "api", "tracking", "collect", "route.ts"), "utf8");
    const constante = (nome: string) => {
      const m = rota.match(new RegExp(`const ${nome} = (\\d+);`));
      if (!m) throw new Error(`nao achei ${nome}`);
      return Number(m[1]);
    };
    expect(TETOS_DO_COLETOR).toEqual({
      porVisitanteDia: constante("TETO_POR_VISITANTE"),
      porIpHora: constante("TETO_POR_IP_HORA"),
      porCheckoutHora: constante("TETO_POR_LOJA_HORA"),
      identidadesHora: constante("TETO_IDENTIDADES_HORA"),
      identidadesPorIpHora: constante("TETO_IDENTIDADES_POR_IP_HORA"),
    });
  });

  const estouros: [string, NonNullable<Parameters<typeof banco>[0]>["contagem"], string][] = [
    ["visitante no dia", { visitante: TETOS_DO_COLETOR.porVisitanteDia }, "teto do visitante"],
    ["IP na hora", { ip: TETOS_DO_COLETOR.porIpHora }, "teto do ip"],
    ["checkout na hora", { checkout: TETOS_DO_COLETOR.porCheckoutHora }, "teto do checkout"],
  ];
  for (const [nome, contagem, ignorado] of estouros) {
    it(`teto do ${nome}: o evento nao entra, a identidade sim (e o que a compra consulta)`, async () => {
      const b = banco({ contagem });
      expect(await coletarDoCheckout(b.repo, corpo(), ctx())).toEqual({ ok: true, detalhe: { ignorado } });
      expect(b.linhas).toEqual([]);
      expect(b.identidades.has(VID)).toBe(true);
    });
  }

  it("contagem que falhou deixa o teto cego, nao fechado", async () => {
    const b = banco({ contagem: { visitante: null, ip: null, checkout: null } });
    await coletarDoCheckout(b.repo, corpo(), ctx());
    expect(b.linhas).toHaveLength(2);
  });

  it("identidade NOVA tem teto proprio (por IP e por checkout); o evento segue", async () => {
    for (const novas of [
      { doCheckout: 0, doIp: TETOS_DO_COLETOR.identidadesPorIpHora },
      { doCheckout: TETOS_DO_COLETOR.identidadesHora, doIp: 0 },
    ]) {
      const b = banco({ identidadesNovas: novas });
      await coletarDoCheckout(b.repo, corpo(), ctx());
      expect(b.identidades.size).toBe(0);
      expect(b.linhas).toHaveLength(2);
    }
  });

  it("falha ao gravar a identidade nao derruba o evento", async () => {
    const b = banco({ falharIdentidade: true });
    const r = await coletarDoCheckout(b.repo, corpo(), ctx());
    expect(r.ok).toBe(true);
    expect(b.linhas).toHaveLength(2);
  });
});

describe("nada com '@' entra (o CHECK da 073 recusaria a linha)", () => {
  it("user agent com '@' sai inteiro; IP que nao e IP sai; cookie e click id tortos saem", async () => {
    const b = banco();
    await coletarDoCheckout(
      b.repo,
      corpo({ fbp: "fb.1.x.y", fbc: "lixo@x", fbclid: "a b", ttclid: "x".repeat(2000), ttp: "<x>", gclid: "g@x" }),
      ctx({ userAgent: "Bot (contato@empresa.com)", ip: "nao-e-ip" })
    );
    expect(b.identidades.get(VID)).toMatchObject({
      fbp: null,
      fbc: null,
      fbclid: null,
      ttclid: null,
      ttp: null,
      gclid: null,
      client_ip_address: null,
      client_user_agent: null,
    });
    for (const l of b.linhas) expect(JSON.stringify(l.payload)).not.toContain("@");
    expect(userAgentLimpo("Mozilla/5.0\u0000 X")).toBe("Mozilla/5.0 X");
  });

  it("a URL da pagina: origem, caminho e so os parametros de anuncio", () => {
    expect(urlDaPagina("https://vsl.com/p?email=a%40b.com&utm_source=fb&gclid=Cj0&foo=bar")).toBe("https://vsl.com/p?utm_source=fb&gclid=Cj0");
    expect(urlDaPagina("https://user:senha@vsl.com/p")).toBeNull();
    expect(urlDaPagina("javascript:alert(1)")).toBeNull();
    expect(urlDaPagina("https://vsl.com/a@b/p")).toBe("https://vsl.com/");
    expect(urlDaPagina(null)).toBeNull();
  });
});
