import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { hashSegredo } from "@/lib/ads/google-ingest";
import { paraNumero } from "@/lib/financeiro/tipos";
import { CAMPOS_UTM, CAMPOS_VENDA, type EstadoPedido } from "./estado";
import type { CheckoutParaReceber, PedidoGravado, RepositorioCheckout } from "./receber";
import { COLUNAS_VENDA, RE_TOKEN, colunaAusente, comColunas072, comColunasEmOrdem, type SituacaoExterna } from "./tipos";

// ============================================================================
// O RepositorioCheckout de verdade: service role, tabelas da 069 (e as
// colunas da venda da 072). So o endpoint publico e as rotas /api/checkouts
// usam (a sessao nao escreve nessas tabelas -- os grants da 069 tiram
// insert/update/delete dela).
//
// Com e sem a 072: a leitura tenta as colunas novas e cai nas da 069 (42703);
// a escrita so leva as colunas da venda no modelo venda -- a Sphere grava o
// que gravava antes, com ou sem a migration.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const COLUNAS_RECEBER =
  "id, user_id, plataforma, nome, ativo, fuso, moeda_receita, notificar_aprovada, ultimo_evento_em, ultimo_evento_teste";
const COLUNAS_RECEBER_072 = `${COLUNAS_RECEBER}, notificar_pendente, notificar_estorno`;
/** E o "Mandar a compra" do rastreamento (073). */
const COLUNAS_RECEBER_073 = `${COLUNAS_RECEBER_072}, compra_quando`;

const COLUNAS_ESTADO =
  "situacao, status_comissao, status_pedido, metodo_pagamento, produto, pais, programa, moeda, valor, receita, moeda_receita, criado_em, dia_local, aprovado_em, pago_em, perdido_em, atualizado_em, versao";
const COLUNAS_ESTADO_072 = `${COLUNAS_ESTADO}, ${COLUNAS_VENDA}`;

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function textoOuNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function numeroOuNull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : paraNumero(v);
}

/** A linha do banco no formato do estado (numeric chega como string; sem a 072, as colunas da venda faltam). */
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
    referencia: textoOuNull(l.referencia),
    taxa: numeroOuNull(l.taxa),
    comissoes: numeroOuNull(l.comissoes),
    grupo: textoOuNull(l.grupo),
    oferta_tipo: textoOuNull(l.oferta_tipo),
    vence_em: iso(l.vence_em),
    reembolsado_em: iso(l.reembolsado_em),
    chargeback_em: iso(l.chargeback_em),
    reembolso_pedido_em: iso(l.reembolso_pedido_em),
    utm_source: textoOuNull(l.utm_source),
    utm_medium: textoOuNull(l.utm_medium),
    utm_campaign: textoOuNull(l.utm_campaign),
    utm_content: textoOuNull(l.utm_content),
    utm_term: textoOuNull(l.utm_term),
    campanha_id: textoOuNull(l.campanha_id),
    conjunto_id: textoOuNull(l.conjunto_id),
    anuncio_id: textoOuNull(l.anuncio_id),
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

  const checkoutId = (seg as { checkout_id: string }).checkout_id;
  // Com e sem a 073 (compra_quando) e com e sem a 072 (os avisos da venda).
  const { data: ck, error: erroCk } = await comColunasEmOrdem([COLUNAS_RECEBER_073, COLUNAS_RECEBER_072, COLUNAS_RECEBER], (colunas) =>
    admin.from("checkouts_externos").select(colunas).eq("id", checkoutId).maybeSingle()
  );
  if (erroCk) throw new Error(`falha ao ler o checkout: ${erroCk.message}`);
  return (ck as unknown as CheckoutParaReceber | null) ?? null;
}

/**
 * O secret do webhook da plataforma (Cakto), ou null (nao cadastrado, ou o
 * banco sem a 072). So o service role: a tabela nao tem policy. Erro de
 * banco LANCA.
 */
export async function segredoDaPlataforma(admin: Admin, checkoutId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("checkout_externo_segredos")
    .select("segredo_plataforma")
    .eq("checkout_id", checkoutId)
    .maybeSingle();
  if (error) {
    if (colunaAusente(error)) return null;
    throw new Error(`falha ao ler o secret: ${error.message}`);
  }
  const s = (data as { segredo_plataforma?: string | null } | null)?.segredo_plataforma;
  return s ? String(s) : null;
}

