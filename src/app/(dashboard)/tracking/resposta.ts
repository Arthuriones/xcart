/**
 * Le a resposta JSON de uma rota do app e lanca um erro legivel quando falha.
 *
 * Sessao vencida nao volta 401: o proxy redireciona para a pagina de login,
 * que chega como HTML com status 200. Sem este cuidado, `r.ok` diria que deu
 * certo (ou o JSON.parse mostraria "Unexpected token <" para o lojista).
 */
export async function respostaJson(r: Response, falha: string): Promise<Record<string, unknown>> {
  // As rotas antigas respondem "Unauthorized", em ingles.
  if (r.status === 401) throw new Error("Sua sessão expirou. Entre de novo para continuar.");
  let j: Record<string, unknown>;
  try {
    j = (await r.json()) as Record<string, unknown>;
  } catch {
    throw new Error(
      r.redirected ? "Sua sessão expirou. Entre de novo para continuar." : falha
    );
  }
  if (!r.ok) {
    const msg = typeof j.error === "string" ? j.error : typeof j.erro === "string" ? j.erro : "";
    // `detalhe`: a mensagem crua de quem respondeu (a Shopify), para o toast
    // mostrar embaixo da frase em portugues.
    throw Object.assign(new Error(msg || falha), {
      detalhe: typeof j.detalhe === "string" ? j.detalhe : undefined,
    });
  }
  return j;
}
