"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/components/ui/cn";
import { DetalheSuporte } from "./detalhe";
import {
  contar,
  emAndamento,
  inteiro,
  mensagemProgresso,
  porcentagem,
  resumoResultado,
  type ErroNaTela,
  type FaseExecucao,
} from "./regras";

export interface Falha {
  handle: string;
  titulo: string;
  motivo: string;
}

export interface Execucao {
  fase: FaseExecucao;
  atual: number;
  total: number;
  criados: number;
  pulados: number;
  falhas: number;
  listaFalhas: Falha[];
  erro: ErroNaTela | null;
  rota: "nao" | "criada" | "falhou";
  rotaErro: ErroNaTela | null;
  /** Ha fotos principais sendo refeitas em segundo plano. */
  fotosNaFila: boolean;
}

const LINK =
  "rounded-sm font-medium text-brand underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * O progresso enquanto roda e o resultado no fim -- um cartao so, no lugar
 * dos ate cinco toasts seguidos da tela antiga.
 */
export function PainelExecucao({
  execucao: e,
  destino,
  tituloRef,
  interromper,
  nova,
  voltar,
}: {
  execucao: Execucao;
  destino: { nome: string; dominio: string };
  tituloRef: React.Ref<HTMLHeadingElement>;
  interromper: () => void;
  nova: () => void;
  voltar: () => void;
}) {
  if (emAndamento(e.fase)) {
    const pct = porcentagem(e.atual, e.total);
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 ref={tituloRef} tabIndex={-1} className="text-section text-ink outline-none">
            Importando para {destino.nome}
          </h2>
          <StatusBadge {...STATUS.job.rodando} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="num text-dense text-t1" aria-live="polite">
              {mensagemProgresso(e.fase, e.atual, e.total)}
            </p>
            <span className="num text-dense font-semibold text-ink">{e.total > 0 ? `${pct}%` : "—"}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Progresso da importação"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={e.total > 0 ? pct : undefined}
            className="h-1.5 overflow-hidden rounded-full bg-track"
          >
            <div
              className={cn(
                "h-full rounded-full bg-solid transition-[width] duration-200 motion-reduce:transition-none",
                e.total === 0 && "animate-xc-pulse"
              )}
              style={{ width: e.total > 0 ? `${pct}%` : "8%" }}
            />
          </div>
        </div>
        <Contadores criados={e.criados} pulados={e.pulados} falhas={e.falhas} />
        <p className="text-label text-t2">
          Deixe esta aba aberta: a importação roda aqui no navegador e para se você sair.
        </p>
        <div>
          <ConfirmDialog
            gatilho={<Button variant="secondary">Interromper</Button>}
            titulo="Interromper a importação?"
            descricao="Os produtos criados até aqui continuam na loja. Os que faltam não serão importados."
            confirmar="Interromper"
            cancelar="Continuar importando"
            onConfirmar={interromper}
          />
        </div>
        <ListaFalhas falhas={e.listaFalhas} />
      </div>
    );
  }

  const r = resumoResultado({ fase: e.fase, criados: e.criados, pulados: e.pulados, falhas: e.falhas, loja: destino.nome });
  const proximos: React.ReactNode[] = [];
  if (e.fotosNaFila) {
    proximos.push("A foto principal de cada produto é refeita com IA nos próximos minutos. Pode sair desta tela.");
  }
  if (e.rota === "criada") {
    proximos.push(
      <>
        A rota foi criada. Para ela valer na vitrine, envie a configuração ao tema em{" "}
        <Link href="/clone/routed-checkout" className={LINK}>
          Roteamento
        </Link>
        .
      </>
    );
  }
  proximos.push(
    <>
      O histórico desta importação fica em{" "}
      <Link href="/activity" className={LINK}>
        Atividade
      </Link>
      .
    </>
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 ref={tituloRef} tabIndex={-1} className="text-section text-ink outline-none">
            {r.titulo}
          </h2>
          <StatusBadge tom={r.tom} texto={r.selo} />
        </div>
        <p className="text-dense text-t1">{r.frase}</p>
      </div>

      <Contadores criados={e.criados} pulados={e.pulados} falhas={e.falhas} />

      {e.fase === "erro" && e.erro ? (
        <Callout
          tom="err"
          titulo={e.erro.plano ? "A importação gratuita acabou" : "O que aconteceu"}
          acao={
            e.erro.plano ? (
              <Link href="/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Ver planos
              </Link>
            ) : undefined
          }
        >
          <p>{e.erro.texto}</p>
          <DetalheSuporte detalhe={e.erro.detalhe} />
        </Callout>
      ) : null}

      {e.rota === "falhou" ? (
        <Callout
          tom="err"
          titulo="A rota não foi gravada"
          acao={
            e.rotaErro?.plano ? (
              <Link href="/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Ver planos
              </Link>
            ) : (
              <Link href="/clone/routed-checkout" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Abrir Roteamento
              </Link>
            )
          }
        >
          <p>
            {e.rotaErro?.plano
              ? `Os produtos foram criados. ${e.rotaErro.texto}`
              : "Os produtos foram criados, mas a ligação com a vitrine falhou. Dá para criar a rota no Roteamento."}
          </p>
          <DetalheSuporte detalhe={e.rotaErro?.detalhe ?? null} />
        </Callout>
      ) : null}

      <section aria-labelledby="imp-proximos" className="flex flex-col gap-1.5">
        <h3 id="imp-proximos" className="text-dense font-semibold text-ink">
          Próximos passos
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-dense text-t1">
          {proximos.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </section>

      <ListaFalhas falhas={e.listaFalhas} />

      <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
        {e.criados > 0 ? (
          <a
            href={`https://${destino.dominio}/admin/products`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants()}
          >
            Abrir produtos na Shopify
            <ExternalLinkIcon aria-hidden />
            <span className="sr-only">(abre em outra aba)</span>
          </a>
        ) : null}
        <Button variant={e.criados > 0 ? "secondary" : "primary"} onClick={nova}>
          Nova importação
        </Button>
        {e.fase === "erro" || e.fase === "interrompida" ? (
          <Button variant="ghost" onClick={voltar}>
            Voltar à revisão
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Contadores({ criados, pulados, falhas }: { criados: number; pulados: number; falhas: number }) {
  const itens = [
    { rotulo: "Criados", valor: criados, cor: "text-ink" },
    { rotulo: "Já existiam", valor: pulados, cor: "text-ink" },
    { rotulo: "Falharam", valor: falhas, cor: falhas > 0 ? "text-err" : "text-ink" },
  ];
  return (
    <dl className="grid grid-cols-3 overflow-hidden rounded-card border border-border">
      {itens.map((it, i) => (
        <div key={it.rotulo} className={cn("flex flex-col gap-0.5 px-3 py-3 sm:px-4", i > 0 && "border-l border-border-subtle")}>
          <dt className="text-label text-t2">{it.rotulo}</dt>
          <dd className={cn("num text-section", it.cor)}>{inteiro(it.valor)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ListaFalhas({ falhas }: { falhas: Falha[] }) {
  if (falhas.length === 0) return null;
  return (
    <section aria-labelledby="imp-falhas" className="flex flex-col gap-2">
      <h3 id="imp-falhas" className="text-dense font-semibold text-ink">
        {contar(falhas.length, "produto não importado", "produtos não importados")}
      </h3>
      <ul className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-card border border-err-border">
        {falhas.map((f, i) => (
          <li key={`${f.handle}-${i}`} className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-dense font-medium text-ink">{f.titulo}</span>
            <span className="text-label break-words text-t1">{f.motivo}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
