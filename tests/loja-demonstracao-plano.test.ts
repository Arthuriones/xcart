import { beforeAll, describe, expect, it, vi } from "vitest";

// ============================================================================
// Loja de demonstracao: o plano e o tamanho no banco (scripts/demo-loja/*).
//
// O banco de producao esta no plano free do Supabase (500 MB): a loja guarda
// so janelas que rolam. O que trava aqui:
//   - a janela de pedidos cobre o periodo ATUAL de todo periodo do app
//     (Hoje, Ontem, 7 dias, 30 dias, Mes, Mes passado) em qualquer dia, e
//     nunca passa de MAIOR_JANELA dias;
//   - a economia sai na faixa combinada pela conta do proprio app
//     (calcularFinanceiro): 140-160 pedidos/dia, AOV 125-140, lucro medio de
//     5-10 mil/dia, ROAS 2,4-2,8;
//   - Purchase so dos ultimos 35 dias, funil so das ultimas 48 h, e o payload
//     so com o que as telas leem;
//   - a recusa do semear: sem medida, acima de 70 MB, ou banco + carga acima
//     de 400 MB.
// ============================================================================

vi.mock("server-only", () => ({}));

import { calcularFinanceiro } from "@/lib/financeiro/calculo";
import { intervaloDoPeriodo, paraNumero, PERIODOS, type FinOrderRow } from "@/lib/financeiro/tipos";
import {
  DIAS_DE_COMPRA,
  DIAS_DE_HISTORICO,
  HORAS_DE_FUNIL,
  LANCAMENTO,
  MAIOR_JANELA,
  diasEntre,
  diaLocal,
  inicioDaJanela,
  instanteLocal,
  somarDia,
} from "../scripts/demo-loja/plano";
import { custosDosProdutos, urlDoFeed } from "../scripts/demo-loja/linhas";
import { configLoja, contasDaLoja, intervalosDaJanela, lojaFinanceira, montar, type Semeadura } from "../scripts/demo-loja/semeadura";
import {
  LIMITE_DA_CARGA,
  LIMITE_DO_BANCO,
  MB,
  MIN_LINHAS_REAIS,
  amostra,
  conferirEspaco,
  porLinhaNoDisco,
  sqlDaMedida,
} from "../scripts/demo-loja/tamanho";

const RESERVA: Record<string, number> = { USD: 1, CAD: 1.38, GBP: 0.76, AUD: 1.53, EUR: 0.87, BRL: 5.42 };
const AGORA = Date.parse("2026-10-19T22:00:00Z");

describe("janela do historico", () => {
  it("50 dias, ou ate o dia 1 do mes anterior quando ele fica mais longe", () => {
    expect(inicioDaJanela("2026-10-19")).toBe("2026-08-31");
    expect(diasEntre(inicioDaJanela("2026-10-19"), "2026-10-19")).toHaveLength(DIAS_DE_HISTORICO);
    // Fim de novembro: "Mes passado" e outubro inteiro.
    expect(inicioDaJanela("2026-11-30")).toBe("2026-10-01");
    expect(inicioDaJanela("2026-12-31")).toBe("2026-11-01");
    // A mais longa: 31 de agosto (julho e agosto de 31 dias).
    expect(diasEntre(inicioDaJanela("2027-08-31"), "2027-08-31")).toHaveLength(MAIOR_JANELA);
    // Nunca antes do lancamento.
    expect(inicioDaJanela("2026-08-10")).toBe(LANCAMENTO);
  });

  it("cobre o periodo atual de Hoje, Ontem, 7 dias, 30 dias, Mes e Mes passado em todo dia de um ano", () => {
    const primeiro = somarDia(LANCAMENTO, MAIOR_JANELA);
    for (let hoje = primeiro; hoje <= somarDia(primeiro, 366); hoje = somarDia(hoje, 1)) {
      const inicio = inicioDaJanela(hoje);
      const dias = diasEntre(inicio, hoje).length;
      expect(dias).toBeGreaterThanOrEqual(DIAS_DE_HISTORICO);
      expect(dias).toBeLessThanOrEqual(MAIOR_JANELA);
      for (const p of PERIODOS) {
        const { atual } = intervaloDoPeriodo(p.id, hoje);
        expect(atual.desde >= inicio, `${p.id} em ${hoje}: ${atual.desde} antes de ${inicio}`).toBe(true);
      }
    }
  });
});

