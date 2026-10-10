// ============================================================================
// "Venda no celular" com varios celulares (migration 070): o que a tela e o
// servidor dividem. Sem "server-only" e sem banco -- a tela importa daqui.
//
// A URL de cada celular e SEGREDO e nunca chega aqui: a tela so conhece o
// host. O envio e a leitura moram em venda-webhook.ts (servidor).
// ============================================================================

/** Teto por usuario: o envio le no maximo isto, e o cadastro recusa o seguinte. */
export const MAX_CELULARES = 10;

export const NOME_PADRAO = "Celular";
export const MAX_NOME = 40;

/** Antes da 070: a URL unica da 063 aparece como um celular com este id. */
export const ID_LEGADO = "legado";

/** Um celular na tela. Nunca a URL. */
export interface CelularDaTela {
  id: string;
  nome: string;
  /** Host da URL (api.pushcut.io): o bastante para reconhecer, sem a chave. */
  host: string;
  /** Ultimo envio (venda ou teste). */
  ultimo_envio_em: string | null;
  /** Erro do ultimo envio; null = chegou. */
  ultimo_erro: string | null;
}

/** Vazio = "Celular"; espacos juntados; mais de 40 letras ou nao-texto = null. */
export function nomeDoCelular(v: unknown): string | null {
  if (v === undefined || v === null) return NOME_PADRAO;
  if (typeof v !== "string") return null;
  const n = v.replace(/\s+/g, " ").trim();
  if (!n) return NOME_PADRAO;
  return n.length <= MAX_NOME ? n : null;
}

/** "Ligado · 2 celulares" / "Desligado" / "Não configurado". */
export function resumoDoCanal(ativo: boolean, n: number): { ligado: boolean; texto: string } {
  if (n === 0) return { ligado: false, texto: "Não configurado" };
  if (!ativo) return { ligado: false, texto: "Desligado" };
  return { ligado: true, texto: `Ligado · ${n} ${n === 1 ? "celular" : "celulares"}` };
}
