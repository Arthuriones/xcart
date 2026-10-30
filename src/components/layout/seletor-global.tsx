"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  Calendar,
  Check,
  CreditCard,
  ChevronDown,
  ChevronLeft,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Store,
  X,
} from "lucide-react";
import clsx from "clsx";
import { ROTA_CONECTAR_OPERACAO, ROTULO_CONECTAR_OPERACAO } from "@/lib/conectar-operacao";
import {
  COOKIE_LOJA,
  COOKIE_MOEDA,
  COOKIE_PERIODO,
  MOEDAS_RELATORIO,
  PERIODOS,
  TODAS,
  ehPersonalizado,
  intervaloDoPeriodo,
  serializarPeriodo,
  type FiltroGlobal,
  type Intervalo,
  type LojaDoSeletor,
  type MoedaRelatorio,
  type Periodo,
  type PeriodoId,
} from "@/lib/financeiro/tipos";
import { Calendario } from "./calendario";
import {
  COOKIE_COMPARAR,
  ROTULO_COMPARACAO,
  ROTULO_PERIODO,
  ROTULO_PERSONALIZADO,
  gravarCookie,
  horaNoFuso,
  nomeDoPeriodo,
  rotuloDatas,
  rotuloFuso,
  rotuloIntervalo,
  type Comparacao,
  type ModoContexto,
} from "./contexto";
import { Folha, Pop } from "./sobreposicao";

// ============================================================================
// Barra de contexto: loja, periodo, comparacao, moeda, fuso e "Atualizado as".
// Um componente so, no topo de toda tela que mostra numero.
//
// Grava em cookie e pede ao servidor para desenhar de novo (router.refresh):
// a pagina le o cookie com cookies(). Ver src/lib/filtro-global.ts para o
// porque de cookie e nao URL. Vale para todas as telas e fica salvo neste
// navegador -- e a barra diz isso.
// ============================================================================

export interface LojaContexto extends LojaDoSeletor {
  /** A Shopify nega ler os pedidos (loja pausada, app desinstalado, token velho). */
  semAcesso: boolean;
}

export interface DadosContexto {
  lojas: LojaContexto[];
  /** Ja conferido contra as lojas do usuario (filtroResolvido). */
  filtro: FiltroGlobal;
  comparacao: Comparacao;
  /** Fuso do "hoje" do relatorio: o da loja escolhida, ou Sao Paulo. */
  fuso: string;
  hoje: string;
  /** Os presets, ja calculados no servidor. O personalizado e calculado aqui (intervalosDe). */
  intervalos: Record<PeriodoId, { atual: Intervalo; anterior: Intervalo }>;
}

interface Valores {
  lojaId: string;
  periodo: Periodo;
  moeda: MoedaRelatorio;
  comparacao: Comparacao;
}

const COOKIES: Record<keyof Valores, string> = {
  lojaId: COOKIE_LOJA,
  periodo: COOKIE_PERIODO,
  moeda: COOKIE_MOEDA,
  comparacao: COOKIE_COMPARAR,
};

/** O valor como vai no cookie: o periodo personalizado e um objeto. */
function noCookie(v: Valores, chave: keyof Valores): string {
  return chave === "periodo" ? serializarPeriodo(v.periodo) : String(v[chave]);
}

/**
 * Atual e anterior do periodo. tipos.ts e puro: a conta do personalizado aqui
 * e a mesma do servidor, com o mesmo "hoje" (o do fuso do relatorio).
 */
function intervalosDe(dados: DadosContexto, p: Periodo): { atual: Intervalo; anterior: Intervalo } {
  return ehPersonalizado(p) ? intervaloDoPeriodo(p, dados.hoje) : dados.intervalos[p];
}

/**
 * Estado da barra: responde na hora (otimista) e o servidor confirma no
 * refresh. Quando as props mudam (outro refresh, outra aba gravou o cookie),
 * volta a seguir o servidor -- ajuste durante o render, sem efeito.
 */
