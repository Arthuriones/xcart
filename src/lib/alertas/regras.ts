import type { AlertaRow, RegraAlerta, SeveridadeAlerta } from "@/lib/financeiro/tipos";

// ============================================================================
// Alertas: o que abrir, confirmar, fechar e avisar. Puro, sem banco.
//
// O cron roda a cada 10 min e reavalia TUDO do zero: cada execucao produz a
// lista de condicoes ativas agora, e este arquivo compara com os alertas
// abertos no banco. Assim o estado mora num lugar so (a tabela `alertas`) e o
// cron pode cair, repetir ou rodar duas vezes ao mesmo tempo sem duplicar nada
// -- o indice unico parcial da 052 segura a abertura dupla.
//
// ANTI-SPAM
//
// - abre uma vez: condicao que continua ativa so CONFIRMA o aberto;
// - critico renotifica a cada 6 h, aviso nunca (so na abertura);
// - silenciar bloqueia a renotificacao ate a hora marcada;
// - fecha so depois de 2 avaliacoes seguidas sem o problema (histerese): uma
//   leitura que oscila -- sync que atrasou 1 min -- nao vira abre/fecha/abre
//   no Telegram do lojista.
// ============================================================================

export interface CondicaoAlerta {
  user_id: string;
  store_id: string | null;
  regra: RegraAlerta;
  /** Distingue dois alertas da mesma regra na mesma loja (ex.: id da conta). */
  chave: string;
  severidade: SeveridadeAlerta;
  titulo: string;
  detalhe: string | null;
}

export const RENOTIFICAR_CRITICO_MS = 6 * 3600 * 1000;
export const FALSOS_PARA_RESOLVER = 2;

/** Teto da mensagem: o Telegram aceita 4096; a sobra cabe o "… e mais N". */
export const LIMITE_MENSAGEM = 4000;

/**
 * Identidade do alerta, igual a do indice unico da 052. Loja nula vira "-":
 * sem isso, o alerta da conta inteira e o de uma loja colidiriam.
 */
export function chaveDoAlerta(x: { store_id: string | null; regra: string; chave: string }): string {
  return (x.store_id ?? "-") + "|" + x.regra + "|" + x.chave;
}

export interface PlanoAlertas {
  abrir: CondicaoAlerta[];
  notificarAbertura: CondicaoAlerta[];
  confirmar: { id: string; titulo: string; detalhe: string | null }[];
  contarFalso: { id: string; falsos: number }[];
  resolver: AlertaRow[];
  renotificar: AlertaRow[];
}

function silenciado(a: AlertaRow, agora: Date): boolean {
  return !!a.silenciado_ate && Date.parse(a.silenciado_ate) > agora.getTime();
}

function deveRenotificar(
  aberto: AlertaRow,
  ativa: CondicaoAlerta,
  agora: Date,
  cfg: { receberAvisos: boolean }
): boolean {
  if (silenciado(aberto, agora)) return false;

  if (ativa.severidade === "critico") {
    if (!aberto.notificado_em) return true;
    return agora.getTime() - Date.parse(aberto.notificado_em) >= RENOTIFICAR_CRITICO_MS;
  }

  // Aviso: so a mensagem de abertura. A unica excecao e a abertura que NUNCA
  // chegou (Telegram fora do ar, token errado): ela tenta de novo, senao o
  // aviso se perderia de vez. Depois de entregue, nunca mais.
  return (
    cfg.receberAvisos && !aberto.notificado_em && (Number(aberto.n_notificacoes) || 0) === 0
  );
}

/**
 * Plano de UM usuario: `abertos` e `ativas` ja filtrados por ele.
 *
 * Quem chama tira de `abertos` os alertas de regra que falhou nesta execucao:
 * regra que nao rodou nao e "problema resolvido", e contar falso ali fecharia
 * alerta verdadeiro.
 */
