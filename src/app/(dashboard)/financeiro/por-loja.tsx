import clsx from "clsx";
import type { LinhaLoja } from "@/lib/financeiro/calculo";
import { dinheiro, nomeDaLoja, porcento, valorComSinal, vezes } from "./lucro-dados";

// ============================================================================
// "Por loja": um cartao por loja com o anel da margem, o lucro e o ROAS real
// contra o de equilibrio. Server component; so aparece com 2+ lojas no filtro.
// ============================================================================

function corDaMargem(m: number | null): string {
  if (m === null) return "var(--border-strong)";
  if (m < 0) return "var(--err)";
  if (m < 0.1) return "var(--warn)";
  return "var(--ok)";
}

export function PorLoja({ lojas, moeda }: { lojas: LinhaLoja[]; moeda: string }) {
  const ordenadas = [...lojas].sort((a, b) => b.lucro - a.lucro);
  return (
    <section aria-labelledby="por-loja-t" className="flex flex-col gap-2.5">
      <h2 id="por-loja-t" className="text-section">
        Por loja
      </h2>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {ordenadas.map((l) => {
          const nome = nomeDaLoja(l);
          const arco = l.margem === null ? 0 : Math.min(1, Math.abs(l.margem) / 0.4) * 360;
          const cor = corDaMargem(l.margem);
          const lucro = valorComSinal(dinheiro(l.lucro, moeda), l.lucro);
          return (
            <div
              key={l.storeId}
              className="flex items-center gap-4 rounded-overlay border border-border bg-surface p-[18px]"
            >
              <span
                role="img"
                aria-label={`Margem de ${nome}: ${porcento(l.margem)}`}
                className="relative size-[76px] shrink-0 rounded-full"
                style={{ background: `conic-gradient(${cor} 0 ${arco}deg, var(--track) ${arco}deg 360deg)` }}
              >
                <span className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-surface">
                  <span className="text-label text-t2">Margem</span>
                  <span className="num text-dense font-bold">{porcento(l.margem)}</span>
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-dense font-semibold">{nome}</span>
                <span className={clsx("num text-section font-bold", lucro.negativo && "text-err")}>{lucro.texto}</span>
                <span className="num text-label text-t2">
                  ROAS {vezes(l.roas)} · equilíbrio {vezes(l.roasEquilibrio)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