describe("o estado de agora (montar)", () => {
  let s: Semeadura;
  beforeAll(() => {
    s = montar(AGORA, (m) => RESERVA[m] ?? 1, []);
  }, 120_000);

  it("economia na faixa: 140-160 pedidos/dia, AOV 125-140, lucro 5-10 mil/dia, ROAS 2,4-2,8", () => {
    const r = calcularFinanceiro({
      lojas: [lojaFinanceira],
      pedidos: s.pedidos,
      custos: custosDosProdutos(),
      configs: [configLoja],
      contas: contasDaLoja(),
      gastos: s.linhasGasto,
      cambio: [],
      intervalos: intervalosDaJanela(s.cortes.janela, s.hoje),
      moeda: "USD",
      hoje: s.hoje,
      agoraMs: AGORA,
    });
    const fechados = r.porDia.filter((d) => !d.parcial);
    expect(fechados.length).toBe(DIAS_DE_HISTORICO - 1);
    const media = (k: "lucro" | "pedidos") => fechados.reduce((t, d) => t + d[k], 0) / fechados.length;
    const ultimos = (n: number) => fechados.slice(-n).reduce((t, d) => t + d.lucro, 0) / n;
    expect(media("pedidos")).toBeGreaterThanOrEqual(140);
    expect(media("pedidos")).toBeLessThanOrEqual(160);
    for (const lucro of [media("lucro"), ultimos(30), ultimos(7)]) {
      expect(lucro).toBeGreaterThanOrEqual(5000);
      expect(lucro).toBeLessThanOrEqual(10000);
    }
    expect(r.atual.ticket!).toBeGreaterThanOrEqual(125);
    expect(r.atual.ticket!).toBeLessThanOrEqual(140);
    expect(r.atual.roas!).toBeGreaterThanOrEqual(2.4);
    expect(r.atual.roas!).toBeLessThanOrEqual(2.8);
    // Receita, custo, taxa e gasto fecham: o lucro e o que sobra.
    expect(r.atual.lucro).toBeCloseTo(r.atual.receita - r.atual.cmv - r.atual.taxas - r.atual.gasto, 0);
  });

  it("so a janela: pedidos desde o inicio dela, Purchase de 35 dias, funil de 48 h", () => {
    expect(s.cortes.janela).toBe("2026-08-31");
    expect(s.pedidos.length).toBeGreaterThan(0);
    expect(s.pedidos.every((p) => p.dia_local >= s.cortes.janela && p.dia_local <= s.hoje)).toBe(true);
    expect(s.linhasGasto.every((g) => g.data >= s.cortes.janela)).toBe(true);
    expect(s.cortes.compras).toBe(instanteLocal(somarDia(s.hoje, -(DIAS_DE_COMPRA - 1)), 0));
    expect(s.compras.length).toBeGreaterThan(0);
    expect(s.compras.every((c) => Date.parse(c.created_at) >= s.cortes.compras && Date.parse(c.created_at) <= AGORA)).toBe(true);
    expect(s.cortes.funil).toBe(AGORA - HORAS_DE_FUNIL * 3_600_000);
    expect(s.funil.length).toBeGreaterThan(0);
    expect(s.funil.every((e) => Date.parse(e.created_at) >= s.cortes.funil && Date.parse(e.created_at) <= AGORA)).toBe(true);
    // Toda venda de dentro da janela de compras tem o Purchase (a tela Pedidos e o Rastreamento contam com isso).
    const comCompra = new Set(s.compras.map((c) => c.order_id));
    const vendas = s.pedidos.filter(
      (p: FinOrderRow) => p.tipo === "venda" && paraNumero(p.total_bruto) > 0 && Date.parse(p.criado_em) >= s.cortes.compras && Date.parse(p.criado_em) < AGORA - 60_000
    );
    expect(vendas.length).toBeGreaterThan(1000);
    expect(vendas.filter((p) => !comCompra.has(p.shopify_order_id))).toEqual([]);
    // O funil cobre ontem inteiro e as duas pontas.
    expect(new Set(s.funil.map((e) => diaLocal(Date.parse(e.created_at))))).toContain(somarDia(s.hoje, -1));
  });

  it("payload so com o que as telas leem: event_source_url e user_data.fbc", () => {
    for (const e of [...s.compras, ...s.funil]) {
      expect(Object.keys(e.payload).every((k) => k === "event_source_url" || k === "user_data")).toBe(true);
      const ud = e.payload.user_data as Record<string, unknown> | undefined;
      if (ud) expect(Object.keys(ud)).toEqual(["fbc"]);
      // Sem fbc, o aviso de sempre (o feed mostra); com fbc, sem aviso.
      expect(e.last_error === null).toBe(Boolean(ud?.fbc));
    }
    // O Purchase do Meta leva o clique na URL (a origem de reserva da tela Pedidos) e o fbc.
    const doMeta = s.compras.find((c) => String(c.payload.event_source_url ?? "").includes("utm_source=FB"));
    expect(String(doMeta?.payload.event_source_url)).toContain("fbclid=");
    expect((doMeta?.payload.user_data as { fbc?: string }).fbc).toMatch(/^fb\.1\.\d+\./);
    // O funil do Meta leva so utm_source e utm_campaign (o que o feed extrai).
    const vi = s.funil.find((e) => e.event_name === "view_item" && String(e.payload.event_source_url ?? "").includes("utm_source=FB"));
    expect(Object.fromEntries(new URL(String(vi?.payload.event_source_url)).searchParams)).toEqual({
      utm_source: "FB",
      utm_campaign: expect.any(String),
    });
  });

  it("urlDoFeed: so utm_source e utm_campaign; sem eles, nada", () => {
    expect(urlDoFeed("https://x.myshopify.com/products/a?utm_source=FB&utm_medium=1&utm_campaign=12&fbclid=Iw")).toBe(
      "https://x.myshopify.com/products/a?utm_source=FB&utm_campaign=12"
    );
    expect(urlDoFeed("https://x.myshopify.com/products/a")).toBeNull();
    expect(urlDoFeed("https://x.myshopify.com/?gclid=abc")).toBeNull();
  });

  it("deterministico: o mesmo instante da as mesmas linhas", () => {
    const outra = montar(AGORA, (m) => RESERVA[m] ?? 1, []);
    expect(outra.pedidos.length).toBe(s.pedidos.length);
    expect(JSON.stringify(outra.compras.slice(-5))).toBe(JSON.stringify(s.compras.slice(-5)));
    expect(JSON.stringify(outra.funil.slice(0, 5))).toBe(JSON.stringify(s.funil.slice(0, 5)));
  }, 120_000);
});

