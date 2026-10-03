"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { LogoXcart } from "@/components/layout/logo";
import { APP_HOME } from "@/lib/app-home";
import { contextoDaRota, tituloDaRota } from "./navegacao";
import { PaletaComandos, abrirBusca } from "./paleta-comandos";
import {
  Atualizado,
  BarraContexto,
  ContextoCelular,
  useContexto,
  type DadosContexto,
} from "./seletor-global";
import { Sino, SinoCelular } from "./sino";

/**
 * O topo da casca.
 *
 * Desktop: barra de contexto (loja, periodo, comparacao, moeda), "Atualizado
 * as", busca e sino. O titulo da tela fica no PageHeader da propria pagina --
 * um titulo por tela, sem repetir aqui.
 *
 * Celular: logo, titulo, busca e sino; o contexto vira um botao que abre num
 * painel. Entre 768 e 1023 px o desktop usa o mesmo botao: a barra inteira
 * nao cabe ao lado do menu.
 *
 * `contexto` chega pronto do servidor (topo-dados.tsx); null = a leitura
 * falhou, e o topo segue sem a barra.
 */
export function TopNav({
  contexto,
  alertasAbertos,
}: {
  contexto: DadosContexto | null;
  alertasAbertos: number | null;
}) {
  const pathname = usePathname();
  const modo = contextoDaRota(pathname);
  const titulo = tituloDaRota(pathname);
  const ctx = useContexto(contexto);
  const temContexto = !!contexto && modo.tipo !== "nenhum";

  return (
    <>
      <header className="sticky top-0 z-30 hidden h-15 shrink-0 items-center gap-2 border-b border-border bg-surface px-6 md:flex">
        {contexto && temContexto && (
          <>
            <div className="hidden min-w-0 lg:flex">
              <BarraContexto dados={contexto} ctx={ctx} modo={modo} />
            </div>
            <div className="min-w-0 max-w-90 flex-1 lg:hidden">
              <ContextoCelular dados={contexto} ctx={ctx} modo={modo} chaveTela={pathname} />
            </div>
          </>
        )}
        <div className="flex-1" />
        {contexto && temContexto && (
          <>
            <div className="hidden lg:block">
              <Atualizado ctx={ctx} fuso={contexto.fuso} chaveTela={pathname} />
            </div>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-border lg:block" />
          </>
        )}
        <button
          type="button"
          onClick={abrirBusca}
          aria-label="Buscar ou ir para (Ctrl K)"
          className="flex h-ctl-md items-center gap-2 whitespace-nowrap rounded-control border border-border-strong bg-surface-2 px-2.5 text-dense text-t2 hover:border-control-border hover:text-ink"
        >
          <Search className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="hidden lg:inline">Buscar</span>
          <kbd className="hidden rounded-control border border-border bg-surface px-1.5 font-mono text-label text-t2 min-[1360px]:inline">
            Ctrl K
          </kbd>
        </button>
        <Sino total={alertasAbertos} />
      </header>

      <header className="sticky top-0 z-30 border-b border-border bg-surface md:hidden">
        <div className="flex h-14 items-center gap-1 pl-4 pr-1">
          <Link href={APP_HOME} aria-label="xcart, ir para o Lucro" className="mr-2 shrink-0">
            <LogoXcart altura={14} />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-section font-semibold text-ink">{titulo}</h1>
          <button
            type="button"
            onClick={abrirBusca}
            aria-label="Buscar ou ir para"
            className="grid size-ctl-lg shrink-0 place-items-center rounded-control text-t1 hover:text-ink"
          >
            <Search className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <SinoCelular total={alertasAbertos} />
        </div>
        {contexto && temContexto && (
          <div className="px-4 pb-3">
            <ContextoCelular dados={contexto} ctx={ctx} modo={modo} chaveTela={pathname} />
          </div>
        )}
      </header>

      <PaletaComandos
        lojas={contexto?.lojas ?? []}
        onEscolherLoja={contexto ? (id) => ctx.gravar({ lojaId: id }) : undefined}
        onAtualizar={ctx.atualizar}
      />
    </>
  );
}
