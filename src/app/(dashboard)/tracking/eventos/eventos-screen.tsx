"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ROTAS, TODAS, type EventoFeed, type LojaDoSeletor } from "@/lib/financeiro/tipos";
import { chaveDoEvento, definicaoDoEvento } from "@/lib/tracking/eventos";
import { cn } from "@/lib/utils";
import { Aviso, Selo, TagPlataforma } from "../selo";
import type { Tom } from "../saude";

// ============================================================================
// Eventos ao vivo: as ultimas linhas da fila de rastreamento, por polling.
//
// Polling e nao Supabase Realtime: Realtime abriria um canal por aba com a
// RLS de tracking_events avaliada a cada INSERT, e esta tela so precisa de
// "o que chegou nos ultimos segundos". 15 s, e so com a aba visivel -- aba
// esquecida aberta nao vira carga de banco.
// ============================================================================

const INTERVALO_MS = 15_000;
const TETO = 500;

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";
const VAZIO_CAIXA =
  "rounded-xl border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center";
const VAZIO_CTA =
  "mt-4 inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] hover:bg-[var(--solid-hover)]";
const BOTAO =
  "inline-flex h-[28px] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-[var(--border-strong)] disabled:opacity-60";

const STATUS: Record<EventoFeed["status"], { tom: Tom; rotulo: string }> = {
  enviado: { tom: "ok", rotulo: "Enviado" },
  pendente: { tom: "warn", rotulo: "Pendente" },
  falhou: { tom: "err", rotulo: "Falhou" },
};

const FONTE: Record<EventoFeed["fonte"], string> = {
  tema: "Tema",
  pixel: "Pixel",
  webhook: "Webhook",
};

