"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import type { LojaDestino } from "@/lib/leitura/importar";
import { continuarFila, enfileirar, lerFila, type Resposta } from "./api";
import {
  atualizadoAs,
  corpoTentarDeNovo,
  detalheDoJob,
  emAndamento,
  estadoDoJob,
  linkCurto,
  linkNaShopify,
  origemDoJob,
  progressoDoJob,
  quandoEntrou,
  type JobImportacao,
} from "./regras";

// ============================================================================
// A fila de importacao por link: o que entrou, o que esta rodando, o que
// criou produto e o que falhou -- com "Tentar de novo" e o link para o
// produto na Shopify. Le a API que ja existe; anda sozinha enquanto houver
// link na fila e para quando nao ha mais nada para mudar.
//
// "Atualizar" so gira enquanto o PROPRIO pedido esta no ar e sempre volta:
// antes nascia girando e travado quando nenhuma loja estava escolhida.
// ============================================================================

type Estado = {
  /** Loja da leitura ("" = todas). Trocar de loja invalida o que havia. */
  chave: string;
  jobs: JobImportacao[] | null;
  lidoEm: number | null;
  erro: string | null;
};

export interface Fila {
  jobs: JobImportacao[];
  carregando: boolean;
  /** A primeira leitura falhou: nao ha lista para mostrar. */
  erro: string | null;
  /** Ja havia lista e a releitura falhou: a lista fica, com o aviso. */
  avisoAtualizar: string | null;
  lidoEm: number | null;
  atualizando: boolean;
  continuando: boolean;
  tentando: ReadonlySet<string>;
  recarregar: () => Promise<void>;
  continuar: (silencioso?: boolean) => Promise<void>;
  tentarDeNovo: (job: JobImportacao) => Promise<void>;
}

/** Leitura e acoes da fila de uma loja (lojaId vazio = todas as lojas). */
export function useFila(lojaId: string): Fila {
  const chave = lojaId;
  const [estado, setEstado] = React.useState<Estado | null>(null);
  const [atualizando, setAtualizando] = React.useState(false);
  const [continuando, setContinuando] = React.useState(false);
  const [tentando, setTentando] = React.useState<ReadonlySet<string>>(() => new Set());
  // So a resposta do pedido mais recente grava: trocar de loja rapido fazia a
  // lista da anterior chegar depois e cobrir a atual.
  const pedido = React.useRef(0);

  const aplicar = React.useCallback((k: string, r: Resposta<JobImportacao[]>) => {
    setEstado((antes) => {
      if (r.ok) return { chave: k, jobs: r.dados, lidoEm: Date.now(), erro: null };
      const base = antes && antes.chave === k ? antes : { chave: k, jobs: null, lidoEm: null, erro: null };
      return { ...base, erro: r.erro };
    });
  }, []);

  const ler = React.useCallback(
    (k: string) => {
      const meu = ++pedido.current;
      return lerFila(k).then((r) => {
        if (meu === pedido.current) aplicar(k, r);
      });
    },
    [aplicar]
  );

  // Primeira leitura e troca de loja: o estado so muda na volta da rede.
  React.useEffect(() => {
    void ler(chave);
  }, [chave, ler]);

  const atual = estado && estado.chave === chave ? estado : null;
  const jobs = React.useMemo(() => atual?.jobs ?? [], [atual]);
  const algumNaFila = jobs.some(emAndamento);
  const algumRodando = jobs.some((j) => j.status === "processing");

  // Anda sozinha enquanto houver o que mudar: a cada 3 s com link rodando, a
  // cada 15 s com link so esperando a vez. Aba escondida nao consulta.
  React.useEffect(() => {
    if (!algumNaFila) return;
    const id = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void ler(chave);
      },
      algumRodando ? 3000 : 15000
    );
    return () => window.clearInterval(id);
  }, [algumNaFila, algumRodando, chave, ler]);

  const recarregar = React.useCallback(async () => {
    setAtualizando(true);
    try {
      await ler(chave);
    } finally {
      setAtualizando(false);
    }
  }, [chave, ler]);

  const continuar = React.useCallback(
    async (silencioso = false) => {
      setContinuando(true);
      const r = await continuarFila(chave);
      setContinuando(false);
      if (!r.ok && !silencioso) {
        toast.error("Não deu para adiantar a fila agora.", {
          description: "Os links continuam na fila e saem na próxima rodada automática, de hora em hora.",
        });
      }
      await ler(chave);
    },
    [chave, ler]
  );

  const tentarDeNovo = React.useCallback(
    async (job: JobImportacao) => {
      const corpo = corpoTentarDeNovo(job);
      if (!corpo) {
        toast.error("Este link não ficou gravado. Cole de novo no formulário.");
        return;
      }
      setTentando((s) => new Set(s).add(job.id));
      const r = await enfileirar(corpo);
      setTentando((s) => {
        const n = new Set(s);
        n.delete(job.id);
        return n;
      });
      if (!r.ok) {
        toast.error("O link não voltou para a fila.", { description: r.erro });
        return;
      }
      toast.success("O link voltou para a fila.");
      await ler(chave);
    },
    [chave, ler]
  );

  return {
    jobs,
    carregando: !atual || (atual.jobs === null && atual.erro === null),
    erro: atual && atual.jobs === null ? atual.erro : null,
    avisoAtualizar: atual && atual.jobs !== null ? atual.erro : null,
    lidoEm: atual?.lidoEm ?? null,
    atualizando,
    continuando,
    tentando,
    recarregar,
    continuar,
    tentarDeNovo,
  };
}

const LINK_EXTERNO = cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-sm:h-ctl-lg");

