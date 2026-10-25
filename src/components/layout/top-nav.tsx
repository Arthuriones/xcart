"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import clsx from "clsx";
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
 * O topo da casca, dentro do painel do conteudo.
 *
 * Desktop: o h1 da tela (o mesmo nome do menu), o contexto dos numeros (loja,
 * periodo, comparacao, moeda), "Atualizado as", atualizar e sino. A busca
 * mora no topo do menu lateral. O titulo e daqui: o PageHeader das telas so
 * traz descricao e acoes -- um h1 por tela.
 *
 * As larguras sao do PAINEL, nao da janela (container query no header): o
 * menu aberto ou recolhido muda o espaco. Abaixo de 860px a barra inteira vira
 * o botao compacto, que abre o contexto numa folha; "Atualizado as" aparece
 * de 980px e as datas do periodo de 1080px (seletor-global.tsx).
 *
 * Celular: logo, titulo, busca e sino; o contexto vira um botao de largura
 * total que abre num painel, com Aplicar.
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
  // So o modo completo (loja, periodo, comparacao, moeda) precisa de espaco;
  // o seletor de loja sozinho cabe em qualquer painel.
  const completo = modo.tipo === "completo";

  return (
    <>
      <header className="@container sticky top-0 z-30 hidden h-14 shrink-0 items-center gap-1.5 border-b border-border bg-surface pl-5 pr-3 md:flex">
        <h1 className="shrink-0 whitespace-nowrap text-section text-ink">{titulo}</h1>
        {contexto && temContexto && (
          <>
            <span aria-hidden className="mx-2 h-5 w-px shrink-0 bg-border" />
            <div className={clsx("min-w-0", completo ? "hidden @min-[860px]:flex" : "flex")}>
              <BarraContexto dados={contexto} ctx={ctx} modo={modo} />
            </div>
            {completo && (
              <div className="flex min-w-0 @min-[860px]:hidden">
                <ContextoCelular dados={contexto} ctx={ctx} modo={modo} chaveTela={pathname} compacto />
              </div>
            )}
          </>
        )}
        <span className="flex-1" />
        {contexto && temContexto && <Atualizado ctx={ctx} fuso={contexto.fuso} chaveTela={pathname} />}
        <Sino total={alertasAbertos} />
      </header>

      <header className="sticky top-0 z-30 border-b border-border bg-surface md:hidden">
        <CabecalhoCelular titulo={titulo}>
          <button
            type="button"
            onClick={abrirBusca}
            aria-label="Buscar ou ir para"
            className="grid size-ctl-lg shrink-0 place-items-center rounded-control text-t1 hover:text-ink"
          >
            <Search className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <SinoCelular total={alertasAbertos} />
        </CabecalhoCelular>
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

/** A linha de cima do celular: logo, h1 e os botoes que vierem. */
function CabecalhoCelular({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex h-14 items-center gap-1 pl-4 pr-1">
      <Link href={APP_HOME} aria-label="xcart, ir para o Dashboard" className="mr-1.5 flex h-ctl-lg shrink-0 items-center">
        <LogoXcart altura={14} />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-section text-ink">{titulo}</h1>
      {children}
    </div>
  );
}

/**
 * O topo enquanto os dados (lojas, filtro, alertas) nao chegaram: a mesma
 * altura e o mesmo h1 -- o titulo vem do caminho, sem esperar o banco --, e o
 * lugar do contexto ja reservado no celular. Nada pula quando o topo de
 * verdade entra.
 */
export function TopoCarregando() {
  const pathname = usePathname();
  const titulo = tituloDaRota(pathname);
  const temContexto = contextoDaRota(pathname).tipo !== "nenhum";
  return (
    <>
      <div className="sticky top-0 z-30 hidden h-14 shrink-0 items-center gap-1.5 border-b border-border bg-surface pl-5 pr-3 md:flex">
        <h1 className="shrink-0 whitespace-nowrap text-section text-ink">{titulo}</h1>
        {temContexto && (
          <>
            <span aria-hidden className="mx-2 h-5 w-px shrink-0 bg-border" />
            <span aria-hidden className="block h-ctl-md w-40 rounded-control bg-skeleton" />
            <span aria-hidden className="block h-ctl-md w-36 rounded-control bg-skeleton" />
          </>
        )}
      </div>
      <div className="sticky top-0 z-30 border-b border-border bg-surface md:hidden">
        <CabecalhoCelular titulo={titulo}>
          {/* O lugar da busca e do sino: o titulo nao muda de largura. */}
          <span aria-hidden className="w-22 shrink-0" />
        </CabecalhoCelular>
        {temContexto && (
          <div className="px-4 pb-3">
            <span aria-hidden className="block h-ctl-lg rounded-control bg-skeleton" />
          </div>
        )}
      </div>
    </>
  );
}
