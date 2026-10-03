"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROTAS, type SyncResposta } from "@/lib/financeiro/tipos";
import type { Pendencia, TomPendencia } from "./lucro-dados";
import { useListaGuardada } from "./preferencia";

// ============================================================================
// Central de pendencias: o que deixa o numero do Lucro errado ou incompleto,
// agrupado por gravidade. Fechada, mostra so a mais grave; cada uma leva a
// tela que resolve. So o informativo pode ser dispensado (fica guardado neste
// navegador).
// ============================================================================

const CHAVE_DISPENSADAS = "xc_lucro_dispensadas";
const NENHUMA: readonly string[] = [];

const TOM: Record<
  TomPendencia,
  { sev: string; grupo: string; contagem: [string, string]; caixa: string; texto: string; Icone: typeof Info }
> = {
  err: {
    sev: "Crítico",
    grupo: "Críticas",
    contagem: ["crítica", "críticas"],
    caixa: "border-err-border bg-err-bg text-err",
    texto: "text-err",
    Icone: OctagonAlert,
  },
  warn: {
    sev: "Atenção",
    grupo: "Atenção",
    contagem: ["de atenção", "de atenção"],
    caixa: "border-warn-border bg-warn-bg text-warn",
    texto: "text-warn",
    Icone: TriangleAlert,
  },
  info: {
    sev: "Informação",
    grupo: "Informativas",
    contagem: ["informativa", "informativas"],
    caixa: "border-info-border bg-info-bg text-info",
    texto: "text-info",
    Icone: Info,
  },
};

/** Puxa pedidos e gasto do Meta agora, sem esperar o cron (o mesmo das rodadas). */
async function sincronizar(): Promise<{ falhou: boolean; linhas: string[] }> {
  const chamar = async (url: string): Promise<SyncResposta> => {
    const res = await fetch(url, { method: "POST" });
    let corpo: Partial<SyncResposta> & { erro?: string; error?: string } = {};
    try {
      corpo = await res.json();
    } catch {
      // corpo vazio ou HTML: o status diz o que houve.
    }
    if (!res.ok) throw new Error(corpo.erro || corpo.error || `erro ${res.status}`);
    return {
      ok: Boolean(corpo.ok),
      processadas: Number(corpo.processadas) || 0,
      puladas: Number(corpo.puladas) || 0,
      erros: Array.isArray(corpo.erros) ? corpo.erros : [],
    };
  };
  const [pedidos, meta] = await Promise.allSettled([chamar(ROTAS.apiSyncPedidos), chamar(ROTAS.apiSyncMeta)]);
  const linhas: string[] = [];
  let falhou = false;
  const descrever = (nome: string, rotulo: string, res: PromiseSettledResult<SyncResposta>) => {
    if (res.status === "rejected") {
      falhou = true;
      linhas.push(`${nome}: não atualizou (${res.reason instanceof Error ? res.reason.message : String(res.reason)})`);
      return;
    }
    const v = res.value;
    if (v.erros.length) falhou = true;
    linhas.push(
      `${nome}: ${v.processadas} ${rotulo}` +
        (v.erros.length ? ` · ${v.erros.length} com erro: ${v.erros.slice(0, 2).join("; ")}` : "")
    );
  };
  descrever("Pedidos", unidade(pedidos, "loja lida", "lojas lidas"), pedidos);
  descrever("Meta", unidade(meta, "conta lida", "contas lidas"), meta);
  return { falhou, linhas };
}

function unidade(res: PromiseSettledResult<SyncResposta>, um: string, varios: string): string {
  return res.status === "fulfilled" && res.value.processadas === 1 ? um : varios;
}

