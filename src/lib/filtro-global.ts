import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  COOKIE_LOJA,
  COOKIE_MOEDA,
  COOKIE_PERIODO,
  TODAS,
  filtroDeCookies,
  type FiltroGlobal,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";
import {
  COOKIE_COMPARAR,
  comparacaoDeCookie,
  type Comparacao,
} from "@/components/layout/contexto";

// ============================================================================
// O filtro global (loja, periodo, moeda) mora em COOKIE, nao na URL.
//
// O layout do App Router nao recebe searchParams e nao rerenderiza na
// navegacao: um seletor no topo que dependesse da URL se perderia a cada
// clique no menu. Cookie viaja em toda requisicao -- a pagina le no servidor,
// o seletor grava no navegador (document.cookie) e chama router.refresh().
// ============================================================================

export async function lerFiltroGlobal(): Promise<FiltroGlobal> {
  const c = await cookies();
  return filtroDeCookies({
    loja: c.get(COOKIE_LOJA)?.value,
    periodo: c.get(COOKIE_PERIODO)?.value,
    moeda: c.get(COOKIE_MOEDA)?.value,
  });
}

/**
 * "Comparar com" da barra do topo. Fica fora de FiltroGlobal de proposito:
 * quem ja le o filtro continua igual, e so a tela que mostra comparacao
 * (Lucro) precisa pedir este valor.
 */
export async function lerComparacao(): Promise<Comparacao> {
  const c = await cookies();
  return comparacaoDeCookie(c.get(COOKIE_COMPARAR)?.value);
}

/** Lojas do usuario da sessao, para seletor e nomes. Erro de banco LANCA. */
export const listarLojasDoUsuario = cache(async (): Promise<LojaDoSeletor[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, shop_domain")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Falha ao ler as lojas: ${error.message}`);
  return (data || []).map((l: { id: string; name: string | null; shop_domain: string | null }) => {
    const dominio = String(l.shop_domain || "");
    return { id: String(l.id), nome: String(l.name || dominio), dominio };
  });
});

/**
 * O filtro conferido contra as lojas do usuario. Loja alheia, apagada ou lixo
 * no cookie vira TODAS -- nunca erro, nunca dado de outro.
 */
export async function filtroResolvido(): Promise<{
  filtro: FiltroGlobal;
  lojas: LojaDoSeletor[];
  /** As lojas que a tela deve considerar: a escolhida, ou todas. */
  lojaIds: string[];
}> {
  const [filtroCru, lojas] = await Promise.all([lerFiltroGlobal(), listarLojasDoUsuario()]);
  const escolhida = lojas.find((l) => l.id === filtroCru.lojaId);
  const filtro: FiltroGlobal = escolhida ? filtroCru : { ...filtroCru, lojaId: TODAS };
  return { filtro, lojas, lojaIds: escolhida ? [escolhida.id] : lojas.map((l) => l.id) };
}
