"use client";

import { erroDaApi, type JobImportacao } from "./regras";

// ============================================================================
// Chamadas do NAVEGADOR para a fila de importacao que ja existe
// (/api/jobs/bulk-import e /process). Nada muda nelas: aqui so se chama e se
// traduz a falha. So caminho da propria API, nunca endereco vindo de fora.
// ============================================================================

export type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string; status: number };

async function chamar<T>(url: string, init?: RequestInit): Promise<Resposta<T>> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const corpo = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) return { ok: false, status: r.status, erro: erroDaApi(r.status, corpo?.error) };
    return { ok: true, dados: corpo };
  } catch {
    return { ok: false, status: 0, erro: erroDaApi(0, null) };
  }
}

/** As ultimas 50 importacoes: de uma loja, ou de todas (lojaId vazio). */
export async function lerFila(lojaId: string): Promise<Resposta<JobImportacao[]>> {
  const qs = lojaId ? `?${new URLSearchParams({ storeId: lojaId })}` : "";
  const r = await chamar<{ jobs?: JobImportacao[] }>(`/api/jobs/bulk-import${qs}`);
  return r.ok ? { ok: true, dados: r.dados.jobs ?? [] } : r;
}

/** Coloca os links na fila. O corpo vem pronto de corpoDoLote / corpoTentarDeNovo. */
export async function enfileirar(
  corpo: Record<string, unknown>
): Promise<Resposta<{ queued?: number; jobs?: string[] }>> {
  return chamar("/api/jobs/bulk-import", { method: "POST", body: JSON.stringify(corpo) });
}

/**
 * Faz a fila andar agora, ate 5 links (os outros saem na rodada automatica).
 * Sem loja, anda a fila de todas as lojas do usuario.
 */
export async function continuarFila(lojaId: string): Promise<Resposta<unknown>> {
  const corpo = lojaId ? { storeId: lojaId, limit: 5 } : { limit: 5 };
  return chamar("/api/jobs/bulk-import/process", { method: "POST", body: JSON.stringify(corpo) });
}
