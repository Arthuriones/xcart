"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CabecalhoEventos } from "./cabecalho";

/**
 * A primeira leitura falhou (banco ou sessao). Erro aparece como erro: lista
 * vazia diria "nenhum evento ainda", que e outra coisa e mandaria o lojista
 * procurar defeito no tema. O detalhe tecnico fica atras de "Ver detalhes".
 */
export function ErroEventos({ detalhe }: { detalhe?: string }) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <>
      <CabecalhoEventos />
      <section aria-label="Eventos" className="min-w-0 rounded-card border border-border bg-surface">
        <div
          role="alert"
          className="flex min-h-70 flex-col items-center justify-center gap-2.5 px-4 py-8 text-center"
        >
          <p className="text-section text-ink">Não conseguimos buscar os eventos</p>
          <p className="max-w-110 text-dense text-t1 text-pretty">
            O rastreamento continua enviando normalmente.
          </p>
          {detalhe && (
            <details className="max-w-110 text-label text-t2">
              <summary className="mx-auto w-fit cursor-pointer rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                Ver detalhes
              </summary>
              <p className="mt-1 [overflow-wrap:anywhere]">{detalhe}</p>
            </details>
          )}
          <Button
            className="mt-1"
            pending={tentando}
            onClick={() => startTransition(() => router.refresh())}
          >
            Tentar de novo
          </Button>
        </div>
      </section>
    </>
  );
}
