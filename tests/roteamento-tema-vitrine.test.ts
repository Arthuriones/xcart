import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  URL_DO_CONFIG_LIQUID,
  configParaOTema,
  hashDoConfig,
  scriptDoLoader,
  trocarScriptNoTema,
} from "@/lib/checkout-routes/tema-script";
import { destinosParaRotear } from "@/lib/checkout-routes/targets";
import type { EmbedConfig } from "@/lib/checkout-routes/embed-config";

// ============================================================================
// O config embutido no tema da vitrine (xcart-config.json) tem que andar junto
// com o banco. Na NORAH o asset era de dois meses antes: 46 SKUs faltando, 13
// que o conserto ja tinha tirado ainda la apontando para a variante errada, e
// loja pausada no painel continuando a receber comprador pelo caminho inline.
// ============================================================================

const ORIGEM = "https://user.xcart.app";
const TOKEN = "tok-rota";

function tema(script: string) {
  return `<html>\n<head class="x">\n<title>Loja</title>\n${script}\n</head>\n<body></body>\n</html>`;
}

const SCRIPT_ANTIGO = `<script\n  src="${ORIGEM}/routed-checkout-loader.js"\n  data-token="${TOKEN}"\n  data-config-url="https://norah.com/cdn/shop/t/4/assets/xcart-config.json?v=1788812460"\n  async>\n</script>`;

describe("reenvio automatico ao tema", () => {
  it("troca a URL fixa do tema antigo (t/4 ?v=) pela do Liquid, que segue o tema publicado", () => {
    const { conteudo, troca } = trocarScriptNoTema(tema(SCRIPT_ANTIGO), {
      token: TOKEN,
      appOrigin: ORIGEM,
      instalar: false,
    });
    expect(troca).toBe("trocado");
    expect(conteudo).toContain(URL_DO_CONFIG_LIQUID);
    expect(conteudo).not.toContain("/t/4/");
    // Automatico nao mexe em mais nada do tema.
    expect(conteudo).not.toContain('name="referrer"');
  });

  it("script ja no formato Liquid: so o asset muda, o theme.liquid fica igual", () => {
    const atual = tema(scriptDoLoader(ORIGEM, TOKEN));
    const r = trocarScriptNoTema(atual, { token: TOKEN, appOrigin: ORIGEM, instalar: false });
    expect(r.troca).toBe("igual");
    expect(r.conteudo).toBe(atual);
  });

  it("script colado a mao (sem config embutido): le a API, nada a fazer", () => {
    const manual = `<script\n  src="${ORIGEM}/routed-checkout-loader.js"\n  data-token="${TOKEN}"\n  async>\n</script>`;
    const r = trocarScriptNoTema(tema(manual), { token: TOKEN, appOrigin: ORIGEM, instalar: false });
    expect(r.troca).toBe("sem_config_url");
  });

  it("script de OUTRA rota: nao toca no tema nem no asset dela", () => {
    const outra = SCRIPT_ANTIGO.replace(TOKEN, "tok-outra");
    const atual = tema(outra);
    const r = trocarScriptNoTema(atual, { token: TOKEN, appOrigin: ORIGEM, instalar: false });
    expect(r.troca).toBe("script_de_outra_rota");
    expect(r.conteudo).toBe(atual);
  });

  it("tema sem o script: automatico nunca instala sozinho", () => {
    const atual = tema("");
    const r = trocarScriptNoTema(atual, { token: TOKEN, appOrigin: ORIGEM, instalar: false });
    expect(r.troca).toBe("sem_script");
    expect(r.conteudo).toBe(atual);
  });

  it("mapa inteiro embutido no atributo (data-config) tambem e trocado", () => {
    const inline = `<script src="${ORIGEM}/routed-checkout-loader.js" data-token="${TOKEN}" data-config='{"domain":"x.myshopify.com"}' async></script>`;
    const r = trocarScriptNoTema(tema(inline), { token: TOKEN, appOrigin: ORIGEM, instalar: false });
    expect(r.troca).toBe("trocado");
    expect(r.conteudo).not.toContain("data-config='");
  });
});

