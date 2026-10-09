"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Download,
  ExternalLink,
  Receipt,
  Search,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatarDinheiro } from "@/lib/financeiro/tipos";
import type { EstadoEnvio, PedidoTela, ResumoPedidos, TomPedido } from "@/lib/leitura/pedidos";
import { montarCsv } from "../financeiro/lucro-dados";
import { Logo } from "../tracking/logos";
import {
  CABECALHO_CSV,
  FILTROS,
  FILTROS_COD,
  POR_PAGINA,
  buscaCasa,
  corEnvio,
  jornadaDoPedido,
  linhaCsv,
  passaNoFiltro,
  passaNoFiltroCod,
  textoCsv,
  textoEnvio,
  type FiltroCod,
  type FiltroId,
} from "./filtros";

// ============================================================================
// Tela Pedidos (mockup "design novo/2.0/Pedidos.dc.html"). Os numeros chegam
// prontos do servidor (src/lib/leitura/pedidos.ts); aqui so busca, filtro,
// pagina, o painel do pedido e o CSV.
// ============================================================================

const fmtPct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
/** Para baixo: 249 de 250 e "99,6%", nunca "100%" escondendo a falha. */
const pctParaBaixo = (r: number) => fmtPct.format(Math.floor(r * 1000) / 1000);

const COR_PONTO: Record<ReturnType<typeof corEnvio>, string> = {
  ok: "bg-ok",
  err: "bg-err",
  neutro: "bg-t3",
  apagado: "bg-border-strong",
};

const COR_TOM: Record<TomPedido, string> = {
  ok: "bg-ok",
  err: "bg-err",
  warn: "bg-warn",
  info: "bg-info",
  neutral: "bg-t3",
};

