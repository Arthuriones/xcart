"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { StatusBadge } from "@/components/ui/status-badge";
import type { LojaFaturamento, UsuarioFaturamento } from "@/lib/sales/admin-types";
import { inteiro, naMoeda, plural, reais } from "../formato";

// ============================================================================
// Faturamento por cliente, com as lojas de cada um abrindo embaixo.
//
// Antes a linha inteira era um <tr onClick>: sem foco, sem teclado e sem dizer
// ao leitor de tela que abria alguma coisa. Agora quem abre e um <button> com
// aria-expanded na primeira celula, e as lojas sao linhas de verdade da mesma
// tabela. No celular vira lista de cartoes, com o mesmo botao.
// ============================================================================

const TH =
  "sticky top-0 z-10 h-10 border-b border-border bg-surface-2 px-3 text-label font-semibold whitespace-nowrap text-t1";
const TD = "border-b border-border-subtle px-3 text-ink";
const LINK =
  "min-w-0 truncate rounded-sm font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const BOTAO_ABRIR =
  "grid size-8 shrink-0 place-items-center rounded-control text-t1 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function cego(u: UsuarioFaturamento) {
  return u.lojasComDados === 0;
}

/** O valor da loja: moeda dela e, se nao for real, o convertido embaixo. */
function ValorLoja({ l }: { l: LojaFaturamento }) {
  if (l.problem === "denied") {
    return (
      <span className="inline-flex flex-col items-end gap-0.5">
        <StatusBadge tom="err" texto="Sem permissão" />
        <span className="text-label text-t2">falta a permissão de pedidos</span>
      </span>
    );
  }
  if (l.problem === "failed") return <StatusBadge tom="neutral" texto="Não respondeu" />;
  return (
    <span className="num inline-flex flex-col items-end">
      <span>{naMoeda(l.revenueCents / 100, l.currency, 0)}</span>
      {l.currency !== "BRL" ? (
        <span className="text-label text-t2">
          {l.revenueBrlCents === null ? "sem taxa para real" : `≈ ${reais(l.revenueBrlCents / 100, 0)}`}
        </span>
      ) : null}
    </span>
  );
}

function SelosCliente({ u }: { u: UsuarioFaturamento }) {
  return (
    <>
      {u.plan === "pro" ? <StatusBadge tom="info" texto="Pro" ponto={false} /> : null}
      {u.semTaxa.length > 0 ? (
        <StatusBadge tom="warn" texto={`${u.semTaxa.join(", ")} fora do total`} ponto={false} />
      ) : null}
    </>
  );
}

function Recebe({ l }: { l: LojaFaturamento }) {
  return (
    <span className="block truncate text-label text-t2">
      <span className="font-mono">{l.domain}</span>
      {l.vitrines.length > 0 ? ` · recebe de ${l.vitrines.join(", ")}` : ""}
    </span>
  );
}

