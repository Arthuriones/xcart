import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mensagemDaVenda,
  montarEnvio,
  urlDeWebhookValida,
  vendaDoPedido,
  type Venda,
} from "@/lib/alertas/venda-webhook";

/**
 * Notificacao de venda no celular: cada servico quer um formato, e o corpo
 * sai pelo host da URL que o lojista colou.
 */
const VENDA: Venda = {
  loja: "Softnook",
  pedido: "#1012",
  valor: 69.9,
  moeda: "USD",
  statusFinanceiro: "paid",
  produtos: ["The Stripe Bath Sheet (Set of 3)"],
};

describe("mensagem", () => {
  it("venda paga e 'Venda aprovada', com valor formatado e loja, pedido e produto", () => {
    expect(mensagemDaVenda(VENDA)).toEqual({
      titulo: "Venda aprovada · $69.90",
      texto: "Softnook · #1012 · The Stripe Bath Sheet (Set of 3)",
    });
  });

  it("pagamento pendente e 'Nova venda'; mais de 2 produtos resume", () => {
    const m = mensagemDaVenda({ ...VENDA, statusFinanceiro: "pending", produtos: ["A", "B", "C", "D"] });
    expect(m.titulo).toBe("Nova venda · $69.90");
    expect(m.texto).toBe("Softnook · #1012 · A, B +2");
  });

  it("monta a venda do pedido do webhook", () => {
    const v = vendaDoPedido(
      {
        name: "#1013",
        total_price: "139.80",
        currency: "gbp",
        financial_status: "paid",
        line_items: [{ title: "Towel", quantity: 2 }],
      },
      "Softnook"
    );
    expect(v).toEqual({
      loja: "Softnook",
      pedido: "#1013",
      valor: 139.8,
      moeda: "GBP",
      statusFinanceiro: "paid",
      produtos: ["2x Towel"],
    });
  });
});

describe("formato por servico", () => {
  it("Pushcut: JSON so com title e text", () => {
    const e = montarEnvio("https://api.pushcut.io/abc123/notifications/Venda", VENDA);
    expect(JSON.parse(e.body)).toEqual({
      title: "Venda aprovada · $69.90",
      text: "Softnook · #1012 · The Stripe Bath Sheet (Set of 3)",
    });
  });

  it("ntfy: texto puro e o titulo no header, so ASCII", () => {
    const e = montarEnvio("https://ntfy.sh/minhas-vendas", VENDA);
    expect(e.body).toBe("Softnook · #1012 · The Stripe Bath Sheet (Set of 3)");
    expect(e.headers.Title).toBe("Venda aprovada - $69.90");
  });

  it("Discord: content", () => {
    const e = montarEnvio("https://discord.com/api/webhooks/1/abc", VENDA);
    expect(JSON.parse(e.body).content).toContain("**Venda aprovada · $69.90**");
  });

  it("qualquer outro: JSON com os campos soltos", () => {
    const e = montarEnvio("https://hooks.zapier.com/hooks/catch/1/2", VENDA);
    expect(JSON.parse(e.body)).toMatchObject({ title: "Venda aprovada · $69.90", value: 69.9, currency: "USD", order: "#1012" });
  });
});

describe("URL", () => {
  it("so https, sem usuario e senha embutidos", () => {
    expect(urlDeWebhookValida("https://api.pushcut.io/x/notifications/y")).toBe(true);
    expect(urlDeWebhookValida("http://api.pushcut.io/x")).toBe(false);
    expect(urlDeWebhookValida("https://user:pass@exemplo.com/x")).toBe(false);
    expect(urlDeWebhookValida("javascript:alert(1)")).toBe(false);
    expect(urlDeWebhookValida("nao e url")).toBe(false);
  });
});
