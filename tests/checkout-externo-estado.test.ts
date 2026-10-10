import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aplicarEvento, eventoVence, type EstadoPedido } from "@/lib/checkouts-externos/estado";
import { exemploSphere, sphere } from "@/lib/checkouts-externos/plataformas/sphere";
import type { EventoNormalizado } from "@/lib/checkouts-externos/plataformas";
import {
  receberEvento,
  type CheckoutParaReceber,
  type MarcaCheckout,
  type PedidoGravado,
  type RepositorioCheckout,
} from "@/lib/checkouts-externos/receber";
import { vendaDoPedidoExterno } from "@/lib/checkouts-externos/notificar";
import { mensagemDaVenda } from "@/lib/alertas/venda-webhook";

// O estado do pedido externo com eventos em qualquer ordem, e a trava de
// idempotencia do webhook: a mesma movimentacao do mesmo pedido nao duplica,
// a retentativa atrasada nao desfaz o que ja andou, e o teste nunca vira pedido.

const AGORA = new Date("2026-07-16T15:00:00.000Z");

function evento(
  ev: string,
  situacao: EventoNormalizado["receita"]["situacao"],
  dataEvento: string,
  extra: Partial<EventoNormalizado> = {}
): EventoNormalizado {
  return {
    evento: ev,
    dataEvento,
    pedidoId: "12345",
    pedido: {
      status: "created",
      metodo: "cod",
      produto: "EVOX",
      pais: "IT",
      moeda: "EUR",
      valor: 89.9,
      criadoEm: "2026-07-14T10:15:00.000Z",
    },
    receita: { valor: 75, moeda: null, situacao, statusOriginal: null },
    conta: "ywq2mdhu",
    programa: "the-box-italia",
    teste: false,
    ...extra,
  };
}

/** Aplica os eventos na ordem dada, como o webhook faria. */
function aplicar(eventos: EventoNormalizado[]): EstadoPedido {
  let atual: EstadoPedido | null = null;
  for (const e of eventos) atual = aplicarEvento(atual, e, "Europe/Rome").pedido;
  return atual!;
}

const CRIADO = evento("pedido.criado", "pendente", "2026-07-14T10:15:01.000Z");
const APROVADA = evento("comissao.aprovada", "aprovado", "2026-07-15T09:00:00.000Z");
const PAGA = evento("comissao.paga", "pago", "2026-07-16T14:32:05.000Z");
const EXPIRADO = evento("pedido.expirado", "expirado", "2026-07-16T14:00:00.000Z");

