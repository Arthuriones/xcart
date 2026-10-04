// ============================================================================
// O Google Ads pelo NAVEGADOR, com a tag do Google (gtag.js).
//
// Decisao do dono (03/10/2026): o Google sai do navegador, igual ao WeTracked,
// e nao mais do servidor. O ping /pagead/conversion do servidor respondia 200 e
// nao contava nada, e a Data Manager API pedia service account, espera de 6 h
// e diagnostico assincrono. A tag do Google no navegador e o caminho que o
// proprio Google Ads mede e deduplica (pelo transaction_id).
//
// Quem dispara:
//   - public/xcart-click.js (snippet do tema): view_item e add_to_cart, e o
//     begin_checkout so quando o Web Pixel NAO esta cobrindo o checkout;
//   - public/xcart-pixel.js (Web Pixel do checkout): begin_checkout e
//     purchase, com os dados do comprador para conversoes otimizadas.
//
// Os dois leem as contas por GET /api/tracking/google-config. Este arquivo e
// puro: decide o que dessa configuracao pode sair para o navegador.
// ============================================================================

/** Os eventos que viram conversao no Google pela tag. */
export const EVENTOS_GOOGLE_NAVEGADOR = [
  "page_view",
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "purchase",
] as const;
export type EventoGoogleNavegador = (typeof EVENTOS_GOOGLE_NAVEGADOR)[number];

/** O que o navegador recebe de cada conta. So dado publico: id e rotulos. */
export interface ContaGoogleNoNavegador {
  conta: string;
  labels: Partial<Record<EventoGoogleNavegador, string>>;
}

/**
 * `AW-123` ou `123` -> `AW-123`. Qualquer outra coisa -> null.
 *
 * O valor vai para a URL do gtag.js e para `send_to` no navegador da loja:
 * caractere estranho aqui so pode ser erro de cadastro, e deixar passar
 * quebraria a tag inteira.
 */
export function contaDoGoogle(bruta: unknown): string | null {
  const limpa = String(bruta ?? "").trim().toUpperCase();
  const m = /^(?:AW-)?(\d{6,15})$/.exec(limpa);
  return m ? `AW-${m[1]}` : null;
}

/** Rotulo de conversao: letras, numeros, `_` e `-`. */
function rotuloValido(bruto: unknown): string | null {
  const r = typeof bruto === "string" ? bruto.trim() : "";
  return r && /^[A-Za-z0-9_-]{1,100}$/.test(r) ? r : null;
}

/**
 * Linhas de `tracking_destinations` (plataforma google, ativas) -> o que sai
 * para o navegador.
 *
 * Conta repetida em dois destinos vira UMA entrada: duas tags com o mesmo AW-
 * disparariam a mesma conversao duas vezes. Os rotulos se completam, e o do
 * destino mais antigo vence quando os dois tem rotulo para o mesmo evento.
 *
 * Conta sem nenhum rotulo continua na lista: a tag ainda carrega e configura a
 * conta (vinculador de conversoes), so nao dispara conversao.
 */
export function contasGoogleParaNavegador(
  linhas: readonly { conta?: unknown; labels?: unknown; ativo?: unknown }[]
): ContaGoogleNoNavegador[] {
  const porConta = new Map<string, ContaGoogleNoNavegador>();
  for (const linha of linhas) {
    if (linha.ativo === false) continue;
    const conta = contaDoGoogle(linha.conta);
    if (!conta) continue;
    const atual = porConta.get(conta) ?? { conta, labels: {} };
    const brutos =
      linha.labels && typeof linha.labels === "object"
        ? (linha.labels as Record<string, unknown>)
        : {};
    for (const evento of EVENTOS_GOOGLE_NAVEGADOR) {
      if (atual.labels[evento]) continue;
      const rotulo = rotuloValido(brutos[evento]);
      if (rotulo) atual.labels[evento] = rotulo;
    }
    porConta.set(conta, atual);
  }
  return [...porConta.values()];
}

/**
 * Por quanto tempo o ultimo sinal do Web Pixel vale como "cobrindo o checkout".
 *
 * Uma constante so, usada aqui (Google, no tema) e no coletor (Meta). Era um
 * dia: loja com menos de um checkout por dia via o carimbo vencer, o tema
 * voltava a disparar begin_checkout e o pixel disparava de novo -- dois
 * checkouts no Meta e no Google para a mesma acao. Sete dias cobre loja
 * parada no fim de semana e ainda se cura sozinho se o pixel for removido.
 */
export const JANELA_PIXEL_CHECKOUT_MS = 7 * 864e5;

/**
 * O Web Pixel esta cobrindo o checkout?
 *
 * Mesma janela do coletor (JANELA_PIXEL_CHECKOUT_MS): o pixel se anuncia
 * carimbando `web_pixel_visto_em`. Cobrindo, o tema NAO dispara begin_checkout
 * no Google -- o clique no botao e o checkout_started descrevem a mesma acao,
 * com transaction_id diferentes, e o Google contaria duas.
 */
export function pixelCobrindoCheckout(vistoEm: string | null | undefined, agora = Date.now()): boolean {
  const ms = vistoEm ? Date.parse(vistoEm) : NaN;
  return Number.isFinite(ms) && agora - ms < JANELA_PIXEL_CHECKOUT_MS;
}
