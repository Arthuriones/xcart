"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Info, OctagonAlert, RefreshCw, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { ROTAS, type SyncResposta } from "@/lib/financeiro/tipos";
import { montarFaixa, type Pendencia, type TomPendencia } from "./lucro-dados";
import { useListaGuardada } from "./preferencia";

// ============================================================================
// Faixa de pendencias: o que deixa o numero do Lucro errado ou incompleto,
// numa linha so no topo (a mais grave; o aviso de custo so cede a uma
// critica), com o botao dela e "Ver pendencias (N)" para o resto. Cada uma
// leva a tela que resolve. O que pode ser de proposito (loja que vende sem
// anunciar) pode ser dispensado: fica guardado neste navegador.
// ============================================================================

const CHAVE_DISPENSADAS = "xc_lucro_dispensadas";
const NENHUMA: readonly string[] = [];

const TOM: Record<
  TomPendencia,
  {
    sev: string;
    grupo: string;
    caixa: string;
    texto: string;
    faixa: string;
    botao: string;
    Icone: typeof Info;
  }
> = {
  err: {
    sev: "Crítico",
    grupo: "Críticas",
    caixa: "border-err-border bg-err-bg text-err",
    texto: "text-err",
    faixa: "border-err-border bg-err-bg",
    botao: "border-err-border hover:border-err",
    Icone: OctagonAlert,
  },
  warn: {
    sev: "Atenção",
    grupo: "Atenção",
    caixa: "border-warn-border bg-warn-bg text-warn",
    texto: "text-warn",
    faixa: "border-warn-border bg-warn-bg",
    botao: "border-warn-border hover:border-warn",
    Icone: TriangleAlert,
  },
  info: {
    sev: "Informação",
    grupo: "Informativas",
    caixa: "border-info-border bg-info-bg text-info",
    texto: "text-info",
    faixa: "border-info-border bg-info-bg",
    botao: "border-info-border hover:border-info",
    Icone: Info,
  },
};

/** Puxa pedidos e gasto do Meta agora, sem esperar o cron (o mesmo das rodadas). */
async function sincronizar(): Promise<{ falhou: boolean; linhas: string[] }> {
  const chamar = async (url: string): Promise<SyncResposta> => {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST" });
    } catch {
      throw new Error("sem conexão com o servidor");
    }
    let corpo: Partial<SyncResposta> & { erro?: string; error?: string } = {};
    try {
      corpo = await res.json();
    } catch {
      // corpo vazio ou HTML: o status diz o que houve.
    }
    // Pelo status, sem repassar `error` cru ("Unauthorized"): a toast e do lojista.
    // Sessao vencida tambem pode voltar como redirecionamento para /login.
    if (res.status === 401 || res.redirected) throw new Error("sua sessão expirou; entre de novo");
    if (!res.ok) throw new Error(corpo.erro || `o servidor respondeu com erro ${res.status}`);
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
    // A rota pula o que leu ha menos de um minuto (ou esta lendo): nao e "0 lidas".
    if (v.processadas === 0 && v.puladas > 0 && !v.erros.length) {
      linhas.push(`${nome}: lido há menos de um minuto; tente de novo daqui a pouco`);
      return;
    }
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

/** Sincroniza, avisa o resultado e rele a tela no servidor. */
function usePuxarAgora() {
  const router = useRouter();
  const [puxando, setPuxando] = useState(false);
  const [, startTransition] = useTransition();

  async function puxar() {
    if (puxando) return;
    setPuxando(true);
    try {
      const { falhou, linhas } = await sincronizar();
      if (falhou) toast.warning("Atualização incompleta", { description: linhas.join("\n") });
      else toast.success("Números atualizados", { description: linhas.join("\n") });
    } finally {
      setPuxando(false);
      startTransition(() => router.refresh());
    }
  }

  return { puxando, puxar };
}

const PuxarContexto = createContext<ReturnType<typeof usePuxarAgora> | null>(null);

/**
 * Um estado so para o "Atualizar agora" da faixa e o "Puxar agora" da
 * leitura: com um lendo, o outro fica ocupado (senao saiam dois POST em
 * paralelo, e o segundo dizia "lido ha menos de um minuto" no meio do primeiro).
 */
export function PuxarAgoraProvider({ children }: { children: ReactNode }) {
  const valor = usePuxarAgora();
  return <PuxarContexto.Provider value={valor}>{children}</PuxarContexto.Provider>;
}

function usePuxar() {
  const c = useContext(PuxarContexto);
  if (!c) throw new Error("usePuxar fora do PuxarAgoraProvider");
  return c;
}

/**
 * "Pedidos e gasto lidos há 12 min" e o "Puxar agora": o cron le a cada 15
 * minutos, e o "Atualizar" do topo so rele o banco.
 */
export function LeituraDoLucro({
  rotulo,
  iso,
  hora,
}: {
  /** null = nada lido ainda (fica so o botao). */
  rotulo: string | null;
  iso: string | null;
  /** A hora da leitura, no fuso do relatorio (dica ao passar o mouse). */
  hora: string | null;
}) {
  const { puxando, puxar } = usePuxar();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p aria-live="polite" className="min-w-0 text-label text-t2">
        {puxando ? (
          "Puxando pedidos e gasto…"
        ) : rotulo && iso ? (
          <time dateTime={iso} title={hora ?? undefined}>
            {rotulo}
          </time>
        ) : null}
      </p>
      <Button variant="ghost" size="sm" pending={puxando} onClick={puxar} className="text-t2">
        {!puxando && <RefreshCw aria-hidden />}
        Puxar agora
      </Button>
    </div>
  );
}

