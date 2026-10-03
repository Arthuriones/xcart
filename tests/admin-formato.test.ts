import { describe, expect, it } from "vitest";
import {
  FILTROS_PADRAO,
  cadastrosPorMes,
  custoIa,
  dataCurta,
  dataHora,
  diaMes,
  divisaoDestinos,
  filtrarUsuarios,
  filtrosDaUrl,
  lerSaldo,
  naMoeda,
  periodoDaUrl,
  plural,
  reais,
  reaisKpi,
  rotuloAcao,
  rotuloMes,
  rotuloPlano,
  seloAcesso,
  statusAssinatura,
  temAcesso,
  temFiltro,
  urlDosFiltros,
} from "@/app/admin/formato";

// Intl usa espaco nao separavel entre o simbolo e o numero.
const limpo = (s: string) => s.replace(/\s/g, " ");

describe("moeda e numero", () => {
  it("real e dolar com Intl, nunca 'R$' ou '$' a mao", () => {
    expect(limpo(reais(1234.5))).toBe("R$ 1.234,50");
    expect(limpo(reais(1234.5, 0))).toBe("R$ 1.235");
    expect(limpo(naMoeda(12, "USD"))).toBe("US$ 12,00");
  });

  it("KPI sem centavos a partir de R$ 10 mil (cabe no cartao do celular)", () => {
    expect(limpo(reaisKpi(9999.5))).toBe("R$ 9.999,50");
    expect(limpo(reaisKpi(91663))).toBe("R$ 91.663");
    expect(limpo(reaisKpi(-12000.4))).toBe("-R$ 12.000");
    expect(reaisKpi(null)).toBe("—");
  });

  it("numero que nao se sabe vira travessao, nao zero", () => {
    expect(reais(null)).toBe("—");
    expect(reais(Number.NaN)).toBe("—");
    expect(naMoeda(undefined, "BRL")).toBe("—");
  });

  it("recarga na moeda da compra; moeda vazia ou estranha cai em real", () => {
    expect(limpo(naMoeda(97, "brl"))).toBe("R$ 97,00");
    expect(limpo(naMoeda(10, "usd"))).toBe("US$ 10,00");
    expect(limpo(naMoeda(10, ""))).toBe("R$ 10,00");
    expect(limpo(naMoeda(10, "x"))).toBe("R$ 10,00");
  });

  it("custo de IA de fracao de centavo ganha 3 casas", () => {
    expect(limpo(custoIa(0.0123))).toBe("US$ 0,012");
    expect(limpo(custoIa(1.5))).toBe("US$ 1,50");
    expect(limpo(custoIa(0))).toBe("US$ 0,00");
  });

  it("plural sem '(s)'", () => {
    expect(plural(1, "compra", "compras")).toBe("1 compra");
    expect(plural(0, "compra", "compras")).toBe("0 compras");
    expect(plural(1200, "uso", "usos")).toBe("1.200 usos");
  });
});

describe("datas em pt-BR, no horario de Brasilia", () => {
  it("dia e hora", () => {
    expect(dataCurta("2026-10-03T02:30:00Z")).toBe("02/10/2026");
    expect(dataHora("2026-10-03T17:05:00Z")).toBe("03/10/2026 às 14:05");
    expect(dataCurta(null)).toBe("—");
    expect(dataCurta("lixo")).toBe("—");
  });

  it("mes e dia curtos", () => {
    expect(rotuloMes("2026-10")).toBe("out/26");
    expect(rotuloMes("2026-03", "longo")).toBe("março de 2026");
    expect(rotuloMes("2026-13")).toBe("2026-13");
    expect(diaMes("2026-10-03")).toBe("03/10");
  });
});

describe("nomes em portugues", () => {
  it("acao de IA conhecida e desconhecida", () => {
    expect(rotuloAcao("neutralize_image")).toBe("Imagem sem marca");
    expect(rotuloAcao("translate")).toBe("Tradução");
    expect(rotuloAcao("acao_nova")).toBe("Outros usos");
  });

  it("status da assinatura: cru nao aparece", () => {
    expect(statusAssinatura("active")).toBe("Ativa");
    expect(statusAssinatura("past_due")).toBe("Pagamento atrasado");
    expect(statusAssinatura("cancel_scheduled")).toBe("Cancela no fim do ciclo");
    expect(statusAssinatura("algo_do_provedor")).toBeNull();
    expect(statusAssinatura(null)).toBeNull();
  });

  it("plano", () => {
    expect(rotuloPlano("pro")).toBe("Pro");
    expect(rotuloPlano("free")).toBe("Free");
    expect(rotuloPlano(null)).toBe("—");
  });
});

