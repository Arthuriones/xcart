import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { paraNumero } from "@/lib/financeiro/tipos";
import {
  EVENTOS_DO_POSTBACK,
  JANELA_POSTBACK_MS,
  PRAZO_DECISAO_MS,
  RETENCAO_POSTBACK_MS,
  casarPeloId,
  casarPostback,
  origemDoAnuncio,
  type AnuncioConhecido,
  type CandidatoPostback,
  type PostbackLido,
} from "./postback";

// ============================================================================
// O banco do postback da Sphere (086): grava, casa com o pedido e poe a
// origem nele. As regras sao de postback.ts; aqui so o service role (a
// tabela nao tem policy). Quem chama: o GET da rota do webhook (grava e casa
// so pelo `{t}`) e o cron do drain (decide pela hora, com a janela fechada).
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoPostback = "casado" | "pendente" | "ambiguo" | "sem_pedido" | "sem_anuncio" | "conflito";

interface PostbackGravado {
  id: number | string;
  checkout_id: string;
  recebido_em: string;
  anuncio_id: string | null;
  pedido_ref: string | null;
  soma: number | string | null;
}

interface CheckoutDoPostback {
  id: string;
  user_id: string;
}

const COLUNAS_POSTBACK = "id, checkout_id, recebido_em, anuncio_id, pedido_ref, soma";

/** Mais avisos que isto na janela de um postback: nao da para dizer qual e (nao casa). */
const MAX_AVISOS_NA_JANELA = 200;

/** Postbacks que o cron decide por passada (de 10 em 10 min). */
const POR_PASSADA = 50;

/** O nome do anuncio, do conjunto e da campanha que a sincronizacao do Meta viu nos ultimos 90 dias. */
const DIAS_DO_ANUNCIO = 90;

/** Os pedidos do checkout que o postback pode ser; null = avisos demais na janela. */
async function candidatos(
  admin: Admin,
  checkoutId: string,
  recebidoMs: number,
  pedidoRef: string | null
): Promise<CandidatoPostback[] | null> {
  const { data: avisos, error } = await admin
    .from("checkout_externo_eventos")
    .select("pedido_id, recebido_em")
    .eq("checkout_id", checkoutId)
    .in("evento", [...EVENTOS_DO_POSTBACK])
    .gte("recebido_em", new Date(recebidoMs - JANELA_POSTBACK_MS).toISOString())
    .lte("recebido_em", new Date(recebidoMs + JANELA_POSTBACK_MS).toISOString())
    .limit(MAX_AVISOS_NA_JANELA);
  if (error) throw new Error(`falha ao ler os avisos: ${error.message}`);
  const lista = (avisos ?? []) as { pedido_id: string; recebido_em: string }[];
  if (lista.length >= MAX_AVISOS_NA_JANELA) return null;

  const porPedido = new Map<string, number[]>();
  for (const a of lista) {
    const ms = Date.parse(a.recebido_em);
    if (!Number.isFinite(ms)) continue;
    const id = String(a.pedido_id);
    porPedido.set(id, [...(porPedido.get(id) ?? []), ms]);
  }
  if (pedidoRef && !porPedido.has(pedidoRef)) porPedido.set(pedidoRef, []);
  if (porPedido.size === 0) return [];

  const { data: pedidos, error: erroPedidos } = await admin
    .from("pedidos_externos")
    .select("pedido_id, receita")
    .eq("checkout_id", checkoutId)
    .in("pedido_id", [...porPedido.keys()]);
  if (erroPedidos) throw new Error(`falha ao ler os pedidos: ${erroPedidos.message}`);
  const receitas = new Map(
    ((pedidos ?? []) as { pedido_id: string; receita: unknown }[]).map((p) => [
      String(p.pedido_id),
      p.receita === null || p.receita === undefined ? null : paraNumero(p.receita),
    ])
  );
  // Todo pedido com aviso conta, gravado ou nao: o que esta no meio da
  // gravacao nao pode sumir e deixar o outro sozinho na janela.
  return [...porPedido.entries()].map(([pedidoId, avisosMs]) => ({
    pedidoId,
    gravado: receitas.has(pedidoId),
    receita: receitas.get(pedidoId) ?? null,
    avisosMs,
  }));
}

