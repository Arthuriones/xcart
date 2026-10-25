"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * O painel do conteudo: superficie com borda ao lado do menu, que rola por
 * dentro no desktop -- a janela nao rola, o menu fica parado e a barra do
 * topo e sticky dentro do painel. No celular nao e caixa de rolagem: a pagina
 * rola na janela, sem borda.
 *
 * Ao trocar de tela (pathname) o painel volta ao topo. O Next so rola a
 * janela -- e aqui ela nao rola --, entao sem isto a tela nova abria no meio,
 * na altura em que a anterior estava. Layout effect, nao effect: senao pinta
 * um quadro da tela nova na altura antiga. Mudanca so de query (abas, ?loja=)
 * nao mexe: quem quer rolar nesses casos rola por conta propria.
 *
 * Voltar/Avancar devolve a altura em que a tela estava: o navegador so guarda
 * a rolagem da janela, nunca a de um div, entao o painel guarda a sua por
 * endereco e restaura quando a troca veio de um popstate.
 *
 * Depois de navegar, o foco vai para o conteudo (#conteudo, sem rolar). A
 * rolagem por teclado (Espaco, PageDown, setas) sai do elemento com foco e
 * sobe pelos pais; com o foco no link do menu, que nao esta dentro do painel,
 * ela nunca chegava aqui.
 *
 * `md:scroll-pt-14`: a barra do topo e sticky (h-14) dentro do painel. Num
 * Link so de query com o scroll padrao, o `scrollTop = 0` do Next na janela
 * nao faz nada e o `scrollIntoView()` que vem depois alinhava o comeco da
 * pagina na borda do painel, embaixo da barra. Com o padding ele para abaixo
 * dela (vale tambem para os scrollIntoView das telas).
 *
 * `relative`: o que e `position: absolute` sem pai posicionado (o sr-only de
 * legenda de tabela, por exemplo) contava a partir da pagina e esticava a
 * JANELA -- a roda do mouse no fim do painel rolava a casca inteira.
 *
 * `data-casca="app"`: o PageHeader esconde o proprio h1 aqui dentro, porque o
 * titulo da tela ja e o h1 da barra do topo (top-nav.tsx). Na casca do admin,
 * que nao tem barra no desktop, o h1 dele continua.
 */
export function Painel({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const posicoes = useRef(new Map<string, number>());
  const doHistorico = useRef(false);
  const atual = useRef(pathname);

  useEffect(() => {
    const aoVoltar = () => {
      doHistorico.current = true;
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  useLayoutEffect(() => {
    const painel = ref.current;
    if (!painel) return;
    const top = doHistorico.current ? (posicoes.current.get(pathname) ?? 0) : 0;
    doHistorico.current = false;
    painel.scrollTo({ top });
    atual.current = pathname;
    const ativo = document.activeElement;
    if (!ativo || ativo === document.body || !painel.contains(ativo)) {
      document.getElementById("conteudo")?.focus({ preventScroll: true });
    }
  }, [pathname]);

  return (
    <div
      ref={ref}
      id="painel"
      data-casca="app"
      onScroll={(e) => posicoes.current.set(atual.current, e.currentTarget.scrollTop)}
      className="relative flex min-w-0 flex-1 flex-col bg-surface md:h-[calc(100dvh-16px)] md:flex-none md:scroll-pt-14 md:overflow-y-auto md:rounded-overlay md:border md:border-border"
    >
      {children}
    </div>
  );
}
