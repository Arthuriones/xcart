import {
  consertoFalhando,
  credencialRevogada,
  lojaForaNoConserto,
  type UltimoConserto,
} from "@/lib/checkout-routes/ultimo-conserto";

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
//   conserto falhando -- last_heal ok=false em passadas seguidas, ou loja sem
//                        acesso (nao melhora sozinho).
// ============================================================================

const HORA = 3_600_000;

/** O script precisa ter dado sinal nesta janela para "sumir" contar. */
export const SCRIPT_JANELA_MS = 72 * HORA;
/** Silencio que acende o alerta. */
export const SCRIPT_SILENCIO_MS = 6 * HORA;
/**
 * Sinais nas 72 h para valer: ~3 esperados em 6 h. Vitrine com menos visita
 * que isso fica 6 h sem ninguem abrir produto de madrugada, e o alerta
 * acenderia por falta de comprador, nao de script.
 */
export const SCRIPT_MIN_SINAIS_72H = 36;
/** Escapes nas ultimas 24 h para virar alerta (o dono testando nao conta). */
export const ESCAPES_MIN_24H = 3;

/**
 * O script sumiu? Abre so quando houve sinal nas 72 h (com volume) e nenhum
 * nas ultimas 6 h. Aberto, continua ate o sinal voltar, por mais velho que o
 * ultimo fique -- igual ao "rastreamento parado".
 */
export function scriptSumiu(
  p: { ultimoSinal: string | null; sinais72h: number; aberto: boolean },
  agora: number
): boolean {
  const t = p.ultimoSinal ? Date.parse(p.ultimoSinal) : NaN;
  if (Number.isFinite(t) && agora - t < SCRIPT_SILENCIO_MS) return false;
  if (p.aberto) return true;
  if (!Number.isFinite(t) || agora - t >= SCRIPT_JANELA_MS) return false;
  return p.sinais72h >= SCRIPT_MIN_SINAIS_72H;
}

export function escapesDemais(n: number): boolean {
  return n >= ESCAPES_MIN_24H;
}

/** Ha loja de checkout recebendo: sem linha de destino (rota antiga) conta como sim. */
export function rotaRecebendo(destinos: readonly { enabled: boolean | null; weight: number | null }[]): boolean {
  if (destinos.length === 0) return true;
  return destinos.some((d) => d.enabled !== false && (d.weight ?? 1) > 0);
}

/**
 * A vitrine esta fora (app removido, loja pausada): o script "sumir" ai e
 * consequencia, e o alerta certo e o do conserto, que diz o motivo.
 */
export function vitrineFora(p: { desinstalada: boolean; ultimoConserto: UltimoConserto | null }): boolean {
  return p.desinstalada || lojaForaNoConserto(p.ultimoConserto);
}

export { consertoFalhando, credencialRevogada };

/** "7 h", "3 dias". */
export function haQuanto(iso: string | null, agora: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "mais de 3 dias";
  const horas = Math.max(1, Math.floor((agora - t) / HORA));
  return horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} dias`;
}
