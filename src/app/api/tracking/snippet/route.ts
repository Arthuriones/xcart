import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { scriptNoTemaDaLoja, tagScriptNoTema } from "@/lib/leitura/guia-configuracao";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarSnippet, montarTag } from "@/lib/tracking/snippet-tema";

export const runtime = "nodejs";

/** Acima disto a resposta sai sem saber se a tag ja esta no tema (null). */
const TETO_TEMA_MS = 5_000;

// ============================================================================
// GET: a tag para COLAR no tema, para quem nao quer (ou nao pode) usar o
// botao. Sai da MESMA montarTag e do mesmo formato de id que o POST usa, sem
// o remarketing -- o padrao do Instalar --, entao colar e instalar dao o mesmo
// texto. Junto: se o tema publicado ja tem a tag (a regra do guia, guardada
// por 10 min; null = nao deu para conferir) e se o rastreamento da loja esta
// ligado, porque a tag sozinha nao manda nada com ele desligado.
// ============================================================================

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }

  // A tag carrega o id da LINHA de loja: entregar o de outra conta mandaria
  // os eventos dela para a conta de anuncios errada.
  const { data: loja } = await supabase
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!loja) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const { remarketingDaLoja } = await import("@/lib/tracking/destinos");
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<null>((resolver) => {
    relogio = setTimeout(() => resolver(null), TETO_TEMA_MS);
  });
  try {
    const [google, config, instalado] = await Promise.all([
      remarketingDaLoja(createAdminClient(), loja.id),
      supabase.from("tracking_configs").select("enabled").eq("store_id", loja.id).maybeSingle(),
      Promise.race([scriptNoTemaDaLoja(loja.id).catch(() => null), teto]),
    ]);
    return NextResponse.json({
      ok: true,
      codigo: montarTag(loja.id, [], google.idTemplate),
      instalado,
      ligado: config.error ? null : Boolean(config.data?.enabled),
    });
  } finally {
    clearTimeout(relogio);
  }
}

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
    // O guia de configuracao guarda o "script no tema" por 10 minutos: sem
    // isto, o passo do rastreamento seguiria acusando a falta logo depois de
    // instalar.
    revalidateTag(tagScriptNoTema(loja.id), { expire: 0 });
    return NextResponse.json({ ok: true, ...r, conteudo: undefined });
  } catch (e) {
    // A mensagem da Shopify vem crua e em ingles ("Access denied for
    // themeFilesUpsert..."): vira o que fazer, e o texto cru fica no detalhe.
    const crua = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: erroDoTema(crua), detalhe: crua },
      { status: 500 }
    );
  }
}

/** Sem write_themes no app da loja a Shopify responde "access denied" (ou 403). */
function erroDoTema(crua: string): string {
  if (/access denied|write_themes|read_themes|\b403\b/i.test(crua)) {
    return "Falta a permissão de tema no app da loja. Em dev.shopify.com, inclua write_themes nos escopos, lance o app de novo e reconecte em Lojas.";
  }
  return "Não deu para gravar no tema. Tente de novo.";
}
