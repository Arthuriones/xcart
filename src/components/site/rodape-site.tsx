import Link from "next/link";
import { LogoXcart } from "@/components/layout/logo";
import { SeletorTema } from "@/components/layout/tema";
import {
  CAIXA_DO_SITE,
  DOCUMENTOS_LEGAIS,
  URL_ENTRAR,
  type CaixaDoSite,
  type DocumentoLegal,
} from "./links";

/**
 * Rodape do site publico: os documentos legais (exigidos pela Shopify e pelo
 * Meta), Entrar e a troca de tema. `atual` marca o documento aberto.
 *
 * Escuro nos dois temas: a classe `dark` troca a paleta so aqui dentro, e a
 * logo de texto branco aparece sozinha. Os tres blocos quebram linha sozinhos
 * (flex-wrap) quando nao cabem lado a lado. `caixa`: largura e margem, a
 * mesma do texto da pagina (ver CAIXA_DO_SITE).
 */
export function RodapeSite({
  atual,
  caixa = "legal",
}: {
  atual?: DocumentoLegal;
  caixa?: CaixaDoSite;
}) {
  const link =
    "flex h-ctl-lg items-center rounded-control px-2.5 text-dense text-t1 hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink md:h-9";

  return (
    <footer className="dark border-t border-border bg-bg text-ink">
      <div
        className={`mx-auto flex w-full flex-wrap items-center justify-between gap-6 py-9 ${CAIXA_DO_SITE[caixa]}`}
      >
        <div className="flex flex-col gap-2">
          <LogoXcart altura={20} />
          <p className="text-label text-t3">© {new Date().getFullYear()} xcart</p>
        </div>

        <nav aria-label="Documentos e acesso">
          <ul className="flex flex-wrap gap-0.5">
            {DOCUMENTOS_LEGAIS.map((d) => (
              <li key={d.id}>
                <Link href={d.href} aria-current={atual === d.id ? "page" : undefined} className={link}>
                  {d.rotulo}
                </Link>
              </li>
            ))}
            <li>
              <a href={URL_ENTRAR} className={link}>
                Entrar
              </a>
            </li>
          </ul>
        </nav>

        <div className="w-60">
          <SeletorTema />
        </div>
      </div>
    </footer>
  );
}
