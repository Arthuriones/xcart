import { createAdminClient } from "@/lib/supabase/admin";
import { proDaAbacateVencido } from "@/lib/billing/abacatepay-regras";

// Trava de acesso. Enquanto false (default), todo mundo entra (comportamento
// atual). Ligar so depois de liberar os usuarios certos no painel admin.
export function accessControlEnabled(): boolean {
  return process.env.ACCESS_CONTROL_ENABLED === "true";
}

interface AccessProfile {
  is_admin?: boolean | null;
  plan?: string | null;
  access_granted?: boolean | null;
  free_clone_store_id?: string | null;
  // Usados so para expirar quem pagou Pro por Pix avulso.
  payment_provider?: string | null;
  pagou_subscription_id?: string | null;
  abacatepay_subscription_id?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
}

// Pro pago por Pix nao renova sozinho: nao ha assinatura na Pagou, so uma
// cobranca que concedeu 30 dias. Se o prazo venceu, o plano no banco ainda diz
// "pro" ate a faxina rodar — entao a validade e conferida aqui, na porta.
//
// A checagem NAO vale para assinatura de cartao: ali o current_period_end so
// avanca quando o webhook chega, e um atraso da Pagou tiraria o acesso de quem
// esta pagando em dia. Na AbacatePay a mesma regra, mais a assinatura
// cancelada (la o cancelamento e na hora e o Pro vale ate o fim ja pago):
// proDaAbacateVencido.
function proPorPixVencido(p: AccessProfile): boolean {
  const pagoPorPix =
    p.plan === "pro" &&
    p.payment_provider === "pagou" &&
    !p.pagou_subscription_id;
  if (!pagoPorPix) return false;
  if (!p.current_period_end) return false;
  return new Date(p.current_period_end).getTime() < Date.now();
}

// Acesso total: admin OU plano pro OU liberado manualmente. Sem limites.
export function profileHasAccess(profile: AccessProfile | null): boolean {
  if (!profile) return false;
  if (profile.is_admin === true || profile.access_granted === true) return true;
  return profile.plan === "pro" && !proPorPixVencido(profile) && !proDaAbacateVencido(profile, Date.now());
}

// Pode ENTRAR no app: tem acesso total, OU ainda nao usou a clonagem gratuita
// do trial (free_clone_store_id == null). Depois do trial, sem assinar, bloqueia.
export function profileCanEnter(profile: AccessProfile | null): boolean {
  if (!profile) return false;
  if (profileHasAccess(profile)) return true;
  return !profile.free_clone_store_id; // trial ainda disponivel
}

// Checa se um usuario pode entrar no app (server-side). Com o controle
// desligado, sempre true (comportamento atual).
export async function userHasAccess(userId: string): Promise<boolean> {
  if (!accessControlEnabled()) return true;
  if (!userId) return false;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin, plan, access_granted, free_clone_store_id, payment_provider, pagou_subscription_id, abacatepay_subscription_id, subscription_status, current_period_end")
    .eq("id", userId)
    .maybeSingle();

  // Conta recem-criada cujo trigger handle_new_user ainda nao commitou (ou
  // linha ausente por qualquer motivo): tratamos como trial disponivel. Antes
  // caia em profileCanEnter(null) === false e o usuario que acabou de se
  // cadastrar era mandado para /no-access dizendo que a avaliacao GRATUITA
  // tinha terminado — sem nunca ter usado nada.
  if (error || !data) return true;

  return profileCanEnter(data);
}

export interface ClonePermission {
  allowed: boolean;
  reason?: "subscribe";
}

// Trava da clonagem: com acesso total, libera. Sem assinar, libera 1 loja
// (consome o trial) e qualquer reclonagem da MESMA loja; outra loja bloqueia.
export async function checkAndConsumeFreeClone(
  userId: string,
  targetStoreId: string
): Promise<ClonePermission> {
  if (!accessControlEnabled()) return { allowed: true };
  if (!userId || !targetStoreId) return { allowed: true };

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, plan, access_granted, free_clone_store_id, payment_provider, pagou_subscription_id, abacatepay_subscription_id, subscription_status, current_period_end")
    .eq("id", userId)
    .single();

  if (profileHasAccess(profile)) return { allowed: true };

  const usedStore = profile?.free_clone_store_id || null;

  // Ja usou o trial em outra loja -> precisa assinar.
  if (usedStore && usedStore !== targetStoreId) {
    return { allowed: false, reason: "subscribe" };
  }

  // Trial ainda disponivel: consome (atomico, so seta se ainda null).
  if (!usedStore) {
    await supabase
      .from("profiles")
      .update({
        free_clone_store_id: targetStoreId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .is("free_clone_store_id", null);
  }

  return { allowed: true };
}
