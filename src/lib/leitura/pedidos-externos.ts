import "server-only";
import { createClient } from "@/lib/supabase/server";
import { filtroResolvido, lerCheckoutsDoUsuario } from "@/lib/filtro-global";
import { DIAS_MAX_COTACAO } from "@/lib/financeiro/calculo";
import {
  FUSO_RELATORIO_PADRAO,
  diaNoFuso,
  intervaloDoPeriodo,
  somarDias,
  type FiltroGlobal,
  type FxRateRow,
  type Intervalo,
} from "@/lib/financeiro/tipos";
import {
  montarPedidosExternos,
  type CheckoutDaTela,
  type PedidoExternoTela,
  type ResumoPedidosExternos,
} from "@/lib/checkouts-externos/pedidos";
import { COLUNAS_PEDIDO_EXTERNO, semMigration069, type PedidoExternoRow } from "@/lib/checkouts-externos/tipos";

// ============================================================================
// Leitura da tela Pedidos para checkout externo (069). So banco, pela sessao
// (RLS): pedidos_externos do periodo e o cambio. Erro de banco LANCA: a tela
// mostra o erro, nunca uma lista vazia.
// ============================================================================

const PAGINA = 1000;

export type DadosPedidosExternos =
  | { vazio: true }
  | {
      vazio: false;
      filtro: FiltroGlobal;
      intervalo: Intervalo;
      checkouts: CheckoutDaTela[];
      linhas: PedidoExternoTela[];
      resumo: ResumoPedidosExternos;
    };

export async function lerPedidosExternos(): Promise<DadosPedidosExternos> {
  const { filtro, checkoutIds } = await filtroResolvido();
  if (checkoutIds.length === 0) return { vazio: true };
  const ids = new Set(checkoutIds);
  const checkouts: CheckoutDaTela[] = (await lerCheckoutsDoUsuario())
    .filter((c) => ids.has(c.id))
    .map((c) => ({ id: c.id, nome: c.nome, fuso: c.fuso, moeda_receita: c.moeda_receita }));
  if (checkouts.length === 0) return { vazio: true };

  const fuso = checkouts.length === 1 ? checkouts[0].fuso : FUSO_RELATORIO_PADRAO;
  const intervalo = intervaloDoPeriodo(filtro.periodo, diaNoFuso(new Date(), fuso)).atual;
  const supabase = await createClient();

  const pedidos: PedidoExternoRow[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("pedidos_externos")
      .select(COLUNAS_PEDIDO_EXTERNO)
      .in("checkout_id", checkouts.map((c) => c.id))
      .gte("dia_local", intervalo.desde)
      .lte("dia_local", intervalo.ate)
      .order("checkout_id", { ascending: true })
      .order("pedido_id", { ascending: true })
      .range(de, de + PAGINA - 1)
      .overrideTypes<PedidoExternoRow[], { merge: false }>();
    if (error) {
      if (semMigration069(error)) break;
      throw new Error(`Falha ao ler os pedidos dos checkouts: ${error.message}`);
    }
    const lote = data ?? [];
    pedidos.push(...lote);
    if (lote.length < PAGINA) break;
  }

  const moedas = new Set<string>([filtro.moeda, "USD"]);
  for (const c of checkouts) moedas.add(c.moeda_receita);
  for (const p of pedidos) {
    moedas.add(String(p.moeda).toUpperCase());
    if (p.moeda_receita) moedas.add(String(p.moeda_receita).toUpperCase());
  }
  const cambio: FxRateRow[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("fx_rates")
      .select("data, moeda, por_usd, fonte")
      .in("moeda", [...moedas])
      .gte("data", somarDias(intervalo.desde, -DIAS_MAX_COTACAO))
      .lte("data", intervalo.ate)
      .order("data", { ascending: true })
      .order("moeda", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler o câmbio: ${error.message}`);
    const lote = (data ?? []) as FxRateRow[];
    cambio.push(...lote);
    if (lote.length < PAGINA) break;
  }

  const { linhas, resumo } = montarPedidosExternos({
    pedidos,
    checkouts,
    cambio,
    moeda: filtro.moeda,
    intervalo,
    agoraMs: Date.now(),
  });
  return { vazio: false, filtro, intervalo, checkouts, linhas, resumo };
}
