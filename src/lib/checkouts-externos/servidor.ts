import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { gerarSegredo, hashSegredo } from "@/lib/ads/google-ingest";
import { getPublicAppUrl } from "@/lib/public-url";
import { ehUuid } from "@/lib/financeiro/tipos";
import { COLUNAS_CHECKOUT, resumoDoCheckout, urlDoWebhook, type CheckoutExternoRow } from "./tipos";

// ============================================================================
// O que as rotas autenticadas de /api/checkouts dividem. O molde e o de
// /api/ads/contas/[id]: a SESSAO confere o dono (RLS), o service role grava,
// e o user_id nunca vem do corpo. Checkout alheio responde 404, igual ao que
// nao existe.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

export type RespostaApi = { ok: true } & Record<string, unknown>;

export function json(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export const NAO_ENCONTRADO = () => json(404, { ok: false, erro: "Checkout não encontrado." });

export async function usuarioDaSessao(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** O checkout, lido pela SESSAO (RLS): so o do dono volta. */
export async function checkoutDaSessao(id: string): Promise<CheckoutExternoRow | null> {
  if (!ehUuid(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("checkouts_externos").select(COLUNAS_CHECKOUT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CheckoutExternoRow | null) ?? null;
}

/** Token novo e o hash dele (a busca do endpoint). */
export function novoToken(): { token: string; token_hash: string } {
  const token = gerarSegredo();
  return { token, token_hash: hashSegredo(token) };
}

/** A URL que o lojista cola na plataforma. Sempre o host do app, nunca a origem da requisicao. */
export function urlPublica(token: string): string {
  return urlDoWebhook(getPublicAppUrl(), token);
}

/** O token em claro do checkout (service role: a tabela nao tem policy). */
export async function tokenDoCheckout(admin: Admin, checkoutId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("checkout_externo_segredos")
    .select("token")
    .eq("checkout_id", checkoutId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { token: string } | null)?.token ?? null;
}

export { resumoDoCheckout };
