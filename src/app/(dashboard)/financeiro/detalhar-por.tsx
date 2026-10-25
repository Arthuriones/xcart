"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Download, Search, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { Dica } from "@/components/ui/dica";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { alternarCriterio, ordenarLinhas, type CriterioOrdem, type DirecaoOrdem } from "@/components/ui/tabela";
import { diaCurto, gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA, TODAS, type Intervalo } from "@/lib/financeiro/tipos";
// So tipos: o calculo e as leituras nao entram no bundle do navegador.
import type { LinhaDia, LinhaLoja, Semaforo, Totais } from "@/lib/financeiro/calculo";
import type { PorProduto } from "@/lib/leitura/por-produto";
import type { LinhaCampanha } from "@/lib/leitura/por-campanha";
import {
  SEMAFORO,
  diaDaSemana,
  dinheiro,
  inteiro,
  montarCsv,
  nomeDaLoja,
  porcento,
  temMovimento,
  trilhaSparkline,
  vezes,
  type ValorCsv,
} from "./lucro-dados";

// ============================================================================
// "Detalhar por": Loja · Dia · Produto · Campanha (mockup "design novo/
// Dashboard.dc.html"). Cada aba e uma tabela que ordena pelo titulo da
// coluna, com busca, contagem e o CSV da tabela visivel, gerado aqui no
// navegador (#19). No celular (< 760px) a tabela vira cartoes.
// ============================================================================

export type Aba = "loja" | "dia" | "produto" | "campanha";

type Situacao = Semaforo | "sem-acesso";

const SITUACAO: Record<Situacao, { tom: TomStatus; texto: string }> = {
  ...SEMAFORO,
  "sem-acesso": { tom: "neutral", texto: "Sem acesso" },
};

/** Cor da barra de margem: a do selo da loja. */
const BARRA_TOM: Record<TomStatus, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
  neutral: "bg-neutral",
  run: "bg-run",
};

/** A margem que enche a barra: 40% ou mais e barra cheia. */
const MARGEM_CHEIA = 0.4;

/** Coluna da tabela + como ela sai no CSV (numero cru, sem "R$"). */
type Coluna<T> = {
  chave: string;
  titulo: ReactNode;
  tituloCsv?: string;
  /** Numero sempre a direita, tabular. */
  alinhar?: "direita";
  /** Padrao: ordenavel. */
  ordenavel?: boolean;
  /** Direcao do primeiro clique. Padrao: desc para numero, asc para texto. */
  direcaoInicial?: DirecaoOrdem;
  celula: (l: T) => ReactNode;
  csv: (l: T) => ValorCsv;
  /** No cartao do celular: fora dele, como selo no canto ou como linha sob o titulo. */
  cartao?: "fora" | "selo" | "sub";
  className?: string;
};

export interface LojaDetalhe {
  linha: LinhaLoja;
  /** A Shopify nega ler os pedidos desta loja. */
  semAcesso: boolean;
  /** Lucro por dia no periodo (sparkline). null = a serie nao carregou. */
  lucroPorDia: number[] | null;
}

function Sparkline({ valores, negativo }: { valores: number[]; negativo: boolean }) {
  const d = trilhaSparkline(valores, 80, 24);
  if (!d) return <span className="text-t3">—</span>;
  return (
    <svg viewBox="0 0 80 24" width={80} height={24} aria-hidden className="inline-block overflow-visible align-middle">
      <path
        d={d}
        fill="none"
        className={negativo ? "stroke-err" : "stroke-t2"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 rounded-sm border border-border px-1.5 text-label font-normal text-t2">{children}</span>
  );
}

/**
 * Texto com a explicacao no (i). Fora de titulo de coluna ordenavel: ali o
 * titulo ja e um botao, e a Dica e outro.
 */
function ComDica({ titulo, rotulo, children }: { titulo: string; rotulo: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {titulo}
      <Dica rotulo={rotulo}>{children}</Dica>
    </span>
  );
}

function ErroSecao({ detalhe }: { detalhe: string | null }) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <div role="alert" className="flex min-h-70 flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
      <TriangleAlert aria-hidden className="size-6 text-err" strokeWidth={1.75} />
      <p className="text-section text-ink">Não conseguimos carregar o detalhamento</p>
      <p className="max-w-110 text-dense text-t2">Os indicadores acima estão certos.</p>
      <Button
        variant="secondary"
        pending={tentando}
        onClick={() => startTransition(() => router.refresh())}
        className="min-w-35"
      >
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
      {detalhe && (
        <details className="text-label text-t3">
          <summary className="cursor-pointer">Ver detalhes</summary>
          <p className="mt-1.5 max-w-110 break-words font-mono">{detalhe}</p>
        </details>
      )}
    </div>
  );
}

function linkLoja(nome: string, dominio: string, onEscolher: () => void) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <button
        type="button"
        onClick={onEscolher}
        aria-label={`Ver só ${nome} em todas as telas`}
        className="group/loja inline-flex max-w-60 items-center gap-1 truncate rounded-sm text-left text-dense font-semibold text-ink hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="truncate">{nome}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-t4 group-hover/loja:text-ink" strokeWidth={2} />
      </button>
      <span className="max-w-60 truncate font-mono text-label font-normal text-t3">{dominio}</span>
    </span>
  );
}

