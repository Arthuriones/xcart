import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Os dados do cadastro (migration 077) para o admin: nome, sobrenome,
// telefone e CPF/CNPJ de cada perfil. Quem chama ja conferiu o is_admin
// (GET /api/admin/overview e /api/admin/users/[id]).
//
// Consulta A PARTE da do perfil: sem a 077 aplicada a coluna nao existe
// (42703), e se ela estivesse no select principal a lista de usuarios saia
// vazia e o detalhe dava 404. Assim a tela sai igual, so sem esses dados.
// Telefone e documento sao dado pessoal: o erro loga so o codigo.
// ============================================================================

type ClienteAdmin = ReturnType<typeof createAdminClient>;

export interface CadastroDoPerfil {
  nome: string | null;
  sobrenome: string | null;
  /** So digitos. */
  telefone: string | null;
  /** So digitos (profiles.document_number, a mesma coluna da cobranca Pix). */
  documento: string | null;
}

type LinhaCadastro = {
  id: string;
  nome: string | null;
  sobrenome: string | null;
  telefone: string | null;
  document_number: string | null;
};

/** Por id do usuario. Sem `id`, todos (a lista do admin). */
export async function lerCadastros(admin: ClienteAdmin, id?: string): Promise<Map<string, CadastroDoPerfil>> {
  let consulta = admin.from("profiles").select("id, nome, sobrenome, telefone, document_number");
  if (id) consulta = consulta.eq("id", id);
  const { data, error } = await consulta;
  const mapa = new Map<string, CadastroDoPerfil>();
  if (error) {
    if (error.code !== "42703") console.error("[admin] dados do cadastro nao lidos", error.code);
    return mapa;
  }
  for (const l of (data || []) as LinhaCadastro[]) {
    mapa.set(l.id, {
      nome: l.nome,
      sobrenome: l.sobrenome,
      telefone: l.telefone,
      documento: l.document_number,
    });
  }
  return mapa;
}
