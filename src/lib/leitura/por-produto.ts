import { criarConversor, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import { contaDoPedido, qtdComCusto } from "@/lib/financeiro/contra-entrega";
import {
  chaveSku,
  custoVigente,
  paraNumero,
  pedidoConta,
  pedidoTemCusto,
  receitaDoPedido,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Lucro por produto (funcao #3): as linhas dos pedidos (fin_orders.linhas)
// somadas por SKU, no periodo ATUAL, com o custo vigente no dia do pedido.
//
// E lucro ANTES do anuncio: o gasto do Meta e do Google e por conta, nao por
// produto, entao aqui sai so produto, frete do fornecedor e taxa. Nunca chame
// isto de lucro liquido.
//
// As regras de custo sao as do calculo (custoVigente, contaDoPedido e
// qtdComCusto do contra entrega, custo padrao da loja), chamadas daqui sem
// mudar nada: o custo e a taxa somados aqui batem com os do Dashboard. O custo
// de devolucao do contra entrega e por pedido, nao por produto, e fica fora
// (o recusado volta com a quantidade zerada). O que e novo e so como a
// receita do pedido se divide entre os itens: pelo peso de cada linha (preco
// x quantidade que ficou no pedido). Assim a soma dos produtos bate com o
// faturamento -- o frete cobrado e o desconto entram rateados.
//
// Puro, sem "server-only". Quem le o banco e src/lib/leitura/base-lucro.ts.
// ============================================================================

export interface LinhaProduto {
  /** SKU como esta no pedido (trim). "" = item sem SKU. */
  sku: string;
  /** Em quantas lojas o SKU vendeu no periodo. */
  lojas: number;
  /** Unidades vendidas: as que ficaram nos pedidos pagos. */
  unidades: number;
  /** Parte da receita dos pedidos que cabe a este SKU, moeda do relatorio. */
  receita: number;
  /** Produto + frete do fornecedor. null = alguma unidade sem custo e sem custo padrao. */
  custo: number | null;
  /** Parte do custo veio do custo padrao (%) da loja, nao do custo do SKU. */
  custoEstimado: boolean;
  taxas: number;
  /** receita - custo - taxas. null quando o custo e desconhecido. */
  lucro: number | null;
  margem: number | null;
}

export interface PorProduto {
  linhas: LinhaProduto[];
  /**
   * Receita de pedido sem item com peso (so frete, ajuste): nao da para dizer
   * de qual produto e, entao fica fora das linhas -- e a tela diz quanto.
   */
  receitaSemItem: number;
}

interface Acumulado {
  lojas: Set<string>;
  unidades: number;
  receita: number;
  custo: number;
  taxas: number;
  semCusto: boolean;
  estimado: boolean;
}

function dentro(dia: string, i: { desde: string; ate: string }): boolean {
  return dia >= i.desde && dia <= i.ate;
}

export function montarPorProduto(e: EntradaFinanceiro): PorProduto {
  const converter = criarConversor(e.cambio);
  const periodo = e.intervalos.atual;
  const lojas = new Set(e.lojas.map((l) => l.id));
  const configPorLoja = new Map(e.configs.map((c) => [c.store_id, c]));
  const moedaPorLoja = new Map(e.lojas.map((l) => [l.id, l.moeda]));

  const custosPorSku = new Map<string, ProductCostRow[]>();
  for (const c of e.custos) {
    const chave = `${c.store_id}\u0000${chaveSku(c.sku)}`;
    const lista = custosPorSku.get(chave) ?? [];
    lista.push({ ...c, valido_desde: String(c.valido_desde).slice(0, 10) });
    custosPorSku.set(chave, lista);
  }

  const porSku = new Map<string, Acumulado>();
  const de = (sku: string): Acumulado => {
    let a = porSku.get(sku);
    if (!a) {
      a = { lojas: new Set(), unidades: 0, receita: 0, custo: 0, taxas: 0, semCusto: false, estimado: false };
      porSku.set(sku, a);
    }
    return a;
  };
  let receitaSemItem = 0;

  for (const p of e.pedidos) {
    if (!lojas.has(p.store_id)) continue;
    if (p.tipo === "teste" || p.tipo === "pdv") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (!dentro(dia, periodo)) continue;

    const moedaPedido = String(p.moeda || "").toUpperCase();
    // Sem cotacao o pedido fica de fora, como no calculo (que avisa).
    const fator = converter(1, moedaPedido, e.moeda, dia);
    if (!fator) continue;
    const k = fator.valor;

    const linhas = Array.isArray(p.linhas) ? p.linhas : [];
    const conta = pedidoConta(p);
    const receita = receitaDoPedido(p);
    const cfg = configPorLoja.get(p.store_id);
    // A regra do calculo: no contra entrega, a taxa fixa (moeda da loja) vai
    // para a moeda do pedido e o recusado que voltou ao estoque custa.
    const cc = contaDoPedido(p, cfg, moedaPorLoja.get(p.store_id), converter);
    const taxas = conta && cfg ? (paraNumero(p.recebido) * paraNumero(cfg.taxa_pct)) / 100 + cc.taxaFixa : 0;

    // Receita e taxa rateadas pelo peso de cada linha.
    const pesos = linhas.map((l) => Math.max(0, paraNumero(l.preco) * paraNumero(l.qtd_atual)));
    const pesoTotal = pesos.reduce((s, x) => s + x, 0);
    if ((receita > 0 || taxas > 0) && pesoTotal <= 0) receitaSemItem += receita * k;

    linhas.forEach((l, i) => {
      const sku = chaveSku(l.sku);
      const a = de(sku);
      a.lojas.add(p.store_id);
      if (conta) a.unidades += Math.max(0, paraNumero(l.qtd_atual));
      if (pesoTotal > 0) {
        const parte = pesos[i] / pesoTotal;
        a.receita += receita * parte * k;
        a.taxas += taxas * parte * k;
      }
    });

    if (!pedidoTemCusto(p)) continue;
    const pctPadrao =
      cfg && cfg.custo_padrao_pct !== null && cfg.custo_padrao_pct !== undefined
        ? paraNumero(cfg.custo_padrao_pct)
        : null;
    for (const l of linhas) {
      const q = qtdComCusto(l, p, cc.voltouAoEstoque);
      if (q <= 0) continue;
      const sku = chaveSku(l.sku);
      const a = de(sku);
      const versao = custoVigente(custosPorSku.get(`${p.store_id}\u0000${sku}`) ?? [], dia);
      if (versao) {
        const bruto = (paraNumero(versao.custo_unitario) + paraNumero(versao.frete_unitario)) * q;
        const c = converter(bruto, versao.moeda, moedaPedido, dia);
        if (c) {
          a.custo += c.valor * k;
          continue;
        }
      }
      if (pctPadrao !== null) {
        a.custo += ((paraNumero(l.preco) * q * pctPadrao) / 100) * k;
        a.estimado = true;
      } else {
        a.semCusto = true;
      }
    }
  }

  const linhas: LinhaProduto[] = [...porSku.entries()].map(([sku, a]) => {
    const lucro = a.semCusto ? null : a.receita - a.custo - a.taxas;
    return {
      sku,
      lojas: a.lojas.size,
      unidades: a.unidades,
      receita: a.receita,
      custo: a.semCusto ? null : a.custo,
      custoEstimado: a.estimado,
      taxas: a.taxas,
      lucro,
      margem: lucro !== null && a.receita > 0 ? lucro / a.receita : null,
    };
  });
  // Mais lucrativo primeiro; sem custo no fim.
  linhas.sort((x, y) => {
    if (x.lucro === null && y.lucro === null) return y.receita - x.receita;
    if (x.lucro === null) return 1;
    if (y.lucro === null) return -1;
    return y.lucro - x.lucro;
  });
  return { linhas, receitaSemItem };
}
