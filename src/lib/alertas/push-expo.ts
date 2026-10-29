import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Push de venda no app do celular (Expo, iPhone e Android).
//
// O app registra o token de push do aparelho em app_aparelhos (migration 084,
// rota /api/app/v1/aparelhos). Cada venda que passa por
// notificarVendaNosCelulares (venda-webhook.ts) tambem vai ao Expo Push, em
// paralelo com os webhooks e com o mesmo liga/desliga (notificar_vendas).
//
// O texto e o mesmo do celular de hoje (mensagemDaVenda): loja, pedido,
// produtos e valor -- nada do comprador. O token do aparelho nao vai para log:
// com ele qualquer um manda push para o aparelho.
//
// Sem a 084 (tabela ausente) ou sem aparelho, nada sai e nada muda nos
// webhooks. Nunca lanca no envio: notificacao nunca derruba pedido.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const URL_EXPO = "https://exp.host/--/api/v2/push/send";
/** O mesmo prazo dos webhooks do celular. */
const TIMEOUT_MS = 4_000;
/** O Expo aceita no maximo 100 mensagens por pedido. */
const POR_LOTE = 100;
/** Teto de aparelhos lidos por venda: limita o trabalho de uma conta com lixo cadastrado. */
const MAX_APARELHOS = 500;
const MAX_ERRO = 300;

/** O mesmo formato do CHECK de app_aparelhos.expo_token (084). */
const FORMATO_TOKEN = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
const TOKEN_NO_TEXTO = /(Expo|Exponent)PushToken\[[^\]]*\]/g;

export const PLATAFORMAS = ["ios", "android"] as const;
export type Plataforma = (typeof PLATAFORMAS)[number];

export function tokenExpoValido(t: unknown): t is string {
  return typeof t === "string" && FORMATO_TOKEN.test(t);
}

export function plataformaValida(p: unknown): p is Plataforma {
  return typeof p === "string" && (PLATAFORMAS as readonly string[]).includes(p);
}

