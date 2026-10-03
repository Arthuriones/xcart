"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { TODAS, type EventoFeed, type LojaDoSeletor } from "@/lib/financeiro/tipos";
import { horaNoFuso, rotuloFuso } from "@/components/layout/contexto";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoEventos, NotaEventos } from "./cabecalho";
import { DetalheEvento } from "./detalhe";
import { Chips, Contadores, Visoes } from "./filtros";
import { ListaEventos, type ContextoLista } from "./lista";
import {
  CHAVE_VISOES,
  PAGINA,
  TETO,
  chavePedido,
  contarStatus,
  diaNoFuso,
  filtroParaQuery,
  filtroVazio,
  idsNovos,
  juntarEventos,
  lerVisoesSalvas,
  montarCsv,
  passa,
  temFiltro as filtroAtivo,
  urlDoPedido,
  visaoAtiva,
  type Filtro,
  type Visao,
} from "./logica";

// ============================================================================
// Eventos ao vivo: as ultimas linhas da fila de rastreamento, por polling.
//
// Polling e nao Supabase Realtime: Realtime abriria um canal por aba com a
// RLS de tracking_events avaliada a cada INSERT, e esta tela so precisa de
// "o que chegou nos ultimos segundos". 15 s, e so com a aba visivel -- aba
// esquecida aberta nao vira carga de banco.
//
// Le de /api/leitura/eventos: o mesmo feed de /api/tracking/eventos mais o
// nome de cada pedido ("#1040").
// ============================================================================

const INTERVALO_MS = 15_000;
const ROTA = "/api/leitura/eventos";

interface Pagina {
  eventos: EventoFeed[];
  pedidos: Record<string, string>;
}

async function lerPagina(lojaId: string, antes: string | null): Promise<Pagina> {
  const q = new URLSearchParams({ loja: lojaId });
  if (antes) q.set("antes", antes);
  const r = await fetch(`${ROTA}?${q}`, { cache: "no-store" });
  const corpo = (await r.json().catch(() => ({}))) as Partial<Pagina> & { erro?: string };
  if (!r.ok || !Array.isArray(corpo.eventos)) throw new Error(corpo.erro || `Resposta ${r.status}`);
  return { eventos: corpo.eventos, pedidos: corpo.pedidos ?? {} };
}

/**
 * Sem nome de pedido novo, devolve o MESMO objeto: o contexto das linhas fica
 * estavel e o memo segura as linhas que nao mudaram a cada consulta.
 */
function juntarPedidos(atual: Record<string, string>, novos: Record<string, string>): Record<string, string> {
  return Object.entries(novos).every(([k, v]) => atual[k] === v) ? atual : { ...atual, ...novos };
}

// Visoes salvas: o localStorage e a fonte. useSyncExternalStore le o texto
// cru (comparavel por igualdade), e o evento "storage" mantem outras abas em
// dia. No servidor nao ha visao salva: a lista chega depois de hidratar.
const AVISO_VISOES = "xcart:visoes-mudaram";

function assinarVisoes(avisar: () => void) {
  window.addEventListener("storage", avisar);
  window.addEventListener(AVISO_VISOES, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(AVISO_VISOES, avisar);
  };
}

function visoesCruas(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_VISOES);
  } catch {
    return null;
  }
}

function gravarVisoes(v: Visao[]): boolean {
  try {
    window.localStorage.setItem(CHAVE_VISOES, JSON.stringify(v));
    window.dispatchEvent(new Event(AVISO_VISOES));
    return true;
  } catch {
    return false;
  }
}

/** O filtro vai para a URL: um link copiado abre a tela ja filtrada. */
function filtroNaUrl(f: Filtro) {
  try {
    const q = filtroParaQuery(f);
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  } catch {
    // URL e conveniencia: sem ela o filtro continua valendo na tela.
  }
}

