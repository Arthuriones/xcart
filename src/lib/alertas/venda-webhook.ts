import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ID_LEGADO, MAX_CELULARES, NOME_PADRAO, type CelularDaTela } from "./venda-celulares";

// ============================================================================
// Notificacao de venda no celular: o xcart chama as URLs que o lojista colou
// (Pushcut, ntfy, Discord ou qualquer webhook) a cada venda -- uma por
// celular (venda_webhooks, migration 070; antes dela, a URL unica da 063 em
// alerta_config_secrets.venda_webhook_url). Todas em paralelo: um celular
// fora do ar nao segura nem derruba os outros.
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

/** Mesmo teto do CHECK de venda_webhooks.ultimo_erro (070). */
const MAX_ERRO = 300;

export type ResultadoEnvio = { ok: boolean; erro?: string };

/** O texto do erro sem a URL: ele vai para o log, para o banco e para a tela. */
function semSegredo(texto: string, url: string): string {
  return texto.split(url).join("***").replace(/https?:\/\/\S+/gi, "***");
}

function motivoDaFalha(e: unknown): string {
  if (!(e instanceof Error)) return "falha de rede";
  if (e.name === "TimeoutError" || e.name === "AbortError") return `sem resposta em ${TIMEOUT_MS / 1000} s`;
  if (/^fetch failed$/i.test(e.message)) return "falha de rede";
  return e.message;
}

export async function enviarNotificacaoDeVenda(url: string, v: Venda): Promise<ResultadoEnvio> {
  const host = hostDaUrl(url) || "?";
  try {
    const { headers, body } = montarEnvio(url, v);
    const r = await safeFetch(url, { method: "POST", headers, body, timeoutMs: TIMEOUT_MS });
    // O corpo da resposta nao interessa: solta a conexao.
    void r.body?.cancel().catch(() => {});
    if (r.ok) return { ok: true };
    return { ok: false, erro: `${host} respondeu ${r.status}` };
  } catch (e) {
    // A mensagem de erro de rede pode repetir a URL inteira (o segredo).
    return { ok: false, erro: `não deu para falar com ${host}: ${semSegredo(motivoDaFalha(e), url)}`.slice(0, MAX_ERRO) };
  }
}

/** A venda de exemplo do botao Testar. */
export const VENDA_DE_TESTE: Venda = {
  loja: "Teste xcart",
  pedido: "#1001",
  valor: 69,
  moeda: "USD",
  statusFinanceiro: "paid",
  produtos: ["Produto de exemplo"],
};

// ---------------------------------------------------------------------------
// Os celulares do dono
// ---------------------------------------------------------------------------

/** Um celular para o envio: a linha de venda_webhooks, ou ID_LEGADO = a URL da 063. */
export interface DestinoDeVenda {
  id: string;
  url: string;
}

/** A tabela da 070 ainda nao existe no banco (42P01 no Postgres, PGRST205 no PostgREST). */
export function semTabelaDeCelulares(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message || "");
  return /venda_webhooks/.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

/** A URL unica da 063 (o caminho de antes da 070). */
async function urlDaColunaAntiga(admin: Admin, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("alerta_config_secrets")
    .select("venda_webhook_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`alerta_config_secrets: ${error.message}`);
  const url = String((data as { venda_webhook_url?: string | null } | null)?.venda_webhook_url || "").trim();
  return url && urlDeWebhookValida(url) ? url : null;
}

/**
 * Os celulares que recebem a venda; vazio com a notificacao desligada.
 * Service role: venda_webhooks nao tem policy. Sem a tabela (antes da 070),
 * a URL unica da 063. Erro de leitura LANCA -- quem chama loga e segue.
 */
export async function webhooksDeVendaDoDono(admin: Admin, userId: string): Promise<DestinoDeVenda[]> {
  const [cfg, lista] = await Promise.all([
    admin.from("alerta_config").select("notificar_vendas").eq("user_id", userId).maybeSingle(),
    admin
      .from("venda_webhooks")
      .select("id, url")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(MAX_CELULARES),
  ]);
  if ((cfg.data as { notificar_vendas?: boolean } | null)?.notificar_vendas === false) return [];
  if (lista.error) {
    if (!semTabelaDeCelulares(lista.error)) throw new Error(`venda_webhooks: ${lista.error.message}`);
    const url = await urlDaColunaAntiga(admin, userId);
    return url ? [{ id: ID_LEGADO, url }] : [];
  }
  const vistas = new Set<string>();
  const destinos: DestinoDeVenda[] = [];
  for (const l of (lista.data || []) as { id: string; url: string | null }[]) {
    const url = String(l.url || "").trim();
    if (!url || vistas.has(url) || !urlDeWebhookValida(url)) continue;
    vistas.add(url);
    destinos.push({ id: l.id, url });
  }
  return destinos;
}

/** Um celular do dono, para o Testar e o Remover. null = nao existe ou e de outro usuario. */
export async function celularDoDono(admin: Admin, userId: string, id: string): Promise<DestinoDeVenda | null> {
  if (id === ID_LEGADO) {
    const url = await urlDaColunaAntiga(admin, userId);
    return url ? { id: ID_LEGADO, url } : null;
  }
  const { data, error } = await admin
    .from("venda_webhooks")
    .select("id, url")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`venda_webhooks: ${error.message}`);
  const l = data as { id: string; url: string | null } | null;
  const url = String(l?.url || "").trim();
  return l && url ? { id: l.id, url } : null;
}

