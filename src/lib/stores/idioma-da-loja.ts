import { safeFetch } from "@/lib/net/safe-url";

// ============================================================================
// O idioma da loja, lido da propria loja -- em vez de perguntado no cadastro.
//
// O `target_language` decide em que idioma a IA do xcart escreve (otimizar,
// traduzir, neutralizar, montar loja). O cadastro perguntava, ninguem
// respondia, e o valor ficava no padrao "pt-BR". Medido em 01/10/2026: as 63
// lojas cadastradas estavam em pt-BR, inclusive a Lash Bestie e a Softnook,
// que vendem em ingles, e a Gotoku, em japones -- a IA escrevia em portugues
// para lojas que nao falam portugues.
//
// A loja ja diz o idioma dela: todo tema Shopify publica `<html lang="en">`.
// ============================================================================

/**
 * Os idiomas que a tela oferece, pelo codigo de duas letras.
 *
 * Tem que bater com LANGUAGE_OPTIONS do editor da loja: um valor fora dessa
 * lista apareceria em branco no seletor.
 */
const SUPORTADOS: Record<string, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  ja: "ja-JP",
};

/**
 * O idioma declarado no `<html lang>` de uma pagina, ou null.
 *
 * Null para idioma fora da lista, em vez de um palpite: idioma errado e pior
 * que o padrao, porque ninguem confere.
 */
export function idiomaDoHtml(html: string): string | null {
  // `\s` antes de `lang`, e nao `\b`: o hifen conta como fronteira de palavra,
  // e `\blang` casava dentro de `data-lang` (o teste pegou).
  const m = html.match(/<html\b[^>]*?\slang\s*=\s*["']?([a-zA-Z]{2,3})(?:[-_][a-zA-Z0-9]+)?/i);
  if (!m) return null;
  return SUPORTADOS[m[1].toLowerCase()] ?? null;
}

/**
 * Le a vitrine e devolve o idioma, ou null se nao der.
 *
 * Melhor esforco: roda dentro do cadastro da loja, entao nunca lanca e tem teto
 * de 4 s. A URL vem da propria Shopify (`primaryDomain.url`), mas passa pelo
 * `safeFetch` mesmo assim -- regra do repo para toda URL que nao e nossa.
 */
export async function detectarIdiomaDaLoja(
  url: string | null | undefined
): Promise<string | null> {
  if (!url) return null;
  try {
    const resposta = await safeFetch(url, {
      timeoutMs: 4000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; xcart)" },
    });
    if (!resposta.ok) return null;
    // O <html> esta no comeco do documento: nao ha por que ler a pagina toda.
    const html = (await resposta.text()).slice(0, 64 * 1024);
    return idiomaDoHtml(html);
  } catch {
    return null;
  }
}
