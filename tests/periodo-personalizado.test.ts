import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PERIODOS,
  PERIODO_PADRAO,
  TETO_PERSONALIZADO_DIAS,
  diaNoFuso,
  diaValido,
  diasNoIntervalo,
  ehPersonalizado,
  filtroDeCookies,
  intervaloDoPeriodo,
  lerPeriodo,
  linhaDeCookie,
  serializarPeriodo,
  somarDias,
  type Intervalo,
} from "@/lib/financeiro/tipos";
import {
  nomeDoPeriodo,
  rotuloDatas,
  rotuloDias,
  rotuloDoPeriodo,
} from "@/components/layout/contexto";
import {
  diaBloqueado,
  escolherDia,
  limitarDia,
  limitesDoCalendario,
  moverFoco,
  semanasDoMes,
  somarMeses,
  somarMesesAoDia,
} from "@/components/layout/calendario-regras";
import { Calendario } from "@/components/layout/calendario";
import { granularidadePadrao, rotuloACada } from "@/app/(dashboard)/financeiro/lucro-dados";

/**
 * O periodo "Personalizado": o lojista escolhe um dia (ex.: 5 dias atras) ou
 * um intervalo no calendario da barra, e vale para todas as telas. O cookie e
 * do navegador -- qualquer um escreve qualquer coisa nele --, entao o servidor
 * confere tudo e o lixo cai no padrao, nunca derruba a tela.
 */

const dias = (desde: string, n: number): Intervalo => ({ desde, ate: somarDias(desde, n - 1) });

describe("cookie do periodo", () => {
  it("presets continuam iguais e so eles estao em PERIODOS", () => {
    expect(PERIODOS.map((p) => p.id)).toEqual(["hoje", "ontem", "7d", "30d", "mes", "mes_passado"]);
    for (const p of PERIODOS) {
      expect(lerPeriodo(p.id)).toBe(p.id);
      expect(serializarPeriodo(p.id)).toBe(p.id);
      expect(ehPersonalizado(p.id)).toBe(false);
    }
    expect(PERIODO_PADRAO).toBe("7d");
  });

  it("intervalo e um dia so vao e voltam", () => {
    const i = { desde: "2026-10-10", ate: "2026-10-14" };
    expect(serializarPeriodo(i)).toBe("2026-10-10_2026-10-14");
    expect(lerPeriodo("2026-10-10_2026-10-14")).toEqual(i);
    expect(lerPeriodo("2026-10-14_2026-10-14")).toEqual({ desde: "2026-10-14", ate: "2026-10-14" });
    expect(filtroDeCookies({ periodo: "2026-10-10_2026-10-14" }).periodo).toEqual(i);
  });

  it("o cookie gravado e lido de volta sem escapar nada", () => {
    const linha = linhaDeCookie("xc_periodo", serializarPeriodo({ desde: "2026-10-10", ate: "2026-10-14" }));
    expect(linha.startsWith("xc_periodo=2026-10-10_2026-10-14;")).toBe(true);
    const valor = decodeURIComponent(linha.split(";")[0].split("=")[1]);
    expect(lerPeriodo(valor)).toEqual({ desde: "2026-10-10", ate: "2026-10-14" });
  });

  it("data que nao existe, formato errado, de > ate ou acima do teto: padrao", () => {
    const ruins = [
      "2026-02-30_2026-03-02", // 30 de fevereiro
      "2026-13-01_2026-13-02", // mes 13
      "2026-10-00_2026-10-02", // dia zero
      "2026-1-01_2026-1-05", // sem zero a esquerda
      "2026-10-14_2026-10-10", // de > ate
      "2026-10-10", // so uma ponta
      "2026-10-10_", // ponta vazia
      "2026-10-10__2026-10-12",
      "2026-10-10_2026-10-12_2026-10-14",
      "1999-10-10_1999-10-12", // fora de 20xx
      "2026-10-10T00:00_2026-10-12",
      "2026/10/10_2026/10/12",
      "ano",
      "",
    ];
    for (const r of ruins) {
      expect(lerPeriodo(r), r).toBeNull();
      expect(filtroDeCookies({ periodo: r }).periodo, r).toBe(PERIODO_PADRAO);
    }
    expect(lerPeriodo(null)).toBeNull();
    expect(lerPeriodo(undefined)).toBeNull();
  });

  it("teto: 92 dias passam, 93 nao", () => {
    const no = dias("2026-07-01", TETO_PERSONALIZADO_DIAS);
    expect(diasNoIntervalo(no)).toBe(92);
    expect(lerPeriodo(serializarPeriodo(no))).toEqual(no);
    const acima = dias("2026-07-01", TETO_PERSONALIZADO_DIAS + 1);
    expect(lerPeriodo(serializarPeriodo(acima))).toBeNull();
    expect(filtroDeCookies({ periodo: serializarPeriodo(acima) }).periodo).toBe(PERIODO_PADRAO);
  });

  it("dia valido confere o calendario, inclusive bissexto", () => {
    expect(diaValido("2028-02-29")).toBe(true);
    expect(diaValido("2026-02-29")).toBe(false);
    expect(diaValido("2026-04-31")).toBe(false);
    expect(diaValido(20261010)).toBe(false);
  });
});

