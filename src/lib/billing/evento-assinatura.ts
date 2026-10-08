import { ehPlanoId, planoDoValor, type PlanoId } from "@/lib/billing/plans";

// ============================================================================
// O que um aviso (webhook ou sincronizacao) de uma assinatura de cartao da
// Pagou pode mudar no perfil. Pura -- testada em
// tests/billing-evento-assinatura.test.ts.
//
// O perfil guarda UMA assinatura (pagou_subscription_id). Avisos de outra
// assinatura do mesmo usuario existem: a tentativa que ficou parada no 3DS e
// foi trocada por outra, o cartao antigo de quem passou a pagar por Pix. Antes,
// qualquer aviso com o user_id no metadata sobrescrevia o perfil -- o cancelamento
// da tentativa abandonada tirava o acesso de quem pagava a nova.
// ============================================================================

/** Status em que a assinatura ainda vale (planoDoStatus = "pro"). */
const VIVA = new Set(["active", "trialing", "past_due", "cancel_scheduled"]);
/** Status de quem esta pagando agora. */
const PAGANDO = new Set(["active", "trialing"]);

export interface PerfilDoAviso {
  pagou_subscription_id: string | null;
  subscription_status: string | null;
  /** profiles.plano. Ausente = coluna ainda nao existe (064 pendente). */
  plano?: string | null;
}

export interface AvisoDeAssinatura {
  id: string;
  status: string;
  amount: number | null | undefined;
}

export interface DecisaoDoAviso {
  aplicar: boolean;
  /** Tier a gravar. null = nao mexe no tier. */
  plano: PlanoId | null;
  /** Por que nao aplicou (vai para o log). */
  motivo: string | null;
}

export function decidirAviso(perfil: PerfilDoAviso, sub: AvisoDeAssinatura): DecisaoDoAviso {
  const mesma = perfil.pagou_subscription_id === sub.id;

  if (!mesma) {
    // Assinatura que o perfil nao conhece so entra se esta pagando agora e a do
    // perfil nao vale mais. Cobre a gravacao do /subscribe que se perdeu.
    if (!PAGANDO.has(sub.status)) {
      return { aplicar: false, plano: null, motivo: "outra assinatura, que nao esta pagando" };
    }
    const atualViva =
      !!perfil.pagou_subscription_id && VIVA.has(String(perfil.subscription_status ?? ""));
    if (atualViva) {
      return { aplicar: false, plano: null, motivo: "duas assinaturas vivas na mesma conta" };
    }
  }

  // O tier sai do VALOR cobrado, mas so quando a assinatura e nova para o
  // perfil ou o perfil ainda nao tem tier. Sobre a mesma assinatura com tier
  // gravado, quem manda e o perfil: o suporte pode ter mudado o plano, e o
  // proximo aviso nao desfaz. Valor fora do catalogo (o R$ 89 antigo) nunca
  // grava nada.
  const tier = planoDoValor(sub.amount);
  const grava = !mesma || !ehPlanoId(perfil.plano);
  return { aplicar: true, plano: grava ? tier : null, motivo: null };
}
