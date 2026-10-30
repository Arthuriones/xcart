import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessControlEnabled, profileHasAccess } from "@/lib/billing/access";
import { ErroGraph, alterarObjetoMeta, lerObjetoMeta } from "@/lib/ads/meta-graph";
import { classificarErroMeta } from "@/lib/ads/meta-mapear";
import {
  CAMPOS_LEITURA,
  objetoAoVivoDaResposta,
  validarAlteracao,
  type CampoEdicao,
  type NivelEdicao,
  type ObjetoAoVivo,
} from "@/lib/ads/gerenciar-regras";

// ============================================================================
// Gerenciar anuncios do Meta (plano-de-acao/03): banco + Graph. A regra pura
// (validacao, avaliacao das regras) e gerenciar-regras.ts.
//
// Toda alteracao, a mao ou por regra, passa por aplicarAlteracao:
// 1. le o objeto AO VIVO no Meta e confere que ele e DESTA conta (o token do
//    perfil enxerga outras contas: o id vindo da tela nao pode editar uma
//    conta que o lojista nao ligou aqui);
// 2. confere o valor que a tela viu (`esperado`): mudou no Meta desde entao,
//    devolve o de agora em vez de sobrescrever;
// 3. valida dentro da estrategia que ja existe e grava;
// 4. guarda no historico (ad_alteracoes) e corrige o retrato do sync
//    (ad_insights_granular) para a tela nao mostrar o valor velho ate a
//    proxima rodada de 15 min.
// O token NUNCA sai daqui: nem resposta, nem log, nem historico.
// ============================================================================

type Db = SupabaseClient;

export interface ContaGerenciavel {
  id: string;
  user_id: string;
  external_id: string;
  nome: string | null;
  moeda: string;
  fuso: string | null;
  store_id: string | null;
  checkout_id: string | null;
  ultimo_sync_ok_em: string | null;
}

export const ERRO_SEM_EDICAO =
  "O Meta não deixou editar: falta a permissão de edição. Em Integrações, reconecte o perfil do Facebook e marque \"Permitir editar campanhas\".";

/** Erro da Graph -> frase da tela (nunca a URL nem o token). */
export function textoDoErroDeEdicao(e: unknown): string {
  if (e instanceof ErroGraph) {
    const tipo = classificarErroMeta(e.codigo);
    if (tipo === "token") return "O Meta recusou o token desta conta. Reconecte o perfil do Facebook em Integrações.";
    if (tipo === "permissao") return ERRO_SEM_EDICAO;
    if (tipo === "limite") return "Limite de alterações do Meta atingido. Tente de novo em alguns minutos.";
    return `O Meta recusou: ${e.detalhe ?? e.message}`.slice(0, 300);
  }
  if (e instanceof Error && /falha de rede|resposta invalida/.test(e.message)) {
    return "Não conseguimos falar com o Meta agora. Tente de novo.";
  }
  return "Falha inesperada ao falar com o Meta.";
}

/** Plano com acesso total (admin, liberado ou Pro valendo). */
export async function temAcessoAEdicao(userId: string): Promise<boolean> {
  if (!accessControlEnabled()) return true;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select(
      "is_admin, plan, access_granted, free_clone_store_id, payment_provider, pagou_subscription_id, abacatepay_subscription_id, subscription_status, current_period_end"
    )
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return profileHasAccess(data);
}

const COLUNAS_CONTA = "id, user_id, external_id, nome, moeda, fuso, store_id, checkout_id, ultimo_sync_ok_em";

