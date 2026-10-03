"use client";

import * as React from "react";
import { CheckIcon, CircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SENHA_MINIMA, forcaDaSenha, type NivelForca } from "./acesso";

// ============================================================================
// Campos das telas de acesso: rotulo sempre visivel, erro no proprio campo
// (aria-invalid + aria-describedby) e, na senha, mostrar/ocultar, a regra
// visivel desde o inicio e o medidor de forca.
// 44 px no celular (alvo de toque), 36 no resto -- o padrao do app.
// ============================================================================

const ALTURA = "h-ctl-lg sm:h-ctl-md";

type CampoProps = Omit<React.ComponentProps<typeof Input>, "id"> & {
  id: string;
  rotulo: string;
  erro?: string;
};

export function Campo({ id, rotulo, erro, className, ...input }: CampoProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        className={cn(ALTURA, className)}
        {...input}
      />
      {erro ? (
        <p id={`${id}-erro`} className="text-label text-err">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

const COR_FORCA: Record<NivelForca, string> = {
  0: "bg-err",
  1: "bg-err",
  2: "bg-warn",
  3: "bg-ok",
};

type CampoSenhaProps = {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Senha nova: regra visivel desde o inicio e medidor de forca. */
  nova?: boolean;
  erro?: string;
  autoFocus?: boolean;
  /** Ao lado do rotulo (ex.: "Esqueci a senha"). */
  acessorio?: React.ReactNode;
  /** Abaixo do campo, antes do erro (ex.: "As duas senhas são iguais"). */
  rodape?: React.ReactNode;
};

export function CampoSenha({
  id,
  rotulo,
  valor,
  aoMudar,
  autoComplete,
  nova,
  erro,
  autoFocus,
  acessorio,
  rodape,
}: CampoSenhaProps) {
  const [visivel, setVisivel] = React.useState(false);
  const forca = forcaDaSenha(valor);
  const minimoOk = valor.length >= SENHA_MINIMA;
  const descritores = [nova ? `${id}-regra` : null, erro ? `${id}-erro` : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id}>{rotulo}</Label>
        {acessorio}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type={visivel ? "text" : "password"}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={erro ? true : undefined}
          aria-describedby={descritores || undefined}
          className={ALTURA}
        />
        <Button
          type="button"
          variant="secondary"
          aria-controls={id}
          onClick={() => setVisivel((v) => !v)}
          className={cn(ALTURA, "min-w-22")}
        >
          {visivel ? "Ocultar" : "Mostrar"}
          <span className="sr-only"> senha</span>
        </Button>
      </div>

      {nova ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p
            id={`${id}-regra`}
            className={cn("flex items-center gap-1.5 text-label", minimoOk ? "text-ok" : "text-t2")}
          >
            {minimoOk ? (
              <CheckIcon aria-hidden className="size-3.5" strokeWidth={2} />
            ) : (
              <CircleIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
            )}
            Pelo menos {SENHA_MINIMA} caracteres
            {minimoOk ? <span className="sr-only"> (cumprido)</span> : null}
          </p>
          {/* A palavra diz a forca; as barras so repetem (nao e so cor). */}
          <div className="flex items-center gap-2">
            {valor ? (
              <div aria-hidden className="flex w-20 gap-1">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      n <= Math.max(forca.nivel, 1) ? COR_FORCA[forca.nivel] : "bg-track"
                    )}
                  />
                ))}
              </div>
            ) : null}
            <span className="text-label text-t2" aria-live="polite">
              {forca.rotulo ? `Força: ${forca.rotulo.toLowerCase()}` : ""}
            </span>
          </div>
        </div>
      ) : null}

      {rodape}

      {erro ? (
        <p id={`${id}-erro`} className="text-label text-err">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/** Erro que veio do servidor: titulo, frase e o detalhe cru recolhido quando nao ha frase. */
export function AvisoDeErro({
  titulo,
  texto,
  detalhe,
  acao,
}: {
  titulo: string;
  texto: string;
  detalhe?: string;
  acao?: React.ReactNode;
}) {
  return (
    <Callout tom="err" role="alert" titulo={titulo}>
      <p>{texto}</p>
      {detalhe ? (
        <details className="mt-1 text-label text-t2">
          <summary className="cursor-pointer">Ver detalhe</summary>
          <p className="mt-1 font-mono break-all">{detalhe}</p>
        </details>
      ) : null}
      {/* Embaixo do texto: na coluna estreita do formulario, ao lado espreme a frase. */}
      {acao ? <div className="mt-2">{acao}</div> : null}
    </Callout>
  );
}
