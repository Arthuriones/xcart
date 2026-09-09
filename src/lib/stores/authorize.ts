import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShopifyCredentials } from "@/lib/shopify/client";

/**
 * A resolucao de loja do xcart, num lugar so.
 *
 * ============================== O INVARIANTE ==============================
 *
 * Nenhuma operacao pode ir de um id vindo do cliente direto para a credencial:
 *
 *   ERRADO:  storeId do body  ->  busca o token  ->  chama a Shopify
 *   CERTO:   usuario da sessao -> loja QUE ELE POSSUI -> token dessa loja
 *
 * Quem quebra isso entrega o client_secret e o access token da loja de outra
 * pessoa a quem souber (ou adivinhar) um UUID.
 *
 * ============================ POR QUE CENTRALIZAR ===========================
 *
 * Existiam quatro copias quase iguais de `getStoreCredentials(storeId, userId)`
 * -- em clone, create-destination, connect-by-sku e neutralize-store-images --
 * mais uma em mcp/auth.ts. Todas acertavam o filtro hoje. O problema e que
 * cada copia e uma chance de a proxima nascer sem ele, e nada no tipo obrigava
 * a passar o userId: era so um segundo argumento string, facil de esquecer ou
 * de trocar de ordem com o primeiro.
 *
 * Aqui o userId nao e argumento -- ele sai da sessao, dentro da funcao. Nao ha
 * como chamar errado.
 */

export interface LojaAutorizada {
  id: string;
  user_id: string;
  name: string | null;
  shop_domain: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  target_language: string | null;
  niche: string | null;
  // Campos de StoreContext: toda chamada de IA recebe isso (ver CLAUDE.md).
  // Ficam aqui porque quem pede credencial quase sempre pede contexto junto,
  // e um select a menos e uma ida ao banco a menos no caminho quente.
  target_audience: string | null;
  brand_voice: string | null;
  store_description: string | null;
  logo_path: string | null;
}

// Literal unico de proposito: concatenado, o supabase-js perde a inferencia
// da forma da linha e o retorno vira GenericStringError.
const CAMPOS =
  "id, user_id, name, shop_domain, client_id, client_secret, access_token, target_language, niche, target_audience, brand_voice, store_description, logo_path";

export class NaoAutorizado extends Error {
  /** 401 = sem sessao; 404 = a loja nao e sua (ou nao existe). */
  status: 401 | 404;
  constructor(message: string, status: 401 | 404) {
    super(message);
    this.name = "NaoAutorizado";
    this.status = status;
  }
}

/** O usuario da sessao, ou null. */
export async function usuarioDaSessao(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

/**
 * Devolve a loja SE ela pertencer a quem esta na sessao.
 *
 * Usa o cliente do usuario (RLS ligada) e ainda assim filtra por user_id: a
 * RLS e a rede de baixo, o filtro explicito e o que documenta a intencao e o
 * que continua valendo se alguem trocar por um cliente admin.
 */
export async function lojaDoUsuario(storeId: string): Promise<LojaAutorizada | null> {
  if (!storeId) return null;
  const usuario = await usuarioDaSessao();
  if (!usuario) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select(CAMPOS)
    .eq("id", storeId)
    .eq("user_id", usuario.id)
    .maybeSingle();

  return (data as LojaAutorizada) || null;
}

/** Igual a lojaDoUsuario, mas lanca em vez de devolver null. */
export async function exigirLojaDoUsuario(storeId: string): Promise<LojaAutorizada> {
  const usuario = await usuarioDaSessao();
  if (!usuario) throw new NaoAutorizado("Unauthorized", 401);
  const loja = await lojaDoUsuario(storeId);
  // 404 e nao 403 de proposito: responder 403 confirma que o id existe, o que
  // transforma o endpoint num verificador de ids de loja alheia.
  if (!loja) throw new NaoAutorizado("Loja nao encontrada.", 404);
  return loja;
}

/**
 * Varias lojas de uma vez, todas do dono da sessao.
 *
 * Devolve null se QUALQUER uma faltar -- meio-caminho aqui e pior que erro:
 * uma rota criada com a vitrine certa e o destino de outra pessoa e
 * exatamente o cenario que o invariante existe para impedir.
 */
export async function lojasDoUsuario(
  storeIds: string[]
): Promise<LojaAutorizada[] | null> {
  const unicos = [...new Set(storeIds.filter(Boolean))];
  if (unicos.length === 0) return null;

  const usuario = await usuarioDaSessao();
  if (!usuario) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select(CAMPOS)
    .eq("user_id", usuario.id)
    .in("id", unicos);

  const achadas = (data || []) as LojaAutorizada[];
  return achadas.length === unicos.length ? achadas : null;
}

/**
 * So a pergunta "essas lojas sao todas dele?".
 *
 * Deduplica antes de contar: `["x","x"]` tem tamanho 2 e traz 1 linha, e a
 * comparacao ingenua `count === ids.length` reprovava o dono da propria loja.
 */
export async function usuarioPossuiLojas(
  storeIds: string[],
  userId: string
): Promise<boolean> {
  const unicos = [...new Set(storeIds.filter(Boolean))];
  if (unicos.length === 0) return false;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("stores")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("id", unicos);

  return !error && count === unicos.length;
}

/** Credenciais da Shopify a partir de uma loja ja autorizada. */
export function credenciaisDe(loja: LojaAutorizada): ShopifyCredentials {
  return {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };
}

/**
 * Versao para contexto SEM sessao: cron e fila de jobs.
 *
 * O userId aqui vem do dono do JOB (gravado quando o usuario o criou), nunca
 * de um parametro de request. Fica com nome feio de proposito -- `admin` no
 * nome para ninguem chamar por engano de dentro de uma rota de API.
 */
export async function lojaDoDonoViaAdmin(
  storeId: string,
  userId: string
): Promise<LojaAutorizada | null> {
  if (!storeId || !userId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("stores")
    .select(CAMPOS)
    .eq("id", storeId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as LojaAutorizada) || null;
}
