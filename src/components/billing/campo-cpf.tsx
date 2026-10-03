"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mascaraCpf } from "@/components/billing/regras";

/**
 * CPF do pagador, com rotulo visivel, ajuda e erro ligados ao campo
 * (aria-describedby / aria-invalid). O banco que emite o Pix exige o
 * documento; o backend guarda e nao pede de novo.
 */
export function CampoCpf({
  valor,
  onValor,
  erro,
  onEnter,
  autoFocus,
}: {
  valor: string;
  onValor: (v: string) => void;
  erro?: string | null;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const ajuda = `${id}-ajuda`;
  const msgErro = `${id}-erro`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>CPF do pagador</Label>
      <Input
        id={id}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        value={mascaraCpf(valor)}
        onChange={(e) => onValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${msgErro} ${ajuda}` : ajuda}
        className="num sm:max-w-60"
      />
      {erro ? (
        <p id={msgErro} className="text-label font-medium text-err">
          {erro}
        </p>
      ) : null}
      <p id={ajuda} className="text-label text-t2">
        Pedido pelo banco que emite o Pix. Fica salvo para as próximas compras.
      </p>
    </div>
  );
}
