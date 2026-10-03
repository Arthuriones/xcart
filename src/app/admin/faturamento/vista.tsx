import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import type { FaturamentoAdmin } from "@/lib/sales/admin-types";
import { BotaoAtualizar } from "../estados-admin";
import { hora, inteiro, plural, reaisKpi, type PeriodoFaturamento } from "../formato";
import { TabelaFaturamento } from "./tabela-faturamento";

/** O faturamento pronto, so com dados (a leitura fica no page.tsx). */
export function Faturamento({ g, periodo }: { g: FaturamentoAdmin; periodo: PeriodoFaturamento }) {
  const dias = Math.min(Number(periodo), g.maxDays);
  const periodoTexto = `últimos ${dias} dias`;
  const periodoTitulo = `Últimos ${dias} dias`;
  const semResposta = g.deniedCount + g.failedCount;
  const responderam = Math.max(0, g.storeCount - semResposta);
  const ninguem = g.storeCount > 0 && responderam === 0;
  const incompleto = semResposta > 0 || g.moedasSemTaxa.length > 0;

  if (g.storeCount === 0) {
    return (
      <EmptyState
        titulo="Nenhuma loja de checkout com rota ligada"
        descricao="Esta tela só olha lojas que recebem comprador por rota."
        className="py-12"
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-label text-t2">
          {periodoTitulo} · em reais · apurado às {hora(g.computedAt)}
        </p>
        <BotaoAtualizar rotulo="Perguntar de novo" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          rotulo="Faturamento no período"
          valor={ninguem ? null : reaisKpi(g.totalRevenueBrlCents / 100)}
          motivoSemDado="Nenhuma loja respondeu"
          detalhe={incompleto && !ninguem ? "Parcial: falta loja ou moeda" : "Convertido para real"}
          definicao="Soma dos pedidos pagos nas lojas de checkout com rota ligada, sem teste e sem cancelado. Moeda de fora vira real pela taxa de relatório."
          className="col-span-2 lg:col-span-1"
        />
        <KpiCard
          rotulo="Pedidos pagos"
          valor={ninguem ? null : inteiro(g.totalOrders)}
          motivoSemDado="Nenhuma loja respondeu"
          detalhe="Sem teste e sem cancelado"
        />
        <KpiCard
          rotulo="Lojas que responderam"
          valor={`${inteiro(responderam)} de ${inteiro(g.storeCount)}`}
          detalhe={semResposta > 0 ? plural(semResposta, "ficou de fora", "ficaram de fora") : "Todas responderam"}
        />
      </div>

      {incompleto ? (
        <Callout tom="warn" titulo="O total está incompleto">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {g.deniedCount > 0 ? (
              <li>
                {g.deniedCount === 1
                  ? "1 loja não deu permissão para ler pedidos."
                  : `${inteiro(g.deniedCount)} lojas não deram permissão para ler pedidos.`}{" "}
                Foram conectadas antes de o xcart pedir essa permissão e precisam ser reautorizadas pelo dono.
              </li>
            ) : null}
            {g.failedCount > 0 ? (
              <li>
                {g.failedCount === 1 ? "1 loja não respondeu" : `${inteiro(g.failedCount)} lojas não responderam`}: app
                desinstalado, plano vencido ou loja em revisão na Shopify.
              </li>
            ) : null}
            {g.moedasSemTaxa.length > 0 ? (
              <li>
                Falta a taxa de conversão de {g.moedasSemTaxa.join(", ")} para real, então esse valor ficou fora do total.
              </li>
            ) : null}
          </ul>
        </Callout>
      ) : null}

      <Section
        titulo="Quem mais fatura"
        descricao={`${periodoTitulo}. Abra um cliente para ver cada loja, na moeda dela e convertida.`}
        espaco="nenhum"
      >
        {g.usuarios.length === 0 ? (
          <EmptyState
            variante="simples"
            className="min-h-45"
            titulo="Nenhum cliente com loja respondendo"
            descricao="Os clientes aparecem quando uma loja de checkout responder."
          />
        ) : (
          <TabelaFaturamento usuarios={g.usuarios} periodoTexto={periodoTexto} />
        )}
        <p className="border-t border-border-subtle px-4 py-2.5 text-label text-t2">
          Só entram lojas de checkout com rota ligada: quem anuncia direto na loja, sem vitrine, ainda fica de fora. A
          Shopify libera no máximo 60 dias de pedidos.
        </p>
      </Section>
    </div>
  );
}
