import { NextResponse } from "next/server";
import { atualizarDoUsuario } from "@/lib/stores/authorize";
import { createClient } from "@/lib/supabase/server";
import { generateMcpToken } from "@/lib/mcp/auth";

export const runtime = "nodejs";

async function userOr401() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await userOr401();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("mcp_tokens")
    .select("id, name, token_suffix, last_used_at, revoked_at, created_at, expires_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: Request) {
  const { supabase, user } = await userOr401();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  const { raw, hash, suffix } = generateMcpToken();

  const { data, error } = await supabase
    .from("mcp_tokens")
    .insert({
      user_id: user.id,
      name: (name || "Claude").slice(0, 60),
      token_hash: hash,
      token_suffix: suffix,
    })
    .select("id, name, token_suffix, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Unica vez que o valor em claro sai do servidor.
  return NextResponse.json({ ...data, token: raw });
}

export async function DELETE(req: Request) {
  const { supabase, user } = await userOr401();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });

  // Revoga em vez de apagar: mantem o rastro de quando foi usado pela ultima vez.
  //
  // Pelo helper, e nao com .eq("id", id) solto: o dono entra no proprio
  // comando. Com RLS ligada isso e redundante -- e e exatamente por isso que
  // some no dia em que alguem trocar o cliente por um admin.
  const r = await atualizarDoUsuario("mcp_tokens", id, {
    revoked_at: new Date().toISOString(),
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro === "nao encontrado" ? "Token nao encontrado." : "Falha ao revogar." },
      { status: r.erro === "nao encontrado" ? 404 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
