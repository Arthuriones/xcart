import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  gerarSegredo,
  hashSegredo,
  linhasDoIngest,
  normalizarCustomerId,
  segredoDoAuthorization,
  validarIngest,
} from "@/lib/ads/google-ingest";
import { scriptGoogleAds } from "@/lib/ads/google-script";
import type { GoogleIngestCorpo } from "@/lib/financeiro/tipos";

// ============================================================================
// O endpoint do script aceita VALOR MONETARIO que vai direto para o lucro.
// Estes testes travam o que ele recusa e como o corpo vira linha de gasto.
// ============================================================================

const AGORA = new Date("2026-10-02T15:00:00Z");

function corpo(extra: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    v: 1,
    customer_id: "123-456-7890",
    moeda: "BRL",
    fuso: "America/Sao_Paulo",
    inicio: "2026-09-30",
    fim: "2026-10-02",
    gerado_em: "2026-10-02T14:59:00.000Z",
    linhas: [
      {
        data: "2026-09-30",
        campanha_id: "111",
        campanha: "Cilios PMax",
        status: "ENABLED",
        custo_micros: "12340000",
        cliques: 10,
        impressoes: 500,
        conversoes: 1,
        valor_conversoes: 89.9,
      },
      {
        data: "2026-09-30",
        campanha_id: "222",
        campanha: "Pesquisa",
        custo_micros: 5000000,
        cliques: 3,
        impressoes: 40,
      },
      {
        data: "2026-10-02",
        campanha_id: "111",
        campanha: "Cilios PMax",
        custo_micros: "1000000",
        cliques: 1,
        impressoes: 20,
        conversoes: 0,
        valor_conversoes: 0,
      },
    ],
    ...extra,
  };
}

function linhaCom(extra: Record<string, unknown>) {
  const base = corpo();
  const linhas = base.linhas as Record<string, unknown>[];
  return { ...base, linhas: [{ ...linhas[0], ...extra }] };
}

function validado(c: Record<string, unknown> = corpo()): GoogleIngestCorpo {
  const r = validarIngest(c, AGORA);
  if (!r.ok) throw new Error(r.erro);
  return r.corpo;
}

describe("validarIngest", () => {
  it("aceita o corpo do script com custo_micros em string e em numero", () => {
    const r = validarIngest(corpo(), AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.corpo.customer_id).toBe("1234567890");
      expect(r.corpo.linhas).toHaveLength(3);
      expect(r.corpo.linhas[1].custo_micros).toBe("5000000");
    }
  });

  it("aceita lista de linhas vazia (conta sem gasto na janela)", () => {
    expect(validarIngest(corpo({ linhas: [] }), AGORA).ok).toBe(true);
  });

  it("recusa customer_id de 9 digitos", () => {
    expect(validarIngest(corpo({ customer_id: "123-456-789" }), AGORA).ok).toBe(false);
  });

  it("recusa intervalo maior que 70 dias", () => {
    const r = validarIngest(corpo({ inicio: "2026-07-01", linhas: [] }), AGORA);
    expect(r.ok).toBe(false);
  });

  it("aceita os 62 dias que o script manda", () => {
    const r = validarIngest(corpo({ inicio: "2026-08-02", linhas: [] }), AGORA);
    expect(r.ok).toBe(true);
  });

  it("recusa data de linha fora de [inicio, fim]", () => {
    expect(validarIngest(linhaCom({ data: "2026-09-29" }), AGORA).ok).toBe(false);
  });

  it("recusa custo_micros negativo ou com letras", () => {
    expect(validarIngest(linhaCom({ custo_micros: "-100" }), AGORA).ok).toBe(false);
    expect(validarIngest(linhaCom({ custo_micros: -100 }), AGORA).ok).toBe(false);
    expect(validarIngest(linhaCom({ custo_micros: "12abc" }), AGORA).ok).toBe(false);
    expect(validarIngest(linhaCom({ custo_micros: "1.5" }), AGORA).ok).toBe(false);
  });

  it("recusa fim no futuro distante", () => {
    const r = validarIngest(corpo({ fim: "2026-12-01", linhas: [] }), AGORA);
    expect(r.ok).toBe(false);
  });

  it("aceita fim = amanha (fuso da conta adiantado)", () => {
    expect(validarIngest(corpo({ fim: "2026-10-03", linhas: [] }), AGORA).ok).toBe(true);
  });

  it("recusa mais de 20000 linhas", () => {
    const uma = (corpo().linhas as unknown[])[0];
    const r = validarIngest(corpo({ linhas: Array.from({ length: 20001 }, () => uma) }), AGORA);
    expect(r.ok).toBe(false);
  });

  it("recusa versao, moeda, fuso e gerado_em invalidos", () => {
    expect(validarIngest(corpo({ v: 2 }), AGORA).ok).toBe(false);
    expect(validarIngest(corpo({ moeda: "real" }), AGORA).ok).toBe(false);
    expect(validarIngest(corpo({ fuso: "Marte/Olympus" }), AGORA).ok).toBe(false);
    expect(validarIngest(corpo({ gerado_em: "ontem" }), AGORA).ok).toBe(false);
    expect(validarIngest(corpo({ gerado_em: "2026-10-02T16:00:00Z" }), AGORA).ok).toBe(false);
  });

  it("recusa dia inexistente e cliques fracionados", () => {
    expect(validarIngest(corpo({ inicio: "2026-02-31", linhas: [] }), AGORA).ok).toBe(false);
    expect(validarIngest(linhaCom({ cliques: 1.5 }), AGORA).ok).toBe(false);
    expect(validarIngest(linhaCom({ conversoes: -1 }), AGORA).ok).toBe(false);
  });
});

