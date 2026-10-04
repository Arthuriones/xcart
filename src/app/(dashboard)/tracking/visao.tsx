"use client";

import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Switch } from "@/components/ui/switch";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { Logo } from "./logos";
import type { LinhaLoja } from "./resumo";
import { plural } from "./saude";
import { pontosDaLinha, subDaLinha, type Tom } from "./vista";

// ============================================================================
// A lista: uma linha por loja Shopify, com um ponto por plataforma, os pedidos
// da semana e o interruptor do rastreamento. Sem numero grande e sem frase de
// problema: o motivo aparece dentro da loja.
// ============================================================================

const PONTO: Record<Tom, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  neutral: "bg-t4",
};

export function Visao({
  linhas,
  diag,
  ocultas,
  atualizando,
  envioNaTela,
  abrir,
  atualizar,
  alternarEnvio,
}: {
  linhas: LinhaLoja[];
  diag: Record<string, DiagnosticoLoja>;
  /** Lojas fora da lista: app desinstalado e envio desligado. */
  ocultas: number;
  atualizando: boolean;
  /** O interruptor responde na hora; o servidor confirma depois. */
  envioNaTela: (l: LinhaLoja) => boolean;
  abrir: (l: LinhaLoja) => void;
  atualizar: () => void;
  alternarEnvio: (l: LinhaLoja, ligar: boolean) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-205 flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        {/* No celular o titulo ja esta no topo da casca. */}
        <h1 className="hidden text-page font-semibold text-ink md:block">Rastreamento</h1>
        <p className="text-body text-t2">Cada loja Shopify conectada.</p>
      </div>

      <Link
        href="/stores"
        className="flex h-ctl-md items-center justify-center gap-1.5 rounded-card border border-border bg-surface text-dense font-medium text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Plus aria-hidden className="size-3.5" />
        Conectar loja
      </Link>

      <div className="flex items-center justify-between">
        <span className="text-dense text-t2">{plural(linhas.length, "loja", "lojas")}</span>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Atualizar"
          aria-busy={atualizando || undefined}
          onClick={atualizar}
        >
          <RefreshCw
            aria-hidden
            className={cn(atualizando && "animate-xc-spin motion-reduce:animate-none")}
          />
        </Button>
      </div>

      <ul className="flex flex-col gap-2.5">
        {linhas.map((l) => {
          const { loja } = l;
          const ligado = envioNaTela(l);
          const pontos = pontosDaLinha(l);
          const sub = ligado ? subDaLinha(loja, diag[loja.storeId] ?? null) : "Rastreamento desligado";
          return (
            <li
              key={loja.storeId}
              className={cn(
                "relative flex items-center gap-3.5 rounded-card border border-border bg-surface px-4 py-3.5 hover:border-border-strong",
                "has-[[data-linha-alvo]:focus-visible]:outline-2 has-[[data-linha-alvo]:focus-visible]:outline-offset-2 has-[[data-linha-alvo]:focus-visible]:outline-focus",
                !ligado && "opacity-70"
              )}
            >
              <Logo marca="shopify" tamanho={20} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => abrir(l)}
                  data-linha-alvo=""
                  className="w-fit max-w-full truncate text-left text-dense font-semibold text-ink after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {loja.nome}
                </button>
                {(pontos.length > 0 || sub) && (
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label text-t2">
                    {ligado &&
                      pontos.map((p) => (
                        <span key={p.plataforma} className="inline-flex items-center gap-1.25">
                          <Logo marca={p.plataforma} tamanho={12} />
                          <span aria-hidden className={cn("size-1.5 rounded-full", PONTO[p.tom])} />
                          <span className="sr-only">{p.rotulo}</span>
                        </span>
                      ))}
                    {sub && <span>{sub}</span>}
                  </span>
                )}
              </span>
              <Switch
                aria-label={`Rastreamento de ${loja.nome}`}
                checked={ligado}
                onCheckedChange={(v) => alternarEnvio(l, v)}
                className="relative z-10"
              />
            </li>
          );
        })}
      </ul>

      {ocultas > 0 && (
        <p className="text-label text-t2">
          {ocultas === 1 ? "1 loja sem acesso fica em " : `${ocultas} lojas sem acesso ficam em `}
          <Link href="/stores" className="font-medium text-ink underline underline-offset-2">
            Lojas
          </Link>
          .
        </p>
      )}
    </div>
  );
}
