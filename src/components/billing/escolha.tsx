"use client";

import type { ReactNode } from "react";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { cn } from "@/components/ui/cn";

export interface OpcaoEscolha<V extends string> {
  valor: V;
  /** Linha principal (vira o nome acessivel junto com a descricao). */
  titulo: ReactNode;
  descricao?: ReactNode;
  /** Canto direito: preco, selo. */
  extra?: ReactNode;
  icone?: ReactNode;
}

/**
 * Cartoes de escolha unica (forma de pagamento, pacote de creditos). E um
 * radiogroup de verdade: Tab entra no marcado, setas trocam, e o estado nao
 * fica so na cor -- o marcado ganha borda forte e o circulo preenchido.
 * Local da Assinatura: a fundacao ainda nao tem RadioGroup em cartao.
 */
export function Escolha<V extends string>({
  rotulo,
  valor,
  onValor,
  opcoes,
  className,
  desabilitado,
}: {
  /** Nome do grupo para leitor de tela: "Forma de pagamento". */
  rotulo: string;
  valor: V | null;
  onValor: (v: V) => void;
  opcoes: ReadonlyArray<OpcaoEscolha<V>>;
  /** Colunas: o grid e de uma; passe a regra (ex.: "@lg:grid-cols-2", por container). */
  className?: string;
  desabilitado?: boolean;
}) {
  return (
    <RadioGroup
      aria-label={rotulo}
      // null mantem o grupo controlado e sem nada marcado (sem trocar de
      // nao controlado para controlado no primeiro clique).
      value={valor}
      onValueChange={(v) => {
        if (v !== null) onValor(v as V);
      }}
      disabled={desabilitado}
      className={cn("grid gap-2", className)}
    >
      {opcoes.map((o) => (
        <Radio.Root
          key={o.valor}
          value={o.valor}
          className={cn(
            "group/opcao flex min-h-ctl-lg cursor-pointer items-start gap-3 rounded-card border border-border bg-surface p-3 text-left transition-colors",
            "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            "data-checked:border-ink data-checked:bg-surface-2",
            "data-disabled:cursor-not-allowed data-disabled:opacity-60"
          )}
        >
          <span
            aria-hidden
            className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-control-border group-data-checked/opcao:border-ink"
          >
            <span className="size-2 rounded-full bg-ink opacity-0 group-data-checked/opcao:opacity-100" />
          </span>
          {o.icone ? (
            <span aria-hidden className="mt-px shrink-0 text-t2 [&_svg]:size-4">
              {o.icone}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-dense font-semibold text-ink">{o.titulo}</span>
            {o.descricao ? <span className="text-label text-t2">{o.descricao}</span> : null}
          </span>
          {o.extra ? <span className="shrink-0 text-right">{o.extra}</span> : null}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
