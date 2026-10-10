import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_CHECKOUTS,
  MOEDAS_COMISSAO,
  PLATAFORMAS_CHECKOUT,
  fusoValido,
  nomeValido,
  semMigration069,
  type CheckoutExternoRow,
} from "@/lib/checkouts-externos/tipos";
import { COLUNAS_CHECKOUT } from "@/lib/checkouts-externos/tipos";
import { json, novoToken, resumoDoCheckout, urlPublica, usuarioDaSessao } from "@/lib/checkouts-externos/servidor";

export const runtime = "nodejs";

// ============================================================================
// POST /api/checkouts: cadastra um checkout externo e devolve a URL do webhook
// para o lojista colar na plataforma.
//
// Checkout externo NAO passa por conferirLigarRastreamento/conferirRoteamento
// (src/lib/billing/limites.ts): nao entra no rastreamento nem no roteamento,
// entao nao conta no limite do plano. O teto aqui (MAX_CHECKOUTS) e so contra
// abuso.
// ============================================================================

interface Corpo {
  plataforma?: unknown;
  nome?: unknown;
  moeda_receita?: unknown;
  fuso?: unknown;
}

export async function POST(request: Request) {
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }
  if (!corpo || typeof corpo !== "object") return json(400, { ok: false, erro: "Corpo inválido." });

  const plataforma = PLATAFORMAS_CHECKOUT.find((p) => p.id === corpo.plataforma && p.ativa);
  if (!plataforma) return json(400, { ok: false, erro: "Plataforma ainda não disponível." });
  const nome = nomeValido(corpo.nome);
  if (!nome) return json(400, { ok: false, erro: "Dê um nome de 1 a 80 letras." });
  const moeda = corpo.moeda_receita === undefined ? "EUR" : String(corpo.moeda_receita).toUpperCase();
  if (!(MOEDAS_COMISSAO as readonly string[]).includes(moeda)) return json(400, { ok: false, erro: "Moeda inválida." });
  const fuso = corpo.fuso === undefined || corpo.fuso === "" ? "America/Sao_Paulo" : fusoValido(corpo.fuso);
  if (!fuso) return json(400, { ok: false, erro: "Fuso inválido." });

  // Conta pela sessao (RLS): so os checkouts do proprio usuario.
  const supabase = await createClient();
  const { count, error: erroConta } = await supabase
    .from("checkouts_externos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (erroConta) {
    if (semMigration069(erroConta)) return json(503, { ok: false, erro: "Cadastro de checkout ainda não liberado. Tente mais tarde." });
    return json(500, { ok: false, erro: `Falha ao ler os checkouts: ${erroConta.message}` });
  }
  if ((count ?? 0) >= MAX_CHECKOUTS) {
    return json(409, { ok: false, erro: `Limite de ${MAX_CHECKOUTS} checkouts. Remova um para adicionar outro.` });
  }

  const admin = createAdminClient();
  const { data: criado, error } = await admin
    .from("checkouts_externos")
    .insert({ user_id: user.id, plataforma: plataforma.id, nome, moeda_receita: moeda, fuso })
    .select(COLUNAS_CHECKOUT)
    .single();
  if (error || !criado) return json(500, { ok: false, erro: `Falha ao salvar: ${error?.message ?? "sem resposta"}` });
  const checkout = criado as CheckoutExternoRow;

  const { token, token_hash } = novoToken();
  const { error: erroSegredo } = await admin
    .from("checkout_externo_segredos")
    .insert({ checkout_id: checkout.id, token, token_hash });
  if (erroSegredo) {
    // Sem segredo o checkout nao recebe nada: melhor nao deixar a linha pela metade.
    await admin.from("checkouts_externos").delete().eq("id", checkout.id).eq("user_id", user.id);
    return json(500, { ok: false, erro: "Falha ao criar a URL. Tente de novo." });
  }

  return json(200, { ok: true, checkout: resumoDoCheckout(checkout), url: urlPublica(token) });
}
