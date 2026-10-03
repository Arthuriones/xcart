import { formatarDinheiro } from "@/lib/financeiro/tipos";
import type { TomStatus } from "@/components/ui/status-badge";

// ============================================================================
// Regras e textos das telas do admin, sem React e sem banco: formatacao unica
// de moeda e data, nomes em portugues (acao de IA, status de assinatura,
// plano, acesso), filtros da lista de usuarios e a divisao do rodizio.
// Testado em tests/admin-formato.test.ts.
// ============================================================================

const FUSO = "America/Sao_Paulo";

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Real. null/NaN = "—": numero que nao se sabe nao vira zero. */
export function reais(v: number | null | undefined, casas = 2): string {
  return finito(v) ? formatarDinheiro(v, "BRL", casas) : "—";
}

/** Real no KPI: sem centavos a partir de R$ 10 mil, para caber no cartao do celular. */
export function reaisKpi(v: number | null | undefined): string {
  return reais(v, finito(v) && Math.abs(v) >= 10000 ? 0 : 2);
}

/** Dolar, com casas extras para custo de IA de centavo ("US$ 0,012"). */
export function dolares(v: number | null | undefined, casas = 2): string {
  return finito(v) ? formatarDinheiro(v, "USD", casas) : "—";
}

/** Valor na moeda que veio do banco ("brl", "USD"); sem moeda = real. */
export function naMoeda(v: number | null | undefined, moeda: string | null | undefined, casas = 2): string {
  if (!finito(v)) return "—";
  const m = (moeda ?? "").trim().toUpperCase();
  return formatarDinheiro(v, /^[A-Z]{3}$/.test(m) ? m : "BRL", casas);
}

/** Custo de uma acao de IA: fracao de centavo pede 3 casas. */
export function custoIa(usd: number | null | undefined): string {
  if (!finito(usd)) return "—";
  return dolares(usd, usd !== 0 && Math.abs(usd) < 0.1 ? 3 : 2);
}

export function inteiro(n: number | null | undefined): string {
  return finito(n) ? n.toLocaleString("pt-BR") : "—";
}

export function plural(n: number, um: string, varios: string): string {
  return `${inteiro(n)} ${n === 1 ? um : varios}`;
}

function valido(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** "03/10/2026", no horario de Brasilia. */
export function dataCurta(iso: string | null | undefined): string {
  const d = valido(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: FUSO }).format(d);
}

/** "14:32", no horario de Brasilia. */
export function hora(iso: string | number | null | undefined): string {
  const d = typeof iso === "number" ? new Date(iso) : valido(iso);
  if (!d || !Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO }).format(d);
}

/** "03/10/2026 às 14:32". */
export function dataHora(iso: string | null | undefined): string {
  const d = valido(iso);
  if (!d) return "—";
  return `${dataCurta(iso)} às ${hora(iso)}`;
}

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10" -> "out/26" (curto) ou "outubro de 2026" (longo). Chave ruim = a propria chave. */
export function rotuloMes(chave: string, forma: "curto" | "longo" = "curto"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  if (!m) return chave;
  const i = Number(m[2]) - 1;
  if (i < 0 || i > 11) return chave;
  return forma === "longo" ? `${MES_LONGO[i]} de ${m[1]}` : `${MES_CURTO[i]}/${m[1].slice(2)}`;
}

/** "2026-10-03" -> "03/10". */
export function diaMes(chave: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(chave);
  return m ? `${m[2]}/${m[1]}` : chave;
}

// ---------------------------------------------------------------------------
// Nomes em portugues
// ---------------------------------------------------------------------------

/** As acoes que src/lib/billing/usage.ts grava em ai_usage_log. */
const ROTULO_ACAO: Record<string, string> = {
  neutralize_image: "Imagem sem marca",
  neutralize_text: "Texto sem marca",
  translate: "Tradução",
  clone: "Clonagem",
  optimize: "Otimização",
  other: "Outros usos",
};

export function rotuloAcao(acao: string | null | undefined): string {
  return (acao && ROTULO_ACAO[acao]) || "Outros usos";
}

/** Status da assinatura (Pagou e Stripe) em portugues. Desconhecido = null (nao mostra cru). */
const STATUS_ASSINATURA: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste",
  past_due: "Pagamento atrasado",
  cancel_scheduled: "Cancela no fim do ciclo",
  canceled: "Cancelada",
  incomplete: "Pagamento pendente",
  incomplete_expired: "Pagamento expirado",
  unpaid: "Não paga",
  paused: "Pausada",
};

export function statusAssinatura(s: string | null | undefined): string | null {
  return (s && STATUS_ASSINATURA[s]) || null;
}

export function rotuloPlano(plano: string | null | undefined): string {
  if (plano === "pro") return "Pro";
  if (plano === "free") return "Free";
  return "—";
}

/** A mesma regra de GET /api/admin/overview: admin, plano Pro ou liberado a mao. */
export function temAcesso(u: { isAdmin: boolean; plan: string | null; accessGranted: boolean }): boolean {
  return u.isAdmin || u.plan === "pro" || u.accessGranted;
}

export interface SeloAcesso {
  tom: TomStatus;
  texto: string;
  /** Por que tem acesso (ou o que falta). */
  motivo: string;
  /** Para ordenar: com acesso primeiro. */
  ordem: number;
}