function linhaDoPedido(p: EstadoPedido, venda: boolean) {
  const linha: Record<string, unknown> = {
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
  // Venda: as colunas da 072. Comissao: so as da 069 (grava sem a migration)
  // -- mais a UTM e os ids do anuncio (072) quando o aviso trouxe o clique.
  if (venda) for (const k of CAMPOS_VENDA) linha[k] = p[k];
  else if (CAMPOS_UTM.some((k) => p[k] !== null && p[k] !== undefined)) for (const k of CAMPOS_UTM) linha[k] = p[k];
  return linha;
}

/** A linha sem a UTM: a comissao gravando num banco sem as colunas da 072. */
function semUtm(linha: Record<string, unknown>): Record<string, unknown> {
  const saida = { ...linha };
  for (const k of CAMPOS_UTM) delete saida[k];
  return saida;
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
      const { error } = await admin
        .from("checkout_externo_eventos")
        .delete()
        .eq("checkout_id", x.checkout_id)
        .eq("pedido_id", x.pedido_id)
        .eq("evento", x.evento);
      // Quem chama registra; a retentativa refaz pela trava sem pedido (receber.ts).
      if (error) throw new Error(`falha ao soltar a trava do evento: ${error.message}`);
    },
    async travaRecebidaEm(x) {
      const { data, error } = await admin
        .from("checkout_externo_eventos")
        .select("recebido_em")
        .eq("checkout_id", x.checkout_id)
        .eq("pedido_id", x.pedido_id)
        .eq("evento", x.evento)
        .maybeSingle();
      if (error) throw new Error(`falha ao ler a trava do evento: ${error.message}`);
      return ((data as { recebido_em?: string | null } | null)?.recebido_em ?? null) || null;
    },
    async lerPedido(checkoutId, pedidoId) {
      const { data, error } = await comColunas072(COLUNAS_ESTADO_072, COLUNAS_ESTADO, (colunas) =>
        admin.from("pedidos_externos").select(colunas).eq("checkout_id", checkoutId).eq("pedido_id", pedidoId).maybeSingle()
      );
      if (error) throw new Error(`falha ao ler o pedido: ${error.message}`);
      return data ? estadoDaLinha(data as unknown as Record<string, unknown>) : null;
    },
    async inserirPedido(x) {
      const linha = linhaDoPedido(x.pedido, x.venda === true);
      const inserir = (l: Record<string, unknown>) =>
        admin.from("pedidos_externos").insert({
          checkout_id: x.checkout_id,
          user_id: x.user_id,
          pedido_id: x.pedido_id,
          ...l,
          versao: 0,
        });
      let { error } = await inserir(linha);
      // Comissao com UTM num banco sem a 072: grava como antes, sem ela.
      if (error && x.venda !== true && colunaAusente(error)) ({ error } = await inserir(semUtm(linha)));
      if (error?.code === "23505") return "existe";
      if (error) throw new Error(`falha ao gravar o pedido: ${error.message}`);
      return "ok";
    },
    async atualizarPedido(x) {
      const linha = linhaDoPedido(x.pedido, x.venda === true);
      const atualizar = (l: Record<string, unknown>) =>
        admin
          .from("pedidos_externos")
          .update({ ...l, versao: x.versao + 1 })
          .eq("checkout_id", x.checkout_id)
          .eq("pedido_id", x.pedido_id)
          .eq("versao", x.versao)
          .select("pedido_id");
      let { data, error } = await atualizar(linha);
      if (error && x.venda !== true && colunaAusente(error)) ({ data, error } = await atualizar(semUtm(linha)));
      if (error) throw new Error(`falha ao atualizar o pedido: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async reivindicarConta(x) {
      const dono = async (): Promise<string | null> => {
        const { data, error } = await admin
          .from("checkout_externo_contas")
          .select("checkout_id")
          .eq("user_id", x.user_id)
          .eq("plataforma", x.plataforma)
          .eq("conta", x.conta)
          .maybeSingle();
        if (error) throw new Error(`falha ao ler o afiliado: ${error.message}`);
        return (data as { checkout_id: string } | null)?.checkout_id ?? null;
      };
      const antes = await dono();
      if (antes) return antes === x.checkout_id ? "ok" : "em_uso";
      const { error } = await admin.from("checkout_externo_contas").insert(x);
      if (!error) return "ok";
      if (error.code !== "23505") throw new Error(`falha ao ligar o afiliado: ${error.message}`);
      // Outro evento ligou no meio (a mesma conta mandando aos dois checkouts).
      return (await dono()) === x.checkout_id ? "ok" : "em_uso";
    },
    async marcarCheckout(checkoutId, campos) {
      const marcar = (c: typeof campos) =>
        admin
          .from("checkouts_externos")
          .update({ ...c, updated_at: new Date().toISOString() })
          .eq("id", checkoutId);
      let { error } = await marcar(campos);
      // Sem a 085 (ultimo_formato): marca o resto como antes.
      if (error && campos.ultimo_formato !== undefined && colunaAusente(error)) {
        const { ultimo_formato: _semColuna, ...resto } = campos;
        void _semColuna;
        ({ error } = await marcar(resto));
      }
      if (error) console.error("[checkout/webhook] falha ao marcar o checkout", error.message);
    },
  };
}
