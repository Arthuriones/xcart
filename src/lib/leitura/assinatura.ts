import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { billingEnforced } from "@/lib/billing/credits";
import {
  acimaDoLimite,
  lerUso,
  limitesDoPerfil,
  resumoDoUso,
  semColunaPlano,
  type OrigemDoLimite,
} from "@/lib/billing/limites";
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
  /** Tier do Pix de 30 dias. */
  plano: string | null;
  credits: number;
  amountCents: number;
  method: string | null;
  provider: string | null;
  status: string | null;
}

/** Limite de lojas do plano e o uso de agora, ja em frase. */
export interface UsoDoPlano {
  origem: OrigemDoLimite;
  /** "1/1 lojas com rastreamento · 2/6 no roteamento" */
  resumo: string;
  /** Ja passou de algum limite (o que esta ligado continua). */
  acima: boolean;
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
  /** Limite de lojas e uso. null = nao lido (paywall) ou a leitura falhou. */
  uso: UsoDoPlano | null;
  /** O debito de credito esta ligado nesta instalacao. */
  cobrancaDeCreditoLigada: boolean;
  /** Instante da leitura (ms): base de "vence em N dias" sem divergir na hidratacao. */
  agora: number;
  erros: { perfil: string | null; uso: string | null; compras: string | null; lojas: string | null };
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
  plano?: string | null;
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
  plano?: string | null;
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
    uso: null,
    cobrancaDeCreditoLigada: billingEnforced(),
    agora,
    erros: { perfil: null, uso: null, compras: null, lojas: null },
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

  const COLUNAS_PERFIL =
    "plan, subscription_status, ai_credits, current_period_end, cancel_at_period_end, payment_provider, pagou_subscription_id, access_granted, is_admin, document_number, free_clone_store_id";
  const COLUNAS_COMPRA = "id, created_at, kind, credits, amount_cents, method, provider, status";

  // `plano` e da migration 064. Sem a coluna, le sem ela: a conta aparece como
  // Pro antigo em vez de a tela inteira dar erro.
  const lerPerfil = async () => {
    const r = await supabase
      .from("profiles")
      .select(`${COLUNAS_PERFIL}, plano`)
      .eq("id", userId)
      .maybeSingle();
    if (!semColunaPlano(r.error)) return r;
    return supabase.from("profiles").select(COLUNAS_PERFIL).eq("id", userId).maybeSingle();
  };
  const lerCompras = async () => {
    const r = await supabase
      .from("credit_purchases")
      .select(`${COLUNAS_COMPRA}, plano`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(LIMITE_COMPRAS);
    if (!semColunaPlano(r.error)) return r;
    return supabase
      .from("credit_purchases")
      .select(COLUNAS_COMPRA)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(LIMITE_COMPRAS);
  };

  const [perfil, uso, compras, lojas] = await Promise.all([
    lerPerfil(),
    completo ? somarUso().catch((e) => ({ total: null, erro: mensagem(e) })) : null,
    completo ? lerCompras() : null,
    completo
      ? lerUso(supabase, userId).then(
          (u) => ({ u, erro: null }),
          (e) => ({ u: null, erro: mensagem(e) })
        )
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
      tier: p.plano ?? null,
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

  if (lojas && perfil.data) {
    if (lojas.u) {
      const limites = limitesDoPerfil(perfil.data as LinhaPerfil);
      const contagem = { rastreamento: lojas.u.rastreamento.size, roteamento: lojas.u.roteamento.size };
      leitura.uso = {
        origem: limites.origem,
        resumo: resumoDoUso(limites, contagem),
        acima: acimaDoLimite(limites, contagem),
      };
    } else {
      leitura.erros.lojas = lojas.erro;
    }
  }

  if (compras) {
    if (compras.error) leitura.erros.compras = compras.error.message;
    else
      leitura.compras = ((compras.data || []) as LinhaCompra[]).map((c) => ({
        id: c.id,
        criadaEm: c.created_at,
        kind: c.kind,
        plano: c.plano ?? null,
        credits: Number(c.credits) || 0,
        amountCents: Number(c.amount_cents) || 0,
        method: c.method,
        provider: c.provider,
        status: c.status,
      }));
  }

  return leitura;
}
