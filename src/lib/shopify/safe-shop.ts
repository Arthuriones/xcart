import { assertUrlPublica, UnsafeUrlError } from "@/lib/net/safe-url";
import { normalizeShopDomain } from "@/lib/shopify/domain";

/**
 * Trava de destino para TODA chamada a Admin API de uma loja.
 *
 * ============================ POR QUE ISTO EXISTE ============================
 *
 * `normalizeShopDomain` valida FORMATO, nao destino. Ela aceita qualquer
 * dominio com TLD -- comprovadamente:
 *
 *   metadata.google.internal      -> servico de metadados da nuvem
 *   admin.svc.cluster.local       -> servico interno
 *   169.254.169.254.nip.io        -> nip.io resolve para o link-local
 *   10.0.0.1.sslip.io             -> mesma ideia, rede privada
 *
 * E `stores.shop_domain` e digitado pelo usuario em /api/shopify/connect. Ou
 * seja: o usuario escolhia para qual host o SERVIDOR ia mandar a requisicao.
 *
 * O que ia junto nessa requisicao:
 *   - POST /admin/oauth/access_token  ->  client_id + client_secret no corpo
 *   - GET/POST /admin/api/...         ->  X-Shopify-Access-Token no header
 *
 * E o que voltava: em falha, o cliente devolvia o corpo da resposta ao usuario
 * dentro da mensagem de erro (`Falha ao autenticar na Shopify (500): <corpo>`),
 * que /api/shopify/connect repassa no JSON. Isso fecha o circuito de um SSRF
 * com exfiltracao -- 220 caracteres de qualquer endpoint HTTP interno,
 * legiveis na tela.
 *
 * A checagem aqui resolve o DNS e recusa loopback, link-local, rede privada e
 * CGNAT, igual ao resto do app (src/lib/net/safe-url.ts). Nome nao decide para
 * onde a conexao vai; o IP resolvido decide.
 */

export class ShopDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopDomainError";
  }
}

/**
 * Aprova o dominio de uma loja como destino de chamada de servidor.
 *
 * Devolve o hostname normalizado. Lanca ShopDomainError com mensagem que NAO
 * conta nada sobre a topologia interna -- dizer "esse host resolve para
 * 10.0.0.5" ja seria meio scanner.
 */
export async function assertShopDomainPublico(entrada: string): Promise<string> {
  const host = normalizeShopDomain(entrada);
  if (!host) {
    throw new ShopDomainError(
      "Use o dominio da loja no formato sualoja.myshopify.com."
    );
  }

  // Atalho para o caso comum: myshopify.com e da Shopify, sempre publico, e
  // pular o DNS aqui evita um lookup por chamada no caminho quente.
  if (host.endsWith(".myshopify.com")) return host;

  try {
    await assertUrlPublica(`https://${host}/`);
  } catch (e) {
    if (e instanceof UnsafeUrlError) {
      throw new ShopDomainError(
        "Esse dominio nao aponta para um endereco publico. Use o dominio .myshopify.com da loja."
      );
    }
    throw e;
  }

  return host;
}

/** true/false, para filtrar sem try/catch. */
export async function shopDomainEhPublico(entrada: string): Promise<boolean> {
  try {
    await assertShopDomainPublico(entrada);
    return true;
  } catch {
    return false;
  }
}
