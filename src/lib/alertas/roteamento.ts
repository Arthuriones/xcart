import {
  consertoFalhando,
  FALHAS_PARA_ALERTAR,
  ladoDaFalha,
  motivoForaDoAr,
  vitrineForaNoConserto,
  type UltimoConserto,
} from "@/lib/checkout-routes/ultimo-conserto";
import type { LadoDaRota, MotivoForaDoAr } from "@/lib/checkout-routes/loja-fora-do-ar";

// ============================================================================
// Regras de alerta do roteamento, puras (o avaliar.ts le o banco e monta a
// condicao). So rota LIGADA com alguma loja de checkout recebendo comprador:
// rota pausada ou com todas as lojas pausadas nao tem trafego a perder, e o
// console ja mostra esse estado.
//
//   script sumiu      -- a vitrine mandava "loader_ready" e parou. Sem o
//                        script, todo comprador cai no checkout da vitrine,
//                        que nao cobra.
//   caindo na vitrine -- checkouts criados NA vitrine (webhook
//                        checkouts/create, ver sensor.ts).
//   conserto falhando -- uma loja de checkout recebendo com last_heal
//                        ok=false em 3 passadas seguidas, por falha COMUM.
//   loja fora do ar   -- pausada pela Shopify, sem o app (credencial
//                        revogada) ou fechada: o lojista precisa agir, entao
//                        abre na PRIMEIRA passada, sem contador. Um alerta
//                        por rota; nao reabre nem conta a cada passada -- o
//                        cron nem tenta a loja de novo antes de 12 h.
//   vitrine com senha -- aviso, uma vez: pode ser de proposito (loja ainda
//                        nao lancada), e o aviso nao renotifica.
// ============================================================================

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Silencio que acende o alerta. */
export const SCRIPT_SILENCIO_MS = 6 * HORA;
/** Quantos dias anteriores a mesma janela de 6 h precisa ter tido sinal. */
export const SCRIPT_DIAS_DE_COMPARACAO = 2;
/**
 * Sinais minimos na MESMA janela de 6 h de cada um desses dias. A visita nao
 * e uniforme: vitrine com 12 a 30 visitas por dia passa 6 h sem ninguem de
 * madrugada quase toda noite, e um minimo sobre as 72 h inteiras alertava por
 * falta de comprador, nao de script. Comparando com o mesmo horario, o silencio
 * so conta quando esse horario costuma ter gente (5 esperados: a chance de
 * zero por acaso fica abaixo de 1%).
 */
export const SCRIPT_MIN_SINAIS_NA_JANELA = 5;
/** Escapes nas ultimas 24 h para virar alerta (o dono testando nao conta). */
export const ESCAPES_MIN_24H = 3;

/** As mesmas 6 h de ontem e anteontem, do mais recente ao mais antigo. */
export function janelasDeComparacao(agora: number): { de: number; ate: number }[] {
  return Array.from({ length: SCRIPT_DIAS_DE_COMPARACAO }, (_, i) => {
    const ate = agora - (i + 1) * DIA;
    return { de: ate - SCRIPT_SILENCIO_MS, ate };
  });
}

/**
 * Vale contar as janelas? So com o silencio ja passando de 6 h e o ultimo
 * sinal dentro da janela de ontem ou depois: mais velho que isso, a de ontem
 * esta vazia e a conta daria nao de qualquer jeito.
 */
export function valeContarJanelas(ultimoSinal: string | null, agora: number): boolean {
  const t = ultimoSinal ? Date.parse(ultimoSinal) : NaN;
  if (!Number.isFinite(t)) return false;
  const silencio = agora - t;
  return silencio >= SCRIPT_SILENCIO_MS && silencio < DIA + SCRIPT_SILENCIO_MS;
}

/**
 * O script sumiu? Abre quando nada chegou nas ultimas 6 h e as mesmas 6 h de
 * ontem e anteontem tiveram sinal de sobra. Aberto, continua ate o sinal
 * voltar, por mais velho que o ultimo fique -- igual ao "rastreamento parado".
 * `mesmasJanelas`: sinais em cada janela de janelasDeComparacao; null = nao
 * contado (falha ou nao valia contar).
 */
export function scriptSumiu(
  p: { ultimoSinal: string | null; mesmasJanelas: readonly (number | null)[]; aberto: boolean },
  agora: number
): boolean {
  const t = p.ultimoSinal ? Date.parse(p.ultimoSinal) : NaN;
  if (Number.isFinite(t) && agora - t < SCRIPT_SILENCIO_MS) return false;
  if (p.aberto) return true;
  if (!Number.isFinite(t)) return false;
  return (
    p.mesmasJanelas.length >= SCRIPT_DIAS_DE_COMPARACAO &&
    p.mesmasJanelas.every((n) => n !== null && n >= SCRIPT_MIN_SINAIS_NA_JANELA)
  );
}

export function escapesDemais(n: number): boolean {
  return n >= ESCAPES_MIN_24H;
}

/** O destino recebe comprador: ligado e com peso (sem peso gravado = 1). */
function recebe(d: { enabled: boolean | null; weight: number | null }): boolean {
  return d.enabled !== false && (d.weight ?? 1) > 0;
}

