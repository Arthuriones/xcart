import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  LIMITE_PAGINA,
  ateOCursor,
  cursorDe,
  fontesVazias,
  hrefRota,
  juntarPaginas,
  lerCarrinhoLevado,
  montarContexto,
  montarEventos,
  origemCurta,
  paginar,
  rotasDaLoja,
  tipoDe,
  tiposVisiveis,
  type EventoAtividade,
  type Fontes,
  type LinhaCompra,
} from "../src/lib/leitura/atividade-regras";
import {
  agruparPorDia,
  buscar,
  eventosTexto,
  horaCurta,
  hrefAtividade,
  normalizar,
  relativo,
  rotuloDia,
} from "../src/app/(dashboard)/activity/apresentar";

const SP = "America/Sao_Paulo";

const LOJAS = [
  { id: "l1", nome: "Lash Bestie" },
  { id: "l2", nome: "Softnook" },
  { id: "l3", nome: "Vitrine Um" },
];

function ev(id: string, at: string, extra: Partial<EventoAtividade> = {}): EventoAtividade {
  return {
    id,
    tipo: "loja",
    tom: "ok",
    selo: null,
    titulo: "Loja conectada",
    descricao: "x entrou no xcart.",
    loja: null,
    at,
    href: "/stores/x",
    destino: "Abrir a loja",
    ...extra,
  };
}

function com(parcial: Partial<Fontes>): Fontes {
  return { ...fontesVazias(), ...parcial };
}

describe("parametros da URL", () => {
  it("tipoDe aceita so tipos conhecidos", () => {
    expect(tipoDe("alerta")).toBe("alerta");
    expect(tipoDe("carrinho")).toBe("carrinho");
    expect(tipoDe("todos")).toBeNull();
    expect(tipoDe("")).toBeNull();
    expect(tipoDe(null)).toBeNull();
    expect(tipoDe("__proto__")).toBeNull();
  });

  it("cursorDe so aceita instante ISO", () => {
    expect(cursorDe("2026-10-03T12:34:56.123456+00:00")).toBe("2026-10-03T12:34:56.123456+00:00");
    expect(cursorDe("2026-10-03T12:34:56Z")).toBe("2026-10-03T12:34:56Z");
    expect(cursorDe("2026-10-03")).toBeNull();
    expect(cursorDe("2026-10-03T12:34:56Z,id.eq.1")).toBeNull();
    expect(cursorDe("ontem")).toBeNull();
    expect(cursorDe(null)).toBeNull();
  });

  it("sem rota, o filtro nao oferece Rotas nem Carrinhos", () => {
    const sem = tiposVisiveis(false).map((t) => t.id);
    expect(sem).not.toContain("rota");
    expect(sem).not.toContain("carrinho");
    expect(tiposVisiveis(true).map((t) => t.id)).toEqual(
      expect.arrayContaining(["rota", "carrinho", "loja", "importacao", "alerta", "rastreamento", "creditos"])
    );
  });

  it("hrefAtividade guarda tipo e busca, e some com o que esta vazio", () => {
    expect(hrefAtividade(null, "")).toBe("/activity");
    expect(hrefAtividade("alerta", "")).toBe("/activity?tipo=alerta");
    expect(hrefAtividade(null, "  lash ")).toBe("/activity?q=lash");
    expect(hrefAtividade("importacao", "ali express")).toBe("/activity?tipo=importacao&q=ali+express");
  });
});

describe("filtro de loja nas rotas", () => {
  const rotas = [
    { id: "r1", source_store_id: "l3", target_store_id: "l1", created_at: "2026-09-01T00:00:00Z" },
    { id: "r2", source_store_id: "l9", target_store_id: "l9", created_at: "2026-09-02T00:00:00Z" },
  ];
  const destinos = [
    { id: "d1", route_id: "r1", target_store_id: "l1", created_at: "2026-09-01T00:00:00Z" },
    { id: "d2", route_id: "r2", target_store_id: "l2", created_at: "2026-09-03T00:00:00Z" },
  ];

  it("vitrine, checkout principal e destino do rodizio contam", () => {
    expect([...rotasDaLoja(rotas, destinos, "l3")]).toEqual(["r1"]);
    expect([...rotasDaLoja(rotas, destinos, "l1")]).toEqual(["r1"]);
    expect([...rotasDaLoja(rotas, destinos, "l2")]).toEqual(["r2"]);
    expect([...rotasDaLoja(rotas, destinos, "lx")]).toEqual([]);
  });
});

