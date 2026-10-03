import "server-only";
import { runWithConcurrency } from "@/lib/concurrency";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { diagnosticar, type DiagnosticoLoja } from "@/lib/tracking/diagnostico";

// ============================================================================
// O diagnostico da Saude dos pixels, uma loja de cada vez.
//
// `diagnosticar` (src/lib/tracking, travado) recebe a lista inteira e roda as
// lojas juntas: se UMA lancar, ou demorar ate o limite da funcao, a tela toda
// cai -- foi o bug citado na proposta. Aqui cada loja vai numa chamada propria,
// com teto de espera e try/catch: a que falhar vira aviso so nela, e as outras
// aparecem atualizadas.
//
// So leitura: as mesmas consultas a Shopify (pedidos, inscricoes de aviso,
// tema) que a pagina ja fazia.
// ============================================================================

/** Acima disto a loja vira "nao deu para checar agora", em vez de prender a tela. */
const TETO_MS = 15_000;

/** As mesmas 4 lojas em voo do diagnostico original. */
const CONCORRENCIA = 4;

export interface DiagnosticoPorLoja {
  porLoja: Record<string, DiagnosticoLoja>;
  /** Lojas cuja conferencia lancou erro ou passou do teto. */
  falharam: string[];
}

function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error(`passou de ${ms} ms`)), ms);
  });
  return Promise.race([promessa, teto]).finally(() => clearTimeout(relogio));
}

export async function diagnosticarCadaLoja(storeIds: string[]): Promise<DiagnosticoPorLoja> {
  const porLoja: Record<string, DiagnosticoLoja> = {};
  const falharam: string[] = [];
  await runWithConcurrency(storeIds, CONCORRENCIA, async (id) => {
    try {
      const mapa = await comTeto(diagnosticar([id]), TETO_MS);
      // Sem entrada = app desinstalado: o painel ja acusa a loja por isso.
      const d = mapa.get(id);
      if (d) porLoja[id] = d;
    } catch (e) {
      console.error("[leitura/tracking-diagnostico] loja", id, e instanceof Error ? e.message : e);
      falharam.push(id);
    }
  });
  return { porLoja, falharam };
}

/**
 * "Tentar de novo" de uma loja. Confere o dono pela sessao (RLS + user_id)
 * antes de perguntar a Shopify: o diagnostico le a credencial pelo admin.
 *
 * Devolve undefined quando a loja nao e do usuario.
 */
export async function rechecarLoja(
  storeId: string
): Promise<{ diagnostico: DiagnosticoLoja | null; falhou: boolean } | undefined> {
  const user = await getCurrentUser();
  if (!user) return undefined;
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return undefined;

  const r = await diagnosticarCadaLoja([String(data.id)]);
  return {
    diagnostico: r.porLoja[String(data.id)] ?? null,
    falhou: r.falharam.length > 0,
  };
}
