import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { interpretarBusca } from "../src/lib/leitura/busca";
import {
  comparacaoDeCookie,
  horaNoFuso,
  rotuloFuso,
  rotuloIntervalo,
} from "../src/components/layout/contexto";

/**
 * A busca do Ctrl K so varre pedidos quando o termo tem algarismo: "lumen"
 * nao tem por que ler fin_orders. E o prefixo restringe o que volta.
 */
describe("interpretarBusca", () => {
  it("termo sem algarismo busca so lojas", () => {
    expect(interpretarBusca("lumen")).toEqual({ termo: "lumen", lojas: true, pedidos: false });
  });

  it("numero busca lojas e pedidos", () => {
    expect(interpretarBusca(" #1001 ")).toEqual({ termo: "#1001", lojas: true, pedidos: true });
  });

  it("prefixo restringe", () => {
    expect(interpretarBusca("pedido: 1001")).toEqual({ termo: "1001", lojas: false, pedidos: true });
    expect(interpretarBusca("loja:kova2")).toEqual({ termo: "kova2", lojas: true, pedidos: false });
  });

  it("termo gigante e cortado", () => {
    expect(interpretarBusca("9".repeat(500)).termo.length).toBe(60);
  });
});

describe("barra de contexto", () => {
  it("comparacao: lixo no cookie vira o padrao", () => {
    expect(comparacaoDeCookie("nenhum")).toBe("nenhum");
    expect(comparacaoDeCookie("anterior")).toBe("anterior");
    expect(comparacaoDeCookie("ano")).toBe("anterior");
    expect(comparacaoDeCookie(undefined)).toBe("anterior");
  });

  it("intervalo curto, e um dia so sem traco", () => {
    expect(rotuloIntervalo({ desde: "2026-09-03", ate: "2026-10-02" })).toBe("03/09–02/10");
    expect(rotuloIntervalo({ desde: "2026-10-02", ate: "2026-10-02" })).toBe("02/10");
  });

  it("fuso em palavras", () => {
    expect(rotuloFuso("America/Sao_Paulo")).toBe("horário de São Paulo");
    expect(rotuloFuso("America/New_York")).toBe("horário de New York");
  });

  it("hora no fuso do relatorio, e fuso invalido nao lanca", () => {
    const instante = Date.parse("2026-10-02T17:32:00Z");
    expect(horaNoFuso(instante, "America/Sao_Paulo")).toBe("14:32");
    expect(() => horaNoFuso(instante, "Nada/Disso")).not.toThrow();
  });
});