describe("botao Instalar", () => {
  it("insere antes do </head> com a meta de referrer", () => {
    const r = trocarScriptNoTema(tema(""), { token: TOKEN, appOrigin: ORIGEM, instalar: true });
    expect(r.troca).toBe("inserido");
    expect(r.conteudo).toContain(`${scriptDoLoader(ORIGEM, TOKEN)}\n</head>`);
    expect(r.conteudo).toContain('<head class="x">\n  <meta name="referrer" content="same-origin">');
  });

  it("troca qualquer script do xcart pelo desta rota", () => {
    const r = trocarScriptNoTema(tema(SCRIPT_ANTIGO.replace(TOKEN, "tok-outra")), {
      token: TOKEN,
      appOrigin: ORIGEM,
      instalar: true,
    });
    expect(r.troca).toBe("trocado");
    expect(r.conteudo).toContain(`data-token="${TOKEN}"`);
    expect(r.conteudo).not.toContain("tok-outra");
  });

  it("sem </head>: avisa em vez de dizer que inseriu", () => {
    const r = trocarScriptNoTema("<div>sem head</div>", { token: TOKEN, appOrigin: ORIGEM, instalar: true });
    expect(r.troca).toBe("sem_script");
  });
});

describe("o que vai no asset", () => {
  const embed: EmbedConfig = {
    rotation: { strategy: "sticky" },
    targets: [
      { id: "t1", domain: "a.myshopify.com", weight: 1, skuMap: { a: "1" }, variantMap: { "9": "1" }, country: "BR", locale: "pt-BR" },
    ],
    domain: "a.myshopify.com",
    skuMap: { a: "1" },
    variantMap: { "9": "1" },
    country: "BR",
    locale: "pt-BR",
  };

  it("rota pausada vai sem destino: o loader pergunta a API, que recusa", () => {
    const pausada = configParaOTema(embed, false);
    expect(pausada.targets).toEqual([]);
    expect(pausada.domain).toBe("");
    expect(configParaOTema(embed, true)).toBe(embed);
  });

  it("hash muda com o mapa e so com ele", () => {
    const igual = JSON.parse(JSON.stringify(embed)) as EmbedConfig;
    expect(hashDoConfig(igual)).toBe(hashDoConfig(embed));
    const outro = { ...embed, targets: [{ ...embed.targets[0], skuMap: { a: "2" } }] };
    expect(hashDoConfig(outro)).not.toBe(hashDoConfig(embed));
  });
});

// ---------------------------------------------------------------------------

function supabaseCom(linhas: Record<string, unknown>[]): SupabaseClient {
  const api = {
    select: () => api,
    eq: () => api,
    order: () => api,
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas, error: null }).then(ok),
  };
  return { from: () => api } as unknown as SupabaseClient;
}

const ROTA = {
  id: "rota",
  target_store_id: "loja-original",
  sku_map: { a: "1" },
  variant_map: {},
  settings: {},
  target: { shop_domain: "original.myshopify.com" },
};

function linha(id: string, enabled: boolean) {
  return {
    id,
    target_store_id: id,
    weight: 1,
    enabled,
    sku_map: {},
    variant_map: {},
    settings: {},
    store: { shop_domain: `${id}.myshopify.com` },
  };
}

describe("destinos que recebem comprador (resolve e tema)", () => {
  it("rota sem nenhuma linha de destino: cai no legado", async () => {
    const r = await destinosParaRotear(supabaseCom([]), ROTA);
    expect(r.map((t) => t.domain)).toEqual(["original.myshopify.com"]);
  });

  it("todas as lojas pausadas: nenhum destino -- antes voltava ao legado e pausar nao pausava", async () => {
    const r = await destinosParaRotear(supabaseCom([linha("a", false)]), ROTA);
    expect(r).toEqual([]);
  });

  it("so as ligadas", async () => {
    const r = await destinosParaRotear(supabaseCom([linha("a", false), linha("b", true)]), ROTA);
    expect(r.map((t) => t.id)).toEqual(["b"]);
  });
});
