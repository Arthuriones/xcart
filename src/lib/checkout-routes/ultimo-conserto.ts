// ============================================================================
// O resultado da ultima passada do conserto (settings.last_heal). Puro:
// heal.ts grava, o cron de alertas e a tela leem. E o UNICO formato do
// last_heal; loja-fora-do-ar.ts so da o vocabulario (motivo, lado, espera do
// cron) que entra nele. Fica em dois lugares:
//
//   routed_checkout_targets.settings.last_heal -- por LOJA DE CHECKOUT. E o
//     que o alerta le: o cron conserta um destino por vez, e com rodizio um
//     destino quebrado alternava com outro bom -- o contador da rota ia
//     0,1,0,1 e o "3 seguidas" nunca abria. Leva tambem a conferencia dos
//     pares (UltimoConsertoDoDestino).
//   routed_checkout_configs.settings.last_heal -- a ultima passada da rota,
//     de qualquer destino. E o que o card mostra, e o unico que existe em rota
//     antiga sem linha de destino.
//
// `falhas` conta as passadas SEGUIDAS com ok=false. Sem ele, "falhou 3 vezes
// seguidas" nao existia -- o last_heal so guarda a ultima, e uma falha solta
// (Shopify lenta numa passada) nao e o mesmo que uma rota que nao conserta ha
// um dia.
// ============================================================================

import type { ConferenciaDosPares } from "@/lib/checkout-routes/conserto-regras";
import {
  ehMotivoForaDoAr,
  motivoDaSaude,
  type ForaDoAr,
  type LadoDaRota,
  type MotivoForaDoAr,
} from "@/lib/checkout-routes/loja-fora-do-ar";
import type { MotivoLojaOffline } from "@/lib/shopify/store-health";

/**
 * `motivo`/`lado`/`proximaTentativa` (ForaDoAr) so quando a loja nao esta no
 * ar para o app (pausada, sem app, vitrine com senha, fechada): o motivo
 * tipado para a tela e o alerta, de qual lado e quando o cron volta a tentar.
 * `lado` sozinho (sem motivo) = falha comum, mas se sabe de que loja veio.
 */
export interface UltimoConserto extends Partial<ForaDoAr> {
  at: string;
  ok: boolean;
  /** Motivo curto quando ok=false, pronto para o card. */
  message?: string;
  mappedCount?: number;
  /** Passadas seguidas com ok=false, contando esta. 0 quando ok. */
  falhas?: number;
}

/**
 * O mesmo, por loja de checkout, em routed_checkout_targets.settings.last_heal.
 * O da rota (routed_checkout_configs.settings.last_heal) e da ultima passada
 * de QUALQUER destino; com rodizio, so este diz o estado de cada loja. Rota
 * antiga sem linha de destino guarda a conferencia no da rota.
 */
export interface UltimoConsertoDoDestino extends UltimoConserto {
  conferencia?: ConferenciaDosPares;
}

/** Passadas seguidas com falha para virar alerta. */
export const FALHAS_PARA_ALERTAR = 3;

/**
 * O motivo gravado, tipado. Aceita tambem o motivo cru do store-health
 * ("congelada", "sem_acesso"...), que o sensor gravava antes do vocabulario
 * de loja-fora-do-ar.ts.
 */
function lerMotivo(valor: unknown): MotivoForaDoAr | undefined {
  if (ehMotivoForaDoAr(valor)) return valor;
  if (typeof valor !== "string") return undefined;
  return motivoDaSaude(valor as MotivoLojaOffline) ?? undefined;
}

export function lerUltimoConserto(settings: unknown): UltimoConserto | null {
  if (!settings || typeof settings !== "object") return null;
  const v = (settings as Record<string, unknown>).last_heal;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || typeof o.ok !== "boolean") return null;
  const motivo = lerMotivo(o.motivo);
  return {
    at: o.at,
    ok: o.ok,
    ...(typeof o.message === "string" ? { message: o.message } : {}),
    ...(typeof o.mappedCount === "number" ? { mappedCount: o.mappedCount } : {}),
    ...(typeof o.falhas === "number" && Number.isFinite(o.falhas) ? { falhas: o.falhas } : {}),
    ...(motivo ? { motivo } : {}),
    ...(o.lado === "vitrine" || o.lado === "checkout" ? { lado: o.lado } : {}),
    ...(typeof o.proximaTentativa === "string" ? { proximaTentativa: o.proximaTentativa } : {}),
  };
}

