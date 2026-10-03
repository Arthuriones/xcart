import { diaNoFuso, somarDias } from "@/lib/financeiro/tipos";
import { opcaoTipo, type EventoAtividade, type TipoAtividade } from "@/lib/leitura/atividade-regras";

// ============================================================================
// Como a tela Atividade escreve dia, hora e busca. Puro (sem React), para o
// vitest. As horas saem no fuso do relatorio, que a tela diz qual e.
// ============================================================================

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

function capitalizar(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** "Hoje", "Ontem", "Sábado, 26 de setembro" (com o ano se for outro). */
export function rotuloDia(dia: string, hoje: string): string {
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, -1)) return "Ontem";
  const outroAno = dia.slice(0, 4) !== hoje.slice(0, 4);
  const texto = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(outroAno ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${dia}T12:00:00Z`));
  return capitalizar(texto);
}

/** "14:32" no fuso dado. Fuso invalido cai em Sao Paulo, nunca lanca. */
export function horaCurta(at: string, fuso: string): string {
  const opcoes: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: fuso }).format(t);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: "America/Sao_Paulo" }).format(t);
  }
}

/**
 * "agora", "há 5 min", "há 3 h", "há 2 dias". Depois de uma semana, null: o
 * cabecalho do dia ja diz quando foi.
 */
export function relativo(at: string, agora: number): string | null {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  const d = Math.max(0, agora - t);
  if (d < MIN) return "agora";
  if (d < HORA) return `há ${Math.floor(d / MIN)} min`;
  if (d < DIA) return `há ${Math.floor(d / HORA)} h`;
  const dias = Math.floor(d / DIA);
  if (dias < 7) return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
  return null;
}

export interface GrupoDia {
  dia: string;
  rotulo: string;
  eventos: EventoAtividade[];
}

/** Agrupa por dia no fuso, mantendo a ordem (os eventos ja vem do mais novo). */
export function agruparPorDia(eventos: EventoAtividade[], fuso: string, agora: number): GrupoDia[] {
  const hoje = diaNoFuso(new Date(agora), fuso);
  const grupos: GrupoDia[] = [];
  for (const e of eventos) {
    const t = Date.parse(e.at);
    const dia = Number.isFinite(t) ? diaNoFuso(new Date(t), fuso) : "—";
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.eventos.push(e);
    else grupos.push({ dia, rotulo: dia === "—" ? "Sem data" : rotuloDia(dia, hoje), eventos: [e] });
  }
  return grupos;
}

/** Minusculo e sem acento: "Importação" casa com "importacao". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Busca no que a linha mostra: titulo, descricao, loja, tipo e estado. */
export function buscar(eventos: EventoAtividade[], q: string): EventoAtividade[] {
  const termos = normalizar(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return eventos;
  return eventos.filter((e) => {
    const alvo = normalizar(
      [e.titulo, e.descricao, e.loja ?? "", opcaoTipo(e.tipo).rotulo, e.selo?.texto ?? ""].join(" ")
    );
    return termos.every((t) => alvo.includes(t));
  });
}

/** "/activity?tipo=alerta&q=..." -- o que fica na URL para voltar e compartilhar. */
export function hrefAtividade(tipo: TipoAtividade | null, q: string): string {
  const p = new URLSearchParams();
  if (tipo) p.set("tipo", tipo);
  if (q.trim()) p.set("q", q.trim());
  const s = p.toString();
  return s ? `/activity?${s}` : "/activity";
}

/** "1 evento" / "50 eventos". */
export function eventosTexto(n: number): string {
  return n === 1 ? "1 evento" : `${n} eventos`;
}
