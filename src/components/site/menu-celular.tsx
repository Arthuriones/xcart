"use client";

import { useRef, useState, type MouseEvent } from "react";
import { Menu } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SECOES_LANDING, URL_CRIAR_CONTA, URL_ENTRAR } from "./links";

/**
 * Menu do site no celular (abaixo de md o menu do topo some).
 *
 * As secoes sao ancoras da landing. Com o painel aberto a pagina fica travada
 * (a rolagem e do painel), entao o salto nao pode ser o do navegador: o clique
 * guarda o destino, fecha o painel e, quando a animacao de saida termina, rola
 * ate a secao e leva o foco para o titulo dela -- quem usa teclado continua
 * lendo dali, e nao do botao de menu la em cima.
 *
 * `base` e o caminho da landing: "" na propria landing, "/" nas paginas
 * legais (ali a secao fica em outra pagina, e o link navega normalmente).
 */
export function MenuCelular({ base = "" }: { base?: string }) {
  const [aberto, setAberto] = useState(false);
  const alvo = useRef<string | null>(null);

  function irPara(e: MouseEvent<HTMLAnchorElement>, id: string) {
    if (base) return; // outra pagina: o link segue normal
    e.preventDefault();
    alvo.current = id;
    setAberto(false);
  }

  function aoTerminar(abrindo: boolean) {
    if (abrindo || !alvo.current) return;
    const id = alvo.current;
    alvo.current = null;
    const secao = document.getElementById(id);
    if (!secao) return;
    secao.scrollIntoView({ block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    const titulo = secao.querySelector<HTMLElement>("h2") ?? secao;
    if (!titulo.hasAttribute("tabindex")) titulo.setAttribute("tabindex", "-1");
    titulo.focus({ preventScroll: true });
  }

  return (
    <Sheet open={aberto} onOpenChange={setAberto} onOpenChangeComplete={aoTerminar}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="Abrir menu" />}
      >
        <Menu aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="right"
        size="sm"
        // Com destino escolhido, o foco vai para a secao (aoTerminar), nao volta ao botao.
        finalFocus={() => !alvo.current}
      >
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <SheetBody className="p-2">
          <nav aria-label="Seções da página">
            <ul className="flex flex-col">
              {SECOES_LANDING.map((s) => (
                <li key={s.id}>
                  <a
                    href={`${base}#${s.id}`}
                    onClick={(e) => irPara(e, s.id)}
                    className="flex h-ctl-lg items-center rounded-control px-3 text-body font-medium text-ink hover:bg-hover hover:text-ink"
                  >
                    {s.rotulo}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </SheetBody>
        {/* Coluna invertida em toda largura: Criar conta em cima, Entrar embaixo. */}
        <SheetFooter className="sm:flex-col-reverse sm:justify-start">
          <a
            href={URL_ENTRAR}
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full")}
          >
            Entrar
          </a>
          <a
            href={URL_CRIAR_CONTA}
            className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
          >
            Criar conta
          </a>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