export function useContexto(dados: DadosContexto | null) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const doServidor: Valores | null = dados
    ? { ...dados.filtro, comparacao: dados.comparacao }
    : null;
  const [valores, setValores] = useState<Valores | null>(doServidor);
  const [anterior, setAnterior] = useState<Valores | null>(doServidor);
  // Cada leitura nova (trocar o contexto, "Atualizar agora") conta uma rodada:
  // e ela que renova o "Atualizado as".
  const [rodada, setRodada] = useState(0);
  if (doServidor && JSON.stringify(doServidor) !== JSON.stringify(anterior)) {
    setAnterior(doServidor);
    setValores(doServidor);
  }

  function gravar(mudanca: Partial<Valores>) {
    if (!valores) return;
    const proximo = { ...valores, ...mudanca };
    let mudou = false;
    for (const chave of Object.keys(mudanca) as (keyof Valores)[]) {
      const valor = noCookie(proximo, chave);
      if (valor === noCookie(valores, chave)) continue;
      gravarCookie(COOKIES[chave], valor);
      mudou = true;
    }
    if (!mudou) return;
    setValores(proximo);
    setRodada((r) => r + 1);
    startTransition(() => router.refresh());
  }

  function atualizar() {
    setRodada((r) => r + 1);
    startTransition(() => router.refresh());
  }

  return { valores, gravar, atualizar, pendente, rodada };
}

export type Contexto = ReturnType<typeof useContexto>;

// ---------------------------------------------------------------------------
// Pecas
// ---------------------------------------------------------------------------

// Sem cor de fundo, de texto nem de borda aqui: quem usa escolhe. clsx nao
// resolve conflito (bg-surface + bg-info-bg ficariam os dois, e vence a ordem
// do CSS).
const GATILHO = "flex h-ctl-md items-center gap-2 rounded-control border px-2.5 text-dense";
/** O gatilho comum (fora o da loja filtrada): borda leve, que firma no hover. */
const GATILHO_NEUTRO = "border-border bg-surface hover:border-border-strong";

function nomeDaLoja(lojas: LojaContexto[], id: string): string | null {
  const loja = lojas.find((l) => l.id === id);
  return loja ? loja.nome || loja.dominio : null;
}

/** "Loja: X" ou "Checkout: X" no botao do seletor. */
function prefixoDa(lojas: LojaContexto[], id: string): string {
  return lojas.find((l) => l.id === id)?.tipo === "checkout" ? "Checkout" : "Loja";
}

function dominioCurto(dominio: string) {
  return dominio.replace(/\.myshopify\.com$/i, "");
}

/** Ponto + nome + dominio, como opcao de radio. */
function OpcaoLoja({
  nome,
  sub,
  subMono,
  ponto,
  marcada,
  apagada,
  grande,
  onEscolher,
}: {
  nome: string;
  sub: string;
  subMono?: boolean;
  ponto: "ink" | "ok" | "t4";
  marcada: boolean;
  apagada?: boolean;
  grande?: boolean;
  onEscolher: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onEscolher}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-hover",
        grande ? "min-h-ctl-lg" : "min-h-10 py-1",
        marcada && "bg-nav-active"
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "size-2 shrink-0 rounded-full",
          ponto === "ink" ? "bg-ink" : ponto === "ok" ? "bg-ok" : "bg-t4"
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={clsx("truncate", grande ? "text-body" : "text-dense", apagada ? "text-t2" : "text-ink")}>
          {nome}
        </span>
        <span className={clsx("truncate text-label text-t3", subMono && "font-mono")}>{sub}</span>
      </span>
      {marcada && <Check className="size-4 shrink-0 text-ink" strokeWidth={2} aria-hidden />}
    </button>
  );
}