describe("intervalo do personalizado e o periodo anterior", () => {
  const hoje = "2026-10-19";

  it("um dia compara com o dia anterior (5 dias atras)", () => {
    expect(intervaloDoPeriodo({ desde: "2026-10-14", ate: "2026-10-14" }, hoje)).toEqual({
      atual: { desde: "2026-10-14", ate: "2026-10-14" },
      anterior: { desde: "2026-10-13", ate: "2026-10-13" },
    });
  });

  it("intervalo compara com os mesmos N dias logo antes", () => {
    expect(intervaloDoPeriodo({ desde: "2026-10-10", ate: "2026-10-14" }, hoje)).toEqual({
      atual: { desde: "2026-10-10", ate: "2026-10-14" },
      anterior: { desde: "2026-10-05", ate: "2026-10-09" },
    });
  });

  it("virada de mes, fevereiro e ano", () => {
    expect(intervaloDoPeriodo({ desde: "2026-03-01", ate: "2026-03-03" }, hoje).anterior).toEqual({
      desde: "2026-02-26",
      ate: "2026-02-28",
    });
    expect(intervaloDoPeriodo({ desde: "2028-03-01", ate: "2028-03-02" }, "2028-10-19").anterior).toEqual({
      desde: "2028-02-28",
      ate: "2028-02-29",
    });
    expect(intervaloDoPeriodo({ desde: "2026-01-01", ate: "2026-01-10" }, hoje).anterior).toEqual({
      desde: "2025-12-22",
      ate: "2025-12-31",
    });
    expect(intervaloDoPeriodo({ desde: "2025-12-28", ate: "2026-01-03" }, hoje)).toEqual({
      atual: { desde: "2025-12-28", ate: "2026-01-03" },
      anterior: { desde: "2025-12-21", ate: "2025-12-27" },
    });
  });

  it("o fim nunca passa de hoje, e o anterior acompanha o corte", () => {
    expect(intervaloDoPeriodo({ desde: "2026-10-15", ate: "2026-10-25" }, hoje)).toEqual({
      atual: { desde: "2026-10-15", ate: "2026-10-19" },
      anterior: { desde: "2026-10-10", ate: "2026-10-14" },
    });
  });

  it("intervalo todo no futuro vira so hoje", () => {
    expect(intervaloDoPeriodo({ desde: "2026-10-21", ate: "2026-10-23" }, hoje)).toEqual({
      atual: { desde: "2026-10-19", ate: "2026-10-19" },
      anterior: { desde: "2026-10-18", ate: "2026-10-18" },
    });
  });

  it("o mesmo cookie no fuso de cada loja: o hoje decide o corte", () => {
    // 02:00 UTC de 19/10: em Sao Paulo ainda e 18/10; em Paris ja e 19/10.
    const instante = new Date("2026-10-19T02:00:00Z");
    const i = { desde: "2026-10-17", ate: "2026-10-19" };
    expect(intervaloDoPeriodo(i, diaNoFuso(instante, "America/Sao_Paulo")).atual).toEqual({
      desde: "2026-10-17",
      ate: "2026-10-18",
    });
    expect(intervaloDoPeriodo(i, diaNoFuso(instante, "Europe/Paris")).atual).toEqual(i);
  });

  it("objeto fora da regra (nao veio do cookie) vale o padrao, nunca lanca", () => {
    const padrao = intervaloDoPeriodo(PERIODO_PADRAO, hoje);
    expect(intervaloDoPeriodo({ desde: "2026-02-30", ate: "2026-03-01" }, hoje)).toEqual(padrao);
    expect(intervaloDoPeriodo({ desde: "2026-10-14", ate: "2026-10-10" }, hoje)).toEqual(padrao);
    expect(intervaloDoPeriodo(dias("2026-01-01", 200), hoje)).toEqual(padrao);
  });

  it("presets nao mudaram", () => {
    expect(intervaloDoPeriodo("hoje", hoje).atual).toEqual({ desde: hoje, ate: hoje });
    expect(intervaloDoPeriodo("ontem", hoje).atual).toEqual({ desde: "2026-10-18", ate: "2026-10-18" });
    expect(intervaloDoPeriodo("7d", hoje)).toEqual({
      atual: { desde: "2026-10-13", ate: "2026-10-19" },
      anterior: { desde: "2026-10-06", ate: "2026-10-12" },
    });
    expect(intervaloDoPeriodo("30d", hoje).atual).toEqual({ desde: "2026-09-20", ate: "2026-10-19" });
    expect(intervaloDoPeriodo("mes", hoje).atual).toEqual({ desde: "2026-10-01", ate: "2026-10-19" });
    expect(intervaloDoPeriodo("mes_passado", hoje)).toEqual({
      atual: { desde: "2026-09-01", ate: "2026-09-30" },
      anterior: { desde: "2026-08-01", ate: "2026-08-31" },
    });
  });
});

