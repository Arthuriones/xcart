import { describe, expect, it } from "vitest";
import {
  ERRO_PADRAO,
  contagem,
  dataCurta,
  formaDaCompra,
  mascaraCpf,
  mensagemDeErro,
  motivoDoBloqueio,
  pacotesComPreco,
  precoPorCredito,
  rotuloCompra,
  situacaoDaCompra,
  situacaoDoPlano,
  type PerfilAssinatura,
} from "@/components/billing/regras";
import { BENEFICIOS_PRO } from "@/components/billing/beneficios";
import { CREDIT_PACKS } from "@/lib/billing/plans";

const AGORA = Date.parse("2026-10-03T15:00:00Z");
const DIA = 86_400_000;
const emDias = (n: number) => new Date(AGORA + n * DIA).toISOString();

const FREE: PerfilAssinatura = {
  plano: "free",
  status: null,
  fimPeriodo: null,
  cancelaNoFim: false,
  provedor: "pagou",
  temAssinaturaCartao: false,
  acessoLiberado: false,
};

const CARTAO: PerfilAssinatura = {
  ...FREE,
  plano: "pro",
  status: "active",
  fimPeriodo: "2026-11-03T12:00:00Z",
  temAssinaturaCartao: true,
};

const PIX: PerfilAssinatura = { ...FREE, plano: "pro", status: "active", fimPeriodo: emDias(20) };

describe("pacotesComPreco: o mais vantajoso e calculado", () => {
  it("os pacotes de hoje: 500 por R$ 150 sai a R$ 0,30 e e o destaque", () => {
    const p = pacotesComPreco(CREDIT_PACKS);
    const porId = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(porId.pack_50.centavosPorCredito).toBe(50);
    expect(porId.pack_200.centavosPorCredito).toBe(37.5);
    expect(porId.pack_500.centavosPorCredito).toBe(30);
    expect(p.filter((x) => x.melhor).map((x) => x.id)).toEqual(["pack_500"]);
    expect(porId.pack_50.economia).toBeNull();
    expect(porId.pack_500.economia).toBeCloseTo(0.4);
    expect(porId.pack_200.economia).toBeCloseTo(0.25);
  });

  it("sem diferenca de preco ninguem e destacado", () => {
    const p = pacotesComPreco([
      { id: "a", credits: 10, amountCents: 1000 },
      { id: "b", credits: 20, amountCents: 2000 },
    ]);
    expect(p.some((x) => x.melhor)).toBe(false);
    expect(p.every((x) => x.economia === null)).toBe(true);
  });

  it("um pacote so nao vira 'mais vantajoso'", () => {
    expect(pacotesComPreco([{ id: "a", credits: 10, amountCents: 1000 }])[0].melhor).toBe(false);
  });

  it("preco por credito com duas casas", () => {
    expect(precoPorCredito(37.5)).toMatch(/0,38/);
  });
});

