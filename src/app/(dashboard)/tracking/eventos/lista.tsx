"use client";

import { memo } from "react";
import { ExternalLinkIcon } from "lucide-react";
import type { EventoFeed } from "@/lib/financeiro/tipos";
import { cn } from "@/components/ui/cn";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FONTE_TELA,
  STATUS_TELA,
  ehCompra,
  formatarLatencia,
  horaDoEvento,
  nomeDoEvento,
  nomePlataforma,
  rotuloDia,
  textoClique,
  textoOrigem,
} from "./logica";

// ============================================================================
// A lista de eventos: tabela no desktop, cartoes no celular. Toda linha abre o
// detalhe -- pelo botao da hora (teclado e leitor de tela) ou pelo clique em
// qualquer ponto da linha (mouse). Linha recem-chegada pisca uma vez.
// ============================================================================

export interface ContextoLista {
  fuso: string;
  /** "AAAA-MM-DD" de hoje no fuso: a data so aparece em evento de outro dia. */
  hoje: string;
  /** Com todas as lojas, a coluna Loja aparece. */
  todas: boolean;
  nomeLoja: (storeId: string) => string;
  /** "#1040" quando o financeiro ja conhece o pedido. */
  nomePedido: (e: EventoFeed) => string | null;
  urlPedido: (e: EventoFeed) => string | null;
  onAbrir: (e: EventoFeed) => void;
}

const TD = "h-11 border-b border-border-subtle px-2.5 align-middle";
const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function rotuloAbrir(e: EventoFeed, hora: string): string {
  return `${nomeDoEvento(e.evento)} para ${nomePlataforma(e.plataforma)}, ${STATUS_TELA[e.status].rotulo}, ${hora}: abrir detalhe`;
}

function Status({ e }: { e: EventoFeed }) {
  const s = STATUS_TELA[e.status];
  return <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>;
}

function TagPlataforma({ plataforma }: { plataforma: string }) {
  return (
    <span className="mr-1.5 inline-flex h-4.5 shrink-0 items-center rounded-sm border border-border-strong px-1 text-label font-semibold text-t1">
      {nomePlataforma(plataforma)}
    </span>
  );
}

function Pedido({ e, ctx }: { e: EventoFeed; ctx: ContextoLista }) {
  if (!e.pedido) return <span className="text-t2">—</span>;
  const nome = ctx.nomePedido(e);
  const url = ctx.urlPedido(e);
  if (!url) return <span>{nome ?? "—"}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(ev) => ev.stopPropagation()}
      aria-label={`Abrir pedido ${nome ? `${nome} ` : ""}no admin da Shopify (abre em nova aba)`}
      className={cn("inline-flex items-center gap-1 rounded-sm text-ink underline-offset-4 hover:underline", FOCO)}
    >
      {nome ?? "Abrir"}
      <ExternalLinkIcon aria-hidden className="size-3" strokeWidth={2} />
    </a>
  );
}

const Linha = memo(function Linha({
  e,
  novo,
  ctx,
}: {
  e: EventoFeed;
  novo: boolean;
  ctx: ContextoLista;
}) {
  const hora = horaDoEvento(e.criado_em, ctx.fuso);
  const dia = rotuloDia(e.criado_em, ctx.hoje, ctx.fuso);
  return (
    <tr
      onClick={() => ctx.onAbrir(e)}
      className={cn("cursor-pointer hover:bg-hover", novo && "animate-xc-flash")}
    >
      <td className={cn(TD, "num whitespace-nowrap")}>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            ctx.onAbrir(e);
          }}
          aria-label={rotuloAbrir(e, hora)}
          className={cn("rounded-sm text-ink", FOCO)}
        >
          {hora}
        </button>
        {dia && (
          <span suppressHydrationWarning className="block text-label text-t2">
            {dia}
          </span>
        )}
      </td>
      {ctx.todas && <td className={cn(TD, "whitespace-nowrap")}>{ctx.nomeLoja(e.store_id)}</td>}
      <td className={cn(TD, "whitespace-nowrap", ehCompra(e) && "font-semibold")}>
        {nomeDoEvento(e.evento)}
      </td>
      <td className={cn(TD, "whitespace-nowrap text-t1")}>{FONTE_TELA[e.fonte]}</td>
      <td className={cn(TD, "whitespace-nowrap")}>
        <TagPlataforma plataforma={e.plataforma} />
        {e.destino_nome || "—"}
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>
        <Status e={e} />
      </td>
      <td className={cn(TD, "num whitespace-nowrap text-right text-t1")}>{formatarLatencia(e)}</td>
      <td className={cn(TD, "whitespace-nowrap text-t1")}>{textoClique(e)}</td>
      <td className={cn(TD, "min-w-48 py-2 text-t1 [overflow-wrap:anywhere]")}>{textoOrigem(e)}</td>
      <td className={cn(TD, "num whitespace-nowrap text-right")}>
        <Pedido e={e} ctx={ctx} />
      </td>
    </tr>
  );
});

