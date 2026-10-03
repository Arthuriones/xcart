// ============================================================================
// fetch para as APIs que ja existem (src/app/api/ads/*, /api/alertas/canal,
// /api/mcp-tokens). Nada muda nelas: aqui so se chama e se traduz a falha.
// Erro de rede ou HTTP vira { ok: false, erro } com texto humano.
// ============================================================================

type Corpo = { ok?: boolean; erro?: string; error?: string } & Record<string, unknown>;

export type Resultado<T> = (T & { ok: true }) | { ok: false; erro: string; status: number };

export async function chamar<T extends object = Record<string, unknown>>(
  url: string,
  init: RequestInit = {}
): Promise<Resultado<T>> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const corpo = (await r.json().catch(() => ({}))) as Corpo;
    if (!r.ok || corpo.ok === false) {
      const texto = String(corpo.erro || corpo.error || "");
      return {
        ok: false,
        status: r.status,
        erro:
          r.status === 401
            ? "Sua sessão expirou. Entre de novo."
            : texto || "O servidor não respondeu como esperado. Tente de novo.",
      };
    }
    return { ...(corpo as T), ok: true };
  } catch {
    return { ok: false, status: 0, erro: "Sem conexão com o servidor. Confira a internet e tente de novo." };
  }
}
