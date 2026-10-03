"use client";

import { useEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, ChevronDown, OctagonAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { clsx } from "clsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gravarCookie } from "@/components/layout/contexto";
import { contextoDaRota } from "@/components/layout/navegacao";
import { COOKIE_LOJA, ROTAS, TODAS, diaNoFuso, type SeveridadeAlerta } from "@/lib/financeiro/tipos";
import {
  INTERVALO_VERIFICACAO_MIN,
  abaDe,
  ateQuando,
  dataHoraCurta,
  duracaoTexto,
  erroDeSilenciar,
  horaCurta,
  separarAbertos,
  textoAvisos,
  ultimaConfirmacao,
  type Aba,
  type Destino,
} from "./apresentar";
import { ErroAlertas } from "./erro-alertas";

// ============================================================================
// A parte interativa de /alertas: as abas (na URL, ?aba=) e a lista de
// abertos com Resolver e Silenciar. Resolvidos, regras e canal chegam prontos
// do servidor, como slots.
//
// Silenciar usa a rota que ja existe (PATCH /api/alertas/[id]). Ela aceita
// 0 h, que tira o silencio: o "Desfazer" do toast manda 0 h pela mesma rota.
// Os dois envios de um alerta vao em fila, para o 0 h nunca chegar antes
// do 24 h.
// ============================================================================

const HORA = 3_600_000;
const EVENTO_ABA = "xc:alertas-aba";

/** O relogio, lido so dentro de handler (silenciar, voltar a avisar), nunca no render. */
function instanteAgora(): number {
  return Date.now();
}

export interface AlertaNaTela {
  id: string;
  severidade: SeveridadeAlerta;
  regraRotulo: string;
  titulo: string;
  detalhe: string | null;
  loja: string;
  /** store_id quando a loja e do usuario (para filtrar a tela de destino). */
  lojaId: string | null;
  aberto_em: string;
  confirmado_em: string;
  silenciado_ate: string | null;
  n_notificacoes: number;
  destino: Destino;
}

/** Troca de aba sem ida ao servidor: o ?aba= fica na URL para voltar e compartilhar. */
function irParaAba(aba: Aba) {
  const url = new URL(window.location.href);
  if (aba === "abertos") url.searchParams.delete("aba");
  else url.searchParams.set("aba", aba);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** Abre a aba do Telegram e leva o foco ate ela (de qualquer ponto da tela). */
function abrirCanais() {
  irParaAba("canal");
  window.dispatchEvent(new Event(EVENTO_ABA));
}

/** Botao do cabecalho: o PageHeader e do servidor, entao o clique mora aqui. */
export function BotaoCanais() {
  return (
    <Button variant="secondary" onClick={abrirCanais}>
      Canais de aviso
    </Button>
  );
}

function Contador({ n, tom }: { n: number; tom: "err" | "warn" | "neutral" }) {
  return (
    <span
      className={clsx(
        "num rounded-full px-1.5 text-label leading-4.5",
        tom === "err" && "bg-err-bg text-err",
        tom === "warn" && "bg-warn-bg text-warn",
        tom === "neutral" && "bg-track text-t1"
      )}
    >
      {n}
    </span>
  );
}

async function enviarSilencio(id: string, horas: number): Promise<string | null> {
  let r: Response;
  try {
    r = await fetch(`${ROTAS.apiAlertas}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ silenciar_horas: horas }),
    });
  } catch {
    throw new Error(erroDeSilenciar(0));
  }
  const j = (await r.json().catch(() => null)) as {
    ok?: boolean;
    erro?: string;
    silenciado_ate?: string | null;
  } | null;
  if (!r.ok || !j?.ok) throw new Error(erroDeSilenciar(r.status, j?.erro));
  return j.silenciado_ate ?? null;
}

export function TelaAlertas({
  abertos,
  erroAbertos,
  agora: agoraServidor,
  fuso,
  lojaAtual,
  telegramPronto,
  nResolvidos,
  resolvidos,
  regras,
  canal,
}: {
  abertos: AlertaNaTela[];
  /** A lista de abertos nao veio: a aba mostra o erro; as outras seguem. */
  erroAbertos: string | null;
  agora: number;
  fuso: string;
  lojaAtual: string;
  telegramPronto: boolean;
  /** null = a leitura dos resolvidos falhou. */
  nResolvidos: number | null;
  resolvidos: ReactNode;
  regras: ReactNode;
  canal: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const aba = abaDe(params.get("aba"));
  const [, iniciar] = useTransition();
  // "Agora" anda com as acoes do lojista e com cada refresh do servidor.
  const [agoraLocal, setAgora] = useState(agoraServidor);
  const agora = Math.max(agoraLocal, agoraServidor);
  // O que o lojista fez nesta tela: id -> silenciado_ate (null = avisando).
  const [silencio, setSilencio] = useState<Record<string, string | null>>({});
  const fila = useRef(new Map<string, Promise<unknown>>());
  const listaRef = useRef<HTMLDivElement>(null);
  const abasRef = useRef<HTMLDivElement>(null);

  // "Canais de aviso": a URL ja mudou (e a aba com ela); aqui so o foco.
  useEffect(() => {
    const focar = () =>
      setTimeout(() => {
        const alvo = abasRef.current?.querySelector<HTMLElement>('[data-aba="canal"]');
        alvo?.scrollIntoView({ block: "nearest" });
        alvo?.focus();
      }, 0);
    window.addEventListener(EVENTO_ABA, focar);
    return () => window.removeEventListener(EVENTO_ABA, focar);
  }, []);

  const { ativos, silenciados } = separarAbertos(abertos, silencio, agora);
  const temCritico = ativos.some((a) => a.severidade === "critico");
  const confirmado = ultimaConfirmacao(abertos);
  const filtrandoLoja = lojaAtual !== TODAS;

  function enfileirar(id: string, tarefa: () => Promise<void>): Promise<void> {
    const anterior = fila.current.get(id) ?? Promise.resolve();
    const proxima = anterior.catch(() => undefined).then(tarefa);
    fila.current.set(id, proxima);
    return proxima;
  }

  /** O cartao some da lista: o foco vai para a lista, nao para o <body>. */
  function focarLista() {
    setTimeout(() => {
      if (document.activeElement === document.body || !document.activeElement) {
        listaRef.current?.focus();
      }
    }, 0);
  }

  function silenciar(a: AlertaNaTela) {
    const instante = instanteAgora();
    const ate = new Date(instante + 24 * HORA).toISOString();
    const idToast = `silenciar-${a.id}`;
    setAgora(instante);
    setSilencio((s) => ({ ...s, [a.id]: ate }));
    focarLista();
    toast("Alerta silenciado", {
      id: idToast,
      description: `${a.titulo}\nPor 24 horas, sem aviso no Telegram.`,
      duration: 7000,
      action: { label: "Desfazer", onClick: () => voltarAAvisar(a, ate, true) },
    });
    enfileirar(a.id, async () => {
      const doServidor = await enviarSilencio(a.id, 24);
      setSilencio((s) => (s[a.id] === ate ? { ...s, [a.id]: doServidor ?? ate } : s));
      iniciar(() => router.refresh());
    }).catch((e: unknown) => {
      setSilencio((s) => {
        if (s[a.id] !== ate) return s;
        const resto = { ...s };
        delete resto[a.id];
        return resto;
      });
      toast.error("Não deu para silenciar", {
        id: idToast,
        action: undefined,
        duration: 7000,
        description: e instanceof Error ? e.message : String(e),
      });
    });
  }

  function voltarAAvisar(a: AlertaNaTela, ateAntes: string, desfazer: boolean) {
    const idToast = `silenciar-${a.id}`;
    setAgora(instanteAgora());
    setSilencio((s) => ({ ...s, [a.id]: null }));
    if (!desfazer) focarLista();
    enfileirar(a.id, async () => {
      await enviarSilencio(a.id, 0);
      toast.success(desfazer ? "Silêncio desfeito" : "Aviso de volta", {
        id: idToast,
        action: undefined,
        duration: 4000,
        description: `${a.titulo}\nO Telegram volta a avisar este alerta.`,
      });
      iniciar(() => router.refresh());
    })
      .catch((e: unknown) => {
        setSilencio((s) => (s[a.id] === null ? { ...s, [a.id]: ateAntes } : s));
        toast.error("Não deu para voltar a avisar", {
          id: idToast,
          action: undefined,
          duration: 7000,
          description: e instanceof Error ? e.message : String(e),
        });
      });
  }

  /**
   * Resolver: se a tela de destino filtra por loja, ela ja abre na loja do
   * alerta. O cookie da barra muda antes, e o refresh depois da navegacao
   * acerta o topo (o layout nao rerenderiza sozinho na navegacao).
   */
  function aoResolver(e: MouseEvent<HTMLAnchorElement>, a: AlertaNaTela) {
    if (!a.lojaId || a.lojaId === lojaAtual) return;
    if (contextoDaRota(a.destino.href).tipo === "nenhum") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    gravarCookie(COOKIE_LOJA, a.lojaId);
    iniciar(() => {
      router.push(a.destino.href);
      router.refresh();
    });
  }

  // Mesmo dia: so a hora. Outro dia: data e hora.
  const confirmadoTexto = confirmado
    ? diaNoFuso(new Date(confirmado), fuso) === diaNoFuso(new Date(agora), fuso)
      ? `às ${horaCurta(confirmado, fuso)}`
      : `em ${dataHoraCurta(confirmado, fuso)}`
    : null;

  return (
    <Tabs
      value={aba}
      onValueChange={(v) => irParaAba(abaDe(v))}
      className="gap-6"
    >
      <div ref={abasRef} className="min-w-0">
        <TabsList
          variant="line"
          aria-label="Alertas"
          className="w-full flex-nowrap justify-start overflow-x-auto [scrollbar-width:none]"
        >
          <TabsTrigger value="abertos" data-aba="abertos">
            Abertos{" "}
            {!erroAbertos && ativos.length > 0 && <Contador n={ativos.length} tom={temCritico ? "err" : "warn"} />}
          </TabsTrigger>
          <TabsTrigger value="resolvidos" data-aba="resolvidos">
            Resolvidos em 7 dias{" "}
            {nResolvidos ? <Contador n={nResolvidos} tom="neutral" /> : null}
          </TabsTrigger>
          <TabsTrigger value="regras" data-aba="regras">
            Regras
          </TabsTrigger>
          <TabsTrigger value="canal" data-aba="canal">
            Canais de aviso
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="abertos" className="flex flex-col gap-6">
        {erroAbertos ? (
          <ErroAlertas detalhe={erroAbertos} />
        ) : (
          <>
            <div ref={listaRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
              {ativos.length > 0 && confirmadoTexto && (
                <p className="text-label text-t2">
                  Última confirmação {confirmadoTexto} · o xcart confere a cada{" "}
                  {INTERVALO_VERIFICACAO_MIN} minutos.
                </p>
              )}

              {ativos.length === 0 ? (
                <EmptyState
                  icone={
                    <span className="grid size-9 place-items-center rounded-full border border-ok-border bg-ok-bg text-ok">
                      <Check className="size-4.5" strokeWidth={2.25} />
                    </span>
                  }
                  titulo={
                    silenciados.length > 0
                      ? "Nenhum alerta avisando agora"
                      : filtrandoLoja
                        ? "Nada quebrado nesta loja agora"
                        : "Nada quebrado agora"
                  }
                  descricao={
                    silenciados.length > 0
                      ? "Os alertas silenciados continuam abertos e aparecem logo abaixo."
                      : `O xcart confere vendas, rastreamento e gasto a cada ${INTERVALO_VERIFICACAO_MIN} minutos. ${
                          telegramPronto
                            ? "Se algo parar, você recebe no Telegram."
                            : "Ligue o Telegram para receber o aviso quando algo parar."
                        }`
                  }
                  acao={
                    !telegramPronto && silenciados.length === 0 ? (
                      <Button variant="secondary" onClick={abrirCanais}>
                        Configurar o Telegram
                      </Button>
                    ) : undefined
                  }
                  className="py-10"
                />
              ) : (
                <ul className="flex flex-col gap-3" aria-label="Alertas abertos">
                  {ativos.map((a) => (
                    <CartaoAlerta
                      key={a.id}
                      alerta={a}
                      agora={agora}
                      onSilenciar={() => silenciar(a)}
                      onResolver={(e) => aoResolver(e, a)}
                    />
                  ))}
                </ul>
              )}
            </div>

            {silenciados.length > 0 && (
              <section aria-labelledby="alertas-silenciados" className="flex flex-col gap-2">
                <h2 id="alertas-silenciados" className="text-dense font-semibold text-t1">
                  Silenciados
                </h2>
                <ul className="flex flex-col gap-2">
                  {silenciados.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface-2 px-4 py-3"
                    >
                      <p className="min-w-50 flex-1 text-dense">
                        <span className="font-semibold text-ink">{s.titulo}</span>{" "}
                        <span className="text-t2">
                          · {s.loja} · sem aviso no Telegram até {ateQuando(s.ate, agora, fuso)}
                        </span>
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => voltarAAvisar(s, s.ate, false)}
                        className="h-ctl-lg w-full sm:h-ctl-sm sm:w-auto"
                      >
                        Voltar a avisar
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </TabsContent>

      <TabsContent value="resolvidos">{resolvidos}</TabsContent>
      <TabsContent value="regras" keepMounted>
        {regras}
      </TabsContent>
      <TabsContent value="canal" keepMounted>
        {canal}
      </TabsContent>
    </Tabs>
  );
}

const OPCOES_SILENCIO: { rotulo: string; horas: number | null }[] = [
  { rotulo: "Por 1 hora", horas: null },
  { rotulo: "Até amanhã de manhã", horas: null },
  { rotulo: "Por 24 horas", horas: 24 },
  { rotulo: "Até resolver", horas: null },
];

function CartaoAlerta({
  alerta: a,
  agora,
  onSilenciar,
  onResolver,
}: {
  alerta: AlertaNaTela;
  agora: number;
  onSilenciar: () => void;
  onResolver: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const critico = a.severidade === "critico";
  const Icone = critico ? OctagonAlert : TriangleAlert;
  const aberto = Date.parse(a.aberto_em);
  const ha = Number.isFinite(aberto) ? duracaoTexto(agora - aberto) : null;

  return (
    <li className="flex flex-wrap items-start gap-4 rounded-card border border-border bg-surface p-4">
      <span
        aria-hidden
        className={clsx(
          "grid size-8 shrink-0 place-items-center rounded-control border",
          critico ? "border-err-border bg-err-bg text-err" : "border-warn-border bg-warn-bg text-warn"
        )}
      >
        <Icone className="size-4" strokeWidth={1.75} />
      </span>

      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <StatusBadge {...(critico ? STATUS.alerta.critico : STATUS.alerta.aviso)} />
          <span className="text-label text-t2">
            {a.loja} · {a.regraRotulo}
          </span>
        </p>
        <h3 className="mt-0.5 text-section text-ink">{a.titulo}</h3>
        {a.detalhe && <p className="break-words text-dense text-t1 text-pretty">{a.detalhe}</p>}
        <p className="num text-label text-t2">
          {ha ? `Aberto há ${ha}` : "Aberto"} · {textoAvisos(a.n_notificacoes)}
        </p>
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Link
          href={a.destino.href}
          onClick={onResolver}
          aria-label={`Resolver em ${a.destino.tela}`}
          className={cn(
            buttonVariants({ variant: "primary" }),
            "h-ctl-lg flex-1 sm:h-ctl-md sm:flex-none"
          )}
        >
          Resolver
          <ArrowRight aria-hidden />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "h-ctl-lg px-3 sm:h-ctl-md"
            )}
          >
            Silenciar
            <ChevronDown aria-hidden className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Sem aviso no Telegram</DropdownMenuLabel>
              {OPCOES_SILENCIO.map((o) =>
                o.horas ? (
                  <DropdownMenuItem key={o.rotulo} onClick={onSilenciar}>
                    {o.rotulo}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={o.rotulo} disabled className="justify-between">
                    {o.rotulo}{" "}
                    <span className="rounded-sm border border-border px-1 text-label text-t2">
                      Em breve
                    </span>
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