/** Ha loja de checkout recebendo: sem linha de destino (rota antiga) conta como sim. */
export function rotaRecebendo(destinos: readonly { enabled: boolean | null; weight: number | null }[]): boolean {
  if (destinos.length === 0) return true;
  return destinos.some(recebe);
}

/**
 * A vitrine esta fora (app removido, loja pausada): o script "sumir" ai e
 * consequencia, e o alerta certo e o do conserto, que diz o motivo. Loja de
 * CHECKOUT fora nao conta: a vitrine segue no ar e o script dela tem que
 * estar la. `ultimoConserto` e o da rota -- a ultima passada, de qualquer
 * destino, sempre confere a vitrine primeiro.
 */
export function vitrineFora(p: { desinstalada: boolean; ultimoConserto: UltimoConserto | null }): boolean {
  return p.desinstalada || vitrineForaNoConserto(p.ultimoConserto);
}

export interface DestinoNoAlerta {
  enabled: boolean | null;
  weight: number | null;
  nome: string | null;
  ultimoConserto: UltimoConserto | null;
}

/**
 * O destino recebendo comprador com o conserto falhando (falha comum, ver
 * consertoFalhando): o de mais falhas seguidas. As falhas sao POR DESTINO --
 * com rodizio, o contador da rota ia 0,1,0,1 entre a loja boa e a quebrada e
 * o alerta nunca abria, com o comprador sorteado para a quebrada caindo num
 * checkout morto. Rota antiga sem linha de destino usa o last_heal da rota.
 */
export function consertoFalhandoNaRota(
  destinos: readonly DestinoNoAlerta[],
  daRota: UltimoConserto | null
): { conserto: UltimoConserto; nome: string | null } | null {
  const candidatos =
    destinos.length === 0
      ? [{ conserto: daRota, nome: null }]
      : destinos.filter(recebe).map((d) => ({ conserto: d.ultimoConserto, nome: d.nome }));
  let pior: { conserto: UltimoConserto; nome: string | null } | null = null;
  const peso = (u: UltimoConserto) => u.falhas ?? FALHAS_PARA_ALERTAR;
  for (const c of candidatos) {
    if (!c.conserto || !consertoFalhando(c.conserto)) continue;
    if (!pior || peso(c.conserto) > peso(pior.conserto)) pior = { conserto: c.conserto, nome: c.nome };
  }
  return pior;
}

export { consertoFalhando };

export interface LojaForaNaRota {
  conserto: UltimoConserto;
  motivo: MotivoForaDoAr;
  lado: LadoDaRota | undefined;
  /** A loja de checkout (null = a vitrine, ou rota antiga sem destino). */
  nome: string | null;
}

function foraDe(conserto: UltimoConserto | null, nome: string | null): LojaForaNaRota | null {
  const motivo = motivoForaDoAr(conserto);
  if (!conserto || !motivo) return null;
  return { conserto, motivo, lado: ladoDaFalha(conserto), nome };
}

/**
 * As lojas da rota que a ultima passada achou fora do ar, a vitrine primeiro.
 *
 * Vitrine: pelo last_heal da ROTA. A vitrine e a mesma para todo destino e
 * toda passada a confere primeiro, entao a ultima passada (de qualquer
 * destino) e quem sabe se ela voltou -- o last_heal de um destino que ainda
 * espera as 12 h dele diria "vitrine fora" depois de ela voltar.
 * Loja de checkout: pelo last_heal de cada destino recebendo comprador (peso
 * 0 ou pausado nao recebe; o lojista pode ter tirado justamente por isso).
 * Rota antiga sem linha de destino: o da rota, de qualquer lado.
 */
export function lojasForaDoArNaRota(
  destinos: readonly DestinoNoAlerta[],
  daRota: UltimoConserto | null
): LojaForaNaRota[] {
  if (destinos.length === 0) {
    const f = foraDe(daRota, null);
    return f ? [f] : [];
  }
  const fora: LojaForaNaRota[] = [];
  const vitrine = foraDe(daRota, null);
  if (vitrine && vitrine.lado === "vitrine") fora.push(vitrine);
  for (const d of destinos.filter(recebe)) {
    const f = foraDe(d.ultimoConserto, d.nome);
    if (f && f.lado !== "vitrine") fora.push(f);
  }
  return fora;
}

/** O titulo do alerta de loja fora do ar. */
export function tituloLojaForaDoAr(motivo: MotivoForaDoAr): string {
  switch (motivo) {
    case "sem_app":
      return "Rota sem acesso a uma das lojas";
    case "loja_pausada":
      return "Loja da rota pausada pela Shopify";
    case "loja_fechada":
      return "Loja da rota fechada na Shopify";
    case "vitrine_fechada":
      return "Vitrine da rota com senha";
  }
}

/** "7 h", "3 dias". */
export function haQuanto(iso: string | null, agora: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "mais de 3 dias";
  const horas = Math.max(1, Math.floor((agora - t) / HORA));
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} dias`;
}
