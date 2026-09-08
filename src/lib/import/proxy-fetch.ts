import { safeFetch } from "@/lib/net/safe-url";

const IMPORT_PROXY_ENV_KEYS = [
  "IMPORT_FETCH_PROXY_URL",
  "GLOBAL_FETCH_PROXY_URL",
  "ALIEXPRESS_FETCH_PROXY_URL",
] as const;

export function applyProxyTemplate(template: string, url: string): string {
  if (template.includes("{{url}}")) {
    return template.replaceAll("{{url}}", encodeURIComponent(url));
  }
  if (template.includes("{url}")) {
    return template.replaceAll("{url}", encodeURIComponent(url));
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(url)}`;
}

export function getImportProxyTemplate() {
  for (const key of IMPORT_PROXY_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Busca uma URL de importacao, opcionalmente por proxy.
 *
 * A URL vem do usuario ("importe de qualquer site"), entao passa pela trava de
 * SSRF antes de qualquer conexao: assertUrlPublica resolve o DNS e recusa
 * destino em rede privada, link-local ou loopback. Sem isso o endpoint de
 * importacao e um proxy aberto de dentro da infra -- metadata.google.internal
 * e 169.254.169.254.nip.io passavam.
 *
 * O caminho do PROXY nao passa pela trava de proposito: ali a URL de destino
 * vai como parametro para um servico externo configurado por nos, e quem
 * conecta e ele, nao este servidor.
 */
export async function fetchWithImportProxy(
  url: string,
  init?: RequestInit,
  options?: { proxyFirst?: boolean }
) {
  const proxyTemplate = getImportProxyTemplate();
  const proxyUrl = proxyTemplate ? applyProxyTemplate(proxyTemplate, url) : "";
  const proxyFirst = options?.proxyFirst !== false;

  if (proxyUrl && proxyFirst) {
    try {
      const response = await fetch(proxyUrl, init);
      if (response.ok) return response;
    } catch {
      // Fallback direto abaixo. Alguns dominios bloqueiam proxy ou vice-versa.
    }
  }

  const directResponse = await safeFetch(url, init);
  if (directResponse.ok || !proxyUrl || proxyFirst) return directResponse;

  try {
    return await fetch(proxyUrl, init);
  } catch {
    return directResponse;
  }
}
