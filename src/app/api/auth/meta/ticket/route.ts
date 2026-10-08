import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  criarTicketMultilogin,
  consultarTicketMultilogin,
} from "@/lib/ads/multilogin-ticket";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, erro: "não autenticado" }, { status: 401 });
  }

  try {
    const { ticket, url, expiresAt } = await criarTicketMultilogin(
      user.id,
      "meta",
      request.nextUrl.origin
    );

    return NextResponse.json({
      ok: true,
      ticket,
      url,
      expiresAt,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "falha ao criar ticket" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticket = searchParams.get("ticket");

  if (!ticket) {
    return NextResponse.json({ ok: false, erro: "ticket obrigatório" }, { status: 400 });
  }

  const dados = await consultarTicketMultilogin(ticket);
  if (!dados) {
    return NextResponse.json({ ok: false, erro: "ticket não encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    status: dados.status,
    resultado: dados.resultado || null,
  });
}
