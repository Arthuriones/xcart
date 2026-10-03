import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

// ============================================================================
// Leitura da Visao da rota (/overview). So leitura, pela sessao (RLS) e com o
// dono conferido em toda consulta de rota e de loja.
//
// Em dois passos, para a pagina escolher a rota no meio:
//   lerRotas()          -- a lista de rotas e o nome das lojas (barato, sem
//                          mapa de SKU). Erro LANCA: sem isso nao ha tela.
//   lerDetalheRota(...) -- destinos, carrinhos, falhas, sinal do script e
//                          eventos de UMA rota. Destinos com erro lancam; o
//                          resto devolve null na parte que falhou, e a tela
//                          mostra "—" ali, nunca zero.
//
// Diferente de src/lib/overview/queries.ts (que lia so a primeira rota e
// engolia erro), aqui cada rota pode ser escolhida e erro nunca vira "nada
// acontecendo".
// ============================================================================

const DIA = 86_400_000;
/** Janela dos carrinhos roteados: a mesma do console (getRouteGraph). */
export const DIAS_CARRINHOS = 30;
/** Janela das falhas de roteamento que viram problema na tela. */
export const DIAS_FALHAS = 7;
/** Quantos eventos recentes a tela mostra; o resto fica em Atividade. */
export const LIMITE_EVENTOS = 8;

export interface LojaDaRota {
  id: string;
  nome: string;
  dominio: string;
}

export interface RotaDaLista {
  id: string;
  nome: string;
  ativa: boolean;
  /** Vitrine da rota; null = a loja foi removida. */
  vitrine: LojaDaRota | null;
  estrategia: "sticky" | "each_checkout";
  /** Ultima passada do conserto automatico (settings.last_heal). */
  ultimoConserto: { em: string; ok: boolean; mensagem: string | null } | null;
  /** Destino da rota antiga (antes de varias lojas de checkout por rota). */
  destinoLegado: string | null;
}

export interface LeituraRotas {
  rotas: RotaDaLista[];
  lojas: LojaDaRota[];
}

export interface DestinoDaRota {
  id: string;
  lojaId: string;
  /** null = a loja foi removida do xcart. */
  loja: LojaDaRota | null;
  ligado: boolean;
  peso: number;
  /** Produtos com par por SKU nesta loja de checkout. */
  mapeados: number;
  conferidoEm: string | null;
  /** Carrinhos levados a esta loja nos ultimos 30 dias; null = nao deu para contar. */
  carrinhos: number | null;
}

export interface EventoDaRota {
  id: string;
  motivo: string;
  detalhe: string | null;
  em: string;
  destinoId: string | null;
}

