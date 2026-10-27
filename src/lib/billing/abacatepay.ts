import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { RETENTATIVA } from "@/lib/billing/abacatepay-regras";

// ============================================================================
// Cliente da AbacatePay (API v2, https://docs.abacatepay.com).
//
// O que molda este arquivo (estudo em docs/migracao-abacatepay/estudo.md):
//  - toda resposta e `{ data, success, error }`: vale o `success`, nao so o
//    HTTP;
//  - o ambiente vem da CHAVE (abc_dev_ simula, abc_prod_ cobra), a URL e uma;
//  - nao ha Idempotency-Key: quem chama evita repetir (o checkout PENDING e
//    reaproveitado pelo externalId, o Pix e um por clique);
//  - a assinatura nasce num checkout hospedado (a pagina deles), so existe
//    depois do pagamento e cancela na hora;
//  - o webhook prova a origem pelo `?webhookSecret=` da URL; o HMAC do corpo
//    usa uma chave PUBLICA (esta na doc) e so garante a integridade.
// ============================================================================

const BASE = "https://api.abacatepay.com/v2";
const PRAZO_MS = 20_000;

export class AbacatePayError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AbacatePayError";
    this.status = status;
  }
}

export const ABACATE_RECUSOU = "O sistema de pagamento recusou a operação. Tente de novo em instantes.";

/**
 * O que vai ao navegador quando a AbacatePay falha. 401/403 dela sao a NOSSA
 * chave (errada, revogada, sem a permissao da rota), nunca a sessao do
 * lojista -- e o cliente le 401 do nosso servidor como "Sua sessao expirou".
 */
export function respostaDoErroAbacate(error: AbacatePayError): { status: number; error: string } {
  if (error.status === 401 || error.status === 403) return { status: 502, error: ABACATE_RECUSOU };
  const status = error.status >= 400 && error.status < 500 ? error.status : 502;
  return { status, error: error.message };
}

function chave(): string {
  const k = process.env.ABACATEPAY_API_KEY?.trim();
  if (!k) throw new Error("ABACATEPAY_API_KEY nao configurada.");
  return k;
}

async function api<T>(
  caminho: string,
  init: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${BASE}${caminho}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${chave()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(PRAZO_MS),
  });
  const texto = await res.text();
  let json: { data?: T; success?: boolean; error?: unknown } | null = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta nao-JSON cai no erro abaixo */
  }
  if (!res.ok || !json || json.success === false) {
    const msg = typeof json?.error === "string" && json.error ? json.error : `AbacatePay respondeu ${res.status}`;
    // 200 com success:false e recusa da regra (400), nao pane.
    throw new AbacatePayError(msg, res.ok ? 400 : res.status);
  }
  return json.data as T;
}

/** Valores de metadata precisam ser texto na AbacatePay. */
function metadataEmTexto(m: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!m) return undefined;
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== null) saida[k] = String(v);
  return saida;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export interface DadosDoCliente {
  email: string;
  nome?: string | null;
  telefone?: string | null;
  /** CPF/CNPJ so digitos. A AbacatePay e unica por documento. */
  documento?: string | null;
}

/**
 * O cliente da conta na AbacatePay, criado uma vez e guardado no perfil. Com
 * CPF/CNPJ, criar de novo devolve o mesmo cadastro (unico por documento).
 */
export async function garantirCliente(userId: string, dados: DadosDoCliente): Promise<string> {
  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("profiles")
    .select("abacatepay_customer_id")
    .eq("id", userId)
    .maybeSingle();
  const guardado = (perfil as { abacatepay_customer_id?: string | null } | null)?.abacatepay_customer_id;
  if (guardado) return guardado;

  const id = await criarCliente(userId, dados);
  await admin.from("profiles").update({ abacatepay_customer_id: id }).eq("id", userId);
  return id;
}