describe("aplicarEvento: ordem dos eventos", () => {
  it("na ordem certa: pendente -> aprovado -> pago, com as datas de cada etapa", () => {
    const p = aplicar([CRIADO, APROVADA, PAGA]);
    expect(p.situacao).toBe("pago");
    expect(p.aprovado_em).toBe(APROVADA.dataEvento);
    expect(p.pago_em).toBe(PAGA.dataEvento);
    expect(p.perdido_em).toBeNull();
    expect(p.atualizado_em).toBe(PAGA.dataEvento);
    expect(p.dia_local).toBe("2026-07-14");
  });

  it("paga antes de aprovada: continua paga, e a aprovacao completa a data", () => {
    const p = aplicar([CRIADO, PAGA, APROVADA]);
    expect(p.situacao).toBe("pago");
    expect(p.aprovado_em).toBe(APROVADA.dataEvento);
    expect(p.atualizado_em).toBe(PAGA.dataEvento);
  });

  it("aprovada disparada DEPOIS da paga (data mais nova) nao regride a paga", () => {
    const aprovadaTarde = evento("comissao.aprovada", "aprovado", "2026-07-16T14:40:00.000Z");
    expect(aplicar([CRIADO, PAGA, aprovadaTarde]).situacao).toBe("pago");
  });

  it("pedido.criado atrasado nao volta para pendente", () => {
    const criadoTarde = evento("pedido.criado", "pendente", "2026-07-16T15:00:00.000Z");
    expect(aplicar([APROVADA, criadoTarde]).situacao).toBe("aprovado");
  });

  it("se o pedido.criado se perdeu, a aprovacao cria o pedido com todos os campos", () => {
    const p = aplicar([APROVADA]);
    expect(p).toMatchObject({ situacao: "aprovado", produto: "EVOX", pais: "IT", valor: 89.9, receita: 75, moeda: "EUR" });
  });

  it("no mesmo instante vence a etapa mais adiante", () => {
    const t = "2026-07-16T10:00:00.000Z";
    expect(eventoVence({ situacao: "aprovado", atualizado_em: t }, { situacao: "pago", dataEvento: t })).toBe(true);
    expect(eventoVence({ situacao: "pago", atualizado_em: t }, { situacao: "expirado", dataEvento: t })).toBe(true);
    expect(eventoVence({ situacao: "expirado", atualizado_em: t }, { situacao: "pago", dataEvento: t })).toBe(false);
  });

  it("expirado mais novo que o pendente perde a comissao; estorno depois de paga tambem", () => {
    const exp = aplicar([CRIADO, EXPIRADO]);
    expect(exp.situacao).toBe("expirado");
    expect(exp.perdido_em).toBe(EXPIRADO.dataEvento);
    const estorno = evento("comissao.revertida", "revertido", "2026-07-16T14:50:00.000Z");
    expect(aplicar([CRIADO, APROVADA, PAGA, estorno]).situacao).toBe("revertido");
  });

  it("evento velho e repetido nao muda nada", () => {
    const p = aplicar([CRIADO, APROVADA]);
    expect(aplicarEvento(p, APROVADA, "Europe/Rome").mudou).toBe(false);
    expect(aplicarEvento(p, CRIADO, "Europe/Rome").mudou).toBe(false);
  });

  it("o dia do pedido segue o fuso do checkout", () => {
    const tarde = evento("pedido.criado", "pendente", "2026-07-14T23:30:00.000Z", {
      pedido: { ...CRIADO.pedido, criadoEm: "2026-07-14T23:30:00.000Z" },
    });
    expect(aplicarEvento(null, tarde, "Europe/Rome").pedido.dia_local).toBe("2026-07-15");
    expect(aplicarEvento(null, tarde, "America/Sao_Paulo").pedido.dia_local).toBe("2026-07-14");
  });
});

// ---------------------------------------------------------------------------
// receberEvento com um repositorio em memoria
// ---------------------------------------------------------------------------

interface Memoria {
  repo: RepositorioCheckout;
  eventos: Set<string>;
  pedidos: Map<string, PedidoGravado>;
  marcas: MarcaCheckout[];
  contas: Map<string, string>;
  soltos: string[];
}

function memoria(opcoes: { falharInsert?: number; corridaUpdate?: number; contaEmUso?: string } = {}): Memoria {
  const m: Memoria = {
    eventos: new Set(),
    pedidos: new Map(),
    marcas: [],
    contas: new Map(),
    soltos: [],
    repo: undefined as never,
  };
  let falhas = opcoes.falharInsert ?? 0;
  let corridas = opcoes.corridaUpdate ?? 0;
  m.repo = {
    async travarEvento(x) {
      const k = `${x.checkout_id}|${x.pedido_id}|${x.evento}`;
      if (m.eventos.has(k)) return "duplicado";
      m.eventos.add(k);
      return "ok";
    },
    async soltarEvento(x) {
      const k = `${x.checkout_id}|${x.pedido_id}|${x.evento}`;
      m.eventos.delete(k);
      m.soltos.push(k);
    },
    async lerPedido(ck, id) {
      const p = m.pedidos.get(`${ck}|${id}`);
      return p ? { ...p } : null;
    },
    async inserirPedido(x) {
      if (falhas > 0) {
        falhas -= 1;
        throw new Error("banco fora");
      }
      const k = `${x.checkout_id}|${x.pedido_id}`;
      if (m.pedidos.has(k)) return "existe";
      m.pedidos.set(k, { ...x.pedido, versao: 0 });
      return "ok";
    },
    async atualizarPedido(x) {
      const k = `${x.checkout_id}|${x.pedido_id}`;
      const atual = m.pedidos.get(k);
      if (!atual) return false;
      if (corridas > 0) {
        // Outro evento gravou no meio: a versao andou.
        corridas -= 1;
        m.pedidos.set(k, { ...atual, versao: atual.versao + 1 });
        return false;
      }
      if (atual.versao !== x.versao) return false;
      m.pedidos.set(k, { ...x.pedido, versao: x.versao + 1 });
      return true;
    },
    async fixarConta(ck, conta) {
      if (opcoes.contaEmUso === conta) return "em_uso";
      const atual = m.contas.get(ck);
      if (!atual) {
        m.contas.set(ck, conta);
        return "ok";
      }
      return atual === conta ? "ok" : "outra";
    },
    async marcarCheckout(_ck, campos) {
      m.marcas.push(campos);
    },
  };
  return m;
}