/** A lista de lojas: "Todas", ativas e, a parte, as sem acesso. */
function ListaLojas({
  lojas,
  lojaId,
  moeda,
  mostrarMoeda,
  busca,
  grande,
  onEscolher,
}: {
  lojas: LojaContexto[];
  lojaId: string;
  moeda: MoedaRelatorio;
  mostrarMoeda: boolean;
  busca: string;
  grande?: boolean;
  onEscolher: (id: string) => void;
}) {
  const termo = busca.trim().toLowerCase();
  const casa = (l: LojaContexto) => !termo || `${l.nome} ${l.dominio}`.toLowerCase().includes(termo);
  const shopify = lojas.filter((l) => l.tipo !== "checkout");
  const checkouts = lojas.filter((l) => l.tipo === "checkout");
  const ativas = shopify.filter((l) => !l.semAcesso);
  const semAcesso = shopify.filter((l) => l.semAcesso);
  const ativasVisiveis = ativas.filter(casa);
  const semAcessoVisiveis = semAcesso.filter(casa);
  const checkoutsVisiveis = checkouts.filter(casa);
  const mostraTodas = !termo || "todas as lojas".includes(termo);
  const nada =
    !mostraTodas && ativasVisiveis.length === 0 && semAcessoVisiveis.length === 0 && checkoutsVisiveis.length === 0;
  const somadas = ativas.length + checkouts.length;

  const titulo = "px-2 pb-1 pt-2 text-label font-medium text-t3";
  return (
    <div role="radiogroup" aria-label="Loja" className="flex flex-col">
      {mostraTodas && (
        <OpcaoLoja
          nome="Todas as lojas"
          sub={
            somadas === 1
              ? `1 ativa${mostrarMoeda ? `, em ${moeda}` : ""}`
              : `${somadas} ativas${mostrarMoeda ? ` somadas em ${moeda}` : ""}`
          }
          ponto="ink"
          marcada={lojaId === TODAS}
          grande={grande}
          onEscolher={() => onEscolher(TODAS)}
        />
      )}
      {ativasVisiveis.length > 0 && (
        <>
          <div className={titulo}>Ativas ({ativasVisiveis.length})</div>
          {ativasVisiveis.map((l) => (
            <OpcaoLoja
              key={l.id}
              nome={l.nome || dominioCurto(l.dominio)}
              sub={l.dominio}
              subMono
              ponto="ok"
              marcada={lojaId === l.id}
              grande={grande}
              onEscolher={() => onEscolher(l.id)}
            />
          ))}
        </>
      )}
      {semAcessoVisiveis.length > 0 && (
        <>
          <div className={titulo}>Sem acesso ({semAcessoVisiveis.length})</div>
          {semAcessoVisiveis.map((l) => (
            <OpcaoLoja
              key={l.id}
              nome={l.nome || dominioCurto(l.dominio)}
              sub="A Shopify não deixa ler os pedidos"
              ponto="t4"
              apagada
              marcada={lojaId === l.id}
              grande={grande}
              onEscolher={() => onEscolher(l.id)}
            />
          ))}
        </>
      )}
      {checkoutsVisiveis.length > 0 && (
        <>
          <div className={titulo}>Checkouts ({checkoutsVisiveis.length})</div>
          {checkoutsVisiveis.map((l) => (
            <OpcaoLoja
              key={l.id}
              nome={l.nome}
              sub={l.dominio}
              ponto="ok"
              marcada={lojaId === l.id}
              grande={grande}
              onEscolher={() => onEscolher(l.id)}
            />
          ))}
        </>
      )}
      {nada && (
        <p className="px-2 py-4 text-dense text-t2">Nenhuma loja com “{busca.trim()}”.</p>
      )}
    </div>
  );
}

/** "+ Conectar operação" no pe da lista de lojas: a escolha entre loja e checkout. */
function LinkConectar({ grande, aoIr }: { grande?: boolean; aoIr: () => void }) {
  return (
    <Link
      href={ROTA_CONECTAR_OPERACAO}
      onClick={aoIr}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-control px-2 text-t1 hover:bg-hover hover:text-ink",
        grande ? "min-h-ctl-lg text-body" : "min-h-10 text-dense"
      )}
    >
      <Plus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {ROTULO_CONECTAR_OPERACAO}
    </Link>
  );
}

function Radio({
  id,
  marcado,
  rotulo,
  sub,
  grande,
  onEscolher,
}: {
  id?: string;
  marcado: boolean;
  rotulo: string;
  sub?: string;
  grande?: boolean;
  onEscolher: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={marcado}
      onClick={onEscolher}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-hover",
        grande ? "min-h-ctl-lg" : "min-h-9"
      )}
    >
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded-full border border-control-border"
      >
        {marcado && <span className="size-2 rounded-full bg-ink" />}
      </span>
      <span className={clsx("flex-1", grande ? "text-body" : "text-dense", "text-ink")}>{rotulo}</span>
      {sub && <span className="num text-label text-t3">{sub}</span>}
    </button>
  );
}

