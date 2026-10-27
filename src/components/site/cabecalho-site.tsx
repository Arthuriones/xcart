import Link from "next/link";
import { LogoXcart } from "@/components/layout/logo";
import { MenuCelular } from "./menu-celular";
import {
  CAIXA_DO_SITE,
  SECOES_LANDING,
  URL_CRIAR_CONTA,
  URL_ENTRAR,
  type CaixaDoSite,
} from "./links";

/**
 * Topo do site publico: logo (acompanha o tema), as secoes da landing, Entrar
 * e Criar conta. Abaixo de md as secoes e o Entrar vao para o menu do celular;
 * Criar conta fica a vista, com alvo de toque de 44px.
 *
 * O fundo translucido com desfoque e o do design: superficie a 86% no claro e
 * o fundo da pagina a 82% no escuro (os dois pelos tokens).
 *
 * `base`: "" na landing (ancoras na propria pagina), "/" nas paginas legais.
 * `caixa`: largura e margem, a mesma do texto da pagina (ver CAIXA_DO_SITE).
 */
export function CabecalhoSite({
  base = "",
  caixa = "legal",
}: {
  base?: string;
  caixa?: CaixaDoSite;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/86 backdrop-blur-[14px] backdrop-saturate-[1.6] dark:bg-bg/82">
      <div className={`mx-auto flex h-15 w-full items-center gap-2 ${CAIXA_DO_SITE[caixa]}`}>
        <Link
          href="/"
          aria-label="xcart, início"
          className="mr-5 flex h-ctl-lg shrink-0 items-center rounded-control"
        >
          <LogoXcart altura={20} />
        </Link>

        <nav aria-label="Seções do site" className="hidden md:block">
          <ul className="flex items-center gap-0.5">
            {SECOES_LANDING.map((s) => (
              <li key={s.id}>
                <a
                  href={`${base}#${s.id}`}
                  className="flex h-ctl-md items-center rounded-control px-3 text-dense font-medium text-t1 hover:bg-nav-active hover:text-ink"
                >
                  {s.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={URL_ENTRAR}
            className="hidden h-ctl-md items-center rounded-control px-3 text-dense font-medium text-ink hover:bg-nav-active hover:text-ink md:inline-flex"
          >
            Entrar
          </a>
          <a
            href={URL_CRIAR_CONTA}
            className="inline-flex h-ctl-lg items-center gap-1.5 rounded-control bg-solid px-3.5 text-dense font-medium text-on-solid hover:bg-solid-hover hover:text-on-solid md:h-ctl-md"
          >
            Criar conta
          </a>
          <MenuCelular base={base} />
        </div>
      </div>
    </header>
  );
}
