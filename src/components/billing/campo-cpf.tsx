"use client";

import { useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mascaraCpf } from "@/components/billing/regras";

/**
 * CPF do pagador, com rotulo visivel, ajuda e erro ligados ao campo
 * (aria-describedby / aria-invalid). O banco que emite o Pix exige o
 * documento; o backend guarda e nao pede de novo.
 *
 * Enter com `onEnter` assincrono fica travado ate a promessa terminar: dois
 * Enter rapidos geravam dois Pix pagaveis (o segundo QR cobria o primeiro).
 * `desabilitado` (enquanto gera) deixa o campo so leitura -- readOnly, nao
 * disabled, para o foco nao cair no <body> se o servidor recusar o CPF.
 */
export function CampoCpf({
  valor,
  onValor,
  erro,
  onEnter,
  autoFocus,
  desabilitado,
}: {
  valor: string;
  onValor: (v: string) => void;
  erro?: string | null;
  onEnter?: () => void | Promise<unknown>;
  autoFocus?: boolean;
  desabilitado?: boolean;
}) {
  const id = useId();
  const enviando = useRef(false);
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
        readOnly={desabilitado}
        aria-busy={desabilitado || undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            if (desabilitado || enviando.current) return;
            const r = onEnter();
            if (r instanceof Promise) {
              enviando.current = true;
              const soltar = () => {
                enviando.current = false;
              };
              r.then(soltar, soltar);
            }
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
