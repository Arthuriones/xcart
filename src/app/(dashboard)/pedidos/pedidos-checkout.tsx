"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, HandCoins, Hourglass, Receipt, Search, Undo2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatarDinheiro } from "@/lib/financeiro/tipos";
import type { PedidoExternoTela, ResumoPedidosExternos } from "@/lib/checkouts-externos/pedidos";
import { vendaPerdida, vendaRecebida } from "@/lib/checkouts-externos/venda";
import { montarCsv } from "../financeiro/lucro-dados";
import { POR_PAGINA, textoCsv } from "./filtros";

// ============================================================================
// Pedidos de checkout externo. Os numeros chegam prontos do servidor
// (src/lib/checkouts-externos/pedidos.ts); aqui so busca, filtro, pagina e CSV.
//
//   comissao (Sphere): data, pedido, produto, pais, valor do pedido,
//     comissao, situacao e campanha/anuncio (do postback, 086).
//   venda (Cakto): metodo, valor, taxa, liquido, situacao e campanha/anuncio,
//     tudo na moeda do relatorio.
//   misto (os dois no filtro): as colunas da venda; na linha da Sphere o
//     liquido e a comissao, e o valor fica na moeda do pedido (o CSV leva a
//     coluna "Moeda do valor").
// ============================================================================

export type ModeloDaTela = "comissao" | "venda" | "misto";

type Filtro = "todos" | "pendente" | "recebido" | "perdido";

const FILTROS: Record<ModeloDaTela, { id: Filtro; rotulo: string }[]> = {
  comissao: [
    { id: "todos", rotulo: "Todos" },
    { id: "recebido", rotulo: "Aprovadas e pagas" },
    { id: "pendente", rotulo: "Pendentes" },
    { id: "perdido", rotulo: "Expiradas e revertidas" },
  ],
  venda: [
    { id: "todos", rotulo: "Todos" },
    { id: "recebido", rotulo: "Pagas" },
    { id: "pendente", rotulo: "Aguardando" },
    { id: "perdido", rotulo: "Perdidas" },
  ],
  misto: [
    { id: "todos", rotulo: "Todos" },
    { id: "recebido", rotulo: "Pagas e aprovadas" },
    { id: "pendente", rotulo: "Pendentes" },
    { id: "perdido", rotulo: "Perdidas" },
  ],
};

function passa(p: PedidoExternoTela, f: Filtro): boolean {
  if (f === "todos") return true;
  if (p.estado) {
    if (f === "recebido") return vendaRecebida(p.estado);
    if (f === "perdido") return vendaPerdida(p.estado);
    return p.estado === "aguardando";
  }
  if (f === "pendente") return p.situacao === "pendente";
  if (f === "recebido") return p.situacao === "aprovado" || p.situacao === "pago";
  return p.situacao === "expirado" || p.situacao === "revertido";
}

function casaBusca(p: PedidoExternoTela, busca: string): boolean {
  const q = busca.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  return `${p.pedido} ${p.produto ?? ""} ${p.pais ?? ""} ${p.checkout} ${p.campanha ?? ""} ${p.anuncio ?? ""}`
    .toLowerCase()
    .includes(q);
}

const CABECALHO = [
  "Pedido",
  "Data",
  "Checkout",
  "Produto",
  "País",
  "Valor do pedido",
  "Moeda do pedido",
  "Comissão",
  "Situação",
  "Campanha",
  "Anúncio",
];
const CABECALHO_VENDA = [
  "Pedido",
  "Data",
  "Checkout",
  "Produto",
  "Oferta",
  "Método",
  "Valor",
  // A da coluna Valor: a do relatorio, ou a do pedido (a linha da Sphere no misto, venda sem cotacao).
  "Moeda do valor",
  "Taxa",
  "Comissões",
  "Líquido",
  "Situação",
  "Campanha",
  "Anúncio",
];

