import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ERRO_CARTAO,
  ERRO_PADRAO,
  desfechoDoCartao,
  mensagemDeErro,
} from "@/components/billing/regras";

// Assinatura no cartao pela Pagou: o Payment Element precisa de volta a
// TRANSACAO da 1a cobranca ({ id, status, next_action }) para rodar o 3DS e
// ler o desfecho. Pela doc (developer.pagou.ai):
//  - POST /v2/subscriptions nao traz `transactions` ("Included on GET by id");
//  - GET /v2/subscriptions/{id} traz, do mais novo para o mais antigo, sem
//    next_action;
//  - GET /v2/transactions/{id} traz o next_action.
// E o formulario so avisa o pai depois que o submit do SDK resolve.

type Linha = Record<string, unknown>;

const estado = { perfil: {} as Linha, updates: [] as Linha[] };

function adminFalso() {
  return {
    from: () => {
      let patch: Linha | null = null;
      const api = {
        select: () => api,
        eq: () => api,
        update: (p: Linha) => {
          patch = p;
          return api;
        },
        single: async () => ({ data: estado.perfil, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch) estado.updates.push(patch);
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return api;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@b.com" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminFalso() }));

const createSubscription = vi.fn();
const getSubscription = vi.fn();
const getTransaction = vi.fn();
const cancelSubscription = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getOrCreateCustomer: async () => "cus_1",
  createSubscription: (...a: unknown[]) => createSubscription(...a),
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  getTransaction: (...a: unknown[]) => getTransaction(...a),
  cancelSubscription: (...a: unknown[]) => cancelSubscription(...a),
}));

const { POST: assinar } = await import("@/app/api/billing/subscribe/route");

const req = (corpo: unknown) =>
  new NextRequest("http://localhost/api/billing/subscribe", {
    method: "POST",
    body: JSON.stringify(corpo),
  });

const DESAFIO = {
  type: "three_ds_challenge",
  challenge_session_id: "chs_1",
  client_secret: "cs_1",
  expires_at: "2026-10-08T12:10:00Z",
  three_ds_stage: "post_charge",
};

function assinaturaCriada(status: string) {
  createSubscription.mockImplementation(async (p: { amountCents: number }) => ({
    id: "sub_1",
    status,
    amount: p.amountCents,
    currentPeriodEnd: "2026-11-08T00:00:00Z",
  }));
}

beforeEach(() => {
  estado.perfil = { plan: "free", pagou_subscription_id: null, subscription_status: null };
  estado.updates = [];
  createSubscription.mockReset();
  getSubscription.mockReset();
  getTransaction.mockReset();
  cancelSubscription.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/billing/subscribe devolve a transação da 1ª cobrança", () => {
  it("3DS: assinatura incomplete -> GET da assinatura -> GET da transação, next_action intacto", async () => {
    assinaturaCriada("incomplete");
    getSubscription.mockResolvedValue({
      id: "sub_1",
      status: "incomplete",
      transactions: [{ id: "tx_1", status: "three_ds_required", createdAt: "2026-10-08T12:00:00Z" }],
    });
    getTransaction.mockResolvedValue({
      id: "tx_1",
      status: "three_ds_required",
      next_action: DESAFIO,
      // O resto da transacao (dados do comprador) nao vai ao navegador.
      buyer: { name: "A", email: "a@b.com" },
    });

    const r = await assinar(req({ cardToken: "pgct_x", plano: "lojas3" }));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    expect(getSubscription).toHaveBeenCalledWith("sub_1");
    expect(getTransaction).toHaveBeenCalledWith("tx_1");
    expect(corpo.transaction).toEqual({ id: "tx_1", status: "three_ds_required", next_action: DESAFIO });
    expect(corpo.pending).toBe(true);
    expect(corpo).not.toHaveProperty("mensagem");
    // O plano escolhido continua mandando no valor.
    expect(createSubscription.mock.calls[0][0]).toMatchObject({ amountCents: 11990, plano: "lojas3" });
    expect(estado.updates.at(-1)).toMatchObject({ plan: "free", subscription_status: "incomplete" });
  });

  it("aprovada direto: devolve a transação (sem next_action) e não fica pendente", async () => {
    assinaturaCriada("active");
    getSubscription.mockResolvedValue({ id: "sub_1", status: "active", transactions: [{ id: "tx_1" }] });
    getTransaction.mockResolvedValue({ id: "tx_1", status: "captured" });

    const corpo = await (await assinar(req({ cardToken: "pgct_x", plano: "loja1" }))).json();
    expect(corpo.transaction).toEqual({ id: "tx_1", status: "captured", next_action: null });
    expect(corpo.pending).toBe(false);
  });

  it("usa a transação mais nova (a lista vem por createdAt desc)", async () => {
    assinaturaCriada("incomplete");
    getSubscription.mockResolvedValue({
      id: "sub_1",
      status: "incomplete",
      transactions: [{ id: "tx_novo" }, { id: "tx_velho" }],
    });
    getTransaction.mockResolvedValue({ id: "tx_novo", status: "pending" });
    await assinar(req({ cardToken: "pgct_x", plano: "loja1" }));
    expect(getTransaction).toHaveBeenCalledWith("tx_novo");
  });

  it("assinatura sem transação ainda: pending com mensagem, sem quebrar", async () => {
    assinaturaCriada("incomplete");
    getSubscription.mockResolvedValue({ id: "sub_1", status: "incomplete", transactions: [] });

    const r = await assinar(req({ cardToken: "pgct_x", plano: "loja1" }));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(getTransaction).not.toHaveBeenCalled();
    expect(corpo.transaction).toBeNull();
    expect(corpo.pending).toBe(true);
    expect(corpo.mensagem).toMatch(/libera assim que o banco confirmar/);
    expect(corpo.subscriptionId).toBe("sub_1");
  });

  it("a Pagou falha no GET depois de criar: 200 com pending, nunca erro (o cartão pode já ter sido cobrado)", async () => {
    assinaturaCriada("incomplete");
    getSubscription.mockResolvedValue({ id: "sub_1", status: "incomplete", transactions: [{ id: "tx_1" }] });
    getTransaction.mockRejectedValue(new Error("fora do ar"));

    const r = await assinar(req({ cardToken: "pgct_x", plano: "loja1" }));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.transaction).toBeNull();
    expect(corpo.pending).toBe(true);
    expect(corpo.mensagem).toBeTruthy();
    expect(estado.updates.at(-1)).toMatchObject({ pagou_subscription_id: "sub_1" });
  });

  it("ativa mas sem conseguir a transação: não vira pendente (active só vem com a cobrança aprovada)", async () => {
    assinaturaCriada("active");
    getSubscription.mockRejectedValue(new Error("fora do ar"));
    const corpo = await (await assinar(req({ cardToken: "pgct_x", plano: "loja1" }))).json();
    expect(corpo.transaction).toBeNull();
    expect(corpo.pending).toBe(false);
    expect(corpo).not.toHaveProperty("mensagem");
  });

  it("Pix automático não busca transação de cartão", async () => {
    assinaturaCriada("incomplete");
    const corpo = await (await assinar(req({ method: "pix_automatic", plano: "loja1" }))).json();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
    expect(corpo.transaction).toBeNull();
    expect(corpo.pending).toBe(true);
    expect(corpo).not.toHaveProperty("mensagem");
  });
});

describe("desfechoDoCartao: o que fazer depois que o submit do SDK resolve", () => {
  const comTransacao = { transaction: { id: "tx_1", status: "three_ds_required" }, pending: true };

  it.each(["succeeded", "completed", "paid", "captured"])("%s aprova", (status) => {
    expect(desfechoDoCartao({ status, servidor: comTransacao })).toEqual({ tipo: "aprovado" });
  });

  it.each(["processing", "pending", "authorized", "algo_novo", undefined])(
    "%s fica pendente (o webhook confirma)",
    (status) => {
      expect(desfechoDoCartao({ status, servidor: comTransacao })).toEqual({ tipo: "pendente" });
    }
  );

  it.each([
    ["refused", ERRO_CARTAO.recusado],
    ["failed", ERRO_CARTAO.recusado],
    ["canceled", ERRO_CARTAO.cancelado],
    ["timed_out", ERRO_CARTAO.expirou],
    ["requires_action", ERRO_CARTAO.autenticacao],
  ])("%s é erro, com mensagem curta em português", (status, msg) => {
    expect(desfechoDoCartao({ status, servidor: comTransacao })).toEqual({ tipo: "erro", bruto: msg });
    // E a tela mostra a mensagem como esta, sem trocar pela padrao.
    expect(mensagemDeErro(null, msg, ERRO_PADRAO.cartao)).toEqual({ texto: msg, detalhe: null });
  });

  it("recusa não aparece como 'processando'", () => {
    expect(desfechoDoCartao({ status: "refused", servidor: comTransacao }).tipo).toBe("erro");
  });

  it("o erro do nosso servidor vence o do SDK", () => {
    const d = desfechoDoCartao({ status: "error", erro: "Você já tem uma assinatura ativa.", servidor: null });
    expect(d).toEqual({ tipo: "erro", bruto: "Você já tem uma assinatura ativa." });
  });

  it("erro do SDK depois de criar a assinatura com transação: erro, para tentar de novo", () => {
    const d = desfechoDoCartao({ status: "error", erro: "challenge iframe failed", servidor: comTransacao });
    expect(d.tipo).toBe("erro");
    // Texto cru em ingles nao vai para a tela: vira a padrao, com o cru recolhido.
    if (d.tipo === "erro") expect(mensagemDeErro(null, d.bruto, ERRO_PADRAO.cartao).texto).toBe(ERRO_PADRAO.cartao);
  });

  it("sem transação na resposta, quem decide é o servidor (o SDK não teve o que resolver)", () => {
    expect(
      desfechoDoCartao({ status: "error", servidor: { transaction: null, pending: true } })
    ).toEqual({ tipo: "pendente" });
    expect(
      desfechoDoCartao({ status: "active", servidor: { transaction: null, pending: false } })
    ).toEqual({ tipo: "aprovado" });
  });

  it("sem resposta do servidor e sem texto: erro com o status recolhido para o suporte", () => {
    const d = desfechoDoCartao({ status: undefined, servidor: null });
    expect(d).toEqual({ tipo: "erro", bruto: "Pagamento não concluído (sem status)" });
  });
});

describe("pagou-card-form: o pai só fica sabendo depois do submit", () => {
  const fonte = readFileSync(
    path.join(process.cwd(), "src/components/billing/pagou-card-form.tsx"),
    "utf8"
  );

  it("submit em modo assinatura", () => {
    expect(fonte).toMatch(/mode:\s*"subscription"/);
  });

  it("onSuccess não é chamado dentro do createTransaction (desmontava o iframe no meio do 3DS)", () => {
    const inicio = fonte.indexOf("createTransaction: async");
    const fim = fonte.indexOf("desfecho = desfechoDoCartao", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(fonte.slice(inicio, fim)).not.toContain("onSuccess(");
  });
});
