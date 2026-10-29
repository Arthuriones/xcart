import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelSubscription, getSubscription, PagouError } from "@/lib/billing/pagou";
import { buscarAssinatura } from "@/lib/billing/abacatepay";
import { cancelarAssinaturaAbacate } from "@/lib/billing/assinar-abacatepay";

// ============================================================================
// Excluir a conta (Apple 5.1.1(v) e Google: caminho no app E na web). As duas
// portas -- DELETE /api/app/v1/conta e DELETE /api/conta -- chamam daqui.
//
// Ordem: confere o e-mail digitado, recusa a conta admin, cancela a assinatura
// que ainda cobra e so entao apaga o usuario no Auth. As FKs para auth.users
// sao cascade (lojas, rastreamento, financeiro, aparelhos do app...); a
// background_jobs so ganhou cascade na 084, entao as linhas dela saem antes.
// Cancelamento que falha NAO apaga: conta sumida com cartao cobrando todo mes
// nao tem mais quem cancele.
// ============================================================================

export type CodigoDaExclusao =
  | "confirmacao_errada"
  | "conta_admin"
  | "assinatura_antiga"
  | "assinatura_nao_cancelada"
  | "falhou";

export type ExclusaoDaConta =
  | { ok: true }
  | { ok: false; status: number; codigo: CodigoDaExclusao; erro: string };

