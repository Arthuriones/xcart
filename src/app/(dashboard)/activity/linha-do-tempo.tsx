"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Coins,
  Download,
  History,
  Plus,
  Radio,
  Route,
  SearchIcon,
  ShoppingCart,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { gravarCookie, rotuloFuso } from "@/components/layout/contexto";
import { COOKIE_LOJA, TODAS } from "@/lib/financeiro/tipos";
import {
  DIAS_CARRINHO,
  juntarPaginas,
  opcaoTipo,
  tiposVisiveis,
  type EventoAtividade,
  type TipoAtividade,
  type TomAtividade,
} from "@/lib/leitura/atividade-regras";
import type { LeituraAtividade, PaginaAtividade } from "@/lib/leitura/atividade";
import {
  agruparPorDia,
  buscar,
  eventosTexto,
  horaCurta,
  hrefAtividade,
  relativo,
} from "./apresentar";

// ============================================================================
// A parte interativa de /activity: filtros (loja e tipo), busca, a lista
// agrupada por dia e o "Carregar mais".
//
// - Loja: e o filtro GLOBAL (cookie), o mesmo da barra do topo. Trocar aqui
//   vale para todas as telas, e o menu diz isso. Nao e um filtro paralelo.
// - Tipo: na URL (?tipo=), lido no servidor -- a paginacao segue o tipo.
// - Busca: na URL (?q=), mas so nos eventos ja carregados, e a tela diz.
// ============================================================================

const ICONE: Record<TipoAtividade, LucideIcon> = {
  loja: Store,
  importacao: Download,
  alerta: Bell,
  rastreamento: Radio,
  creditos: Coins,
  rota: Route,
  carrinho: ShoppingCart,
};