export function seloAcesso(u: { isAdmin: boolean; plan: string | null; accessGranted: boolean }): SeloAcesso {
  if (u.isAdmin) return { tom: "ok", texto: "Com acesso", motivo: "Administrador", ordem: 0 };
  if (u.accessGranted && u.plan === "pro")
    return { tom: "ok", texto: "Com acesso", motivo: "Pro e liberado à mão", ordem: 1 };
  if (u.plan === "pro") return { tom: "ok", texto: "Com acesso", motivo: "Pelo plano Pro", ordem: 1 };
  if (u.accessGranted) return { tom: "ok", texto: "Com acesso", motivo: "Liberado à mão", ordem: 2 };
  return { tom: "neutral", texto: "Sem acesso", motivo: "Free, sem liberação", ordem: 3 };
}

// ---------------------------------------------------------------------------
// Lista de usuarios: filtros (estado na URL)
// ---------------------------------------------------------------------------

export type FiltroAcesso = "todos" | "com" | "sem";
export type FiltroPlano = "todos" | "pro" | "free";

export interface FiltrosUsuarios {
  busca: string;
  acesso: FiltroAcesso;
  plano: FiltroPlano;
}

export const FILTROS_PADRAO: FiltrosUsuarios = { busca: "", acesso: "todos", plano: "todos" };

type Parametros = { [chave: string]: string | string[] | undefined };

function texto(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}

/** ?q=&acesso=com|sem&plano=pro|free. Valor estranho volta ao padrao. */
export function filtrosDaUrl(sp: Parametros): FiltrosUsuarios {
  const acesso = texto(sp.acesso);
  const plano = texto(sp.plano);
  return {
    busca: texto(sp.q).trim().slice(0, 120),
    acesso: acesso === "com" || acesso === "sem" ? acesso : "todos",
    plano: plano === "pro" || plano === "free" ? plano : "todos",
  };
}

/** O inverso: so o que difere do padrao vai para a URL. */
export function urlDosFiltros(f: FiltrosUsuarios): string {
  const p = new URLSearchParams();
  if (f.busca.trim()) p.set("q", f.busca.trim());
  if (f.acesso !== "todos") p.set("acesso", f.acesso);
  if (f.plano !== "todos") p.set("plano", f.plano);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function temFiltro(f: FiltrosUsuarios): boolean {
  return f.busca.trim() !== "" || f.acesso !== "todos" || f.plano !== "todos";
}

export function filtrarUsuarios<
  T extends { email: string; plan: string | null; isAdmin: boolean; accessGranted: boolean; stores?: { domain: string; name: string }[] },
>(usuarios: readonly T[], f: FiltrosUsuarios): T[] {
  const q = f.busca.trim().toLowerCase();
  return usuarios.filter((u) => {
    if (f.acesso !== "todos" && temAcesso(u) !== (f.acesso === "com")) return false;
    if (f.plano === "pro" && u.plan !== "pro") return false;
    if (f.plano === "free" && u.plan === "pro") return false;
    if (!q) return true;
    if (u.email.toLowerCase().includes(q)) return true;
    return (u.stores ?? []).some(
      (s) => s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q)
    );
  });
}

// ---------------------------------------------------------------------------
// Visao geral
// ---------------------------------------------------------------------------

/** Cadastros por mes ("2026-10"), na ordem dos meses pedidos. Data em UTC, como a API. */
export function cadastrosPorMes(datas: readonly (string | null)[], meses: readonly string[]): number[] {
  const conta = new Map(meses.map((m) => [m, 0]));
  for (const iso of datas) {
    const d = valido(iso);
    if (!d) continue;
    const chave = d.toISOString().slice(0, 7);
    const atual = conta.get(chave);
    if (atual !== undefined) conta.set(chave, atual + 1);
  }
  return meses.map((m) => conta.get(m) ?? 0);
}

// ---------------------------------------------------------------------------
// Rodizio: a parte de cada destino
// ---------------------------------------------------------------------------

/**
 * Porcentagem de cada destino no rodizio, a mesma conta do console de
 * roteamento (src/lib/checkout-routes/graph.ts): peso sobre a soma dos pesos
 * dos destinos ligados com peso maior que zero. Destino desligado ou com peso
 * zero fica fora do rodizio (null).
 */
export function divisaoDestinos(
  destinos: readonly { id: string; peso: number; ligado: boolean }[]
): Record<string, number | null> {
  const ativos = destinos.filter((d) => d.ligado && d.peso > 0);
  const total = ativos.reduce((s, d) => s + d.peso, 0);
  const saida: Record<string, number | null> = {};
  for (const d of destinos) {
    saida[d.id] = d.ligado && d.peso > 0 && total > 0 ? Math.round((d.peso / total) * 100) : null;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Gerenciar: o campo de saldo
// ---------------------------------------------------------------------------

/** "120" -> 120. Vazio, negativo, fracao ou texto -> null (erro no campo). */
export function lerSaldo(textoCampo: string): number | null {
  const t = textoCampo.trim().replace(/\./g, "");
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

/** Periodo do faturamento: 7, 30 ou 60 dias (teto da Shopify). */
export type PeriodoFaturamento = "7" | "30" | "60";

export function periodoDaUrl(v: string | string[] | undefined): PeriodoFaturamento {
  const t = texto(v);
  return t === "7" || t === "60" ? t : "30";
}