/**
 * O last_heal desta passada, com a contagem de falhas seguidas.
 * Registro anterior sem `falhas` (gravado antes do contador) e com ok=false
 * conta como uma. O registro novo substitui o anterior inteiro: a passada boa
 * apaga o motivo e a espera da loja fora do ar.
 */
export function proximoUltimoConserto<T extends Omit<UltimoConserto, "falhas">>(
  anterior: UltimoConserto | null,
  novo: T
): T & { falhas: number } {
  if (novo.ok) return { ...novo, falhas: 0 };
  const antes = anterior
    ? typeof anterior.falhas === "number"
      ? anterior.falhas
      : anterior.ok
        ? 0
        : 1
    : 0;
  return { ...novo, falhas: antes + 1 };
}

/**
 * O motivo de loja fora a partir da mensagem, para os erros que sobem sem
 * motivo tipado (registrarFalhaDoConserto) e para registro antigo sem
 * `motivo`. As frases sao as de store-health.ts e de mensagemForaDoAr.
 */
export function motivoDaFalha(mensagem: string | null | undefined): MotivoForaDoAr | undefined {
  const m = String(mensagem || "");
  if (
    /app foi removido|nao esta mais instalado|não está mais instalado|app removido ou credencial revogada/i.test(m)
  ) {
    return "sem_app";
  }
  if (/credenciais dessa loja foram revogadas/i.test(m)) return "sem_app";
  if (/pausada ou sem plano/i.test(m)) return "loja_pausada";
  if (/nao existe mais na shopify|não existe mais na shopify/i.test(m)) return "loja_fechada";
  if (/est[aá] com senha/i.test(m)) return "vitrine_fechada";
  return undefined;
}

function motivoDe(u: UltimoConserto): MotivoForaDoAr | undefined {
  return u.motivo || motivoDaFalha(u.message);
}

/**
 * Por que a ultima passada parou numa loja fora do ar (pausada, sem app,
 * vitrine com senha, fechada); undefined = passou, ou foi falha comum.
 */
export function motivoForaDoAr(u: UltimoConserto | null): MotivoForaDoAr | undefined {
  if (!u || u.ok) return undefined;
  return motivoDe(u);
}

/** A ultima passada parou porque uma das lojas nao esta no ar para o app. */
export function lojaForaNoConserto(u: UltimoConserto | null): boolean {
  return Boolean(motivoForaDoAr(u));
}

/**
 * De que lado veio a falha. Registro sem `lado` (antigo) sai pelo comeco da
 * mensagem do verificarParDaRota ("Loja vitrine (...)" / "Loja de checkout
 * (...)") ou do mensagemForaDoAr ("A vitrine ..." / "A loja de checkout
 * ..."); sem isso, nao se sabe.
 */
export function ladoDaFalha(u: UltimoConserto | null): LadoDaRota | undefined {
  if (!u || u.ok) return undefined;
  if (u.lado) return u.lado;
  const m = String(u.message || "");
  if (/^Loja vitrine \(|^A vitrine /.test(m)) return "vitrine";
  if (/^Loja de checkout \(|^A loja de checkout /.test(m)) return "checkout";
  return undefined;
}

/** A VITRINE nao esta no ar para o app (checkout fora nao conta). */
export function vitrineForaNoConserto(u: UltimoConserto | null): boolean {
  return lojaForaNoConserto(u) && ladoDaFalha(u) === "vitrine";
}

/** App removido ou credencial recusada: nao melhora sozinho. */
export function credencialRevogada(u: UltimoConserto | null): boolean {
  return motivoForaDoAr(u) === "sem_app";
}

/**
 * Falha COMUM em passadas seguidas (produto que nao cria, Shopify errando):
 * o "Conserto da rota falhando". Loja fora do ar nao entra aqui: ela tem o
 * alerta proprio, aberto na primeira passada (alertas/roteamento.ts). O
 * contador dela andaria 1 a cada 12 h (a espera do cron), o "3 seguidas"
 * levaria um dia e meio e o alerta nao diria o que fazer.
 */
export function consertoFalhando(u: UltimoConserto | null): boolean {
  if (!u || u.ok || lojaForaNoConserto(u)) return false;
  return (u.falhas ?? 1) >= FALHAS_PARA_ALERTAR;
}
