import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";
import { limparMapaDeRotulos } from "@/lib/tracking/eventos";

export const runtime = "nodejs";

// ============================================================================
// Salva a configuracao de rastreamento de UMA loja.
//
// Passa pelo service role de proposito: a linha carrega `user_id`, e deixar o
// cliente escolher esse campo abriria a porta para apontar a configuracao
// para a loja de outro. O dono e lido do banco a partir da sessao, nunca do
// corpo da requisicao.
// ============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let corpo: {
    storeId?: string;
    enabled?: boolean;
    googleConversionId?: string | null;
    /** Rotulo por evento: {"purchase":"AbC...","add_to_cart":"XyZ..."}. */
    googleLabels?: Record<string, string> | null;
    metaPixelId?: string | null;
    /**
     * Token do CAPI. Vazio/ausente = nao mexer no que esta gravado.
     *
     * Nunca volta na leitura: a tela so recebe um booleano dizendo se existe.
     * String vazia nao apaga de proposito -- a tela manda o campo vazio em todo
     * salvamento normal, e apagar ali derrubaria o rastreamento do Meta a cada
     * vez que o lojista mudasse outra coisa. Para remover existe --desligar no
     * script.
     */
    metaAccessToken?: string | null;
  };
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
  // do corpo permitiria configurar a loja de qualquer outro.
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", corpo.storeId)
    .maybeSingle();

  if (!loja || loja.user_id !== user.id) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const id = (corpo.googleConversionId || "").trim() || null;

  if (id && !apenasNumeroDaConversao(id)) {
    return NextResponse.json(
      { error: "ID de conversao invalido. Esperado algo como AW-123456789." },
      { status: 400 }
    );
  }

  // Descarta evento desconhecido e rotulo vazio. E o que garante que o mapa
  // nunca chega ao banco como {"purchase": ""} -- o CHECK da tabela confia
  // nisso para poder testar so `google_labels <> '{}'`.
  const rotulos = limparMapaDeRotulos(corpo.googleLabels);
  const quantos = Object.keys(rotulos).length;

  // So digitos: o Events Manager mostra o id com espaco as vezes, e o Meta
  // recusa a URL do endpoint se vier qualquer outra coisa.
  const pixel = (corpo.metaPixelId || "").replace(/\D/g, "") || null;
  if (corpo.metaPixelId?.trim() && !pixel) {
    return NextResponse.json(
      { error: "ID do pixel invalido. Esperado so digitos." },
      { status: 400 }
    );
  }

  const tokenMeta = (corpo.metaAccessToken || "").trim() || null;

  // Um sem o outro nao identifica conversao nenhuma: a requisicao sairia e o
  // Google descartaria em silencio.
  if (Boolean(id) !== (quantos > 0)) {
    return NextResponse.json(
      {
        error:
          "Preencha o ID de conversao e ao menos um rotulo de evento, ou deixe tudo vazio.",
      },
      { status: 400 }
    );
  }

  // Ligado exige ao menos UM destino que de fato envie. O banco tambem recusa
  // (tracking_configs_ligado_precisa_destino), mas a mensagem daqui e legivel.
  const googlePronto = Boolean(id) && quantos > 0;
  const { data: segAntes } = await admin
    .from("tracking_secrets")
    .select("meta_access_token")
    .eq("store_id", loja.id)
    .maybeSingle();
  const metaPronto = Boolean(pixel) && Boolean(tokenMeta || segAntes?.meta_access_token);

  const ligar = Boolean(corpo.enabled);
  if (ligar && !googlePronto && !metaPronto) {
    return NextResponse.json(
      {
        error:
          "Para ligar: no Google, o ID de conversao e o rotulo de ao menos um evento; " +
          "no Meta, o ID do pixel e o token do CAPI.",
      },
      { status: 400 }
    );
  }

  const { error } = await admin.from("tracking_configs").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      enabled: ligar,
      google_conversion_id: id,
      google_labels: rotulos,
      // A coluna legada e espelhada, nao esquecida. Ela ainda e fallback de
      // leitura: deixar um valor velho ali faria a conversao de compra
      // continuar saindo depois de o lojista tirar o rotulo do mapa.
      google_conversion_label: rotulos.purchase ?? null,
      meta_pixel_id: pixel,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );

  // O token vai para a outra tabela, e so quando veio um novo: campo vazio no
  // formulario significa "nao mexer", nao "apagar".
  if (!error && tokenMeta) {
    const { error: erroSegredo } = await admin.from("tracking_secrets").upsert(
      { store_id: loja.id, meta_access_token: tokenMeta },
      { onConflict: "store_id" }
    );
    if (erroSegredo) {
      return NextResponse.json({ error: erroSegredo.message }, { status: 500 });
    }
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
