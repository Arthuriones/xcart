// ============================================================================
// Qual item do menu acende.
//
// O teste antigo era "pathname igual ou comeca com href + '/'", item a item.
// Com /tracking e /tracking/eventos no mesmo menu, os DOIS casavam em
// /tracking/eventos e o menu acendia dois itens. Vence o href mais longo que
// casa -- um item aceso por vez.
//
// Puro (sem React) para ser testado e reaproveitado pela trilha e pelo seletor.
// ============================================================================

/** O href mais longo que casa com o pathname (igual, ou prefixo seguido de "/"). */
export function hrefAtivo(pathname: string, hrefs: string[]): string | null {
  let melhor: string | null = null;
  for (const href of hrefs) {
    const casa = pathname === href || pathname.startsWith(`${href}/`);
    if (casa && (melhor === null || href.length > melhor.length)) melhor = href;
  }
  return melhor;
}