/** Margem com a barra na celula: largura = margem / 40%, cor do selo. */
function MargemComBarra({ margem, tom, negativo }: { margem: number | null; tom: TomStatus; negativo: boolean }) {
  const cheio = Math.max(0, Math.min(1, (margem ?? 0) / MARGEM_CHEIA)) * 100;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span aria-hidden className="relative h-1 w-11 overflow-hidden rounded-xs bg-track">
        <span className={clsx("absolute inset-y-0 left-0 rounded-xs", BARRA_TOM[tom])} style={{ width: `${cheio}%` }} />
      </span>
      <span className={negativo ? "text-err" : undefined}>{porcento(margem)}</span>
    </span>
  );
}

/**
 * A tabela de uma aba: cabecalho em surface-2, linhas de 44px, numero a
 * direita e tabular, total no pe, ordenar pelo titulo (aria-sort). Abaixo de
 * 760px vira cartoes: a primeira coluna e o titulo.
 */
function Tabela<T extends Record<string, unknown>>({
  legenda,
  colunas,
  linhas,
  ordemInicial = [],
  rodape,
}: {
  legenda: string;
  colunas: Coluna<T>[];
  linhas: T[];
  ordemInicial?: CriterioOrdem[];
  rodape?: Partial<Record<string, ReactNode>>;
}) {
  const [criterios, setCriterios] = useState<CriterioOrdem[]>(ordemInicial);
  const ordenadas = ordenarLinhas(linhas, criterios, (l, chave) => l[chave]);
  const [primeira, ...demais] = colunas;
  const selo = demais.find((c) => c.cartao === "selo");
  const sub = demais.find((c) => c.cartao === "sub");
  const campos = demais.filter((c) => !c.cartao);
  const ativa = criterios[0];

  function ordenar(c: Coluna<T>) {
    const inicial = c.direcaoInicial ?? (c.alinhar === "direita" ? "desc" : "asc");
    setCriterios((atual) => alternarCriterio(atual, c.chave, false, inicial));
  }

  return (
    <>
      <div
        role="region"
        aria-label={legenda}
        tabIndex={0}
        className="hidden overflow-x-auto border-t border-border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus min-[760px]:block"
      >
        <table className="w-full border-separate border-spacing-0 text-dense">
          <caption className="sr-only">{legenda}. Clique no título de uma coluna para ordenar.</caption>
          <thead>
            <tr>
              {colunas.map((c, i) => {
                const ordenavel = c.ordenavel !== false;
                const on = ordenavel && ativa?.chave === c.chave;
                const direita = c.alinhar === "direita";
                const Icone = on ? (ativa.direcao === "desc" ? ArrowDown : ArrowUp) : ChevronsUpDown;
                return (
                  <th
                    key={c.chave}
                    scope="col"
                    aria-sort={on ? (ativa.direcao === "desc" ? "descending" : "ascending") : undefined}
                    className={clsx(
                      "h-9 border-b border-border bg-surface-2 px-3 text-label font-medium whitespace-nowrap",
                      direita ? "text-right" : "text-left",
                      on ? "text-ink" : "text-t2",
                      i === 0 && "sticky left-0 z-[2]",
                      c.className
                    )}
                  >
                    {ordenavel ? (
                      <button
                        type="button"
                        onClick={() => ordenar(c)}
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-sm py-1 text-left font-medium hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          direita && "flex-row-reverse text-right"
                        )}
                      >
                        {c.titulo}
                        <Icone aria-hidden className={clsx("size-3 shrink-0", !on && "opacity-40")} strokeWidth={2} />
                      </button>
                    ) : (
                      c.titulo
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((l, li) => (
              <tr key={String(l.id ?? li)} className="group/linha">
                {colunas.map((c, i) => {
                  const Celula = i === 0 ? "th" : "td";
                  return (
                    <Celula
                      key={c.chave}
                      scope={i === 0 ? "row" : undefined}
                      className={clsx(
                        "h-11 border-b border-border-subtle bg-surface px-3 font-normal whitespace-nowrap text-ink group-hover/linha:bg-surface-2",
                        c.alinhar === "direita" ? "num text-right" : "text-left",
                        i === 0 && "sticky left-0 z-[1]",
                        c.className
                      )}
                    >
                      {c.celula(l)}
                    </Celula>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {rodape && (
            <tfoot>
              <tr>
                {colunas.map((c, i) => (
                  <td
                    key={c.chave}
                    className={clsx(
                      "h-11 border-t border-border bg-surface-2 px-3 font-semibold whitespace-nowrap text-ink",
                      c.alinhar === "direita" ? "num text-right" : "text-left",
                      i === 0 && "sticky left-0 z-[1]"
                    )}
                  >
                    {rodape[c.chave] ?? null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ul aria-label={legenda} className="flex flex-col gap-2 px-3 pb-3 min-[760px]:hidden">
        {ordenadas.map((l, li) => (
          <li key={String(l.id ?? li)} className="rounded-card border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col text-body font-semibold text-ink">
                {primeira.celula(l)}
                {sub && <span className="text-label font-normal text-t3">{sub.celula(l)}</span>}
              </div>
              {selo && <span className="shrink-0">{selo.celula(l)}</span>}
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {campos.map((c) => (
                <div key={c.chave} className="flex min-w-0 flex-col">
                  <dt className="text-label text-t3">{c.tituloCsv ?? c.titulo}</dt>
                  <dd className={clsx("min-w-0 text-body text-ink", c.alinhar === "direita" && "num")}>{c.celula(l)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {rodape && (
          <li className="rounded-card border border-border bg-surface-2 p-3">
            <div className="text-body font-semibold text-ink">{rodape[primeira.chave] ?? "Total"}</div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
              {campos
                .filter((c) => rodape[c.chave] != null)
                .map((c) => (
                  <div key={c.chave} className="flex flex-col">
                    <dt className="text-label text-t3">{c.tituloCsv ?? c.titulo}</dt>
                    <dd className="num text-body font-semibold text-ink">{rodape[c.chave]}</dd>
                  </div>
                ))}
            </dl>
          </li>
        )}
      </ul>
    </>
  );
}

export function DetalharPor({
  moeda,
  intervalo,
  rotuloLoja,
  mostrarLoja,
  lojas,
  total,
  dias,
  produtos,
  campanhas,
  erroExtras,
}: {
  moeda: string;
  intervalo: Intervalo;
  /** "Todas as lojas" ou o nome da escolhida (vai para o CSV). */
  rotuloLoja: string;
  /** Aba Loja: com "Todas as lojas" e 2 ou mais lojas. */
  mostrarLoja: boolean;
  lojas: LojaDetalhe[];
  total: Totais;
  /** Do mais novo para o mais antigo. */
  dias: LinhaDia[];
  /** null = a leitura falhou. */
  produtos: PorProduto | null;
  campanhas: LinhaCampanha[] | null;
  /** Mensagem tecnica da leitura que falhou, para o suporte. */
  erroExtras: string | null;
}) {
  const router = useRouter();
  const [trocando, startTransition] = useTransition();
  const [aba, setAba] = useState<Aba>(mostrarLoja ? "loja" : "dia");
  const [busca, setBusca] = useState("");
  const [situacoes, setSituacoes] = useState<Situacao[]>([]);
  const [ordemProduto, setOrdemProduto] = useState<"mais" | "menos">("mais");
  const [semAcessoAberto, setSemAcessoAberto] = useState(false);

  const abaAtual: Aba = aba === "loja" && !mostrarLoja ? "dia" : aba;
  const termo = busca.trim().toLowerCase();
  const movimento = temMovimento({
    receita: total.receita,
    cmv: total.cmv,
    gastoMeta: total.gastoMeta,
    gastoGoogle: total.gastoGoogle,
    pedidos: total.pedidos,
  });

  function trocarAba(v: Aba) {
    setAba(v);
    setBusca("");
    setSituacoes([]);
  }

  function entrarNaLoja(id: string, nome: string) {
    // O mesmo cookie do seletor do topo: vale para todas as telas, e o topo
    // mostra o chip da loja com o "x" para voltar.
    gravarCookie(COOKIE_LOJA, id);
    startTransition(() => router.refresh());
    toast(`Mostrando só ${nome}`, {
      description: "Vale para todas as telas. Para voltar, use o x ao lado do nome da loja no topo.",
      action: {
        label: "Ver todas",
        onClick: () => {
          gravarCookie(COOKIE_LOJA, TODAS);
          startTransition(() => router.refresh());
        },
      },
    });
  }

  const corLucro = (v: number | null) => (v !== null && v < 0 ? "text-err" : undefined);
  const din = (v: number | null) => dinheiro(v, moeda);

  // --- Loja -------------------------------------------------------------------
  type LinhaLojaT = {
    id: string;
    nome: string;
    dominio: string;
    situacao: Situacao;
    pedidos: number;
    receita: number;
    gasto: number;
    roas: number | null;
    eq: number | null;
    lucro: number;
    margem: number | null;
    lpp: number | null;
    tendencia: number[] | null;
  };
  const comMovimento = (l: LinhaLoja) =>
    l.receita !== 0 || l.gasto !== 0 || l.pedidos !== 0 || l.cmv !== 0;
  // Loja sem acesso e parada sai da tabela e vai para a lista de baixo; a que
  // vendeu no periodo fica, com o selo "Sem acesso" (os pedidos lidos antes
  // continuam no total).
  const lojasForaDaTabela = lojas.filter((l) => l.semAcesso && !comMovimento(l.linha));
  const linhasLoja: LinhaLojaT[] = lojas
    .filter((l) => !(l.semAcesso && !comMovimento(l.linha)))
    .map(({ linha: l, semAcesso, lucroPorDia }) => ({
      id: l.storeId,
      nome: nomeDaLoja(l),
      dominio: l.dominio,
      situacao: semAcesso ? "sem-acesso" : l.semaforo,
      pedidos: l.pedidos,
      receita: l.receita,
      gasto: l.gasto,
      roas: l.roas,
      eq: l.roasEquilibrio,
      lucro: l.lucro,
      margem: l.margem,
      lpp: l.pedidos > 0 ? l.lucro / l.pedidos : null,
      tendencia: lucroPorDia,
    }));
  const colunasLoja: Coluna<LinhaLojaT>[] = [
    {
      chave: "nome",
      titulo: "Loja",
      celula: (l) => linkLoja(l.nome, l.dominio, () => entrarNaLoja(l.id, l.nome)),
      csv: (l) => l.nome,
    },
    {
      chave: "situacao",
      titulo: (
        <ComDica titulo="Situação" rotulo="O que cada situação quer dizer">
          <span className="flex flex-col gap-1">
            <span>Lucro: ROAS real pelo menos 1,2× o ROAS de equilíbrio.</span>
            <span>No limite: tem lucro, mas o ROAS real está abaixo de 1,2× o equilíbrio.</span>
            <span>Prejuízo: o lucro estimado está negativo.</span>
            <span>Sem gasto: nenhum anúncio no período.</span>
            <span>Sem acesso: os pedidos novos não estão sendo lidos.</span>
          </span>
        </ComDica>
      ),
      tituloCsv: "Situação",
      ordenavel: false,
      cartao: "selo",
      celula: (l) => <StatusBadge tom={SITUACAO[l.situacao].tom} texto={SITUACAO[l.situacao].texto} />,
      csv: (l) => SITUACAO[l.situacao].texto,
    },
    { chave: "pedidos", titulo: "Pedidos", alinhar: "direita", celula: (l) => inteiro(l.pedidos), csv: (l) => l.pedidos },
    { chave: "receita", titulo: "Faturamento", alinhar: "direita", celula: (l) => din(l.receita), csv: (l) => l.receita },
    { chave: "gasto", titulo: "Gasto", alinhar: "direita", celula: (l) => din(l.gasto), csv: (l) => l.gasto },
    { chave: "roas", titulo: "ROAS real", alinhar: "direita", celula: (l) => vezes(l.roas), csv: (l) => l.roas },
    {
      chave: "eq",
      titulo: "ROAS de equilíbrio",
      alinhar: "direita",
      celula: (l) => <span className="text-t2">{vezes(l.eq)}</span>,
      csv: (l) => l.eq,
    },
    {
      chave: "lucro",
      titulo: "Lucro estimado",
      alinhar: "direita",
      celula: (l) => <span className={clsx("font-semibold", corLucro(l.lucro))}>{din(l.lucro)}</span>,
      csv: (l) => l.lucro,
    },
    {
      chave: "margem",
      titulo: "Margem",
      alinhar: "direita",
      celula: (l) => (
        <MargemComBarra margem={l.margem} tom={SITUACAO[l.situacao].tom} negativo={l.margem !== null && l.margem < 0} />
      ),
      csv: (l) => (l.margem === null ? null : l.margem * 100),
      tituloCsv: "Margem (%)",
    },
    {
      chave: "lpp",
      titulo: "Lucro por pedido",
      alinhar: "direita",
      celula: (l) => <span className={corLucro(l.lpp)}>{din(l.lpp)}</span>,
      csv: (l) => l.lpp,
    },
    {
      chave: "tendencia",
      titulo: "Tendência",
      alinhar: "direita",
      ordenavel: false,
      cartao: "fora",
      celula: (l) => (l.tendencia ? <Sparkline valores={l.tendencia} negativo={l.lucro < 0} /> : <span className="text-t3">—</span>),
      csv: () => null,
    },
  ];
  const rodapeLoja = {
    nome: (
      <span className="flex flex-col">
        <span>Todas as lojas</span>
        <span className="text-label font-normal text-t3">{linhasLoja.length} na tabela · somadas</span>
      </span>
    ),
    pedidos: inteiro(total.pedidos),
    receita: din(total.receita),
    gasto: din(total.gasto),
    roas: vezes(total.roas),
    eq: vezes(total.roasEquilibrio),
    lucro: <span className={corLucro(total.lucro)}>{din(total.lucro)}</span>,
    margem: porcento(total.margem),
    lpp: din(total.pedidos > 0 ? total.lucro / total.pedidos : null),
  };

  // --- Dia --------------------------------------------------------------------
  type LinhaDiaT = {
    id: string;
    dia: string;
    semana: string;
    parcial: boolean;
    pedidos: number;
    receita: number;
    cmv: number;
    taxas: number;
    meta: number;
    google: number;
    lucro: number;
    roas: number | null;
  };
  const linhasDia: LinhaDiaT[] = dias.map((d) => ({
    id: d.dia,
    dia: d.dia,
    semana: diaDaSemana(d.dia),
    parcial: d.parcial,
    pedidos: d.pedidos,
    receita: d.receita,
    cmv: d.cmv,
    taxas: d.taxas,
    meta: d.gastoMeta,
    google: d.gastoGoogle,
    lucro: d.lucro,
    roas: d.roas,
  }));
  const colunasDia: Coluna<LinhaDiaT>[] = [
    {
      chave: "dia",
      titulo: "Dia",
      direcaoInicial: "desc",
      celula: (l) => (
        <span className="num font-medium">
          {diaCurto(l.dia)}
          {l.parcial && <Etiqueta>hoje · parcial</Etiqueta>}
        </span>
      ),
      csv: (l) => l.dia,
    },
    {
      chave: "semana",
      titulo: "Dia da semana",
      ordenavel: false,
      cartao: "sub",
      celula: (l) => <span className="text-t2">{l.semana}</span>,
      csv: (l) => l.semana,
    },
    { chave: "pedidos", titulo: "Pedidos", alinhar: "direita", celula: (l) => inteiro(l.pedidos), csv: (l) => l.pedidos },
    { chave: "receita", titulo: "Faturamento", alinhar: "direita", celula: (l) => din(l.receita), csv: (l) => l.receita },
    { chave: "cmv", titulo: "Produtos + frete", alinhar: "direita", celula: (l) => <span className="text-t1">{din(l.cmv)}</span>, csv: (l) => l.cmv },
    { chave: "taxas", titulo: "Taxas", alinhar: "direita", celula: (l) => <span className="text-t1">{din(l.taxas)}</span>, csv: (l) => l.taxas },
    { chave: "meta", titulo: "Meta", alinhar: "direita", celula: (l) => <span className="text-t1">{din(l.meta)}</span>, csv: (l) => l.meta },
    { chave: "google", titulo: "Google", alinhar: "direita", celula: (l) => <span className="text-t1">{din(l.google)}</span>, csv: (l) => l.google },
    {
      chave: "lucro",
      titulo: "Lucro estimado",
      alinhar: "direita",
      celula: (l) => <span className={clsx("font-semibold", corLucro(l.lucro))}>{din(l.lucro)}</span>,
      csv: (l) => l.lucro,
    },
    { chave: "roas", titulo: "ROAS real", alinhar: "direita", celula: (l) => vezes(l.roas), csv: (l) => l.roas },
  ];
  const rodapeDia = {
    dia: "Total do período",
    pedidos: inteiro(total.pedidos),
    receita: din(total.receita),
    cmv: din(total.cmv),
    taxas: din(total.taxas),
    meta: din(total.gastoMeta),
    google: din(total.gastoGoogle),
    lucro: <span className={corLucro(total.lucro)}>{din(total.lucro)}</span>,
    roas: vezes(total.roas),
  };

  // --- Produto ----------------------------------------------------------------
  type LinhaProdutoT = {
    id: string;
    sku: string;
    lojas: number;
    unidades: number;
    receita: number;
    custo: number | null;
    estimado: boolean;
    lucro: number | null;
    margem: number | null;
  };
  const linhasProduto: LinhaProdutoT[] = (produtos?.linhas ?? []).map((p) => ({
    id: p.sku || "\u0000sem-sku",
    sku: p.sku,
    lojas: p.lojas,
    unidades: p.unidades,
    receita: p.receita,
    custo: p.custo,
    estimado: p.custoEstimado,
    lucro: p.lucro,
    margem: p.margem,
  }));
  const colunasProduto: Coluna<LinhaProdutoT>[] = [
    {
      chave: "sku",
      titulo: "Produto (SKU)",
      celula: (l) => (
        <span className="flex flex-col">
          {l.sku ? (
            <span className="font-mono font-medium text-ink">{l.sku}</span>
          ) : (
            <span className="font-medium text-t1">Item sem SKU</span>
          )}
          {l.lojas > 1 && <span className="text-label font-normal text-t3">vendido em {l.lojas} lojas</span>}
        </span>
      ),
      csv: (l) => l.sku || "(sem SKU)",
      tituloCsv: "SKU",
    },
    { chave: "unidades", titulo: "Unidades", alinhar: "direita", celula: (l) => inteiro(l.unidades), csv: (l) => l.unidades },
    { chave: "receita", titulo: "Receita", alinhar: "direita", celula: (l) => din(l.receita), csv: (l) => l.receita },
    {
      chave: "custo",
      titulo: "Produto + frete",
      alinhar: "direita",
      celula: (l) =>
        l.custo === null ? (
          <StatusBadge tom="warn">Sem custo</StatusBadge>
        ) : (
          <span className="whitespace-nowrap text-t1">
            {din(l.custo)}
            {l.estimado && <Etiqueta>estimado</Etiqueta>}
          </span>
        ),
      csv: (l) => l.custo,
    },
    {
      chave: "lucro",
      titulo: "Lucro antes do anúncio",
      alinhar: "direita",
      celula: (l) => <span className={clsx("font-semibold", corLucro(l.lucro))}>{din(l.lucro)}</span>,
      csv: (l) => l.lucro,
    },
    {
      chave: "margem",
      titulo: "Margem antes do anúncio",
      alinhar: "direita",
      celula: (l) => <span className={corLucro(l.lucro)}>{porcento(l.margem)}</span>,
      csv: (l) => (l.margem === null ? null : l.margem * 100),
      tituloCsv: "Margem antes do anúncio (%)",
    },
  ];

  // --- Campanha ---------------------------------------------------------------
  type LinhaCampanhaT = {
    id: string;
    nome: string;
    conta: string;
    plataforma: string;
    semCotacao: boolean;
    gasto: number;
    impressoes: number;
    cliques: number;
    compras: number;
    valor: number;
    roasPlataforma: number | null;
    roasLoja: number | null;
  };
  const roasPorLoja = new Map(lojas.map((l) => [l.linha.storeId, l.linha.roas]));
  const linhasCampanha: LinhaCampanhaT[] = (campanhas ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    conta: c.contaNome,
    plataforma: c.plataforma === "google" ? "Google" : "Meta",
    semCotacao: c.semCotacao,
    gasto: c.gasto,
    impressoes: c.impressoes,
    cliques: c.cliques,
    compras: c.compras,
    valor: c.valorCompras,
    roasPlataforma: c.roasPlataforma,
    roasLoja: c.storeId ? (roasPorLoja.get(c.storeId) ?? null) : null,
  }));
  const colunasCampanha: Coluna<LinhaCampanhaT>[] = [
    {
      chave: "nome",
      titulo: "Campanha",
      celula: (l) => (
        <span className="flex max-w-72 flex-col">
          <span className="truncate font-medium text-ink">{l.nome}</span>
          <span className="truncate text-label font-normal text-t3">
            {l.conta}
            {l.semCotacao ? " · parte do gasto sem cotação" : ""}
          </span>
        </span>
      ),
      csv: (l) => l.nome,
    },
    {
      chave: "plataforma",
      titulo: "Plataforma",
      cartao: "selo",
      celula: (l) => (
        <StatusBadge tom={l.plataforma === "Meta" ? "info" : "neutral"} ponto={false}>
          {l.plataforma}
        </StatusBadge>
      ),
      csv: (l) => l.plataforma,
    },
    { chave: "gasto", titulo: "Gasto", alinhar: "direita", celula: (l) => din(l.gasto), csv: (l) => l.gasto },
    { chave: "impressoes", titulo: "Impressões", alinhar: "direita", celula: (l) => inteiro(l.impressoes), csv: (l) => l.impressoes },
    { chave: "cliques", titulo: "Cliques", alinhar: "direita", celula: (l) => inteiro(l.cliques), csv: (l) => l.cliques },
    { chave: "compras", titulo: "Compras (plataforma)", alinhar: "direita", celula: (l) => inteiro(l.compras), csv: (l) => l.compras },
    { chave: "valor", titulo: "Valor (plataforma)", alinhar: "direita", celula: (l) => din(l.valor), csv: (l) => l.valor },
    {
      chave: "roasPlataforma",
      titulo: "ROAS da plataforma",
      alinhar: "direita",
      celula: (l) => <span className="text-t1">{vezes(l.roasPlataforma)}</span>,
      csv: (l) => l.roasPlataforma,
    },
    {
      chave: "roasLoja",
      titulo: "ROAS real da loja",
      alinhar: "direita",
      celula: (l) => <span className="font-semibold">{vezes(l.roasLoja)}</span>,
      csv: (l) => l.roasLoja,
    },
  ];
  const somaCampanhas = linhasCampanha.reduce(
    (t, c) => ({
      gasto: t.gasto + c.gasto,
      impressoes: t.impressoes + c.impressoes,
      cliques: t.cliques + c.cliques,
      compras: t.compras + c.compras,
      valor: t.valor + c.valor,
    }),
    { gasto: 0, impressoes: 0, cliques: 0, compras: 0, valor: 0 }
  );
  const rodapeCampanha = {
    nome: (
      <span className="flex flex-col">
        <span>Todas as campanhas</span>
        <span className="text-label font-normal text-t3">
          {linhasCampanha.length} com gasto no período
        </span>
      </span>
    ),
    gasto: din(somaCampanhas.gasto),
    impressoes: inteiro(somaCampanhas.impressoes),
    cliques: inteiro(somaCampanhas.cliques),
    compras: inteiro(somaCampanhas.compras),
    valor: din(somaCampanhas.valor),
    roasPlataforma: vezes(somaCampanhas.gasto > 0 ? somaCampanhas.valor / somaCampanhas.gasto : null),
  };

  // --- Filtro da aba ativa ----------------------------------------------------
  const casa = (texto: string) => !termo || texto.toLowerCase().includes(termo);
  const filtradas = {
    loja: linhasLoja.filter(
      (l) => casa(`${l.nome} ${l.dominio}`) && (situacoes.length === 0 || situacoes.includes(l.situacao))
    ),
    dia: linhasDia.filter((l) => casa(`${l.dia} ${diaCurto(l.dia)} ${l.semana}`)),
    produto: linhasProduto.filter((l) => casa(l.sku || "sem sku")),
    campanha: linhasCampanha.filter((l) => casa(`${l.nome} ${l.conta} ${l.plataforma}`)),
  };

  const filtroAtivo = termo !== "" || situacoes.length > 0;
  function limparFiltros() {
    setBusca("");
    setSituacoes([]);
  }

  const TITULO_CSV: Record<Aba, string> = {
    loja: "Lucro por loja",
    dia: "Lucro dia a dia",
    produto: "Lucro antes do anúncio por produto",
    campanha: "Desempenho por campanha",
  };

  function exportar() {
    const [colunas, linhas]: [Coluna<never>[], Record<string, unknown>[]] =
      abaAtual === "loja"
        ? [colunasLoja as Coluna<never>[], filtradas.loja]
        : abaAtual === "dia"
          ? [colunasDia as Coluna<never>[], filtradas.dia]
          : abaAtual === "produto"
            ? [colunasProduto as Coluna<never>[], filtradas.produto]
            : [colunasCampanha as Coluna<never>[], filtradas.campanha];
    const usadas = colunas.filter((c) => c.chave !== "tendencia");
    const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
    const csv = montarCsv(
      [TITULO_CSV[abaAtual], rotuloLoja, `${dataBr(intervalo.desde)} a ${dataBr(intervalo.ate)}`, `Valores em ${moeda}`],
      usadas.map((c) => c.tituloCsv ?? (typeof c.titulo === "string" ? c.titulo : c.chave)),
      linhas.map((l) => usadas.map((c) => c.csv(l as never)))
    );
    const arquivo = `lucro-${abaAtual}-${intervalo.desde}-a-${intervalo.ate}.csv`;
    // BOM: sem ele o Excel abre UTF-8 como Latin-1 e estraga o acento.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = arquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("CSV pronto", {
      description: `${arquivo}\n${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"} em ${moeda}, com loja e período na primeira linha.`,
    });
  }

  // --- Pecas da aba -----------------------------------------------------------
  const ROTULO_BUSCA: Record<Aba, string> = {
    loja: "Buscar loja",
    dia: "Buscar data",
    produto: "Buscar SKU",
    campanha: "Buscar campanha",
  };
  const NOME: Record<Aba, [string, string]> = {
    loja: ["loja", "lojas"],
    dia: ["dia", "dias"],
    produto: ["SKU", "SKUs"],
    campanha: ["campanha", "campanhas"],
  };

  function barra(mostradas: number, todas: number) {
    const [um, varios] = NOME[abaAtual];
    return (
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative min-w-45 max-w-70 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
            strokeWidth={1.75}
          />
          <Input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label={ROTULO_BUSCA[abaAtual]}
            placeholder={ROTULO_BUSCA[abaAtual]}
            className="h-ctl-md pl-8 text-dense"
          />
        </div>
        {abaAtual === "loja" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={clsx(
                "inline-flex h-ctl-md items-center gap-1.5 rounded-full border px-3 text-dense whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                situacoes.length
                  ? "border-info-border bg-info-bg text-info"
                  : "border-dashed border-control-border text-t1 hover:text-ink"
              )}
            >
              {situacoes.length ? `Situação: ${situacoes.map((s) => SITUACAO[s].texto).join(", ")}` : "+ Situação"}
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {(Object.keys(SITUACAO) as Situacao[]).map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={situacoes.includes(s)}
                  closeOnClick={false}
                  onCheckedChange={(marcado) =>
                    setSituacoes((atual) => (marcado ? [...atual, s] : atual.filter((x) => x !== s)))
                  }
                >
                  <StatusBadge tom={SITUACAO[s].tom} texto={SITUACAO[s].texto} />
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {filtroAtivo && (
          <Button variant="link" size="sm" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        )}
        {abaAtual === "produto" && (
          <Segmented
            rotulo="Ordem"
            valor={ordemProduto}
            onValorChange={setOrdemProduto}
            opcoes={[
              { valor: "mais", rotulo: "Mais lucrativos" },
              { valor: "menos", rotulo: "Menos lucrativos" },
            ]}
          />
        )}
        <span className="flex-1" />
        <span className="whitespace-nowrap text-label text-t3">
          {filtroAtivo ? `${mostradas} de ${todas} ${varios}` : `${todas} ${todas === 1 ? um : varios}`}
        </span>
        <Button variant="secondary" size="md" onClick={exportar} aria-label="Exportar esta tabela em CSV" className="px-2.5">
          <Download aria-hidden className="size-3.5" />
          CSV
        </Button>
      </div>
    );
  }

  const semLinhaComFiltro = (
    <EmptyState
      variante="simples"
      titulo="Nenhuma linha com esses filtros"
      descricao="Mude a busca ou a situação escolhida."
      acao={
        <Button variant="secondary" onClick={limparFiltros}>
          Limpar filtros
        </Button>
      }
      className="min-h-50 border-t border-border-subtle"
    />
  );
  const semPedido = (
    <EmptyState
      variante="simples"
      titulo="Nenhum pedido no período"
      descricao="Os pedidos aparecem até 15 minutos depois da venda."
      className="min-h-60"
    />
  );

  function nota(texto: ReactNode) {
    return <p className="border-t border-border-subtle px-4 py-2.5 text-label text-t3 text-pretty">{texto}</p>;
  }

  function tabela<T extends Record<string, unknown>>(opcoes: {
    legenda: string;
    colunas: Coluna<T>[];
    todas: T[];
    linhas: T[];
    ordem?: CriterioOrdem[];
    rodapeTabela?: Partial<Record<string, ReactNode>>;
    chave?: string;
    vazio: ReactNode;
  }) {
    // Sem nenhuma linha nao ha o que buscar nem exportar: so o vazio.
    if (opcoes.todas.length === 0) return opcoes.vazio;
    if (opcoes.linhas.length === 0) {
      return (
        <>
          {barra(0, opcoes.todas.length)}
          {semLinhaComFiltro}
        </>
      );
    }
    // Titulo de numero com mais de uma palavra quebra em duas linhas: a celula
    // e um valor so (o "R$" vem com espaco inquebravel), e a tabela cabe
    // inteira em 1280px sem rolar de lado.
    const colunas = opcoes.colunas.map((c) =>
      c.alinhar === "direita" && typeof c.titulo === "string" && c.titulo.includes(" ")
        ? { ...c, className: clsx("whitespace-normal", c.className) }
        : c
    );
    return (
      <>
        {barra(opcoes.linhas.length, opcoes.todas.length)}
        <Tabela
          key={opcoes.chave}
          legenda={opcoes.legenda}
          colunas={colunas}
          linhas={opcoes.linhas}
          ordemInicial={opcoes.ordem}
          rodape={filtroAtivo ? undefined : opcoes.rodapeTabela}
        />
      </>
    );
  }

  const conteudo: Record<Aba, () => ReactNode> = {
    loja: () => (
      <>
        {tabela({
          legenda: "Lucro por loja no período",
          colunas: colunasLoja,
          todas: movimento ? linhasLoja : [],
          linhas: filtradas.loja,
          ordem: [{ chave: "lucro", direcao: "desc" }],
          rodapeTabela: rodapeLoja,
          vazio: semPedido,
        })}
        {lojasForaDaTabela.length > 0 && (
          <div className="border-t border-border">
            <button
              type="button"
              aria-expanded={semAcessoAberto}
              aria-controls="lojas-sem-acesso"
              onClick={() => setSemAcessoAberto((a) => !a)}
              className="flex min-h-ctl-lg w-full items-center gap-2.5 rounded-b-card bg-surface-2 px-4 text-left text-dense text-t1 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <ChevronRight
                aria-hidden
                className={clsx("size-3.5 shrink-0 transition-transform duration-150", semAcessoAberto && "rotate-90")}
                strokeWidth={2}
              />
              <span>
                <strong className="font-semibold text-ink">
                  {lojasForaDaTabela.length} {lojasForaDaTabela.length === 1 ? "loja sem acesso" : "lojas sem acesso"}
                </strong>{" "}
                · sem pedidos lidos no período, fora da tabela.
              </span>
            </button>
            {semAcessoAberto && (
              <ul id="lojas-sem-acesso">
                {lojasForaDaTabela.map(({ linha: l }) => (
                  <li
                    key={l.storeId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle py-2.5 pr-4 pl-10"
                  >
                    <span className="flex min-w-45 flex-1 flex-col">
                      <span className="text-dense text-ink">{nomeDaLoja(l)}</span>
                      <span className="font-mono text-label text-t3">{l.dominio}</span>
                    </span>
                    <StatusBadge tom="neutral">Sem acesso aos pedidos</StatusBadge>
                    <Link
                      href="/stores"
                      className="rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      Reconectar ou remover
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </>
    ),
    dia: () =>
      tabela({
        legenda: "Lucro dia a dia",
        colunas: colunasDia,
        todas: movimento ? linhasDia : [],
        linhas: filtradas.dia,
        // A ordem em que a aba abre (do dia mais novo), com a seta e o
        // aria-sort no "Dia": o primeiro clique inverte, nao repete.
        ordem: [{ chave: "dia", direcao: "desc" }],
        rodapeTabela: rodapeDia,
        vazio: semPedido,
      }),
    produto: () =>
      produtos === null ? (
        <ErroSecao detalhe={erroExtras} />
      ) : (
        <>
          {tabela({
            legenda: "Lucro antes do anúncio por produto",
            colunas: colunasProduto,
            todas: linhasProduto,
            linhas: filtradas.produto,
            ordem: [{ chave: "lucro", direcao: ordemProduto === "mais" ? "desc" : "asc" }],
            chave: ordemProduto,
            vazio: semPedido,
          })}
          {linhasProduto.length > 0 &&
            nota(
              "Antes do anúncio: o gasto do Meta e do Google não é por produto, então aqui sai só produto, frete e taxa. A receita do pedido é dividida entre os itens pelo preço de cada um."
            )}
          {produtos.receitaSemItem > 0 &&
            nota(`${dinheiro(produtos.receitaSemItem, moeda)} de pedidos sem item (só frete ou ajuste) ficam de fora.`)}
        </>
      ),
    campanha: () =>
      campanhas === null ? (
        <ErroSecao detalhe={erroExtras} />
      ) : (
        <>
          {tabela({
            legenda: "Desempenho por campanha",
            colunas: colunasCampanha,
            todas: linhasCampanha,
            linhas: filtradas.campanha,
            ordem: [{ chave: "gasto", direcao: "desc" }],
            rodapeTabela: rodapeCampanha,
            vazio: (
              <EmptyState
                variante="simples"
                titulo="Nenhuma campanha com gasto no período"
                descricao="O gasto por campanha chega com as contas do Meta e o script do Google."
                className="min-h-60"
              />
            ),
          })}
          {linhasCampanha.length > 0 &&
            nota("Compras e valor são os que a própria plataforma reporta. O ROAS real da loja usa os pedidos da Shopify.")}
        </>
      ),
  };

  const ABAS: { id: Aba; rotulo: string }[] = [
    ...(mostrarLoja ? [{ id: "loja" as const, rotulo: "Loja" }] : []),
    { id: "dia", rotulo: "Dia" },
    { id: "produto", rotulo: "Produto" },
    { id: "campanha", rotulo: "Campanha" },
  ];

  return (
    <section
      aria-labelledby="detalhar-t"
      aria-busy={trocando || undefined}
      className={clsx("min-w-0 rounded-card border border-border bg-surface transition-opacity", trocando && "opacity-60")}
    >
      <Tabs value={abaAtual} onValueChange={(v) => trocarAba(v as Aba)} className="gap-0">
        <div className="flex flex-wrap items-end gap-x-5 border-b border-border px-4">
          <h2 id="detalhar-t" className="py-3.5 text-section text-ink">
            Detalhar por
          </h2>
          <TabsList
            variant="line"
            aria-labelledby="detalhar-t"
            className="max-w-full gap-4.5 overflow-x-auto border-b-0 [scrollbar-width:none]"
          >
            {ABAS.map((a) => (
              <TabsTrigger key={a.id} value={a.id} className="h-[47px]! px-0.5">
                {a.rotulo}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {ABAS.map((a) => (
          <TabsContent key={a.id} value={a.id}>
            {abaAtual === a.id ? conteudo[a.id]() : null}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
