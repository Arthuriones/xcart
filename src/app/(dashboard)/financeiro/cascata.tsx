import { BarList, type ItemBarra } from "@/components/ui/bar-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import type { Totais } from "@/lib/financeiro/calculo";
import { dinheiro } from "./lucro-dados";

// ============================================================================
// "Para onde foi o faturamento": faturamento -> produtos + frete -> taxas ->
// Meta -> Google -> lucro, em barras. Cada custo e o pedaco que ele tira do
// faturamento. Server component: nao tem nada interativo.
// ============================================================================

const pct0 = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function Cascata({ atual, moeda, contexto }: { atual: Totais; moeda: string; contexto: string }) {
  const r = atual.receita;
  const titulo = "Para onde foi o faturamento";

  if (r <= 0) {
    return (
      <Section titulo={titulo} descricao={contexto}>
        <EmptyState
          variante="tracejado"
          titulo="Sem faturamento no período"
          descricao={
            atual.gasto > 0
              ? `Gasto em anúncios no período: ${dinheiro(atual.gasto, moeda)}.`
              : "A composição aparece com o primeiro pedido."
          }
          className="min-h-60 flex-1"
        />
      </Section>
    );
  }

  const custos: [string, string, number, ItemBarra["cor"]][] = [
    ["cmv", "Produtos + frete do fornecedor", atual.cmv, "t4"],
    ["taxas", "Taxas de pagamento", atual.taxas, "t4"],
    ["meta", "Meta Ads", atual.gastoMeta, "chart-3"],
    ["google", "Google Ads", atual.gastoGoogle, "chart-3"],
  ];
  let resta = r;
  const itens: ItemBarra[] = [
    { id: "receita", rotulo: "Faturamento", valor: r, valorTexto: dinheiro(r, moeda), cor: "chart-2", destaque: true },
    ...custos.map(([id, rotulo, v, cor]): ItemBarra => {
      resta -= v;
      return {
        id,
        rotulo: `− ${rotulo}`,
        valor: v,
        valorTexto: dinheiro(v, moeda),
        detalhe: `· ${pct0.format(v / r)}`,
        inicio: Math.max(resta, 0),
        cor,
      };
    }),
    {
      id: "lucro",
      rotulo: "= Lucro estimado",
      valor: atual.lucro,
      valorTexto: dinheiro(atual.lucro, moeda),
      detalhe: `· ${pct1.format(atual.lucro / r)}`,
      cor: atual.lucro < 0 ? "err" : "chart-1",
      destaque: true,
    },
  ];

  return (
    <Section titulo={titulo} descricao={contexto}>
      <BarList itens={itens} maximo={r} rotulo="Composição do lucro" />
      <p className="mt-auto text-label text-t2 text-pretty">
        Cada barra mostra quanto aquele custo tira do faturamento. Lucro estimado, não contábil.
      </p>
    </Section>
  );
}
