import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * O `state` do OAuth da Shopify.
 *
 * ============================ O QUE ERA ANTES ============================
 *
 * `state` era o proprio `store.id`. Um UUID de linha do banco nao serve como
 * state porque nao tem nenhuma das tres propriedades que o parametro existe
 * para dar:
 *
 *   nao e imprevisivel  -- vaza em URL, log, print, suporte;
 *   nao e de uso unico  -- o mesmo valor vale para sempre;
 *   nao expira          -- um callback de meses atras ainda casa.
 *
 * O que segurava a barra era o `.eq("user_id", user.id)` na busca da loja e o
 * HMAC do callback. Isso ja impede o ataque mais obvio, mas deixa o `state`
 * sem funcao -- e a defesa inteira apoiada em duas checagens que ninguem
 * documentou como sendo a protecao de CSRF.
 *
 * ============================== O QUE E AGORA ==============================
 *
 * O `state` passa a ser um nonce aleatorio de 32 bytes. Ele e guardado num
 * cookie HttpOnly junto do id da loja, e o callback:
 *
 *   1. le o cookie (o navegador do usuario e a unica fonte);
 *   2. compara o `state` da query com o nonce do cookie, em tempo constante;
 *   3. usa o storeId DO COOKIE -- nunca o que veio na query;
 *   4. apaga o cookie, o que torna o callback de uso unico.
 *
 * Quem nao tem o cookie nao consegue adivinhar o nonce, entao nao consegue
 * fabricar um callback que o navegador da vitima aceite. E o Max-Age fecha a
 * janela de replay.
 *
 * O cookie nao precisa de assinatura: quem o emite e o servidor, ele e
 * HttpOnly e o valor so vale contra ele mesmo. Assinar protegeria contra um
 * atacante que ja consegue gravar cookie no dominio -- e nesse cenario a
 * sessao do Supabase ja caiu junto.
 */

export const COOKIE_STATE = "shopify_oauth_state";

/** Tempo de vida do state. Instalar leva menos de um minuto; 10 da folga. */
export const VALIDADE_SEGUNDOS = 10 * 60;

export interface EstadoOAuth {
  nonce: string;
  storeId: string;
}

export function novoNonce(): string {
  return randomBytes(32).toString("hex");
}

export function serializarEstado(estado: EstadoOAuth): string {
  return `${estado.nonce}.${estado.storeId}`;
}

export function lerEstado(valor: string | undefined): EstadoOAuth | null {
  if (!valor) return null;
  const corte = valor.indexOf(".");
  if (corte <= 0) return null;
  const nonce = valor.slice(0, corte);
  const storeId = valor.slice(corte + 1);
  if (!nonce || !storeId) return null;
  return { nonce, storeId };
}

/**
 * Compara o state da query com o nonce do cookie sem vazar tempo.
 *
 * Comparar com `===` daria para descobrir o nonce byte a byte medindo a
 * resposta. E barato fazer certo.
 */
export function nonceConfere(daQuery: string | null, doCookie: string): boolean {
  if (!daQuery || !doCookie) return false;
  const a = Buffer.from(daQuery, "utf8");
  const b = Buffer.from(doCookie, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Opcoes do cookie de state. Curto, HttpOnly, preso ao proprio fluxo. */
export function opcoesCookie(seguro: boolean) {
  return {
    httpOnly: true,
    secure: seguro,
    // Lax e o que funciona aqui: o callback chega como navegacao de topo
    // vinda do dominio da Shopify, e Strict nao mandaria o cookie nesse salto.
    sameSite: "lax" as const,
    path: "/api/shopify/auth",
    maxAge: VALIDADE_SEGUNDOS,
  };
}
