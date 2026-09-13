// Conversao de moeda APENAS para relatorio no painel admin.
//
// As lojas de checkout faturam em moedas diferentes (CLP, USD, BRL, AUD, EUR...).
// Somar centavos dessas moedas produz um numero sem significado, e RANQUEAR por
// esse numero e pior ainda: CLP 4.399.000 (~R$ 25) passaria na frente de
// USD 1.000 (~R$ 5.400) so pela escala da moeda.
//
// Mesma politica de USD_BRL_REPORTING em billing/plans.ts: taxa fixa, ajustavel
// por env, sem tocar em cobranca nenhuma. Nao buscamos cotacao ao vivo de
// proposito — o painel nao pode depender de mais um servico externo para abrir,
// e uma taxa aproximada ja responde "quem esta faturando mais".
//
// Moeda desconhecida NAO entra na conta convertida. Preferimos um total menor e
// honesto, com aviso na tela, a um ranking silenciosamente errado.

/** Quantos reais vale 1 unidade da moeda. */
const PADRAO: Record<string, number> = {
  BRL: 1,
  USD: 5.4,
  EUR: 5.85,
  GBP: 6.9,
  CAD: 3.9,
  AUD: 3.5,
  NZD: 3.2,
  CLP: 0.0057,
  MXN: 0.27,
  ARS: 0.0037,
  COP: 0.0013,
  PEN: 1.45,
  UYU: 0.13,
  PYG: 0.00072,
};

/**
 * Sobrescreve taxas por env, ex.: `FX_BRL_RATES={"CLP":0.006,"USD":5.6}`.
 *
 * Env quebrada nao pode derrubar o painel: se o JSON nao parsear, seguimos com
 * a tabela padrao.
 */
function carregarTaxas(): Record<string, number> {
  const bruto = process.env.FX_BRL_RATES;
  if (!bruto) return PADRAO;
  try {
    const extra = JSON.parse(bruto) as Record<string, unknown>;
    const limpo: Record<string, number> = {};
    for (const [moeda, valor] of Object.entries(extra)) {
      const n = Number(valor);
      if (Number.isFinite(n) && n > 0) limpo[moeda.toUpperCase()] = n;
    }
    return { ...PADRAO, ...limpo };
  } catch {
    return PADRAO;
  }
}

export const TAXAS_BRL = carregarTaxas();

export function conhecida(moeda: string): boolean {
  return Boolean(TAXAS_BRL[(moeda || "").toUpperCase()]);
}

/**
 * Centavos na moeda de origem -> centavos em BRL.
 * Devolve `null` quando nao ha taxa, para o chamador decidir o que fazer em vez
 * de receber um zero que parece faturamento zerado.
 */
export function paraCentavosBRL(centavos: number, moeda: string): number | null {
  const taxa = TAXAS_BRL[(moeda || "").toUpperCase()];
  if (!taxa) return null;
  return Math.round(centavos * taxa);
}
