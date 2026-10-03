import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/components/ui/cn";
import { lerLojaBase } from "@/lib/leitura/resumo-lojas";
import { SELO_CONEXAO, moedaIdioma, rotuloPapel } from "@/lib/leitura/lojas-estado";
import { ConectarLojaProvider } from "../conectar-loja";
import { AcoesLoja, AvisoConexao } from "./acoes-loja";
import { AbaVisao } from "./aba-visao";
import { AbaRastreamento } from "./aba-rastreamento";
import { AbaFinanceiro } from "./aba-financeiro";
import { AbaConfiguracao } from "./aba-configuracao";
import { EsqueletoAba } from "./esqueleto";

export const dynamic = "force-dynamic";

const ABAS = [
  { id: "visao", rotulo: "Visão geral" },
  { id: "rastreamento", rotulo: "Rastreamento" },
  { id: "financeiro", rotulo: "Financeiro" },
  { id: "configuracao", rotulo: "Configuração" },
] as const;
type Aba = (typeof ABAS)[number]["id"];

/**
 * Detalhe da loja: tudo de uma loja num lugar, em abas na URL (?aba=), para
 * dar para mandar o link e para o servidor buscar so o que a aba usa -- o
 * diagnostico na Shopify, que leva segundos, so roda em Rastreamento.
 */
export default async function DetalheLojaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const base = await lerLojaBase(id);
  if (!base) notFound();

  const aba: Aba = ABAS.find((a) => a.id === sp.aba)?.id ?? "visao";
  const loja = {
    id: base.id,
    nome: base.nome,
    dominio: base.dominio,
    chave: base.conexao.chave,
    semAcesso: base.conexao.semAcesso,
  };

  return (
    <ConectarLojaProvider>
      <nav aria-label="Caminho" className="mb-3 flex min-w-0 items-center gap-1.5 text-dense">
        <Link
          href="/stores"
          className="rounded-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Lojas
        </Link>
        <span aria-hidden className="text-t3">
          /
        </span>
        <span aria-current="page" className="truncate text-t1">
          {base.nome}
        </span>
      </nav>

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {/* Visivel tambem no celular: o topo de la mostra "Lojas", nao o nome. */}
          <h1 className="text-page font-semibold break-words text-ink">{base.nome}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-t1">
            <StatusBadge {...SELO_CONEXAO[base.conexao.chave]} />
            <span className="font-mono">{base.dominio}</span>
            <span aria-hidden className="text-t3">
              ·
            </span>
            <span>{moedaIdioma(base.moeda, base.idioma)}</span>
            {base.papel !== "unassigned" ? (
              <>
                <span aria-hidden className="text-t3">
                  ·
                </span>
                <span>{rotuloPapel(base.papel)}</span>
              </>
            ) : null}
          </div>
        </div>
        <AcoesLoja loja={loja} sincronizando={Boolean(base.sync?.sincronizando)} />
      </div>

      <AvisoConexao loja={loja} erro={base.sync?.ultimoErro ?? null} />

      <nav
        aria-label="Seções da loja"
        className="flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none]"
      >
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          return (
            <Link
              key={a.id}
              href={a.id === "visao" ? `/stores/${base.id}` : `/stores/${base.id}?aba=${a.id}`}
              aria-current={ativa ? "page" : undefined}
              scroll={false}
              className={cn(
                "-mb-px inline-flex h-10 shrink-0 items-center border-b-2 text-dense font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                ativa ? "border-ink text-ink" : "border-transparent text-t2 hover:text-ink"
              )}
            >
              {a.rotulo}
            </Link>
          );
        })}
      </nav>

      <div className="pt-5">
        <Suspense key={aba} fallback={<EsqueletoAba aba={aba} />}>
          {aba === "visao" ? <AbaVisao base={base} /> : null}
          {aba === "rastreamento" ? <AbaRastreamento base={base} /> : null}
          {aba === "financeiro" ? <AbaFinanceiro base={base} /> : null}
          {aba === "configuracao" ? <AbaConfiguracao base={base} /> : null}
        </Suspense>
      </div>
    </ConectarLojaProvider>
  );
}
