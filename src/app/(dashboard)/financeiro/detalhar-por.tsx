"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Download, Info, Search, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
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
import { caminhoSparkline } from "@/components/ui/grafico";
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
  vezes,
  type ValorCsv,
} from "./lucro-dados";

// ============================================================================
// "Detalhar por": Loja · Dia · Produto · Campanha · Pais. Cada aba e uma
// DataTable (ordena, Shift + clique desempata, vira cartao no celular) com
// busca, densidade e CSV da tabela visivel, gerado aqui no navegador (#19).
// ============================================================================

export type Aba = "loja" | "dia" | "produto" | "campanha" | "pais";

type Situacao = Semaforo | "sem-acesso";

const SITUACAO: Record<Situacao, { tom: TomStatus; texto: string }> = {
  ...SEMAFORO,
  "sem-acesso": { tom: "neutral", texto: "Sem acesso" },
};

/** Coluna da tabela + como ela sai no CSV (numero cru, sem "R$"). */
type Coluna<T> = ColunaTabela<T> & { csv: (l: T) => ValorCsv; tituloCsv?: string };

export interface LojaDetalhe {
  linha: LinhaLoja;
  /** A Shopify nega ler os pedidos desta loja. */
  semAcesso: boolean;
  /** Lucro por dia no periodo (sparkline). null = a serie nao carregou. */
  lucroPorDia: number[] | null;
}

