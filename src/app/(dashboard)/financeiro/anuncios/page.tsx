import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

export const dynamic = "force-dynamic";

/**
 * Contas de anuncio mudou para Integracoes: Meta e Google, cada um com o que
 * le o gasto e o que envia as compras. A URL antiga continua valendo (links
 * salvos, avisos do Lucro e de Lojas) e cai no Meta -- ou no Google, quando
 * so ha conta do Google (no Meta ela nem apareceria).
 */
export default async function AnunciosPage() {
  let destino = "/integracoes/meta";
  try {
    const user = await getCurrentUser();
    if (user) {
      const supabase = await createClient();
      const { data, error } = await supabase.from("ad_accounts").select("plataforma").eq("user_id", user.id);
      const plataformas = new Set((error ? [] : data || []).map((c) => String(c.plataforma)));
      if (plataformas.has("google") && !plataformas.has("meta")) destino = "/integracoes/google";
    }
  } catch {
    // Sem leitura, fica no Meta (o mesmo de antes).
  }
  redirect(destino);
}