function baixar(nome: string, conteudo: string) {
  // BOM: sem ele o Excel abre UTF-8 como Latin-1 e estraga acento.
  const blob = new Blob(["﻿" + conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------

/** "Ao vivo" / "Pausado": um interruptor que parece interruptor. */
function InterruptorAoVivo({ ligado, onMudar }: { ligado: boolean; onMudar: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      onClick={() => onMudar(!ligado)}
      className={cn(
        "flex h-ctl-md items-center gap-2.5 rounded-full border pl-2.5 pr-3.5 text-dense font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        ligado ? "border-ok-border bg-ok-bg text-ok" : "border-border-strong bg-surface text-t1 hover:bg-hover"
      )}
    >
      <span aria-hidden className={cn("relative block h-4 w-7 rounded-full", ligado ? "bg-ok" : "bg-t4")}>
        <span
          className={cn(
            "absolute top-0.5 size-3 rounded-full bg-surface transition-[left] duration-150 ease-xc",
            ligado ? "left-3.5" : "left-0.5"
          )}
        />
      </span>
      {ligado ? "Ao vivo" : "Pausado"}
    </button>
  );
}

/**
 * "atualizado ha N s · 14:32 (horario de Sao Paulo)". O relogio de 1 s mora
 * so aqui: a lista de 500 linhas nao rerenderiza a cada segundo.
 */
function Frescor({ aoVivo, atualizadoEm, fuso }: { aoVivo: boolean; atualizadoEm: number; fuso: string }) {
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    if (!aoVivo) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [aoVivo]);

  if (!aoVivo) {
    return <span className="text-label text-t2">pausado: a lista não muda até você retomar</span>;
  }
  const s = agora === null ? 0 : Math.max(0, Math.round((agora - atualizadoEm) / 1000));
  const ha =
    s < 5
      ? "atualizado agora"
      : s < 120
        ? `atualizado há ${s} s`
        : s < 7200
          ? `atualizado há ${Math.round(s / 60)} min`
          : `atualizado há ${Math.round(s / 3600)} h`;
  return (
    <span className="num text-label text-t2">
      {ha} · {horaNoFuso(atualizadoEm, fuso)} ({rotuloFuso(fuso)})
    </span>
  );
}

// ---------------------------------------------------------------------------

export function EventosScreen({
  inicial,
  pedidosIniciais,
  lojas,
  lojaId,
  geradoEm,
  fuso,
  filtroInicial,
}: {
  inicial: EventoFeed[];
  /** "loja:pedidoId" -> "#1040". */
  pedidosIniciais: Record<string, string>;
  lojas: LojaDoSeletor[];
  lojaId: string;
  /** Instante (ms) em que o servidor leu `inicial`. */
  geradoEm: number;
  /** Fuso das horas (o mesmo da barra do topo). */
  fuso: string;
  /** Filtro que veio na URL. */
  filtroInicial: Filtro;
}) {
  const [eventos, setEventosEstado] = useState<EventoFeed[]>(inicial);
  const eventosRef = useRef(inicial);
  const [pedidos, setPedidos] = useState(pedidosIniciais);
  const [aoVivo, setAoVivo] = useState(true);
  const aoVivoRef = useRef(true);
  const [atualizadoEm, setAtualizadoEm] = useState(geradoEm);
  const [hoje, setHoje] = useState(() => diaNoFuso(geradoEm, fuso));
  const [erroAtualizar, setErroAtualizar] = useState(false);
  const [carregandoAntigos, setCarregandoAntigos] = useState(false);
  const [semMaisAntigos, setSemMaisAntigos] = useState(inicial.length < PAGINA);
  const [novos, setNovos] = useState<ReadonlySet<string>>(() => new Set());
  const [filtro, setFiltroEstado] = useState<Filtro>(filtroInicial);
  const visoesTexto = useSyncExternalStore(assinarVisoes, visoesCruas, () => null);
  const salvas = useMemo(() => lerVisoesSalvas(visoesTexto), [visoesTexto]);
  // O evento do detalhe fica guardado ao fechar: o painel anima a saida com
  // o conteudo, e um "na fila" que vira "enviado" atualiza enquanto aberto.
  const [detalhe, setDetalhe] = useState<EventoFeed | null>(null);
  const [detalheAberto, setDetalheAberto] = useState(false);
  const buscando = useRef(false);
  // A primeira pagina veio do servidor agora ha pouco: so ao RETOMAR (pausado
  // -> ao vivo) vale buscar na hora, sem esperar o primeiro tique.
  const primeiraVez = useRef(true);

  const setEventos = useCallback((lista: EventoFeed[]) => {
    eventosRef.current = lista;
    setEventosEstado(lista);
  }, []);

  const setFiltro = useCallback((f: Filtro) => {
    setFiltroEstado(f);
    filtroNaUrl(f);
  }, []);

  // A linha nova pisca uma vez; depois some da lista de novas.
  useEffect(() => {
    if (!novos.size) return;
    const id = setTimeout(() => setNovos(new Set()), 2500);
    return () => clearTimeout(id);
  }, [novos]);

  const buscar = useCallback(async () => {
    if (buscando.current || document.visibilityState !== "visible") return;
    buscando.current = true;
    try {
      const pagina = await lerPagina(lojaId, null);
      // Pausou no meio da leitura: "a lista nao muda ate voce retomar".
      if (!aoVivoRef.current) return;
      const atuais = eventosRef.current;
      const chegaram = idsNovos(atuais, pagina.eventos);
      setEventos(juntarEventos(atuais, pagina.eventos));
      if (chegaram.length) setNovos(new Set(chegaram));
      setPedidos((p) => juntarPedidos(p, pagina.pedidos));
      const agora = Date.now();
      setAtualizadoEm(agora);
      setHoje(diaNoFuso(agora, fuso));
      setErroAtualizar(false);
    } catch {
      if (aoVivoRef.current) setErroAtualizar(true);
    } finally {
      buscando.current = false;
    }
  }, [lojaId, fuso, setEventos]);

  // Polling. A tela e remontada quando a loja muda (key no page.tsx), entao
  // lojaId aqui e fixo durante a vida do componente.
  useEffect(() => {
    aoVivoRef.current = aoVivo;
    if (!aoVivo) return;
    if (primeiraVez.current) primeiraVez.current = false;
    else void buscar();
    const id = setInterval(() => void buscar(), INTERVALO_MS);
    // Voltou para a aba: atualiza na hora, sem esperar o proximo tique.
    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") void buscar();
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [aoVivo, buscar]);

  async function carregarAntigos() {
    const atuais = eventosRef.current;
    const ultimo = atuais[atuais.length - 1];
    if (!ultimo || carregandoAntigos) return;
    setCarregandoAntigos(true);
    try {
      const pagina = await lerPagina(lojaId, ultimo.criado_em);
      if (pagina.eventos.length < PAGINA) setSemMaisAntigos(true);
      setEventos(juntarEventos(eventosRef.current, pagina.eventos));
      setPedidos((p) => juntarPedidos(p, pagina.pedidos));
    } catch {
      toast.error("Não foi possível carregar os eventos mais antigos", {
        description: "Tente de novo em instantes.",
      });
    } finally {
      setCarregandoAntigos(false);
    }
  }

  // --- derivados ---------------------------------------------------------
  const temFiltro = filtroAtivo(filtro);
  const visiveis = useMemo(
    () => (temFiltro ? eventos.filter((e) => passa(e, filtro)) : eventos),
    [eventos, filtro, temFiltro]
  );
  const contagem = useMemo(() => contarStatus(eventos), [eventos]);
  const ativa = visaoAtiva(filtro, salvas);

  const lojaPorId = useMemo(() => new Map(lojas.map((l) => [l.id, l])), [lojas]);
  const nomeLoja = useCallback(
    (id: string) => {
      const l = lojaPorId.get(id);
      return l ? l.nome || l.dominio : "—";
    },
    [lojaPorId]
  );
  const nomePedido = useCallback(
    (e: EventoFeed) => (e.pedido ? (pedidos[chavePedido(e.store_id, e.pedido)] ?? null) : null),
    [pedidos]
  );
  const urlPedido = useCallback(
    (e: EventoFeed) => (e.pedido ? urlDoPedido(lojaPorId.get(e.store_id)?.dominio ?? "", e.pedido) : null),
    [lojaPorId]
  );
  const abrir = useCallback((e: EventoFeed) => {
    setDetalhe(e);
    setDetalheAberto(true);
  }, []);

  const ctx = useMemo<ContextoLista>(
    () => ({ fuso, hoje, todas: lojaId === TODAS, nomeLoja, nomePedido, urlPedido, onAbrir: abrir }),
    [fuso, hoje, lojaId, nomeLoja, nomePedido, urlPedido, abrir]
  );

  // O detalhe mostra a versao mais nova do evento, se ele ainda estiver na lista.
  const eventoDetalhe = detalhe ? (eventos.find((e) => e.id === detalhe.id) ?? detalhe) : null;

  // --- acoes ---------------------------------------------------------------
  function mudarAoVivo(v: boolean) {
    aoVivoRef.current = v;
    if (!v) setErroAtualizar(false);
    setAoVivo(v);
  }

  function salvarVisao(nome: string) {
    const nova: Visao = { id: `v${Date.now().toString(36)}`, nome, filtro };
    if (gravarVisoes([...salvas, nova])) {
      toast.success("Visão salva neste navegador", { description: `“${nome}” aparece nas abas desta tela.` });
    } else {
      toast.error("Não foi possível salvar a visão", {
        description: "Este navegador não deixa o site guardar dados. O filtro continua aplicado.",
      });
    }
  }

  function excluirVisao(id: string) {
    if (gravarVisoes(salvas.filter((v) => v.id !== id))) {
      toast("Visão excluída", { description: "O filtro continua aplicado até você trocar." });
    } else {
      toast.error("Não foi possível excluir a visão");
    }
  }

  function exportar() {
    const csv = montarCsv(visiveis, {
      fuso,
      nomeLoja,
      nomePedido: (e) => nomePedido(e) ?? e.pedido ?? "",
    });
    baixar(`eventos-${diaNoFuso(Date.now(), fuso)}.csv`, csv);
    const n = visiveis.length;
    toast.success("CSV pronto", {
      description: `${n === 1 ? "1 linha" : `${n} linhas`}${temFiltro ? ", com os filtros aplicados" : ""}.\nSó as colunas da tabela; nada de IP ou navegador.`,
    });
  }

  const noTeto = eventos.length >= TETO;

  return (
    <>
      <CabecalhoEventos>
        <Button variant="secondary" onClick={exportar} disabled={visiveis.length === 0}>
          <DownloadIcon aria-hidden />
          Exportar CSV
        </Button>
      </CabecalhoEventos>

      <section aria-label="Eventos" className="min-w-0 rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border-subtle px-4 py-3">
          <InterruptorAoVivo ligado={aoVivo} onMudar={mudarAoVivo} />
          <Frescor aoVivo={aoVivo} atualizadoEm={atualizadoEm} fuso={fuso} />
          <div className="hidden flex-1 lg:block" />
          <Contadores total={eventos.length} contagem={contagem} filtro={filtro} onFiltro={setFiltro} />
        </div>

        <Visoes
          ativa={ativa}
          salvas={salvas}
          onFiltro={setFiltro}
          onSalvar={salvarVisao}
          onExcluir={excluirVisao}
        />

        <Chips eventos={eventos} filtro={filtro} onFiltro={setFiltro} temFiltro={temFiltro} />

        {aoVivo && erroAtualizar && (
          <div className="px-4 pb-3">
            <Callout
              tom="warn"
              titulo="A lista parou de atualizar"
              acao={
                <Button size="sm" variant="secondary" onClick={() => void buscar()}>
                  Tentar agora
                </Button>
              }
            >
              A lista abaixo é a da última leitura que deu certo. Tentamos de novo a cada 15 s.
            </Callout>
          </div>
        )}

        {eventos.length === 0 ? (
          <EmptyState
            variante="simples"
            className="min-h-65 border-t border-border"
            titulo="Nenhum evento ainda"
            descricao="Os eventos aparecem aqui assim que alguém visitar a loja rastreada."
            acao={
              <Link href="/tracking" className={buttonVariants()}>
                Conferir rastreamento
              </Link>
            }
          />
        ) : visiveis.length === 0 ? (
          <EmptyState
            variante="simples"
            className="min-h-55 border-t border-border"
            titulo="Nenhum evento com esses filtros"
            descricao="Nas linhas carregadas não há evento que combine com tudo."
            acao={
              <Button variant="secondary" onClick={() => setFiltro(filtroVazio())}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <ListaEventos linhas={visiveis} novos={novos} ctx={ctx} />
        )}

        {eventos.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
            <span className="text-label text-t2">
              Mostrando {visiveis.length} de {eventos.length} carregadas. A contagem do período
              inteiro ainda não existe.
            </span>
            {noTeto ? (
              <span className="text-label text-t2">Mostrando os {TETO} eventos mais recentes.</span>
            ) : semMaisAntigos ? (
              <span className="text-label text-t2">Não há eventos mais antigos.</span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="min-w-45"
                pending={carregandoAntigos}
                onClick={carregarAntigos}
              >
                Carregar mais antigos
              </Button>
            )}
          </div>
        )}
      </section>

      <NotaEventos />

      <DetalheEvento
        evento={eventoDetalhe}
        aberto={detalheAberto}
        aoMudar={setDetalheAberto}
        fuso={fuso}
        nomeLoja={nomeLoja}
        nomePedido={nomePedido}
        urlPedido={urlPedido}
      />
    </>
  );
}
