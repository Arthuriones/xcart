import "server-only";
import { createClient } from "@/lib/supabase/server";
import { criarConversor } from "@/lib/financeiro/calculo";
import {
  FUSO_RELATORIO_PADRAO,
  diaNoFuso,
  somarDias,
  type FxRateRow,
  type Intervalo,
} from "@/lib/financeiro/tipos";
import {
  janelaDaConsulta,
  somarGastoPorConta,
  type GastoDaConta,
  type LinhaGastoConta,
} from "./gasto-por-conta-soma";

// ============================================================================
// Leitura nova (#12): gasto de hoje e do periodo de cada conta de anuncio.
//
// O que le: ad_spend_daily (nivel 'conta') das contas pedidas e fx_rates das
// moedas que aparecem. So SELECT, pela SESSAO -- a RLS da 052 so deixa ler o
// gasto de conta do proprio usuario. Nada de Meta ou Google aqui: o gasto ja
// esta gravado pelo cron (Meta) e pelo script (Google).
//
// A conta e a conversao usam as mesmas regras do Lucro (criarConversor de
// src/lib/financeiro/calculo.ts, chamado sem alteracao). A soma em si mora em
// gasto-por-conta-soma.ts, que o vitest testa.
//
// Erro de banco LANCA: quem chama mostra "nao deu para ler o gasto", nunca 0.
// ============================================================================

const PAGINA = 1000;

/** Cotacao velha aceita pelo conversor (DIAS_MAX_COTACAO do calculo). */
const FOLGA_CAMBIO_DIAS = 10;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

async function lerTudo<T>(
  rotulo: string,
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler ${rotulo}: ${error.message}`);
    const lote = data ?? [];
    saida.push(...lote);
    if (lote.length < PAGINA) return saida;
  }
}

export interface ContaParaGasto {
  id: string;
  /** Fuso IANA da conta; vazio cai em Sao Paulo. */
  fuso: string | null;
}

/**
 * Gasto por conta. `intervalo` e o periodo do relatorio (o mesmo do Lucro);
 * `moeda`, a moeda da barra do topo.
 */
export async function lerGastoPorConta(opcoes: {
  contas: ContaParaGasto[];
  intervalo: Intervalo;
  moeda: string;
  agora?: Date;
}): Promise<Map<string, GastoDaConta>> {
  const { contas, intervalo, moeda } = opcoes;
  if (contas.length === 0) return new Map();
  const agora = opcoes.agora ?? new Date();

  const hojePorConta: Record<string, string> = {};
  for (const c of contas) hojePorConta[c.id] = diaNoFuso(agora, c.fuso || FUSO_RELATORIO_PADRAO);
  const janela = janelaDaConsulta(intervalo, Object.values(hojePorConta));
  const ids = contas.map((c) => c.id);

  const supabase = await createClient();
  const linhas = await lerTudo<LinhaGastoConta>("o gasto das contas", (de, ate) =>
    supabase
      .from("ad_spend_daily")
      .select("ad_account_id, data, moeda, gasto")
      .in("ad_account_id", ids)
      .eq("nivel", "conta")
      .gte("data", janela.desde)
      .lte("data", janela.ate)
      .order("ad_account_id", { ascending: true })
      .order("data", { ascending: true })
      .range(de, ate)
  );

  const moedas = new Set<string>([moeda.toUpperCase(), "USD"]);
  for (const l of linhas) moedas.add(String(l.moeda).toUpperCase());

  const cambio =
    moedas.size > 1
      ? await lerTudo<FxRateRow>("o câmbio", (de, ate) =>
          supabase
            .from("fx_rates")
            .select("data, moeda, por_usd, fonte")
            .in("moeda", [...moedas])
            .gte("data", somarDias(janela.desde, -FOLGA_CAMBIO_DIAS))
            .lte("data", janela.ate)
            .order("data", { ascending: true })
            .order("moeda", { ascending: true })
            .range(de, ate)
        )
      : [];

  return somarGastoPorConta(linhas, {
    contaIds: ids,
    hojePorConta,
    intervalo,
    moeda,
    converter: criarConversor(cambio),
  });
}
