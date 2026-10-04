import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarSnippet } from "@/lib/tracking/snippet-tema";

export const runtime = "nodejs";

// ============================================================================
// Instala, atualiza ou remove a tag do xcart no tema, pela tela.
//
// Antes isto so existia como script de operacao, entao ligar rastreamento numa
// loja nova dependia de alguem com o repo na mao. E nao era um detalhe: sem a
// tag no tema o gclid nunca vira cart attribute e o funil inteiro nao sai --
// a configuracao fica perfeita na tela e nada acontece.
//
// O remarketing vem junto porque e a mesma tag: o AW e lido da propria
// configuracao da loja, entao nao ha um segundo lugar para o id ficar
// desatualizado.
// ============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let corpo: { storeId?: string; remarketing?: boolean; remover?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }
  if (!corpo.storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }

  // Cliente do usuario + `.eq("user_id")`: a loja tem que ser dele. O passo
  // seguinte grava no TEMA da loja, entao errar aqui edita a loja de outro.
  const { data: loja } = await supabase
    .from("stores")
    .select("id, user_id")
    .eq("id", corpo.storeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!loja) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: cheia } = await admin
    .from("stores")
    .select("id, shop_domain, client_id, client_secret, access_token")
    .eq("id", loja.id)
    .single();

  if (!cheia?.client_id || !cheia.client_secret) {
    return NextResponse.json(
      { error: "Loja sem credencial do app da Shopify." },
      { status: 400 }
    );
  }

  // TODAS as contas de Google da loja, nao a primeira.
  //
  // Cada conta de anuncio monta a sua propria lista: publico criado na conta A
  // nao serve na conta B. Com cinco contas anunciando a mesma loja, mandar so
  // uma deixaria quatro sem publico -- e sem jeito de notar, porque a lista
  // simplesmente nunca enche.
  let remarketing: string[] = [];
  // O `ecomm_prodid` do remarketing e montado no NAVEGADOR e tem que casar com
  // o id do Merchant Center igual aos eventos do servidor -- entao o formato
  // viaja junto, dentro da tag.
  // O formato vale tambem SEM o atributo de remarketing: o remarketing pelas
  // contas do google-config usa o mesmo `ecomm_prodid`.
  const { remarketingDaLoja } = await import("@/lib/tracking/destinos");
  const r = corpo.remover ? null : await remarketingDaLoja(admin, loja.id);
  const idTemplate: string | null = r?.idTemplate ?? null;
  if (corpo.remarketing && r) {
    remarketing = r.contas;
    if (remarketing.length === 0) {
      return NextResponse.json(
        {
          error:
            "Para o remarketing, cadastre antes uma conta do Google Ads nesta loja.",
        },
        { status: 400 }
      );
    }
  }

  try {
    const r = await aplicarSnippet(
      {
        shopDomain: cheia.shop_domain,
        clientId: cheia.client_id,
        clientSecret: cheia.client_secret,
        accessToken: cheia.access_token,
      },
      { storeId: loja.id, remarketing, idTemplate, remover: corpo.remover }
    );
    return NextResponse.json({ ok: true, ...r, conteudo: undefined });
  } catch (e) {
    // write_themes pode nao estar no app da loja; a mensagem da Shopify e o
    // que diz isso, entao ela passa adiante em vez de virar "falhou".
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao gravar o tema." },
      { status: 500 }
    );
  }
}
