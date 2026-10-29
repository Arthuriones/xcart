import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Encerrar a sessão sem carregar o cliente Supabase no navegador.
 *
 * A sidebar vive no layout do painel, então importar o cliente lá colocava
 * 59 KB comprimidos em TODA tela do painel -- para uma única chamada de
 * signOut(). Aqui o cookie é limpo no servidor e o navegador só precisa de
 * um fetch.
 */
export async function POST() {
  const supabase = await createClient();
  // So esta sessao: o padrao do auth-js e "global", que derrubava tambem o
  // app do celular (e todo outro navegador) a cada "Sair" no site.
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}
