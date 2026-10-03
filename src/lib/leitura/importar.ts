import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

// ============================================================================
// Leitura do Importar (/clone, /bulk, /multi-site): as lojas que podem
// receber produto. So leitura, pela sessao (RLS) e com o dono conferido.
//
// Existe ao lado de getPickerStores (src/lib/stores/picker.ts) porque aquela
// devolve lista vazia quando o banco falha -- e a tela dizia "nenhuma loja
// conectada" para quem tinha nove. Aqui o erro LANCA e a tela mostra erro.
// ============================================================================

export interface LojaDestino {
  id: string;
  nome: string;
  /** xxx.myshopify.com: monta o link para o produto criado. */
  dominio: string;
  /** App desinstalado: a importacao falharia, entao a loja fica fora da escolha. */
  semAcesso: boolean;
}

/** Lojas do usuario, mais nova primeiro (a mesma ordem do seletor antigo). */
export async function lerLojasDestino(): Promise<LojaDestino[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, shop_domain, uninstalled_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`lojas: ${error.message}`);

  return (data ?? []).map((l) => ({
    id: String(l.id),
    nome: String(l.name || l.shop_domain || "Loja sem nome"),
    dominio: String(l.shop_domain || ""),
    semAcesso: Boolean(l.uninstalled_at),
  }));
}
