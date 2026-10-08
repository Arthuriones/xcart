import { moedaDoPais } from "@/lib/checkout-routes/mercado";

// ============================================================================
// O detalhe do "routed_ok" (carrinho levado ao checkout), em
// routed_checkout_fallbacks.detail:
//
//   "3 itens -> loja.myshopify.com"                       (loader antigo)
//   "3 itens -> loja.myshopify.com moeda=EUR pais=US"     (desde 10/2026)
//
// `moeda` e a do carrinho na vitrine (cart.js "currency"); `pais` e o country
// que foi no permalink, ou "auto" quando nao foi nenhum (a Shopify escolhe
// pelo comprador). O loader manda os dois em campos proprios e quem escreve
// o sufixo e o servidor (track-fallback), ja validado: o texto livre do
// navegador nunca vira chave=valor.
//
// Em texto e nao em coluna de proposito: e telemetria para a tela, a tabela
// ja tem retencao de 180 dias e uma coluna nova pediria migration. A
// contagem de carrinhos le so `reason`, entao o sufixo nao muda numero
// nenhum.
//
// Nada do comprador entra aqui: moeda e pais do checkout sao do carrinho e
// da configuracao da loja, nao da pessoa.
// ============================================================================

const MOEDA_RE = /^[A-Z]{3}$/;
const PAIS_RE = /^[A-Z]{2}$/;
const LEVADO_RE = /^\s*(\d*)\s*itens\s*->\s*(\S+)((?:\s+[a-z]+=[A-Za-z]*)*)\s*$/i;

/**
 * Sufixo do routed_ok a partir do que o loader mandou. Campo torto e
 * descartado; sem moeda valida nao escreve nada (loader antigo, carrinho sem
 * currency).
 */
export function sufixoDaMoeda(moeda: unknown, paisCheckout: unknown): string {
  const m = typeof moeda === "string" ? moeda.trim().toUpperCase() : "";
  if (!MOEDA_RE.test(m)) return "";
  let saida = ` moeda=${m}`;
  if (typeof paisCheckout === "string") {
    const p = paisCheckout.trim().toUpperCase();
    if (!p) saida += " pais=auto";
    else if (PAIS_RE.test(p)) saida += ` pais=${p}`;
  }
  return saida;
}

/** Itens e dominio do routed_ok, com ou sem o sufixo de moeda. */
export function lerCarrinhoLevado(detalhe: string | null | undefined): {
  itens: number | null;
  dominio: string | null;
} {
  const m = LEVADO_RE.exec(String(detalhe || ""));
  if (!m) return { itens: null, dominio: null };
  const itens = m[1] ? Number(m[1]) : null;
  const dominio = m[2] && m[2] !== "?" ? m[2] : null;
  return { itens: Number.isFinite(itens) ? itens : null, dominio };
}

export interface MoedaDoLevado {
  /** Moeda do carrinho na vitrine. */
  moeda: string;
  /** country do permalink; null = "auto" (pais do comprador). */
  pais: string | null;
}

/** A moeda gravada no routed_ok, ou null (loader antigo, outro evento). */
export function lerMoedaDoLevado(detalhe: string | null | undefined): MoedaDoLevado | null {
  const m = LEVADO_RE.exec(String(detalhe || ""));
  if (!m || !m[3]) return null;
  const campos: Record<string, string> = {};
  for (const par of m[3].trim().split(/\s+/)) {
    const [chave, valor = ""] = par.split("=");
    campos[chave.toLowerCase()] = valor;
  }
  const moeda = (campos.moeda || "").toUpperCase();
  if (!MOEDA_RE.test(moeda)) return null;
  const pais = (campos.pais || "").toUpperCase();
  return { moeda, pais: PAIS_RE.test(pais) ? pais : null };
}

/**
 * Carrinho numa moeda e checkout aberto num pais de outra. So responde
 * quando da para saber: pais fixo que a tela conhece. Com "auto" a Shopify
 * escolhe pelo comprador, e a moeda do checkout depende dos mercados da loja
 * -- ai nao ha o que comparar.
 */
export function moedaTrocada(
  lido: MoedaDoLevado | null
): { carrinho: string; checkout: string } | null {
  if (!lido?.pais) return null;
  const checkout = moedaDoPais(lido.pais);
  if (!checkout || checkout === lido.moeda) return null;
  return { carrinho: lido.moeda, checkout };
}

/** Frase curta para a linha do evento. Vazia quando nao ha troca. */
export function avisoDeMoeda(detalhe: string | null | undefined): string {
  const troca = moedaTrocada(lerMoedaDoLevado(detalhe));
  return troca ? ` Carrinho em ${troca.carrinho}, checkout em ${troca.checkout}.` : "";
}

/** Quantos carrinhos em cada moeda, da que mais aparece para a que menos. */
export function resumirMoedas(
  detalhes: (string | null | undefined)[]
): { moeda: string; carrinhos: number }[] {
  const contagem = new Map<string, number>();
  for (const d of detalhes) {
    const lido = lerMoedaDoLevado(d);
    if (lido) contagem.set(lido.moeda, (contagem.get(lido.moeda) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([moeda, carrinhos]) => ({ moeda, carrinhos }))
    .sort((a, b) => b.carrinhos - a.carrinhos || a.moeda.localeCompare(b.moeda));
}
