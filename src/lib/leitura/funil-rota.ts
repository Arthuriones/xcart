import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import {
  CHAVE_PEDIDOS,
  CHAVE_VITRINE,
  DIAS_DO_FUNIL,
  MOTIVO_ESCAPE,
  inicioDaContagem,
  lerInscricao,
  montarFunil,
  type FunilDaRota,
} from "@/lib/checkout-routes/sensor";

// ============================================================================
// O funil da rota nos ultimos 7 dias: carrinhos levados, escapes para o
// checkout da vitrine, erros do script e pedidos na loja de checkout. So
// leitura, pela sessao (RLS: so linha do dono).
//
// Tudo em contagem (head: true), nunca baixando linha: o PostgREST corta em
// 1000, e uma rota com anuncio passa disso. As regras de "conta ou nao conta"
// (aviso da Shopify ligado, desde quando) estao em sensor.ts.
// ============================================================================

const DIA = 86_400_000;

type Consulta = PromiseLike<{ count: number | null; error: { message: string } | null }>;

/** null = a contagem falhou (a tela mostra "—", nunca zero). */
async function contar(consulta: Consulta): Promise<number | null> {
  const { count, error } = await consulta;
  if (error) {
    console.error("[funil-rota] contagem", error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * Erro do banco nas leituras da rota LANCA (a tela diz que nao deu para ler);
 * erro numa contagem so apaga aquele numero.
 */
export async function lerFunilDaRota(rotaId: string, agora: number = Date.now()): Promise<FunilDaRota | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const [rota, destinos] = await Promise.all([
    supabase
      .from("routed_checkout_configs")
      .select("id, settings, source_store_id, target_store_id")
      .eq("id", rotaId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("routed_checkout_targets")
      .select("id, target_store_id, settings")
      .eq("route_id", rotaId)
      .eq("enabled", true),
  ]);
  if (rota.error) throw new Error(`[funil-rota] rota: ${rota.error.message}`);
  if (destinos.error) throw new Error(`[funil-rota] lojas de checkout: ${destinos.error.message}`);
  if (!rota.data) return null;

  type Destino = { id: string; target_store_id: string; settings: unknown };
  const linhas = (destinos.data || []) as Destino[];
  const r = rota.data as { settings: unknown; source_store_id: string; target_store_id: string | null };
  // Rota antiga sem linha de destino: a loja da propria rota, sem inscricao
  // gravada (o sensor confere so linha de destino) -- fica "conferindo".
  const alvos =
    linhas.length > 0
      ? linhas.map((d) => ({ storeId: d.target_store_id, inscricao: lerInscricao(d.settings, CHAVE_PEDIDOS) }))
      : r.target_store_id
        ? [{ storeId: r.target_store_id, inscricao: null }]
        : [];

  const ids = [...new Set([r.source_store_id, ...alvos.map((a) => a.storeId)].filter(Boolean))];
  const { data: lojas } = await supabase.from("stores").select("id, name, shop_domain").in("id", ids);
  const nomes = new Map(
    ((lojas || []) as { id: string; name: string | null; shop_domain: string | null }[]).map((l) => [
      l.id,
      l.name || l.shop_domain || "Loja",
    ])
  );

  const inscricaoVitrine = lerInscricao(r.settings, CHAVE_VITRINE);
  const desdeJanela = new Date(agora - DIAS_DO_FUNIL * DIA).toISOString();
  const inicioEscapes = inicioDaContagem([inscricaoVitrine], agora);
  const inicioPedidos = inicioDaContagem(
    alvos.map((a) => a.inscricao),
    agora
  );

  const eventos = (reason: string, desde: string) =>
    supabase
      .from("routed_checkout_fallbacks")
      .select("id", { count: "exact", head: true })
      .eq("route_config_id", rotaId)
      .eq("reason", reason)
      .gte("created_at", desde);

  // A conversao compara a mesma janela dos dois lados: se o aviso de pedidos
  // foi ligado no meio da semana, os carrinhos de antes nao entram.
  const janelaPedidosMaisCurta = inicioPedidos !== null && inicioPedidos > agora - DIAS_DO_FUNIL * DIA + 3_600_000;

  const [roteados, erroCarrinho, erroDireto, escapes, pedidos, roteadosDesde] = await Promise.all([
    contar(eventos("routed_ok", desdeJanela)),
    contar(eventos("cart_checkout_error", desdeJanela)),
    contar(eventos("direct_checkout_error", desdeJanela)),
    inicioEscapes === null ? Promise.resolve(null) : contar(eventos(MOTIVO_ESCAPE, new Date(inicioEscapes).toISOString())),
    inicioPedidos === null
      ? Promise.resolve(null)
      : contar(
          supabase
            .from("routed_checkout_orders")
            .select("store_id", { count: "exact", head: true })
            .in(
              "store_id",
              alvos.map((a) => a.storeId)
            )
            .gte("created_at", new Date(inicioPedidos).toISOString())
        ),
    janelaPedidosMaisCurta && inicioPedidos !== null
      ? contar(eventos("routed_ok", new Date(inicioPedidos).toISOString()))
      : Promise.resolve(undefined),
  ]);

  return montarFunil({
    agora,
    roteados,
    erros: { cart_checkout_error: erroCarrinho, direct_checkout_error: erroDireto },
    vitrine: {
      nome: nomes.get(r.source_store_id) || "Vitrine",
      inscricao: inscricaoVitrine,
      escapes,
      desde: inicioEscapes,
    },
    lojas: alvos.map((a) => ({ nome: nomes.get(a.storeId) || "Loja de checkout", inscricao: a.inscricao })),
    pedidos: {
      n: pedidos,
      desde: inicioPedidos,
      roteadosDesde: roteadosDesde === undefined ? roteados : roteadosDesde,
    },
  });
}
