"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import type { EventoFeed } from "@/lib/financeiro/tipos";
import { rotuloFuso } from "@/components/layout/contexto";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  FONTE_TELA,
  STATUS_TELA,
  dataHoraCompleta,
  decodificarUtm,
  detalheClique,
  explicarErro,
  formatarLatencia,
  nomeDoEvento,
  nomePlataforma,
} from "./logica";

// ============================================================================
// Detalhe de um evento (#25): so o que o feed ja traz. A resposta da
// plataforma e o reenvio dependem de backend novo e aparecem como "Em breve".
// O payload bruto nunca aparece: traz o IP e o navegador do comprador.
// ============================================================================

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-t2">{rotulo}</dt>
      <dd className="num min-w-0 text-ink [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

export function DetalheEvento({
  evento,
  aberto,
  aoMudar,
  fuso,
  nomeLoja,
  nomePedido,
  urlPedido,
}: {
  evento: EventoFeed | null;
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  fuso: string;
  nomeLoja: (storeId: string) => string;
  nomePedido: (e: EventoFeed) => string | null;
  urlPedido: (e: EventoFeed) => string | null;
}) {
  return (
    <Sheet open={aberto && !!evento} onOpenChange={aoMudar}>
      <SheetContent side="right" size="md">
        {evento && <Conteudo e={evento} fuso={fuso} nomeLoja={nomeLoja} nomePedido={nomePedido} urlPedido={urlPedido} />}
      </SheetContent>
    </Sheet>
  );
}

function Conteudo({
  e,
  fuso,
  nomeLoja,
  nomePedido,
  urlPedido,
}: {
  e: EventoFeed;
  fuso: string;
  nomeLoja: (storeId: string) => string;
  nomePedido: (e: EventoFeed) => string | null;
  urlPedido: (e: EventoFeed) => string | null;
}) {
  const s = STATUS_TELA[e.status];
  const plataforma = nomePlataforma(e.plataforma);
  const erro = explicarErro(e);
  const nome = nomePedido(e);
  const url = urlPedido(e);

  return (
    <>
      <SheetHeader className="gap-1.5 pl-5">
        <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>
        <SheetTitle>
          {nomeDoEvento(e.evento)} para {plataforma}
        </SheetTitle>
        <SheetDescription>
          {nomeLoja(e.store_id)} · {dataHoraCompleta(e.criado_em, fuso)} ({rotuloFuso(fuso)})
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-5 px-5 pb-6">
        {erro && (
          <Callout
            tom={e.status === "falhou" ? "err" : "warn"}
            titulo={e.status === "falhou" ? "O que deu errado" : "Ainda tentando"}
            acao={
              e.status === "falhou" ? (
                <Link href="/tracking" className={buttonVariants({ size: "sm" })}>
                  Consertar em Saúde dos pixels
                </Link>
              ) : undefined
            }
          >
            <p>{erro.resumo}</p>
            {erro.mensagem && (
              <p className="mt-1 text-label text-t1 [overflow-wrap:anywhere]">
                Mensagem registrada: {erro.mensagem}
              </p>
            )}
          </Callout>
        )}

        <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-dense">
          <Campo rotulo="Loja">{nomeLoja(e.store_id)}</Campo>
          <Campo rotulo="Evento">{nomeDoEvento(e.evento)}</Campo>
          <Campo rotulo="Veio de">{FONTE_TELA[e.fonte]}</Campo>
          <Campo rotulo="Destino">
            {plataforma} · {e.destino_nome || "sem nome"}
          </Campo>
          <Campo rotulo="Tentativas">
            {e.tentativas > 0 ? String(e.tentativas) : "Nenhuma ainda"}
          </Campo>
          <Campo rotulo="Enviado em">
            {e.enviado_em ? dataHoraCompleta(e.enviado_em, fuso) : "—"}
          </Campo>
          <Campo rotulo="Latência">{formatarLatencia(e)}</Campo>
          <Campo rotulo="Clique do anúncio">{detalheClique(e)}</Campo>
          <Campo rotulo="Origem">{e.origem_host || "—"}</Campo>
          <Campo rotulo="Fonte (UTM)">{decodificarUtm(e.utm_source) ?? "—"}</Campo>
          <Campo rotulo="Campanha (UTM)">{decodificarUtm(e.utm_campaign) ?? "—"}</Campo>
          <Campo rotulo="Pedido">
            {!e.pedido ? (
              "—"
            ) : url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {nome ? `${nome} no admin da Shopify` : "Abrir no admin da Shopify"}
                <ExternalLinkIcon aria-hidden className="size-3" strokeWidth={2} />
                <span className="sr-only">(abre em nova aba)</span>
              </a>
            ) : (
              (nome ?? "—")
            )}
          </Campo>
        </dl>

        <div className="flex flex-col gap-2 rounded-card border border-dashed border-border-strong p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-dense font-semibold text-ink">Resposta da plataforma e reenvio</p>
            <span className="rounded-sm border border-border px-1 text-label text-t2">Em breve</span>
          </div>
          <p className="text-label text-t1">
            Vai mostrar o que o Meta ou o Google respondeu e permitir reenviar este evento.
          </p>
          <Button variant="secondary" size="sm" disabled className="self-start">
            Reenviar evento
          </Button>
        </div>

        <p className="text-label text-t2 text-pretty">
          O conteúdo bruto do evento não aparece aqui porque traz o IP e o navegador do comprador.
        </p>
      </SheetBody>
    </>
  );
}
