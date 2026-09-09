import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizarDominioDeDestino } from "@/lib/net/url-guard";

export const runtime = "nodejs";

// Atualiza SO as settings de checkout de uma rota (dominio/pais/locale), sem
// tocar nos mapas. Usado quando o dominio da loja checkout muda ou para forcar a
// moeda do checkout (Shopify Markets).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id obrigatorio." }, { status: 400 });
  }

  // checkout_domain decide para onde o COMPRADOR vai depois de finalizar. Ate
  // aqui a unica coisa aplicada era .trim(): "javascript:...", "//evil.com" e
  // "google.com@evil.com" entravam no banco e saiam pelo /api/c/[token], que e
  // publico e tem CORS *. Agora passa pelo parser antes de ser gravado.
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
  const checkoutCountry =
    typeof body.checkoutCountry === "string"
      ? body.checkoutCountry.trim().toUpperCase().slice(0, 2)
      : "";
  const checkoutLocale =
    typeof body.checkoutLocale === "string"
      ? body.checkoutLocale.trim().slice(0, 8)
      : "";

  const { data: current, error: readError } = await supabase
    .from("routed_checkout_configs")
    .select("settings")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (readError || !current) {
    return NextResponse.json({ error: "Rota nao encontrada." }, { status: 404 });
  }

  const settings = {
    ...((current.settings || {}) as Record<string, unknown>),
  };
  // String vazia remove o override (volta ao automatico/loja conectada).
  if (checkoutDomain) settings.checkout_domain = checkoutDomain;
  else delete settings.checkout_domain;
  if (checkoutCountry) settings.checkout_country = checkoutCountry;
  else delete settings.checkout_country;
  if (checkoutLocale) settings.checkout_locale = checkoutLocale;
  else delete settings.checkout_locale;

  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .update({ settings, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, settings")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar as configuracoes." },
      { status: 500 }
    );
  }

  return NextResponse.json({ config: data });
}
