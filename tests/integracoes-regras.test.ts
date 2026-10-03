import { describe, expect, it } from "vitest";
import type { ContaAnuncioResumo } from "../src/lib/financeiro/tipos";
import {
  casaBusca,
  contarFiltros,
  estadoDaLoja,
  estadoDoDestino,
  estadoScriptsGoogle,
  estadoTokenMeta,
  estadosDaNav,
  formatarCustomerId,
  gastoNaTela,
  listarNomes,
  passaNoFiltro,
  quando,
  semAcesso,
  situacaoDaConta,
  textoDoGasto,
} from "../src/app/(dashboard)/integracoes/regras";

// Regras da tela Integracoes. O selo da conta, o contador do filtro e o ponto
// do menu leem daqui; o que se trava e a ordem das regras (pausada antes de
// erro, erro antes de sem loja) e que nada sem dado vira "tudo certo".

const SP = "America/Sao_Paulo";
const AGORA = Date.parse("2026-10-02T17:30:00Z"); // 14:30 em Sao Paulo

function conta(p: Partial<ContaAnuncioResumo> = {}): ContaAnuncioResumo {
  return {
    id: "c1",
    plataforma: "meta",
    external_id: "10294811",
    nome: "Lumen · Principal",
    moeda: "USD",
    fuso: "America/New_York",
    store_id: "loja-1",
    ativo: true,
    fonte: "api",
    ultimo_sync_ok_em: "2026-10-02T17:20:00Z",
    ultimo_erro: null,
    temSegredo: true,
    ...p,
  };
}

describe("quando", () => {
  it("hoje mostra só a hora; outro dia mostra a data", () => {
    expect(quando("2026-10-02T17:20:00Z", AGORA, SP)).toBe("às 14:20");
    expect(quando("2026-09-28T12:00:00Z", AGORA, SP)).toBe("em 28/09 às 09:00");
  });
});

describe("situacaoDaConta", () => {
  it("atualizada", () => {
    const s = situacaoDaConta(conta(), AGORA, SP);
    expect(s).toMatchObject({ grupo: "ok", tom: "ok", texto: "Atualizada", detalhe: "às 14:20" });
  });

  it("pausada vem antes do erro (o cron não lê conta pausada)", () => {
    const s = situacaoDaConta(conta({ ativo: false, ultimo_erro: "x" }), AGORA, SP);
    expect(s.grupo).toBe("pausada");
    expect(s.tom).toBe("neutral");
  });

  it("erro vem antes de sem loja", () => {
    expect(situacaoDaConta(conta({ ultimo_erro: "Sem permissão", store_id: null }), AGORA, SP)).toMatchObject({
      grupo: "problema",
      tom: "err",
      detalhe: "Sem permissão",
    });
    expect(situacaoDaConta(conta({ store_id: null }), AGORA, SP).grupo).toBe("semLoja");
  });

  it("Meta sem token pede ação; Google não tem token", () => {
    expect(situacaoDaConta(conta({ temSegredo: false }), AGORA, SP).texto).toBe("Sem token");
    expect(
      situacaoDaConta(conta({ plataforma: "google", temSegredo: false }), AGORA, SP).texto
    ).toBe("Atualizada");
  });

  it("nunca leu: aguardando", () => {
    expect(situacaoDaConta(conta({ ultimo_sync_ok_em: null }), AGORA, SP)).toMatchObject({
      grupo: "aguardando",
      tom: "run",
    });
  });

  it("atrasada pelo mesmo limite do alerta (90 min Meta, 3 h Google)", () => {
    const duasHoras = new Date(AGORA - 2 * 3600_000).toISOString();
    expect(situacaoDaConta(conta({ ultimo_sync_ok_em: duasHoras }), AGORA, SP).texto).toBe("Atrasada");
    expect(
      situacaoDaConta(conta({ plataforma: "google", ultimo_sync_ok_em: duasHoras }), AGORA, SP).texto
    ).toBe("Atualizada");
    const quatroHoras = new Date(AGORA - 4 * 3600_000).toISOString();
    expect(
      situacaoDaConta(conta({ plataforma: "google", ultimo_sync_ok_em: quatroHoras }), AGORA, SP).grupo
    ).toBe("problema");
  });
});