/** O anuncio como a sincronizacao do Meta o conhece; null = nao achou (fica so o id). */
async function anuncioConhecido(admin: Admin, userId: string, anuncioId: string, agora: Date): Promise<AnuncioConhecido | null> {
  const desde = new Date(agora.getTime() - DIAS_DO_ANUNCIO * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("ad_insights_granular")
    .select("plataforma, objeto_nome, grupo_id, grupo_nome, campanha_id, campanha_nome")
    .eq("user_id", userId)
    .eq("nivel", "anuncio")
    .eq("objeto_id", anuncioId)
    .gte("data", desde)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const l = data as Record<string, string | null>;
  return {
    plataforma: l.plataforma ?? null,
    anuncioNome: l.objeto_nome ?? null,
    conjuntoId: l.grupo_id ?? null,
    conjuntoNome: l.grupo_nome ?? null,
    campanhaId: l.campanha_id ?? null,
    campanhaNome: l.campanha_nome ?? null,
  };
}

/**
 * A origem no pedido, so se ele ainda nao tem nenhuma (o primeiro que casou
 * fica). Nao mexe na versao: o aviso do webhook so grava a UTM quando o
 * estado dele a tem (repo-supabase.ts), entao nao apaga esta.
 */
async function gravarOrigem(
  admin: Admin,
  checkout: CheckoutDoPostback,
  pedidoId: string,
  anuncioId: string,
  agora: Date
): Promise<"gravou" | "mesma" | "outra" | "sem_pedido"> {
  const anuncio = await anuncioConhecido(admin, checkout.user_id, anuncioId, agora).catch(() => null);
  const { data, error } = await admin
    .from("pedidos_externos")
    .update(origemDoAnuncio(anuncioId, anuncio))
    .eq("checkout_id", checkout.id)
    .eq("pedido_id", pedidoId)
    .is("anuncio_id", null)
    .is("conjunto_id", null)
    .is("campanha_id", null)
    .is("utm_campaign", null)
    .is("utm_content", null)
    .select("pedido_id");
  if (error) throw new Error(`falha ao gravar a origem do pedido: ${error.message}`);
  if ((data ?? []).length > 0) return "gravou";
  const { data: atual, error: erroAtual } = await admin
    .from("pedidos_externos")
    .select("anuncio_id")
    .eq("checkout_id", checkout.id)
    .eq("pedido_id", pedidoId)
    .maybeSingle();
  if (erroAtual) throw new Error(`falha ao ler o pedido: ${erroAtual.message}`);
  if (!atual) return "sem_pedido";
  return (atual as { anuncio_id: string | null }).anuncio_id === anuncioId ? "mesma" : "outra";
}

/** Marca so o que ainda esta pendente: a decisao de uma passada nao desfaz a de outra. */
async function marcar(admin: Admin, id: PostbackGravado["id"], campos: Record<string, unknown>) {
  const { error } = await admin.from("checkout_externo_postbacks").update(campos).eq("id", id).eq("situacao", "pendente");
  if (error) throw new Error(`falha ao marcar o postback: ${error.message}`);
}

/** Pedido escolhido: grava a origem e marca o postback ("conflito" = o pedido ja tinha outro anuncio). */
async function aplicar(
  admin: Admin,
  checkout: CheckoutDoPostback,
  pb: PostbackGravado,
  pedidoId: string,
  agora: Date
): Promise<ResultadoPostback> {
  const r = await gravarOrigem(admin, checkout, pedidoId, pb.anuncio_id!, agora);
  if (r === "sem_pedido") return "pendente";
  const situacao = r === "outra" ? "conflito" : "casado";
  await marcar(admin, pb.id, { situacao, pedido_id: pedidoId, casado_em: situacao === "casado" ? agora.toISOString() : null });
  return situacao;
}

/** A decisao pela hora, com a janela ja fechada. */
async function decidir(admin: Admin, checkout: CheckoutDoPostback, pb: PostbackGravado, agora: Date): Promise<ResultadoPostback> {
  const recebidoMs = Date.parse(pb.recebido_em);
  const lista = await candidatos(admin, checkout.id, recebidoMs, pb.pedido_ref);
  const r = lista
    ? casarPostback(
        { recebidoMs, pedidoRef: pb.pedido_ref, soma: pb.soma === null || pb.soma === undefined ? null : paraNumero(pb.soma) },
        lista
      )
    : ({ tipo: "ambiguo" } as const);
  if (r.tipo === "esperar") return "pendente";
  if (r.tipo === "nenhum") {
    await marcar(admin, pb.id, { situacao: "sem_pedido" });
    return "sem_pedido";
  }
  if (r.tipo === "ambiguo") {
    await marcar(admin, pb.id, { situacao: "ambiguo" });
    return "ambiguo";
  }
  return aplicar(admin, checkout, pb, r.pedidoId, agora);
}

/**
 * O postback que chegou: grava e casa SO pelo `{t}` (a hora espera a janela
 * fechar, no cron). Erro de banco LANCA (a rota responde 503).
 */
export async function receberPostback(
  admin: Admin,
  checkout: CheckoutDoPostback,
  p: PostbackLido,
  agora: Date
): Promise<ResultadoPostback> {
  const { data, error } = await admin
    .from("checkout_externo_postbacks")
    .insert({
      checkout_id: checkout.id,
      recebido_em: agora.toISOString(),
      clickid: p.clickid,
      anuncio_id: p.anuncioId,
      pedido_ref: p.pedidoRef,
      soma: p.soma,
      moeda: p.moeda,
      status: p.status,
      situacao: p.anuncioId ? "pendente" : "sem_anuncio",
    })
    .select(COLUNAS_POSTBACK)
    .single();
  if (error) throw new Error(`falha ao gravar o postback: ${error.message}`);
  const pb = data as unknown as PostbackGravado;
  if (!pb.anuncio_id) return "sem_anuncio";
  if (!pb.pedido_ref) return "pendente";
  const lista = await candidatos(admin, checkout.id, agora.getTime(), pb.pedido_ref);
  const pedidoId = lista ? casarPeloId(pb.pedido_ref, lista) : null;
  return pedidoId ? aplicar(admin, checkout, pb, pedidoId, agora) : "pendente";
}

/**
 * O cron (drain de 10 em 10 min): decide os postbacks pendentes cuja janela
 * ja fechou, e apaga o que passou dos 30 dias. Erro de banco LANCA (o drain
 * registra e segue).
 */
export async function decidirPostbacks(admin: Admin, agora: Date): Promise<Record<ResultadoPostback, number>> {
  const contagem: Record<ResultadoPostback, number> = {
    casado: 0,
    pendente: 0,
    ambiguo: 0,
    sem_pedido: 0,
    sem_anuncio: 0,
    conflito: 0,
  };
  const { data, error } = await admin
    .from("checkout_externo_postbacks")
    .select(COLUNAS_POSTBACK)
    .eq("situacao", "pendente")
    .lte("recebido_em", new Date(agora.getTime() - JANELA_POSTBACK_MS).toISOString())
    .gte("recebido_em", new Date(agora.getTime() - PRAZO_DECISAO_MS).toISOString())
    .order("recebido_em", { ascending: true })
    .limit(POR_PASSADA);
  if (error) throw new Error(`falha ao ler os postbacks: ${error.message}`);
  const postbacks = (data ?? []) as unknown as PostbackGravado[];

  if (postbacks.length > 0) {
    const ids = [...new Set(postbacks.map((p) => p.checkout_id))];
    const { data: cks, error: erroCk } = await admin.from("checkouts_externos").select("id, user_id").in("id", ids);
    if (erroCk) throw new Error(`falha ao ler os checkouts: ${erroCk.message}`);
    const porId = new Map(((cks ?? []) as CheckoutDoPostback[]).map((c) => [c.id, c]));
    for (const pb of postbacks) {
      const ck = porId.get(pb.checkout_id);
      if (!ck) continue;
      contagem[await decidir(admin, ck, pb, agora)] += 1;
    }
  }

  const { error: erroPurge } = await admin
    .from("checkout_externo_postbacks")
    .delete()
    .lt("recebido_em", new Date(agora.getTime() - RETENCAO_POSTBACK_MS).toISOString());
  if (erroPurge) throw new Error(`falha ao apagar os postbacks velhos: ${erroPurge.message}`);
  return contagem;
}
