// ============================================================================
// Formatos da tela, em pt-BR como o site. O Dashboard ja vem com o texto
// pronto do servidor; isto serve a Campanhas e a edicao, que recebem numero.
// ============================================================================

/** Moedas sem centavo no Meta: o valor ja vem na unidade cheia. */
const SEM_CENTAVOS = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

export function casasDaMoeda(moeda: string): number {
  return SEM_CENTAVOS.has(moeda) ? 0 : 2;
}

export function dinheiro(valor: number | null | undefined, moeda: string, casas = casasDaMoeda(moeda)): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  try {
    return valor
      .toLocaleString("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: casas, maximumFractionDigits: casas })
      .replace(/^-/, "−");
  } catch {
    return `${moeda} ${valor.toFixed(casas)}`;
  }
}

export function inteiro(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return Math.round(valor).toLocaleString("pt-BR");
}

export function porcento(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function vezes(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

/** "50,5" ou "50.5" -> 50.5; vazio ou invalido -> null. */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, "");
  if (!limpo) return null;
  // "1.234,56" (pt-BR) -> 1234.56; "1.500" (milhar, como o app mostra) -> 1500;
  // "1234.56" segue igual.
  const normal = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(limpo)
      ? limpo.replace(/\./g, "")
      : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Numero para o campo de texto, com virgula. */
export function paraCampo(valor: number | null, casas = 2): string {
  if (valor === null || !Number.isFinite(valor)) return "";
  return valor.toFixed(casas).replace(".", ",");
}

/** "ha 5 min", "ha 2 h", "ontem"... */
export function relativo(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((agora - t) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

/** effective_status do Meta -> rotulo curto. */
export function rotuloStatus(status: string | null): { texto: string; ativo: boolean } {
  switch (status) {
    case "ACTIVE":
      return { texto: "Ativa", ativo: true };
    case "PAUSED":
      return { texto: "Pausada", ativo: false };
    case "CAMPAIGN_PAUSED":
      return { texto: "Campanha pausada", ativo: false };
    case "ADSET_PAUSED":
      return { texto: "Conjunto pausado", ativo: false };
    case "DISAPPROVED":
      return { texto: "Reprovado", ativo: false };
    case "WITH_ISSUES":
      return { texto: "Com problema", ativo: false };
    case "IN_PROCESS":
    case "PENDING_REVIEW":
      return { texto: "Em análise", ativo: false };
    case "ARCHIVED":
    case "DELETED":
      return { texto: "Arquivada", ativo: false };
    case null:
      return { texto: "—", ativo: false };
    default:
      return { texto: status, ativo: false };
  }
}