describe("linhasDoIngest", () => {
  const ctx = { ad_account_id: "conta-1", user_id: "user-1", sincronizado_em: "2026-10-02T15:00:00.000Z" };

  it("soma as campanhas do dia na linha 'conta'", () => {
    const linhas = linhasDoIngest(validado(), ctx);
    const dia30 = linhas.find((l) => l.nivel === "conta" && l.data === "2026-09-30");
    expect(dia30?.gasto).toBe(17.34);
    expect(dia30?.cliques).toBe(13);
    expect(dia30?.impressoes).toBe(540);
    expect(dia30?.compras).toBe(1);
    expect(dia30?.valor_compras).toBe(89.9);
  });

  it("cria linha 'conta' zerada em dia sem campanha", () => {
    const linhas = linhasDoIngest(validado(), ctx);
    const contas = linhas.filter((l) => l.nivel === "conta");
    expect(contas.map((l) => l.data)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    const dia1 = contas.find((l) => l.data === "2026-10-01");
    expect(dia1?.gasto).toBe(0);
    expect(dia1?.cliques).toBe(0);
  });

  it("converte 12340000 micros em 12.34", () => {
    const linhas = linhasDoIngest(validado(), ctx);
    const camp = linhas.find(
      (l) => l.nivel === "campanha" && l.campanha_id === "111" && l.data === "2026-09-30"
    );
    expect(camp?.gasto).toBe(12.34);
    expect(camp?.campanha_nome).toBe("Cilios PMax");
  });

  it("usa campanha_id '' so no nivel conta", () => {
    const linhas = linhasDoIngest(validado(), ctx);
    for (const l of linhas) {
      expect(l.campanha_id === "").toBe(l.nivel === "conta");
      expect(l.fonte).toBe("script");
      expect(l.moeda).toBe("BRL");
      expect(l.sincronizado_em).toBe(ctx.sincronizado_em);
    }
  });

  it("soma linha repetida da mesma campanha no mesmo dia", () => {
    const base = corpo();
    const l0 = (base.linhas as Record<string, unknown>[])[0];
    const linhas = linhasDoIngest(validado({ ...base, linhas: [l0, l0] }), ctx);
    const camp = linhas.filter((l) => l.nivel === "campanha");
    expect(camp).toHaveLength(1);
    expect(camp[0].gasto).toBe(24.68);
  });
});

describe("segredo", () => {
  it("hashSegredo e deterministico e gerarSegredo tem >= 43 caracteres base64url", () => {
    const s = gerarSegredo();
    expect(s.length).toBeGreaterThanOrEqual(43);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashSegredo(s)).toBe(hashSegredo(s));
    expect(hashSegredo(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(gerarSegredo()).not.toBe(s);
  });

  it("segredoDoAuthorization so aceita Bearer com o formato do segredo", () => {
    const s = gerarSegredo();
    expect(segredoDoAuthorization(`Bearer ${s}`)).toBe(s);
    expect(segredoDoAuthorization(s)).toBeNull();
    expect(segredoDoAuthorization("Bearer curto")).toBeNull();
    expect(segredoDoAuthorization(`Bearer ${s}'; drop`)).toBeNull();
    expect(segredoDoAuthorization(null)).toBeNull();
  });
});

describe("normalizarCustomerId", () => {
  it("tira os hifens e exige 10 digitos", () => {
    expect(normalizarCustomerId("123-456-7890")).toBe("1234567890");
    expect(normalizarCustomerId("1234567890")).toBe("1234567890");
    expect(normalizarCustomerId("AW-123456789")).toBeNull();
    expect(normalizarCustomerId("123-456-78901")).toBeNull();
  });
});

describe("scriptGoogleAds", () => {
  it("substitui __URL__ e __SEGREDO__ e nao deixa nenhum placeholder", () => {
    const segredo = gerarSegredo();
    const url = "https://user.xcart.app/api/ads/google/ingest";
    const s = scriptGoogleAds({ url, segredo });
    expect(s).toContain(`var URL_XCART = '${url}';`);
    expect(s).toContain(`var SEGREDO = '${segredo}';`);
    expect(s).not.toMatch(/__[A-Z]+__/);
    expect(s).toContain("function main()");
  });

  it("o corpo que o script monta passa no validarIngest (mesmos nomes de campo)", () => {
    const s = scriptGoogleAds({ url: "https://x", segredo: "y" });
    for (const campo of [
      "v: 1",
      "customer_id:",
      "moeda:",
      "fuso:",
      "inicio:",
      "fim:",
      "gerado_em:",
      "linhas:",
      "campanha_id:",
      "custo_micros:",
      "cliques:",
      "impressoes:",
      "conversoes:",
      "valor_conversoes:",
    ]) {
      expect(s).toContain(campo);
    }
  });

  it("o template nao tem crase nem interpolacao (seria um template literal quebrado)", () => {
    const fonte = readFileSync(
      path.resolve(__dirname, "..", "src", "lib", "ads", "google-script.ts"),
      "utf8"
    );
    const inicio = fonte.indexOf("const TEMPLATE = `") + "const TEMPLATE = `".length;
    const fim = fonte.indexOf("`;", inicio);
    const corpoTemplate = fonte.slice(inicio, fim);
    expect(corpoTemplate).not.toContain("${");
    expect(corpoTemplate.length).toBeGreaterThan(500);
  });
});