const redondo = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export function PedidosCheckout({
  linhas,
  resumo,
  moeda,
  mostrarCheckout,
  contextoCsv,
  arquivoCsv,
  abas,
  modelo = "comissao",
}: {
  linhas: PedidoExternoTela[];
  resumo: ResumoPedidosExternos;
  moeda: string;
  /** Varios checkouts no filtro: a coluna Checkout aparece. */
  mostrarCheckout: boolean;
  contextoCsv: string[];
  arquivoCsv: string;
  /** "Lojas | Checkouts" quando o usuario tem os dois (page.tsx). */
  abas?: ReactNode;
  /** Sphere (comissao), Cakto (venda) ou os dois. */
  modelo?: ModeloDaTela;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const dinheiro = (v: number | null) => (v === null ? "—" : formatarDinheiro(v, moeda, 2));
  const venda = modelo !== "comissao";
  const filtros = FILTROS[modelo];
  const rotuloReceita = modelo === "venda" ? "Líquido" : modelo === "misto" ? "Líquido ou comissão" : "Comissão";

  const contagem = useMemo(() => {
    const c = {} as Record<Filtro, number>;
    for (const f of FILTROS.comissao) c[f.id] = linhas.filter((p) => passa(p, f.id)).length;
    return c;
  }, [linhas]);
  const lista = useMemo(() => linhas.filter((p) => passa(p, filtro) && casaBusca(p, busca)), [linhas, filtro, busca]);
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = lista.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);
  const filtrado = filtro !== "todos" || busca.trim() !== "";

  function exportar() {
    const csv = venda
      ? montarCsv(
          contextoCsv.map((c) => textoCsv(c) ?? ""),
          CABECALHO_VENDA,
          lista.map((p) => [
            textoCsv(p.pedido),
            p.criadoEm.slice(0, 10),
            textoCsv(p.checkout),
            textoCsv(p.produto),
            p.oferta,
            textoCsv(p.metodo),
            // Como na tela: a linha da Sphere (misto) fica no valor e na moeda do pedido.
            redondo(p.valorRelatorio ?? p.valor),
            p.valorRelatorio === null ? p.moedaPedido : moeda,
            redondo(p.taxa),
            redondo(p.comissoes),
            redondo(p.comissao),
            p.rotulo,
            textoCsv(p.campanha),
            textoCsv(p.anuncio),
          ])
        )
      : montarCsv(
          contextoCsv.map((c) => textoCsv(c) ?? ""),
          CABECALHO,
          lista.map((p) => [
            textoCsv(p.pedido),
            p.criadoEm.slice(0, 10),
            textoCsv(p.checkout),
            textoCsv(p.produto),
            p.pais,
            p.valor,
            p.moedaPedido,
            p.comissao === null ? null : Math.round(p.comissao * 100) / 100,
            p.rotulo,
            textoCsv(p.campanha),
            textoCsv(p.anuncio),
          ])
        );
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = arquivoCsv;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("CSV pronto", { description: `${arquivoCsv}\n${lista.length} ${lista.length === 1 ? "pedido" : "pedidos"}` });
  }

  const aviso = [
    resumo.semCotacao ? `${resumo.semCotacao} sem cotação fora da soma` : null,
    resumo.cambioAproximado ? "Câmbio aproximado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const kpis: { rotulo: string; valor: string; icone: ReactNode; detalhe?: string }[] = venda
    ? [
        { rotulo: "Pedidos", valor: new Intl.NumberFormat("pt-BR").format(resumo.pedidos), icone: <Receipt /> },
        {
          rotulo: "Recebido",
          valor: dinheiro(resumo.recebido),
          icone: <HandCoins />,
          detalhe:
            aviso ||
            (modelo === "venda"
              ? `Faturamento ${dinheiro(resumo.faturamento)} · taxas ${dinheiro(resumo.taxas)}`
              : "Líquido das vendas pagas e comissão aprovada"),
        },
        {
          rotulo: "A receber",
          valor: dinheiro(resumo.aReceber),
          icone: <Hourglass />,
          detalhe: `${resumo.pendentes} ${resumo.pendentes === 1 ? "pendente" : "pendentes"}`,
        },
        {
          rotulo: "Perdido",
          valor: dinheiro(resumo.perdido),
          icone: <Undo2 />,
          detalhe: `${resumo.perdidos} ${resumo.perdidos === 1 ? "vencido, recusado ou estornado" : "vencidos, recusados ou estornados"}`,
        },
      ]
    : [
        { rotulo: "Pedidos", valor: new Intl.NumberFormat("pt-BR").format(resumo.pedidos), icone: <Receipt /> },
        { rotulo: "Recebido", valor: dinheiro(resumo.recebido), icone: <HandCoins />, detalhe: aviso || "Comissão aprovada e paga" },
        {
          rotulo: "A receber",
          valor: dinheiro(resumo.aReceber),
          icone: <Hourglass />,
          detalhe: `${resumo.pendentes} ${resumo.pendentes === 1 ? "pendente" : "pendentes"}`,
        },
        {
          rotulo: "Perdido",
          valor: dinheiro(resumo.perdido),
          icone: <Undo2 />,
          detalhe: `${resumo.perdidos} ${resumo.perdidos === 1 ? "expirado ou revertido" : "expirados ou revertidos"}`,
        },
      ];

  const colunaCheckout = mostrarCheckout ? ([["Checkout", "left"]] as [string, "left"][]) : [];
  const colunas: [string, "left" | "right"][] = venda
    ? [
        ["Pedido", "left"],
        ["Data", "left"],
        ...colunaCheckout,
        ["Produto", "left"],
        ["Método", "left"],
        ["Valor", "right"],
        ["Taxa", "right"],
        [rotuloReceita, "right"],
        ["Situação", "left"],
        ["Campanha", "left"],
      ]
    : [
        ["Pedido", "left"],
        ["Data", "left"],
        ...colunaCheckout,
        ["Produto", "left"],
        ["País", "left"],
        ["Valor do pedido", "right"],
        ["Comissão", "right"],
        ["Situação", "left"],
        ["Campanha", "left"],
      ];

  /** Valor da venda na moeda do relatorio; a linha da Sphere (misto) fica na moeda dela. */
  const valorDaLinha = (p: PedidoExternoTela) =>
    p.modelo === "venda" ? dinheiro(p.valorRelatorio) : formatarDinheiro(p.valor, p.moedaPedido, 2);

  return (
    <div data-largura="total" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <span className="flex flex-wrap items-center gap-4">
          {abas}
        </span>
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

      <section aria-label="Pedidos do checkout" className="min-w-0 rounded-overlay border border-border bg-surface">
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
              aria-label="Buscar pedido ou produto"
              placeholder="Buscar #pedido, produto ou campanha"
              className="pl-8 text-dense"
            />
          </div>
          <div
            role="group"
            aria-label="Filtrar"
            className="flex max-w-full gap-0.5 overflow-x-auto rounded-card border border-border bg-surface-2 p-0.5 [scrollbar-width:none]"
          >
            {filtros.map((f) => {
              const on = filtro === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setFiltro(f.id);
                    setPagina(0);
                  }}
                  className={cn(
                    "h-6.5 whitespace-nowrap rounded-control px-2.5 text-label focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                    on ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--border)]" : "text-t2 hover:text-ink"
                  )}
                >
                  {f.rotulo} <span className="num">{contagem[f.id]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {lista.length === 0 ? (
          <EmptyState
            variante="simples"
            className="min-h-60"
            titulo={filtrado && linhas.length ? "Nenhum pedido com esse filtro" : "Nenhum pedido no período"}
            descricao={
              filtrado && linhas.length
                ? "Mude a busca ou o filtro."
                : "Os pedidos chegam pelo webhook do checkout, na hora em que acontecem."
            }
            acao={
              filtrado && linhas.length ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFiltro("todos");
                    setBusca("");
                    setPagina(0);
                  }}
                >
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-dense">
                <caption className="sr-only">Pedidos do checkout no período</caption>
                <thead>
                  <tr className="text-label text-t2">
                    {colunas.map(([rotulo, lado]) => (
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
                  {venda
                    ? visiveis.map((p) => (
                        <tr key={p.chave} className="[&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3.5">
                          <td className="h-13 whitespace-nowrap font-semibold text-ink">{p.pedido}</td>
                          <td className="num whitespace-nowrap text-t1">{p.quando}</td>
                          {mostrarCheckout && <td className="whitespace-nowrap">{p.checkout}</td>}
                          <td className="max-w-60 text-t1" title={p.produto ?? undefined}>
                            <span className="block truncate">{p.produto ?? "—"}</span>
                            {p.oferta ? <span className="block text-label text-t2">{p.oferta}</span> : null}
                          </td>
                          <td className="whitespace-nowrap text-t1">{p.metodo ?? "—"}</td>
                          <td className="num whitespace-nowrap text-right text-t1">{valorDaLinha(p)}</td>
                          <td className="num whitespace-nowrap text-right text-t1">
                            {dinheiro(p.taxa)}
                            {p.comissoes ? (
                              <span className="block text-label text-t2">+ {dinheiro(p.comissoes)} comissões</span>
                            ) : null}
                          </td>
                          <td className="num whitespace-nowrap text-right font-semibold">{dinheiro(p.comissao)}</td>
                          <td className="whitespace-nowrap">
                            <StatusBadge tom={p.tom}>{p.rotulo}</StatusBadge>
                          </td>
                          <td className="max-w-50 text-t1" title={[p.campanha, p.anuncio].filter(Boolean).join(" · ") || undefined}>
                            <span className="block truncate">{p.campanha ?? "—"}</span>
                            {p.anuncio ? <span className="block truncate text-label text-t2">{p.anuncio}</span> : null}
                          </td>
                        </tr>
                      ))
                    : visiveis.map((p) => (
                        <tr key={p.chave} className="[&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3.5">
                          <td className="h-13 whitespace-nowrap font-semibold text-ink">{p.pedido}</td>
                          <td className="num whitespace-nowrap text-t1">{p.quando}</td>
                          {mostrarCheckout && <td className="whitespace-nowrap">{p.checkout}</td>}
                          <td className="max-w-60 truncate text-t1" title={p.produto ?? undefined}>
                            {p.produto ?? "—"}
                          </td>
                          <td className="whitespace-nowrap text-t1">{p.pais ?? "—"}</td>
                          <td className="num whitespace-nowrap text-right text-t1">{formatarDinheiro(p.valor, p.moedaPedido, 2)}</td>
                          <td className="num whitespace-nowrap text-right font-semibold">{dinheiro(p.comissao)}</td>
                          <td className="whitespace-nowrap">
                            <StatusBadge tom={p.tom}>{p.rotulo}</StatusBadge>
                          </td>
                          <td className="max-w-50 text-t1" title={[p.campanha, p.anuncio].filter(Boolean).join(" · ") || undefined}>
                            <span className="block truncate">{p.campanha ?? "—"}</span>
                            {p.anuncio ? <span className="block truncate text-label text-t2">{p.anuncio}</span> : null}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            <ul className="flex flex-col gap-2 p-3 md:hidden">
              {visiveis.map((p) => (
                <li key={p.chave} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
                  <span className="flex w-full justify-between gap-2">
                    <span className="flex min-w-0 flex-col">
                      <strong className="text-body">
                        {p.pedido}
                        {mostrarCheckout ? ` · ${p.checkout}` : ""}
                      </strong>
                      <span className="truncate text-label text-t2">
                        {p.quando} ·{" "}
                        {(p.modelo === "venda" ? [p.produto, p.metodo, p.campanha] : [p.produto, p.pais, p.campanha]).filter(Boolean).join(" · ") ||
                          "—"}
                      </span>
                    </span>
                    <StatusBadge tom={p.tom}>{p.rotulo}</StatusBadge>
                  </span>
                  <span className="flex w-full justify-between gap-3 text-dense">
                    <span className="flex flex-col">
                      <span className="text-label text-t2">Valor</span>
                      <span className="num text-t1">{valorDaLinha(p)}</span>
                    </span>
                    <span className="flex flex-col items-end text-right">
                      {/* O nome da coluna da tabela: Liquido na venda, Comissao na Sphere. */}
                      <span className="text-label text-t2">{p.modelo === "venda" ? "Líquido" : "Comissão"}</span>
                      <strong className="num text-ink">{dinheiro(p.comissao)}</strong>
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 text-label text-t2">
              <span className="num">
                {atual * POR_PAGINA + 1}–{atual * POR_PAGINA + visiveis.length} de {lista.length}{" "}
                {lista.length === 1 ? "pedido" : "pedidos"} · {venda ? "valores" : "comissão"} em {moeda}
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
    </div>
  );
}
