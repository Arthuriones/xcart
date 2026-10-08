import { marketParamsFromLanguage } from "@/lib/shopify/cart-routing";

// ============================================================================
// Pais e idioma com que o checkout abre, POR LOJA DE CHECKOUT.
//
// Mora em routed_checkout_targets.settings (checkout_country, checkout_locale).
// O ajuste antigo gravava na ROTA (routed_checkout_configs.settings), que o
// resolve e o tema so leem no destino legado -- o dialogo da tela mudava um
// campo que nenhum comprador via.
//
// Tres modos:
//   - "idioma"    (padrao, nada gravado): o pais sai do idioma da loja de
//                 checkout ("en-US" -> country=US). E o comportamento de
//                 sempre; rota existente fica nele ate o lojista escolher.
//   - "comprador" (checkout_country = "auto"): NAO manda country. A Shopify
//                 geolocaliza o comprador e abre no mercado dele.
//   - "fixo"      (checkout_country = "CL"): manda country/locale fixos.
//
// O que a doc da Shopify confirma do permalink
// (shopify.dev/docs/apps/build/checkout/create-cart-permalinks, 10/2026):
// `discount`, e o idioma como PREFIXO do caminho (/fr/cart/...). `country` e
// `locale` como query NAO aparecem la. Ficam como estavam porque e o que roda
// em producao e mudar mexeria na moeda de quem ja vende; o prefixo de idioma
// nao foi adotado porque idioma nao publicado na loja de checkout pode nao
// abrir o carrinho -- so teste real diz.
// ============================================================================

/** Valor gravado em checkout_country para "pais do comprador". */
export const PAIS_DO_COMPRADOR = "auto";

export interface Mercado {
  pais: string;
  nome: string;
  locale: string;
  moeda: string;
}

/** Os paises que a tela oferece. A moeda e a do mercado local do pais. */
export const MERCADOS: readonly Mercado[] = [
  { pais: "US", nome: "Estados Unidos", locale: "en-US", moeda: "USD" },
  { pais: "GB", nome: "Reino Unido", locale: "en-GB", moeda: "GBP" },
  { pais: "CA", nome: "Canadá", locale: "en-CA", moeda: "CAD" },
  { pais: "AU", nome: "Austrália", locale: "en-AU", moeda: "AUD" },
  { pais: "DE", nome: "Alemanha", locale: "de-DE", moeda: "EUR" },
  { pais: "FR", nome: "França", locale: "fr-FR", moeda: "EUR" },
  { pais: "IT", nome: "Itália", locale: "it-IT", moeda: "EUR" },
  { pais: "ES", nome: "Espanha", locale: "es-ES", moeda: "EUR" },
  { pais: "PT", nome: "Portugal", locale: "pt-PT", moeda: "EUR" },
  { pais: "BR", nome: "Brasil", locale: "pt-BR", moeda: "BRL" },
  { pais: "MX", nome: "México", locale: "es-MX", moeda: "MXN" },
  { pais: "CL", nome: "Chile", locale: "es-CL", moeda: "CLP" },
  { pais: "CO", nome: "Colômbia", locale: "es-CO", moeda: "COP" },
  { pais: "AR", nome: "Argentina", locale: "es-AR", moeda: "ARS" },
  { pais: "JP", nome: "Japão", locale: "ja-JP", moeda: "JPY" },
];

const PAIS_RE = /^[A-Z]{2}$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/;

export function mercadoDoPais(pais: string | null | undefined): Mercado | null {
  const codigo = String(pais || "").toUpperCase();
  return MERCADOS.find((m) => m.pais === codigo) ?? null;
}

/** Moeda do mercado local do pais, quando a tela conhece o pais. */
export function moedaDoPais(pais: string | null | undefined): string | null {
  return mercadoDoPais(pais)?.moeda ?? null;
}

export type ModoDoMercado = "idioma" | "comprador" | "fixo";

export interface AjusteDeMercado {
  modo: ModoDoMercado;
  /** So no modo fixo. */
  country?: string;
  locale?: string;
}

/**
 * O que esta gravado no destino. Valor torto (pais de 3 letras, minusculo
 * que nao e "auto") vale como nada gravado: cai no padrao de sempre, nunca
 * vira parametro de URL.
 */
export function lerAjusteDeMercado(settings: unknown): AjusteDeMercado {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const bruto = typeof s.checkout_country === "string" ? s.checkout_country.trim() : "";
  if (bruto.toLowerCase() === PAIS_DO_COMPRADOR) return { modo: "comprador" };
  const pais = bruto.toUpperCase();
  if (!PAIS_RE.test(pais)) return { modo: "idioma" };
  const locale = typeof s.checkout_locale === "string" ? s.checkout_locale.trim() : "";
  return {
    modo: "fixo",
    country: pais,
    ...(LOCALE_RE.test(locale) ? { locale } : {}),
  };
}

/** Ajuste de checkout do destino, como a tela mostra. */
export interface CheckoutDoDestino {
  modo: ModoDoMercado;
  /** So no modo "fixo". */
  pais: string | null;
  /** Override do dominio de checkout; null = o da loja conectada. */
  dominio: string | null;
}

export function checkoutDoDestino(settings: unknown): CheckoutDoDestino {
  const ajuste = lerAjusteDeMercado(settings);
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  const dominio = typeof s.checkout_domain === "string" ? s.checkout_domain.trim() : "";
  return { modo: ajuste.modo, pais: ajuste.country ?? null, dominio: dominio || null };
}

/**
 * country/locale que vao no permalink deste destino. Um lugar so para o
 * resolve (servidor) e o embed-config (tema, caminho inline do loader): se
 * divergirem, o mesmo comprador abre o checkout em moedas diferentes conforme
 * o caminho que o carrinho tomou.
 */
export function mercadoDoDestino(
  settings: unknown,
  targetLanguage: string | null | undefined
): { country?: string; locale?: string } {
  const ajuste = lerAjusteDeMercado(settings);
  if (ajuste.modo === "comprador") return {};
  if (ajuste.modo === "fixo") {
    return { country: ajuste.country, ...(ajuste.locale ? { locale: ajuste.locale } : {}) };
  }
  return marketParamsFromLanguage(targetLanguage);
}

/**
 * Entrada da tela -> o que gravar. "" volta ao padrao (apaga), "auto" e o
 * pais do comprador, "XX" e pais fixo (locale da lista quando a tela nao
 * manda um).
 */
export function ajusteParaGravar(
  pais: unknown,
  locale?: unknown
):
  | { ok: true; checkout_country: string | null; checkout_locale: string | null }
  | { ok: false; erro: string } {
  const bruto = typeof pais === "string" ? pais.trim() : "";
  if (!bruto) return { ok: true, checkout_country: null, checkout_locale: null };
  if (bruto.toLowerCase() === PAIS_DO_COMPRADOR) {
    return { ok: true, checkout_country: PAIS_DO_COMPRADOR, checkout_locale: null };
  }
  const codigo = bruto.toUpperCase();
  if (!PAIS_RE.test(codigo)) return { ok: false, erro: "País inválido." };
  const pedido = typeof locale === "string" ? locale.trim() : "";
  if (pedido && !LOCALE_RE.test(pedido)) return { ok: false, erro: "Idioma inválido." };
  return {
    ok: true,
    checkout_country: codigo,
    checkout_locale: pedido || mercadoDoPais(codigo)?.locale || null,
  };
}
