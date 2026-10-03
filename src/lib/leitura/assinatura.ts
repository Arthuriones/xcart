import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { billingEnforced } from "@/lib/billing/credits";
import type { PerfilAssinatura } from "@/components/billing/regras";

// ============================================================================
// Leitura da Assinatura e do paywall (redesign). So leitura, pela sessao
// (RLS: cada um le o proprio perfil, uso e compras).
//
// Existe porque /api/billing/me engole a falha: se o perfil nao vem, ela
// responde plano "free" e 0 creditos, e a tela mostrava isso como verdade.
// Aqui cada leitura devolve o PROPRIO erro: sem perfil a tela mostra o erro;
// sem o uso do mes ou sem o historico, o resto continua com um aviso.
//
// O CPF nunca sai daqui: so o booleano "ja tem documento salvo".
// A sincronizacao com o processador continua em GET /api/billing/subscription,
// chamada pela tela depois de montar (ela grava, entao nao mora numa leitura).
// ============================================================================

export interface CompraDoHistorico {
  id: string;
  criadaEm: string;
  kind: string | null;
  credits: number;
  amountCents: number;
  method: string | null;
  provider: string | null;
  status: string | null;
}

export interface LeituraAssinatura {
  /** Usuario da sessao (o layout ja garante que existe). */
  logado: boolean;
  perfil:
    | (PerfilAssinatura & {
        saldo: number;
        temDocumento: boolean;
        /** Ja gastou a clonagem gratuita (o motivo do paywall). */
        usouClonagemGratis: boolean;
      })
    | null;
  /** Creditos gastos no mes corrente (UTC), somados do registro de uso. */
  usadosNoMes: number | null;
  /** Primeiro dia do mes contado, "2026-10-01". */
  inicioDoMes: string;
  compras: CompraDoHistorico[] | null;
  /** O debito de credito esta ligado nesta instalacao. */
  cobrancaDeCreditoLigada: boolean;
  /** Instante da leitura (ms): base de "vence em N dias" sem divergir na hidratacao. */
  agora: number;
  erros: { perfil: string | null; uso: string | null; compras: string | null };
}

/** Quantas compras o historico mostra (as mais recentes). */
export const LIMITE_COMPRAS = 20;

const TAMANHO_PAGINA = 1000;
const PAGINAS_USO = 20;

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface LinhaPerfil {
  plan: string | null;
  subscription_status: string | null;
  ai_credits: number | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  payment_provider: string | null;
  pagou_subscription_id: string | null;
  access_granted: boolean | null;
  is_admin: boolean | null;
  document_number: string | null;
  free_clone_store_id: string | null;
}

interface LinhaCompra {
  id: string;
  created_at: string;
  kind: string | null;
  credits: number | null;
  amount_cents: number | null;
  method: string | null;
  provider: string | null;
  status: string | null;
}

/** Quanto do perfil o paywall precisa: sem uso nem historico. */
export async function lerAssinatura(opcoes: { completo?: boolean } = {}): Promise<LeituraAssinatura> {
  const completo = opcoes.completo ?? true;
  const agora = Date.now();
  const mes = new Date(agora);
  mes.setUTCDate(1);
  mes.setUTCHours(0, 0, 0, 0);

  const leitura: LeituraAssinatura = {
    logado: false,
    perfil: null,
    usadosNoMes: null,
    inicioDoMes: mes.toISOString().slice(0, 10),
    compras: null,
    cobrancaDeCreditoLigada: billingEnforced(),
    agora,
    erros: { perfil: null, uso: null, compras: null },
  };

  let user;
  try {
    user = await getCurrentUser();
  } catch (e) {
    leitura.erros.perfil = mensagem(e);
    return leitura;
  }
  if (!user) {
    leitura.erros.perfil = "sem sessão";
    return leitura;
  }
  leitura.logado = true;

  const supabase = await createClient();
  const userId = user.id;

  // So as linhas que gastaram credito, em paginas: o PostgREST corta em 1000
  // linhas sem avisar, e a soma sairia menor do que foi gasto.
  const somarUso = async (): Promise<{ total: number | null; erro: string | null }> => {
    let total = 0;
    for (let pagina = 0; pagina < PAGINAS_USO; pagina++) {
      const de = pagina * TAMANHO_PAGINA;
      const { data, error } = await supabase
        .from("ai_usage_log")
        .select("credits_used")
        .eq("user_id", userId)
        .gt("credits_used", 0)
        .gte("created_at", mes.toISOString())
        .order("created_at", { ascending: true })
        .range(de, de + TAMANHO_PAGINA - 1);
      if (error) return { total: null, erro: error.message };
      const linhas = (data || []) as { credits_used: number | null }[];
      for (const r of linhas) total += Number(r.credits_used) || 0;
      if (linhas.length < TAMANHO_PAGINA) return { total, erro: null };
    }
    // Passou do teto: melhor "—" do que um numero menor que o real.
    return { total: null, erro: "uso do mês acima do limite de leitura" };
  };

  const [perfil, uso, compras] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "plan, subscription_status, ai_credits, current_period_end, cancel_at_period_end, payment_provider, pagou_subscription_id, access_granted, is_admin, document_number, free_clone_store_id"
      )
      .eq("id", userId)
      .maybeSingle(),
    completo ? somarUso().catch((e) => ({ total: null, erro: mensagem(e) })) : null,
    completo
      ? supabase
          .from("credit_purchases")
          .select("id, created_at, kind, credits, amount_cents, method, provider, status")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(LIMITE_COMPRAS)
      : null,
  ]);

  if (perfil.error) {
    leitura.erros.perfil = perfil.error.message;
  } else if (!perfil.data) {
    // Conta recem-criada cujo perfil ainda nao existe: nao e "free com 0".
    leitura.erros.perfil = "perfil ainda não criado";
  } else {
    const p = perfil.data as LinhaPerfil;
    leitura.perfil = {
      plano: p.plan,
      status: p.subscription_status,
      fimPeriodo: p.current_period_end,
      cancelaNoFim: p.cancel_at_period_end === true,
      provedor: p.payment_provider,
      temAssinaturaCartao: !!p.pagou_subscription_id,
      acessoLiberado: p.is_admin === true || p.access_granted === true,
      saldo: Number(p.ai_credits) || 0,
      temDocumento: !!String(p.document_number || "").replace(/\D/g, ""),
      usouClonagemGratis: !!p.free_clone_store_id,
    };
  }

  if (uso) {
    leitura.usadosNoMes = uso.total;
    leitura.erros.uso = uso.erro;
  }

  if (compras) {
    if (compras.error) leitura.erros.compras = compras.error.message;
    else
      leitura.compras = ((compras.data || []) as LinhaCompra[]).map((c) => ({
        id: c.id,
        criadaEm: c.created_at,
        kind: c.kind,
        credits: Number(c.credits) || 0,
        amountCents: Number(c.amount_cents) || 0,
        method: c.method,
        provider: c.provider,
        status: c.status,
      }));
  }

  return leitura;
}
