import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// ============================================================================
// O interruptor de rastreamento de UMA loja.
//
// So isso. Conta, rotulo e token mudaram de lugar na migration 043: cada
// destino e uma LINHA em `tracking_destinations`, porque a loja pode ter cinco
// contas de Google e dois pixels Meta -- e esta rota ficaria tentando decidir
// qual delas o corpo da requisicao descrevia. Quem cuida de destino e
// /api/tracking/destinos.
//
// Passa pelo service role de proposito: a linha carrega `user_id`, e deixar o
// cliente escolher esse campo abriria a porta para ligar o rastreamento da loja
// de outro. O dono e lido do banco a partir da sessao, nunca do corpo.
// ============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let corpo: { storeId?: string; enabled?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!corpo.storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }

  const admin = createAdminClient();

  // A loja tem que ser do usuario da sessao. Sem esta checagem, storeId vindo
  // do corpo permitiria mexer na loja de qualquer outro.
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", corpo.storeId)
    .maybeSingle();

  if (!loja || loja.user_id !== user.id) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const ligar = Boolean(corpo.enabled);

  // Ligar exige ao menos um destino que de fato ENVIE.
  //
  // Antes da 045 isto era um CHECK na tabela, que testava as colunas legadas.
  // Nao da mais: a invariante passou a ser entre tabelas, e CHECK nao consulta
  // outra tabela. A garantia vive aqui, e a tela mostra "ligado, nenhum destino
  // recebe" se um destino for removido depois -- ligado sem destino nao envia
  // nada, e isso precisa ser visivel em vez de silencioso.
  if (ligar) {
    const { destinosDaLoja, destinoAceita, tagDoGoogleDispara } = await import(
      "@/lib/tracking/destinos"
    );
    const destinos = await destinosDaLoja(admin, loja.id, { comToken: true });
    // `purchase` e o evento que decide: e a venda. Destino que nao cobre a
    // compra pode existir, mas nao serve de motivo para ligar a loja. O Meta
    // pela fila do servidor; o Google pela tag do navegador.
    const algumEnvia = destinos.some(
      (d) => destinoAceita(d) || tagDoGoogleDispara(d, "purchase")
    );
    if (!algumEnvia) {
      return NextResponse.json(
        {
          error:
            "Para ligar: cadastre um destino que receba a compra — no Google o ID da " +
            "conta mais o rótulo da compra, no Meta o ID do pixel mais o token do CAPI.",
        },
        { status: 400 }
      );
    }
  }

  const { error } = await admin.from("tracking_configs").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      enabled: ligar,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