describe("situacaoDoPlano", () => {
  it("sem assinatura: pode assinar, selo neutro", () => {
    const s = situacaoDoPlano(FREE, AGORA);
    expect(s.pro).toBe(false);
    expect(s.titulo).toBe("Sem assinatura");
    expect(s.selo).toEqual({ tom: "neutral", texto: "Sem assinatura" });
    expect(s.podeAssinar).toBe(true);
    expect(s.podeCancelar).toBe(false);
  });

  it("cartao ativo: renova em DD/MM/AAAA e pode cancelar", () => {
    const s = situacaoDoPlano(CARTAO, AGORA);
    expect(s.pro).toBe(true);
    expect(s.forma).toBe("cartao");
    expect(s.selo.texto).toBe("Ativa");
    expect(s.linha).toBe("Renova em 03/11/2026, no cartão.");
    expect(s.podeCancelar).toBe(true);
    expect(s.podeAssinar).toBe(false);
  });

  it("cancelamento agendado: em caixa de frase, mostra ate quando e nao cancela de novo", () => {
    const s = situacaoDoPlano({ ...CARTAO, cancelaNoFim: true }, AGORA);
    expect(s.selo.texto).toBe("Cancelamento agendado");
    expect(s.linha).toContain("Acesso até 03/11/2026");
    expect(s.podeCancelar).toBe(false);
    expect(situacaoDoPlano({ ...CARTAO, status: "cancel_scheduled" }, AGORA).podeCancelar).toBe(false);
  });

  it("pagamento pendente: aviso com saida e acesso mantido", () => {
    const s = situacaoDoPlano({ ...CARTAO, status: "past_due" }, AGORA);
    expect(s.pro).toBe(true);
    expect(s.selo).toEqual({ tom: "warn", texto: "Pagamento pendente" });
    expect(s.aviso?.tom).toBe("warn");
  });

  it("status cru nunca vai para a tela", () => {
    for (const status of ["active", "past_due", "trialing", "cancel_scheduled", "weird_status", null]) {
      const s = situacaoDoPlano({ ...CARTAO, status }, AGORA);
      expect(s.selo.texto).not.toMatch(/_|^[a-z]/);
    }
  });

  it("primeiro pagamento processando: sem assinar de novo", () => {
    const s = situacaoDoPlano({ ...CARTAO, plano: "free", status: "incomplete" }, AGORA);
    expect(s.pro).toBe(false);
    expect(s.selo).toEqual({ tom: "run", texto: "Processando" });
    expect(s.podeAssinar).toBe(false);
  });

  it("Pro por Pix: nao renova sozinho e pode pagar mais 30 dias", () => {
    const s = situacaoDoPlano(PIX, AGORA);
    expect(s.forma).toBe("pix");
    expect(s.linha).toContain("Não renova sozinho");
    expect(s.podeRenovarPix).toBe(true);
    expect(s.podeCancelar).toBe(false);
    expect(s.aviso).toBeNull();
  });

  it("Pro sem fim e sem cartao (liberado no banco) nao vira Pix", () => {
    const s = situacaoDoPlano({ ...PIX, fimPeriodo: null }, AGORA);
    expect(s.pro).toBe(true);
    expect(s.forma).toBeNull();
    expect(s.podeRenovarPix).toBe(false);
    expect(s.podeCancelar).toBe(false);
    expect(s.linha).toBeNull();
  });

  it("Pro por Pix perto do fim avisa com os dias que faltam", () => {
    const s = situacaoDoPlano({ ...PIX, fimPeriodo: emDias(3) }, AGORA);
    expect(s.selo).toEqual({ tom: "warn", texto: "Vence em 3 dias" });
    expect(s.aviso?.titulo).toBe("Seu acesso vence em 3 dias");
    expect(situacaoDoPlano({ ...PIX, fimPeriodo: emDias(0.5) }, AGORA).selo.texto).toBe("Vence em 1 dia");
  });

  it("Pro por Pix vencido nao vale, mesmo com o banco dizendo pro (espelha access.ts)", () => {
    const s = situacaoDoPlano({ ...PIX, fimPeriodo: "2026-09-30T12:00:00Z" }, AGORA);
    expect(s.pro).toBe(false);
    expect(s.podeAssinar).toBe(true);
    expect(s.linha).toBe("Os 30 dias pagos por Pix terminaram em 30/09/2026.");
  });

  it("assinatura legada: aviso para falar com o suporte, sem cancelar por aqui", () => {
    const s = situacaoDoPlano({ ...CARTAO, provedor: "stripe", temAssinaturaCartao: false }, AGORA);
    expect(s.forma).toBe("legado");
    expect(s.podeCancelar).toBe(false);
    expect(s.aviso?.texto).toContain("suporte");
  });

  it("acesso liberado pela equipe nao oferece assinar", () => {
    const s = situacaoDoPlano({ ...FREE, acessoLiberado: true }, AGORA);
    expect(s.titulo).toBe("Acesso liberado");
    expect(s.podeAssinar).toBe(false);
  });

  it("assinatura encerrada diz quando terminou", () => {
    const s = situacaoDoPlano(
      { ...FREE, status: "canceled", fimPeriodo: "2026-09-01T12:00:00Z", temAssinaturaCartao: true },
      AGORA
    );
    expect(s.linha).toBe("Sua assinatura terminou em 01/09/2026.");
  });
});

describe("motivoDoBloqueio (paywall)", () => {
  it("clonagem gratuita usada", () => {
    expect(motivoDoBloqueio({ ...FREE, usouClonagemGratis: true }, AGORA)).toBe(
      "Você já usou a clonagem gratuita desta conta."
    );
  });
  it("Pix vencido diz a data", () => {
    expect(motivoDoBloqueio({ ...PIX, fimPeriodo: "2026-09-30T12:00:00Z" }, AGORA)).toContain("30/09/2026");
  });
  it("sem perfil: frase generica, sem inventar motivo", () => {
    expect(motivoDoBloqueio(null, AGORA)).toBe("Para continuar usando o xcart, assine o Pro.");
  });
  it("quem tem acesso nao ve motivo (null)", () => {
    expect(motivoDoBloqueio(CARTAO, AGORA)).toBeNull();
    expect(motivoDoBloqueio({ ...FREE, acessoLiberado: true }, AGORA)).toBeNull();
  });
});