/** "Título." -- a linha junta titulo e detalhe numa frase so. */
function comPonto(t: string): string {
  return /[.!?…]$/.test(t) ? t : `${t}.`;
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
          {/* O icone ja diz a gravidade; o leitor de tela ouve a palavra. */}
          <span className="sr-only">{t.sev}: </span>
          {p.titulo}
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

/**
 * A linha do topo. `custo` e o aviso de custo (o AvisoCusto de antes): ele e
 * a linha, a menos que haja pendencia critica (montarFaixa).
 */
export function FaixaPendencias({ custo, itens }: { custo: Pendencia | null; itens: Pendencia[] }) {
  const [aberta, setAberta] = useState(false);
  const { puxando, puxar } = usePuxar();
  const [dispensadas, gravarDispensadas] = useListaGuardada(CHAVE_DISPENSADAS, NENHUMA);
  const { linha, resto, total, escondidas } = montarFaixa(itens, dispensadas, custo);

  const dispensar = (id: string) => gravarDispensadas([...dispensadas, id]);
  const mostrarDeNovo = (
    <button
      type="button"
      onClick={() => gravarDispensadas([])}
      className="rounded-sm text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      Mostrar de novo
    </button>
  );
  const textoEscondidas = `${escondidas} ${escondidas === 1 ? "aviso dispensado" : "avisos dispensados"}.`;

  if (!linha) {
    return escondidas > 0 ? (
      <p className="text-label text-t2">
        {textoEscondidas} {mostrarDeNovo}
      </p>
    ) : null;
  }

  const t = TOM[linha.tom];
  const acao = linha.acao;
  const classeBotao = clsx(
    "inline-flex h-ctl-sm items-center rounded-control border bg-surface px-2.5 text-dense font-medium whitespace-nowrap text-ink no-underline hover:text-ink hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60",
    t.botao
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        role="status"
        className={clsx(
          "flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-card border py-2.5 pr-3 pl-3.5",
          t.faixa
        )}
      >
        <t.Icone aria-hidden className={clsx("size-4 shrink-0", t.texto)} strokeWidth={1.75} />
        <p className="min-w-55 flex-1 text-dense text-ink text-pretty">
          <span className="sr-only">{t.sev}: </span>
          <strong className="font-semibold">{comPonto(linha.titulo)}</strong>
          {linha.detalhe ? ` ${linha.detalhe}` : null}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {resto.length > 0 && (
            <button
              type="button"
              aria-expanded={aberta}
              aria-controls="pendencias-lista"
              onClick={() => setAberta((a) => !a)}
              className="inline-flex items-center gap-1 rounded-sm text-label font-medium whitespace-nowrap text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {aberta ? "Esconder pendências" : `Ver pendências (${total})`}
              <ChevronDown aria-hidden className={clsx("size-3.5 transition-transform", aberta && "rotate-180")} />
            </button>
          )}
          {linha.dispensavel && (
            <Button variant="ghost" size="sm" className="text-t2" onClick={() => dispensar(linha.id)}>
              Dispensar
            </Button>
          )}
          {acao && "sincronizar" in acao ? (
            <button type="button" onClick={puxar} disabled={puxando} aria-busy={puxando} className={classeBotao}>
              {puxando ? "Atualizando…" : acao.rotulo}
            </button>
          ) : acao ? (
            <Link href={acao.href} className={classeBotao}>
              {acao.rotulo}
            </Link>
          ) : null}
        </div>
      </div>

      {aberta && resto.length > 0 && (
        <div id="pendencias-lista" className="overflow-hidden rounded-card border border-border bg-surface">
          <ul>
            {resto.map((p, i) => (
              <PendenciaComGrupo key={p.id} grupo={i === 0 || resto[i - 1].tom !== p.tom ? p.tom : null}>
                <Item p={p} sincronizando={puxando} onSincronizar={puxar} onDispensar={() => dispensar(p.id)} />
              </PendenciaComGrupo>
            ))}
          </ul>
          {escondidas > 0 && (
            <p className="border-t border-border-subtle bg-surface-2 px-4 py-2 text-label text-t2">
              {textoEscondidas} {mostrarDeNovo}
            </p>
          )}
        </div>
      )}
      {escondidas > 0 && resto.length === 0 && (
        <p className="text-label text-t2">
          {textoEscondidas} {mostrarDeNovo}
        </p>
      )}
    </div>
  );
}

/** Cabecalho do grupo antes do primeiro item dele. */
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