describe("rotulos do personalizado", () => {
  const hoje = "2026-10-19";

  it("os quatro formatos, dia sem zero a esquerda", () => {
    expect(rotuloDatas({ desde: "2026-10-05", ate: "2026-10-05" }, hoje)).toBe("5 out");
    expect(rotuloDatas({ desde: "2026-10-10", ate: "2026-10-14" }, hoje)).toBe("10–14 out");
    expect(rotuloDatas({ desde: "2026-09-10", ate: "2026-10-14" }, hoje)).toBe("10 set – 14 out");
    expect(rotuloDatas({ desde: "2025-12-28", ate: "2026-01-03" }, hoje)).toBe("28 dez 2025 – 3 jan 2026");
  });

  it("o ano so aparece quando nao e o de hoje", () => {
    expect(rotuloDatas({ desde: "2025-10-15", ate: "2025-10-15" }, hoje)).toBe("15 out 2025");
    expect(rotuloDatas({ desde: "2025-11-01", ate: "2025-11-30" }, hoje)).toBe("1–30 nov 2025");
    expect(rotuloDatas({ desde: "2025-10-20", ate: "2025-11-02" }, hoje)).toBe("20 out – 2 nov 2025");
  });

  it("dias contados", () => {
    expect(rotuloDias({ desde: "2026-10-14", ate: "2026-10-14" })).toBe("1 dia");
    expect(rotuloDias({ desde: "2026-10-10", ate: "2026-10-14" })).toBe("5 dias");
  });

  it("titulo e botao: preset com o nome, personalizado so com as datas", () => {
    const i7 = intervaloDoPeriodo("7d", hoje).atual;
    expect(rotuloDoPeriodo("7d", i7, hoje)).toBe("Últimos 7 dias (13/10–19/10)");
    expect(rotuloDoPeriodo("hoje", { desde: hoje, ate: hoje }, hoje)).toBe("Hoje (19/10)");
    expect(nomeDoPeriodo("7d", i7, hoje)).toBe("Últimos 7 dias");
    const p = { desde: "2026-10-10", ate: "2026-10-14" };
    expect(rotuloDoPeriodo(p, p, hoje)).toBe("10–14 out");
    expect(nomeDoPeriodo(p, p, hoje)).toBe("10–14 out");
    // O rotulo e do intervalo calculado (ja cortado em hoje), nao do cookie.
    const futuro = { desde: "2026-10-15", ate: "2026-10-25" };
    expect(rotuloDoPeriodo(futuro, intervaloDoPeriodo(futuro, hoje).atual, hoje)).toBe("15–19 out");
  });
});

