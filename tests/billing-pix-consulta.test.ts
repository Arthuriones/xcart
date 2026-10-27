import { describe, expect, it } from "vitest";
import {
  esperaDaConsulta,
  lerConsulta,
  limiteDoPix,
  proximoStatus,
  type ConsultaPix,
} from "@/components/billing/pix-dialog";

// O modal do Pix nunca afirma "Nada foi cobrado" pelo relogio local: so quando
// a Pagou diz que o codigo morreu. O lojista no celular paga no app do banco e
// volta depois do prazo (o JS ficou parado); se a tela dissesse "expirou, nada
// foi cobrado", ele geraria outro Pix e pagaria duas vezes.

const MIN = 60_000;
const DOZE_MIN = 12 * MIN;

describe("limiteDoPix", () => {
  const agora = Date.parse("2026-10-27T15:00:00Z");

  it("usa o expiresAt da Pagou quando cai na faixa", () => {
    expect(limiteDoPix("2026-10-27T15:30:00Z", agora)).toBe(agora + 30 * MIN);
    expect(limiteDoPix("2026-10-27T16:59:00Z", agora)).toBe(agora + 119 * MIN);
  });

  it("aceita data com espaço (o Safari recusa sem o T)", () => {
    // Sem fuso: lida como hora local, nos dois lados.
    const local = new Date(2026, 9, 27, 12, 0, 0).getTime();
    expect(limiteDoPix("2026-10-27 12:20:00", local)).toBe(local + 20 * MIN);
  });

  it("sem data, ilegível ou fora da faixa: 12 min a partir de agora", () => {
    for (const v of [null, undefined, "", "amanhã", "2026-10-27T15:00:30Z", "2026-10-27T14:00:00Z"]) {
      expect(limiteDoPix(v, agora), String(v)).toBe(agora + DOZE_MIN);
    }
    // Data sem fuso lida no fuso errado cai horas longe: fora da faixa.
    expect(limiteDoPix("2026-10-27T18:10:00Z", agora)).toBe(agora + DOZE_MIN);
  });
});

describe("lerConsulta", () => {
  it("pago: aplicado por padrão, e aplicado:false quando o RPC falhou", () => {
    expect(lerConsulta(true, 200, { status: "paid", credited: true })).toEqual({ tipo: "pago", aplicado: true });
    expect(lerConsulta(true, 200, { status: "paid", credited: false, aplicado: false })).toEqual({
      tipo: "pago",
      aplicado: false,
    });
  });

  it("expired, canceled e refused encerram; o resto segue esperando", () => {
    for (const s of ["expired", "canceled", "refused"]) {
      expect(lerConsulta(true, 200, { status: s })).toEqual({ tipo: "encerrado" });
    }
    for (const s of ["waiting_payment", "pending", "processing"]) {
      expect(lerConsulta(true, 200, { status: s })).toEqual({ tipo: "aguardando" });
    }
  });

  it("erro do servidor, corpo ilegível ou sem status é falha, nunca desfecho", () => {
    for (const http of [404, 500, 502, 503]) {
      expect(lerConsulta(false, http, { error: "x" })).toEqual({ tipo: "falhou", sessao: false });
    }
    expect(lerConsulta(false, 401, { error: "Unauthorized" })).toEqual({ tipo: "falhou", sessao: true });
    expect(lerConsulta(true, 200, null)).toEqual({ tipo: "falhou", sessao: false });
    // Status so vale com resposta ok.
    expect(lerConsulta(false, 500, { status: "expired" })).toEqual({ tipo: "falhou", sessao: false });
  });
});

describe("proximoStatus", () => {
  const todas: ConsultaPix[] = [
    { tipo: "pago", aplicado: true },
    { tipo: "pago", aplicado: false },
    { tipo: "encerrado" },
    { tipo: "aguardando" },
    { tipo: "falhou", sessao: false },
    { tipo: "falhou", sessao: true },
  ];

  it("'Nada foi cobrado' (expirado) só quando a Pagou encerrou", () => {
    for (const c of todas) {
      for (const venceu of [false, true]) {
        const r = proximoStatus(c, venceu);
        if (c.tipo === "encerrado") expect(r).toBe("expirado");
        else expect(r).not.toBe("expirado");
      }
    }
  });

  it("antes do prazo, esperar ou falhar segue consultando", () => {
    expect(proximoStatus({ tipo: "aguardando" }, false)).toBeNull();
    expect(proximoStatus({ tipo: "falhou", sessao: false }, false)).toBeNull();
  });

  it("no prazo, a última consulta decide o texto", () => {
    expect(proximoStatus({ tipo: "aguardando" }, true)).toBe("tempo_acabou");
    expect(proximoStatus({ tipo: "falhou", sessao: false }, true)).toBe("nao_confirmado");
    expect(proximoStatus({ tipo: "pago", aplicado: true }, true)).toBe("pago");
  });

  it("pago sem aplicar fica em 'liberando' (o próximo PATCH repete o RPC)", () => {
    expect(proximoStatus({ tipo: "pago", aplicado: false }, false)).toBe("liberando");
    expect(proximoStatus({ tipo: "pago", aplicado: true }, false)).toBe("pago");
  });
});

describe("esperaDaConsulta", () => {
  const limite = Date.parse("2026-10-27T15:12:00Z");
  const SEG = 1000;

  it("esperando: a cada 4 s, e o tique do fim cai no prazo exato", () => {
    expect(esperaDaConsulta("aguardando", limite - 10 * MIN, limite)).toBe(4 * SEG);
    expect(esperaDaConsulta("aguardando", limite - 1500, limite)).toBe(1500);
    expect(esperaDaConsulta("liberando", limite + 5 * MIN, limite)).toBe(4 * SEG);
  });

  it("depois do prazo segue consultando: pago no fim do prazo aparece no modal", () => {
    // O lojista paga no ultimo segundo e a consulta do fim ainda volta
    // waiting_payment (ou 502): a tela promete que a confirmacao chega sozinha.
    for (const s of ["tempo_acabou", "nao_confirmado"] as const) {
      expect(esperaDaConsulta(s, limite + 2 * SEG, limite), s).toBe(4 * SEG);
      expect(esperaDaConsulta(s, limite + 29 * MIN, limite), s).toBe(4 * SEG);
    }
    // Nesses estados a consulta nao e mais a do fim (venceu = false): so pago,
    // liberando ou expirado trocam a tela; esperar ou falhar fica como esta.
    expect(proximoStatus({ tipo: "pago", aplicado: true }, false)).toBe("pago");
    expect(proximoStatus({ tipo: "pago", aplicado: false }, false)).toBe("liberando");
    expect(proximoStatus({ tipo: "encerrado" }, false)).toBe("expirado");
    expect(proximoStatus({ tipo: "aguardando" }, false)).toBeNull();
    expect(proximoStatus({ tipo: "falhou", sessao: true }, false)).toBeNull();
  });

  it("modal esquecido aberto para de consultar sozinho 30 min depois do prazo", () => {
    for (const s of ["tempo_acabou", "nao_confirmado"] as const) {
      expect(esperaDaConsulta(s, limite + 30 * MIN, limite), s).toBeNull();
    }
  });

  it("pago e expirado não consultam mais", () => {
    for (const s of ["pago", "expirado"] as const) {
      expect(esperaDaConsulta(s, limite - 5 * MIN, limite), s).toBeNull();
      expect(esperaDaConsulta(s, limite + 5 * MIN, limite), s).toBeNull();
    }
  });
});