const CHECKOUT: CheckoutParaReceber = {
  id: "ck-1",
  user_id: "u-1",
  plataforma: "sphere",
  nome: "Sphere Itália",
  ativo: true,
  fuso: "Europe/Rome",
  moeda_receita: "EUR",
  conta_externa: null,
  notificar_aprovada: false,
};

function corpo(evento: string, status: string, dataEvento: string, extra: Record<string, unknown> = {}) {
  return {
    evento,
    data_evento: dataEvento,
    webhook_id: 3,
    pedido: {
      id: 12345,
      status: "created",
      metodo_pagamento: "cod",
      produto: "EVOX 3+3 Grátis",
      pais: "IT",
      moeda: "EUR",
      valor: "89.90",
      criado_em: "2026-07-14T10:15:00.000Z",
    },
    comissao: { valor: "75.00", status },
    afiliado: { codigo: "ywq2mdhu", programa_id: "the-box-italia" },
    ...extra,
  };
}

const C_CRIADO = corpo("pedido.criado", "pending", "2026-07-14T10:15:01.000Z");
const C_APROVADA = corpo("comissao.aprovada", "approved", "2026-07-15T09:00:00.000Z");
const C_PAGA = corpo("comissao.paga", "paid", "2026-07-16T14:32:05.000Z");

describe("receberEvento: idempotencia", () => {
  it("o mesmo evento do mesmo pedido entra uma vez; a notificacao sai uma vez", async () => {
    const m = memoria();
    const a = await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    const b = await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    expect(a.status).toBe(200);
    expect(a.notificar).toMatchObject({ tipo: "criado", pedido: "#12345", comissao: 75, valor: 89.9 });
    expect(b).toEqual({ status: 200, corpo: { ok: true, duplicado: true }, notificar: null });
    expect(m.pedidos.size).toBe(1);
    expect(m.pedidos.get("ck-1|12345")?.versao).toBe(0);
  });

  it("eventos fora de ordem: a paga antes da aprovada nao regride", async () => {
    const m = memoria();
    await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    await receberEvento(m.repo, CHECKOUT, sphere, C_PAGA, AGORA);
    const r = await receberEvento(m.repo, CHECKOUT, sphere, C_APROVADA, AGORA);
    expect(r.status).toBe(200);
    const p = m.pedidos.get("ck-1|12345")!;
    expect(p.situacao).toBe("pago");
    expect(p.aprovado_em).toBe("2026-07-15T09:00:00.000Z");
    // Cada movimentacao travou a sua chave.
    expect([...m.eventos].sort()).toEqual([
      "ck-1|12345|comissao.aprovada",
      "ck-1|12345|comissao.paga",
      "ck-1|12345|pedido.criado",
    ]);
  });

  it("falha ao gravar solta a trava e responde 503; a retentativa passa", async () => {
    const m = memoria({ falharInsert: 1 });
    const a = await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    expect(a.status).toBe(503);
    expect(a.notificar).toBeNull();
    expect(m.soltos).toEqual(["ck-1|12345|pedido.criado"]);
    expect(m.pedidos.size).toBe(0);
    const b = await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    expect(b.status).toBe(200);
    expect(m.pedidos.size).toBe(1);
  });

  it("outro evento gravando no meio: le de novo e grava (trava otimista)", async () => {
    const m = memoria({ corridaUpdate: 1 });
    await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    const r = await receberEvento(m.repo, CHECKOUT, sphere, C_APROVADA, AGORA);
    expect(r.status).toBe(200);
    expect(m.pedidos.get("ck-1|12345")?.situacao).toBe("aprovado");
  });
});