export function PedidosTela({
  pedidos,
  resumo,
  moeda,
  contextoCsv,
  arquivoCsv,
}: {
  pedidos: PedidoTela[];
  resumo: ResumoPedidos;
  moeda: string;
  /** Loja, periodo e moeda: a primeira linha do CSV. */
  contextoCsv: string[];
  arquivoCsv: string;
}) {
  const [filtro, setFiltro] = useState<FiltroId>("todos");
  const [filtroCod, setFiltroCod] = useState<FiltroCod>("todos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  // O painel fecha sem limpar `aberto`: o conteudo fica durante a saida.
  const [aberto, setAberto] = useState<string | null>(null);
  const [painel, setPainel] = useState(false);

  const dinheiro = (v: number | null) => (v === null ? "—" : formatarDinheiro(v, moeda, 2));

  const contagem = useMemo(() => {
    const c = {} as Record<FiltroId, number>;
    for (const f of FILTROS) c[f.id] = pedidos.filter((p) => passaNoFiltro(p, f.id)).length;
    return c;
  }, [pedidos]);
  const contagemCod = useMemo(() => {
    const c = {} as Record<FiltroCod, number>;
    for (const f of FILTROS_COD) c[f.id] = pedidos.filter((p) => passaNoFiltroCod(p, f.id)).length;
    return c;
  }, [pedidos]);
  // Sem contra entrega no periodo, o filtro nem aparece.
  const filtros = FILTROS.filter((f) => f.id !== "contra_entrega" || contagem.contra_entrega > 0);

  const lista = useMemo(
    () =>
      pedidos.filter(
        (p) =>
          passaNoFiltro(p, filtro) &&
          (filtro !== "contra_entrega" || passaNoFiltroCod(p, filtroCod)) &&
          buscaCasa(p, busca)
      ),
    [pedidos, filtro, filtroCod, busca]
  );
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = lista.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const selecionado = aberto ? (pedidos.find((p) => p.chave === aberto) ?? null) : null;
  const filtrado = filtro !== "todos" || busca.trim() !== "";

  function abrir(chave: string) {
    setAberto(chave);
    setPainel(true);
  }

  function escolher(f: FiltroId) {
    setFiltro(f);
    setFiltroCod("todos");
    setPagina(0);
  }

  function limpar() {
    setFiltro("todos");
    setFiltroCod("todos");
    setBusca("");
    setPagina(0);
  }

  function exportar() {
    const csv = montarCsv(contextoCsv.map((c) => textoCsv(c) ?? ""), CABECALHO_CSV, lista.map(linhaCsv));
    // BOM: sem ele o Excel abre UTF-8 como Latin-1 e estraga o acento.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = arquivoCsv;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("CSV pronto", {
      description: `${arquivoCsv}\n${lista.length} ${lista.length === 1 ? "pedido" : "pedidos"} em ${moeda}`,
    });
  }

  const avisoFaturamento = [
    resumo.semCotacao
      ? `${resumo.semCotacao} ${resumo.semCotacao === 1 ? "pedido" : "pedidos"} sem cotação fora da soma`
      : null,
    resumo.cambioAproximado ? "Câmbio aproximado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const kpis: { rotulo: string; valor: string; icone: ReactNode; detalhe?: string }[] = [
    { rotulo: "Pedidos", valor: new Intl.NumberFormat("pt-BR").format(resumo.pedidos), icone: <Receipt /> },
    {
      rotulo: "Faturamento",
      valor: dinheiro(resumo.faturamento),
      icone: <DollarSign />,
      detalhe:
        [
          resumo.codAbertos > 0
            ? `+ ${dinheiro(resumo.aReceber)} a receber (${resumo.codAbertos} contra entrega)`
            : null,
          avisoFaturamento || null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    },
    {
      rotulo: "Lucro antes do anúncio",
      valor: dinheiro(resumo.lucro),
      icone: <TrendingUp />,
      detalhe: resumo.semCusto
        ? `${resumo.semCusto} ${resumo.semCusto === 1 ? "pedido" : "pedidos"} com SKU sem custo`
        : undefined,
    },
    {
      rotulo: "Compras rastreadas",
      valor: resumo.rastreadas === null ? "—" : pctParaBaixo(resumo.rastreadas),
      icone: <Check />,
      detalhe: resumo.rastreadas === null ? "Nenhuma compra do período para o Meta" : "Chegaram ao Meta",
    },
  ];

  return (
    <div data-largura="total" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="hidden text-page font-semibold text-ink md:block">Pedidos</h1>
        <Button variant="secondary" onClick={exportar} disabled={!lista.length}>
          <Download aria-hidden />
          Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.rotulo} className="flex items-center gap-3.5 rounded-overlay border border-border bg-surface p-4.5">
            <span
              aria-hidden
              className="hidden size-9 shrink-0 place-items-center rounded-full bg-info-bg text-info sm:grid lg:hidden xl:grid [&_svg]:size-4.5"
            >
              {k.icone}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-dense text-t1">{k.rotulo}</span>
              <span className="num whitespace-nowrap text-[clamp(16px,1.4vw,20px)] leading-7 font-bold text-ink">
                {k.valor}
              </span>
              {k.detalhe && <span className="text-label text-t2">{k.detalhe}</span>}
            </span>
          </div>
        ))}
      </div>

      <section aria-label="Lista de pedidos" className="min-w-0 rounded-overlay border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3.5">
          <div className="relative min-w-50 max-w-75 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-t2"
              strokeWidth={1.75}
            />
            <Input
              type="search"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setPagina(0);
              }}
              aria-label="Buscar pedido ou SKU"
              placeholder="Buscar #pedido ou SKU"
              className="pl-8 text-dense"
            />
          </div>
          <div
            role="group"
            aria-label="Filtrar"
            className="flex max-w-full gap-0.5 overflow-x-auto rounded-card border border-border bg-surface-2 p-0.75 [scrollbar-width:none]"
          >
            {filtros.map((f) => {
              const on = filtro === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => escolher(f.id)}
                  className={cn(
                    "h-7 whitespace-nowrap rounded-control px-2.5 text-label focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                    on ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--border)]" : "text-t2 hover:text-ink"
                  )}
                >
                  {f.rotulo} <span className="num">{contagem[f.id]}</span>
                </button>
              );
            })}
          </div>
          {filtro === "contra_entrega" && (
            <div role="group" aria-label="Situação do contra entrega" className="flex w-full flex-wrap gap-1.5">
              {FILTROS_COD.filter((f) => f.id === "todos" || contagemCod[f.id] > 0 || filtroCod === f.id).map((f) => {
                const on = filtroCod === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setFiltroCod(f.id);
                      setPagina(0);
                    }}
                    className={cn(
                      "h-7 whitespace-nowrap rounded-control border px-2.5 text-label focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                      on ? "border-ink bg-surface font-semibold text-ink" : "border-border text-t2 hover:text-ink"
                    )}
                  >
                    {f.rotulo} <span className="num">{contagemCod[f.id]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {lista.length === 0 ? (
          <EmptyState
            variante="simples"
            className="min-h-60"
            titulo={filtrado && pedidos.length ? "Nenhum pedido com esse filtro" : "Nenhum pedido no período"}
            descricao={
              filtrado && pedidos.length
                ? "Mude a busca ou o filtro."
                : "Os pedidos aparecem até 15 minutos depois da venda."
            }
            acao={
              filtrado && pedidos.length ? (
                <Button variant="secondary" onClick={limpar}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-dense">
                <caption className="sr-only">Pedidos do período</caption>
                <thead>
                  <tr className="text-label text-t2">
                    {[
                      ["Pedido", "left"],
                      ["Data", "left"],
                      ["Loja", "left"],
                      ["Itens", "left"],
                      ["Origem", "left"],
                      ["Valor pago", "right"],
                      ["Lucro estimado", "right"],
                      ["Rastreamento", "left"],
                      ["Envio", "left"],
                    ].map(([rotulo, lado]) => (
                      <th
                        key={rotulo}
                        scope="col"
                        className={cn(
                          "h-10 whitespace-nowrap border-b border-border px-3.5 font-medium",
                          lado === "right" ? "text-right" : "text-left"
                        )}
                      >
                        {rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr
                      key={p.chave}
                      onClick={() => abrir(p.chave)}
                      className={cn(
                        "cursor-pointer hover:bg-hover [&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3.5",
                        painel && aberto === p.chave && "bg-hover"
                      )}
                    >
                      <td className="h-14 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrir(p.chave);
                          }}
                          aria-label={`Abrir pedido ${p.nome}`}
                          className="rounded-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          {p.nome}
                        </button>
                      </td>
                      <td className="num whitespace-nowrap text-t1">{p.quando}</td>
                      <td className="whitespace-nowrap">{p.loja}</td>
                      <td className="max-w-55 truncate text-t1" title={p.itensTexto}>
                        {p.itensTexto}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-t1">
                          {(p.origem.id === "meta" || p.origem.id === "google") && (
                            <Logo marca={p.origem.id} tamanho={14} />
                          )}
                          {p.origem.rotulo}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap text-right">{dinheiro(p.valores?.valorPago ?? null)}</td>
                      <td
                        className={cn(
                          "num whitespace-nowrap text-right font-semibold",
                          p.valores?.lucro == null ? "text-t2" : p.valores.lucro < 0 ? "text-err" : "text-ink"
                        )}
                      >
                        {dinheiro(p.valores?.lucro ?? null)}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex gap-2.5">
                          <PontoEnvio marca="meta" estado={p.meta} />
                          <PontoEnvio marca="google" estado={p.google} />
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <StatusBadge tom={p.status.tom}>{p.status.rotulo}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="flex flex-col gap-2 p-3 md:hidden">
              {visiveis.map((p) => (
                <li key={p.chave}>
                  <button
                    type="button"
                    onClick={() => abrir(p.chave)}
                    className="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="flex w-full justify-between gap-2">
                      <span className="flex min-w-0 flex-col">
                        <strong className="text-body">
                          {p.nome} · {p.loja}
                        </strong>
                        <span className="text-label text-t2">
                          {p.quando} · {p.origem.rotulo}
                        </span>
                      </span>
                      <StatusBadge tom={p.status.tom}>{p.status.rotulo}</StatusBadge>
                    </span>
                    <span className="num flex w-full justify-between text-dense">
                      <span className="text-t1">{dinheiro(p.valores?.valorPago ?? null)}</span>
                      <strong
                        className={cn(
                          p.valores?.lucro == null ? "text-t2" : p.valores.lucro < 0 ? "text-err" : "text-ink"
                        )}
                      >
                        {dinheiro(p.valores?.lucro ?? null)}
                      </strong>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-label text-t2">
              <span className="num">
                {atual * POR_PAGINA + 1}–{atual * POR_PAGINA + visiveis.length} de {lista.length}{" "}
                {lista.length === 1 ? "pedido" : "pedidos"} · valores em {moeda}
              </span>
              <span className="flex gap-1.5">
                <Button
                  variant="secondary"
                  size="icon-sm"
                  aria-label="Página anterior"
                  disabled={atual === 0}
                  onClick={() => setPagina(atual - 1)}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  aria-label="Próxima página"
                  disabled={atual >= paginas - 1}
                  onClick={() => setPagina(atual + 1)}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </span>
            </div>
          </>
        )}
      </section>

      <Sheet open={painel && !!selecionado} onOpenChange={(v) => !v && setPainel(false)}>
        <SheetContent side="right" size="md">
          {selecionado && <DetalhePedido p={selecionado} dinheiro={dinheiro} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PontoEnvio({ marca, estado }: { marca: "meta" | "google"; estado: EstadoEnvio }) {
  const cor = corEnvio(estado);
  const texto = textoEnvio(marca === "meta" ? "Meta" : "Google", estado);
  return (
    <span className="inline-flex items-center gap-1" title={texto}>
      <Logo marca={marca} tamanho={13} className={cor === "apagado" ? "opacity-35" : undefined} />
      <span aria-hidden className={cn("size-1.5 rounded-full", COR_PONTO[cor])} />
      <span className="sr-only">{texto}</span>
    </span>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  destaque,
  cor,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  destaque?: boolean;
  cor?: string;
}) {
  return (
    <div
      className={cn(
        "num flex justify-between gap-3 border-b border-border-subtle px-3.5 py-2.5 text-dense last:border-b-0",
        destaque && "bg-surface-2"
      )}
    >
      <span className={cn(forte || destaque ? "font-semibold text-ink" : "text-t1")}>{rotulo}</span>
      <span className={cn(forte || destaque ? "font-semibold" : "", cor ?? "text-ink")}>{valor}</span>
    </div>
  );
}

function DetalhePedido({ p, dinheiro }: { p: PedidoTela; dinheiro: (v: number | null) => string }) {
  const v = p.valores;
  const menos = (x: number) => (x > 0 ? `−${dinheiro(x)}` : dinheiro(0));
  // Imposto incluso, gorjeta e alfandega: o que separa Produtos + Frete -
  // Desconto do Valor pago. Sem esta linha a conta nao fecha.
  // Pedido sem pagamento recebido: Valor pago 0 nao e "imposto" do pedido inteiro.
  const outros = v && p.pago ? v.produtos + v.frete - v.desconto - v.valorPago : 0;
  const jornada = jornadaDoPedido(p, (x) => dinheiro(x));
  return (
    <>
      <SheetHeader className="gap-1.5 pl-5">
        <span className="flex flex-wrap items-center gap-2.5">
          <SheetTitle className="text-overlay font-semibold">{p.nome}</SheetTitle>
          <StatusBadge tom={p.status.tom}>{p.status.rotulo}</StatusBadge>
        </span>
        <SheetDescription>
          {p.loja} · {p.quandoLongo}
        </SheetDescription>
        {p.urlShopify && (
          <a
            href={p.urlShopify}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 rounded-control border border-border px-2.5 py-1 text-label text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Abrir na Shopify
            <ExternalLink aria-hidden className="size-3" strokeWidth={2} />
            <span className="sr-only">(abre em nova aba)</span>
          </a>
        )}
      </SheetHeader>
      <SheetBody className="flex flex-col gap-5 px-5 pb-7">
        <section aria-labelledby="pd-valores" className="flex flex-col gap-2">
          <h3 id="pd-valores" className="text-dense font-semibold">
            Valores
          </h3>
          {v ? (
            <>
              <div className="rounded-card border border-border">
                <Linha rotulo="Produtos" valor={dinheiro(v.produtos)} />
                <Linha rotulo="Frete cobrado" valor={dinheiro(v.frete)} />
                <Linha rotulo="Desconto" valor={menos(v.desconto)} />
                {Math.abs(outros) >= 0.005 && (
                  <Linha
                    rotulo="Impostos e gorjeta"
                    valor={outros > 0 ? menos(outros) : `+${dinheiro(-outros)}`}
                    cor="text-t1"
                  />
                )}
                <Linha rotulo="Valor pago" valor={dinheiro(v.valorPago)} forte />
                {v.aReceber > 0 && <Linha rotulo="A receber na entrega" valor={dinheiro(v.aReceber)} cor="text-t1" />}
                {v.reembolso > 0 && <Linha rotulo="Reembolso" valor={menos(v.reembolso)} cor="text-err" />}
                <Linha rotulo="Produto + frete do fornecedor" valor={menos(v.cmv)} cor="text-t1" />
                <Linha
                  rotulo={
                    v.temTaxa
                      ? `Taxa de pagamento${p.gateway ? ` · ${p.gateway}` : ""}`
                      : "Taxa de pagamento · não cadastrada"
                  }
                  valor={menos(v.taxa)}
                  cor="text-t1"
                />
                {v.devolucao > 0 && <Linha rotulo="Devolução" valor={menos(v.devolucao)} cor="text-t1" />}
                <Linha
                  rotulo="Lucro estimado"
                  valor={v.lucro === null ? "— (SKU sem custo)" : dinheiro(v.lucro)}
                  destaque
                  cor={v.lucro !== null && v.lucro < 0 ? "text-err" : "text-ink"}
                />
              </div>
              <p className="text-label text-t2">
                Lucro estimado antes de dividir o anúncio. O gasto entra no total do dia, não por pedido.
              </p>
            </>
          ) : (
            <p className="text-dense text-t1">
              Sem cotação para a moeda deste pedido: ele fica fora das somas, como no Dashboard.
            </p>
          )}
        </section>

        <section aria-labelledby="pd-itens" className="flex flex-col gap-2">
          <h3 id="pd-itens" className="text-dense font-semibold">
            Itens
          </h3>
          {p.itens.length === 0 && <p className="text-dense text-t2">Pedido sem itens.</p>}
          {p.itens.map((item, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border-subtle py-2.5">
              <span
                aria-hidden
                className="size-10 shrink-0 rounded-control border border-border bg-[repeating-linear-gradient(45deg,var(--track)_0_4px,var(--surface-2)_4px_8px)]"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-dense font-medium">{item.sku || "Sem SKU"}</span>
                <span className="text-label text-t2">SKU</span>
              </span>
              <span className="num flex flex-col items-end">
                <span className="text-dense">
                  {item.qtd} × {v ? dinheiro(item.preco) : "—"}
                </span>
                {item.custoTipo === "sem" ? (
                  <Link href="/financeiro/custos" className="text-label text-warn underline underline-offset-2">
                    Sem custo cadastrado
                  </Link>
                ) : (
                  <span className="text-label text-t2">
                    {item.custoTipo === "nenhuma_unidade"
                      ? "Sem custo (nada enviado)"
                      : `${item.custoTipo === "estimado" ? "custo estimado" : "custo"}${item.qtd > 1 ? " total" : ""} ${v ? dinheiro(item.custo) : "—"}`}
                  </span>
                )}
              </span>
            </div>
          ))}
        </section>

        <section aria-labelledby="pd-jornada" className="flex flex-col gap-2">
          <h3 id="pd-jornada" className="text-dense font-semibold">
            Jornada
          </h3>
          <ol className="flex flex-col">
            {jornada.map((j, i) => (
              <li key={i} className="grid grid-cols-[18px_1fr_auto] items-start gap-3 pb-3.5">
                <span aria-hidden className={cn("ml-1 mt-1 size-2.5 rounded-full", COR_TOM[j.tom])} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-dense font-medium">
                    {j.marca && <Logo marca={j.marca} tamanho={13} />}
                    {j.titulo}
                  </span>
                  <span
                    className={cn(
                      "text-label [overflow-wrap:anywhere]",
                      j.tom === "err" ? "text-err" : j.tom === "warn" ? "text-warn" : "text-t2"
                    )}
                  >
                    {j.detalhe}
                  </span>
                </span>
                <span className="num text-label text-t2">{j.hora}</span>
              </li>
            ))}
          </ol>
          <Link href="/tracking/eventos?evento=purchase" className="w-fit text-label underline underline-offset-2">
            Ver compras em Eventos ao vivo
          </Link>
        </section>
      </SheetBody>
    </>
  );
}
