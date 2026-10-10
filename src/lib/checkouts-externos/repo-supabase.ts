import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hashSegredo } from "@/lib/ads/google-ingest";
import { paraNumero } from "@/lib/financeiro/tipos";
import type { EstadoPedido } from "./estado";
import type { CheckoutParaReceber, PedidoGravado, RepositorioCheckout } from "./receber";
import { RE_TOKEN, type SituacaoExterna } from "./tipos";

// ============================================================================
// O RepositorioCheckout de verdade: service role, tabelas da 069. So o
// endpoint publico e as rotas /api/checkouts usam (a sessao nao escreve nessas
// tabelas -- os grants da 069 tiram insert/update/delete dela).
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const COLUNAS_RECEBER = "id, user_id, plataforma, nome, ativo, fuso, moeda_receita, conta_externa, notificar_aprovada";

const COLUNAS_ESTADO =
  "situacao, status_comissao, status_pedido, metodo_pagamento, produto, pais, programa, moeda, valor, receita, moeda_receita, criado_em, dia_local, aprovado_em, pago_em, perdido_em, atualizado_em, versao";

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A linha do banco no formato do estado (numeric chega como string). */
function estadoDaLinha(l: Record<string, unknown>): PedidoGravado {
  return {
    situacao: l.situacao as SituacaoExterna,
    status_comissao: (l.status_comissao as string | null) ?? null,
    status_pedido: (l.status_pedido as string | null) ?? null,
    metodo_pagamento: (l.metodo_pagamento as string | null) ?? null,
    produto: (l.produto as string | null) ?? null,
    pais: (l.pais as string | null) ?? null,
    programa: (l.programa as string | null) ?? null,
    moeda: String(l.moeda),
    valor: paraNumero(l.valor),
    receita: paraNumero(l.receita),
    moeda_receita: (l.moeda_receita as string | null) ?? null,
    criado_em: iso(l.criado_em) ?? String(l.criado_em),
    dia_local: String(l.dia_local).slice(0, 10),
    aprovado_em: iso(l.aprovado_em),
    pago_em: iso(l.pago_em),
    perdido_em: iso(l.perdido_em),
    atualizado_em: iso(l.atualizado_em) ?? String(l.atualizado_em),
    versao: Number(l.versao) || 0,
  };
}

/**
 * O checkout dono do token, ou null (token com outro formato, desconhecido ou
 * de checkout apagado). Busca pelo sha256 (indice unico) e confere o token em
 * claro em tempo constante: o tempo da resposta nao ensina nada sobre ele.
 * Erro de banco LANCA (o endpoint responde 503, nao "token desconhecido").
 */
export async function checkoutDoToken(admin: Admin, token: string): Promise<CheckoutParaReceber | null> {
  if (!RE_TOKEN.test(token)) return null;
  const { data: seg, error } = await admin
    .from("checkout_externo_segredos")
    .select("checkout_id, token")
    .eq("token_hash", hashSegredo(token))
    .maybeSingle();
  if (error) throw new Error(`falha ao conferir o token: ${error.message}`);
  if (!seg) return null;
  const a = Buffer.from(String((seg as { token: string }).token), "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const { data: ck, error: erroCk } = await admin
    .from("checkouts_externos")
    .select(COLUNAS_RECEBER)
    .eq("id", (seg as { checkout_id: string }).checkout_id)
    .maybeSingle();
  if (erroCk) throw new Error(`falha ao ler o checkout: ${erroCk.message}`);
  return (ck as CheckoutParaReceber | null) ?? null;
}

function linhaDoPedido(p: EstadoPedido) {
  return {
    situacao: p.situacao,
    status_comissao: p.status_comissao,
    status_pedido: p.status_pedido,
    metodo_pagamento: p.metodo_pagamento,
    produto: p.produto,
    pais: p.pais,
    programa: p.programa,
    moeda: p.moeda,
    valor: p.valor,
    receita: p.receita,
    moeda_receita: p.moeda_receita,
    criado_em: p.criado_em,
    dia_local: p.dia_local,
    aprovado_em: p.aprovado_em,
    pago_em: p.pago_em,
    perdido_em: p.perdido_em,
    atualizado_em: p.atualizado_em,
  };
}

export function repositorioSupabase(admin: Admin): RepositorioCheckout {
  return {
    async travarEvento(x) {
      const { error } = await admin.from("checkout_externo_eventos").insert(x);
      if (error?.code === "23505") return "duplicado";
      if (error) throw new Error(`falha ao registrar o evento: ${error.message}`);
      return "ok";
    },
    async soltarEvento(x) {
      await admin
        .from("checkout_externo_eventos")
        .delete()
        .eq("checkout_id", x.checkout_id)
        .eq("pedido_id", x.pedido_id)
        .eq("evento", x.evento);
    },
    async lerPedido(checkoutId, pedidoId) {
      const { data, error } = await admin
        .from("pedidos_externos")
        .select(COLUNAS_ESTADO)
        .eq("checkout_id", checkoutId)
        .eq("pedido_id", pedidoId)
        .maybeSingle();
      if (error) throw new Error(`falha ao ler o pedido: ${error.message}`);
      return data ? estadoDaLinha(data as Record<string, unknown>) : null;
    },
    async inserirPedido(x) {
      const { error } = await admin.from("pedidos_externos").insert({
        checkout_id: x.checkout_id,
        user_id: x.user_id,
        pedido_id: x.pedido_id,
        ...linhaDoPedido(x.pedido),
        versao: 0,
      });
      if (error?.code === "23505") return "existe";
      if (error) throw new Error(`falha ao gravar o pedido: ${error.message}`);
      return "ok";
    },
    async atualizarPedido(x) {
      const { data, error } = await admin
        .from("pedidos_externos")
        .update({ ...linhaDoPedido(x.pedido), versao: x.versao + 1 })
        .eq("checkout_id", x.checkout_id)
        .eq("pedido_id", x.pedido_id)
        .eq("versao", x.versao)
        .select("pedido_id");
      if (error) throw new Error(`falha ao atualizar o pedido: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async fixarConta(checkoutId, conta) {
      const { data, error } = await admin
        .from("checkouts_externos")
        .update({ conta_externa: conta, updated_at: new Date().toISOString() })
        .eq("id", checkoutId)
        .is("conta_externa", null)
        .select("id");
      if (error?.code === "23505") return "em_uso";
      if (error) throw new Error(`falha ao fixar a conta: ${error.message}`);
      if ((data ?? []).length > 0) return "ok";
      // Outro evento fixou antes: vale se foi a mesma conta.
      const { data: ck, error: e2 } = await admin
        .from("checkouts_externos")
        .select("conta_externa")
        .eq("id", checkoutId)
        .maybeSingle();
      if (e2) throw new Error(`falha ao ler a conta: ${e2.message}`);
      return (ck as { conta_externa: string | null } | null)?.conta_externa === conta ? "ok" : "outra";
    },
    async marcarCheckout(checkoutId, campos) {
      const { error } = await admin
        .from("checkouts_externos")
        .update({ ...campos, updated_at: new Date().toISOString() })
        .eq("id", checkoutId);
      if (error) console.error("[checkout/webhook] falha ao marcar o checkout", error.message);
    },
  };
}