/** So o cadastro na AbacatePay, sem gravar no perfil (o teste de sandbox usa). */
export async function criarCliente(userId: string, dados: DadosDoCliente): Promise<string> {
  const criado = await api<{ id: string }>("/customers/create", {
    method: "POST",
    body: {
      email: dados.email,
      ...(dados.nome ? { name: dados.nome } : {}),
      ...(dados.telefone ? { cellphone: dados.telefone } : {}),
      ...(dados.documento ? { taxId: dados.documento } : {}),
      metadata: { user_id: userId },
    },
  });
  return criado.id;
}

// ---------------------------------------------------------------------------
// Produtos (um por plano a venda, cycle MONTHLY, externalId = id do plano)
// ---------------------------------------------------------------------------

export interface ProdutoAbacate {
  id: string;
  externalId: string;
  name?: string;
  price: number;
  cycle?: string | null;
  status?: string;
}

const produtos = new Map<string, { produto: ProdutoAbacate; em: number }>();
const PRODUTO_VALE_MS = 10 * 60 * 1000;

/** Esquece os produtos guardados (o script dos produtos e os testes). */
export function limparCacheDeProdutos() {
  produtos.clear();
}

/** O produto do plano, pelo externalId. Em memoria por 10 min. */
export async function produtoDoPlano(planoId: string): Promise<ProdutoAbacate | null> {
  const cache = produtos.get(planoId);
  if (cache && Date.now() - cache.em < PRODUTO_VALE_MS) return cache.produto;
  try {
    const p = await api<ProdutoAbacate>("/products/get", { query: { externalId: planoId } });
    if (!p?.id) return null;
    produtos.set(planoId, { produto: p, em: Date.now() });
    return p;
  } catch (e) {
    // A API responde 400 "Product not found" (conferido em 27/10/2026), nao 404.
    if (e instanceof AbacatePayError && (e.status === 404 || /not found/i.test(e.message))) return null;
    throw e;
  }
}