describe("espaco no banco", () => {
  it("disco por linha: medido na tabela real grande, padrao na pequena", () => {
    const medida = porLinhaNoDisco({ tupla: 400, linhasReais: 20_000, bytesReais: 20_000 * 1400, heapReal: 20_000 * 1400 * 1.17, indicesReais: 20_000 * 750, nIndices: 9 });
    expect(medida.padrao).toBe(false);
    expect(medida.heap).toBeCloseTo(404 * 1.17, 6);
    expect(medida.indice).toBeCloseTo(750, 6);
    const pequena = porLinhaNoDisco({ tupla: 400, linhasReais: MIN_LINHAS_REAIS - 1, bytesReais: 1, heapReal: 999_999, indicesReais: 999_999, nIndices: 3 });
    expect(pequena).toEqual({ heap: 404 * 1.2, indice: 3 * 64, total: 404 * 1.2 + 192, padrao: true });
  });

  it("recusa sem medida, acima de 70 MB ou com o banco passando de 400 MB", () => {
    const ok = { total: 40 * MB, banco: 110 * MB, medido: true, erros: [] };
    expect(conferirEspaco(ok)).toBeNull();
    expect(conferirEspaco({ ...ok, medido: false, erros: ["sem token"] })).toMatch(/sem medir/);
    expect(conferirEspaco({ ...ok, banco: null })).toMatch(/sem medir/);
    expect(conferirEspaco({ ...ok, total: LIMITE_DA_CARGA + 1 })).toMatch(/passa de 70/);
    expect(conferirEspaco({ ...ok, banco: LIMITE_DO_BANCO - 40 * MB + 1 })).toMatch(/passa de 400/);
    expect(conferirEspaco({ ...ok, banco: LIMITE_DO_BANCO - 40 * MB })).toBeNull();
  });

  it("a medida e um SELECT so, de tabela da lista, com a confirmacao de somente leitura", () => {
    const sql = sqlDaMedida("tracking_events", [{ id: "a", payload: { event_source_url: "https://x/?utm_source=FB" } }]);
    expect(sql).toMatch(/^select\b/);
    expect(sql).toContain("jsonb_populate_recordset(null::public.tracking_events");
    expect(sql).toContain("current_setting('transaction_read_only')");
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
    expect(() => sqlDaMedida("stores" as never, [])).toThrow(/fora da lista/);
    expect(() => sqlDaMedida("fin_orders", [{ nome: "$xcart_amostra$" }])).toThrow(/etiqueta/);
  });

  it("amostra espalhada: primeira, ultima e o meio", () => {
    const lista = Array.from({ length: 1000 }, (_, i) => i);
    const a = amostra(lista, 5);
    expect(a).toEqual([0, 250, 500, 749, 999]);
    expect(amostra([1, 2], 5)).toEqual([1, 2]);
  });
});