function Sparkline({ valores, negativo }: { valores: number[]; negativo: boolean }) {
  if (valores.length < 2) return <span className="text-t3">—</span>;
  return (
    <svg viewBox="0 0 80 24" width={80} height={24} aria-hidden className="inline-block align-middle">
      <path
        d={caminhoSparkline(valores, 80, 24, 2)}
        fill="none"
        className={negativo ? "stroke-err" : "stroke-t1"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Etiqueta({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 rounded-sm border border-border px-1 text-label font-normal text-t2">{children}</span>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-control border border-info-border bg-info-bg px-3 py-2.5 text-dense text-ink">
      <Info aria-hidden className="mt-px size-4 shrink-0 text-info" strokeWidth={1.75} />
      <div className="flex flex-col gap-1 text-pretty">{children}</div>
    </div>
  );
}

function ErroSecao({ detalhe }: { detalhe: string | null }) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <div role="alert" className="flex min-h-70 flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
      <TriangleAlert aria-hidden className="size-6 text-err" strokeWidth={1.75} />
      <p className="text-section text-ink">Não conseguimos carregar o detalhamento</p>
      <p className="max-w-110 text-dense text-t1">
        Os indicadores e o gráfico acima estão certos. Tente de novo em alguns segundos.
      </p>
      <Button pending={tentando} onClick={() => startTransition(() => router.refresh())} className="min-w-35">
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
      {detalhe && (
        <details className="text-label text-t2">
          <summary className="cursor-pointer">Detalhes para o suporte</summary>
          <p className="mt-1.5 max-w-110 break-words font-mono">{detalhe}</p>
        </details>
      )}
    </div>
  );
}

function linkLoja(nome: string, dominio: string, onEscolher: () => void) {
  return (
    <span className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={onEscolher}
        aria-label={`Ver só ${nome} em todas as telas`}
        className="group/loja inline-flex max-w-60 items-center gap-1 truncate rounded-sm text-left font-semibold text-ink hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="truncate">{nome}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-t3 group-hover/loja:text-ink" />
      </button>
      <span className="truncate font-mono text-label font-normal text-t2">{dominio}</span>
    </span>
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
  const [densidade, setDensidade] = useState<"compacta" | "confortavel">("compacta");
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
  const corLucro = (v: number | null) => (v !== null && v < 0 ? "text-err" : undefined);
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
        <span className="inline-flex items-center gap-1">
          Situação
          <Dica rotulo="O que cada situação quer dizer">
            <span className="flex flex-col gap-1">
              <span>Lucro: ROAS real pelo menos 1,2× o ROAS de equilíbrio.</span>
              <span>No limite: tem lucro, mas o ROAS real está abaixo de 1,2× o equilíbrio.</span>
              <span>Prejuízo: o lucro estimado está negativo.</span>
              <span>Sem gasto: nenhum anúncio no período.</span>
              <span>Sem acesso: a Shopify não deixa ler os pedidos novos.</span>
            </span>
          </Dica>
        </span>
      ),
      tituloCsv: "Situação",
      ordenavel: false,
      celula: (l) => <StatusBadge tom={SITUACAO[l.situacao].tom} texto={SITUACAO[l.situacao].texto} />,
      csv: (l) => SITUACAO[l.situacao].texto,
    },
    { chave: "pedidos", titulo: "Pedidos", alinhar: "direita", celula: (l) => inteiro(l.pedidos), csv: (l) => l.pedidos },
    { chave: "receita", titulo: "Faturamento", alinhar: "direita", celula: (l) => dinheiro(l.receita, moeda), csv: (l) => l.receita },
    { chave: "gasto", titulo: "Gasto", alinhar: "direita", celula: (l) => dinheiro(l.gasto, moeda), csv: (l) => l.gasto },
    { chave: "roas", titulo: "ROAS real", alinhar: "direita", celula: (l) => vezes(l.roas), csv: (l) => l.roas },
    {
      chave: "eq",
      titulo: "ROAS de equilíbrio",
      alinhar: "direita",
      celula: (l) => <span className="text-t1">{vezes(l.eq)}</span>,
      csv: (l) => l.eq,
    },
    {
      chave: "lucro",
      titulo: "Lucro estimado",
      alinhar: "direita",
      celula: (l) => <span className={clsx("font-semibold", corLucro(l.lucro))}>{dinheiro(l.lucro, moeda)}</span>,
      csv: (l) => l.lucro,
    },
    {
      chave: "margem",
      titulo: "Margem",
      alinhar: "direita",
      celula: (l) => <span className={corLucro(l.lucro)}>{porcento(l.margem)}</span>,
      csv: (l) => (l.margem === null ? null : l.margem * 100),
      tituloCsv: "Margem (%)",
    },
    {
      chave: "lpp",
      titulo: "Lucro por pedido",
      alinhar: "direita",
      celula: (l) => <span className={corLucro(l.lpp)}>{dinheiro(l.lpp, moeda)}</span>,
      csv: (l) => l.lpp,
    },
    {
      chave: "tendencia",
      titulo: "Tendência",
      alinhar: "direita",
      ordenavel: false,
      ocultarNoCartao: true,
      celula: (l) => (l.tendencia ? <Sparkline valores={l.tendencia} negativo={l.lucro < 0} /> : <span className="text-t3">—</span>),
      csv: () => null,
    },
  ];
  const rodapeLoja = {
    nome: (
      <span className="flex flex-col">
        <span>Todas as lojas</span>
        <span className="text-label font-normal text-t2">{linhasLoja.length} na tabela · somadas</span>
      </span>
    ),
    pedidos: inteiro(total.pedidos),
    receita: dinheiro(total.receita, moeda),
    gasto: dinheiro(total.gasto, moeda),
    roas: vezes(total.roas),
    eq: vezes(total.roasEquilibrio),
    lucro: <span className={corLucro(total.lucro)}>{dinheiro(total.lucro, moeda)}</span>,
    margem: porcento(total.margem),
    lpp: dinheiro(total.pedidos > 0 ? total.lucro / total.pedidos : null, moeda),
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
  const din = (v: number | null) => dinheiro(v, moeda);
  const colunasDia: Coluna<LinhaDiaT>[] = [
    {
      chave: "dia",
      titulo: "Dia",
      direcaoInicial: "desc",
      celula: (l) => (
        <span className="num">
          {diaCurto(l.dia)}
          {l.parcial && <Etiqueta>hoje · parcial</Etiqueta>}
        </span>
      ),
      csv: (l) => l.dia,
    },
    { chave: "semana", titulo: "Dia da semana", ordenavel: false, celula: (l) => <span className="text-t1">{l.semana}</span>, csv: (l) => l.semana },
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
          {l.lojas > 1 && <span className="text-label font-normal text-t2">vendido em {l.lojas} lojas</span>}
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
          <span className="truncate text-label font-normal text-t2">
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
      celula: (l) => <StatusBadge tom={l.plataforma === "Meta" ? "info" : "neutral"}>{l.plataforma}</StatusBadge>,
      csv: (l) => l.plataforma,
    },
    { chave: "gasto", titulo: "Gasto", alinhar: "direita", celula: (l) => din(l.gasto), csv: (l) => l.gasto },
    { chave: "impressoes", titulo: "Impressões", alinhar: "direita", celula: (l) => inteiro(l.impressoes), csv: (l) => l.impressoes },
    { chave: "cliques", titulo: "Cliques", alinhar: "direita", celula: (l) => inteiro(l.cliques), csv: (l) => l.cliques },
    { chave: "compras", titulo: "Compras (plataforma)", alinhar: "direita", celula: (l) => inteiro(l.compras), csv: (l) => l.compras },
    { chave: "valor", titulo: "Valor (plataforma)", alinhar: "direita", celula: (l) => din(l.valor), csv: (l) => l.valor },
    { chave: "roasPlataforma", titulo: "ROAS da plataforma", alinhar: "direita", celula: (l) => vezes(l.roasPlataforma), csv: (l) => l.roasPlataforma },
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
    nome: "Todas as campanhas",
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

  const TITULO_CSV: Record<Exclude<Aba, "pais">, string> = {
    loja: "Lucro por loja",
    dia: "Lucro dia a dia",
    produto: "Lucro antes do anúncio por produto",
    campanha: "Desempenho por campanha",
  };

  function exportar() {
    if (abaAtual === "pais") return;
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
    pais: "",
  };

  const barra = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <div className="relative min-w-48 max-w-72 flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-t3" strokeWidth={1.75} />
        <Input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label={ROTULO_BUSCA[abaAtual]}
          placeholder={ROTULO_BUSCA[abaAtual]}
          className="h-ctl-sm pl-8 text-dense"
        />
      </div>
      {abaAtual === "loja" && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={clsx(
              "inline-flex h-ctl-sm items-center gap-1.5 rounded-full border px-3 text-dense focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
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
      <span className="hidden text-label text-t2 xl:inline">Shift + clique ordena por mais de uma coluna</span>
      <Segmented
        className="hidden sm:inline-flex"
        rotulo="Densidade"
        valor={densidade}
        onValorChange={setDensidade}
        opcoes={[
          { valor: "compacta", rotulo: "Compacta" },
          { valor: "confortavel", rotulo: "Confortável" },
        ]}
      />
      <Button variant="secondary" size="sm" onClick={exportar} aria-label="Exportar esta tabela em CSV">
        <Download aria-hidden />
        CSV
      </Button>
    </div>
  );

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

  function rodape(texto: ReactNode) {
    return (
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-border-subtle px-4 py-2.5 text-label text-t2">
        <span>{texto}</span>
        <span>Valores em {moeda} · convertidos pela cotação de cada dia</span>
      </div>
    );
  }

  function tabela<T extends Record<string, unknown>>(opcoes: {
    legenda: string;
    colunas: Coluna<T>[];
    todas: T[];
    linhas: T[];
    ordem?: { chave: string; direcao: "asc" | "desc" }[];
    rodapeTabela?: Partial<Record<string, ReactNode>>;
    chave?: string;
    vazio: ReactNode;
  }) {
    // Sem nenhuma linha nao ha o que buscar nem exportar: so o vazio.
    if (opcoes.todas.length === 0) return opcoes.vazio;
    if (opcoes.linhas.length === 0) {
      return (
        <>
          {barra}
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
        {barra}
        <div className="border-t border-border">
          <DataTable
            key={opcoes.chave}
            legenda={opcoes.legenda}
            colunas={colunas}
            linhas={opcoes.linhas}
            ordenacaoInicial={opcoes.ordem}
            densidade={densidade}
            rodape={filtroAtivo ? undefined : opcoes.rodapeTabela}
          />
        </div>
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
              className="flex min-h-ctl-lg w-full items-center gap-2.5 bg-surface-2 px-4 text-left text-dense text-t1 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <ChevronRight aria-hidden className={clsx("size-3.5 shrink-0 transition-transform", semAcessoAberto && "rotate-90")} />
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
                    className="flex flex-wrap items-center gap-3 border-t border-border-subtle py-2.5 pl-10 pr-4"
                  >
                    <span className="flex min-w-44 flex-1 flex-col">
                      <span className="text-dense text-ink">{nomeDaLoja(l)}</span>
                      <span className="font-mono text-label text-t2">{l.dominio}</span>
                    </span>
                    <StatusBadge tom="neutral">A Shopify não deixa ler os pedidos</StatusBadge>
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
        {rodape("Clique no nome de uma loja para ver só ela em todas as telas.")}
      </>
    ),
    dia: () => (
      <>
        {tabela({
          legenda: "Lucro dia a dia",
          colunas: colunasDia,
          todas: movimento ? linhasDia : [],
          linhas: filtradas.dia,
          rodapeTabela: rodapeDia,
          vazio: semPedido,
        })}
        {rodape("O dia de hoje está incompleto até a meia-noite. Cada dia segue o fuso da loja.")}
      </>
    ),
    produto: () =>
      produtos === null ? (
        <ErroSecao detalhe={erroExtras} />
      ) : (
        <>
          <Aviso>
            <span>
              <strong className="font-semibold">Lucro antes do anúncio.</strong> O gasto do Meta e do Google
              não é por produto, então esta aba desconta só produto, frete e taxa.
            </span>
            <span className="text-t1">Nome e foto do produto ainda não aparecem: o pedido guarda só o SKU.</span>
          </Aviso>
          {tabela({
            legenda: "Lucro antes do anúncio por produto",
            colunas: colunasProduto,
            todas: linhasProduto,
            linhas: filtradas.produto,
            ordem: [{ chave: "lucro", direcao: ordemProduto === "mais" ? "desc" : "asc" }],
            chave: ordemProduto,
            vazio: semPedido,
          })}
          {rodape(
            <>
              SKU sem custo aparece como “—” e não entra na margem. A receita do pedido é dividida entre os itens
              pelo preço de cada um.
              {produtos.receitaSemItem > 0 &&
                ` ${dinheiro(produtos.receitaSemItem, moeda)} de pedidos sem item (só frete ou ajuste) ficam de fora.`}
            </>
          )}
        </>
      ),
    campanha: () =>
      campanhas === null ? (
        <ErroSecao detalhe={erroExtras} />
      ) : (
        <>
          <Aviso>
            <span>
              Compras e valor são os que a própria plataforma reporta. O ROAS real da loja usa os pedidos da
              Shopify, para você comparar.
            </span>
          </Aviso>
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
          {rodape("Lucro por campanha depende de ligar cada pedido à campanha: ainda não existe.")}
        </>
      ),
    pais: () => (
      <EmptyState
        variante="simples"
        selo="Em breve"
        titulo="Lucro por país ainda não existe"
        descricao="O pedido sincronizado ainda não guarda o país do comprador."
        className="min-h-60"
      />
    ),
  };

  const ABAS: { id: Aba; rotulo: string; emBreve?: boolean }[] = [
    ...(mostrarLoja ? [{ id: "loja" as const, rotulo: "Loja" }] : []),
    { id: "dia", rotulo: "Dia" },
    { id: "produto", rotulo: "Produto" },
    { id: "campanha", rotulo: "Campanha" },
    { id: "pais", rotulo: "País", emBreve: true },
  ];

  return (
    <section
      aria-labelledby="detalhar-t"
      aria-busy={trocando || undefined}
      className={clsx("min-w-0 rounded-card border border-border bg-surface transition-opacity", trocando && "opacity-60")}
    >
      <Tabs value={abaAtual} onValueChange={(v) => trocarAba(v as Aba)} className="gap-0">
        <div className="flex flex-wrap items-end gap-x-4 border-b border-border px-4 pt-1">
          <h2 id="detalhar-t" className="py-3 text-dense font-semibold text-t1">
            Detalhar por
          </h2>
          <TabsList variant="line" aria-labelledby="detalhar-t" className="max-w-full overflow-x-auto border-b-0 [scrollbar-width:none]">
            {ABAS.map((a) => (
              <TabsTrigger key={a.id} value={a.id} className="h-11 px-1">
                {a.rotulo}
                {a.emBreve && (
                  <span className="rounded-sm border border-border px-1 text-label font-normal text-t2">Em breve</span>
                )}
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