/** A tabela da 084 ainda nao existe no banco (42P01 no Postgres, PGRST205 no PostgREST). */
export function semTabelaDeAparelhos(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String(error.message || "");
  return /app_aparelhos/.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

export interface AparelhoDoApp {
  id: string;
  expo_token: string;
}

/**
 * O app registra o aparelho de novo (POST /api/app/v1/aparelhos) a cada vez
 * que abre logado, e o upsert renova `atualizado_em`. Aparelho que ficou mais
 * que isto sem abrir para de receber: o celular de quem perdeu a sessao
 * (senha trocada, sessao vencida, logout que falhou sem rede) nao segue
 * recebendo as vendas para sempre -- e o app desinstalado, que o ticket do
 * Expo nem sempre acusa, sai junto.
 */
export const PRAZO_DO_APARELHO_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Os aparelhos do dono que recebem a venda; vazio com a notificacao desligada
 * ou sem a tabela. O liga/desliga so e lido quando ha aparelho: sem o app,
 * nenhuma consulta a mais por venda alem desta. Erro de leitura LANCA.
 */
export async function aparelhosDoDono(admin: Admin, userId: string, agora = Date.now()): Promise<AparelhoDoApp[]> {
  const { data, error } = await admin
    .from("app_aparelhos")
    .select("id, expo_token")
    .eq("user_id", userId)
    .gte("atualizado_em", new Date(agora - PRAZO_DO_APARELHO_MS).toISOString())
    .order("atualizado_em", { ascending: false })
    .limit(MAX_APARELHOS);
  if (error) {
    if (semTabelaDeAparelhos(error)) return [];
    throw new Error(`app_aparelhos: ${error.message}`);
  }
  const lista = ((data || []) as AparelhoDoApp[]).filter((a) => tokenExpoValido(a.expo_token));
  if (!lista.length) return [];
  const cfg = await admin.from("alerta_config").select("notificar_vendas").eq("user_id", userId).maybeSingle();
  // Igual aos webhooks: so false desliga (sem linha, o aviso esta ligado).
  if ((cfg.data as { notificar_vendas?: boolean } | null)?.notificar_vendas === false) return [];
  return lista;
}

/** As mensagens de um lote. Puro, para os testes. */
export function mensagensDoPush(aparelhos: AparelhoDoApp[], m: { titulo: string; texto: string }) {
  return aparelhos.map((a) => ({
    to: a.expo_token,
    title: m.titulo,
    body: m.texto || m.titulo,
    sound: "default",
    priority: "high",
    // So o tipo: o app abre o Dashboard. Nada do pedido nem do comprador.
    data: { tipo: "venda" },
  }));
}

export type ResultadoDoPush = { ok: boolean; erro?: string; apagar?: boolean };

interface Ticket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

/** Texto do Expo sem o token do aparelho (a mensagem de erro dele repete o token). */
function semToken(texto: string): string {
  return texto.replace(TOKEN_NO_TEXTO, "***").slice(0, MAX_ERRO);
}

function motivoDaFalha(e: unknown): string {
  if (!(e instanceof Error)) return "falha de rede";
  if (e.name === "TimeoutError" || e.name === "AbortError") return `sem resposta em ${TIMEOUT_MS / 1000} s`;
  if (/^fetch failed$/i.test(e.message)) return "falha de rede";
  return e.message;
}

/** O resultado de cada aparelho a partir do ticket. Puro, para os testes. */
export function resultadoDoTicket(t: Ticket | null | undefined): ResultadoDoPush {
  if (t?.status === "ok") return { ok: true };
  const codigo = t?.details?.error;
  // Desinstalou o app ou tirou a permissao: o token morreu, sai da tabela.
  if (codigo === "DeviceNotRegistered") return { ok: false, erro: "Expo: DeviceNotRegistered", apagar: true };
  if (!t) return { ok: false, erro: "Expo não devolveu o ticket" };
  return { ok: false, erro: semToken(`Expo: ${codigo || t.message || "erro sem motivo"}`) };
}

/** Um lote de ate 100 no Expo; um resultado por aparelho, na ordem. Nunca lanca. */
async function enviarLote(aparelhos: AparelhoDoApp[], m: { titulo: string; texto: string }): Promise<ResultadoDoPush[]> {
  const todos = (erro: string): ResultadoDoPush[] => aparelhos.map(() => ({ ok: false, erro }));
  try {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    // So com o "Enhanced push security" ligado no projeto do Expo.
    const chave = String(process.env.EXPO_ACCESS_TOKEN || "").trim();
    if (chave) headers.authorization = `Bearer ${chave}`;
    const r = await safeFetch(URL_EXPO, {
      method: "POST",
      headers,
      body: JSON.stringify(mensagensDoPush(aparelhos, m)),
      timeoutMs: TIMEOUT_MS,
    });
    const corpo = (await r.json().catch(() => null)) as {
      data?: Ticket[];
      errors?: { code?: string; message?: string }[];
    } | null;
    if (!r.ok || !Array.isArray(corpo?.data)) {
      const codigo = corpo?.errors?.[0]?.code;
      return todos(`Expo respondeu ${r.status}${codigo ? ` (${String(codigo).slice(0, 60)})` : ""}`);
    }
    const tickets = corpo.data;
    return aparelhos.map((_, i) => resultadoDoTicket(tickets[i]));
  } catch (e) {
    return todos(semToken(`não deu para falar com o Expo: ${motivoDaFalha(e)}`));
  }
}

/** Grava o resultado: token morto sai, erro vai no ultimo_erro, sucesso no ultimo_envio_em. Nunca lanca. */
async function registrarPush(
  admin: Admin,
  userId: string,
  aparelhos: AparelhoDoApp[],
  resultados: ResultadoDoPush[],
  agora: Date
): Promise<void> {
  const apagar: string[] = [];
  const entregues: string[] = [];
  const porErro = new Map<string, string[]>();
  resultados.forEach((r, i) => {
    const id = aparelhos[i].id;
    if (r.apagar) apagar.push(id);
    else if (r.ok) entregues.push(id);
    else {
      const erro = r.erro || "falhou";
      porErro.set(erro, [...(porErro.get(erro) || []), id]);
    }
  });
  const escritas: PromiseLike<{ error: { message: string } | null }>[] = [];
  if (apagar.length) escritas.push(admin.from("app_aparelhos").delete().in("id", apagar).eq("user_id", userId));
  if (entregues.length) {
    escritas.push(
      admin
        .from("app_aparelhos")
        .update({ ultimo_envio_em: agora.toISOString(), ultimo_erro: null })
        .in("id", entregues)
        .eq("user_id", userId)
    );
  }
  for (const [erro, ids] of porErro) {
    escritas.push(
      admin.from("app_aparelhos").update({ ultimo_erro: erro.slice(0, MAX_ERRO) }).in("id", ids).eq("user_id", userId)
    );
  }
  const feitas = await Promise.allSettled(escritas);
  for (const f of feitas) {
    const msg = f.status === "rejected" ? (f.reason instanceof Error ? f.reason.message : String(f.reason)) : f.value.error?.message;
    if (msg) console.warn("[push-expo] nao gravou o resultado do push", msg);
  }
}

/**
 * A venda para os aparelhos do app, em lotes de 100 em paralelo. Um resultado
 * por aparelho, na ordem. Nunca lanca.
 */
export async function enviarPushDeVenda(
  admin: Admin,
  userId: string,
  aparelhos: AparelhoDoApp[],
  m: { titulo: string; texto: string },
  agora: Date = new Date()
): Promise<ResultadoDoPush[]> {
  const lotes: AparelhoDoApp[][] = [];
  for (let i = 0; i < aparelhos.length; i += POR_LOTE) lotes.push(aparelhos.slice(i, i + POR_LOTE));
  const resultados = (await Promise.all(lotes.map((l) => enviarLote(l, m)))).flat();
  await registrarPush(admin, userId, aparelhos, resultados, agora);
  return resultados;
}
