import Link from "next/link";
import { LogoXcart } from "@/components/layout/logo";
import { SeletorTema } from "@/components/layout/tema";
import { DOCUMENTOS_LEGAIS, URL_ENTRAR, type DocumentoLegal } from "./links";

/**
 * Rodape do site publico: os documentos legais (exigidos pela Shopify e pelo
 * Meta), Entrar e a troca de tema. `atual` marca o documento aberto.
 */
export function RodapeSite({ atual }: { atual?: DocumentoLegal }) {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <LogoXcart altura={20} />
          <p className="text-label text-t2">© {new Date().getFullYear()} xcart</p>
        </div>

        <nav aria-label="Documentos e acesso">
          <ul className="-mx-2 flex flex-wrap gap-x-1 gap-y-1">
            {DOCUMENTOS_LEGAIS.map((d) => (
              <li key={d.id}>
                <Link
                  href={d.href}
                  aria-current={atual === d.id ? "page" : undefined}
                  className="flex h-ctl-lg items-center rounded-control px-2 text-dense text-t1 hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink md:h-ctl-md"
                >
                  {d.rotulo}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={URL_ENTRAR}
                className="flex h-ctl-lg items-center rounded-control px-2 text-dense text-t1 hover:text-ink md:h-ctl-md"
              >
                Entrar
              </a>
            </li>
          </ul>
        </nav>

        <div className="w-full max-w-60">
          <SeletorTema />
        </div>
      </div>
    </footer>
  );
}
