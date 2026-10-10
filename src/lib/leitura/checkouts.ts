import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  COLUNAS_CHECKOUT,
  resumoDoCheckout,
  semMigration069,
  type CheckoutExternoRow,
  type CheckoutResumo,
} from "@/lib/checkouts-externos/tipos";

// ============================================================================
// Integracoes -> Checkouts: os checkouts do usuario e os ultimos eventos
// recebidos. Pela SESSAO (RLS), sem o token: a URL so sai por
// GET /api/checkouts/[id]/url, quando o lojista pede. Erro de banco LANCA.
// ============================================================================

export interface EventoDaTela {
  checkoutId: string;
  pedidoId: string;
  evento: string;
  recebidoEm: string;
}

export interface CheckoutsDaTela {
  checkouts: CheckoutResumo[];
  eventos: EventoDaTela[];
  /** A migration 069 ainda nao foi aplicada: a tela diz isso. */
  semMigration: boolean;
}

const EVENTOS_NA_TELA = 20;

export async function lerCheckoutsDaTela(): Promise<CheckoutsDaTela> {
  const user = await getCurrentUser();
  if (!user) return { checkouts: [], eventos: [], semMigration: false };
  const supabase = await createClient();
  const [cks, evs] = await Promise.all([
    supabase
      .from("checkouts_externos")
      .select(COLUNAS_CHECKOUT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("checkout_externo_eventos")
      .select("checkout_id, pedido_id, evento, recebido_em")
      .eq("user_id", user.id)
      .order("recebido_em", { ascending: false })
      .limit(EVENTOS_NA_TELA),
  ]);
  if (cks.error) {
    if (semMigration069(cks.error)) return { checkouts: [], eventos: [], semMigration: true };
    throw new Error(`Falha ao ler os checkouts: ${cks.error.message}`);
  }
  if (evs.error && !semMigration069(evs.error)) throw new Error(`Falha ao ler os eventos: ${evs.error.message}`);
  return {
    checkouts: ((cks.data ?? []) as CheckoutExternoRow[]).map(resumoDoCheckout),
    eventos: ((evs.error ? [] : (evs.data ?? [])) as {
      checkout_id: string;
      pedido_id: string;
      evento: string;
      recebido_em: string;
    }[]).map((e) => ({
      checkoutId: String(e.checkout_id),
      pedidoId: String(e.pedido_id),
      evento: String(e.evento),
      recebidoEm: String(e.recebido_em),
    })),
    semMigration: false,
  };
}
