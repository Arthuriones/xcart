import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import type { AdAccountRow, ContaAnuncioResumo } from "@/lib/financeiro/tipos";
import { semMigration069 } from "@/lib/checkouts-externos/tipos";

// ============================================================================
// Contas de anuncio como a TELA ve.
//
// O segredo (token do Meta, hash do script do Google) mora em
// ad_account_secrets, tabela sem policy: so o service role le. Daqui sai SO o
// booleano temSegredo -- nem o hash volta para o navegador.
// ============================================================================

export const COLUNAS_CONTA =
  "id, user_id, store_id, plataforma, external_id, nome, moeda, fuso, fonte, ativo, ultimo_sync_ok_em, ultimo_erro";

type LinhaConta = Pick<
  AdAccountRow,
  | "id"
  | "store_id"
  | "checkout_id"
  | "plataforma"
  | "external_id"
  | "nome"
  | "moeda"
  | "fuso"
  | "fonte"
  | "ativo"
  | "ultimo_sync_ok_em"
  | "ultimo_erro"
>;

export function resumoDaConta(c: LinhaConta, temSegredo: boolean): ContaAnuncioResumo {
  return {
    id: String(c.id),
    plataforma: c.plataforma,
    external_id: String(c.external_id),
    nome: c.nome ?? null,
    moeda: c.moeda ?? null,
    fuso: c.fuso ?? null,
    store_id: c.store_id ?? null,
    checkout_id: c.checkout_id ?? null,
    ativo: Boolean(c.ativo),
    fonte: c.fonte,
    ultimo_sync_ok_em: c.ultimo_sync_ok_em ?? null,
    ultimo_erro: c.ultimo_erro ?? null,
    temSegredo,
  };
}

/** Contas do usuario da sessao. Erro de banco LANCA: a tela mostra, nao esconde. */
export async function listarContasDoUsuario(): Promise<ContaAnuncioResumo[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const ler = (colunas: string) =>
    supabase.from("ad_accounts").select(colunas).eq("user_id", user.id).order("created_at", { ascending: true });
  // checkout_id so existe depois da 069: sem ela, a lista antiga.
  let { data, error } = await ler(`${COLUNAS_CONTA}, checkout_id`);
  if (error && semMigration069(error)) ({ data, error } = await ler(COLUNAS_CONTA));
  if (error) throw new Error(`Falha ao ler as contas de anúncio: ${error.message}`);

  const contas = (data || []) as unknown as LinhaConta[];
  if (contas.length === 0) return [];

  const admin = createAdminClient();
  const { data: segredos, error: erroSegredo } = await admin
    .from("ad_account_secrets")
    .select("ad_account_id, meta_access_token, ingest_token_hash")
    .in(
      "ad_account_id",
      contas.map((c) => c.id)
    );
  if (erroSegredo) {
    throw new Error(`Falha ao conferir os tokens das contas: ${erroSegredo.message}`);
  }

  const porConta = new Map<string, { meta_access_token: string | null; ingest_token_hash: string | null }>();
  for (const s of segredos || []) porConta.set(String(s.ad_account_id), s);

  return contas.map((c) => {
    const s = porConta.get(String(c.id));
    const tem = c.plataforma === "meta" ? Boolean(s?.meta_access_token) : Boolean(s?.ingest_token_hash);
    return resumoDaConta(c, tem);
  });
}