describe("receberEvento: teste, pausa, conta e corpo invalido", () => {
  it("evento de teste nao vira pedido: so marca 'teste recebido'", async () => {
    const m = memoria();
    const r = await receberEvento(m.repo, CHECKOUT, sphere, exemploSphere(AGORA), AGORA);
    expect(r).toEqual({ status: 200, corpo: { ok: true, teste: true }, notificar: null });
    expect(m.pedidos.size).toBe(0);
    expect(m.eventos.size).toBe(0);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_evento_teste: true, ultimo_erro: null });
    // E nao fixa a conta de afiliado do teste.
    expect(m.contas.size).toBe(0);
  });

  it("checkout pausado responde 200 e ignora", async () => {
    const m = memoria();
    const r = await receberEvento(m.repo, { ...CHECKOUT, ativo: false }, sphere, C_CRIADO, AGORA);
    expect(r.corpo).toEqual({ ok: true, ignorado: "checkout pausado" });
    expect(m.pedidos.size).toBe(0);
  });

  it("corpo invalido: 400 e o erro fica no checkout", async () => {
    const m = memoria();
    const r = await receberEvento(m.repo, CHECKOUT, sphere, { evento: "pedido.criado" }, AGORA);
    expect(r.status).toBe(400);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/pedido ausente/);
  });

  it("o primeiro evento fixa o afiliado; URL colada em outra conta e recusada", async () => {
    const m = memoria();
    await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    expect(m.contas.get("ck-1")).toBe("ywq2mdhu");
    const fixado = { ...CHECKOUT, conta_externa: "ywq2mdhu" };
    const outra = corpo("pedido.criado", "pending", "2026-07-16T10:00:00.000Z", {
      afiliado: { codigo: "outra123", programa_id: "x" },
      pedido: { ...C_CRIADO.pedido, id: 999 },
    });
    const r = await receberEvento(m.repo, fixado, sphere, outra, AGORA);
    expect(r.status).toBe(409);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/outra conta/);
    expect(m.pedidos.has("ck-1|999")).toBe(false);
  });

  it("afiliado que outro checkout do usuario ja recebe: 409 (contaria em dobro)", async () => {
    const m = memoria({ contaEmUso: "ywq2mdhu" });
    const r = await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    expect(r.status).toBe(409);
    expect(m.pedidos.size).toBe(0);
  });

  it("aviso de comissao aprovada so com o checkout pedindo", async () => {
    const m = memoria();
    await receberEvento(m.repo, CHECKOUT, sphere, C_CRIADO, AGORA);
    const sem = await receberEvento(m.repo, CHECKOUT, sphere, C_APROVADA, AGORA);
    expect(sem.notificar).toBeNull();
    const m2 = memoria();
    const com = await receberEvento(m2.repo, { ...CHECKOUT, notificar_aprovada: true }, sphere, C_APROVADA, AGORA);
    expect(com.notificar?.tipo).toBe("aprovado");
  });
});

describe("notificacao 'Venda no celular'", () => {
  it("Novo pedido · valor, com checkout, produto e comissao no texto", () => {
    const v = vendaDoPedidoExterno({
      tipo: "criado",
      checkout: "Sphere Itália",
      pedido: "#12345",
      produto: "EVOX 3+3 Grátis",
      valor: 89.9,
      moeda: "EUR",
      comissao: 75,
      moedaComissao: "EUR",
    });
    expect(mensagemDaVenda(v)).toEqual({
      titulo: "Novo pedido · €89.90",
      texto: "Sphere Itália · #12345 · EVOX 3+3 Grátis · comissão €75.00",
    });
  });

  it("comissao aprovada: o titulo traz a comissao", () => {
    const v = vendaDoPedidoExterno({
      tipo: "aprovado",
      checkout: "Sphere Itália",
      pedido: "#12345",
      produto: null,
      valor: 89.9,
      moeda: "EUR",
      comissao: 75,
      moedaComissao: "EUR",
    });
    expect(mensagemDaVenda(v).titulo).toBe("Comissão aprovada · €75.00");
  });
});
