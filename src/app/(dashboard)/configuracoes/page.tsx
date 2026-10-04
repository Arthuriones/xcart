import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SECOES_CONFIGURACOES } from "@/components/layout/navegacao";
import { textos } from "@/lib/textos";

const t = textos("nav");

/**
 * Configuracoes: o indice do que saiu do menu -- contas, custos, notificacoes,
 * assinatura e os modulos (Roteamento, Importar, Atividade, Claude e Guia).
 * So links, sem leitura de banco: abre na hora. A lista mora em navegacao.ts,
 * junto do menu, e e travada por tests/nav-ativo.test.ts.
 */
export default function ConfiguracoesPage() {
  return (
    <>
      <PageHeader title={t("settings")} />
      <div className="flex flex-col gap-8">
        {SECOES_CONFIGURACOES.map((secao) => (
          <section
            key={secao.id}
            id={secao.id}
            aria-labelledby={`cfg-${secao.id}`}
            className="flex scroll-mt-20 flex-col gap-3"
          >
            <h2 id={`cfg-${secao.id}`} className="text-section text-ink">
              {secao.titulo}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {secao.links.map((link) => (
                <li key={link.href} className="min-w-0">
                  <Link
                    href={link.href}
                    className="group flex h-full min-h-ctl-lg items-center gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-dense font-semibold text-ink">{link.rotulo}</span>
                      <span className="text-label text-t2">{link.dica}</span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-t3 group-hover:text-ink"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
