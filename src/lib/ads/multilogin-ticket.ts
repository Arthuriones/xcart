import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const MINUTOS_VALIDADE_TICKET = 15;

export interface TicketMultilogin {
  id: string;
  userId: string;
  plataforma: string;
  ticketHash: string;
  status: "pending" | "completed" | "expired" | "error";
  resultado?: Record<string, unknown>;
  expiresAt: string;
}

/**
 * Cria um ticket seguro de 15 minutos para autenticação em navegador multilogin
 * ou compartilhamento com colaboradores.
 */
export async function criarTicketMultilogin(
  userId: string,
  plataforma: "meta" | "google" | "tiktok",
  origem: string
): Promise<{ ticket: string; url: string; expiresAt: string }> {
  const admin = createAdminClient();
  const ticket = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MINUTOS_VALIDADE_TICKET * 60 * 1000).toISOString();

  const { error } = await admin.from("ad_connection_tickets").insert({
    user_id: userId,
    plataforma,
    ticket_hash: ticket,
    status: "pending",
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Falha ao gerar ticket multilogin: ${error.message}`);
  }

  // Monta a URL de entrada
  const base = origem.replace(/\/+$/, "");
  const url = `${base}/api/auth/${plataforma}/login?ticket=${ticket}`;

  return { ticket, url, expiresAt };
}

/**
 * Valida o ticket para iniciar a autorização ou receber o callback.
 */
export async function validarTicketMultilogin(
  ticket: string,
  plataforma: "meta" | "google" | "tiktok"
): Promise<{ id: string; userId: string; status: string } | null> {
  if (!ticket || ticket.length < 32) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_connection_tickets")
    .select("id, user_id, status, expires_at")
    .eq("ticket_hash", ticket)
    .eq("plataforma", plataforma)
    .maybeSingle();

  if (error || !data) return null;

  // Confere expiração
  const expirou = new Date(data.expires_at).getTime() < Date.now();
  if (expirou) {
    await admin
      .from("ad_connection_tickets")
      .update({ status: "expired" })
      .eq("id", data.id);
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    status: data.status,
  };
}

/**
 * Marca o ticket como concluído e armazena o resumo da conexão (nome, contas).
 */
export async function concluirTicketMultilogin(
  ticketId: string,
  resultado: Record<string, unknown>
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("ad_connection_tickets")
    .update({
      status: "completed",
      resultado,
    })
    .eq("id", ticketId);
}

/**
 * Marca o ticket como erro.
 */
export async function falharTicketMultilogin(
  ticketId: string,
  motivo: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("ad_connection_tickets")
    .update({
      status: "error",
      resultado: { erro: motivo },
    })
    .eq("id", ticketId);
}

/**
 * Consulta o status do ticket (usado pelo polling no navegador principal).
 */
export async function consultarTicketMultilogin(ticket: string): Promise<{
  status: "pending" | "completed" | "expired" | "error";
  resultado?: Record<string, unknown>;
} | null> {
  if (!ticket) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("ad_connection_tickets")
    .select("status, resultado, expires_at")
    .eq("ticket_hash", ticket)
    .maybeSingle();

  if (!data) return null;

  const expirou = new Date(data.expires_at).getTime() < Date.now();
  if (expirou && data.status === "pending") {
    return { status: "expired" };
  }

  return {
    status: data.status as "pending" | "completed" | "expired" | "error",
    resultado: (data.resultado || {}) as Record<string, unknown>,
  };
}
