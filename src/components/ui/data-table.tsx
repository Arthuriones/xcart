"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"
import { EmptyState } from "@/components/ui/empty-state"
import {
  alternarCriterio,
  ordenarLinhas,
  type CriterioOrdem,
  type DirecaoOrdem,
} from "@/components/ui/tabela"

export type ColunaTabela<T> = {
  /** Campo da linha mostrado na celula (ja formatado: texto ou JSX). */
  chave: string
  titulo: React.ReactNode
  /** Numero sempre a direita. */
  alinhar?: "esquerda" | "direita" | "centro"
  /** Padrao: ordenavel se houver valor primitivo para ordenar. */
  ordenavel?: boolean
  /**
   * Campo com o valor CRU para ordenar (numero, texto, data). Ex.: a celula
   * "lucro" mostra "R$ 1.234,00" e ordenarPor "lucroValor" guarda 1234.
   */
  ordenarPor?: string
  /** Direcao do primeiro clique. Padrao: desc para numero (direita), asc para texto. */
  direcaoInicial?: DirecaoOrdem
  /** Render da celula. Funcao: so funciona chamando de um client component. */
  celula?: (linha: T) => React.ReactNode
  /** Classes extras de th e td (largura, quebra). */
  className?: string
  /** Esconde a coluna no cartao do celular. */
  ocultarNoCartao?: boolean
}

type DataTableProps<T extends Record<string, unknown>> = {
  colunas: ColunaTabela<T>[]
  linhas: T[]
  /** Campo unico da linha (React key). Padrao "id". */
  chaveLinha?: string
  /** O que a tabela mostra, para leitor de tela: "Lucro por loja de 03/09 a 02/10". */
  legenda: string
  ordenacaoInicial?: CriterioOrdem[]
  /** compacta = linhas de 44px · confortavel = 56px. */
  densidade?: "compacta" | "confortavel"
  /** Estado vazio (use EmptyState). Filtro sem resultado e outro texto: passe o certo. */
  vazio?: React.ReactNode
  /** Linha de total, sempre no fim: { chave da coluna: conteudo }. */
  rodape?: Partial<Record<string, React.ReactNode>>
  /** Primeira coluna fixa ao rolar de lado. Padrao: sim. */
  fixarPrimeiraColuna?: boolean
  /** Altura maxima em px: a tabela rola por dentro e o cabecalho fica parado. */
  alturaMaxima?: number
  /** No celular vira lista de cartoes (primeira coluna como titulo). Padrao: sim. */
  cartoes?: boolean
  className?: string
}

const ALINHAR = { esquerda: "text-left", direita: "text-right", centro: "text-center" } as const

function primitivo(v: unknown) {
  return typeof v === "number" || typeof v === "string" || typeof v === "boolean" || v instanceof Date
}

/**
 * Tabela semantica (<table>, <th scope>, aria-sort). Ordena no cliente:
 * clique ordena, Shift + clique acrescenta desempate. Numero a direita e
 * tabular, linha de 44px, cabecalho fixo com `alturaMaxima`, primeira coluna
 * fixa, total no rodape, cartoes no celular.
 *
 * Funciona chamada de server component desde que nao use `celula` (funcao):
 * passe o conteudo pronto no campo `chave` e o valor cru em `ordenarPor`.
 */