const TOM_ICONE: Record<TomAtividade, string> = {
  ok: "border-ok-border bg-ok-bg text-ok",
  warn: "border-warn-border bg-warn-bg text-warn",
  err: "border-err-border bg-err-bg text-err",
  info: "border-info-border bg-info-bg text-info",
  neutral: "border-neutral-border bg-neutral-bg text-neutral",
  run: "border-run-border bg-run-bg text-run",
};

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** "lojas", "lojas e alertas", "lojas, rotas e alertas". */
function lista(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function LinhaDoTempo({
  dados,
  qInicial,
  fuso,
}: {
  dados: LeituraAtividade;
  qInicial: string;
  fuso: string;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [itens, setItens] = useState(dados.itens);
  const [proximo, setProximo] = useState(dados.proximo);
  const [carregando, setCarregando] = useState(false);
  const [erroMais, setErroMais] = useState<string | null>(null);
  const [falhasMais, setFalhasMais] = useState<string[]>([]);
  const [anuncio, setAnuncio] = useState("");
  const [q, setQ] = useState(qInicial);
  const fimRef = useRef<HTMLParagraphElement>(null);

  const lojaAtual = dados.lojas.find((l) => l.id === dados.lojaId) ?? null;
  const tipos = tiposVisiveis(dados.temRota);
  const tipoAtual = dados.tipo ? opcaoTipo(dados.tipo) : null;
  const filtrando = Boolean(tipoAtual || lojaAtual);
  const buscando = q.trim().length > 0;

  const visiveis = useMemo(() => buscar(itens, q), [itens, q]);
  const grupos = useMemo(() => agruparPorDia(visiveis, fuso, dados.agora), [visiveis, fuso, dados.agora]);

  function mudarTipo(tipo: TipoAtividade | null) {
    if (tipo === dados.tipo) return;
    iniciar(() => router.push(hrefAtividade(tipo, q), { scroll: false }));
  }

  /** Loja: grava o filtro global e le a tela de novo. */
  function mudarLoja(id: string) {
    if (id === dados.lojaId) return;
    gravarCookie(COOKIE_LOJA, id);
    iniciar(() => router.refresh());
  }

  function limparFiltros() {
    if (lojaAtual) gravarCookie(COOKIE_LOJA, TODAS);
    iniciar(() => {
      if (dados.tipo) router.push(hrefAtividade(null, q), { scroll: false });
      else router.refresh();
    });
  }

  function mudarBusca(valor: string) {
    setQ(valor);
    window.history.replaceState(null, "", hrefAtividade(dados.tipo, valor));
  }

  async function carregarMais() {
    if (!proximo || carregando) return;
    setCarregando(true);
    setErroMais(null);
    const p = new URLSearchParams({ antes: proximo, loja: dados.lojaId });
    if (dados.tipo) p.set("tipo", dados.tipo);
    try {
      const r = await fetch(`/api/leitura/atividade?${p.toString()}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as (PaginaAtividade & { erro?: string }) | null;
      if (!r.ok || !j || !Array.isArray(j.itens)) throw new Error(j?.erro || "sem resposta");
      const juntos = juntarPaginas(itens, j.itens);
      const novos = juntos.length - itens.length;
      setItens(juntos);
      // Mesmo cursor e nada novo: parar aqui em vez de pedir a mesma pagina.
      const seguinte = novos === 0 && j.proximo === proximo ? null : j.proximo;
      setProximo(seguinte);
      setFalhasMais(Array.isArray(j.falhas) ? j.falhas : []);
      setAnuncio(
        novos === 0
          ? "Nenhum evento mais antigo."
          : `${novos === 1 ? "Mais 1 evento carregado" : `Mais ${novos} eventos carregados`}.`
      );
      if (!seguinte) setTimeout(() => fimRef.current?.focus(), 0);
    } catch {
      setErroMais("Não deu para carregar os mais antigos. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  // Primeiro uso: nada na conta e nenhum filtro. Sem barra de filtro (nao ha
  // o que filtrar) e um CTA so.
  if (itens.length === 0 && !filtrando) {
    return (
      <EmptyState
        icone={<History />}
        titulo="Nada aconteceu na conta ainda"
        descricao="Lojas, importações, alertas e compras de créditos aparecem aqui."
        acao={
          <Link href="/stores?conectar=1" className={buttonVariants({ variant: "primary" })}>
            Conectar loja
          </Link>
        }
        className="py-12"
      />
    );
  }

  const falhas = [...new Set([...dados.falhas, ...falhasMais])];
  const comCarrinho = dados.temRota && (!dados.tipo || dados.tipo === "carrinho");

  return (
    <div className="flex flex-col gap-4">
      {falhas.length > 0 ? (
        <Callout
          tom="warn"
          titulo={`Parte da atividade não veio: ${lista(falhas)}`}
          acao={
            <Button size="sm" variant="secondary" pending={pendente} onClick={() => iniciar(() => router.refresh())}>
              Tentar de novo
            </Button>
          }
        >
          O resto da lista está certo. Nada foi perdido: foi a leitura que falhou.
        </Callout>
      ) : null}

      <section aria-label="Linha do tempo" className="min-w-0 rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
          <FiltroLoja
            lojas={dados.lojas}
            atual={lojaAtual}
            onEscolher={mudarLoja}
            onLimpar={() => mudarLoja(TODAS)}
          />
          <FiltroTipo
            tipos={tipos.map((t) => ({ valor: t.id, rotulo: t.filtro }))}
            atual={tipoAtual ? { valor: tipoAtual.id, rotulo: tipoAtual.filtro } : null}
            onEscolher={(v) => mudarTipo(v as TipoAtividade)}
            onLimpar={() => mudarTipo(null)}
          />
          {filtrando ? (
            <Button variant="link" size="sm" onClick={limparFiltros}>
              Limpar filtros
            </Button>
          ) : null}
          <div className="relative w-full sm:ml-auto sm:w-64">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
            />
            <Input
              type="search"
              value={q}
              onChange={(e) => mudarBusca(e.target.value)}
              aria-label="Buscar na atividade carregada"
              placeholder="Buscar por loja, produto ou título"
              maxLength={100}
              className="h-ctl-lg pl-8 text-dense sm:h-ctl-md"
            />
          </div>
        </div>

        {buscando ? (
          <p className="border-b border-border-subtle px-4 py-2 text-label text-t2" aria-live="polite">
            {visiveis.length === 0 ? "Nenhum resultado" : `${eventosTexto(visiveis.length)} com “${q.trim()}”`} nos{" "}
            {eventosTexto(itens.length)} carregados.
            {proximo ? " Carregue mais para buscar mais para trás." : ""}
          </p>
        ) : null}

        <div
          aria-busy={pendente || undefined}
          className={cn("transition-opacity duration-150", pendente && "opacity-60")}
        >
          {itens.length === 0 ? (
            <VazioFiltrado
              tipo={tipoAtual?.id ?? null}
              loja={lojaAtual?.nome ?? null}
              onLimpar={limparFiltros}
              onTodasLojas={() => mudarLoja(TODAS)}
            />
          ) : visiveis.length === 0 ? (
            <EmptyState
              variante="simples"
              className="min-h-45"
              titulo={`Nenhum evento com “${q.trim()}”`}
              descricao="A busca olha só os eventos já carregados."
              acao={
                <Button variant="secondary" onClick={() => mudarBusca("")}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-border-subtle">
              {grupos.map((g) => (
                <section key={g.dia} aria-labelledby={`dia-${g.dia}`}>
                  <h2
                    id={`dia-${g.dia}`}
                    className="border-b border-border-subtle bg-surface-2 px-4 py-2 text-label font-semibold text-t1"
                  >
                    {g.rotulo}
                    <span className="font-normal text-t2"> · {eventosTexto(g.eventos.length)}</span>
                  </h2>
                  <ol className="divide-y divide-border-subtle">
                    {g.eventos.map((e) => (
                      <LinhaEvento key={e.id} evento={e} agora={dados.agora} fuso={fuso} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3">
          {proximo ? (
            <Button
              variant="secondary"
              pending={carregando}
              onClick={carregarMais}
              className="h-ctl-lg w-full sm:h-ctl-md sm:w-auto"
            >
              Carregar mais antigos
            </Button>
          ) : itens.length > 0 ? (
            <p ref={fimRef} tabIndex={-1} className="text-label text-t2 outline-none">
              Não há nada mais antigo.
              {comCarrinho ? ` Carrinhos ficam guardados por ${DIAS_CARRINHO} dias.` : ""}
            </p>
          ) : null}
          {erroMais ? (
            <p role="alert" className="text-label text-err">
              {erroMais}
            </p>
          ) : null}
          <p className="text-label text-t2 sm:ml-auto">Horas no {rotuloFuso(fuso)}.</p>
        </div>

        <p className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-2.5 text-label text-t2">
          <span className="rounded-full border border-border-strong px-2 font-medium">Em breve</span>
          Uso de IA e pagamentos da assinatura por cartão ainda não aparecem aqui.
        </p>
        <p className="sr-only" aria-live="polite">
          {anuncio}
        </p>
      </section>
    </div>
  );
}

function LinhaEvento({ evento: e, agora, fuso }: { evento: EventoAtividade; agora: number; fuso: string }) {
  const Icone = ICONE[e.tipo];
  const rel = relativo(e.at, agora);
  const hora = horaCurta(e.at, fuso);
  const quando = rel ? `${rel} · ${hora}` : hora;
  return (
    <li>
      <Link
        href={e.href}
        prefetch={false}
        className="group flex items-start gap-3 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span
          aria-hidden
          className={cn("grid size-8 shrink-0 place-items-center rounded-control border", TOM_ICONE[e.tom])}
        >
          <Icone className="size-4" strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-dense font-semibold text-ink">{e.titulo}</span>
            {e.selo ? <StatusBadge tom={e.selo.tom} texto={e.selo.texto} /> : null}
          </span>
          <span className="break-words text-dense text-t1 text-pretty">{e.descricao}</span>
          <span className="text-label text-t2">
            {opcaoTipo(e.tipo).rotulo}
            {e.loja ? ` · ${e.loja}` : ""}
            <span className="sm:hidden">
              {" · "}
              <time dateTime={e.at} className="num">
                {quando}
              </time>
            </span>
          </span>
        </span>
        <time dateTime={e.at} className="num hidden shrink-0 flex-col items-end pt-0.5 text-label text-t2 sm:flex">
          {rel ? <span>{rel}</span> : null}
          <span>{hora}</span>
        </time>
        <ChevronRight aria-hidden className="mt-2 hidden size-4 shrink-0 text-t3 group-hover:text-ink sm:block" />
        <span className="sr-only">. {e.destino}</span>
      </Link>
    </li>
  );
}

function VazioFiltrado({
  tipo,
  loja,
  onLimpar,
  onTodasLojas,
}: {
  tipo: TipoAtividade | null;
  loja: string | null;
  onLimpar: () => void;
  onTodasLojas: () => void;
}) {
  // Compra e da conta: com uma loja escolhida ela nunca aparece. Diz o porque.
  if (tipo === "creditos" && loja) {
    return (
      <EmptyState
        variante="simples"
        className="min-h-45"
        titulo="Créditos e plano são da conta, não de uma loja"
        descricao="Com uma loja escolhida, as compras não aparecem."
        acao={
          <Button variant="secondary" onClick={onTodasLojas}>
            Ver todas as lojas
          </Button>
        }
      />
    );
  }
  const na = loja ? ` na loja ${loja}` : "";
  return (
    <EmptyState
      variante="simples"
      className="min-h-45"
      titulo={`${tipo ? opcaoTipo(tipo).nenhum : "Nenhum evento"}${na}`}
      descricao="Tire os filtros para ver a conta inteira."
      acao={
        <Button variant="secondary" onClick={onLimpar}>
          Limpar filtros
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Chips de filtro: "+ Loja" vira "Loja: X ×". Escolha unica, em menu.
// ---------------------------------------------------------------------------

function Chip({
  rotulo,
  valor,
  onLimpar,
  rotuloLimpar,
  children,
}: {
  rotulo: string;
  /** null = sem filtro ("+ Loja"). */
  valor: string | null;
  onLimpar: () => void;
  rotuloLimpar: string;
  children: ReactNode;
}) {
  const ativo = valor !== null;
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex h-ctl-lg max-w-64 items-center gap-1 whitespace-nowrap border text-dense sm:h-ctl-sm",
            ativo
              ? "rounded-l-full border-info-border bg-info-bg pr-2 pl-3 text-info sm:pl-2.5"
              : "rounded-full border-dashed border-control-border px-3 text-t1 hover:border-border-strong hover:text-ink sm:px-2.5",
            FOCO
          )}
        >
          {ativo ? (
            <span className="truncate">
              {rotulo}: <strong className="font-semibold">{valor}</strong>
            </span>
          ) : (
            <>
              <Plus aria-hidden className="size-3.5" />
              {rotulo}
            </>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-16px)]">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {ativo ? (
        <button
          type="button"
          aria-label={rotuloLimpar}
          onClick={onLimpar}
          className={cn(
            "grid h-ctl-lg w-11 place-items-center rounded-r-full border border-l-0 border-info-border bg-info-bg text-info hover:bg-hover sm:h-ctl-sm sm:w-7",
            FOCO
          )}
        >
          <X aria-hidden className="size-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}

function FiltroLoja({
  lojas,
  atual,
  onEscolher,
  onLimpar,
}: {
  lojas: { id: string; nome: string }[];
  atual: { id: string; nome: string } | null;
  onEscolher: (id: string) => void;
  onLimpar: () => void;
}) {
  const ordenadas = useMemo(() => [...lojas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [lojas]);
  return (
    <Chip
      rotulo="Loja"
      valor={atual?.nome ?? null}
      onLimpar={onLimpar}
      rotuloLimpar={`Tirar o filtro da loja ${atual?.nome ?? ""} (vale para todas as telas)`}
    >
      <DropdownMenuGroup>
        <DropdownMenuLabel>Vale para todas as telas</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={atual?.id ?? TODAS} onValueChange={(v) => onEscolher(String(v))}>
          <DropdownMenuRadioItem value={TODAS} closeOnClick>
            Todas as lojas
          </DropdownMenuRadioItem>
          {ordenadas.map((l) => (
            <DropdownMenuRadioItem key={l.id} value={l.id} closeOnClick className="[overflow-wrap:anywhere]">
              {l.nome}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </Chip>
  );
}

function FiltroTipo({
  tipos,
  atual,
  onEscolher,
  onLimpar,
}: {
  tipos: { valor: string; rotulo: string }[];
  atual: { valor: string; rotulo: string } | null;
  onEscolher: (valor: string) => void;
  onLimpar: () => void;
}) {
  return (
    <Chip rotulo="Tipo" valor={atual?.rotulo ?? null} onLimpar={onLimpar} rotuloLimpar="Tirar o filtro de tipo">
      <DropdownMenuRadioGroup
        value={atual?.valor ?? "todos"}
        onValueChange={(v) => (v === "todos" ? onLimpar() : onEscolher(String(v)))}
      >
        <DropdownMenuRadioItem value="todos" closeOnClick>
          Todos os tipos
        </DropdownMenuRadioItem>
        {tipos.map((t) => (
          <DropdownMenuRadioItem key={t.valor} value={t.valor} closeOnClick>
            {t.rotulo}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </Chip>
  );
}
