import Link from "next/link";
import clsx from "clsx";
import type { Totais } from "@/lib/financeiro/calculo";
import { ROTAS } from "@/lib/financeiro/tipos";
import { dinheiro, montarCascata, porcento, valorComSinal, type TomCascata } from "./lucro-dados";

// ============================================================================
// "Composição do lucro" (mockup "design novo/Dashboard.dc.html"): o
// faturamento inteiro e cada custo como uma barra que desce de onde o anterior
// parou, ate o lucro. Os numeros sao os do calculo (os mesmos dos KPIs);
// montarCascata so faz a geometria. Server component: nada interativo.
// ============================================================================

/** Cor da barra: faturamento chart-2, custos em cinza, anuncio chart-3, lucro chart-1. */
const BARRA: Record<TomCascata, string> = {
  faturamento: "bg-chart-2",
  produto: "bg-t4",
  taxas: "bg-t4 opacity-60",
  meta: "bg-chart-3",
  google: "bg-chart-3 opacity-60",
  devolucoes: "bg-t4",
  lucro: "bg-chart-1",
  prejuizo: "bg-err",
};

export function Cascata({
  atual,
  moeda,
  contraEntrega = false,
  devolucoes = false,
  venda = false,
}: {
  atual: Totais;
  moeda: string;
  /** Contra entrega: a receita e o Recebido, e o lucro e o realizado. */
  contraEntrega?: boolean;
  /** Loja em contra entrega: mostra a linha de devolucoes, mesmo zerada. */
  devolucoes?: boolean;
  /** Checkout de venda (Cakto) no filtro: as taxas levam as comissoes de afiliado. */
  venda?: boolean;
}) {
  const linhas = montarCascata(atual, {
    rotuloReceita: contraEntrega ? "Recebido" : "Faturamento",
    rotuloTaxas: venda ? "Taxas e comissões" : "Taxas de pagamento",
    rotuloLucro: contraEntrega ? "Lucro realizado" : "Lucro estimado",
    devolucoes: devolucoes || atual.devolucoes > 0,
  });
  const ultima = linhas.length - 1;
  // Contra entrega nao tem a celula "Custos totais" na faixa: o total dos
  // custos (a soma que o cartao de custos mostrava) fica aqui, sob o lucro.
  const custosTotais = atual.cmv + atual.taxas + atual.gasto + atual.devolucoes;

  return (
    <section
      aria-labelledby="composicao-t"
      className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-5"
    >
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <h2 id="composicao-t" className="text-section text-ink">
          Composição do lucro
        </h2>
        <span className="whitespace-nowrap text-label text-t3">
          {contraEntrega ? "% do recebido" : "% do faturamento"}
        </span>
      </div>
      <ol className="flex flex-col">
        {linhas.map((c, i) => {
          const ponta = i === 0 || i === ultima;
          const valor = valorComSinal(dinheiro(c.valor, moeda), c.valor);
          return (
            <li
              key={c.rotulo}
              className={clsx(
                "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5",
                i === 0 ? "pt-1.5 pb-2.5" : "py-2.5",
                i === ultima ? "border-t border-border-strong" : i > 0 && "border-t border-border-subtle"
              )}
            >
              <span
                className={clsx(
                  "flex min-w-0 items-baseline gap-1.5 text-dense",
                  i === ultima ? "font-semibold" : ponta ? "font-medium" : "font-normal",
                  ponta ? "text-ink" : "text-t1"
                )}
              >
                <span aria-hidden className="w-2.5 shrink-0 font-mono text-t3">
                  {c.sinal}
                </span>
                <span className="truncate">{c.rotulo}</span>
              </span>
              <span
                className={clsx(
                  "num whitespace-nowrap text-dense",
                  i === ultima ? "font-semibold" : ponta ? "font-medium" : "font-normal",
                  valor.negativo && i === ultima ? "text-err" : "text-ink"
                )}
              >
                {valor.texto}
                <span className="ml-2 inline-block min-w-11 text-right text-label font-normal text-t3">
                  {c.pct === null ? "—" : i === 0 ? "100%" : porcento(c.pct).replace(/^-/, "−")}
                </span>
              </span>
              <span aria-hidden className="relative col-span-2 h-1.5 rounded-xs bg-track">
                <span
                  className={clsx("absolute inset-y-0 rounded-xs", BARRA[c.tom])}
                  style={{ left: `${c.esq}%`, width: `${c.larg}%` }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      {contraEntrega && (
        <p className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-2.5 text-dense text-t1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span aria-hidden className="w-2.5 shrink-0" />
            <span className="truncate">Custos totais</span>
          </span>
          <span className="num whitespace-nowrap text-ink">
            {dinheiro(custosTotais, moeda)}
            <span className="ml-2 inline-block min-w-11 text-right text-label text-t3">
              {atual.receita > 0 ? porcento(custosTotais / atual.receita) : "—"}
            </span>
          </span>
        </p>
      )}
      <div className="mt-auto flex justify-between gap-3 pt-3 text-label">
        <span className="text-t3">Lucro estimado, não contábil.</span>
        <Link href={ROTAS.custos}>Editar custos e taxas</Link>
      </div>
    </section>
  );
}
