"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { SECOES_LANDING, URL_ENTRAR } from "./links";

/**
 * Menu do site no celular (abaixo de md o menu do topo some).
 *
 * E uma lista que abre logo abaixo do topo (design novo), nao um painel
 * lateral: a pagina continua rolando, entao a ancora da secao salta como
 * qualquer link -- o navegador rola e leva o ponto de partida do teclado para
 * a secao. O clique so fecha a lista. Esc fecha e devolve o foco ao botao;
 * tocar fora fecha.
 *
 * A lista e absoluta em relacao ao topo (sticky, logo e o bloco que a
 * contem): cobre o comeco da pagina em vez de empurra-la.
 *
 * `base` e o caminho da landing: "" na propria landing, "/" nas paginas
 * legais (ali a secao fica em outra pagina, e o link navega normalmente).
 */
export function MenuCelular({ base = "" }: { base?: string }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setAberto(false);
      botao.current?.focus();
    }
    function aoTocar(e: PointerEvent) {
      const alvo = e.target as Node;
      if (lista.current?.contains(alvo) || botao.current?.contains(alvo)) return;
      setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocar);
    };
  }, [aberto]);

  const Icone = aberto ? X : Menu;
  const link =
    "flex min-h-ctl-lg items-center rounded-control px-2 text-[15px] font-medium text-ink hover:bg-hover hover:text-ink";

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-controls="menu-celular"
        aria-label={aberto ? "Fechar menu" : "Abrir menu"}
        className="grid size-ctl-lg place-items-center rounded-control text-t1 hover:text-ink md:hidden"
      >
        <Icone aria-hidden className="size-5" strokeWidth={1.75} />
      </button>
      <nav
        ref={lista}
        id="menu-celular"
        aria-label="Seções do site"
        hidden={!aberto}
        className="absolute inset-x-0 top-full border-y border-border bg-surface px-4 pt-2 pb-4 md:hidden"
      >
        <ul>
          {SECOES_LANDING.map((s) => (
            <li key={s.id}>
              <a href={`${base}#${s.id}`} onClick={() => setAberto(false)} className={link}>
                {s.rotulo}
              </a>
            </li>
          ))}
          <li>
            <a href={URL_ENTRAR} className={link}>
              Entrar
            </a>
          </li>
        </ul>
      </nav>
    </>
  );
}
