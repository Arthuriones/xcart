import { criarConversor } from "@/lib/financeiro/calculo";
import {
  paraNumero,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FxRateRow,
  type Intervalo,
  type MoedaRelatorio,
  type Plataforma,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Desempenho por campanha (funcao #6): ad_spend_daily no nivel "campanha",
// que os crons do Meta e o script do Google ja gravam, somado no periodo.
//
// Compras e valor sao os que a PROPRIA plataforma reporta -- nao os pedidos da
// Shopify. A tela mostra o ROAS real da loja ao lado para comparar. Lucro por
// campanha nao existe: pede ligar cada pedido a uma campanha.
//
// O nivel "conta" continua sendo a verdade do gasto (no Meta inclui anuncio
// apagado); o total das campanhas pode ficar um pouco abaixo dele.
//
// Puro, sem "server-only". Quem le o banco e src/lib/leitura/base-lucro.ts.
// ============================================================================

export interface LinhaCampanha {
  /** conta + campanha: o id da campanha so e unico dentro da conta. */
  id: string;
  campanhaId: string;
  nome: string;
  contaId: string;
  contaNome: string;
  plataforma: Plataforma;
  storeId: string | null;
  /** Gasto na moeda do relatorio. */
  gasto: number;
  impressoes: number;
  cliques: number;
  compras: number;
  /** Valor das compras reportado pela plataforma, moeda do relatorio. */
  valorCompras: number;
  roasPlataforma: number | null;
  /** Algum dia ficou de fora por falta de cotacao da moeda da conta. */
  semCotacao: boolean;
}

export interface EntradaCampanhas {
  contas: AdAccountRow[];
  /** Linhas de ad_spend_daily; as de nivel "conta" sao ignoradas aqui. */
  gastos: AdSpendDailyRow[];
  cambio: FxRateRow[];
  moeda: MoedaRelatorio;
  intervalo: Intervalo;
  /** So as contas ligadas a estas lojas (ou checkouts externos): o mesmo recorte do lucro. */
  lojaIds: string[];
}

export function montarPorCampanha(e: EntradaCampanhas): LinhaCampanha[] {
  const converter = criarConversor(e.cambio);
  const lojas = new Set(e.lojaIds);
  const contaPorId = new Map(
    e.contas
      .filter((c) => {
        const destino = c.store_id ?? c.checkout_id ?? null;
        return destino !== null && lojas.has(destino);
      })
      .map((c) => [c.id, c])
  );

  const porCampanha = new Map<string, LinhaCampanha>();
  const ultimoDia = new Map<string, string>();
  for (const g of e.gastos) {
    if (g.nivel !== "campanha") continue;
    const conta = contaPorId.get(g.ad_account_id);
    if (!conta) continue;
    const dia = String(g.data).slice(0, 10);
    if (dia < e.intervalo.desde || dia > e.intervalo.ate) continue;

    const id = `${g.ad_account_id}:${g.campanha_id}`;
    let linha = porCampanha.get(id);
    if (!linha) {
      linha = {
        id,
        campanhaId: g.campanha_id,
        nome: g.campanha_nome || g.campanha_id,
        contaId: conta.id,
        contaNome: conta.nome || conta.external_id,
        plataforma: conta.plataforma,
        storeId: conta.store_id ?? conta.checkout_id ?? null,
        gasto: 0,
        impressoes: 0,
        cliques: 0,
        compras: 0,
        valorCompras: 0,
        roasPlataforma: null,
        semCotacao: false,
      };
      porCampanha.set(id, linha);
    }
    // O nome mais recente vence: campanha renomeada aparece como esta hoje.
    if (dia >= (ultimoDia.get(id) ?? "")) {
      ultimoDia.set(id, dia);
      if (g.campanha_nome) linha.nome = g.campanha_nome;
    }
    linha.impressoes += paraNumero(g.impressoes);
    linha.cliques += paraNumero(g.cliques);
    linha.compras += paraNumero(g.compras);

    const fator = converter(1, g.moeda, e.moeda, dia);
    if (!fator) {
      linha.semCotacao = true;
      continue;
    }
    linha.gasto += paraNumero(g.gasto) * fator.valor;
    linha.valorCompras += paraNumero(g.valor_compras) * fator.valor;
  }

  return [...porCampanha.values()]
    .map((l) => ({ ...l, roasPlataforma: l.gasto > 0 ? l.valorCompras / l.gasto : null }))
    .sort((a, b) => b.gasto - a.gasto);
}
