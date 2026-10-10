import { describe, expect, it } from "vitest";
import { PLATAFORMAS_CHECKOUT, passoDoNovo } from "../src/lib/checkouts-externos/tipos";
import {
  OPCOES_CONECTAR,
  ROTA_CONECTAR_OPERACAO,
  RESUMO_CHECKOUT_EXTERNO,
  ROTULO_CONECTAR_OPERACAO,
  rotuloContagem,
  voltarParaEscolha,
} from "../src/lib/conectar-operacao";

/**
 * "Conectar operação" (/conectar): a escolha entre loja Shopify e checkout
 * externo. Cada opcao cai no fluxo que ja existe, aberto no passo certo, e o
 * Voltar devolve a escolha. Plataforma "em breve" aparece sem link.
 */
describe("opcoes do Conectar operação", () => {
  const porId = Object.fromEntries(OPCOES_CONECTAR.map((o) => [o.id, o]));

  it("loja Shopify e checkout externo, nesta ordem, cada um com o que traz", () => {
    expect(ROTA_CONECTAR_OPERACAO).toBe("/conectar");
    expect(ROTULO_CONECTAR_OPERACAO).toBe("Conectar operação");
    expect(OPCOES_CONECTAR.map((o) => o.id)).toEqual(["loja", "checkout"]);
    expect(OPCOES_CONECTAR.map((o) => o.titulo)).toEqual(["Loja Shopify", "Checkout externo"]);
    for (const o of OPCOES_CONECTAR) {
      expect(o.texto.length, o.id).toBeGreaterThan(0);
      expect(o.traz.length, o.id).toBeGreaterThan(0);
      expect(o.destinos.length, o.id).toBeGreaterThan(0);
      const ids = o.destinos.map((d) => d.id);
      expect(new Set(ids).size, o.id).toBe(ids.length);
    }
  });

  it("loja: abre o assistente de /stores ja aberto, sabendo voltar", () => {
    const [shopify] = porId.loja.destinos;
    expect(porId.loja.destinos).toHaveLength(1);
    expect(shopify.href).toBe("/stores?conectar=1&de=conectar");
    expect(shopify.cta).toBe("Conectar loja");
    const url = new URL(shopify.href!, "https://x.test");
    expect(url.pathname).toBe("/stores");
    expect(url.searchParams.get("conectar")).toBe("1");
    expect(voltarParaEscolha(url.searchParams.get("de"))).toBe("/conectar");
  });

  it("checkout: uma linha por plataforma; so a ativa tem link, e cai no nome e moeda", () => {
    const destinos = porId.checkout.destinos;
    expect(destinos.map((d) => d.id)).toEqual(PLATAFORMAS_CHECKOUT.map((p) => p.id));
    for (const p of PLATAFORMAS_CHECKOUT) {
      const d = destinos.find((x) => x.id === p.id)!;
      expect(d.nome).toBe(p.nome);
      if (!p.ativa) {
        expect(d.href, p.id).toBeNull();
        expect(d.descricao, p.id).toBe("");
        continue;
      }
      expect(d.href).toBe(`/integracoes/checkouts?novo=${p.id}&de=conectar`);
      const url = new URL(d.href!, "https://x.test");
      expect(url.pathname).toBe("/integracoes/checkouts");
      expect(passoDoNovo(url.searchParams.get("novo"))).toBe("dados");
      expect(voltarParaEscolha(url.searchParams.get("de"))).toBe("/conectar");
    }
  });

  it("so promete o que o app mostra: lucro por campanha nao existe", () => {
    const tudo = OPCOES_CONECTAR.flatMap((o) => [o.texto, ...o.traz]).join(" ");
    expect(tudo).not.toMatch(/lucro (por produto e )?por campanha/i);
    expect(porId.checkout.texto).toBe(RESUMO_CHECKOUT_EXTERNO);
  });

  it("hoje: Sphere ativa; Yampi, CartPanda e Kiwify em breve", () => {
    const ativos = porId.checkout.destinos.filter((d) => d.href).map((d) => d.id);
    const emBreve = porId.checkout.destinos.filter((d) => !d.href).map((d) => d.id);
    expect(ativos).toEqual(["sphere"]);
    expect(emBreve).toEqual(["yampi", "cartpanda", "kiwify"]);
  });
});

describe("?novo= em Integracoes > Checkouts", () => {
  it("plataforma ativa vai ao nome e moeda; o resto abre na escolha; sem parametro, nada abre", () => {
    expect(passoDoNovo("sphere")).toBe("dados");
    expect(passoDoNovo("1")).toBe("plataforma");
    expect(passoDoNovo("yampi")).toBe("plataforma");
    expect(passoDoNovo("qualquer")).toBe("plataforma");
    expect(passoDoNovo(null)).toBeNull();
    expect(passoDoNovo(undefined)).toBeNull();
    expect(passoDoNovo("")).toBeNull();
    expect(passoDoNovo(["sphere", "1"])).toBeNull();
  });
});

describe("Voltar para a escolha", () => {
  it("so com de=conectar, e o destino e sempre /conectar (nunca o que veio na URL)", () => {
    expect(voltarParaEscolha("conectar")).toBe("/conectar");
    expect(voltarParaEscolha("https://outro.site")).toBeNull();
    expect(voltarParaEscolha("/financeiro")).toBeNull();
    expect(voltarParaEscolha(["conectar"])).toBeNull();
    expect(voltarParaEscolha(null)).toBeNull();
    expect(voltarParaEscolha(undefined)).toBeNull();
  });
});

describe("selo de contagem", () => {
  const loja = OPCOES_CONECTAR[0].contagem;
  const checkout = OPCOES_CONECTAR[1].contagem;

  it("singular e plural", () => {
    expect(rotuloContagem(1, loja)).toBe("1 conectada");
    expect(rotuloContagem(3, loja)).toBe("3 conectadas");
    expect(rotuloContagem(1, checkout)).toBe("1 conectado");
    expect(rotuloContagem(2, checkout)).toBe("2 conectados");
  });

  it("zero ou leitura que falhou: sem selo, nunca '0'", () => {
    expect(rotuloContagem(0, loja)).toBeNull();
    expect(rotuloContagem(null, loja)).toBeNull();
    expect(rotuloContagem(Number.NaN, loja)).toBeNull();
  });
});