describe("filtros e busca", () => {
  it("cada grupo cai no filtro certo e todas conta tudo", () => {
    const n = contarFiltros(["ok", "aguardando", "semLoja", "problema", "pausada", "ok"]);
    expect(n).toEqual({ todas: 6, ligadas: 3, semLoja: 1, problema: 1, pausadas: 1 });
    expect(passaNoFiltro("pausada", "ligadas")).toBe(false);
  });

  it("busca por nome sem acento e por ID em qualquer formato", () => {
    const c = { nome: "Órla · Teste criativos", external_id: "1234567890" };
    expect(casaBusca(c, "orla")).toBe(true);
    expect(casaBusca(c, "CRIATIVOS")).toBe(true);
    expect(casaBusca(c, "123-456")).toBe(true);
    expect(casaBusca(c, "act_1234567890")).toBe(true);
    expect(casaBusca(c, "kova")).toBe(false);
    expect(casaBusca(c, "  ")).toBe(true);
  });
});

describe("gasto na tela", () => {
  it("mesma moeda: só o número", () => {
    expect(
      textoDoGasto({ valor: 10, original: 10, moedaOriginal: "BRL", convertido: true, aproximado: false }, "BRL")
    ).toMatchObject({ detalhe: null, valor: 10 });
  });

  it("moeda diferente mostra embaixo o valor na moeda da conta", () => {
    const t = textoDoGasto(
      { valor: 53.2, original: 10, moedaOriginal: "USD", convertido: true, aproximado: false },
      "BRL"
    )!;
    expect(t.texto).toContain("53,20");
    expect(t.detalhe).toContain("US$");
  });

  it("sem cotação fica na moeda da conta e avisa", () => {
    const t = textoDoGasto(
      { valor: 10, original: 10, moedaOriginal: "USD", convertido: false, aproximado: false },
      "BRL"
    )!;
    expect(t.texto).toContain("US$");
    expect(t.detalhe).toBe("sem cotação");
  });

  it("câmbio aproximado ganha ≈", () => {
    const t = textoDoGasto(
      { valor: 54, original: 10, moedaOriginal: "USD", convertido: true, aproximado: true },
      "BRL"
    )!;
    expect(t.texto.startsWith("≈ ")).toBe(true);
  });

  it("sem dado é null, não zero; período incompleto diz desde quando", () => {
    expect(textoDoGasto(null, "BRL")).toBeNull();
    const g = gastoNaTela(
      {
        hoje: null,
        periodo: { valor: 5, original: 5, moedaOriginal: "BRL", convertido: true, aproximado: false },
        diasComDado: 3,
        diasNoPeriodo: 7,
        primeiroDia: "2026-09-30",
      },
      "BRL"
    );
    expect(g.hoje).toBeNull();
    expect(g.parcial).toBe("desde 30/09");
    expect(gastoNaTela(undefined, "BRL")).toEqual({ hoje: null, periodo: null, parcial: null });
  });
});

describe("leitura do gasto", () => {
  it("token do Meta", () => {
    expect(estadoTokenMeta([]).texto).toBe("Não ligado");
    expect(estadoTokenMeta([conta({ temSegredo: false })]).texto).toBe("Sem token");
    expect(
      estadoTokenMeta([conta({ ultimo_erro: "Token do Meta recusado (190). Gere outro." })]).tom
    ).toBe("err");
    expect(estadoTokenMeta([conta()]).texto).toBe("Válido");
    expect(estadoTokenMeta([conta({ ultimo_sync_ok_em: null })]).tom).toBe("run");
  });

  it("scripts do Google", () => {
    const ok = situacaoDaConta(conta({ plataforma: "google" }), AGORA, SP);
    const atrasada = situacaoDaConta(
      conta({ plataforma: "google", ultimo_sync_ok_em: "2026-10-01T00:00:00Z" }),
      AGORA,
      SP
    );
    expect(estadoScriptsGoogle([]).texto).toBe("Nenhuma conta");
    expect(estadoScriptsGoogle([ok]).tom).toBe("ok");
    expect(estadoScriptsGoogle([ok, atrasada]).tom).toBe("warn");
  });
});

