import Link from "next/link";
import { Wallet } from "lucide-react";
import type { Totais } from "@/lib/financeiro/calculo";
import { ROTAS } from "@/lib/financeiro/tipos";
import { dinheiro } from "./lucro-dados";

// ============================================================================
// "Custos do período": o total e cada custo que sai do faturamento, com a
// mesma cor da barra do grafico. Server component: nada interativo.
// ============================================================================

/** Cores das partes da barra; o grafico usa as mesmas. */
export const COR_PARTE = {
  receita: "bg-chart-2",
  lucro: "bg-ok",
  prejuizo: "bg-err",
  gasto: "bg-chart-5",
  cmv: "bg-chart-3",
  taxas: "bg-t4",
} as const;

const pct0 = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

export function Cascata({ atual, moeda }: { atual: Totais; moeda: string }) {
  const total = atual.cmv + atual.taxas + atual.gasto;
  const linhas: [string, number, string][] = [
    ["Produto + frete", atual.cmv, COR_PARTE.cmv],
    ["Meta Ads", atual.gastoMeta, COR_PARTE.gasto],
    ["Google Ads", atual.gastoGoogle, "bg-chart-4"],
    ["Taxas de pagamento", atual.taxas, COR_PARTE.taxas],
  ];

  return (
    <section
      aria-labelledby="custos-periodo-t"
      className="flex min-w-0 flex-col gap-3.5 rounded-overlay border border-border bg-surface p-5"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-info-bg text-info">
          <Wallet className="size-5" strokeWidth={2} />
        </span>
        <span className="flex flex-col">
          <h2 id="custos-periodo-t" className="text-dense font-medium text-t1">
            Custos do período
          </h2>
          <span className="num text-[22px] leading-7 font-bold">{dinheiro(total, moeda)}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        {linhas.map(([rotulo, v, cor]) => (
          <li key={rotulo} className="flex items-center gap-2.5 text-dense">
            <span aria-hidden className={`size-3.5 shrink-0 rounded-[3px] ${cor}`} />
            <span className="flex-1 text-t1">{rotulo}</span>
            {atual.receita > 0 && v > 0 && (
              <span className="num text-label text-t2">{pct0.format(v / atual.receita)}</span>
            )}
            <span className="num font-semibold text-ink">{dinheiro(v, moeda)}</span>
          </li>
        ))}
      </ul>
      <Link href={ROTAS.custos} className="mt-auto text-label">
        Editar custos e taxas
      </Link>
    </section>
  );
}