/** A conta do Meta DESTE usuario (service role + filtro pelo dono). */
export async function contaDoUsuario(db: Db, userId: string, contaId: string): Promise<ContaGerenciavel | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contaId)) return null;
  const { data, error } = await db
    .from("ad_accounts")
    .select(COLUNAS_CONTA)
    .eq("id", contaId)
    .eq("user_id", userId)
    .eq("plataforma", "meta")
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a conta: ${error.message}`);
  if (!data || !data.moeda) return null;
  return data as ContaGerenciavel;
}

export async function tokenDaConta(db: Db, contaId: string): Promise<string | null> {
  const { data, error } = await db
    .from("ad_account_secrets")
    .select("meta_access_token")
    .eq("ad_account_id", contaId)
    .maybeSingle();
  if (error) throw new Error("Falha ao ler o token da conta.");
  const t = (data as { meta_access_token?: string | null } | null)?.meta_access_token;
  return typeof t === "string" && t ? t : null;
}

/** Le o objeto no Meta agora. null = nao existe ou e de OUTRA conta. */
export async function lerAoVivo(
  conta: ContaGerenciavel,
  token: string,
  nivel: NivelEdicao,
  objetoId: string
): Promise<ObjetoAoVivo | null> {
  if (!/^[0-9]{5,25}$/.test(objetoId)) return null;
  const json = await lerObjetoMeta(objetoId, CAMPOS_LEITURA[nivel], token);
  const obj = objetoAoVivoDaResposta(json, nivel, conta.moeda);
  if (!obj || obj.conta !== conta.external_id.replace(/\D/g, "")) return null;
  return obj;
}

/** O valor do campo no objeto, como texto do historico (o mesmo formato de `antes`). */
export function valorDoCampo(obj: ObjetoAoVivo, campo: CampoEdicao): string | null {
  const n = (v: number | null) => (v === null ? null : String(v));
  switch (campo) {
    case "status":
      return obj.status || null;
    case "orcamento_diario":
      return n(obj.diario);
    case "orcamento_total":
      return n(obj.total);
    case "lance":
      return n(obj.lance);
    case "roas_minimo":
      return n(obj.roasMinimo);
  }
}

/** O objeto como deve ter ficado, quando a releitura no Meta falha. */
function depoisPeloPedido(obj: ObjetoAoVivo, campo: CampoEdicao, depois: string): ObjetoAoVivo {
  const n = Number(depois);
  switch (campo) {
    case "status":
      // Pausar e pausar; ativar so fica ACTIVE se a campanha e o conjunto estiverem.
      return { ...obj, status: depois, efetivo: depois === "PAUSED" ? "PAUSED" : obj.efetivo };
    case "orcamento_diario":
      return { ...obj, diario: n };
    case "orcamento_total":
      return { ...obj, total: n };
    case "lance":
      return { ...obj, lance: n };
    case "roas_minimo":
      return { ...obj, roasMinimo: n };
  }
}

export type ResultadoAlteracao =
  | { ok: true; objeto: ObjetoAoVivo; antes: string; depois: string }
  | { ok: false; erro: string; conflito?: ObjetoAoVivo; status: number };

const tabelaAusente = (code?: string) => code === "42P01" || code === "PGRST205";

async function registrar(
  db: Db,
  linha: {
    user_id: string;
    ad_account_id: string;
    nivel: NivelEdicao;
    objeto_id: string;
    objeto_nome: string | null;
    campo: CampoEdicao;
    antes: string | null;
    depois: string | null;
    origem: "manual" | "regra";
    regra_id: string | null;
    ok: boolean;
    erro: string | null;
  }
): Promise<void> {
  const { error } = await db.from("ad_alteracoes").insert(linha);
  // Sem a 087 o historico some, mas a alteracao vale (ja foi feita no Meta).
  if (error && !tabelaAusente(error.code)) {
    console.error("[gerenciar] falha ao gravar o historico", error.message);
  }
}

const NIVEL_GRANULAR: Record<NivelEdicao, string> = { campanha: "campanha", grupo: "grupo", anuncio: "anuncio" };

/** Corrige o retrato do dia mais recente do objeto na aba Campanhas. */
async function corrigirRetrato(db: Db, conta: ContaGerenciavel, obj: ObjetoAoVivo): Promise<void> {
  const { data } = await db
    .from("ad_insights_granular")
    .select("data")
    .eq("ad_account_id", conta.id)
    .eq("nivel", NIVEL_GRANULAR[obj.nivel])
    .eq("objeto_id", obj.id)
    .order("data", { ascending: false })
    .limit(1)
    .maybeSingle();
  const dia = (data as { data?: string } | null)?.data;
  if (!dia) return;
  const campos: Record<string, unknown> = { objeto_status: obj.efetivo || obj.status };
  if (obj.nivel !== "anuncio") campos.orcamento = obj.diario ?? 0;
  const { error } = await db
    .from("ad_insights_granular")
    .update(campos)
    .eq("ad_account_id", conta.id)
    .eq("nivel", NIVEL_GRANULAR[obj.nivel])
    .eq("objeto_id", obj.id)
    .eq("data", dia);
  if (error) console.error("[gerenciar] falha ao corrigir o retrato", error.message);
}

export interface MudancaPedida {
  campo: CampoEdicao;
  valor: unknown;
  /** O valor que a tela viu; diferente do de agora = conflito, nada e gravado. */
  esperado?: string | null;
}

/** Uma mudanca so (o interruptor, as regras). */
export async function aplicarAlteracao(p: {
  db: Db;
  conta: ContaGerenciavel;
  token: string;
  nivel: NivelEdicao;
  objetoId: string;
  campo: CampoEdicao;
  valor: unknown;
  esperado?: string | null;
  origem: "manual" | "regra";
  regraId?: string | null;
}): Promise<ResultadoAlteracao> {
  return aplicarAlteracoes({ ...p, mudancas: [{ campo: p.campo, valor: p.valor, esperado: p.esperado }] });
}

/**
 * Varias mudancas do MESMO objeto num POST so: o Meta aceita uma edicao por
 * objeto a cada 30 s (613/4841018), e o painel que muda orcamento e lance
 * juntos tomaria o erro na segunda chamada. Tudo ou nada: uma mudanca
 * invalida ou um esperado que nao bate barra o pedido inteiro.
 */
export async function aplicarAlteracoes(p: {
  db: Db;
  conta: ContaGerenciavel;
  token: string;
  nivel: NivelEdicao;
  objetoId: string;
  mudancas: MudancaPedida[];
  origem: "manual" | "regra";
  regraId?: string | null;
}): Promise<ResultadoAlteracao> {
  const { db, conta, token, nivel, objetoId, mudancas } = p;
  if (mudancas.length === 0) return { ok: false, erro: "Nada para mudar.", status: 400 };
  if (new Set(mudancas.map((m) => m.campo)).size !== mudancas.length) {
    return { ok: false, erro: "Campo repetido no pedido.", status: 400 };
  }

  let obj: ObjetoAoVivo | null;
  try {
    obj = await lerAoVivo(conta, token, nivel, objetoId);
  } catch (e) {
    return { ok: false, erro: textoDoErroDeEdicao(e), status: 502 };
  }
  if (!obj) return { ok: false, erro: "Objeto não encontrado nesta conta do Meta.", status: 404 };

  for (const m of mudancas) {
    if (m.esperado !== undefined && m.esperado !== null && valorDoCampo(obj, m.campo) !== m.esperado) {
      return {
        ok: false,
        erro: "O valor mudou no Meta desde que a tela abriu. Confira o valor atual e tente de novo.",
        conflito: obj,
        status: 409,
      };
    }
  }

  const validas: { campo: CampoEdicao; antes: string; depois: string }[] = [];
  const campos: Record<string, string> = {};
  for (const m of mudancas) {
    const v = validarAlteracao(obj, m.campo, m.valor);
    if (!v.ok) return { ok: false, erro: v.erro, status: 400 };
    Object.assign(campos, v.campos);
    validas.push({ campo: m.campo, antes: v.antes, depois: v.depois });
  }

  const base = {
    user_id: conta.user_id,
    ad_account_id: conta.id,
    nivel,
    objeto_id: obj.id,
    objeto_nome: obj.nome,
    origem: p.origem,
    regra_id: p.regraId ?? null,
  };

  try {
    await alterarObjetoMeta(obj.id, campos, token);
  } catch (e) {
    const erro = textoDoErroDeEdicao(e);
    for (const v of validas) await registrar(db, { ...base, ...v, ok: false, erro });
    return { ok: false, erro, status: 502 };
  }
  for (const v of validas) await registrar(db, { ...base, ...v, ok: true, erro: null });

  // O estado de depois (status efetivo, orcamento), relido no Meta. Se a
  // releitura falhar, a alteracao ja valeu: monta o de depois pelo pedido.
  let pedido: ObjetoAoVivo = obj;
  for (const v of validas) pedido = depoisPeloPedido(pedido, v.campo, v.depois);
  let depois: ObjetoAoVivo = pedido;
  try {
    depois = (await lerAoVivo(conta, token, nivel, obj.id)) ?? pedido;
  } catch {
    depois = pedido;
  }
  await corrigirRetrato(db, conta, depois);
  return {
    ok: true,
    objeto: depois,
    antes: validas.map((v) => v.antes).join(", "),
    depois: validas.map((v) => v.depois).join(", "),
  };
}