describe("linha do banco vira evento", () => {
  const rotas = [{ id: "r1", source_store_id: "l3", target_store_id: "l1", created_at: "2026-09-01T00:00:00Z" }];
  const destinos = [{ id: "d1", route_id: "r1", target_store_id: "l1", created_at: "2026-09-01T00:00:00Z" }];
  const ctx = montarContexto(LOJAS, rotas, destinos);

  it("loja conectada leva ao detalhe da loja, sem nome de tabela", () => {
    const [e] = montarEventos(
      com({ lojas: [{ id: "l1", name: "velho", shop_domain: "qkgknv-w3.myshopify.com", created_at: "2026-10-01T10:00:00Z" }] }),
      ctx
    );
    expect(e.href).toBe("/stores/l1");
    expect(e.loja).toBe("Lash Bestie");
    expect(e.descricao).toBe("qkgknv-w3 entrou no xcart.");
    expect(JSON.stringify(e)).not.toMatch(/stores\.id|routed_checkout|clone_runs|tech/);
  });

  it("carrinho levado diz quantos itens e para qual loja de checkout", () => {
    const [e] = montarEventos(
      com({
        carrinhos: [
          { id: "c1", route_config_id: "r1", target_id: "d1", reason: "routed_ok", detail: "3 itens -> x.myshopify.com", created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      ctx
    );
    expect(e.titulo).toBe("Carrinho levado ao checkout");
    expect(e.descricao).toBe("3 itens da vitrine Vitrine Um foram para Lash Bestie.");
    expect(e.href).toBe(hrefRota("r1"));
    expect(e.selo).toBeNull();
  });

  it("carrinho com falha leva ao diagnostico da rota e tem palavra, nao so cor", () => {
    const eventos = montarEventos(
      com({
        carrinhos: [
          { id: "c2", route_config_id: "r1", target_id: null, reason: "cart_checkout_error", detail: "TypeError: Failed to fetch", created_at: "2026-10-01T10:00:00Z" },
          { id: "c3", route_config_id: "r1", target_id: null, reason: "loader_ready", detail: "/cart", created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      ctx
    );
    expect(eventos).toHaveLength(1);
    const [e] = eventos;
    expect(e.tom).toBe("err");
    expect(e.selo).toEqual({ tom: "err", texto: "Falhou" });
    expect(e.href).toBe("/clone/routed-checkout?rota=r1&aba=diagnostico");
    // A mensagem crua do navegador (em ingles) nao vai para a tela.
    expect(e.descricao).not.toMatch(/Failed|TypeError/);
  });

  it("le o aviso do script da vitrine", () => {
    expect(lerCarrinhoLevado("3 itens -> loja.myshopify.com")).toEqual({ itens: 3, dominio: "loja.myshopify.com" });
    expect(lerCarrinhoLevado(" itens -> ?")).toEqual({ itens: null, dominio: null });
    expect(lerCarrinhoLevado("qualquer coisa")).toEqual({ itens: null, dominio: null });
    expect(lerCarrinhoLevado(null)).toEqual({ itens: null, dominio: null });
  });

  it("aviso antigo sem destino acha a loja pelo dominio", () => {
    const comDominio = montarContexto(
      [...LOJAS, { id: "l4", nome: "Checkout Dois", dominio: "Checkout-2.myshopify.com" }],
      rotas,
      destinos
    );
    const [e] = montarEventos(
      com({
        carrinhos: [
          { id: "c5", route_config_id: "r1", target_id: null, reason: "routed_ok", detail: "2 itens -> checkout-2.myshopify.com", created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      comDominio
    );
    expect(e.descricao).toBe("2 itens da vitrine Vitrine Um foram para Checkout Dois.");
  });

  it("um item no singular", () => {
    const [e] = montarEventos(
      com({
        carrinhos: [
          { id: "c4", route_config_id: "r1", target_id: null, reason: "routed_ok", detail: "1 itens -> outra.myshopify.com", created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      ctx
    );
    expect(e.descricao).toBe("1 item da vitrine Vitrine Um foi para outra.");
  });

  it("importacao em lote: cada estado com a palavra certa", () => {
    const base = { store_id: "l2", origem: "https://www.aliexpress.com/item/1005001.html", created_at: "2026-10-01T10:00:00Z" };
    const eventos = montarEventos(
      com({
        jobs: [
          { ...base, id: "j1", status: "pending" },
          { ...base, id: "j2", status: "processing" },
          { ...base, id: "j3", status: "completed" },
          { ...base, id: "j4", status: "failed" },
        ],
      }),
      ctx
    );
    expect(eventos.map((e) => e.selo?.texto ?? null)).toEqual(["Na fila", "Rodando", null, "Falhou"]);
    expect(eventos.map((e) => e.tom)).toEqual(["neutral", "run", "ok", "err"]);
    expect(eventos[0].descricao).toBe("aliexpress.com/item/1005001.html para Softnook.");
    expect(eventos.every((e) => e.href === "/bulk")).toBe(true);
  });

  it("origem curta corta link comprido", () => {
    expect(origemCurta("https://www.loja.com/")).toBe("loja.com");
    expect(origemCurta("")).toBe("um link");
    const longa = origemCurta(`https://site.com/${"a".repeat(100)}`);
    expect(longa.length).toBe(48);
    expect(longa.endsWith("…")).toBe(true);
  });

  it("alerta resolvido vira dois eventos: abriu e fechou", () => {
    const eventos = montarEventos(
      com({
        alertasAbertos: [
          { id: "a1", store_id: "l1", severidade: "critico", titulo: "Gasto sem venda", aberto_em: "2026-10-01T10:00:00Z", resolvido_em: "2026-10-01T12:00:00Z" },
        ],
        alertasResolvidos: [
          { id: "a1", store_id: "l1", severidade: "critico", titulo: "Gasto sem venda", aberto_em: "2026-10-01T10:00:00Z", resolvido_em: "2026-10-01T12:00:00Z" },
        ],
      }),
      ctx
    );
    expect(eventos.map((e) => [e.titulo, e.selo?.texto ?? null, e.href])).toEqual([
      ["Alerta aberto", "Crítico", "/alertas?aba=resolvidos"],
      ["Alerta resolvido", null, "/alertas?aba=resolvidos"],
    ]);
    expect(new Set(eventos.map((e) => e.id)).size).toBe(2);
  });

  it("alerta ainda aberto leva aos abertos", () => {
    const [e] = montarEventos(
      com({
        alertasAbertos: [
          { id: "a2", store_id: null, severidade: "aviso", titulo: "Sem venda", aberto_em: "2026-10-01T10:00:00Z", resolvido_em: null },
        ],
      }),
      ctx
    );
    expect(e.href).toBe("/alertas");
    expect(e.selo?.texto).toBe("Aviso");
    expect(e.loja).toBeNull();
  });

  it("envio de compras ligado leva ao rastreamento da loja", () => {
    const eventos = montarEventos(
      com({
        rastreamento: [
          { id: "t1", store_id: "l1", plataforma: "meta", nome: "Pixel novo", ativo: true, created_at: "2026-10-01T10:00:00Z" },
          { id: "t2", store_id: "l1", plataforma: "google", nome: null, ativo: false, created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      ctx
    );
    expect(eventos[0].titulo).toBe("Envio de compras para o Meta ligado");
    expect(eventos[0].descricao).toContain("(Pixel novo)");
    expect(eventos[0].href).toBe("/stores/l1?aba=rastreamento");
    expect(eventos[1].titulo).toBe("Envio de compras para o Google Ads ligado");
    expect(eventos[1].selo?.texto).toBe("Desativado");
  });

  it("compras: pago, pendente, nao pago e devolvido", () => {
    const base: Omit<LinhaCompra, "id" | "status"> = {
      kind: "credits",
      method: "pix",
      credits: 200,
      amount_cents: 4990,
      currency: "brl",
      created_at: "2026-10-01T10:00:00Z",
    };
    const eventos = montarEventos(
      com({
        compras: [
          { ...base, id: "p1", status: "paid" },
          { ...base, id: "p2", status: "pending" },
          { ...base, id: "p3", status: "expired" },
          { ...base, id: "p4", status: "refunded" },
          { ...base, id: "p5", status: "paid", kind: "pro_month", credits: 20 },
        ],
      }),
      ctx
    );
    expect(eventos.map((e) => e.titulo)).toEqual([
      "Créditos comprados",
      "Pix gerado",
      "Pix não pago",
      "Pagamento devolvido",
      "Plano Pro pago",
    ]);
    expect(eventos[0].descricao).toMatch(/^200 créditos por R\$\s?49,90, pago por Pix\.$/);
    expect(eventos[1].selo?.texto).toBe("Sem confirmação");
    expect(eventos.every((e) => e.href === "/billing" && e.loja === null)).toBe(true);
  });

  it("importacao do assistente: concluida, prévia e falha", () => {
    const eventos = montarEventos(
      com({
        clones: [
          { id: "k1", source_domain: "origem.com", target_store_id: "l2", action: "apply", status: "completed", product_count: 1, created_at: "2026-10-01T10:00:00Z" },
          { id: "k2", source_domain: "origem.com", target_store_id: null, action: "preview", status: "completed", product_count: 12, created_at: "2026-10-01T10:00:00Z" },
          { id: "k3", source_domain: "origem.com", target_store_id: "l2", action: "apply", status: "failed", product_count: 0, created_at: "2026-10-01T10:00:00Z" },
        ],
      }),
      ctx
    );
    expect(eventos.map((e) => e.descricao)).toEqual([
      "1 produto de origem.com para Softnook.",
      "12 produtos encontrados em origem.com.",
      "A importação de origem.com não terminou.",
    ]);
    expect(eventos[2].selo?.texto).toBe("Falhou");
  });

  it("nenhum texto com plural (s)", () => {
    const tudo = montarEventos(
      com({
        lojas: [{ id: "l1", name: "a", shop_domain: "a.myshopify.com", created_at: "2026-10-01T10:00:00Z" }],
        clones: [{ id: "k1", source_domain: "o.com", target_store_id: "l2", action: "apply", status: "completed", product_count: 3, created_at: "2026-10-01T10:00:00Z" }],
      }),
      ctx
    );
    for (const e of tudo) expect(`${e.titulo} ${e.descricao}`).not.toMatch(/\(s\)/);
  });
});

describe("pagina", () => {
  it("ordena do mais novo e corta no limite", () => {
    const eventos = [
      ev("a", "2026-10-01T10:00:00Z"),
      ev("b", "2026-10-03T10:00:00Z"),
      ev("c", "2026-10-02T10:00:00Z"),
    ];
    const { itens, proximo } = paginar(eventos, 2, false);
    expect(itens.map((e) => e.id)).toEqual(["b", "c"]);
    expect(proximo).toBe("2026-10-02T10:00:00Z");
  });

  it("sem sobra e sem fonte cheia, nao ha proxima pagina", () => {
    expect(paginar([ev("a", "2026-10-01T10:00:00Z")], 2, false).proximo).toBeNull();
    expect(paginar([], LIMITE_PAGINA, true).proximo).toBeNull();
  });

  it("fonte cheia pede proxima pagina mesmo sem sobra", () => {
    expect(paginar([ev("a", "2026-10-01T10:00:00Z")], 2, true).proximo).toBe("2026-10-01T10:00:00Z");
  });

  it("empate no instante: a ordem nao varia", () => {
    const eventos = [ev("z", "2026-10-01T10:00:00Z"), ev("a", "2026-10-01T10:00:00Z")];
    expect(paginar(eventos, 5, false).itens.map((e) => e.id)).toEqual(["a", "z"]);
  });

  it("juntar paginas tira o repetido do instante da borda", () => {
    const atuais = [ev("a", "2026-10-02T10:00:00Z"), ev("b", "2026-10-01T10:00:00Z")];
    const novos = [ev("b", "2026-10-01T10:00:00Z"), ev("c", "2026-09-30T10:00:00Z")];
    expect(juntarPaginas(atuais, novos).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("cursor inclusivo para as fontes lidas inteiras", () => {
    expect(ateOCursor("2026-10-01T10:00:00Z", null)).toBe(true);
    expect(ateOCursor("2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z")).toBe(true);
    expect(ateOCursor("2026-10-01T10:00:01Z", "2026-10-01T10:00:00Z")).toBe(false);
  });
});

describe("dia e hora", () => {
  const agora = Date.parse("2026-10-03T15:00:00Z"); // 12:00 em Sao Paulo

  it("rotulo do dia", () => {
    expect(rotuloDia("2026-10-03", "2026-10-03")).toBe("Hoje");
    expect(rotuloDia("2026-10-02", "2026-10-03")).toBe("Ontem");
    expect(rotuloDia("2026-09-26", "2026-10-03")).toBe("Sábado, 26 de setembro");
    expect(rotuloDia("2025-09-26", "2026-10-03")).toBe("Sexta-feira, 26 de setembro de 2025");
  });

  it("hora relativa e absoluta", () => {
    expect(relativo("2026-10-03T14:59:40Z", agora)).toBe("agora");
    expect(relativo("2026-10-03T14:55:00Z", agora)).toBe("há 5 min");
    expect(relativo("2026-10-03T12:00:00Z", agora)).toBe("há 3 h");
    expect(relativo("2026-10-02T14:00:00Z", agora)).toBe("há 1 dia");
    expect(relativo("2026-09-30T15:00:00Z", agora)).toBe("há 3 dias");
    expect(relativo("2026-09-20T15:00:00Z", agora)).toBeNull();
    expect(horaCurta("2026-10-03T15:04:00Z", SP)).toBe("12:04");
    expect(horaCurta("lixo", SP)).toBe("—");
  });

  it("agrupa pelo dia no fuso, nao em UTC", () => {
    const grupos = agruparPorDia(
      [
        ev("a", "2026-10-03T14:00:00Z"),
        // 01:30 UTC do dia 3 ainda e dia 2 em Sao Paulo.
        ev("b", "2026-10-03T01:30:00Z"),
        ev("c", "2026-10-02T12:00:00Z"),
        ev("d", "2026-09-26T12:00:00Z"),
      ],
      SP,
      agora
    );
    expect(grupos.map((g) => [g.rotulo, g.eventos.map((e) => e.id)])).toEqual([
      ["Hoje", ["a"]],
      ["Ontem", ["b", "c"]],
      ["Sábado, 26 de setembro", ["d"]],
    ]);
  });

  it("contagem no singular e no plural", () => {
    expect(eventosTexto(1)).toBe("1 evento");
    expect(eventosTexto(3)).toBe("3 eventos");
  });
});

describe("busca", () => {
  const eventos = [
    ev("a", "2026-10-03T10:00:00Z", { titulo: "Importação concluída", loja: "Lash Bestie", tipo: "importacao" }),
    ev("b", "2026-10-03T10:00:00Z", { titulo: "Alerta aberto", descricao: "Gasto sem venda", tipo: "alerta", selo: { tom: "err", texto: "Crítico" } }),
  ];

  it("ignora acento e caixa, e todos os termos precisam casar", () => {
    expect(normalizar("  Importação ")).toBe("importacao");
    expect(buscar(eventos, "importacao").map((e) => e.id)).toEqual(["a"]);
    expect(buscar(eventos, "LASH importação").map((e) => e.id)).toEqual(["a"]);
    expect(buscar(eventos, "critico").map((e) => e.id)).toEqual(["b"]);
    expect(buscar(eventos, "lash critico")).toEqual([]);
    expect(buscar(eventos, "   ")).toHaveLength(2);
  });
});

describe("a tela segue o vocabulario do redesign", () => {
  const pasta = path.resolve(__dirname, "..", "src", "app", "(dashboard)", "activity");
  const arquivos = readdirSync(pasta).filter((f) => /\.tsx?$/.test(f));

  it("sem valor solto, cor em style, confirm nativo, select cru ou detalhe tecnico", () => {
    expect(arquivos.length).toBeGreaterThan(4);
    for (const f of arquivos) {
      const fonte = readFileSync(path.join(pasta, f), "utf8");
      expect(fonte, f).not.toMatch(/text-\[\d/);
      expect(fonte, f).not.toMatch(/\[var\(--/);
      expect(fonte, f).not.toMatch(/style=\{\{/);
      expect(fonte, f).not.toMatch(/window\.confirm|confirm\(/);
      expect(fonte, f).not.toMatch(/<select|type="checkbox"/);
      expect(fonte, f).not.toMatch(/Detalhes técnicos|\(s\)/);
      expect(fonte, f).not.toMatch(/border-solid|outline-solid/);
    }
  });
});