describe("calendario", () => {
  const hoje = "2026-10-19";
  const limites = limitesDoCalendario(hoje);

  it("grade de 6 semanas, domingo primeiro, so os dias do mes", () => {
    const out = semanasDoMes("2026-10");
    expect(out).toHaveLength(6);
    expect(out.every((s) => s.length === 7)).toBe(true);
    // 1/10/2026 e quinta: domingo a quarta vazios.
    expect(out[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(out.flat().filter(Boolean)).toHaveLength(31);
    // Fevereiro de 2026 comeca no domingo e cabe em 4 linhas: as outras vazias.
    const fev = semanasDoMes("2026-02");
    expect(fev[0][0]).toBe("2026-02-01");
    expect(fev[4].every((d) => d === null)).toBe(true);
  });

  it("meses e mesmo dia noutro mes, sem estourar", () => {
    expect(somarMeses("2026-01", -1)).toBe("2025-12");
    expect(somarMeses("2026-12", 1)).toBe("2027-01");
    expect(somarMesesAoDia("2026-03-31", -1)).toBe("2026-02-28");
    expect(somarMesesAoDia("2026-10-19", 12)).toBe("2027-10-19");
  });

  it("limites: hoje e 365 dias para tras", () => {
    expect(limites).toEqual({ min: "2025-10-19", max: hoje });
    expect(limitarDia("2026-10-25", limites)).toBe(hoje);
    expect(limitarDia("2024-01-01", limites)).toBe("2025-10-19");
    expect(diaBloqueado("2026-10-20", limites, null)).toBe(true);
    expect(diaBloqueado("2025-10-18", limites, null)).toBe(true);
    expect(diaBloqueado("2026-10-14", limites, null)).toBe(false);
  });

  it("com o inicio marcado, o que passa do teto fica bloqueado", () => {
    const inicio = "2026-10-19";
    expect(diaBloqueado(somarDias(inicio, -(TETO_PERSONALIZADO_DIAS - 1)), limites, inicio)).toBe(false);
    expect(diaBloqueado(somarDias(inicio, -TETO_PERSONALIZADO_DIAS), limites, inicio)).toBe(true);
  });

  it("primeiro clique ja vale um dia; o segundo fecha, trocando as pontas se preciso", () => {
    const um = escolherDia(null, "2026-10-14");
    expect(um).toEqual({ inicio: "2026-10-14", intervalo: { desde: "2026-10-14", ate: "2026-10-14" } });
    expect(escolherDia(um.inicio, "2026-10-10")).toEqual({
      inicio: null,
      intervalo: { desde: "2026-10-10", ate: "2026-10-14" },
    });
    expect(escolherDia(um.inicio, "2026-10-16").intervalo).toEqual({ desde: "2026-10-14", ate: "2026-10-16" });
    // O mesmo dia duas vezes: so ele.
    expect(escolherDia(um.inicio, "2026-10-14")).toEqual({
      inicio: null,
      intervalo: { desde: "2026-10-14", ate: "2026-10-14" },
    });
  });

  it("teclado: setas, Home/End da semana, PageUp/PageDown de mes e de ano", () => {
    expect(moverFoco("2026-10-14", "ArrowLeft", false)).toBe("2026-10-13");
    expect(moverFoco("2026-10-14", "ArrowRight", false)).toBe("2026-10-15");
    expect(moverFoco("2026-10-14", "ArrowUp", false)).toBe("2026-10-07");
    expect(moverFoco("2026-10-31", "ArrowDown", false)).toBe("2026-11-07");
    // 14/10/2026 e quarta: a semana vai de 11 (domingo) a 17 (sabado).
    expect(moverFoco("2026-10-14", "Home", false)).toBe("2026-10-11");
    expect(moverFoco("2026-10-14", "End", false)).toBe("2026-10-17");
    expect(moverFoco("2026-03-31", "PageUp", false)).toBe("2026-02-28");
    expect(moverFoco("2026-10-14", "PageDown", true)).toBe("2027-10-14");
    expect(moverFoco("2026-10-14", "Tab", false)).toBeNull();
  });
});

describe("calendario na tela", () => {
  const html = renderToStaticMarkup(
    createElement(Calendario, {
      hoje: "2026-10-19",
      valor: { desde: "2026-10-10", ate: "2026-10-14" },
      aoMudar: () => {},
    })
  );
  const contar = (re: RegExp) => (html.match(re) ?? []).length;

  it("abre no mes do fim escolhido, com o resumo e o teto", () => {
    expect(html).toContain('role="grid"');
    expect(html).toContain("outubro de 2026");
    expect(html).toContain("10–14 out · 5 dias");
    expect(html).toContain("Até 92 dias");
  });

  it("um dia so no Tab, hoje marcado, futuro bloqueado e o intervalo selecionado", () => {
    expect(contar(/tabindex="0"/g)).toBe(1);
    expect(html).toMatch(/data-dia="2026-10-14" tabindex="0"/);
    expect(html).toMatch(/data-dia="2026-10-19"[^>]*aria-current="date"/);
    expect(html).toMatch(/data-dia="2026-10-20"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/data-dia="2026-10-18"[^>]*aria-disabled/);
    expect(contar(/aria-selected="true"/g)).toBe(5);
    expect(html).toContain("quarta-feira, 14 de outubro de 2026");
  });

  it("nao deixa ir para o mes que vem", () => {
    expect(html).toMatch(/aria-label="Próximo mês" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Mês anterior" aria-disabled/);
  });
});

describe("grafico com periodo longo", () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => somarDias("2026-07-01", i));

  it("ate 45 dias abre por dia; acima, por semana", () => {
    expect(granularidadePadrao(n(31))).toBe("dia");
    expect(granularidadePadrao(n(45))).toBe("dia");
    expect(granularidadePadrao(n(46))).toBe("semana");
    expect(granularidadePadrao(n(92))).toBe("semana");
  });

  it("rotulo do eixo: os presets seguem iguais, e acima de 40 barras a cada 7", () => {
    expect([1, 10, 11, 20, 21, 31, 40].map(rotuloACada)).toEqual([1, 1, 2, 2, 5, 5, 5]);
    expect(rotuloACada(41)).toBe(7);
    expect(rotuloACada(92)).toBe(7);
  });
});
