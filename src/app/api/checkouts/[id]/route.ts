import { createAdminClient } from "@/lib/supabase/admin";
import {
  MOEDAS_COMISSAO,
  fusoValido,
  nomeValido,
  type CheckoutExternoRow,
} from "@/lib/checkouts-externos/tipos";
import {
  NAO_ENCONTRADO,
  checkoutDaSessao,
  json,
  novoToken,
  resumoDoCheckout,
  urlPublica,
  usuarioDaSessao,
} from "@/lib/checkouts-externos/servidor";
import { diasDoFusoNovo } from "@/lib/checkouts-externos/dia-local";
import { COLUNAS_CHECKOUT } from "@/lib/checkouts-externos/tipos";

export const runtime = "nodejs";

// ============================================================================
// PATCH /api/checkouts/[id]: renomear, pausar, moeda e fuso, taxa padrao,
// aviso de comissao aprovada e "Trocar URL" (token novo; o antigo morre na
// hora). DELETE remove o checkout: os pedidos e eventos vao junto (cascade da
// 069) e a conta de anuncio ligada fica sem checkout.
// ============================================================================

interface Corpo {
  nome?: unknown;
  ativo?: unknown;
  moeda_receita?: unknown;
  fuso?: unknown;
  taxa_aprovacao_padrao?: unknown;
  notificar_aprovada?: unknown;
  trocarUrl?: unknown;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  let atual: CheckoutExternoRow | null;
  try {
    atual = await checkoutDaSessao(id);
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler o checkout: ${e instanceof Error ? e.message : e}` });
  }
  if (!atual) return NAO_ENCONTRADO();

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }
  if (!corpo || typeof corpo !== "object") return json(400, { ok: false, erro: "Corpo inválido." });

  const mudanca: Record<string, unknown> = {};
  if (corpo.nome !== undefined) {
    const nome = nomeValido(corpo.nome);
    if (!nome) return json(400, { ok: false, erro: "Dê um nome de 1 a 80 letras." });
    mudanca.nome = nome;
  }
  for (const campo of ["ativo", "notificar_aprovada"] as const) {
    if (corpo[campo] === undefined) continue;
    if (typeof corpo[campo] !== "boolean") return json(400, { ok: false, erro: `${campo} inválido.` });
    mudanca[campo] = corpo[campo];
  }
  if (corpo.moeda_receita !== undefined) {
    const m = String(corpo.moeda_receita).toUpperCase();
    if (!(MOEDAS_COMISSAO as readonly string[]).includes(m)) return json(400, { ok: false, erro: "Moeda inválida." });
    mudanca.moeda_receita = m;
  }
  let fusoNovo: string | null = null;
  if (corpo.fuso !== undefined) {
    fusoNovo = fusoValido(corpo.fuso);
    if (!fusoNovo) return json(400, { ok: false, erro: "Fuso inválido." });
    if (fusoNovo !== atual.fuso) mudanca.fuso = fusoNovo;
    else fusoNovo = null;
  }
  if (corpo.taxa_aprovacao_padrao !== undefined) {
    const t = Number(corpo.taxa_aprovacao_padrao);
    if (!Number.isFinite(t) || t < 0 || t > 100) return json(400, { ok: false, erro: "Taxa de 0 a 100%." });
    mudanca.taxa_aprovacao_padrao = Math.round(t * 100) / 100;
  }
  const trocarUrl = corpo.trocarUrl === true;
  if (Object.keys(mudanca).length === 0 && !trocarUrl) return json(400, { ok: false, erro: "Nada para mudar." });

  const admin = createAdminClient();
  let salvo = atual;
  if (Object.keys(mudanca).length > 0) {
    mudanca.updated_at = new Date().toISOString();
    const { data, error } = await admin
      .from("checkouts_externos")
      .update(mudanca)
      .eq("id", atual.id)
      .eq("user_id", user.id)
      .select(COLUNAS_CHECKOUT);
    if (error) return json(500, { ok: false, erro: `Falha ao salvar: ${error.message}` });
    if (!data || data.length === 0) return NAO_ENCONTRADO();
    salvo = data[0] as CheckoutExternoRow;
  }

  // Fuso novo: o dia de cada pedido muda junto (o periodo do Dashboard le
  // por dia_local). Um update por dia com pedido, pela faixa de criado_em.
  let aviso: string | null = null;
  if (fusoNovo) {
    try {
      await diasDoFusoNovo(admin, atual.id, fusoNovo);
    } catch (e) {
      console.error("[checkouts] regravar dia_local", e instanceof Error ? e.message : e);
      aviso = "Fuso salvo, mas os dias dos pedidos antigos não foram refeitos. Salve de novo.";
    }
  }

  let url: string | null = null;
  if (trocarUrl) {
    const { token, token_hash } = novoToken();
    const { error } = await admin
      .from("checkout_externo_segredos")
      .upsert({ checkout_id: atual.id, token, token_hash, updated_at: new Date().toISOString() }, { onConflict: "checkout_id" });
    if (error) return json(500, { ok: false, erro: `Falha ao trocar a URL: ${error.message}` });
    url = urlPublica(token);
  }

  return json(200, { ok: true, checkout: resumoDoCheckout(salvo), ...(url ? { url } : {}), ...(aviso ? { aviso } : {}) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  let atual: CheckoutExternoRow | null;
  try {
    atual = await checkoutDaSessao(id);
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler o checkout: ${e instanceof Error ? e.message : e}` });
  }
  if (!atual) return NAO_ENCONTRADO();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("checkouts_externos")
    .delete()
    .eq("id", atual.id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return json(500, { ok: false, erro: `Falha ao remover: ${error.message}` });
  if (!data || data.length === 0) return NAO_ENCONTRADO();
  return json(200, { ok: true });
}