const Cartao = memo(function Cartao({
  e,
  novo,
  ctx,
}: {
  e: EventoFeed;
  novo: boolean;
  ctx: ContextoLista;
}) {
  const hora = horaDoEvento(e.criado_em, ctx.fuso);
  const dia = rotuloDia(e.criado_em, ctx.hoje, ctx.fuso);
  return (
    <li className={cn("rounded-card border border-border", novo && "animate-xc-flash")}>
      <button
        type="button"
        onClick={() => ctx.onAbrir(e)}
        aria-label={rotuloAbrir(e, hora)}
        className={cn("flex w-full flex-col gap-2 rounded-card p-3 text-left", FOCO)}
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="text-body font-semibold text-ink">
              {nomeDoEvento(e.evento)} · {nomePlataforma(e.plataforma)}
            </span>
            <span suppressHydrationWarning className="num text-label text-t2">
              {ctx.todas ? `${ctx.nomeLoja(e.store_id)} · ` : ""}
              {hora}
              {dia ? ` · ${dia}` : ""}
            </span>
          </span>
          <Status e={e} />
        </span>
        <span className="text-label text-t1">
          {FONTE_TELA[e.fonte]} · {formatarLatencia(e)} · clique: {textoClique(e)}
        </span>
        {textoOrigem(e) !== "—" && (
          <span className="text-label text-t2 [overflow-wrap:anywhere]">{textoOrigem(e)}</span>
        )}
      </button>
    </li>
  );
});

const COLUNAS: { titulo: string; direita?: boolean; soTodas?: boolean }[] = [
  { titulo: "Hora" },
  { titulo: "Loja", soTodas: true },
  { titulo: "Evento" },
  { titulo: "Veio de" },
  { titulo: "Destino" },
  { titulo: "Status" },
  { titulo: "Latência", direita: true },
  { titulo: "Clique" },
  { titulo: "Origem" },
  { titulo: "Pedido", direita: true },
];

export function ListaEventos({
  linhas,
  novos,
  ctx,
}: {
  linhas: EventoFeed[];
  novos: ReadonlySet<string>;
  ctx: ContextoLista;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto border-t border-border md:block">
        <table className="w-full border-separate border-spacing-0 text-dense">
          <caption className="sr-only">
            Eventos de rastreamento, do mais novo para o mais antigo
          </caption>
          <thead>
            <tr>
              {COLUNAS.filter((c) => ctx.todas || !c.soTodas).map((c) => (
                <th
                  key={c.titulo}
                  scope="col"
                  className={cn(
                    "h-10 whitespace-nowrap border-b border-border bg-surface-2 px-2.5 text-label font-semibold text-t1",
                    c.direita ? "text-right" : "text-left"
                  )}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((e) => (
              <Linha key={e.id} e={e} novo={novos.has(e.id)} ctx={ctx} />
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 border-t border-border p-3 md:hidden">
        {linhas.map((e) => (
          <Cartao key={e.id} e={e} novo={novos.has(e.id)} ctx={ctx} />
        ))}
      </ul>
    </>
  );
}
