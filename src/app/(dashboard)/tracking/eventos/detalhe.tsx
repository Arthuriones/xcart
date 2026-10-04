"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import type { EventoFeed } from "@/lib/financeiro/tipos";
import { rotuloFuso } from "@/components/layout/contexto";
import { buttonVariants } from "@/components/ui/button";
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
  ehTeste,
  explicarErro,
  formatarLatencia,
  nomeDoEvento,
  nomePlataforma,
} from "./logica";
import { SeloTeste } from "./lista";

// ============================================================================
// Detalhe de um evento (#25): so o que o feed ja traz. A resposta da
// plataforma e o reenvio dependem de backend novo e ficam fora da tela ate
// existirem. O payload bruto nunca aparece: traz o IP e o navegador do
// comprador.
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
          {ehTeste(e) && <SeloTeste />}
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
          >
            <p>{erro.resumo}</p>
            {erro.mensagem && (
              <p className="mt-1 text-label text-t1 [overflow-wrap:anywhere]">
                Mensagem registrada: {erro.mensagem}
              </p>
            )}
            {/* Embaixo do texto, e nao ao lado: no painel de 520 px o botao
                espremia a explicacao numa coluna estreita. */}
            {e.status === "falhou" && (
              <Link href="/tracking" className={buttonVariants({ size: "sm", className: "mt-2.5" })}>
                Consertar em Rastreamento
              </Link>
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
          {ehTeste(e) && (
            <Campo rotulo="Teste">Sim: fica fora das contagens do Rastreamento</Campo>
          )}
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

        <p className="text-label text-t2 text-pretty">
          O conteúdo bruto do evento não aparece aqui porque traz o IP e o navegador do comprador.
        </p>
      </SheetBody>
    </>
  );
}
