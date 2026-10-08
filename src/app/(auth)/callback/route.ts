import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { APP_HOME } from "@/lib/app-home";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/set-password`);
      }
      return NextResponse.redirect(`${origin}${APP_HOME}`);
    }
    // Link do cadastro: o Supabase confirma o e-mail ANTES de mandar o
    // codigo; a troca so falha porque o link abriu em outro navegador (sem o
    // code verifier) ou de novo. A conta vale -- falta entrar com a senha.
    if (type === "signup") {
      return NextResponse.redirect(`${origin}/login?error=email_confirmado`);
    }
    // Link expirado/reutilizado: sinaliza o motivo em vez de devolver um
    // formulario de login em branco, sem explicacao nenhuma.
    return NextResponse.redirect(
      `${origin}/login?error=link_invalido`
    );
  }

  return NextResponse.redirect(`${origin}/login`);
}