/** A secao "Fila de importacao". `mostrarLoja`: na visao de todas as lojas. */
export function ListaFila({
  fila,
  lojas,
  mostrarLoja,
  descricao,
  vazio,
}: {
  fila: Fila;
  /** null = as lojas nao vieram: a linha fica sem o nome (nunca "Loja removida" por engano). */
  lojas: LojaDestino[] | null;
  mostrarLoja: boolean;
  /** O que esta fila mostra (vem antes do "Atualizado às"). */
  descricao: string;
  vazio: { titulo: string; descricao: string; acao?: React.ReactNode };
}) {
  const porId = React.useMemo(() => new Map((lojas ?? []).map((l) => [l.id, l])), [lojas]);
  const naFila = fila.jobs.filter((j) => j.status === "pending").length;

  const acoes = (
    <>
      {naFila > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          pending={fila.continuando}
          onClick={() => void fila.continuar()}
          className="max-sm:h-ctl-lg"
        >
          Adiantar a fila
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        pending={fila.atualizando}
        onClick={() => void fila.recarregar()}
        className="max-sm:h-ctl-lg"
      >
        {fila.atualizando ? null : <RefreshCwIcon aria-hidden />}
        Atualizar
      </Button>
    </>
  );

  const linhaDescricao = [descricao, fila.lidoEm ? atualizadoAs(fila.lidoEm) : null].filter(Boolean).join(" · ");

  return (
    <Section id="fila" titulo="Fila de importação" descricao={linhaDescricao} acoes={acoes} espaco="nenhum">
      {fila.avisoAtualizar ? (
        <p role="status" className="mx-4 rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-dense text-warn">
          Não deu para atualizar agora. A lista abaixo é a da última leitura.
        </p>
      ) : null}
      {naFila > 0 ? (
        <p className="px-4 text-label text-t2">
          {naFila === 1 ? "1 link esperando a vez." : `${naFila} links esperando a vez.`} A fila também roda
          sozinha, de hora em hora; “Adiantar a fila” começa os próximos 5 agora.
        </p>
      ) : null}

      {fila.carregando ? (
        <EsqueletoFila />
      ) : fila.erro ? (
        <EmptyState
          role="alert"
          variante="simples"
          titulo="Não deu para carregar a fila"
          descricao="As importações continuam rodando. Tente de novo em instantes."
          acao={
            <Button pending={fila.atualizando} onClick={() => void fila.recarregar()}>
              Tentar de novo
            </Button>
          }
          className="border-t border-border-subtle py-10"
        />
      ) : fila.jobs.length === 0 ? (
        <EmptyState
          variante="simples"
          titulo={vazio.titulo}
          descricao={vazio.descricao}
          acao={vazio.acao}
          className="border-t border-border-subtle py-10"
        />
      ) : (
        <ul aria-label="Importações" className="flex flex-col">
          {fila.jobs.map((job) => (
            <LinhaFila
              key={job.id}
              job={job}
              loja={porId.get(job.store_id) ?? null}
              mostrarLoja={mostrarLoja && lojas !== null}
              agoraMs={fila.lidoEm ?? 0}
              tentando={fila.tentando.has(job.id)}
              onTentar={() => void fila.tentarDeNovo(job)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function LinhaFila({
  job,
  loja,
  mostrarLoja,
  agoraMs,
  tentando,
  onTentar,
}: {
  job: JobImportacao;
  loja: LojaDestino | null;
  mostrarLoja: boolean;
  agoraMs: number;
  tentando: boolean;
  onTentar: () => void;
}) {
  const estado = estadoDoJob(job.status);
  const prog = progressoDoJob(job);
  const origem = origemDoJob(job);
  const shopify = linkNaShopify(loja?.dominio, job);
  const meta = [
    mostrarLoja ? (loja?.nome ?? "Loja removida") : null,
    origem,
    agoraMs ? quandoEntrou(job.created_at, agoraMs) : null,
  ].filter(Boolean);
  const pct = prog ? Math.round((prog.atual / prog.total) * 100) : 0;

  return (
    <li className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge {...STATUS.job[estado]} />
          <p className="min-w-0 truncate font-mono text-dense text-ink">{linkCurto(job.progress?.source)}</p>
        </div>
        <p className={cn("text-dense text-pretty", estado === "falhou" ? "text-err" : "text-t1")}>
          {detalheDoJob(job)}
        </p>
        {prog ? (
          <span
            role="progressbar"
            aria-label="Produtos publicados deste link"
            aria-valuemin={0}
            aria-valuemax={prog.total}
            aria-valuenow={prog.atual}
            className="mt-0.5 block h-1 w-full max-w-80 overflow-hidden rounded-full bg-track"
          >
            <span className="block h-full rounded-full bg-run" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
        {meta.length ? <p className="text-label text-t2">{meta.join(" · ")}</p> : null}
        {estado === "falhou" && job.error ? (
          <details className="text-label text-t2">
            <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              Detalhes para o suporte
            </summary>
            <p className="mt-1 break-words font-mono">{job.error}</p>
          </details>
        ) : null}
      </div>
      {shopify || estado === "falhou" ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {shopify ? (
            <a href={shopify} target="_blank" rel="noopener noreferrer" className={LINK_EXTERNO}>
              <ExternalLinkIcon aria-hidden />
              Ver na Shopify
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          ) : null}
          {estado === "falhou" ? (
            <Button variant="secondary" size="sm" pending={tentando} onClick={onTentar} className="max-sm:h-ctl-lg">
              Tentar de novo
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Carregando: tres linhas com a geometria da lista. */
export function EsqueletoFila() {
  return (
    <div aria-busy="true" aria-label="Carregando a fila" className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5.5 w-20 rounded-full" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** Link interno para o estado vazio (um CTA so). */
export function LinkVazio({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonVariants({ variant: "secondary" })}>
      {children}
    </Link>
  );
}