describe("acesso: a mesma regra da API", () => {
  const base = { isAdmin: false, plan: "free", accessGranted: false };

  it("admin, Pro ou liberado a mao", () => {
    expect(temAcesso(base)).toBe(false);
    expect(temAcesso({ ...base, isAdmin: true })).toBe(true);
    expect(temAcesso({ ...base, plan: "pro" })).toBe(true);
    expect(temAcesso({ ...base, accessGranted: true })).toBe(true);
  });

  it("o selo diz por que tem acesso", () => {
    expect(seloAcesso({ ...base, isAdmin: true }).motivo).toBe("Administrador");
    expect(seloAcesso({ ...base, plan: "pro" }).motivo).toBe("Pelo plano Pro");
    expect(seloAcesso({ ...base, accessGranted: true }).motivo).toBe("Liberado à mão");
    const sem = seloAcesso(base);
    expect(sem.texto).toBe("Sem acesso");
    expect(sem.tom).toBe("neutral");
  });
});

describe("filtros da lista de usuarios", () => {
  const usuarios = [
    { email: "ana@x.com", plan: "pro", isAdmin: false, accessGranted: false, stores: [] },
    { email: "bia@y.com", plan: "free", isAdmin: false, accessGranted: true, stores: [{ domain: "lash.myshopify.com", name: "Lash Bestie" }] },
    { email: "caio@z.com", plan: "free", isAdmin: false, accessGranted: false, stores: [] },
    { email: "adm@xcart.com", plan: "free", isAdmin: true, accessGranted: false, stores: [] },
  ];

  it("da URL e de volta, so o que difere do padrao", () => {
    const f = filtrosDaUrl({ q: " lash ", acesso: "sem", plano: "pro" });
    expect(f).toEqual({ busca: "lash", acesso: "sem", plano: "pro" });
    expect(urlDosFiltros(f)).toBe("?q=lash&acesso=sem&plano=pro");
    expect(urlDosFiltros(FILTROS_PADRAO)).toBe("");
    expect(filtrosDaUrl({ acesso: "talvez", plano: ["free", "pro"] })).toEqual({
      busca: "",
      acesso: "todos",
      plano: "free",
    });
    expect(temFiltro(FILTROS_PADRAO)).toBe(false);
    expect(temFiltro({ ...FILTROS_PADRAO, busca: "  " })).toBe(false);
  });

  it("acesso, plano e busca por e-mail ou loja", () => {
    const emails = (f: Partial<typeof FILTROS_PADRAO>) =>
      filtrarUsuarios(usuarios, { ...FILTROS_PADRAO, ...f }).map((u) => u.email);
    expect(emails({ acesso: "sem" })).toEqual(["caio@z.com"]);
    expect(emails({ acesso: "com" })).toEqual(["ana@x.com", "bia@y.com", "adm@xcart.com"]);
    expect(emails({ plano: "pro" })).toEqual(["ana@x.com"]);
    expect(emails({ plano: "free" })).toHaveLength(3);
    expect(emails({ busca: "LASH" })).toEqual(["bia@y.com"]);
    expect(emails({ busca: "z.com" })).toEqual(["caio@z.com"]);
  });
});

describe("visao geral: cadastros por mes", () => {
  it("conta por mes em UTC e ignora fora da janela e data ruim", () => {
    const meses = ["2026-08", "2026-09", "2026-10"];
    const datas = [
      "2026-09-30T23:30:00Z",
      "2026-10-01T00:10:00Z",
      "2026-10-02T12:00:00Z",
      "2026-07-15T12:00:00Z",
      null,
      "lixo",
    ];
    expect(cadastrosPorMes(datas, meses)).toEqual([0, 1, 2]);
  });
});

describe("rodizio: a parte de cada loja de checkout", () => {
  it("peso sobre a soma dos ligados, como o console", () => {
    expect(
      divisaoDestinos([
        { id: "a", peso: 2, ligado: true },
        { id: "b", peso: 1, ligado: true },
        { id: "c", peso: 1, ligado: true },
      ])
    ).toEqual({ a: 50, b: 25, c: 25 });
  });

  it("desligado ou peso zero fica fora do rodizio", () => {
    expect(
      divisaoDestinos([
        { id: "a", peso: 3, ligado: true },
        { id: "b", peso: 0, ligado: true },
        { id: "c", peso: 5, ligado: false },
      ])
    ).toEqual({ a: 100, b: null, c: null });
  });

  it("todos fora: ninguem tem parte (nao divide por zero)", () => {
    expect(divisaoDestinos([{ id: "a", peso: 0, ligado: true }])).toEqual({ a: null });
  });
});

describe("campos do gerenciar", () => {
  it("saldo: inteiro de 0 para cima, aceita ponto de milhar", () => {
    expect(lerSaldo("120")).toBe(120);
    expect(lerSaldo(" 1.000 ")).toBe(1000);
    expect(lerSaldo("0")).toBe(0);
    expect(lerSaldo("")).toBeNull();
    expect(lerSaldo("-5")).toBeNull();
    expect(lerSaldo("2,5")).toBeNull();
    expect(lerSaldo("abc")).toBeNull();
  });

  it("periodo do faturamento: 7, 30 ou 60; o resto vira 30", () => {
    expect(periodoDaUrl("7")).toBe("7");
    expect(periodoDaUrl("60")).toBe("60");
    expect(periodoDaUrl("90")).toBe("30");
    expect(periodoDaUrl(undefined)).toBe("30");
  });
});
