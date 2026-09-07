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
