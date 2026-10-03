import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";

// ============================================================================
// Leitura NOVA, so de leitura, para o detalhe do usuario no admin: os
// destinos de cada rota do cliente, com o peso no rodizio.
//
// GET /api/admin/users/[id] devolve a rota como "origem -> destino" unico (a
// coluna target_store_id da rota, de antes da migration 025). Uma vitrine
// pode apontar para varias lojas de checkout, e e isso que o admin precisa
// ver. Le routed_checkout_targets (sem sku_map, que e pesado e nao aparece) e
// cai no destino da propria rota quando ela nao tem linha de destino -- a
// mesma rede de seguranca de src/lib/checkout-routes/graph.ts.
//
// Usa o client de service role, entao confere o is_admin de quem pede: a
// pagina renderiza em paralelo com o layout e nao pode contar com ele.
// ============================================================================

export interface DestinoAdmin {
  id: string;
  lojaId: string;
  nome: string;
  dominio: string;
  peso: number;
  ligado: boolean;
  /** Destino montado da coluna antiga da rota (sem linha em routed_checkout_targets). */
  legado: boolean;
}

interface LojaJunta {
  name?: string | null;
  shop_domain?: string | null;
}

function primeira<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

async function souAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const { data } = await createAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return data?.is_admin === true;
}

/**
 * Destinos por rota do usuario `userId`. null = sem permissao ou a leitura
 * falhou (a tela mostra o destino unico que a API ja trouxe).
 */
export async function lerDestinosDoUsuario(
  userId: string
): Promise<Record<string, DestinoAdmin[]> | null> {
  try {
    if (!(await souAdmin())) return null;
    const admin = createAdminClient();

    const { data: rotas, error: erroRotas } = await admin
      .from("routed_checkout_configs")
      .select("id, target_store_id, target:target_store_id(name, shop_domain)")
      .eq("user_id", userId);
    if (erroRotas) throw erroRotas;
    if (!rotas || rotas.length === 0) return {};

    const { data: destinos, error: erroDestinos } = await admin
      .from("routed_checkout_targets")
      .select("id, route_id, target_store_id, weight, enabled, position, store:target_store_id(name, shop_domain)")
      .in(
        "route_id",
        rotas.map((r) => r.id)
      )
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    if (erroDestinos) throw erroDestinos;

    const saida: Record<string, DestinoAdmin[]> = {};
    for (const d of destinos ?? []) {
      const loja = primeira(d.store as LojaJunta | LojaJunta[] | null);
      (saida[d.route_id] ??= []).push({
        id: d.id,
        lojaId: d.target_store_id,
        nome: loja?.name || loja?.shop_domain || "Loja removida",
        dominio: loja?.shop_domain || "",
        peso: Math.max(0, Math.floor(Number(d.weight ?? 1))),
        ligado: d.enabled !== false,
        legado: false,
      });
    }

    for (const r of rotas) {
      if (saida[r.id]?.length || !r.target_store_id) continue;
      const loja = primeira(r.target as LojaJunta | LojaJunta[] | null);
      saida[r.id] = [
        {
          id: `legado:${r.id}`,
          lojaId: r.target_store_id,
          nome: loja?.name || loja?.shop_domain || "Loja removida",
          dominio: loja?.shop_domain || "",
          peso: 1,
          ligado: true,
          legado: true,
        },
      ];
    }
    return saida;
  } catch (erro) {
    console.error("[admin] destinos das rotas", erro);
    return null;
  }
}
