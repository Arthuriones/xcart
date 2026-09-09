/**
 * O vocabulario de estado de uma loja de checkout dentro de uma rota.
 *
 * Fica em modulo proprio -- e nao dentro do componente que desenha a lista --
 * porque a tela de roteamento, a de vendas e a de lojas precisam classificar
 * a mesma loja do mesmo jeito. Quando isso morava junto do desenho, cada tela
 * reimplementava a regra e elas divergiam.
 */

export interface StripTarget {
  id: string;
  name: string;
  domain: string;
  enabled: boolean;
  weight: number;
  sharePercent: number;
  mappedSkuCount: number;
}

export type TargetState = "ok" | "paused" | "attention";

export function targetState(alvo: StripTarget): TargetState {
  // Ligada e sem nenhum produto ligado e o caso silencioso: mesmo em 0% ela
  // esta configurada errado, e basta alguem dar fatia para os carrinhos
  // comecarem a falhar. Vale o aviso antes disso acontecer.
  if (alvo.enabled && alvo.mappedSkuCount === 0) return "attention";
  return alvo.enabled && alvo.weight > 0 ? "ok" : "paused";
}

export const COR_ALVO: Record<TargetState, string> = {
  ok: "var(--ok)",
  paused: "var(--t4)",
  attention: "var(--warn)",
};

export const TEXTO_ALVO: Record<TargetState, string> = {
  ok: "Ativa",
  paused: "Pausada",
  attention: "Atenção",
};

// ---------------------------------------------------------------- cobertura

/**
 * Depois de quantas horas sem conferir o mapa deixa de merecer confianca.
 *
 * O auto-conserto passa de hora em hora e pega 4 rotas por vez, entao uma
 * conta com 16 destinos fecha o ciclo em ~4 h. 24 h da folga de sobra: se
 * passou disso, ou o cron nao esta rodando ou a rota esta falhando -- nos dois
 * casos o lojista precisa saber.
 */
export const HORAS_ATE_MAPA_VELHO = 24;

export interface MapaVelho {
  /** Ha quantas horas foi a conferida mais antiga entre os destinos ligados. */
  horas: number;
  /** true quando algum destino ligado nunca foi conferido. */
  nunca: boolean;
}

/**
 * Diz se o mapa de SKU da rota esta velho o bastante para estar deixando
 * produto de fora.
 *
 * O mapa nao se atualiza sozinho quando o lojista cadastra produto novo na
 * vitrine: ele so cresce quando o conserto roda e casa os SKUs das duas lojas.
 * Ate la o produto novo existe na vitrine, entra no carrinho e NAO tem par no
 * checkout -- o comprador sai pelo checkout da propria vitrine, que nao cobra.
 *
 * Nao da para saber aqui quantos produtos ficaram de fora sem paginar as duas
 * lojas (o /health faz isso, e demora). O que da para saber de graca e ha
 * quanto tempo ninguem confere -- e esse e o aviso honesto: "produto criado
 * depois disto nao esta sendo roteado".
 *
 * Olha o destino ligado MAIS ANTIGO, nao o mais recente: cada destino tem seu
 * proprio mapa, entao basta um estar velho para os carrinhos que caem nele
 * perderem linha.
 */
export function mapaVelho(
  alvos: { enabled: boolean; lastHealedAt: string | null }[],
  agora: number = Date.now()
): MapaVelho | null {
  const ligados = alvos.filter((a) => a.enabled);
  if (ligados.length === 0) return null;

  const nunca = ligados.some((a) => !a.lastHealedAt);
  const horas = ligados
    .filter((a) => a.lastHealedAt)
    .map((a) => (agora - new Date(a.lastHealedAt as string).getTime()) / 3_600_000)
    .reduce((maior, h) => Math.max(maior, h), 0);

  if (nunca) return { horas, nunca: true };
  if (horas >= HORAS_ATE_MAPA_VELHO) return { horas, nunca: false };
  return null;
}