function Item({
  p,
  sincronizando,
  onSincronizar,
  onDispensar,
}: {
  p: Pendencia;
  sincronizando: boolean;
  onSincronizar: () => void;
  onDispensar: () => void;
}) {
  const t = TOM[p.tom];
  const acao = p.acao;
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-border-subtle px-4 py-3 last:border-b-0">
      <span aria-hidden className={clsx("grid size-7 shrink-0 place-items-center rounded-control border", t.caixa)}>
        <t.Icone className="size-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <p className="text-dense font-semibold text-ink">
          <span className={t.texto}>{t.sev}:</span> {p.titulo}
        </p>
        {p.detalhe && <p className="break-words text-dense text-t1 text-pretty">{p.detalhe}</p>}
      </div>
      {(acao || p.dispensavel) && (
        <div className="ml-10 flex shrink-0 items-center gap-1.5 sm:ml-0">
          {p.dispensavel && (
            <Button variant="ghost" size="sm" className="text-t2" onClick={onDispensar}>
              Dispensar
            </Button>
          )}
          {acao && "sincronizar" in acao ? (
            <Button variant="secondary" size="sm" pending={sincronizando} onClick={onSincronizar}>
              {sincronizando ? "Atualizando…" : acao.rotulo}
            </Button>
          ) : acao ? (
            acao.href.startsWith("#") ? (
              <a href={acao.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {acao.rotulo}
                <ChevronRight aria-hidden />
              </a>
            ) : (
              <Link href={acao.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {acao.rotulo}
                <ChevronRight aria-hidden />
              </Link>
            )
          ) : null}
        </div>
      )}
    </li>
  );
}

export function Pendencias({ itens }: { itens: Pendencia[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [, startTransition] = useTransition();
  const [dispensadas, gravarDispensadas] = useListaGuardada(CHAVE_DISPENSADAS, NENHUMA);

  const fora = new Set(dispensadas);
  const ativas = itens.filter((p) => !(p.dispensavel && fora.has(p.id)));
  const escondidas = itens.length - ativas.length;

  async function atualizarAgora() {
    if (sincronizando) return;
    setSincronizando(true);
    try {
      const { falhou, linhas } = await sincronizar();
      if (falhou) toast.warning("Atualização incompleta", { description: linhas.join("\n") });
      else toast.success("Números atualizados", { description: linhas.join("\n") });
    } finally {
      setSincronizando(false);
      startTransition(() => router.refresh());
    }
  }

  const mostrarDeNovo = (
    <button
      type="button"
      onClick={() => gravarDispensadas([])}
      className="rounded-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      Mostrar de novo
    </button>
  );
  const textoEscondidas = `${escondidas} ${escondidas === 1 ? "informativa dispensada" : "informativas dispensadas"}.`;

  if (ativas.length === 0) {
    return escondidas > 0 ? (
      <p className="text-label text-t2">
        {textoEscondidas} {mostrarDeNovo}
      </p>
    ) : null;
  }

  const contagens = (["err", "warn", "info"] as TomPendencia[])
    .map((tom) => ({ tom, n: ativas.filter((p) => p.tom === tom).length }))
    .filter((c) => c.n > 0);
  const visiveis = aberta ? ativas : ativas.slice(0, 1);

  return (
    <section aria-labelledby="pendencias-t" className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle py-2.5 pl-4 pr-3">
        <h2 id="pendencias-t" className="text-dense font-semibold text-ink">
          Pendências
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {contagens.map(({ tom, n }) => (
            <StatusBadge key={tom} tom={tom}>
              {n} {TOM[tom].contagem[n === 1 ? 0 : 1]}
            </StatusBadge>
          ))}
        </div>
        <span className="flex-1" />
        {ativas.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={aberta}
            aria-controls="pendencias-lista"
            onClick={() => setAberta((a) => !a)}
          >
            {aberta ? "Recolher" : `Ver todas (${ativas.length})`}
            <ChevronDown aria-hidden className={clsx("transition-transform", aberta && "rotate-180")} />
          </Button>
        )}
      </div>
      <ul id="pendencias-lista">
        {visiveis.map((p, i) => {
          const novoGrupo = aberta && (i === 0 || visiveis[i - 1].tom !== p.tom);
          return (
            <PendenciaComGrupo key={p.id} grupo={novoGrupo ? p.tom : null}>
              <Item
                p={p}
                sincronizando={sincronizando}
                onSincronizar={atualizarAgora}
                onDispensar={() => gravarDispensadas([...dispensadas, p.id])}
              />
            </PendenciaComGrupo>
          );
        })}
      </ul>
      {escondidas > 0 && (
        <p className="border-t border-border-subtle bg-surface-2 px-4 py-2 text-label text-t2">
          {textoEscondidas} {mostrarDeNovo}
        </p>
      )}
    </section>
  );
}

/** Cabecalho do grupo (so com a lista aberta) antes do primeiro item dele. */
function PendenciaComGrupo({ grupo, children }: { grupo: TomPendencia | null; children: ReactNode }) {
  if (!grupo) return children;
  return (
    <>
      <li aria-hidden className={clsx("px-4 pb-0.5 pt-2.5 text-label font-semibold", TOM[grupo].texto)}>
        {TOM[grupo].grupo}
      </li>
      {children}
    </>
  );
}
