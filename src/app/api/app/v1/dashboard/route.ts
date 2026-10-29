import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { lerComparacao } from "@/lib/filtro-global";
import { getFinanceiro } from "@/lib/financeiro/queries";
import { montarConexao, montarPainel, painelDoApp, type ContaDaConexao } from "@/lib/financeiro/painel";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/app/v1/dashboard -- o Dashboard no celular, com loja, periodo,
// moeda e comparacao dos cabecalhos x-xc-*.
//
// O calculo e o de sempre (getFinanceiro) e a montagem e a da tela
// (montarPainel, src/lib/financeiro/painel.ts): mesmos numeros, mesmos textos.
// Resposta: { ok, vazio: true } sem loja nem checkout, ou o painelDoApp.
//
// Diferente de page.tsx, NAO chama lerBaseLucro de novo: o cache() do React
// so memoriza dentro da renderizacao (pagina), e numa rota cada chamada le o
// banco -- seriam os pedidos de dois periodos lidos duas vezes. As contas e
// as lojas desinstaladas sao duas consultas leves sobre as lojas que
// getFinanceiro ja resolveu.
// ============================================================================

/** stores.uninstalled_at das lojas marcadas (id -> ISO), como page.tsx. Erro LANCA. */
async function lerDesinstaladas(lojaIds: string[]): Promise<Record<string, string>> {
  if (lojaIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.from("stores").select("id, uninstalled_at").in("id", lojaIds);
  if (error) throw new Error(error.message);
  const saida: Record<string, string> = {};
  for (const l of (data ?? []) as { id: string; uninstalled_at: string | null }[]) {
    if (l.uninstalled_at) saida[String(l.id)] = l.uninstalled_at;
  }
  return saida;
}

/** As contas de anuncio do usuario: as mesmas linhas que lerBaseLucro le. Erro LANCA. */
async function lerContas(userId: string): Promise<ContaDaConexao[]> {
  const supabase = await createClient();
  // "*": checkout_id so existe com a 069, e nomear a coluna daria 42703 sem ela.
  const { data, error } = await supabase.from("ad_accounts").select("*").eq("user_id", userId).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as ContaDaConexao[];
}

export async function GET() {
  const s = await sessaoDoApp();
  if (s.resposta) return s.resposta;

  let comparacao: Awaited<ReturnType<typeof lerComparacao>>;
  let dados: Awaited<ReturnType<typeof getFinanceiro>>;
  try {
    [comparacao, dados] = await Promise.all([lerComparacao(), getFinanceiro()]);
  } catch (e) {
    // Erro de banco aparece; nunca vira zero. Zero diria "nao vendeu".
    console.error("[app/dashboard] calculo", e);
    return erroDoApp(503, "leitura_falhou", "Não conseguimos carregar o Dashboard agora. Tente de novo.");
  }
  if (dados.vazio) return respostaDoApp({ vazio: true });

  // Como page.tsx: sem as marcas ou sem as contas, a tela abre igual, so sem
  // os avisos que dependem delas.
  const [marcas, contas] = await Promise.allSettled([lerDesinstaladas(dados.lojaIds), lerContas(s.user.id)]);
  if (marcas.status === "rejected") console.error("[app/dashboard] lojas desinstaladas", marcas.reason);
  if (contas.status === "rejected") console.error("[app/dashboard] contas de anuncio", contas.reason);

  const conexao = montarConexao(
    dados,
    contas.status === "fulfilled" ? contas.value : null,
    marcas.status === "fulfilled" ? marcas.value : {}
  );
  const painel = montarPainel(dados, comparacao, conexao, Date.now());
  return respostaDoApp(painelDoApp(painel, dados, comparacao));
}