export interface DetalheRota {
  /** Instante da leitura (ms): base do "ha 5 min" sem divergir na hidratacao. */
  agora: number;
  destinos: DestinoDaRota[];
  /** Carrinhos roteados pela rota em 30 dias; null = a contagem falhou. */
  carrinhos: number | null;
  /** Carrinhos que falharam ao rotear em 7 dias; null = a contagem falhou. */
  falhas: number | null;
  /** Ultima vez que o script deu sinal na vitrine. null = a leitura falhou. */
  sinal: { em: string | null } | null;
  /** Eventos recentes (sem o sinal de presenca); null = a leitura falhou. */
  eventos: EventoDaRota[] | null;
  /** O que nao veio, para o detalhe do suporte. */
  erros: string[];
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A lista de rotas do usuario, com a vitrine de cada uma. Erro de banco LANCA. */
export const lerRotas = cache(async (): Promise<LeituraRotas> => {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return { rotas: [], lojas: [] };

  const [rotas, lojas] = await Promise.all([
    supabase
      .from("routed_checkout_configs")
      .select("id, name, enabled, rotation, settings, source_store_id, target_store_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name, shop_domain")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);
  if (rotas.error) throw new Error(`Falha ao ler as rotas: ${rotas.error.message}`);
  if (lojas.error) throw new Error(`Falha ao ler as lojas: ${lojas.error.message}`);

  const listaLojas: LojaDaRota[] = (lojas.data ?? []).map(
    (l: { id: string; name: string | null; shop_domain: string | null }) => {
      const dominio = texto(l.shop_domain);
      return { id: texto(l.id), nome: texto(l.name) || dominio, dominio };
    }
  );
  const porId = new Map(listaLojas.map((l) => [l.id, l]));

  const lista: RotaDaLista[] = (rotas.data ?? []).map(
    (r: {
      id: string;
      name: string | null;
      enabled: boolean | null;
      rotation: { strategy?: string } | null;
      settings: { last_heal?: { at?: string; ok?: boolean; message?: string } } | null;
      source_store_id: string;
      target_store_id: string | null;
    }) => {
      const heal = r.settings?.last_heal;
      return {
        id: texto(r.id),
        nome: texto(r.name),
        ativa: r.enabled !== false,
        vitrine: porId.get(r.source_store_id) ?? null,
        estrategia: r.rotation?.strategy === "each_checkout" ? "each_checkout" : "sticky",
        ultimoConserto:
          heal && heal.at
            ? { em: heal.at, ok: heal.ok !== false, mensagem: heal.message ? texto(heal.message) : null }
            : null,
        destinoLegado: r.target_store_id ?? null,
      };
    }
  );

  return { rotas: lista, lojas: listaLojas };
});

type Cliente = Awaited<ReturnType<typeof createClient>>;

/** Contagem pelo indice (head: true): nao baixa linha nenhuma. */
async function contar(
  consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>
): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function eventosDaRota(supabase: Cliente, rotaId: string) {
  return supabase.from("routed_checkout_fallbacks").select("id", { count: "exact", head: true }).eq("route_config_id", rotaId);
}

/**
 * O que acontece numa rota: destinos (com o tamanho do mapa de SKU), carrinhos
 * por destino, falhas, ultimo sinal do script e eventos recentes.
 *
 * So esta rota baixa o mapa de SKU (para contar os produtos ligados); a lista
 * das outras rotas nao baixa nada disso.
 */
export async function lerDetalheRota(rota: RotaDaLista, lojas: LojaDaRota[]): Promise<DetalheRota> {
  const supabase = await createClient();
  const agora = Date.now();
  const porId = new Map(lojas.map((l) => [l.id, l]));
  const erros: string[] = [];

  // ---- destinos (obrigatorio: sem eles a tela nao tem o que mostrar) ----
  const { data: linhas, error } = await supabase
    .from("routed_checkout_targets")
    .select("id, target_store_id, enabled, weight, sku_map, last_healed_at")
    .eq("route_id", rota.id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(`Falha ao ler as lojas de checkout da rota: ${error.message}`);

  type Linha = {
    id: string;
    target_store_id: string;
    enabled: boolean | null;
    weight: number | null;
    sku_map: Record<string, unknown> | null;
    last_healed_at: string | null;
  };
  let brutos = (linhas ?? []) as Linha[];

  // Rota anterior a varias lojas de checkout, sem linha de destino: mesma
  // regra do console (getRouteGraph) -- o destino da propria rota.
  let legado = false;
  if (brutos.length === 0 && rota.destinoLegado) {
    const { data: antiga, error: erroAntiga } = await supabase
      .from("routed_checkout_configs")
      .select("sku_map, last_healed_at")
      .eq("id", rota.id)
      .maybeSingle();
    if (erroAntiga) throw new Error(`Falha ao ler o destino da rota: ${erroAntiga.message}`);
    legado = true;
    brutos = [
      {
        id: `legado:${rota.id}`,
        target_store_id: rota.destinoLegado,
        enabled: true,
        weight: 1,
        sku_map: (antiga?.sku_map as Record<string, unknown> | null) ?? null,
        last_healed_at: (antiga?.last_healed_at as string | null) ?? null,
      },
    ];
  }

  const desdeCarrinhos = new Date(agora - DIAS_CARRINHOS * DIA).toISOString();
  const desdeFalhas = new Date(agora - DIAS_FALHAS * DIA).toISOString();

  const parte = async <T,>(nome: string, f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (e) {
      console.error(`[visao-rota] ${nome}`, e);
      erros.push(`${nome}: ${mensagem(e)}`);
      return null;
    }
  };

  const [carrinhos, porDestino, falhas, sinal, eventos] = await Promise.all([
    parte("carrinhos", () =>
      contar(eventosDaRota(supabase, rota.id).eq("reason", "routed_ok").gte("created_at", desdeCarrinhos))
    ),
    // Um destino por consulta, pelo indice (target_id, created_at). Na rota
    // antiga o evento nao traz destino: o total da rota e o dele.
    Promise.all(
      brutos.map((d) =>
        legado
          ? Promise.resolve(null)
          : parte(`carrinhos da loja ${d.target_store_id}`, () =>
              contar(
                eventosDaRota(supabase, rota.id)
                  .eq("reason", "routed_ok")
                  .eq("target_id", d.id)
                  .gte("created_at", desdeCarrinhos)
              )
            )
      )
    ),
    parte("falhas", () =>
      contar(eventosDaRota(supabase, rota.id).eq("reason", "cart_checkout_error").gte("created_at", desdeFalhas))
    ),
    parte("sinal do script", async () => {
      const { data, error: e } = await supabase
        .from("routed_checkout_fallbacks")
        .select("created_at")
        .eq("route_config_id", rota.id)
        .eq("reason", "loader_ready")
        .order("created_at", { ascending: false })
        .limit(1);
      if (e) throw new Error(e.message);
      return { em: (data?.[0]?.created_at as string | undefined) ?? null };
    }),
    // "loader_ready" sai uma vez por visita: deixaria a lista so com ele.
    parte("eventos", async () => {
      const { data, error: e } = await supabase
        .from("routed_checkout_fallbacks")
        .select("id, reason, detail, created_at, target_id")
        .eq("route_config_id", rota.id)
        .neq("reason", "loader_ready")
        .order("created_at", { ascending: false })
        .limit(LIMITE_EVENTOS);
      if (e) throw new Error(e.message);
      return (data ?? []).map(
        (ev: { id: string; reason: string; detail: string | null; created_at: string; target_id: string | null }) => ({
          id: texto(ev.id),
          motivo: texto(ev.reason),
          detalhe: ev.detail ?? null,
          em: texto(ev.created_at),
          destinoId: ev.target_id ?? null,
        })
      );
    }),
  ]);

  const destinos: DestinoDaRota[] = brutos.map((d, i) => ({
    id: texto(d.id),
    lojaId: texto(d.target_store_id),
    loja: porId.get(d.target_store_id) ?? null,
    ligado: d.enabled !== false,
    peso: d.weight ?? 0,
    mapeados: Object.keys(d.sku_map || {}).length,
    conferidoEm: d.last_healed_at ?? null,
    carrinhos: legado ? carrinhos : porDestino[i],
  }));

  return { agora, destinos, carrinhos, falhas, sinal, eventos, erros };
}