function DataTable<T extends Record<string, unknown>>({
  colunas,
  linhas,
  chaveLinha = "id",
  legenda,
  ordenacaoInicial = [],
  densidade = "compacta",
  vazio,
  rodape,
  fixarPrimeiraColuna = true,
  alturaMaxima,
  cartoes = true,
  className,
}: DataTableProps<T>) {
  const [criterios, setCriterios] = React.useState<CriterioOrdem[]>(ordenacaoInicial)

  const campoOrdem = React.useCallback(
    (chave: string) => colunas.find((c) => c.chave === chave)?.ordenarPor ?? chave,
    [colunas]
  )
  const ordenadas = React.useMemo(
    () => ordenarLinhas(linhas, criterios, (l, chave) => l[campoOrdem(chave)]),
    [linhas, criterios, campoOrdem]
  )

  if (linhas.length === 0) {
    return (
      <div className={className}>
        {vazio ?? <EmptyState variante="simples" titulo="Nenhuma linha para mostrar" />}
      </div>
    )
  }

  const ordenavel = (c: ColunaTabela<T>) =>
    c.ordenavel ?? linhas.some((l) => primitivo(l[c.ordenarPor ?? c.chave]))
  const conteudo = (c: ColunaTabela<T>, l: T) =>
    c.celula ? c.celula(l) : (l[c.chave] as React.ReactNode)
  const chaveDe = (l: T, i: number) => String(l[chaveLinha] ?? i)
  const altura = densidade === "confortavel" ? "h-14" : "h-11"

  function clicar(c: ColunaTabela<T>, multiplo: boolean) {
    const inicial = c.direcaoInicial ?? (c.alinhar === "direita" ? "desc" : "asc")
    setCriterios((atual) => alternarCriterio(atual, c.chave, multiplo, inicial))
  }

  const [primeira, ...demais] = colunas

  return (
    <div data-slot="data-table" className={cn("min-w-0", className)}>
      <div
        role="region"
        aria-label={legenda}
        tabIndex={0}
        className={cn(
          "overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
          cartoes && "hidden sm:block"
        )}
        style={alturaMaxima ? { maxHeight: alturaMaxima } : undefined}
      >
        <table className="w-full border-separate border-spacing-0 text-dense">
          <caption className="sr-only">
            {legenda}
            {colunas.some(ordenavel) ? ". Clique no título de uma coluna para ordenar; Shift + clique soma um desempate." : ""}
          </caption>
          <thead>
            <tr>
              {colunas.map((c, i) => {
                const pos = criterios.findIndex((k) => k.chave === c.chave)
                const crit = pos >= 0 ? criterios[pos] : null
                const fixa = i === 0 && fixarPrimeiraColuna
                const direita = c.alinhar === "direita"
                return (
                  <th
                    key={c.chave}
                    scope="col"
                    aria-sort={
                      pos === 0 && crit ? (crit.direcao === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn(
                      "sticky top-0 z-10 h-10 border-b border-border bg-surface-2 px-3 text-label font-semibold whitespace-nowrap text-t1",
                      ALINHAR[c.alinhar ?? "esquerda"],
                      fixa && "left-0 z-20",
                      c.className
                    )}
                  >
                    {ordenavel(c) ? (
                      <button
                        type="button"
                        onClick={(e) => clicar(c, e.shiftKey)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm py-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          direita && "flex-row-reverse",
                          crit && "text-ink"
                        )}
                      >
                        {c.titulo}
                        {crit ? (
                          <span className="num inline-flex items-center" aria-hidden="true">
                            {crit.direcao === "desc" ? (
                              <ArrowDownIcon className="size-3.5" />
                            ) : (
                              <ArrowUpIcon className="size-3.5" />
                            )}
                            {criterios.length > 1 ? pos + 1 : null}
                          </span>
                        ) : (
                          <ChevronsUpDownIcon aria-hidden className="size-3.5 text-t4" />
                        )}
                        {crit && pos > 0 ? (
                          <span className="sr-only">
                            {`, desempate ${pos + 1}, ${crit.direcao === "asc" ? "crescente" : "decrescente"}`}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l, li) => (
              <tr key={chaveDe(l, li)} className="group/linha">
                {colunas.map((c, i) => {
                  const fixa = i === 0 && fixarPrimeiraColuna
                  const Celula = i === 0 ? "th" : "td"
                  return (
                    <Celula
                      key={c.chave}
                      scope={i === 0 ? "row" : undefined}
                      className={cn(
                        altura,
                        "border-b border-border-subtle bg-surface px-3 font-normal whitespace-nowrap text-ink group-hover/linha:bg-hover",
                        ALINHAR[c.alinhar ?? "esquerda"],
                        c.alinhar === "direita" && "num",
                        fixa && "sticky left-0 z-[5]",
                        c.className
                      )}
                    >
                      {conteudo(c, l)}
                    </Celula>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {rodape ? (
            <tfoot>
              <tr>
                {colunas.map((c, i) => (
                  <td
                    key={c.chave}
                    className={cn(
                      altura,
                      "border-t border-border bg-surface-2 px-3 font-semibold whitespace-nowrap text-ink",
                      ALINHAR[c.alinhar ?? "esquerda"],
                      c.alinhar === "direita" && "num",
                      i === 0 && fixarPrimeiraColuna && "sticky left-0 z-[5]",
                      c.className
                    )}
                  >
                    {rodape[c.chave] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {cartoes ? (
        <ul aria-label={legenda} className="flex flex-col gap-2 sm:hidden">
          {ordenadas.map((l, li) => (
            <li key={chaveDe(l, li)} className="rounded-card border border-border bg-surface p-3">
              <div className="text-body font-semibold text-ink">{conteudo(primeira, l)}</div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                {demais
                  .filter((c) => !c.ocultarNoCartao)
                  .map((c) => (
                    <div key={c.chave} className="flex min-w-0 flex-col">
                      <dt className="text-label text-t2">{c.titulo}</dt>
                      <dd className={cn("min-w-0 text-body text-ink", c.alinhar === "direita" && "num")}>
                        {conteudo(c, l)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </li>
          ))}
          {rodape ? (
            <li className="rounded-card border border-border bg-surface-2 p-3">
              <div className="text-body font-semibold text-ink">{rodape[primeira.chave] ?? "Total"}</div>
              <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                {demais
                  .filter((c) => !c.ocultarNoCartao && rodape[c.chave] != null)
                  .map((c) => (
                    <div key={c.chave} className="flex flex-col">
                      <dt className="text-label text-t2">{c.titulo}</dt>
                      <dd className="num text-body font-semibold text-ink">{rodape[c.chave]}</dd>
                    </div>
                  ))}
              </dl>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

export { DataTable }
export type { DataTableProps }
