import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  COOKIE_LOJA,
  COOKIE_MOEDA,
  COOKIE_PERIODO,
  FUSO_RELATORIO_PADRAO,
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
import { nomeDaPlataforma, semMigration069 } from "@/lib/checkouts-externos/tipos";

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

/** O checkout externo com o que o Dashboard e o topo precisam (sem o token). */
export interface CheckoutDoUsuario {
  id: string;
  nome: string;
  plataforma: string;
  ativo: boolean;
  fuso: string;
  moeda_receita: string;
  taxa_aprovacao_padrao: number;
}

/**
 * Checkouts externos do usuario (migration 069), pela sessao (RLS). Sem a 069
 * aplicada, nenhum. Erro de banco LANCA, como o das lojas.
 */
export const lerCheckoutsDoUsuario = cache(async (): Promise<CheckoutDoUsuario[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checkouts_externos")
    .select("id, nome, plataforma, ativo, fuso, moeda_receita, taxa_aprovacao_padrao")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) {
    if (semMigration069(error)) return [];
    throw new Error(`Falha ao ler os checkouts: ${error.message}`);
  }
  return ((data || []) as Record<string, unknown>[]).map((c) => ({
    id: String(c.id),
    nome: String(c.nome || nomeDaPlataforma(c.plataforma as string)),
    plataforma: String(c.plataforma || ""),
    ativo: c.ativo !== false,
    fuso: String(c.fuso || FUSO_RELATORIO_PADRAO),
    moeda_receita: String(c.moeda_receita || "EUR").toUpperCase(),
    taxa_aprovacao_padrao: Number(c.taxa_aprovacao_padrao ?? 70),
  }));
});

/** Os checkouts no formato do seletor: o dominio e o nome da plataforma. */
export const listarCheckoutsDoUsuario = cache(async (): Promise<LojaDoSeletor[]> =>
  (await lerCheckoutsDoUsuario()).map((c) => ({
    id: c.id,
    nome: c.nome,
    dominio: nomeDaPlataforma(c.plataforma),
    tipo: "checkout" as const,
  }))
);

/**
 * O filtro conferido contra as lojas e os checkouts do usuario. Loja alheia,
 * apagada ou lixo no cookie vira TODAS -- nunca erro, nunca dado de outro.
 *
 * `lojas`/`lojaIds` continuam SO Shopify: quem ja usava segue igual. Com um
 * checkout escolhido, `lojaIds` vem vazio e `checkout` diz qual -- a tela so
 * de loja (Custos, Rastreamento, Eventos) mostra "Esta tela e das lojas
 * Shopify" em vez de "conecte uma loja". Com TODAS, vem tudo dos dois lados.
 */
export async function filtroResolvido(): Promise<{
  filtro: FiltroGlobal;
  lojas: LojaDoSeletor[];
  /** As lojas que a tela deve considerar: a escolhida, ou todas. */
  lojaIds: string[];
  checkouts: LojaDoSeletor[];
  /** Os checkouts que a tela deve considerar: o escolhido, ou todos. */
  checkoutIds: string[];
  /** O checkout escolhido na barra, ou null. */
  checkout: LojaDoSeletor | null;
}> {
  const [filtroCru, lojas, checkouts] = await Promise.all([
    lerFiltroGlobal(),
    listarLojasDoUsuario(),
    listarCheckoutsDoUsuario(),
  ]);
  const escolhida = lojas.find((l) => l.id === filtroCru.lojaId);
  if (escolhida) {
    return { filtro: filtroCru, lojas, lojaIds: [escolhida.id], checkouts, checkoutIds: [], checkout: null };
  }
  const checkout = checkouts.find((c) => c.id === filtroCru.lojaId) ?? null;
  if (checkout) {
    return { filtro: filtroCru, lojas, lojaIds: [], checkouts, checkoutIds: [checkout.id], checkout };
  }
  return {
    filtro: { ...filtroCru, lojaId: TODAS },
    lojas,
    lojaIds: lojas.map((l) => l.id),
    checkouts,
    checkoutIds: checkouts.map((c) => c.id),
    checkout: null,
  };
}
