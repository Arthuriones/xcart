import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CabecalhoSite } from "@/components/site/cabecalho-site";
import { DOCUMENTOS_LEGAIS, type DocumentoLegal } from "@/components/site/links";
import { RodapeSite } from "@/components/site/rodape-site";
import { ancorasUnicas } from "./ancora";

interface LegalSection {
  title: string;
  body: string[];
}

interface LegalPageProps {
  title: string;
  description: string;
  updatedAt: string;
  sections: LegalSection[];
  /** Qual documento e este: marca o rodape e sai da lista "Outros documentos". */
  atual?: DocumentoLegal;
}

/**
 * Pagina de documento legal (privacidade, termos, exclusao de dados), exigida
 * pela Shopify e pelo Meta.
 *
 * So o layout e deste arquivo: o texto vem de cada page.tsx e e juridico --
 * nao se reescreve aqui. A pagina usa o topo e o rodape da landing, tem indice
 * com ancoras (fixo ao lado no desktop, no alto no celular) e linha de leitura
 * limitada a ~68 caracteres.
 */
export function LegalPage({ title, description, updatedAt, sections, atual }: LegalPageProps) {
  const ids = ancorasUnicas(sections.map((s) => s.title));
  const outros = DOCUMENTOS_LEGAIS.filter((d) => d.id !== atual);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-dense text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <CabecalhoSite base="/" />

      <main id="conteudo" className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
          <header className="flex max-w-[68ch] flex-col gap-3 border-b border-border pb-8">
            <p className="text-dense font-medium text-t2">Documentos do xcart</p>
            <h1 className="text-page text-balance text-ink md:text-kpi">{title}</h1>
            <p className="text-body leading-6 text-pretty text-t1">{description}</p>
            <p className="text-label text-t2">Última atualização: {updatedAt}</p>
          </header>

          <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
            <nav
              aria-labelledby="indice-titulo"
              className="rounded-card border border-border bg-surface p-4 lg:sticky lg:top-24 lg:self-start lg:border-0 lg:bg-transparent lg:p-0"
            >
              <p id="indice-titulo" className="text-label font-semibold text-t2">
                Nesta página
              </p>
              <ol className="mt-2 flex flex-col">
                {sections.map((s, i) => (
                  <li key={ids[i]}>
                    <a
                      href={`#${ids[i]}`}
                      className="flex min-h-ctl-lg items-center rounded-control px-2 py-1.5 text-dense text-t1 hover:bg-hover hover:text-ink lg:min-h-ctl-sm"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <article className="flex max-w-[68ch] min-w-0 flex-col">
              {sections.map((s, i) => (
                <section
                  key={ids[i]}
                  id={ids[i]}
                  aria-labelledby={`${ids[i]}-titulo`}
                  className="scroll-mt-20 border-b border-border-subtle py-8 first:pt-0 last:border-b-0"
                >
                  <h2 id={`${ids[i]}-titulo`} className="text-overlay text-ink">
                    {s.title}
                  </h2>
                  <div className="mt-3 flex flex-col gap-4 text-body leading-6 text-pretty text-t1">
                    {s.body.map((paragrafo) => (
                      <p key={paragrafo}>{paragrafo}</p>
                    ))}
                  </div>
                </section>
              ))}
            </article>

            {/* Embaixo do texto, na coluna dele (o indice segue fixo ao lado). */}
            <nav
              aria-labelledby="outros-titulo"
              className="max-w-[68ch] border-t border-border pt-8 lg:col-start-2"
            >
              <h2 id="outros-titulo" className="text-section text-ink">
                Outros documentos
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {outros.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={d.href}
                      className="flex h-ctl-lg items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:bg-hover hover:text-ink"
                    >
                      {d.rotulo}
                      <ArrowRight aria-hidden className="size-4 text-t2" strokeWidth={1.75} />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </main>

      <RodapeSite atual={atual} />
    </div>
  );
}
