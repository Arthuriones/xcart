import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { createClient } from "@/lib/supabase/server";
import { listarCheckoutsDoUsuario, listarLojasDoUsuario } from "@/lib/filtro-global";
import {
  MOEDAS_RELATORIO,
  MOEDA_PADRAO,
  PERIODOS,
  PERIODO_PADRAO,
  TETO_PERSONALIZADO_DIAS,
  TODAS,
  VOLTA_MAXIMA_DIAS,
} from "@/lib/financeiro/tipos";
import {
  COMPARACAO_PADRAO,
  ROTULO_COMPARACAO,
  ROTULO_PERIODO,
  ROTULO_PERSONALIZADO,
  type Comparacao,
} from "@/components/layout/contexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/app/v1/eu -- quem esta logado no app e o que o seletor do topo
// oferece: lojas, checkouts, periodos, moedas, comparacao e o filtro padrao
// (o app manda a escolha de volta nos cabecalhos x-xc-*).
//
// Nada de plano, preco ou assinatura (regra 3.1.1 da Apple) e nada de admin:
// sai so o que esta escrito aqui, nunca o user/perfil inteiro.
// ============================================================================

type Nome = { nome: string | null; sobrenome: string | null };

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Nome e sobrenome do cadastro (077), pela sessao (RLS: o proprio perfil). */
async function lerNome(userId: string): Promise<Nome> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("nome, sobrenome").eq("id", userId).maybeSingle();
  if (error) {
    // Sem a 077 (42703) ou falha: sem nome, o app mostra o e-mail. Nao derruba a tela.
    if (error.code !== "42703") console.error("[app/eu] nome nao lido", error.code);
    return { nome: null, sobrenome: null };
  }
  const linha = (data ?? {}) as Record<string, unknown>;
  return { nome: texto(linha.nome), sobrenome: texto(linha.sobrenome) };
}

export async function GET() {
  const s = await sessaoDoApp();
  if (s.resposta) return s.resposta;
  const { user } = s;

  let lojas: Awaited<ReturnType<typeof listarLojasDoUsuario>>;
  let checkouts: Awaited<ReturnType<typeof listarCheckoutsDoUsuario>>;
  let nome: Nome;
  try {
    [lojas, checkouts, nome] = await Promise.all([listarLojasDoUsuario(), listarCheckoutsDoUsuario(), lerNome(user.id)]);
  } catch (e) {
    // Erro de banco nas lojas nao vira "nenhuma loja": o app oferece tentar de novo.
    console.error("[app/eu]", e);
    return erroDoApp(503, "leitura_falhou", "Não conseguimos abrir sua conta agora. Tente de novo.");
  }

  return respostaDoApp({
    usuario: { id: user.id, email: user.email ?? null, ...nome },
    lojas: lojas.map((l) => ({ id: l.id, nome: l.nome, dominio: l.dominio })),
    checkouts: checkouts.map((c) => ({ id: c.id, nome: c.nome, plataforma: c.dominio, modelo: c.modelo ?? "comissao" })),
    periodos: PERIODOS.map((p) => ({ id: p.id, rotulo: ROTULO_PERIODO[p.id], curto: p.rotulo })),
    // x-xc-periodo tambem aceita datas do calendario: "AAAA-MM-DD_AAAA-MM-DD".
    personalizado: { rotulo: ROTULO_PERSONALIZADO, tetoDias: TETO_PERSONALIZADO_DIAS, voltaMaximaDias: VOLTA_MAXIMA_DIAS },
    moedas: MOEDAS_RELATORIO.map((m) => ({ id: m, rotulo: m })),
    comparacoes: (Object.keys(ROTULO_COMPARACAO) as Comparacao[]).map((c) => ({ id: c, rotulo: ROTULO_COMPARACAO[c] })),
    filtroPadrao: { loja: TODAS, periodo: PERIODO_PADRAO, moeda: MOEDA_PADRAO, comparar: COMPARACAO_PADRAO },
  });
}
