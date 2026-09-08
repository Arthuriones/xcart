"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SALES_PERIODS } from "@/lib/sales/types";
import type { Sales, SalesPeriod, SalesRow } from "@/lib/sales/types";

const GRADE =
  "grid min-w-[640px] grid-cols-[minmax(140px,1.4fr)_96px_84px_128px_132px] gap-3";

const ESTADO: Record<SalesRow["state"], { texto: string; cor: string; fundo: string }> = {
  ok: { texto: "Ativo", cor: "var(--ok)", fundo: "var(--ok-bg)" },
  paused: { texto: "Pausado", cor: "var(--t2)", fundo: "var(--track)" },
  attention: { texto: "Atenção", cor: "var(--warn)", fundo: "var(--warn-bg)" },
};

function dinheiro(centavos: number, moeda: string) {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: moeda || "BRL",
    maximumFractionDigits: 2,
  });
}

/** Valor grande do painel: milhar e milhao abreviados para caber na coluna. */
function dinheiroCurto(centavos: number, moeda: string) {
  const v = centavos / 100;
  const simbolo = moeda === "BRL" ? "R$" : moeda === "USD" ? "$" : `${moeda} `;
  if (v >= 1_000_000)
    return `${simbolo} ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (v >= 1_000)
    return `${simbolo} ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return dinheiro(centavos, moeda);
}

function numero(n: number) {
  return n.toLocaleString("pt-BR");
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[27px] rounded-md px-[11px] text-[12px] font-semibold transition-colors"
      style={{
        border: `1px solid ${ativo ? "var(--solid)" : "var(--border)"}`,
        background: ativo ? "var(--solid)" : "var(--surface)",
        color: ativo ? "var(--on-solid)" : "var(--t2)",
      }}
    >
      {children}
    </button>
  );
}