export async function criarProduto(p: {
  externalId: string;
  nome: string;
  precoCentavos: number;
  ciclo: "MONTHLY";
  descricao?: string;
}): Promise<ProdutoAbacate> {
  return api<ProdutoAbacate>("/products/create", {
    method: "POST",
    body: {
      externalId: p.externalId,
      name: p.nome,
      price: p.precoCentavos,
      currency: "BRL",
      cycle: p.ciclo,
      ...(p.descricao ? { description: p.descricao } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

export interface CheckoutDeAssinatura {
  id: string;
  externalId?: string | null;
  url: string;
  amount?: number;
  status: string;
  createdAt?: string;
}

export interface AssinaturaAbacate {
  id: string;
  checkoutId?: string | null;
  customerId?: string | null;
  amount?: number | null;
  /** ACTIVE | CANCELLED */
  status: string;
  /** CARD | PIX */
  method?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** O checkout de assinatura pelo externalId (o PENDING da mesma hora). */
export async function checkoutDeAssinatura(externalId: string): Promise<CheckoutDeAssinatura | null> {
  try {
    return await api<CheckoutDeAssinatura>("/subscriptions/checkouts/get", { query: { externalId } });
  } catch (e) {
    if (e instanceof AbacatePayError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export async function criarCheckoutDeAssinatura(p: {
  produtoId: string;
  clienteId: string;
  externalId: string;
  completionUrl: string;
  returnUrl: string;
  metodos: ("CARD" | "PIX")[];
  metadata: Record<string, unknown>;
}): Promise<CheckoutDeAssinatura> {
  return api<CheckoutDeAssinatura>("/subscriptions/create", {
    method: "POST",
    body: {
      items: [{ id: p.produtoId, quantity: 1 }],
      customerId: p.clienteId,
      externalId: p.externalId,
      completionUrl: p.completionUrl,
      returnUrl: p.returnUrl,
      methods: p.metodos,
      metadata: metadataEmTexto(p.metadata),
      retryPolicy: RETENTATIVA,
    },
  });
}

export async function buscarAssinatura(id: string): Promise<AssinaturaAbacate> {
  return api<AssinaturaAbacate>("/subscriptions/get", { query: { id } });
}

/** Na AbacatePay o cancelamento e imediato e irreversivel. */
export async function cancelarAssinatura(id: string): Promise<AssinaturaAbacate> {
  return api<AssinaturaAbacate>("/subscriptions/cancel", { method: "POST", body: { id } });
}

// ---------------------------------------------------------------------------
// Pix avulso (checkout transparente)
// ---------------------------------------------------------------------------

export interface PixAbacate {
  id: string;
  amount: number;
  status: string;
  brCode?: string | null;
  brCodeBase64?: string | null;
  expiresAt?: string | null;
  platformFee?: number | null;
}

export async function criarPix(p: {
  valorCentavos: number;
  descricao: string;
  expiraEmSegundos: number;
  cliente?: { nome: string; email: string; documento: string; telefone?: string | null } | null;
  metadata: Record<string, unknown>;
}): Promise<PixAbacate> {
  return api<PixAbacate>("/transparents/create", {
    method: "POST",
    body: {
      method: "PIX",
      data: {
        amount: p.valorCentavos,
        description: p.descricao.slice(0, 140),
        expiresIn: p.expiraEmSegundos,
        ...(p.cliente
          ? {
              customer: {
                name: p.cliente.nome,
                email: p.cliente.email,
                taxId: p.cliente.documento,
                ...(p.cliente.telefone ? { cellphone: p.cliente.telefone } : {}),
              },
            }
          : {}),
        metadata: metadataEmTexto(p.metadata),
      },
    },
  });
}

/** Status do Pix: PENDING, PAID, EXPIRED ou CANCELLED. */
export async function conferirPix(id: string): Promise<{ status: string }> {
  return api<{ status: string }>("/transparents/check", { query: { id } });
}

/** Paga o Pix de mentira. So com a chave de Dev mode (em producao a API recusa). */
export async function simularPagamentoPix(id: string): Promise<{ status: string }> {
  return api<{ status: string }>("/transparents/simulate-payment", { method: "POST", query: { id }, body: {} });
}

// ---- webhooks (scripts/abacatepay-webhook.ts) -------------------------------

export interface WebhookAbacate {
  id: string;
  name: string;
  endpoint: string;
  events: string[];
  devMode: boolean;
}

export async function listarWebhooks(): Promise<WebhookAbacate[]> {
  const data = await api<WebhookAbacate[] | { webhooks?: WebhookAbacate[] }>("/webhooks/list");
  return Array.isArray(data) ? data : data?.webhooks || [];
}

export async function criarWebhook(w: {
  nome: string;
  endpoint: string;
  segredo: string;
  eventos: string[];
}): Promise<WebhookAbacate> {
  return api<WebhookAbacate>("/webhooks/create", {
    method: "POST",
    body: { name: w.nome, endpoint: w.endpoint, secret: w.segredo, events: w.eventos },
  });
}

export async function apagarWebhook(id: string): Promise<void> {
  await api<unknown>("/webhooks/delete", { method: "POST", query: { id }, body: {} });
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * A chave PUBLICA com que a AbacatePay assina o corpo de todo webhook
 * (docs.abacatepay.com/pages/webhooks/security). E igual para todas as lojas:
 * prova so que o corpo nao foi alterado. Quem prova a ORIGEM e o secret.
 */
export const CHAVE_PUBLICA_WEBHOOK =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** O `?webhookSecret=` da entrega e o nosso, em tempo constante. */
export function segredoDoWebhookValido(recebido: string | null | undefined): boolean {
  const esperado = process.env.ABACATEPAY_WEBHOOK_SECRET?.trim();
  if (!esperado || !recebido) return false;
  return igual(recebido.trim(), esperado);
}

/** X-Webhook-Signature = base64(HMAC-SHA256(corpo cru, chave publica)). */
export function corpoDoWebhookIntegro(corpoCru: string, assinatura: string | null | undefined): boolean {
  if (!assinatura) return false;
  const esperada = createHmac("sha256", CHAVE_PUBLICA_WEBHOOK).update(Buffer.from(corpoCru, "utf8")).digest("base64");
  return igual(assinatura.trim(), esperada);
}
