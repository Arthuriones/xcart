import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { LogoXcart } from "@/components/layout/logo";
import { MenuCelular } from "./menu-celular";
import { SECOES_LANDING, URL_CRIAR_CONTA, URL_ENTRAR } from "./links";

/**
 * Topo do site publico: logo (acompanha o tema), as secoes da landing, Entrar
 * e Criar conta. Abaixo de md as secoes e o Entrar vao para o menu do celular;
 * Criar conta fica a vista.
 *
 * `base`: "" na landing (ancoras na propria pagina), "/" nas paginas legais.
 */
export function CabecalhoSite({ base = "" }: { base?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/92 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="xcart, início"
          className="mr-4 flex h-ctl-lg shrink-0 items-center rounded-control"
        >
          <LogoXcart altura={22} prioridade />
        </Link>

        <nav aria-label="Seções do site" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {SECOES_LANDING.map((s) => (
              <li key={s.id}>
                <a
                  href={`${base}#${s.id}`}
                  className="flex h-ctl-md items-center rounded-control px-3 text-dense font-medium text-t1 hover:bg-hover hover:text-ink"
                >
                  {s.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={URL_ENTRAR}
            className={cn(buttonVariants({ variant: "ghost" }), "hidden md:inline-flex")}
          >
            Entrar
          </a>
          {/* No celular, alvo de toque de 44px. */}
          <a
            href={URL_CRIAR_CONTA}
            className={cn(buttonVariants({ variant: "primary" }), "max-md:h-ctl-lg")}
          >
            Criar conta
          </a>
          <MenuCelular base={base} />
        </div>
      </div>
    </header>
  );
}