export function SalesScreen({ dados }: { dados: Sales }) {
  const router = useRouter();
  const [lojaId, setLojaId] = useState<string>("all");

  const { rows, currency } = dados;
  const selecionada = lojaId === "all" ? null : rows.find((r) => r.storeId === lojaId) || null;

  // A barra compara com a maior receita do periodo, nao com o total: com
  // cinco lojas equilibradas todas as barras ficariam em 20% e nao diriam
  // nada sobre quem esta na frente.
  const maiorReceita = Math.max(1, ...rows.map((r) => r.revenueCents));

  const lider = rows.reduce<SalesRow | null>(
    (melhor, linha) => (!melhor || linha.revenueCents > melhor.revenueCents ? linha : melhor),
    null
  );

  const ticket = (centavos: number, pedidos: number) =>
    dinheiro(pedidos > 0 ? Math.round(centavos / pedidos) : 0, currency);

  const paineis = selecionada
    ? [
        {
          l: `Faturamento — ${selecionada.name}`,
          v: dinheiroCurto(selecionada.revenueCents, currency),
          hint: `${selecionada.sharePercent}% do total · ${ESTADO[selecionada.state].texto.toLowerCase()}`,
        },
        { l: "Pedidos", v: numero(selecionada.orders), hint: "nesta loja" },
        {
          l: "Ticket médio",
          v: ticket(selecionada.revenueCents, selecionada.orders),
          hint: "por pedido",
        },
        {
          l: "Faturamento total",
          v: dinheiroCurto(dados.totalRevenueCents, currency),
          hint: `todas as lojas · ${numero(dados.totalOrders)} pedidos`,
        },
      ]
    : [
        {
          l: "Faturamento total",
          v: dinheiroCurto(dados.totalRevenueCents, currency),
          hint: `nos últimos ${dados.period} dias`,
        },
        {
          l: "Pedidos",
          v: numero(dados.totalOrders),
          hint:
            dados.storeCount === 1
              ? "em 1 loja de checkout"
              : `em ${dados.storeCount} lojas de checkout`,
        },
        {
          l: "Ticket médio",
          v: ticket(dados.totalRevenueCents, dados.totalOrders),
          hint: "por pedido",
        },
        {
          l: "Loja líder",
          v: lider && lider.revenueCents > 0 ? lider.name : "—",
          hint: "maior receita no período",
        },
      ];

  function trocarPeriodo(p: SalesPeriod) {
    // O periodo vive na URL: recarrega no servidor, que e quem fala com a
    // Shopify. Manter em estado obrigaria a refazer as chamadas pelo cliente.
    router.push(`/sales?periodo=${p}`);
  }

  if (!dados.hasRoute || rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center">
        <div className="text-[15px] font-semibold text-ink">
          Nenhuma venda registrada ainda
        </div>
        <p className="mx-auto mb-4 mt-1.5 max-w-[380px] text-[12.5px] text-t2">
          Assim que o roteamento estiver ativo, os pedidos processados pelos checkouts
          aparecem aqui, com o total e a quebra por loja.
        </p>
        <Link
          href="/setup"
          className="inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
        >
          Continuar configuração
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {SALES_PERIODS.map((p) => (
            <Chip
              key={p.id}
              ativo={dados.period === p.id}
              onClick={() => trocarPeriodo(p.id)}
            >
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="flex-1" />
        <div className="text-[12px] text-t3">
          Pedidos pagos nas lojas de checkout de{" "}
          {dados.routeCount === 1 ? "1 rota" : `${dados.routeCount} rotas`}.
        </div>
      </div>

      {/* Loja conectada antes do app pedir read_orders continua funcionando
          para tudo, menos para ler pedido. O conserto é reconectar. */}
      {dados.deniedNames.length > 0 && (
        <div
          className="rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--warn-border)", background: "var(--warn-bg)" }}
        >
          <p className="text-[12.5px] font-semibold text-ink">
            {dados.deniedNames.length === 1
              ? `${dados.deniedNames[0]} não libera os pedidos ainda`
              : `${dados.deniedNames.length} lojas não liberam os pedidos ainda`}
          </p>
          <p className="mt-1 text-[12px] text-t2">
            Elas foram conectadas antes do xcart pedir permissão de leitura de pedidos.
            Reconecte em{" "}
            <Link href="/stores" className="underline underline-offset-2">
              Lojas
            </Link>{" "}
            para o faturamento delas entrar na conta.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Chip ativo={lojaId === "all"} onClick={() => setLojaId("all")}>
          Todas as lojas
        </Chip>
        {rows.map((linha) => (
          <Chip
            key={linha.storeId}
            ativo={lojaId === linha.storeId}
            onClick={() => setLojaId(linha.storeId)}
          >
            {linha.name}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 rounded-lg border border-border bg-surface lg:grid-cols-4">
        {paineis.map((painel) => (
          <div
            key={painel.l}
            className="border-l border-[var(--border-subtle)] px-4 py-3 first:border-l-0"
          >
            <div className="truncate text-[11.5px] text-t3">{painel.l}</div>
            <div className="mt-[3px] truncate text-[21px] font-semibold tracking-[-0.02em] tabular-nums text-ink">
              {painel.v}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-t4">{painel.hint}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-[9px] flex items-center gap-2.5">
          <h2 className="text-[13px] font-semibold text-ink">Por loja de checkout</h2>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="overflow-x-auto">
            <div
              className={`${GRADE} border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold text-t3`}
            >
              <div>Loja</div>
              <div>Conexão</div>
              <div>Pedidos</div>
              <div>Receita</div>
              <div>% do tráfego</div>
            </div>

            {rows.map((linha) => {
              const estado = ESTADO[linha.state];
              const marcada = lojaId === linha.storeId;
              return (
                <div
                  key={linha.storeId}
                  className={`${GRADE} min-h-[44px] items-center border-b border-[var(--border-subtle)] px-3.5 transition-colors hover:bg-surface-2`}
                  style={{
                    background: marcada ? "var(--surface-2)" : "var(--surface)",
                    boxShadow: `inset 3px 0 0 ${marcada ? "var(--solid)" : "transparent"}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setLojaId(marcada ? "all" : linha.storeId)}
                    className="min-w-0 py-2 text-left"
                  >
                    <div
                      className="truncate text-[12.5px] text-ink"
                      style={{ fontWeight: marcada ? 700 : 600 }}
                    >
                      {linha.name}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-t3">
                      {linha.domain}
                    </div>
                    {/* Com mais de uma rota, saber QUEM manda comprador para
                        esta loja e a metade que falta do numero. */}
                    {dados.routeCount > 1 && linha.vitrines.length > 0 && (
                      <div className="truncate text-[10.5px] text-t4">
                        ← {linha.vitrines.join(", ")}
                      </div>
                    )}
                  </button>

                  <span
                    className="inline-flex items-center gap-1.5 justify-self-start rounded px-[7px] py-0.5 text-[11.5px] font-medium"
                    style={{ color: estado.cor, background: estado.fundo }}
                  >
                    <span
                      className="h-[5px] w-[5px] rounded-full"
                      style={{ background: estado.cor }}
                      aria-hidden
                    />
                    {estado.texto}
                  </span>

                  {/* Loja que nao respondeu mostra travessao, nao zero: zero
                      diria que ela nao vendeu, e ninguem sabe se vendeu. */}
                  <span className="font-mono text-[12px] tabular-nums text-ink">
                    {linha.problem ? "—" : numero(linha.orders)}
                  </span>
                  <span className="text-[12.5px] font-semibold tabular-nums text-ink">
                    {linha.problem ? "—" : dinheiro(linha.revenueCents, currency)}
                  </span>

                  <span className="flex items-center gap-[9px]">
                    <span className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-[3px] bg-[var(--track)]">
                      <span
                        className="block h-1 rounded-[3px] transition-[width] duration-300"
                        style={{
                          width: `${Math.round((linha.revenueCents / maiorReceita) * 100)}%`,
                          background:
                            linha.state === "ok" ? "var(--solid)" : "var(--border-strong)",
                        }}
                      />
                    </span>
                    <span className="w-[34px] text-right font-mono text-[11.5px] tabular-nums text-t1">
                      {linha.trafficPercent}%
                    </span>
                  </span>
                </div>
              );
            })}

            <div className={`${GRADE} items-center bg-surface-2 px-3.5 py-2.5`}>
              <div className="text-[12px] font-semibold text-t1">Total</div>
              <div />
              <div className="font-mono text-[12px] font-medium tabular-nums text-ink">
                {numero(dados.totalOrders)}
              </div>
              <div className="text-[12.5px] font-bold tabular-nums text-ink">
                {dinheiro(dados.totalRevenueCents, currency)}
              </div>
              <div className="text-right font-mono text-[11.5px] text-t3">100%</div>
            </div>
          </div>
        </div>
      </div>

      <p className="max-w-[620px] text-[12px] text-t3">
        A Shopify só libera os últimos {dados.maxDays} dias de pedidos com a permissão que
        o xcart pede. A coluna de receita conta pedido pago, já com reembolso descontado;
        pedido de teste e cancelado ficam de fora.
      </p>
    </div>
  );
}
