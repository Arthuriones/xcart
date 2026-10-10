import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Notificacao de venda no celular: o xcart chama a URL que o lojista colou
// (Pushcut, ntfy, Discord ou qualquer webhook) a cada venda.
//
// Cada servico quer um formato, entao o corpo sai pelo host:
//   - Pushcut (api.pushcut.io): JSON {title, text}.
//   - ntfy (ntfy.sh ou servidor proprio com "ntfy" no host): texto puro no
//     corpo e o titulo no header Title.
//   - Discord (discord.com/api/webhooks): JSON {content}.
//   - Qualquer outro (Zapier, Make, n8n, IFTTT...): JSON com title, text e os
//     campos soltos (loja, pedido, valor, moeda), para o lojista montar o que
//     quiser.
//
// A URL e SEGREDO (a do Pushcut tem a chave da conta) e vem do usuario: nunca
// vai para log, e sai so por safeFetch (recusa rede privada e revalida cada
// redirect). Nunca derruba o webhook da Shopify: falhou, so loga o host.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const TIMEOUT_MS = 4_000;

export interface Venda {
  loja: string;
  pedido: string;
  valor: number;
  moeda: string;
  /** "paid" vira "Venda aprovada"; o resto, "Nova venda". */
  statusFinanceiro?: string | null;
  produtos: string[];
  /** Troca o "Nova venda" do titulo (checkout externo: "Novo pedido"). */
  rotulo?: string | null;
  /** Vai no fim do texto (checkout externo: "comissão €75.00"). */
  detalhe?: string | null;
}

export function hostDaUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** So https, sem usuario/senha embutidos. A rede (privada ou nao) o safeFetch confere. */
export function urlDeWebhookValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && url.length <= 2000;
  } catch {
    return false;
  }
}

export function formatarValor(valor: number, moeda: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: moeda }).format(valor);
  } catch {
    return `${valor.toFixed(2)} ${moeda}`;
  }
}

/** Titulo e texto da notificacao. Puro, para os testes. */
export function mensagemDaVenda(v: Venda): { titulo: string; texto: string } {
  const aprovada = (v.statusFinanceiro || "").toLowerCase() === "paid";
  const rotulo = v.rotulo || (aprovada ? "Venda aprovada" : "Nova venda");
  const titulo = `${rotulo} · ${formatarValor(v.valor, v.moeda)}`;
  const itens = v.produtos.filter(Boolean);
  const produtos = itens.length > 2 ? `${itens.slice(0, 2).join(", ")} +${itens.length - 2}` : itens.join(", ");
  const texto = [v.loja, v.pedido, produtos, v.detalhe].filter(Boolean).join(" · ");
  return { titulo, texto };
}

/** O pedido do webhook orders/create, no formato da notificacao. */
export function vendaDoPedido(
  pedido: {
    name?: string | null;
    order_number?: number | string | null;
    total_price?: string | number | null;
    currency?: string | null;
    financial_status?: string | null;
    line_items?: { title?: string | null; quantity?: number | null }[] | null;
  },
  loja: string
): Venda {
  return {
    loja,
    pedido: String(pedido.name || (pedido.order_number != null ? `#${pedido.order_number}` : "")),
    valor: Number(pedido.total_price ?? 0) || 0,
    moeda: String(pedido.currency || "USD").toUpperCase(),
    statusFinanceiro: pedido.financial_status ?? null,
    produtos: (pedido.line_items || []).map((l) =>
      (l.quantity ?? 1) > 1 ? `${l.quantity}x ${l.title || ""}`.trim() : String(l.title || "")
    ),
  };
}

/** O pedido HTTP para cada servico. Puro, para os testes. */
export function montarEnvio(
  url: string,
  v: Venda
): { headers: Record<string, string>; body: string } {
  const host = hostDaUrl(url) || "";
  const { titulo, texto } = mensagemDaVenda(v);
  if (host === "api.pushcut.io") {
    return { headers: { "content-type": "application/json" }, body: JSON.stringify({ title: titulo, text: texto }) };
  }
  if (host.includes("ntfy")) {
    // Header HTTP so leva ASCII: o titulo vai sem o "·".
    return {
      headers: { "content-type": "text/plain; charset=utf-8", Title: titulo.replace(/[^\x20-\x7e]/g, "-"), Tags: "moneybag" },
      body: texto || titulo,
    };
  }
  if ((host === "discord.com" || host === "discordapp.com") && new URL(url).pathname.startsWith("/api/webhooks/")) {
    return { headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `**${titulo}**\n${texto}` }) };
  }
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: titulo,
      text: texto,
      store: v.loja,
      order: v.pedido,
      value: v.valor,
      currency: v.moeda,
      financial_status: v.statusFinanceiro ?? null,
      products: v.produtos,
    }),
  };
}

export async function enviarNotificacaoDeVenda(url: string, v: Venda): Promise<{ ok: boolean; erro?: string }> {
  const host = hostDaUrl(url) || "?";
  try {
    const { headers, body } = montarEnvio(url, v);
    const r = await safeFetch(url, { method: "POST", headers, body, timeoutMs: TIMEOUT_MS });
    if (r.ok) return { ok: true };
    return { ok: false, erro: `${host} respondeu ${r.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha de rede";
    // A mensagem de erro de rede pode repetir a URL inteira (o segredo).
    return { ok: false, erro: `nao foi possivel falar com ${host}: ${msg.split(url).join("***")}` };
  }
}

/** URL do dono, se a notificacao estiver ligada. Service role: a tabela nao tem policy. */
export async function webhookDeVendaDoDono(admin: Admin, userId: string): Promise<string | null> {
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin.from("alerta_config").select("notificar_vendas").eq("user_id", userId).maybeSingle(),
    admin.from("alerta_config_secrets").select("venda_webhook_url").eq("user_id", userId).maybeSingle(),
  ]);
  if ((cfg as { notificar_vendas?: boolean } | null)?.notificar_vendas === false) return null;
  const url = String((seg as { venda_webhook_url?: string | null } | null)?.venda_webhook_url || "").trim();
  return url && urlDeWebhookValida(url) ? url : null;
}