interface LinhaCelular {
  id: string;
  nome: string | null;
  url: string | null;
  ultimo_envio_em: string | null;
  ultimo_erro: string | null;
}

/** A linha no formato da tela: a URL vira so o host. */
export function celularParaTela(l: LinhaCelular): CelularDaTela {
  return {
    id: l.id,
    nome: l.nome || NOME_PADRAO,
    host: hostDaUrl(String(l.url || "")) || "?",
    ultimo_envio_em: l.ultimo_envio_em ?? null,
    ultimo_erro: l.ultimo_erro ?? null,
  };
}

/** Os celulares para a tela, na ordem do cadastro. Sem a tabela, a URL unica da 063. */
export async function lerCelularesDaTela(
  admin: Admin,
  userId: string
): Promise<{ celulares: CelularDaTela[]; semTabela: boolean }> {
  const { data, error } = await admin
    .from("venda_webhooks")
    .select("id, nome, url, ultimo_envio_em, ultimo_erro")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(MAX_CELULARES);
  if (error) {
    if (!semTabelaDeCelulares(error)) throw new Error(`venda_webhooks: ${error.message}`);
    const url = await urlDaColunaAntiga(admin, userId);
    const celulares = url
      ? [celularParaTela({ id: ID_LEGADO, nome: NOME_PADRAO, url, ultimo_envio_em: null, ultimo_erro: null })]
      : [];
    return { celulares, semTabela: true };
  }
  return { celulares: ((data || []) as LinhaCelular[]).map(celularParaTela), semTabela: false };
}

// ---------------------------------------------------------------------------
// O envio
// ---------------------------------------------------------------------------

/** Grava como foi o envio no celular. Nunca lanca: erro ao gravar so vai para o log. */
export async function registrarEnvio(
  admin: Admin,
  userId: string,
  destino: DestinoDeVenda,
  r: ResultadoEnvio,
  agora: Date = new Date()
): Promise<void> {
  // A coluna da 063 nao tem onde guardar.
  if (destino.id === ID_LEGADO) return;
  try {
    const { error } = await admin
      .from("venda_webhooks")
      .update({
        ultimo_envio_em: agora.toISOString(),
        ultimo_erro: r.ok ? null : String(r.erro || "falhou").slice(0, MAX_ERRO),
      })
      .eq("id", destino.id)
      .eq("user_id", userId);
    if (error) console.warn("[venda-webhook] nao gravou o ultimo envio", error.message);
  } catch (e) {
    console.warn("[venda-webhook] nao gravou o ultimo envio", e instanceof Error ? e.message : e);
  }
}

/** A venda para um celular, gravando como foi. Nunca lanca. */
export async function enviarParaUmCelular(
  admin: Admin,
  userId: string,
  destino: DestinoDeVenda,
  v: Venda
): Promise<ResultadoEnvio> {
  const r = await enviarNotificacaoDeVenda(destino.url, v);
  await registrarEnvio(admin, userId, destino, r);
  return r;
}

/**
 * A venda para TODOS os celulares do dono, em paralelo: um fora do ar nao
 * segura nem derruba os outros (allSettled, e cada envio tem timeout de 4 s).
 * Falha vai para o log so com o host. Nunca lanca: quem chama e o webhook do
 * pedido, e notificacao nunca derruba pedido. `origem` e so o prefixo do log.
 */
export async function notificarVendaNosCelulares(
  admin: Admin,
  userId: string,
  v: Venda,
  origem: string
): Promise<{ enviados: number; falhas: number }> {
  let destinos: DestinoDeVenda[];
  try {
    destinos = await webhooksDeVendaDoDono(admin, userId);
  } catch (e) {
    console.error(`[${origem}] notificacao de venda: leitura dos celulares`, e instanceof Error ? e.message : e);
    return { enviados: 0, falhas: 0 };
  }
  const resultados = await Promise.allSettled(destinos.map((d) => enviarParaUmCelular(admin, userId, d, v)));
  let enviados = 0;
  let falhas = 0;
  for (const r of resultados) {
    if (r.status === "fulfilled" && r.value.ok) {
      enviados += 1;
      continue;
    }
    falhas += 1;
    // O erro ja vem so com o host; o motivo de uma rejeicao nao vai, pode ter a URL.
    console.warn(
      `[${origem}] notificacao de venda falhou`,
      r.status === "fulfilled" ? r.value.erro : "erro inesperado no envio"
    );
  }
  return { enviados, falhas };
}
