"use client";

import { Badge } from "@/components/ui/badge";
import { Escolha } from "@/components/billing/escolha";
import { brl } from "@/components/billing/regras";
import { PLANOS, resumoDosLimites, type PlanoId } from "@/lib/billing/plans";

/**
 * Os 3 planos como cartoes de escolha unica (o mesmo dado da landing, de
 * src/lib/billing/plans.ts). Cada cartao diz o nome, o selo, os dois limites
 * de lojas e o preco por mes.
 */
export function EscolhaDePlano({
  valor,
  onValor,
  desabilitado,
}: {
  valor: PlanoId | null;
  onValor: (v: PlanoId) => void;
  desabilitado?: boolean;
}) {
  return (
    <Escolha<PlanoId>
      rotulo="Plano"
      valor={valor}
      onValor={onValor}
      desabilitado={desabilitado}
      opcoes={PLANOS.map((p) => ({
        valor: p.id,
        titulo: (
          <span className="flex flex-wrap items-center gap-1.5">
            {p.nome}
            {p.selo ? <Badge variant="neutral">{p.selo}</Badge> : null}
          </span>
        ),
        descricao: resumoDosLimites(p.limites),
        extra: (
          <span className="flex items-baseline gap-0.5">
            <span className="num text-dense font-semibold text-ink">{brl(p.precoCentavos)}</span>
            <span className="text-label text-t2">/mês</span>
          </span>
        ),
      }))}
    />
  );
}
