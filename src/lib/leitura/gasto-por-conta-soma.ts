import type { Conversor } from "@/lib/financeiro/calculo";
import { paraNumero, type Intervalo } from "@/lib/financeiro/tipos";

// ============================================================================
// Gasto de anuncio por CONTA: o de hoje e o do periodo (funcao #12).
//
// Puro, sem banco e sem "server-only": a leitura (gasto-por-conta.ts) busca as
// linhas e o cambio e entrega aqui. O vitest importa este arquivo direto.
//
// Regras que a tela promete ao lojista:
// - So o nivel 'conta' (a verdade do gasto, com anuncio apagado). Quem chama
//   ja filtra; a campanha somaria em dobro.
// - Dia SEM linha nao e zero: o sync do Meta grava zero nos dias sem entrega,
//   entao "nao tem linha" quer dizer "nao foi lido". Periodo sem nenhuma linha
//   vira null ("—"), nunca R$ 0,00.
// - "Hoje" e o dia no fuso DA CONTA, o mesmo que o gerenciador de anuncios
//   mostra. O periodo usa o intervalo do relatorio, o mesmo do Lucro.
// - Sem cotacao para converter, o valor fica na moeda da conta e a tela diz
//   isso. Nunca soma moeda diferente como se fosse a mesma.
// ============================================================================

export interface LinhaGastoConta {
  ad_account_id: string;
  /** "AAAA-MM-DD" no fuso da conta. */
  data: string;
  moeda: string;
  /** numeric do Postgres pode chegar como string. */
  gasto: number | string;
}

export interface ValorGasto {
  /** Na moeda do relatorio quando `convertido`; senao, na moeda da conta. */
  valor: number;
  /** Na moeda da conta, sem conversao. */
  original: number;
  /** Moeda da conta (a da primeira linha). */
  moedaOriginal: string;
  /** Todas as linhas tiveram cotacao. */
  convertido: boolean;
  /** Alguma linha usou a tabela fixa de cambio (cron de cambio sem dado). */
  aproximado: boolean;
}

export interface GastoDaConta {
  hoje: ValorGasto | null;
  periodo: ValorGasto | null;
  /** Quantos dias do periodo tem linha gravada. */
  diasComDado: number;
  /** Dias de calendario do periodo. */
  diasNoPeriodo: number;
  /** Primeiro dia do periodo com linha (para "dado desde DD/MM"). */
  primeiroDia: string | null;
}

function dentro(dia: string, i: Intervalo): boolean {
  return dia >= i.desde && dia <= i.ate;
}

function diasEntre(i: Intervalo): number {
  const a = Date.parse(`${i.desde}T00:00:00Z`);
  const b = Date.parse(`${i.ate}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/** Soma um conjunto de linhas de UMA conta, convertendo dia a dia. */
function somar(linhas: LinhaGastoConta[], moeda: string, converter: Conversor): ValorGasto | null {
  if (linhas.length === 0) return null;
  const moedaOriginal = String(linhas[0].moeda || "").toUpperCase();
  let original = 0;
  let convertidoTotal = 0;
  let convertido = true;
  let aproximado = false;
  for (const l of linhas) {
    const valor = paraNumero(l.gasto);
    original += valor;
    if (!convertido) continue;
    const c = converter(valor, l.moeda, moeda, String(l.data).slice(0, 10));
    if (!c) {
      convertido = false;
      continue;
    }
    convertidoTotal += c.valor;
    if (c.aproximado) aproximado = true;
  }
  return {
    valor: convertido ? convertidoTotal : original,
    original,
    moedaOriginal,
    convertido,
    aproximado: convertido && aproximado,
  };
}

/**
 * Gasto de cada conta: hoje (no fuso dela) e no periodo do relatorio.
 * Conta sem nenhuma linha sai com hoje e periodo null.
 */
export function somarGastoPorConta(
  linhas: LinhaGastoConta[],
  opcoes: {
    contaIds: string[];
    /** contaId -> "hoje" no fuso da conta. */
    hojePorConta: Record<string, string>;
    intervalo: Intervalo;
    /** Moeda do relatorio (barra do topo). */
    moeda: string;
    converter: Conversor;
  }
): Map<string, GastoDaConta> {
  const porConta = new Map<string, LinhaGastoConta[]>();
  for (const l of linhas) {
    const id = String(l.ad_account_id);
    const lista = porConta.get(id) ?? [];
    lista.push({ ...l, data: String(l.data).slice(0, 10) });
    porConta.set(id, lista);
  }

  const diasNoPeriodo = diasEntre(opcoes.intervalo);
  const saida = new Map<string, GastoDaConta>();
  for (const id of opcoes.contaIds) {
    const lista = porConta.get(id) ?? [];
    const hoje = opcoes.hojePorConta[id];
    const doHoje = hoje ? lista.filter((l) => l.data === hoje) : [];
    const doPeriodo = lista.filter((l) => dentro(l.data, opcoes.intervalo));
    const dias = new Set(doPeriodo.map((l) => l.data));
    const primeiroDia = doPeriodo.length > 0 ? [...dias].sort()[0] : null;
    saida.set(id, {
      hoje: somar(doHoje, opcoes.moeda, opcoes.converter),
      periodo: somar(doPeriodo, opcoes.moeda, opcoes.converter),
      diasComDado: dias.size,
      diasNoPeriodo,
      primeiroDia,
    });
  }
  return saida;
}

/** O intervalo de datas que a consulta precisa cobrir: o periodo e todo "hoje". */
export function janelaDaConsulta(intervalo: Intervalo, hojes: string[]): Intervalo {
  let desde = intervalo.desde;
  let ate = intervalo.ate;
  for (const h of hojes) {
    if (h < desde) desde = h;
    if (h > ate) ate = h;
  }
  return { desde, ate };
}
