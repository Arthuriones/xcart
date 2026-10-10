import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { diaDoPedido } from "./estado";

// ============================================================================
// Fuso novo no checkout: o dia_local de cada pedido e refeito. Um update por
// dia (e por lote de ids), nunca a linha inteira: o webhook pode estar
// gravando o mesmo pedido agora, e este update so toca dia_local.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const PAGINA = 1000;
const LOTE = 200;

export async function diasDoFusoNovo(admin: Admin, checkoutId: string, fuso: string): Promise<number> {
  const porDia = new Map<string, string[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("pedidos_externos")
      .select("pedido_id, criado_em, dia_local")
      .eq("checkout_id", checkoutId)
      .order("pedido_id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as { pedido_id: string; criado_em: string; dia_local: string }[];
    for (const p of lote) {
      const dia = diaDoPedido(p.criado_em, fuso);
      if (dia === String(p.dia_local).slice(0, 10)) continue;
      const lista = porDia.get(dia) ?? [];
      lista.push(p.pedido_id);
      porDia.set(dia, lista);
    }
    if (lote.length < PAGINA) break;
  }

  let n = 0;
  for (const [dia, ids] of porDia) {
    for (let i = 0; i < ids.length; i += LOTE) {
      const parte = ids.slice(i, i + LOTE);
      const { error } = await admin
        .from("pedidos_externos")
        .update({ dia_local: dia })
        .eq("checkout_id", checkoutId)
        .in("pedido_id", parte);
      if (error) throw new Error(error.message);
      n += parte.length;
    }
  }
  return n;
}
