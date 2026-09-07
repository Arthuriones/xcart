import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lerLojas } from "@/lib/stores/queries";

export const runtime = "nodejs";

/**
 * Lista as lojas do usuario.
 *
 * A tela de lojas ja recebe a primeira carga do servidor; isto serve para
 * recarregar depois de conectar ou editar, sem precisar do cliente Supabase
 * no navegador.
 */
export async function GET() {
  const supabase = await createClient();
  try {
    return NextResponse.json({ stores: await lerLojas(supabase) });
  } catch (erro) {
    console.error("[api/stores]", erro);
    return NextResponse.json({ error: "Falha ao listar lojas." }, { status: 500 });
  }
}