interface PerfilDaConta {
  is_admin: boolean | null;
  payment_provider: string | null;
  pagou_subscription_id: string | null;
  abacatepay_subscription_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** E-mail como a pessoa digita no celular: maiuscula e espaco nao contam. */
function normalizarEmail(v: string): string {
  return v.replace(/\s+/g, "").toLowerCase();
}

/** Cancelada ou com cancelamento agendado: nao ha proxima cobranca. */
function jaNaoCobra(p: PerfilDaConta): boolean {
  return (
    p.cancel_at_period_end === true ||
    p.subscription_status === "canceled" ||
    p.subscription_status === "cancel_scheduled"
  );
}

function erro(status: number, codigo: CodigoDaExclusao, texto: string): ExclusaoDaConta {
  return { ok: false, status, codigo, erro: texto };
}

const NAO_CANCELOU =
  "Não deu para cancelar a sua assinatura agora, então a conta não foi excluída. Tente de novo em instantes.";

type Cancelamento = { recusa: ExclusaoDaConta } | { recusa?: never; cancelou: boolean };

/**
 * Cancela a assinatura viva do mesmo jeito que DELETE /api/billing/subscription.
 * `recusa` = nao apaga; `cancelou` = havia assinatura cobrando e ela parou agora.
 */
async function cancelarAssinaturaViva(admin: Admin, userId: string, p: PerfilDaConta): Promise<Cancelamento> {
  const nada = { cancelou: false };
  if (jaNaoCobra(p)) return nada;

  if (p.payment_provider === "abacatepay") {
    if (!p.abacatepay_subscription_id) return nada; // Pix avulso: nada recorrente
    const r = await cancelarAssinaturaAbacate(userId, p);
    if (r.ok) return { cancelou: true };
    // Recusou porque ja estava cancelada la (aviso perdido, banco atrasado)?
    // Entao nada cobra mais e a exclusao segue; senao, nao apaga.
    const la = await buscarAssinatura(p.abacatepay_subscription_id).catch(() => null);
    if (String(la?.status).toUpperCase() === "CANCELLED") return nada;
    console.error("[conta/excluir] AbacatePay nao cancelou", r.status);
    return { recusa: erro(502, "assinatura_nao_cancelada", NAO_CANCELOU) };
  }

  // O app nao fala com o Stripe (a rota de cancelar tambem manda ao suporte).
  if (p.payment_provider === "stripe") {
    const viva = ["active", "trialing", "past_due"].includes(String(p.subscription_status));
    if (!p.stripe_subscription_id || !viva) return nada;
    return {
      recusa: erro(
        409,
        "assinatura_antiga",
        "Sua assinatura é do sistema de pagamento anterior e precisa ser cancelada pelo suporte antes de excluir a conta."
      ),
    };
  }

  if (!p.pagou_subscription_id) return nada; // Pix avulso: nada recorrente
  try {
    const sub = await cancelSubscription(p.pagou_subscription_id, "user_requested");
    // Grava como a rota de cancelar: se o deleteUser falhar, a nova tentativa
    // ja ve a assinatura cancelada e nao chama a Pagou de novo.
    await admin
      .from("profiles")
      .update({
        subscription_status: sub.status,
        cancel_at_period_end: true,
        current_period_end: sub.currentPeriodEnd || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
    return { cancelou: true };
  } catch (e) {
    const la = await getSubscription(p.pagou_subscription_id).catch(() => null);
    if (la && (la.status === "canceled" || la.status === "cancel_scheduled" || la.cancelAtPeriodEnd === true)) {
      return nada;
    }
    if (e instanceof PagouError) console.error("[conta/excluir] Pagou nao cancelou", e.status, e.code, e.message);
    else console.error("[conta/excluir] Pagou nao cancelou", e);
    return { recusa: erro(502, "assinatura_nao_cancelada", NAO_CANCELOU) };
  }
}

/** Todo arquivo do usuario fica sob a pasta `<uid>/` destes buckets (policies da 003/004). */
const BUCKETS_DO_USUARIO = ["store-logos", "product-images", "store-assets"] as const;
const TETO_DE_ARQUIVOS = 20_000;

/**
 * Arquivo no Storage nao cai em cascata com o usuario, e a pagina de exclusao
 * promete que as imagens saem. Desce nas subpastas (store-assets guarda
 * <uid>/<loja>/arquivo) e apaga em lotes de 1000. Roda DEPOIS do deleteUser e
 * e melhor esforco: a conta ja sumiu, entao a falha vai para o log, nao volta
 * como erro ao lojista.
 */
async function apagarArquivosDoUsuario(admin: Admin, userId: string): Promise<void> {
  for (const bucket of BUCKETS_DO_USUARIO) {
    try {
      const arquivos: string[] = [];
      const pastas = [userId];
      while (pastas.length > 0 && arquivos.length < TETO_DE_ARQUIVOS) {
        const pasta = pastas.pop()!;
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await admin.storage.from(bucket).list(pasta, { limit: 1000, offset });
          if (error) throw error;
          // Pasta vem sem id: nao e um objeto do Storage.
          for (const item of data ?? []) (item.id ? arquivos : pastas).push(`${pasta}/${item.name}`);
          if (!data || data.length < 1000) break;
        }
      }
      for (let i = 0; i < arquivos.length; i += 1000) {
        const { error } = await admin.storage.from(bucket).remove(arquivos.slice(i, i + 1000));
        if (error) throw error;
      }
    } catch (e) {
      console.error("[conta/excluir] storage", bucket, e instanceof Error ? e.message : e);
    }
  }
}

/** Tabela ausente no banco (migration nao aplicada): nada a apagar nela. */
function tabelaAusente(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205";
}

export async function excluirConta(userId: string, confirmacao: unknown): Promise<ExclusaoDaConta> {
  const digitado = typeof confirmacao === "string" ? normalizarEmail(confirmacao) : "";
  if (!digitado) return erro(400, "confirmacao_errada", "Digite o e-mail da conta para confirmar.");

  const admin = createAdminClient();
  const [lidoAuth, lidoPerfil] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin
      .from("profiles")
      .select(
        "is_admin, payment_provider, pagou_subscription_id, abacatepay_subscription_id, stripe_subscription_id, subscription_status, current_period_end, cancel_at_period_end"
      )
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (lidoAuth.error || !lidoAuth.data.user || lidoPerfil.error) {
    console.error("[conta/excluir] leitura", lidoAuth.error?.message, lidoPerfil.error?.message);
    return erro(503, "falhou", "Não deu para excluir a conta agora. Tente de novo em instantes.");
  }

  const email = lidoAuth.data.user.email || "";
  if (!email || normalizarEmail(email) !== digitado) {
    return erro(400, "confirmacao_errada", "O e-mail digitado não é o desta conta.");
  }

  const perfil = lidoPerfil.data as PerfilDaConta | null;
  // A conta do operador nao some por um toque: o admin sai pelo Supabase.
  if (perfil?.is_admin === true) {
    return erro(403, "conta_admin", "A conta de administrador não pode ser excluída por aqui.");
  }

  // Sem linha em profiles nao ha assinatura a cancelar.
  const c: Cancelamento = perfil ? await cancelarAssinaturaViva(admin, userId, perfil) : { cancelou: false };
  if (c.recusa) return c.recusa;
  const depois = c.cancelou ? " Sua assinatura já foi cancelada." : "";

  // Sem a 084, a FK de background_jobs.user_id nao e cascade e travaria o
  // deleteUser. Com ela, isto so adianta o que a cascata faria.
  const jobs = await admin.from("background_jobs").delete().eq("user_id", userId);
  if (jobs.error && !tabelaAusente(jobs.error)) {
    console.error("[conta/excluir] background_jobs", jobs.error.message);
    return erro(503, "falhou", `Não deu para excluir a conta agora. Tente de novo em instantes.${depois}`);
  }

  const apagado = await admin.auth.admin.deleteUser(userId);
  if (apagado.error) {
    console.error("[conta/excluir] deleteUser", apagado.error.status, apagado.error.message);
    return erro(503, "falhou", `Não deu para excluir a conta agora. Tente de novo em instantes.${depois}`);
  }
  await apagarArquivosDoUsuario(admin, userId);
  return { ok: true };
}
