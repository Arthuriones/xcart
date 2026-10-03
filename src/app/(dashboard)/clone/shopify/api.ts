// ============================================================================
// As chamadas do assistente, todas para rotas que JA existem e com os mesmos
// corpos da tela antiga:
//   POST /api/shopify/clone            (ler catalogo, previa e importar)
//   GET  /api/shopify/collections      (colecoes da origem)
//   POST /api/shopify/clone/finalize   (uma linha de historico por importacao)
//   POST /api/checkout-routes          (rota com o mapa de SKU, opcional)
//
// Aqui so mora o transporte: falha de rede vira status 0, sessao vencida
// (o proxy redireciona para /login) vira 401, e o JSON que nao vem vira {}.
// A frase para o lojista sai de erroNaTela (regras.ts).
// ============================================================================

export interface Resposta<T> {
  ok: boolean;
  status: number;
  dados: T & { error?: string; code?: string };
}

export function abortado(erro: unknown): boolean {
  return erro instanceof DOMException && erro.name === "AbortError";
}

async function pedir<T>(url: string, init: RequestInit): Promise<Resposta<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (erro) {
    if (abortado(erro)) throw erro;
    return { ok: false, status: 0, dados: {} as Resposta<T>["dados"] };
  }
  const dados = (await res.json().catch(() => ({}))) as Resposta<T>["dados"];
  // redirected = sessao vencida: o proxy mandou para /login (HTML, 200).
  const status = res.redirected ? 401 : res.status;
  return { ok: res.ok && !res.redirected, status, dados };
}

export function postarClone<T>(corpo: Record<string, unknown>, signal?: AbortSignal) {
  return pedir<T>("/api/shopify/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal,
  });
}

export function lerColecoes<T>(origem: string, signal?: AbortSignal) {
  return pedir<T>(`/api/shopify/collections?source=${encodeURIComponent(origem.trim())}`, {
    method: "GET",
    signal,
  });
}

export function postarJson<T>(url: string, corpo: Record<string, unknown>, signal?: AbortSignal) {
  return pedir<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal,
  });
}
