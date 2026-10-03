"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { Dica } from "@/components/ui/dica";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA, TODAS } from "@/lib/financeiro/tipos";
import type { Sales, SalesRow } from "@/lib/sales/types";
import { Atualizar, TentarDeNovo } from "../overview/estados";
import { plural } from "../overview/apresentar";
import {
  dinheiroCentavos,
  inteiro,
  listaDeNomes,
  respondeu,
  resumirVendas,
  somaTrafego,
  textoPorMoeda,
  ticketDaLoja,
} from "./apresentar";

// ============================================================================
// Vendas por rota: quanto cada loja de checkout faturou (Shopify ao vivo) ao
// lado da fatia do trafego que o rodizio manda para ela. A loja vem do filtro
// global (cookie); o periodo 7/30/60 e desta tela, na URL, porque a consulta
// ao vivo da Shopify tem teto de 60 dias.
// ============================================================================

/** A loja do filtro global, quando nao e loja de checkout. */
export type LojaFora = { nome: string; tipo: "vitrine" | "fora" };

const SELO_RODIZIO: Record<SalesRow["state"], { tom: TomStatus; texto: string }> = {
  ok: STATUS.rota.ativa,
  paused: STATUS.rota.pausada,
  attention: STATUS.rota.atencao,
};

function seloConexao(r: SalesRow): { tom: TomStatus; texto: string } {
  if (r.problem === "denied") return STATUS.loja.semPermissao;
  if (r.problem === "failed") return { tom: "warn", texto: "Sem resposta" };
  return STATUS.loja.conectada;
}

function hrefReconectar(dominio: string): string {
  return `/stores?conectar=1&dominio=${encodeURIComponent(dominio)}`;
}

const LINK =
  "rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type Linha = {
  id: string;
  row: SalesRow;
  nome: string;
  foco: boolean;
  pedidosValor: number | null;
  receitaValor: number | null;
  fatiaReceitaValor: number | null;
  trafegoValor: number;
};

/** Tira o filtro de loja (vale para o app inteiro) e le a tela de novo. */
function useLimparLoja() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return {
    pendente,
    limpar: () => {
      gravarCookie(COOKIE_LOJA, TODAS);
      iniciar(() => router.refresh());
    },
  };
}

