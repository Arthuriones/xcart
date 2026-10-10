import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarNotificacaoDeVenda,
  formatarValor,
  webhookDeVendaDoDono,
  type Venda,
} from "@/lib/alertas/venda-webhook";
import type { Notificacao } from "./receber";

// ============================================================================
// "Venda no celular" para checkout externo: a mesma URL e o mesmo envio da
// venda da Shopify (src/lib/alertas/venda-webhook.ts), com o titulo
// "Novo pedido · <valor>" e o texto "Checkout · #12345 · Produto · comissão".
// Roda depois da resposta (after): falhou, so vai para o log.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** Puro, para os testes. */
export function vendaDoPedidoExterno(n: Notificacao): Venda {
  const comissao = `comissão ${formatarValor(n.comissao, n.moedaComissao)}`;
  if (n.tipo === "aprovado") {
    return {
      loja: n.checkout,
      pedido: n.pedido,
      valor: n.comissao,
      moeda: n.moedaComissao,
      statusFinanceiro: null,
      produtos: n.produto ? [n.produto] : [],
      rotulo: "Comissão aprovada",
    };
  }
  return {
    loja: n.checkout,
    pedido: n.pedido,
    valor: n.valor,
    moeda: n.moeda,
    statusFinanceiro: null,
    produtos: n.produto ? [n.produto] : [],
    rotulo: "Novo pedido",
    detalhe: comissao,
  };
}

export async function notificarPedidoExterno(admin: Admin, userId: string, n: Notificacao): Promise<void> {
  try {
    const url = await webhookDeVendaDoDono(admin, userId);
    if (!url) return;
    const r = await enviarNotificacaoDeVenda(url, vendaDoPedidoExterno(n));
    if (!r.ok) console.warn("[checkout/webhook] notificacao de venda falhou", r.erro);
  } catch (e) {
    console.error("[checkout/webhook] notificacao de venda", e instanceof Error ? e.message : e);
  }
}
