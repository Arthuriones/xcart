"use client";

import { Badge } from "@/components/ui/badge";
import { Escolha } from "@/components/billing/escolha";
import { brl } from "@/components/billing/regras";
import { PLANOS, planoPorId, resumoDosLimites, type PlanoId } from "@/lib/billing/plans";

/**
 * Os planos a venda como cartoes de escolha unica (o mesmo dado da landing, de
 * src/lib/billing/plans.ts). Cada cartao diz o nome, o selo, os limites e o
 * preco por mes. `planoAnterior` (so na renovacao por Pix de quem ainda paga
 * um plano fora da venda) entra primeiro, com o preco dele.
 */
export function EscolhaDePlano({
  valor,
  onValor,
  desabilitado,
  planoAnterior,
}: {
  valor: PlanoId | null;
  onValor: (v: PlanoId) => void;
  desabilitado?: boolean;
  planoAnterior?: PlanoId | null;
}) {
  const anterior = planoPorId(planoAnterior);
  const planos = anterior && !anterior.aVenda ? [anterior, ...PLANOS] : PLANOS;
  return (
    <Escolha<PlanoId>
      rotulo="Plano"
      valor={valor}
      onValor={onValor}
      desabilitado={desabilitado}
      opcoes={planos.map((p) => {
        const selo = p.aVenda ? p.selo : "Seu plano anterior";
        return {
          valor: p.id,
          titulo: (
            <span className="flex flex-wrap items-center gap-1.5">
              {p.nome}
              {selo ? <Badge variant="neutral">{selo}</Badge> : null}
            </span>
          ),
          descricao: resumoDosLimites(p.limites),
          extra: (
            <span className="flex items-baseline gap-0.5">
              <span className="num text-dense font-semibold text-ink">{brl(p.precoCentavos)}</span>
              <span className="text-label text-t2">/mês</span>
            </span>
          ),
        };
      })}
    />
  );
}