/** Mais novo primeiro; empate no instante desempata pelo id, como a RPC. */
function ordenar(a: EventoFeed, b: EventoFeed): number {
  if (a.criado_em !== b.criado_em) return a.criado_em < b.criado_em ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Junta o que chegou com o que ja estava, sem repetir id. A versao NOVA de um
 * id vence: o polling relê os ultimos 100, e um "pendente" de 15 s atras pode
 * ter virado "enviado".
 */
function juntar(atuais: EventoFeed[], novos: EventoFeed[]): EventoFeed[] {
  const porId = new Map<string, EventoFeed>();
  for (const e of atuais) porId.set(e.id, e);
  for (const e of novos) porId.set(e.id, e);
  return [...porId.values()].sort(ordenar).slice(0, TETO);
}

function nomeDoEvento(cru: string): string {
  const chave = chaveDoEvento(cru);
  return chave ? definicaoDoEvento(chave).nome : cru || "—";
}

function ehCompra(e: EventoFeed): boolean {
  return chaveDoEvento(e.evento) === "purchase";
}

function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function dataHoraCompleta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

function latencia(e: EventoFeed): string {
  if (e.latencia_s === null || e.status !== "enviado") return "—";
  return `${e.latencia_s.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

function clique(e: EventoFeed): string {
  // So na compra o click id decide algo (atribuicao no anuncio). Em ver
  // produto ou carrinho, "sem clique" pareceria defeito sem ser.
  if (!ehCompra(e) || e.com_clique === null) return "—";
  return e.com_clique ? "com clique" : "sem clique";
}

function decodificar(v: string | null): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
}

function origem(e: EventoFeed): string {
  const utm = [decodificar(e.utm_source), decodificar(e.utm_campaign)].filter(Boolean).join("/");
  const partes = [e.origem_host, utm].filter(Boolean);
  return partes.length ? partes.join(" · ") : "—";
}

function plataformaConhecida(p: string): p is "google" | "meta" {
  return p === "google" || p === "meta";
}

function Destino({ e }: { e: EventoFeed }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {plataformaConhecida(e.plataforma) && <TagPlataforma plataforma={e.plataforma} />}
      <span className="min-w-0 truncate text-t2">{e.destino_nome || "—"}</span>
    </span>
  );
}

function SeloStatus({ e }: { e: EventoFeed }) {
  const s = STATUS[e.status];
  const titulo =
    e.erro ?? (e.tentativas > 1 ? `${e.tentativas} tentativas` : undefined);
  return (
    <Selo tom={s.tom} title={titulo}>
      {s.rotulo}
    </Selo>
  );
}

function Hora({ iso }: { iso: string }) {
  // O servidor formata no fuso dele (UTC na Vercel), o navegador no do
  // lojista: sem o suppress, cada linha geraria aviso de hidratacao.
  return (
    <span suppressHydrationWarning title={dataHoraCompleta(iso)} className="font-mono tabular-nums">
      {hora(iso)}
    </span>
  );
}

export function EventosScreen({
  inicial,
  lojas,
  lojaId,
  geradoEm,
}: {
  inicial: EventoFeed[];
  lojas: LojaDoSeletor[];
  lojaId: string;
  /** Instante (ms) em que o servidor leu `inicial`. */
  geradoEm: number;
}) {
  const [eventos, setEventos] = useState<EventoFeed[]>(inicial);
  const [aoVivo, setAoVivo] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState(geradoEm);
  const [agora, setAgora] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregandoAntigos, setCarregandoAntigos] = useState(false);
  const [semMaisAntigos, setSemMaisAntigos] = useState(inicial.length < 100);
  const buscando = useRef(false);
  // A primeira pagina veio do servidor agora ha pouco: so ao RETOMAR (pausado
  // -> ao vivo) vale buscar na hora, sem esperar o primeiro tique.
  const primeiraVez = useRef(true);

  const todas = lojaId === TODAS;
  const nomeDaLoja = new Map(lojas.map((l) => [l.id, l.nome || l.dominio]));

  // Relogio do "atualizado ha Ns".
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Polling. A tela inteira e remontada quando a loja muda (key no page.tsx),
  // entao lojaId aqui e fixo durante a vida do componente.
  useEffect(() => {
    if (!aoVivo) return;
    const controle = new AbortController();

    async function buscar() {
      if (document.visibilityState !== "visible" || buscando.current) return;
      buscando.current = true;
      try {
        const r = await fetch(`${ROTAS.apiEventos}?loja=${encodeURIComponent(lojaId)}`, {
          cache: "no-store",
          signal: controle.signal,
        });
        const corpo = (await r.json().catch(() => ({}))) as {
          eventos?: EventoFeed[];
          error?: string;
        };
        if (!r.ok || !Array.isArray(corpo.eventos)) {
          throw new Error(corpo.error || `Resposta ${r.status}`);
        }
        const novos = corpo.eventos;
        setEventos((atuais) => juntar(atuais, novos));
        setAtualizadoEm(Date.now());
        setErro(null);
      } catch (e) {
        if (controle.signal.aborted) return;
        setErro(e instanceof Error ? e.message : "Falha ao atualizar.");
      } finally {
        buscando.current = false;
      }
    }

    if (primeiraVez.current) primeiraVez.current = false;
    else void buscar();

    const id = setInterval(buscar, INTERVALO_MS);
    // Voltou para a aba depois de um tempo: atualiza na hora, sem esperar o
    // proximo tique.
    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") void buscar();
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      controle.abort();
      buscando.current = false;
    };
  }, [aoVivo, lojaId]);

  async function carregarAntigos() {
    const ultimo = eventos[eventos.length - 1];
    if (!ultimo || carregandoAntigos) return;
    setCarregandoAntigos(true);
    try {
      const r = await fetch(
        `${ROTAS.apiEventos}?loja=${encodeURIComponent(lojaId)}&antes=${encodeURIComponent(ultimo.criado_em)}`,
        { cache: "no-store" }
      );
      const corpo = (await r.json().catch(() => ({}))) as {
        eventos?: EventoFeed[];
        error?: string;
      };
      if (!r.ok || !Array.isArray(corpo.eventos)) {
        throw new Error(corpo.error || `Resposta ${r.status}`);
      }
      const antigos = corpo.eventos;
      if (antigos.length < 100) setSemMaisAntigos(true);
      setEventos((atuais) => juntar(atuais, antigos));
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setCarregandoAntigos(false);
    }
  }

  const contagem = { enviado: 0, pendente: 0, falhou: 0 };
  for (const e of eventos) contagem[e.status] += 1;

  const segundos = agora === null ? 0 : Math.max(0, Math.round((agora - atualizadoEm) / 1000));
  const atualizado =
    segundos < 5
      ? "atualizado agora"
      : segundos < 120
        ? `atualizado há ${segundos} s`
        : `atualizado há ${Math.round(segundos / 60)} min`;

  if (lojas.length === 0) {
    return (
      <div className={VAZIO_CAIXA}>
        <p className="text-[15px] font-semibold text-ink">Nenhuma loja conectada</p>
        <p className="mx-auto mt-1.5 max-w-[380px] text-[12.5px] text-t2">
          Conecte uma loja e ligue o rastreamento para ver os eventos chegando aqui.
        </p>
        <Link href="/stores" className={cn(VAZIO_CTA, FOCO)}>
          Conectar loja
        </Link>
      </div>
    );
  }

  const noTeto = eventos.length >= TETO;

  return (
    <div className="flex flex-col gap-3">
      {/* Barra de estado: ligar/pausar, frescor e o resumo do que esta na tela. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
        <button
          type="button"
          aria-pressed={aoVivo}
          onClick={() => setAoVivo((v) => !v)}
          className={cn("rounded", FOCO)}
          title={aoVivo ? "Pausar a atualização automática" : "Voltar a atualizar a cada 15 s"}
        >
          <Selo tom={aoVivo ? "ok" : "neutro"}>{aoVivo ? "Ao vivo" : "Pausado"}</Selo>
        </button>
        <span suppressHydrationWarning className="text-[11.5px] text-t3">
          {atualizado}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-t3">
          <span>
            <span className="font-mono tabular-nums text-ink">{contagem.enviado}</span> enviados
          </span>
          <span>
            <span className="font-mono tabular-nums text-ink">{contagem.pendente}</span> pendentes
          </span>
          <span>
            <span
              className={cn(
                "font-mono tabular-nums",
                contagem.falhou > 0 ? "text-[var(--err)]" : "text-ink"
              )}
            >
              {contagem.falhou}
            </span>{" "}
            {contagem.falhou === 1 ? "falha" : "falhas"}
          </span>
        </span>
      </div>

      {erro && (
        <Aviso
          tom="warn"
          titulo="Não foi possível atualizar os eventos"
          detalhe={`${erro}. A lista abaixo é a da última leitura que deu certo.`}
        />
      )}

      {eventos.length === 0 ? (
        <div className={VAZIO_CAIXA}>
          <p className="text-[15px] font-semibold text-ink">Nenhum evento ainda</p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12.5px] text-t2">
            Eventos aparecem quando o tema, o pixel do checkout ou o webhook mandam algo para
            um destino ativo.
          </p>
          <Link href="/tracking" className={cn(VAZIO_CTA, FOCO)}>
            Ver saúde dos pixels
          </Link>
        </div>
      ) : (
        <>
          {/* Desktop: grade de linhas. Rola de lado dentro da caixa se a tela
              for estreita -- a pagina em si nunca rola de lado. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <div className={cn("min-w-[980px]", todas && "min-w-[1100px]")}>
              <div
                className="grid h-[34px] items-center gap-3 border-b border-border px-3.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-t4"
                style={{ gridTemplateColumns: colunas(todas) }}
              >
                <span>Hora</span>
                {todas && <span>Loja</span>}
                <span>Evento</span>
                <span>Fonte</span>
                <span>Destino</span>
                <span>Status</span>
                <span className="text-right">Latência</span>
                <span>Clique</span>
                <span>Origem</span>
                <span className="text-right">Pedido</span>
              </div>
              {eventos.map((e) => (
                <div
                  key={e.id}
                  className="grid h-[44px] items-center gap-3 border-b border-[var(--border-subtle)] px-3.5 text-[12px] last:border-b-0"
                  style={{ gridTemplateColumns: colunas(todas) }}
                >
                  <span className="text-t2">
                    <Hora iso={e.criado_em} />
                  </span>
                  {todas && (
                    <span className="truncate text-t2" title={nomeDaLoja.get(e.store_id)}>
                      {nomeDaLoja.get(e.store_id) || "—"}
                    </span>
                  )}
                  <span className="truncate font-medium text-ink">{nomeDoEvento(e.evento)}</span>
                  <span className="text-t2">{FONTE[e.fonte]}</span>
                  <Destino e={e} />
                  <span>
                    <SeloStatus e={e} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-t2">{latencia(e)}</span>
                  <span className={cn("text-t2", clique(e) === "sem clique" && "text-t3")}>
                    {clique(e)}
                  </span>
                  <span className="truncate text-t3" title={origem(e)}>
                    {origem(e)}
                  </span>
                  <span className="text-right font-mono tabular-nums text-t2">
                    {e.pedido ? `#${e.pedido}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Celular: um cartao por evento. */}
          <div className="flex flex-col gap-2 md:hidden">
            {eventos.map((e) => (
              <div key={e.id} className="rounded-xl border border-border bg-surface px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                    {nomeDoEvento(e.evento)}
                  </span>
                  <SeloStatus e={e} />
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-t3">
                  <Hora iso={e.criado_em} />
                  <span aria-hidden>·</span>
                  <span>{FONTE[e.fonte]}</span>
                  <span aria-hidden>·</span>
                  <span className="min-w-0 flex-1">
                    <Destino e={e} />
                  </span>
                </div>
                <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
                  {todas && (
                    <>
                      <dt className="text-t4">Loja</dt>
                      <dd className="truncate text-t2">{nomeDaLoja.get(e.store_id) || "—"}</dd>
                    </>
                  )}
                  <dt className="text-t4">Latência</dt>
                  <dd className="font-mono tabular-nums text-t2">{latencia(e)}</dd>
                  {ehCompra(e) && (
                    <>
                      <dt className="text-t4">Clique</dt>
                      <dd className="text-t2">{clique(e)}</dd>
                      <dt className="text-t4">Pedido</dt>
                      <dd className="font-mono tabular-nums text-t2">
                        {e.pedido ? `#${e.pedido}` : "—"}
                      </dd>
                    </>
                  )}
                  <dt className="text-t4">Origem</dt>
                  <dd className="truncate text-t2">{origem(e)}</dd>
                </dl>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {noTeto ? (
              <span className="text-[11.5px] text-t3">
                Mostrando os {TETO} eventos mais recentes.
              </span>
            ) : semMaisAntigos ? (
              <span className="text-[11.5px] text-t3">Não há eventos mais antigos.</span>
            ) : (
              <button
                type="button"
                onClick={carregarAntigos}
                disabled={carregandoAntigos}
                className={cn(BOTAO, FOCO)}
              >
                {carregandoAntigos && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                Carregar mais antigos
              </button>
            )}
          </div>
        </>
      )}

      <p className="text-[11.5px] text-t3">
        Só entram eventos aceitos por algum destino: o Meta aceita todos; o Google, só os que
        têm rótulo.
      </p>
    </div>
  );
}

function colunas(todas: boolean): string {
  // Hora | (Loja) | Evento | Fonte | Destino | Status | Latencia | Clique | Origem | Pedido
  return todas
    ? "72px minmax(90px,1fr) minmax(120px,1fr) 60px minmax(130px,1.2fr) 84px 60px 76px minmax(120px,1.2fr) 76px"
    : "72px minmax(120px,1fr) 60px minmax(130px,1.2fr) 84px 60px 76px minmax(120px,1.2fr) 76px";
}