describe("mensagemDeErro: nada de ingles nem nome de fornecedor na tela", () => {
  it("mensagem nossa passa como esta", () => {
    expect(mensagemDeErro(409, "Você já tem uma assinatura ativa.", ERRO_PADRAO.cartao)).toEqual({
      texto: "Você já tem uma assinatura ativa.",
      detalhe: null,
    });
  });
  it("mensagem do processador vira a padrao, com o cru recolhido", () => {
    const e = mensagemDeErro(502, "Pagou respondeu 502", ERRO_PADRAO.pix);
    expect(e.texto).toBe(ERRO_PADRAO.pix);
    expect(e.detalhe).toBe("Pagou respondeu 502");
    expect(mensagemDeErro(422, "card: declined", ERRO_PADRAO.cartao).texto).toBe(ERRO_PADRAO.cartao);
  });
  it("mensagens do formulario de cartao passam", () => {
    expect(
      mensagemDeErro(null, "Não foi possível carregar o formulário de pagamento.", ERRO_PADRAO.cartao).texto
    ).toBe("Não foi possível carregar o formulário de pagamento.");
  });
  it("sessao expirada", () => {
    expect(mensagemDeErro(401, "Unauthorized", ERRO_PADRAO.pix).texto).toBe(
      "Sua sessão expirou. Entre de novo para continuar."
    );
  });
  it("as mensagens padrao nao citam o fornecedor", () => {
    for (const m of Object.values(ERRO_PADRAO)) expect(m).not.toMatch(/pagou|stripe/i);
  });
});

describe("historico de compras", () => {
  it("rotulos em portugues", () => {
    const base = { credits: 200, method: "pix", provider: "pagou", status: "paid" };
    expect(rotuloCompra({ ...base, kind: "credits" })).toBe("200 créditos");
    expect(rotuloCompra({ ...base, kind: "pro_month" })).toBe("Plano Pro · 30 dias");
    expect(rotuloCompra({ ...base, kind: "credits", credits: 1 })).toBe("1 crédito");
    expect(formaDaCompra({ ...base, kind: "credits" })).toBe("Pix");
    expect(formaDaCompra({ ...base, kind: "credits", method: null, provider: "stripe" })).toBe("Cartão");
  });
  it("status cru vira palavra; desconhecido nao aparece cru", () => {
    expect(situacaoDaCompra("paid")).toEqual({ tom: "ok", texto: "Paga" });
    expect(situacaoDaCompra("pending").texto).toBe("Não confirmada");
    expect(situacaoDaCompra("refused").tom).toBe("err");
    expect(situacaoDaCompra("xyz").texto).toBe("Sem confirmação");
  });
});

describe("formatos", () => {
  it("contagem mm:ss, nunca negativa", () => {
    expect(contagem(12 * 60 * 1000)).toBe("12:00");
    expect(contagem(61_000)).toBe("01:01");
    expect(contagem(500)).toBe("00:01");
    expect(contagem(-5000)).toBe("00:00");
  });
  it("mascara de CPF", () => {
    expect(mascaraCpf("12345678901")).toBe("123.456.789-01");
    expect(mascaraCpf("123.456")).toBe("123.456");
    expect(mascaraCpf("123456789012345")).toBe("123.456.789-01");
  });
  it("data no horario de Sao Paulo", () => {
    // 02h UTC do dia 04 ainda e dia 03 em Sao Paulo.
    expect(dataCurta("2026-10-04T02:00:00Z")).toBe("03/10/2026");
    expect(dataCurta(null)).toBeNull();
    expect(dataCurta("nao e data")).toBeNull();
  });
});

describe("beneficios: uma lista so", () => {
  it("comeca por lucro, rastreamento e alertas (decisao 2)", () => {
    expect(BENEFICIOS_PRO[0]).toMatch(/^Lucro/);
    expect(BENEFICIOS_PRO[1]).toMatch(/^Rastreamento/);
    expect(BENEFICIOS_PRO[2]).toMatch(/^Alertas/);
  });
  it("nao promete teste gratis nem preco escrito a mao", () => {
    for (const b of BENEFICIOS_PRO) {
      expect(b).not.toMatch(/grátis|gratuit|R\$|\$/i);
    }
  });
});