export function planejar(
  abertos: AlertaRow[],
  ativas: CondicaoAlerta[],
  agora: Date,
  cfg: { receberAvisos: boolean }
): PlanoAlertas {
  const plano: PlanoAlertas = {
    abrir: [],
    notificarAbertura: [],
    confirmar: [],
    contarFalso: [],
    resolver: [],
    renotificar: [],
  };

  // Mesma chave duas vezes (duas leituras da mesma regra) = uma condicao so;
  // critico vence aviso.
  const ativasPorChave = new Map<string, CondicaoAlerta>();
  for (const c of ativas) {
    const k = chaveDoAlerta(c);
    const ja = ativasPorChave.get(k);
    if (!ja || (ja.severidade === "aviso" && c.severidade === "critico")) {
      ativasPorChave.set(k, c);
    }
  }

  const abertosPorChave = new Map<string, AlertaRow>();
  for (const a of abertos) abertosPorChave.set(chaveDoAlerta(a), a);

  for (const [k, c] of ativasPorChave) {
    const aberto = abertosPorChave.get(k);
    if (!aberto) {
      plano.abrir.push(c);
      if (c.severidade === "critico" || cfg.receberAvisos) plano.notificarAbertura.push(c);
      continue;
    }
    plano.confirmar.push({ id: aberto.id, titulo: c.titulo, detalhe: c.detalhe });
    if (deveRenotificar(aberto, c, agora, cfg)) plano.renotificar.push(aberto);
  }

  for (const [k, a] of abertosPorChave) {
    if (ativasPorChave.has(k)) continue;
    const falsos = (Number(a.falsos_seguidos) || 0) + 1;
    if (falsos >= FALSOS_PARA_RESOLVER) plano.resolver.push(a);
    else plano.contarFalso.push({ id: a.id, falsos });
  }

  return plano;
}

function linhaDeAlerta(
  x: { severidade: SeveridadeAlerta; titulo: string; detalhe: string | null; store_id: string | null },
  nomeDaLoja: (id: string | null) => string
): string {
  const marca = x.severidade === "critico" ? "[CRITICO]" : "[AVISO]";
  const detalhe = x.detalhe ? `: ${x.detalhe}` : "";
  return `${marca} ${x.titulo} — ${nomeDaLoja(x.store_id)}${detalhe}`;
}

/**
 * Uma mensagem por execucao e por chat. Texto puro, sem parse_mode: titulo e
 * detalhe trazem erro de API cru, e um `_` ou `*` solto ali faria o Telegram
 * recusar a mensagem inteira em Markdown.
 */
export function montarMensagem(p: {
  novos: CondicaoAlerta[];
  renotificar: AlertaRow[];
  resolvidos: AlertaRow[];
  nomeDaLoja: (id: string | null) => string;
}): { texto: string; silenciosa: boolean } | null {
  const alertas = [
    ...p.novos.map((c) => ({ ...c })),
    ...p.renotificar.map((a) => ({
      severidade: a.severidade,
      titulo: a.titulo,
      detalhe: a.detalhe,
      store_id: a.store_id,
    })),
  ];
  // Critico primeiro: se a mensagem for cortada, o corte cai nos avisos.
  alertas.sort((a, b) =>
    a.severidade === b.severidade ? 0 : a.severidade === "critico" ? -1 : 1
  );

  if (alertas.length === 0 && p.resolvidos.length === 0) return null;

  const cabecalho =
    alertas.length > 0
      ? `xcart — ${alertas.length} ${alertas.length === 1 ? "alerta" : "alertas"}`
      : `xcart — ${p.resolvidos.length} ${p.resolvidos.length === 1 ? "resolvido" : "resolvidos"}`;

  const linhas = [
    ...alertas.map((a) => linhaDeAlerta(a, p.nomeDaLoja)),
    ...p.resolvidos.map((r) => `Resolvido: ${r.titulo} — ${p.nomeDaLoja(r.store_id)}`),
  ];

  // Reserva para "\n… e mais 9999".
  const RESERVA = 20;
  let texto = cabecalho;
  let usadas = 0;
  for (const linha of linhas) {
    const proxima = `${texto}\n${linha}`;
    const sobra = usadas + 1 < linhas.length ? RESERVA : 0;
    if (proxima.length + sobra > LIMITE_MENSAGEM) break;
    texto = proxima;
    usadas += 1;
  }
  if (usadas < linhas.length) {
    texto = `${texto}\n… e mais ${linhas.length - usadas}`.slice(0, LIMITE_MENSAGEM);
  }

  return { texto, silenciosa: alertas.length === 0 };
}
