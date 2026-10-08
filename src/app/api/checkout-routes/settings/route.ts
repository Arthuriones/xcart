import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizarTemaDaRota } from "@/lib/checkout-routes/tema-vitrine";
import { normalizarDominioDeDestino } from "@/lib/net/url-guard";
import { ajusteParaGravar } from "@/lib/checkout-routes/mercado";
import { resumirMoedas } from "@/lib/checkout-routes/carrinho-levado";

export const runtime = "nodejs";

// ============================================================================
// Ajuste de checkout de UMA loja de checkout da rota: dominio, pais e idioma.
//
// Grava em routed_checkout_targets.settings, que e o que o /resolve e o
// config do tema leem (toRouteTarget / mercadoDoDestino). Ate 10/2026 gravava
// no settings da ROTA, que so vale para o destino legado: o lojista escolhia
// o pais e nenhum comprador via.
//
// Sem mapa nenhum aqui: nao mexe em SKU, peso nem liga/desliga.
// ============================================================================

async function exigirDestino(routeId: string, targetId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!routeId || !targetId) {
    return { erro: NextResponse.json({ error: "id e targetId obrigatorios." }, { status: 400 }) };
  }

  const { data: rota } = await supabase
    .from("routed_checkout_configs")
    .select("id")
    .eq("id", routeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!rota) return { erro: NextResponse.json({ error: "Rota nao encontrada." }, { status: 404 }) };

  // O filtro por route_id prende o destino a ESTA rota: a RLS so confere o
  // dono, e o id de um destino de outra rota do mesmo usuario passaria.
  const { data: destino } = await supabase
    .from("routed_checkout_targets")
    .select("id, settings")
    .eq("id", targetId)
    .eq("route_id", routeId)
    .maybeSingle();
  if (!destino) {
    return { erro: NextResponse.json({ error: "Loja de checkout nao encontrada nesta rota." }, { status: 404 }) };
  }
  return { supabase, destino };
}

/** Moeda dos carrinhos que esta loja recebeu nos ultimos 30 dias. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const routeId = url.searchParams.get("id") || "";
  const targetId = url.searchParams.get("targetId") || "";
  const ctx = await exigirDestino(routeId, targetId);
  if (ctx.erro) return ctx.erro;

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.supabase
    .from("routed_checkout_fallbacks")
    .select("detail")
    .eq("route_config_id", routeId)
    .eq("target_id", targetId)
    .eq("reason", "routed_ok")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) {
    return NextResponse.json({ error: "Falha ao ler os carrinhos." }, { status: 500 });
  }
  return NextResponse.json({
    moedas: resumirMoedas((data || []).map((linha: { detail: string | null }) => linha.detail)),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const routeId = typeof body.id === "string" ? body.id : "";
  const targetId = typeof body.targetId === "string" ? body.targetId : "";

  // checkout_domain decide para onde o COMPRADOR vai depois de finalizar. Ate
  // aqui a unica coisa aplicada era .trim(): "javascript:...", "//evil.com" e
  // "google.com@evil.com" entravam no banco e saiam pelo /api/c/[token], que e
  // publico e tem CORS *. Passa pelo parser antes de ser gravado.
  const checkoutDomainBruto =
    typeof body.checkoutDomain === "string" ? body.checkoutDomain.trim() : "";
  let checkoutDomain = "";
  if (checkoutDomainBruto) {
    const dominio = normalizarDominioDeDestino(checkoutDomainBruto);
    if (!dominio.ok) {
      return NextResponse.json(
        {
          error:
            "Dominio de checkout invalido. Use so o endereco da loja, sem http://, sem caminho e sem porta.",
          motivo: dominio.motivo,
        },
        { status: 400 }
      );
    }
    checkoutDomain = dominio.host;
  }

  // "" = padrao (pais do idioma da loja), "auto" = pais do comprador, "XX" = fixo.
  const mercado = ajusteParaGravar(body.checkoutCountry, body.checkoutLocale);
  if (!mercado.ok) return NextResponse.json({ error: mercado.erro }, { status: 400 });

  const ctx = await exigirDestino(routeId, targetId);
  if (ctx.erro) return ctx.erro;

  // Mantem o resto do settings do destino (generatedBy, o que vier depois).
  const settings: Record<string, unknown> = {
    ...((ctx.destino.settings || {}) as Record<string, unknown>),
  };
  if (checkoutDomain) settings.checkout_domain = checkoutDomain;
  else delete settings.checkout_domain;
  if (mercado.checkout_country) settings.checkout_country = mercado.checkout_country;
  else delete settings.checkout_country;
  if (mercado.checkout_locale) settings.checkout_locale = mercado.checkout_locale;
  else delete settings.checkout_locale;

  // Pelo service role: desde a 064 a sessao so atualiza peso, liga, teto e
  // ordem do destino. Posse da rota e do destino conferidas acima pela sessao.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("routed_checkout_targets")
    .update({ settings })
    .eq("id", targetId)
    .eq("route_id", routeId)
    .select("id, settings")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar as configuracoes." },
      { status: 500 }
    );
  }

  // Dominio/pais/locale do destino vao no config do tema (caminho inline).
  const tema = await sincronizarTemaDaRota(admin, routeId);
  return NextResponse.json({ target: data, tema });
}
