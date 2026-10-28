import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscarContasNovasMeta } from "@/lib/ads/meta-contas-novas";

export const runtime = "nodejs";
// Folga sobre o orcamento de 45 s da busca: o ultimo perfil que comeca dentro
// dele pode levar algumas paginas de 25 s no Meta.
export const maxDuration = 300;

// Conta de anuncio criada depois de conectar o perfil: pergunta de novo ao Meta
// com o login salvo de cada perfil do usuario e acrescenta so as que faltam
// (src/lib/ads/meta-contas-novas.ts). O usuario vem SEMPRE da sessao.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  }

  try {
    const r = await buscarContasNovasMeta(createAdminClient(), user.id);
    return NextResponse.json({ ok: true, novas: r.novas, erros: r.erros });
  } catch {
    // O titulo do aviso na tela ja diz "Nao deu para buscar as contas agora".
    return NextResponse.json({ ok: false, erro: "Tente de novo em alguns minutos." }, { status: 500 });
  }
}