describe("estadoDoDestino", () => {
  const base = {
    plataforma: "meta" as const,
    ativo: true,
    temToken: true,
    rotulos: 0,
    rotuloCompra: false,
    modoTeste: false,
    alertas: [],
  };

  it("desativado, sem token, recusado, teste e configurado", () => {
    expect(estadoDoDestino({ ...base, ativo: false }).texto).toBe("Desativado");
    expect(estadoDoDestino({ ...base, temToken: false }).texto).toBe("Sem token");
    expect(estadoDoDestino({ ...base, alertas: ["meta_capi_token"] }).texto).toBe("Token recusado");
    expect(estadoDoDestino({ ...base, alertas: ["envio_falhando"] }).texto).toBe("Falhando");
    expect(estadoDoDestino({ ...base, modoTeste: true }).tom).toBe("info");
    expect(estadoDoDestino(base)).toEqual({ tom: "ok", texto: "Configurado" });
  });

  it("Google precisa de rótulo, e de rótulo de compra para enviar a compra", () => {
    const g = { ...base, plataforma: "google" as const, temToken: false };
    expect(estadoDoDestino(g).texto).toBe("Incompleto");
    expect(estadoDoDestino({ ...g, rotulos: 2 }).texto).toBe("Sem rótulo de compra");
    expect(estadoDoDestino({ ...g, rotulos: 2, rotuloCompra: true }).texto).toBe("Configurado");
  });
});

describe("estadoDaLoja", () => {
  it("desinstalada, sem permissão, erro, conectada e aguardando", () => {
    expect(estadoDaLoja({ desinstaladaEm: "2026-09-20T12:00:00Z", sync: null }, AGORA, SP)).toMatchObject({
      texto: "App desinstalado",
      detalhe: "desde 20/09",
    });
    const negado = { desinstaladaEm: null, sync: { ultimoErroTipo: "negado" as const, ultimoErro: null, ultimoSyncOkEm: null } };
    expect(estadoDaLoja(negado, AGORA, SP).tom).toBe("err");
    expect(semAcesso(negado)).toBe(true);
    expect(
      estadoDaLoja(
        { desinstaladaEm: null, sync: { ultimoErroTipo: "falhou", ultimoErro: "Timeout", ultimoSyncOkEm: null } },
        AGORA,
        SP
      ).detalhe
    ).toBe("Timeout");
    expect(
      estadoDaLoja(
        { desinstaladaEm: null, sync: { ultimoErroTipo: null, ultimoErro: null, ultimoSyncOkEm: "2026-10-02T17:15:00Z" } },
        AGORA,
        SP
      )
    ).toMatchObject({ texto: "Conectada", detalhe: "pedidos lidos às 14:15" });
    expect(estadoDaLoja({ desinstaladaEm: null, sync: null }, AGORA, SP).tom).toBe("run");
  });
});

describe("estadosDaNav", () => {
  it("resume cada plataforma e não inventa estado sem dado", () => {
    const e = estadosDaNav({
      contas: [
        { plataforma: "meta", store_id: "l", ativo: true, ultimo_erro: null },
        { plataforma: "meta", store_id: null, ativo: true, ultimo_erro: null },
        { plataforma: "meta", store_id: null, ativo: false, ultimo_erro: null },
      ],
      lojas: { total: 4, semAcesso: 0 },
      telegram: false,
      tokensClaude: null,
    });
    expect(e.meta).toEqual({ tom: "warn", texto: "1 pendência" });
    expect(e.google).toEqual({ tom: "neutral", texto: "Não ligado" });
    expect(e.shopify).toEqual({ tom: "ok", texto: "4 lojas" });
    expect(e.notificacoes?.texto).toBe("Não ligado");
    expect(e.avancado).toBeNull();
    expect(estadosDaNav({ contas: null, lojas: null, telegram: null, tokensClaude: 0 }).meta).toBeNull();
  });
});

describe("textos", () => {
  it("ID do Google e lista de nomes", () => {
    expect(formatarCustomerId("1234567890")).toBe("123-456-7890");
    expect(formatarCustomerId("123")).toBe("123");
    expect(listarNomes(["A"])).toBe("A");
    expect(listarNomes(["A", "B", "C"])).toBe("A, B e C");
    expect(listarNomes(["A", "B", "C", "D", "E"])).toBe("A, B, C e mais 2");
  });
});