export function TabelaFaturamento({ usuarios, periodoTexto }: { usuarios: UsuarioFaturamento[]; periodoTexto: string }) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(() => new Set());

  function alternar(id: string) {
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  return (
    <div className="min-w-0">
      {/* ---------------- Desktop: tabela ---------------- */}
      <div
        role="region"
        aria-label={`Faturamento por cliente, ${periodoTexto}`}
        tabIndex={0}
        className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:block"
      >
        <table className="w-full border-separate border-spacing-0 text-dense">
          <caption className="sr-only">
            Faturamento por cliente, {periodoTexto}. Use o botão de cada cliente para ver as lojas dele.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={cn(TH, "text-left")}>
                Cliente
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Pedidos pagos
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Faturamento
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Lojas que responderam
              </th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u, i) => {
              const aberto = abertos.has(u.userId);
              const idLojas = u.lojas.map((_, j) => `fat-${u.userId}-${j}`).join(" ");
              return (
                <Fragment key={u.userId}>
                  <tr className="group/linha">
                    <th scope="row" className={cn(TD, "h-14 bg-surface text-left font-normal group-hover/linha:bg-hover")}>
                      <span className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={aberto}
                          aria-controls={idLojas}
                          aria-label={`${aberto ? "Esconder" : "Ver"} as lojas de ${u.email}`}
                          onClick={() => alternar(u.userId)}
                          className={BOTAO_ABRIR}
                        >
                          <ChevronRightIcon
                            aria-hidden
                            className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", aberto && "rotate-90")}
                          />
                        </button>
                        <span className="num w-7 shrink-0 text-label text-t2">{cego(u) ? "—" : `${i + 1}º`}</span>
                        <Link href={`/admin/users/${u.userId}`} className={LINK}>
                          {u.email}
                        </Link>
                        <SelosCliente u={u} />
                      </span>
                    </th>
                    <td className={cn(TD, "num bg-surface text-right group-hover/linha:bg-hover")}>
                      {cego(u) ? "—" : inteiro(u.orders)}
                    </td>
                    <td className={cn(TD, "num bg-surface text-right font-semibold group-hover/linha:bg-hover")}>
                      {cego(u) ? <span className="font-normal text-t2">sem dados</span> : reais(u.revenueBrlCents / 100)}
                    </td>
                    <td className={cn(TD, "num bg-surface text-right text-t1 group-hover/linha:bg-hover")}>
                      {inteiro(u.lojasComDados)} de {inteiro(u.lojas.length)}
                    </td>
                  </tr>
                  {u.lojas.map((l, j) => (
                    <tr key={l.storeId} id={`fat-${u.userId}-${j}`} hidden={!aberto}>
                      <th scope="row" className={cn(TD, "h-12 bg-surface-2 py-2 pl-20 text-left font-normal")}>
                        <span className="block truncate text-ink">{l.name}</span>
                        <Recebe l={l} />
                      </th>
                      <td className={cn(TD, "num bg-surface-2 text-right text-t1")}>
                        {l.problem ? "—" : inteiro(l.orders)}
                      </td>
                      <td className={cn(TD, "bg-surface-2 py-2 text-right")}>
                        <ValorLoja l={l} />
                      </td>
                      <td className={cn(TD, "bg-surface-2")} />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------- Celular: cartoes ---------------- */}
      <ul aria-label={`Faturamento por cliente, ${periodoTexto}`} className="flex flex-col gap-2 p-3 sm:hidden">
        {usuarios.map((u, i) => {
          const aberto = abertos.has(u.userId);
          const idLista = `fat-cel-${u.userId}`;
          return (
            <li key={u.userId} className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="num shrink-0 text-label text-t2">{cego(u) ? "—" : `${i + 1}º`}</span>
                <Link href={`/admin/users/${u.userId}`} className={LINK}>
                  {u.email}
                </Link>
              </div>
              <div className="flex flex-wrap gap-1.5 empty:hidden">
                <SelosCliente u={u} />
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div className="flex flex-col">
                  <dt className="text-label text-t2">Faturamento</dt>
                  <dd className="num text-body font-semibold text-ink">
                    {cego(u) ? <span className="font-normal text-t2">sem dados</span> : reais(u.revenueBrlCents / 100)}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-label text-t2">Pedidos pagos</dt>
                  <dd className="num text-body text-ink">{cego(u) ? "—" : inteiro(u.orders)}</dd>
                </div>
                <div className="col-span-2 flex flex-col">
                  <dt className="text-label text-t2">Lojas que responderam</dt>
                  <dd className="num text-body text-ink">
                    {inteiro(u.lojasComDados)} de {inteiro(u.lojas.length)}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                aria-expanded={aberto}
                aria-controls={idLista}
                onClick={() => alternar(u.userId)}
                className="flex h-ctl-lg items-center justify-between rounded-control border border-border-strong px-3 text-dense font-medium text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {aberto ? "Esconder as lojas" : `Ver ${u.lojas.length === 1 ? "a loja" : `as ${inteiro(u.lojas.length)} lojas`}`}
                <ChevronRightIcon
                  aria-hidden
                  className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", aberto && "rotate-90")}
                />
              </button>
              <ul id={idLista} hidden={!aberto} className="flex flex-col gap-2">
                {u.lojas.map((l) => (
                  <li key={l.storeId} className="flex flex-col gap-1 rounded-control bg-surface-2 p-2.5">
                    <span className="truncate text-dense font-medium text-ink">{l.name}</span>
                    <Recebe l={l} />
                    <div className="flex items-end justify-between gap-2 pt-1">
                      <span className="num text-label text-t2">
                        {l.problem ? "—" : plural(l.orders, "pedido", "pedidos")}
                      </span>
                      <ValorLoja l={l} />
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
