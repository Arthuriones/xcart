import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import type { SeveridadeAlerta } from "@/lib/financeiro/tipos";

// ============================================================================
// Leitura para o sino do topo e o contador do menu: os alertas ABERTOS do
// usuario (tabela `alertas`, migration 052). So leitura, pela sessao (RLS).
//
// Sem "lido" nem "adiar": isso pede coluna nova na tabela, fora desta rodada.
// Silenciado continua aberto (silenciar so adia o aviso no Telegram), entao
// conta e aparece -- com a marca de silenciado.
// ============================================================================

export interface Notificacao {
  id: string;
  severidade: SeveridadeAlerta;
  titulo: string;
  /** Nome da loja; null = alerta da conta inteira. */
  loja: string | null;
  abertoEm: string;
  silenciado: boolean;
}

export interface Notificacoes {
  total: number;
  /** Os mais urgentes primeiro: critico antes de aviso, mais novo antes. */
  itens: Notificacao[];
}

const LIMITE = 20;

/** Quantos alertas abertos o usuario tem. Erro de banco LANCA. */
export const contarAlertasAbertos = cache(async (): Promise<number> => {
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("alertas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("resolvido_em", null);
  if (error) throw new Error(`Falha ao contar os alertas: ${error.message}`);
  return count ?? 0;
});

/** Os alertas abertos para o sino. Erro de banco LANCA. */
export async function lerNotificacoes(): Promise<Notificacoes> {
  const user = await getCurrentUser();
  if (!user) return { total: 0, itens: [] };
  const supabase = await createClient();

  const [abertos, lojas] = await Promise.all([
    supabase
      .from("alertas")
      .select("id, store_id, severidade, titulo, aberto_em, silenciado_ate", { count: "exact" })
      .eq("user_id", user.id)
      .is("resolvido_em", null)
      // "critico" < "aviso" em ordem alfabetica: decrescente poe critico antes.
      .order("severidade", { ascending: false })
      .order("aberto_em", { ascending: false })
      .limit(LIMITE),
    supabase.from("stores").select("id, name, shop_domain").eq("user_id", user.id),
  ]);
  if (abertos.error) throw new Error(`Falha ao ler os alertas: ${abertos.error.message}`);

  // Sem o nome da loja o alerta ainda e util: cai no dominio, ou em nada.
  const nomePorId = new Map(
    (lojas.data ?? []).map((l: { id: string; name: string | null; shop_domain: string | null }) => [
      String(l.id),
      String(l.name || l.shop_domain || ""),
    ])
  );
  const agora = Date.now();

  const itens = (abertos.data ?? []).map(
    (a: {
      id: string;
      store_id: string | null;
      severidade: SeveridadeAlerta;
      titulo: string;
      aberto_em: string;
      silenciado_ate: string | null;
    }): Notificacao => ({
      id: String(a.id),
      severidade: a.severidade === "critico" ? "critico" : "aviso",
      titulo: String(a.titulo),
      loja: a.store_id ? nomePorId.get(String(a.store_id)) || null : null,
      abertoEm: String(a.aberto_em),
      silenciado: !!a.silenciado_ate && Date.parse(a.silenciado_ate) > agora,
    })
  );

  return { total: abertos.count ?? itens.length, itens };
}