/**
 * O segmentado da casca, um estilo so: trilho bg-track e a opcao marcada em
 * superficie com sombra (design do Panda Track). Moeda, comparacao (folha do celular) e tema
 * (tema.tsx) usam o mesmo desenho.
 */
function Segmentado<T extends string>({
  rotulo,
  rotuloId,
  opcoes,
  valor,
  grande,
  onEscolher,
}: {
  rotulo?: string;
  /** id do rotulo visivel, no lugar de `rotulo`. */
  rotuloId?: string;
  opcoes: { id: T; texto: string }[];
  valor: T;
  grande?: boolean;
  onEscolher: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      aria-labelledby={rotuloId}
      className={clsx(
        "flex shrink-0 items-center gap-0.5 rounded-control bg-track p-0.5",
        grande ? "w-full" : "h-ctl-md"
      )}
    >
      {opcoes.map((o) => {
        const on = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onEscolher(o.id)}
            className={clsx(
              "rounded-[6px] font-medium",
              grande ? "h-10 flex-1 px-2.5 text-dense" : "h-full px-2.25 text-label",
              on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(20,20,20,.12)]" : "text-t2 hover:text-ink"
            )}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

const OPCOES_MOEDA = MOEDAS_RELATORIO.map((m) => ({ id: m, texto: m }));
const OPCOES_COMPARACAO = (["anterior", "nenhum"] as Comparacao[]).map((c) => ({
  id: c,
  texto: ROTULO_COMPARACAO[c],
}));

function Moedas({
  valor,
  grande,
  onEscolher,
}: {
  valor: MoedaRelatorio;
  grande?: boolean;
  onEscolher: (m: MoedaRelatorio) => void;
}) {
  return (
    <Segmentado
      rotulo="Moeda do relatório"
      opcoes={OPCOES_MOEDA}
      valor={valor}
      grande={grande}
      onEscolher={onEscolher}
    />
  );
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

export function BarraContexto({
  dados,
  ctx,
  modo,
}: {
  dados: DadosContexto;
  ctx: Contexto;
  modo: ModoContexto;
}) {
  const [aberto, setAberto] = useState<"loja" | "periodo" | "comparar" | null>(null);
  const [busca, setBusca] = useState("");
  // Pop do periodo: a lista de presets ou o calendario do personalizado, com
  // as datas escolhidas ainda nao aplicadas.
  const [calendario, setCalendario] = useState(false);
  const [datas, setDatas] = useState<Intervalo | null>(null);
  const v = ctx.valores;
  if (!v || modo.tipo === "nenhum") return null;

  const completo = modo.tipo === "completo";
  const comparar = modo.tipo === "completo" && !modo.semComparar;
  const nomeLoja = nomeDaLoja(dados.lojas, v.lojaId);
  const filtrada = !!nomeLoja;
  // "5 ativas" ao lado de "Todas as lojas": as lojas Shopify que a Shopify
  // deixa ler (a lista do seletor chama de Ativas).
  const ativas = dados.lojas.filter((l) => l.tipo !== "checkout" && !l.semAcesso).length;
  const pop = (qual: "loja" | "periodo" | "comparar") => ({
    aberto: aberto === qual,
    aoMudar: (a: boolean) => {
      setAberto(a ? qual : null);
      if (!a) {
        setBusca("");
        setCalendario(false);
      }
    },
  });
  const atual = intervalosDe(dados, v.periodo);
  const personalizado = ehPersonalizado(v.periodo);
  const notaFuso = <p className="px-2 pb-1.5 pt-1 text-label text-t2">Os dias contam no {rotuloFuso(dados.fuso)}.</p>;

  return (
    <div
      role="group"
      aria-label="Contexto dos números: vale para todas as telas"
      aria-busy={ctx.pendente}
      className={clsx("flex min-w-0 items-center gap-1.5", ctx.pendente && "opacity-70")}
    >
      <div className="flex min-w-0 items-center">
        <Pop
          rotulo="Escolher loja"
          {...pop("loja")}
          className="w-80"
          gatilho={
            <button
              type="button"
              className={clsx(
                GATILHO,
                "min-w-0 max-w-55 text-ink",
                // Filtrada (azul de filtro ativo), o gatilho e o "x" formam
                // uma pilula so: o lado direito dele e a divisoria do "x".
                filtrada
                  ? "rounded-r-none border-r-0 border-info-border bg-info-bg hover:border-info"
                  : GATILHO_NEUTRO
              )}
            >
              {filtrada && prefixoDa(dados.lojas, v.lojaId) === "Checkout" ? (
                <CreditCard className="size-3.5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
              ) : (
                <Store className={clsx("size-3.5 shrink-0", filtrada ? "text-info" : "text-t3")} strokeWidth={1.75} aria-hidden />
              )}
              <span className="truncate font-medium">
                {filtrada ? (
                  <>
                    <span className="sr-only">{prefixoDa(dados.lojas, v.lojaId)}: </span>
                    {nomeLoja}
                  </>
                ) : (
                  "Todas as lojas"
                )}
              </span>
              {!filtrada && ativas > 0 && (
                <span className="num hidden whitespace-nowrap text-t3 @min-[1120px]:inline">
                  {ativas} {ativas === 1 ? "ativa" : "ativas"}
                </span>
              )}
              <ChevronDown className="size-3 shrink-0 text-t3" strokeWidth={2} aria-hidden />
            </button>
          }
        >
          {dados.lojas.length > 6 && (
            <div className="border-b border-border p-2">
              <label className="flex h-ctl-md items-center gap-2 rounded-control border border-control-border px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
                <Search className="size-4 text-t3" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Buscar loja</span>
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar loja"
                  className="min-w-0 flex-1 border-0 bg-transparent text-dense outline-none"
                />
              </label>
            </div>
          )}
          <div className="max-h-85 overflow-y-auto p-1">
            <ListaLojas
              lojas={dados.lojas}
              lojaId={v.lojaId}
              moeda={v.moeda}
              mostrarMoeda={completo}
              busca={busca}
              onEscolher={(id) => {
                ctx.gravar({ lojaId: id });
                setAberto(null);
                setBusca("");
              }}
            />
          </div>
          <div className="border-t border-border p-1">
            <LinkConectar
              aoIr={() => {
                setAberto(null);
                setBusca("");
              }}
            />
            <p className="px-2 pb-1.5 pt-1 text-label text-t3">A escolha vale para todas as telas.</p>
          </div>
        </Pop>
        {filtrada && (
          <button
            type="button"
            onClick={() => ctx.gravar({ lojaId: TODAS })}
            aria-label="Voltar para todas as lojas"
            title="Ver todas as lojas"
            className="grid h-ctl-md w-7 shrink-0 place-items-center rounded-control rounded-l-none border border-info-border bg-info-bg text-info hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>

      {completo && (
        <>
          <Pop
            rotulo="Escolher período"
            {...pop("periodo")}
            className={calendario ? "w-72 p-1" : "w-75 p-1"}
            gatilho={
              <button type="button" className={clsx(GATILHO, GATILHO_NEUTRO, "text-ink")}>
                <Calendar className="size-3.5 shrink-0 text-t3" strokeWidth={1.75} aria-hidden />
                <span className="whitespace-nowrap font-medium">{nomeDoPeriodo(v.periodo, atual.atual, dados.hoje)}</span>
                {/* As datas so quando a barra do topo (o container) tem folga. */}
                {!personalizado && (
                  <span className="num hidden whitespace-nowrap text-t3 @min-[1080px]:inline">
                    {rotuloIntervalo(atual.atual)}
                  </span>
                )}
                <ChevronDown className="size-3 shrink-0 text-t3" strokeWidth={2} aria-hidden />
              </button>
            }
          >
            {calendario ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setCalendario(false);
                    // O botao "Personalizado" volta a existir no proximo quadro.
                    requestAnimationFrame(() => document.getElementById("periodo-personalizado")?.focus());
                  }}
                  className="flex h-ctl-md items-center gap-1 self-start rounded-control px-2 text-dense text-t1 hover:bg-hover hover:text-ink"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
                  Voltar
                </button>
                <div className="px-1">
                  <Calendario hoje={dados.hoje} valor={datas} aoMudar={setDatas} focarAoAbrir />
                </div>
                <div className="px-1 pt-1">
                  <button
                    type="button"
                    disabled={!datas}
                    onClick={() => {
                      if (datas) ctx.gravar({ periodo: datas });
                      setAberto(null);
                      setCalendario(false);
                    }}
                    className="h-ctl-md w-full rounded-control bg-solid text-dense font-medium text-on-solid hover:bg-solid-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Aplicar
                  </button>
                </div>
                {notaFuso}
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label="Período" className="flex flex-col">
                  {PERIODOS.map((p) => (
                    <Radio
                      key={p.id}
                      marcado={p.id === v.periodo}
                      rotulo={ROTULO_PERIODO[p.id]}
                      sub={rotuloIntervalo(dados.intervalos[p.id].atual)}
                      onEscolher={() => {
                        ctx.gravar({ periodo: p.id });
                        setAberto(null);
                      }}
                    />
                  ))}
                  <span aria-hidden className="mx-2 my-1 h-px bg-border" />
                  <Radio
                    id="periodo-personalizado"
                    marcado={personalizado}
                    rotulo={ROTULO_PERSONALIZADO}
                    sub={personalizado ? rotuloDatas(atual.atual, dados.hoje) : "Escolher datas"}
                    onEscolher={() => {
                      setDatas(personalizado ? atual.atual : null);
                      setCalendario(true);
                    }}
                  />
                </div>
                {notaFuso}
              </>
            )}
          </Pop>

          {comparar && (
            <Pop
              rotulo="Comparar com"
              {...pop("comparar")}
              className="w-70 p-1"
              gatilho={
                <button type="button" className={clsx(GATILHO, GATILHO_NEUTRO, "gap-1 text-t2 hover:text-ink")}>
                  <span>vs.</span>
                  <span className="whitespace-nowrap">
                    {v.comparacao === "anterior" ? "período anterior" : "sem comparação"}
                  </span>
                </button>
              }
            >
              <div role="radiogroup" aria-label="Comparar com" className="flex flex-col">
                {(["anterior", "nenhum"] as Comparacao[]).map((c) => (
                  <Radio
                    key={c}
                    marcado={c === v.comparacao}
                    rotulo={ROTULO_COMPARACAO[c]}
                    sub={c === "anterior" ? rotuloIntervalo(atual.anterior) : undefined}
                    onEscolher={() => {
                      ctx.gravar({ comparacao: c });
                      setAberto(null);
                    }}
                  />
                ))}
              </div>
            </Pop>
          )}
        </>
      )}

      {completo && <Moedas valor={v.moeda} onEscolher={(m) => ctx.gravar({ moeda: m })} />}
    </div>
  );
}

/**
 * O botao de atualizar e "Atualizado as HH:MM", no fuso do relatorio.
 *
 * A hora e de quando esta tela leu os dados: muda ao trocar de tela (a chave
 * inclui o caminho) e ao atualizar. Nao e hora de sincronizacao com a Shopify
 * -- essa a propria tela mostra quando importa.
 */
export function Atualizado({
  ctx,
  fuso,
  chaveTela,
  compacto,
}: {
  ctx: Contexto;
  fuso: string;
  chaveTela: string;
  compacto?: boolean;
}) {
  const chave = `${chaveTela}|${ctx.rodada}`;
  if (compacto) {
    return <Hora key={chave} fuso={fuso} pendente={ctx.pendente} />;
  }
  return <AtualizarComDica key={chave} ctx={ctx} fuso={fuso} />;
}

/**
 * Desktop: "Atualizado as HH:MM" escrito ao lado do botao de atualizar. A
 * frase some so quando a barra do topo (o container) nao tem folga; ai a dica
 * do botao, que tambem diz o fuso, continua com a hora. O leitor de tela ouve
 * a mesma frase pela regiao viva. Chaveado pelo pai: le o instante uma vez
 * por tela e por rodada.
 */
function AtualizarComDica({ ctx, fuso }: { ctx: Contexto; fuso: string }) {
  const [instante] = useState(() => Date.now());
  const hora = horaNoFuso(instante, fuso);
  const curta = ctx.pendente ? "Atualizando…" : `Atualizado às ${hora}`;
  const frase = ctx.pendente ? "Atualizando…" : `Atualizado às ${hora} · ${rotuloFuso(fuso)}`;
  return (
    <Tooltip.Root>
      {/* O servidor e o navegador podem divergir no minuto da hidratacao. */}
      <span
        aria-hidden
        suppressHydrationWarning
        className="num hidden whitespace-nowrap pr-0.5 text-label text-t3 @min-[980px]:inline"
      >
        {curta}
      </span>
      <Tooltip.Trigger
        delay={150}
        type="button"
        onClick={ctx.atualizar}
        disabled={ctx.pendente}
        aria-busy={ctx.pendente}
        aria-label="Atualizar agora"
        className="grid size-ctl-md shrink-0 place-items-center rounded-control border border-border bg-surface text-t2 hover:border-border-strong hover:text-ink disabled:cursor-wait disabled:opacity-45"
      >
        <RefreshCw
          className={clsx("size-3.5", ctx.pendente && "animate-xc-spin")}
          strokeWidth={1.75}
          aria-hidden
        />
      </Tooltip.Trigger>
      <span aria-live="polite" suppressHydrationWarning className="sr-only">
        {frase}
      </span>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Tooltip.Popup className="whitespace-nowrap rounded-control bg-solid px-2.5 py-2 text-label text-on-solid shadow-overlay outline-none">
            {frase}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Celular: so a hora, no botao do resumo. */
function Hora({ fuso, pendente }: { fuso: string; pendente: boolean }) {
  // Lido uma vez por montagem: a chave do pai troca a cada tela e a cada
  // "Atualizar agora". O servidor e o navegador podem divergir no minuto da
  // hidratacao, dai o suppressHydrationWarning.
  const [instante] = useState(() => Date.now());
  return (
    <span suppressHydrationWarning className="num whitespace-nowrap text-label text-t3">
      {pendente ? "…" : horaNoFuso(instante, fuso)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Celular: um botao com o resumo, que abre o contexto num painel. O desktop
// usa o mesmo botao (`compacto`) quando a barra inteira nao cabe no topo.
// ---------------------------------------------------------------------------

export function ContextoCelular({
  dados,
  ctx,
  modo,
  chaveTela,
  compacto,
}: {
  dados: DadosContexto;
  ctx: Contexto;
  modo: ModoContexto;
  chaveTela: string;
  /** Desktop: 32px de altura e sem a hora (o topo ja mostra "Atualizado as"). */
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Valores | null>(null);
  // A pilula "Personalizado" marcada: o calendario aparece embaixo. "tocou":
  // foi o toque agora (e nao a folha abrindo ja nele), e o calendario rola ate
  // ficar a vista.
  const [calendario, setCalendario] = useState<"fechado" | "aberto" | "tocou">("fechado");
  const v = ctx.valores;
  if (!v || modo.tipo === "nenhum") return null;

  const completo = modo.tipo === "completo";
  const comparar = modo.tipo === "completo" && !modo.semComparar;
  const r = rascunho ?? v;
  const nomeLoja = nomeDaLoja(dados.lojas, v.lojaId);
  const resumo = [nomeLoja ?? "Todas as lojas"];
  if (completo) resumo.push(nomeDoPeriodo(v.periodo, intervalosDe(dados, v.periodo).atual, dados.hoje), v.moeda);
  if (modo.tipo === "loja") resumo.push("só a loja");
  const rascunhoPersonalizado = ehPersonalizado(r.periodo) ? intervalosDe(dados, r.periodo).atual : null;
  // Pilula "Personalizado" marcada e nenhum dia ainda: o rascunho segue no
  // preset de antes, e aplicar gravaria esse preset calado. Como no desktop,
  // o Aplicar espera o primeiro dia.
  const faltaDia = completo && calendario !== "fechado" && !rascunhoPersonalizado;

  function abrir(a: boolean) {
    setAberto(a);
    setRascunho(a ? v : null);
    setCalendario(a && v !== null && ehPersonalizado(v.periodo) ? "aberto" : "fechado");
  }

  const secao = "flex flex-col gap-2";
  const rotulo = "text-label font-semibold text-t1";

  return (
    <>
      <button
        type="button"
        onClick={() => abrir(true)}
        aria-haspopup="dialog"
        className={clsx(
          "flex items-center gap-2 rounded-control border text-left text-dense text-ink",
          compacto ? "h-ctl-md min-w-0 max-w-full px-2.5" : "min-h-ctl-lg w-full px-3",
          nomeLoja ? "border-info-border bg-info-bg" : "border-border bg-surface hover:border-border-strong"
        )}
      >
        <SlidersHorizontal
          className={clsx("shrink-0 text-t2", compacto ? "size-3.75" : "size-4")}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{resumo.join(" · ")}</span>
        {!compacto && <Atualizado ctx={ctx} fuso={dados.fuso} chaveTela={chaveTela} compacto />}
      </button>

      <Folha
        aberto={aberto}
        aoMudar={abrir}
        titulo="Contexto dos números"
        subtitulo="Vale para todas as telas."
        rodape={
          <button
            type="button"
            disabled={faltaDia}
            onClick={() => {
              ctx.gravar(r);
              abrir(false);
            }}
            className="h-ctl-lg w-full rounded-control bg-solid text-body font-medium text-on-solid hover:bg-solid-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {faltaDia ? "Escolha um dia" : "Aplicar"}
          </button>
        }
      >
        <div className="flex flex-col gap-5 px-4 py-3">
          <div className={secao}>
            <span className={rotulo}>Loja</span>
            <ListaLojas
              lojas={dados.lojas}
              lojaId={r.lojaId}
              moeda={r.moeda}
              mostrarMoeda={completo}
              busca=""
              grande
              onEscolher={(id) => setRascunho({ ...r, lojaId: id })}
            />
            <LinkConectar grande aoIr={() => abrir(false)} />
          </div>

          {completo && (
            <>
              <div className={secao}>
                <span className={rotulo} id="cel-periodo">
                  Período
                </span>
                <div role="radiogroup" aria-labelledby="cel-periodo" className="flex flex-wrap gap-2">
                  {[...PERIODOS.map((p) => p.id), null].map((id) => {
                    // null = a pilula "Personalizado".
                    const on = id === null ? calendario !== "fechado" : calendario === "fechado" && id === r.periodo;
                    return (
                      <button
                        key={id ?? "personalizado"}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          if (id === null) {
                            if (calendario === "fechado") setCalendario("tocou");
                            return;
                          }
                          setRascunho({ ...r, periodo: id });
                          setCalendario("fechado");
                        }}
                        className={clsx(
                          "h-ctl-lg rounded-full border px-3.5 text-dense",
                          on
                            ? "border-ink bg-nav-active font-semibold text-ink"
                            : "border-border-strong text-t1"
                        )}
                      >
                        {id === null ? ROTULO_PERSONALIZADO : ROTULO_PERIODO[id]}
                      </button>
                    );
                  })}
                </div>
                {calendario !== "fechado" && (
                  <div className="pt-1">
                    <Calendario
                      hoje={dados.hoje}
                      valor={rascunhoPersonalizado}
                      aoMudar={(i) => setRascunho({ ...r, periodo: i })}
                      grande
                      rolarAoAbrir={calendario === "tocou"}
                    />
                  </div>
                )}
              </div>
              {comparar && (
                <div className={secao}>
                  <span className={rotulo} id="cel-comparar">
                    Comparar com
                  </span>
                  <Segmentado
                    rotuloId="cel-comparar"
                    opcoes={OPCOES_COMPARACAO}
                    valor={r.comparacao}
                    grande
                    onEscolher={(c) => setRascunho({ ...r, comparacao: c })}
                  />
                  {r.comparacao === "anterior" && !faltaDia && (
                    <span className="num text-label text-t3">
                      Compara com {rotuloIntervalo(intervalosDe(dados, r.periodo).anterior)}
                    </span>
                  )}
                </div>
              )}
              <div className={secao}>
                <span className={rotulo}>Moeda do relatório</span>
                <Moedas valor={r.moeda} grande onEscolher={(m) => setRascunho({ ...r, moeda: m })} />
              </div>
            </>
          )}

          {modo.tipo === "fixo" && <p className="text-dense text-t1">{modo.texto}</p>}
          {modo.tipo === "loja" && <p className="text-dense text-t1">Esta tela usa só a loja.</p>}

          <p className="text-label text-t2">Os dias contam no {rotuloFuso(dados.fuso)}.</p>
        </div>
      </Folha>
    </>
  );
}
