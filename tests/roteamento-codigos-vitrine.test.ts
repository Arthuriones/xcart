import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * Os codigos que a aba Instalacao (e o fim do assistente) manda colar no tema
 * da VITRINE tem que ser os mesmos que o sistema espera:
 *   - o script do roteamento aponta para o loader que existe e leva o token
 *     no atributo que o loader le;
 *   - a linha do referrer e a MESMA que o Instalar na vitrine escreve;
 *   - a tag de rastreamento sai da mesma montarTag do botao Instalar, com a
 *     loja certa e o formato de id do Google da loja.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/shopify/client", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

type Linha = Record<string, unknown>;

let usuario: { id: string } | null = null;
let noTema: boolean | null | "lanca" = null;
const banco: Record<string, Linha[]> = {};

/** Consulta encadeavel: so os filtros que a rota usa (eq, order, maybeSingle). */
function consulta(tabela: string) {
  let linhas = [...(banco[tabela] ?? [])];
  const q = {
    select: () => q,
    eq: (coluna: string, valor: unknown) => {
      linhas = linhas.filter((l) => l[coluna] === valor);
      return q;
    },
    order: () => q,
    maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
    then: (ok: (r: { data: Linha[]; error: null }) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from: (tabela: string) => consulta(tabela),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (tabela: string) => consulta(tabela) }),
}));
vi.mock("@/lib/leitura/guia-configuracao", () => ({
  tagScriptNoTema: (id: string) => `guia-script-tema-${id}`,
  scriptNoTemaDaLoja: async () => {
    if (noTema === "lanca") throw new Error("shopify fora");
    return noTema;
  },
}));

import { META_REFERRER, codigoDoScript } from "@/app/(dashboard)/clone/routed-checkout/logica";
import { comMetaReferrer } from "@/lib/checkout-routes/tema-script";
import { montarTag } from "@/lib/tracking/snippet-tema";
import { GET } from "@/app/api/tracking/snippet/route";

const APP = "https://user.xcart.app";
const raiz = path.resolve(__dirname, "..");
const ler = (...p: string[]) => readFileSync(path.join(raiz, ...p), "utf8");

function pedir(storeId?: string) {
  const url = storeId ? `${APP}/api/tracking/snippet?storeId=${storeId}` : `${APP}/api/tracking/snippet`;
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  usuario = { id: "u1" };
  noTema = null;
  banco.stores = [
    { id: "vitrine-1", user_id: "u1" },
    { id: "loja-alheia", user_id: "u2" },
  ];
  banco.tracking_configs = [{ store_id: "vitrine-1", enabled: true }];
  banco.tracking_destinations = [
    {
      store_id: "vitrine-1",
      plataforma: "google",
      ativo: true,
      conta: "AW-123",
      id_template: "shopify_BR_{product_id}_{variant_id}",
    },
  ];
});

describe("linha do referrer", () => {
  it("e exatamente a meta same-origin", () => {
    expect(META_REFERRER).toBe('<meta name="referrer" content="same-origin">');
  });

  it("e a mesma que o Instalar na vitrine poe no tema", () => {
    const tema = '<html>\n<head class="x">\n<title>Loja</title>\n</head>\n</html>';
    const instalado = comMetaReferrer(tema);
    expect(instalado).toContain(META_REFERRER);
    // Colada a linha, o Instalar nao poe outra: as duas nao brigam.
    expect(comMetaReferrer(tema.replace("</head>", `${META_REFERRER}\n</head>`))).toBe(
      tema.replace("</head>", `${META_REFERRER}\n</head>`)
    );
  });
});

describe("script do roteamento", () => {
  it("aponta para o loader que existe e leva o token no atributo que ele le", () => {
    const codigo = codigoDoScript(APP, "tok-9");
    expect(codigo).toContain(`src="${APP}/routed-checkout-loader.js"`);
    expect(codigo).toContain('data-token="tok-9"');
    expect(existsSync(path.join(raiz, "public", "routed-checkout-loader.js"))).toBe(true);
    expect(ler("public", "routed-checkout-loader.js")).toContain("scriptTag.dataset.token");
  });
});

describe("tag de rastreamento da vitrine", () => {
  it("o xcart-click.js le a loja pelo atributo que a tag leva", () => {
    const tag = montarTag("vitrine-1", [], null);
    expect(tag).toBe(`<script src="${APP}/xcart-click.js" data-xcart-click data-xcart-store="vitrine-1" defer></script>`);
    const snippet = ler("public", "xcart-click.js");
    expect(snippet).toContain('getAttribute("data-xcart-store")');
    expect(snippet).toContain("script[data-xcart-click]");
  });

  it("GET devolve a tag da loja pedida, igual a do botao Instalar", async () => {
    noTema = true;
    const r = await pedir("vitrine-1");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.codigo).toBe(montarTag("vitrine-1", [], "shopify_BR_{product_id}_{variant_id}"));
    expect(j.codigo).toContain('data-xcart-store="vitrine-1"');
    expect(j.codigo).toContain('data-xcart-id-template="shopify_BR_{product_id}_{variant_id}"');
    // O padrao do Instalar e sem o atributo de remarketing.
    expect(j.codigo).not.toContain("data-xcart-remarketing");
    expect(j.instalado).toBe(true);
    expect(j.ligado).toBe(true);
  });

  it("rastreamento desligado e tema sem resposta aparecem como tal", async () => {
    banco.tracking_configs = [];
    noTema = "lanca";
    const j = await (await pedir("vitrine-1")).json();
    expect(j.ligado).toBe(false);
    expect(j.instalado).toBeNull();
    expect(j.codigo).toContain('data-xcart-store="vitrine-1"');
  });

  it("so entrega a tag da loja do proprio usuario", async () => {
    expect((await pedir("loja-alheia")).status).toBe(404);
    expect((await pedir()).status).toBe(400);
    usuario = null;
    expect((await pedir("vitrine-1")).status).toBe(401);
  });
});
