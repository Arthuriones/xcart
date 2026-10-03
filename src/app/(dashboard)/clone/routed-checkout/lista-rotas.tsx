"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status-badge";
import {
  FILTROS,
  SELO_ROTA,
  contarPorFiltro,
  filtroDe,
  hrefRota,
  passaNoFiltro,
  type EstadoRota,
  type FiltroRotas,
} from "./logica";

export interface ResumoRota {
  id: string;
  nome: string;
  estado: EstadoRota;
  recebendo: number;
  total: number;
  carrinhos: number;
}

/**
 * O filtro mora na URL (?estado=) para voltar e compartilhar, mas troca sem
 * ida ao servidor: o grafo ja esta todo aqui.
 */
function trocarFiltro(f: FiltroRotas) {
  const url = new URL(window.location.href);
  if (f === "todas") url.searchParams.delete("estado");
  else url.searchParams.set("estado", f);
  window.history.replaceState(null, "", url.pathname + url.search);
}

/** Lista de rotas com filtro por estado. No celular some quando ha uma rota aberta. */
export function ListaRotas({
  rotas,
  selecionada,
  esconderNoCelular,
}: {
  rotas: ResumoRota[];
  selecionada: string;
  esconderNoCelular: boolean;
}) {
  const params = useSearchParams();
  const filtro = filtroDe(params.get("estado"));
  const contagem = contarPorFiltro(rotas.map((r) => r.estado));
  const visiveis = rotas.filter((r) => passaNoFiltro(r.estado, filtro));
  const extra = filtro === "todas" ? undefined : { estado: filtro };

  return (
    <nav
      aria-label="Rotas"
      className={cn("flex min-w-0 flex-col gap-3", esconderNoCelular && "hidden lg:flex")}
    >
      <Segmented
        rotulo="Mostrar rotas"
        valor={filtro}
        onValorChange={trocarFiltro}
        className="max-w-full"
        opcoes={FILTROS.map((f) => ({
          valor: f.valor,
          rotulo: (
            <>
              {f.rotulo}
              <span className="sr-only">{`, ${contagem[f.valor]}`}</span>
            </>
          ),
        }))}
      />

      {visiveis.length === 0 ? (
        <EmptyState
          variante="tracejado"
          titulo="Nenhuma rota com esse estado"
          descricao={`Você tem ${rotas.length === 1 ? "1 rota" : `${rotas.length} rotas`} em outros estados.`}
          acao={
            <Button variant="secondary" size="sm" onClick={() => trocarFiltro("todas")}>
              Ver todas
            </Button>
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-card border border-border bg-surface">
          {visiveis.map((r) => {
            const sel = r.id === selecionada;
            const selo = SELO_ROTA[r.estado];
            return (
              <li key={r.id} className="border-b border-border-subtle last:border-b-0">
                <Link
                  href={hrefRota(r.id, "visao", extra)}
                  scroll={false}
                  aria-current={sel ? "page" : undefined}
                  className={cn(
                    "flex min-h-15 items-center gap-3 border-l-2 py-2.5 pr-3 pl-2.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                    sel ? "border-ink bg-nav-active" : "border-transparent"
                  )}
                >
                  <StatusDot tom={selo.tom} texto={selo.texto} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-dense text-ink", sel ? "font-semibold" : "font-medium")}>
                      {r.nome}
                    </span>
                    <span className="truncate text-label text-t2">
                      {selo.texto} · {r.recebendo} de {r.total === 1 ? "1 loja" : `${r.total} lojas`} recebendo
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="num text-dense text-ink">{r.carrinhos.toLocaleString("pt-BR")}</span>
                    <span className="text-label text-t2">carrinhos</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-label text-t2">
        Carrinhos: levados da vitrine ao checkout nos últimos 30 dias.
      </p>
    </nav>
  );
}