export function TelaVendas({
  dados,
  hora,
  foco,
  fora,
}: {
  dados: Sales;
  /** "14:32 (horário de São Paulo)": quando a Shopify foi consultada. */
  hora: string;
  /** Loja de checkout escolhida no filtro global. */
  foco: { id: string; nome: string } | null;
  fora: LojaFora | null;
}) {
  const { limpar, pendente } = useLimparLoja();
  const rows = dados.rows;
  const r = resumirVendas(rows, dados.currency);
  const moeda = r.moeda;
  const respondidas = rows.filter(respondeu);
  const parcial = respondidas.length < rows.length;
  const ninguem = respondidas.length === 0;
  const linhaFoco = foco ? (rows.find((x) => x.storeId === foco.id) ?? null) : null;
  const dias = `Últimos ${dados.period} dias`;
  const multi = moeda === null;
  const selParcial = parcial && !ninguem ? ({ tom: "warn", texto: "Parcial" } as const) : undefined;

  // ---- KPIs -----------------------------------------------------------------
  const kpis = linhaFoco ? (
    <>
      <KpiCard
        rotulo="Faturamento"
        valor={respondeu(linhaFoco) ? dinheiroCentavos(linhaFoco.revenueCents, linhaFoco.currency) : null}
        motivoSemDado={linhaFoco.problem === "denied" ? "A loja não libera os pedidos" : "A loja não respondeu"}
        detalhe={`${dias} · só ${linhaFoco.name}`}
      />
      <KpiCard
        rotulo="Pedidos"
        valor={respondeu(linhaFoco) ? inteiro(linhaFoco.orders) : null}
        motivoSemDado="Sem dado desta loja"
        detalhe="Pedidos pagos"
      />
      <KpiCard
        rotulo="Ticket médio"
        valor={
          respondeu(linhaFoco) && ticketDaLoja(linhaFoco) !== null
            ? dinheiroCentavos(ticketDaLoja(linhaFoco)!, linhaFoco.currency)
            : null
        }
        motivoSemDado={respondeu(linhaFoco) ? "Sem pedidos no período" : "Sem dado desta loja"}
        detalhe="Por pedido pago"
      />
      <KpiCard
        rotulo="Fatia da receita"
        valor={r.fatiaReceita[linhaFoco.storeId] != null ? `${r.fatiaReceita[linhaFoco.storeId]}%` : null}
        motivoSemDado={multi ? "Lojas em moedas diferentes" : "Sem vendas para comparar"}
        detalhe={`Contra ${linhaFoco.trafficPercent}% do tráfego`}
        definicao="Quanto da receita de todas as lojas de checkout veio desta loja, ao lado da fatia do tráfego que o rodízio manda para ela."
      />
    </>
  ) : (
    <>
      <KpiCard
        rotulo="Faturamento"
        valor={ninguem || r.totalReceita === null ? null : dinheiroCentavos(r.totalReceita, moeda ?? dados.currency)}
        motivoSemDado={ninguem ? "Nenhuma loja respondeu" : "Lojas em moedas diferentes"}
        estado={selParcial}
        detalhe={multi && !ninguem ? textoPorMoeda(r.porMoeda) : `${dias} · pedidos pagos`}
        definicao="Soma dos pedidos pagos nas lojas de checkout, já com reembolso. Pedido de teste e cancelado ficam de fora."
      />
      <KpiCard
        rotulo="Pedidos"
        valor={ninguem ? null : inteiro(r.totalPedidos)}
        motivoSemDado="Nenhuma loja respondeu"
        estado={selParcial}
        detalhe={`Em ${plural(respondidas.length, "loja de checkout", "lojas de checkout")}`}
      />
      <KpiCard
        rotulo="Ticket médio"
        valor={ninguem || r.ticket === null ? null : dinheiroCentavos(r.ticket, moeda ?? dados.currency)}
        motivoSemDado={
          ninguem ? "Nenhuma loja respondeu" : multi ? "Lojas em moedas diferentes" : "Sem pedidos no período"
        }
        detalhe="Por pedido pago"
      />
      <KpiCard
        rotulo="Loja líder"
        valor={r.lider ? <span className="wrap-anywhere">{r.lider.name}</span> : null}
        motivoSemDado={
          ninguem ? "Nenhuma loja respondeu" : multi ? "Lojas em moedas diferentes" : "Sem vendas no período"
        }
        detalhe={
          r.lider
            ? `${dinheiroCentavos(r.lider.revenueCents, r.lider.currency)} · ${r.fatiaReceita[r.lider.storeId]}% da receita`
            : undefined
        }
      />
    </>
  );

  // ---- Tabela ---------------------------------------------------------------
  const linhas: Linha[] = rows.map((row) => ({
    id: row.storeId,
    row,
    nome: row.name,
    foco: row.storeId === linhaFoco?.storeId,
    pedidosValor: respondeu(row) ? row.orders : null,
    // Com moedas misturadas a receita nao ordena entre si: fica sem valor.
    receitaValor: respondeu(row) && !multi ? row.revenueCents : null,
    fatiaReceitaValor: r.fatiaReceita[row.storeId],
    trafegoValor: row.trafficPercent,
  }));

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "loja",
      titulo: "Loja de checkout",
      ordenarPor: "nome",
      className: "min-w-52",
      celula: (l) => (
        <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/stores/${l.id}`} className={cn(LINK, "font-semibold text-ink")}>
              {l.nome}
            </Link>
            {l.foco ? <StatusBadge tom="info" texto="Loja do filtro" /> : null}
          </span>
          {l.row.domain ? (
            <span className="font-mono text-label font-normal text-t2 wrap-anywhere">{l.row.domain}</span>
          ) : null}
          {/* Com mais de uma rota, saber QUEM manda comprador para esta loja
              e a metade que falta do numero. */}
          {dados.routeCount > 1 && l.row.vitrines.length > 0 ? (
            <span className="text-label font-normal text-t2">
              {l.row.vitrines.length === 1 ? "Vitrine: " : "Vitrines: "}
              {listaDeNomes(l.row.vitrines)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      chave: "conexao",
      titulo: "Conexão",
      ordenavel: false,
      celula: (l) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge {...seloConexao(l.row)} />
          {l.row.problem === "denied" && l.row.domain ? (
            <Link href={hrefReconectar(l.row.domain)} className={cn(LINK, "text-label text-brand")}>
              Reconectar<span className="sr-only"> {l.nome}</span>
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      chave: "rodizio",
      titulo: "Rodízio",
      ordenavel: false,
      celula: (l) => <StatusBadge {...SELO_RODIZIO[l.row.state]} />,
    },
    {
      chave: "pedidos",
      titulo: "Pedidos",
      alinhar: "direita",
      ordenarPor: "pedidosValor",
      celula: (l) => (l.pedidosValor === null ? "—" : inteiro(l.pedidosValor)),
    },
    {
      chave: "receita",
      titulo: "Receita",
      alinhar: "direita",
      ordenarPor: "receitaValor",
      celula: (l) =>
        respondeu(l.row) ? (
          <span className="font-semibold">{dinheiroCentavos(l.row.revenueCents, l.row.currency)}</span>
        ) : (
          "—"
        ),
    },
    {
      chave: "fatiaReceita",
      titulo: "% da receita",
      alinhar: "direita",
      ordenarPor: "fatiaReceitaValor",
      celula: (l) => (l.fatiaReceitaValor === null ? "—" : `${l.fatiaReceitaValor}%`),
    },
    {
      chave: "trafego",
      titulo: "% do tráfego",
      alinhar: "direita",
      ordenarPor: "trafegoValor",
      celula: (l) => `${l.trafegoValor}%`,
    },
  ];

  const totalReceitaTexto = ninguem
    ? "—"
    : r.totalReceita !== null
      ? dinheiroCentavos(r.totalReceita, moeda ?? dados.currency)
      : textoPorMoeda(r.porMoeda);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Atualizar texto={`Shopify ao vivo · consultado às ${hora}`} />
        <Dica rotulo="Por que este número pode diferir do Lucro">
          Esta tela pergunta à Shopify na hora, loja por loja. O Lucro lê os pedidos já sincronizados com o xcart a
          cada 15 minutos. Por isso os dois podem diferir um pouco, principalmente nos pedidos mais recentes.
        </Dica>
      </div>

      {foco && linhaFoco ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border-strong bg-surface pr-0.5 pl-2.5 text-label text-ink">
            Loja: <strong className="font-semibold">{foco.nome}</strong>
            <button
              type="button"
              onClick={limpar}
              disabled={pendente}
              aria-label={`Tirar o filtro da loja ${foco.nome}`}
              className="relative grid size-6 place-items-center rounded-full text-t2 after:absolute after:-inset-2.5 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-progress"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
          <span className="text-label text-t2">
            Filtro de loja que vale para todas as telas. Os números de cima são só desta loja; a tabela compara todas.
          </span>
        </div>
      ) : null}

      {fora ? (
        <Callout
          tom="info"
          titulo={
            fora.tipo === "vitrine"
              ? `${fora.nome} é uma vitrine`
              : `${fora.nome} não faz parte de nenhuma rota`
          }
          acao={
            <Button size="sm" variant="secondary" pending={pendente} onClick={limpar}>
              Tirar o filtro de loja
            </Button>
          }
        >
          O pagamento acontece nas lojas de checkout, então aqui aparecem todas elas.
        </Callout>
      ) : null}

      {r.negadas.length > 0 ? (
        <Callout
          tom="warn"
          titulo={
            r.negadas.length === 1
              ? `${r.negadas[0].name} não libera os pedidos`
              : `${inteiro(r.negadas.length)} lojas não liberam os pedidos`
          }
          acao={
            <Link
              href={r.negadas.length === 1 && r.negadas[0].domain ? hrefReconectar(r.negadas[0].domain) : "/stores"}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              {r.negadas.length === 1 ? "Reconectar" : "Reconectar em Lojas"}
            </Link>
          }
        >
          {r.negadas.length === 1 ? "Ela foi conectada" : `${listaDeNomes(r.negadas.map((n) => n.name))} foram conectadas`}{" "}
          antes de o xcart pedir a leitura de pedidos. Reconecte para o faturamento entrar na conta.
        </Callout>
      ) : null}

      {r.semResposta.length > 0 ? (
        <Callout
          tom="warn"
          titulo={
            r.semResposta.length === 1
              ? `${r.semResposta[0].name} não respondeu agora`
              : `${inteiro(r.semResposta.length)} lojas não responderam agora`
          }
          acao={<TentarDeNovo />}
        >
          Os números {r.semResposta.length === 1 ? "dela" : "delas"} aparecem como “—” e os totais ficam parciais.
        </Callout>
      ) : null}

      {multi && !ninguem ? (
        <Callout tom="info" titulo="Suas lojas de checkout vendem em moedas diferentes">
          Total de cada moeda: {textoPorMoeda(r.porMoeda)}. Somar moedas diferentes daria um número errado, então o
          total geral, o ticket e a fatia da receita ficam como “—”.
        </Callout>
      ) : null}

      <section aria-label="Números do período" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis}
      </section>

      {rows.length >= 2 ? (
        <Section
          titulo="Receita e tráfego por loja"
          descricao="Quanto da receita cada loja trouxe, ao lado da fatia do tráfego que o rodízio manda para ela."
          acoes={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-t1" aria-hidden>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-xs bg-chart-1" />% da receita
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-xs bg-chart-2" />% do tráfego
              </span>
            </span>
          }
        >
          <ol aria-label="Receita e tráfego por loja de checkout" className="flex flex-col gap-4">
            {rows.map((row) => (
              <li key={row.storeId} className="flex flex-col gap-1.5">
                <span className="text-dense font-medium text-ink wrap-anywhere">{row.name}</span>
                <Barra rotulo="Receita" valor={r.fatiaReceita[row.storeId]} cor="bg-chart-1" />
                <Barra rotulo="Tráfego" valor={row.trafficPercent} cor="bg-chart-2" />
              </li>
            ))}
          </ol>
          {r.totalReceita === 0 && !ninguem ? (
            <p className="text-label text-t2">Sem vendas no período: por enquanto só o tráfego aparece.</p>
          ) : null}
        </Section>
      ) : null}

      <Section
        titulo="Por loja de checkout"
        descricao={`${dias} · pedidos pagos, com reembolso já descontado`}
        espaco="nenhum"
      >
        <DataTable
          legenda={`Vendas por loja de checkout nos últimos ${dados.period} dias`}
          colunas={colunas}
          linhas={linhas}
          densidade="confortavel"
          ordenacaoInicial={multi ? [] : [{ chave: "receita", direcao: "desc" }]}
          rodape={{
            loja: parcial && !ninguem ? "Total parcial" : "Total",
            pedidos: ninguem ? "—" : inteiro(r.totalPedidos),
            receita: totalReceitaTexto,
            fatiaReceita: r.totalReceita ? "100%" : "—",
            trafego: somaTrafego(rows) > 0 ? "100%" : "—",
          }}
          className="[&>ul]:pt-3"
        />
        <ul className="flex list-disc flex-col gap-1 border-t border-border-subtle py-3 pr-4 pl-8 text-label text-t2">
          <li>
            Pedido pago, já com reembolso. Pedido de teste e cancelado ficam de fora. Loja que não respondeu aparece
            como “—”, nunca como zero.
          </li>
          <li>A Shopify libera no máximo os últimos {dados.maxDays} dias de pedidos com a permissão que o xcart pede.</li>
          <li>
            Pedido que chega pela rota não leva a origem do anúncio para a loja de checkout: no rastreamento, ele aparece
            sem atribuição.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Barra({ rotulo, valor, cor }: { rotulo: string; valor: number | null; cor: string }) {
  return (
    <span className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2">
      <span className="text-label text-t2">{rotulo}</span>
      <span aria-hidden className="relative h-2.5 overflow-hidden rounded-xs bg-track">
        <span className={cn("absolute inset-y-0 left-0 rounded-xs", cor)} style={{ width: `${valor ?? 0}%` }} />
      </span>
      <span className="num text-right text-dense font-semibold text-ink">{valor === null ? "—" : `${valor}%`}</span>
    </span>
  );
}
