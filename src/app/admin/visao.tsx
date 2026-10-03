import type { ReactNode } from "react";
import Link from "next/link";
import { BarList } from "@/components/ui/bar-list";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { BotaoAtualizar } from "./estados-admin";
import {
  cadastrosPorMes,
  dataCurta,
  hora,
  inteiro,
  naMoeda,
  plural,
  reais,
  rotuloMes,
  rotuloPlano,
} from "./formato";
import type { VisaoAdmin } from "./tipos";

const LINK =
  "rounded-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const LINK_ACAO =
  "rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * A visao geral pronta, so com dados (a leitura fica no page.tsx). O bloco de
 * faturamento dos clientes chega por `faturamento`: ele tem leitura propria,
 * lenta, dentro do proprio Suspense.
 */
export function Visao({ d, lidoEm, faturamento }: { d: VisaoAdmin; lidoEm: number; faturamento: ReactNode }) {
  const s = d.summary;
  const porMes = d.revenueByMonth;
  const meses = porMes.map((m) => m.mes);
  const mesAtual = porMes.at(-1);
  const mesPassado = porMes.at(-2);
  const cadastros = cadastrosPorMes(
    d.users.map((u) => u.createdAt),
    meses
  );
  const receitaMes = s.mrrBrl + s.creditRevenueMonthBrl;
  const margem = s.grossMarginMonthBrl;
  const contasComLoja = d.users.filter((u) => u.stores.length > 0).length;

  const consumidores = d.users
    .filter((u) => u.usageThisMonth.costUsd > 0)
    .slice(0, 10)
    .map((u) => ({
      id: u.id,
      usuario: (
        <Link href={`/admin/users/${u.id}`} className={LINK}>
          {u.email}
        </Link>
      ),
      email: u.email,
      plano: rotuloPlano(u.plan),
      lojas: u.stores.length,
      creditos: u.usageThisMonth.credits,
      creditosTexto: inteiro(u.usageThisMonth.credits),
      custo: u.usageThisMonth.costBrl,
      custoTexto: reais(u.usageThisMonth.costBrl),
    }));

  const compras = d.recentPurchases.map((c, i) => ({
    id: `${c.createdAt}-${i}`,
    quem: c.email,
    creditos: c.credits,
    creditosTexto: inteiro(c.credits),
    valor: c.amountBrl,
    valorTexto: naMoeda(c.amountBrl, c.currency),
    quando: Date.parse(c.createdAt),
    quandoTexto: dataCurta(c.createdAt),
  }));

  const recentes = d.users
    .filter((u) => u.createdAt)
    .sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!))
    .slice(0, 8)
    .map((u) => ({
      id: u.id,
      usuario: (
        <Link href={`/admin/users/${u.id}`} className={LINK}>
          {u.email}
        </Link>
      ),
      email: u.email,
      plano: rotuloPlano(u.plan),
      acesso: u.hasAccess ? (
        <StatusBadge tom="ok" texto="Com acesso" />
      ) : (
        <StatusBadge tom="neutral" texto="Sem acesso" />
      ),
      acessoOrdem: u.hasAccess ? 0 : 1,
      cadastro: Date.parse(u.createdAt!),
      cadastroTexto: dataCurta(u.createdAt),
    }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-label text-t2">
          {mesAtual ? `Mês de ${rotuloMes(mesAtual.mes, "longo")}, até agora` : "Mês corrente"} · em reais ·
          câmbio de relatório US$ 1 = {reais(s.usdBrlRate)} · atualizado às {hora(lidoEm)}
        </p>
        <BotaoAtualizar />
      </div>

      <section aria-labelledby="t-dinheiro" className="flex flex-col gap-3">
        <h2 id="t-dinheiro" className="text-section text-ink">
          Receita e custo do mês
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            rotulo="Receita do mês"
            valor={reais(receitaMes)}
            detalhe={`Assinaturas ${reais(s.mrrBrl, 0)} · créditos ${reais(s.creditRevenueMonthBrl, 0)}`}
            definicao="Assinantes Pro × preço do plano, mais os pacotes de crédito pagos no mês. A parte da assinatura é estimada: não desconta cupom nem atraso."
            href="/admin/usage"
          />
          <KpiCard
            rotulo="Custo de IA"
            valor={reais(s.aiCostThisMonthBrl)}
            detalhe={`${naMoeda(s.aiCostThisMonthUsd, "USD")} · câmbio ${s.usdBrlRate.toLocaleString("pt-BR")}`}
            definicao="O que a IA custou no mês. É cobrado em dólar e convertido pelo câmbio de relatório."
            href="/admin/usage"
          />
          <KpiCard
            rotulo="Margem do mês"
            valor={reais(margem)}
            estado={margem < 0 ? STATUS.lucro.prejuizo : STATUS.lucro.lucro}
            detalhe="Receita menos custo de IA"
            definicao="Receita do mês (assinatura estimada + créditos) menos o custo de IA. Não inclui outros custos."
          />
          <KpiCard
            rotulo="Créditos vendidos"
            valor={reais(s.creditRevenueMonthBrl)}
            detalhe={mesAtual ? plural(mesAtual.compras, "compra no mês", "compras no mês") : undefined}
            comparacao={mesPassado ? `Mês passado inteiro: ${reais(mesPassado.creditoBrl, 0)}` : undefined}
            serie={porMes.map((m) => m.creditoBrl)}
            definicao="Pacotes de crédito pagos no mês. A linha mostra os últimos 6 meses."
          />
        </div>
      </section>

      <section aria-labelledby="t-base" className="flex flex-col gap-3">
        <h2 id="t-base" className="text-section text-ink">
          Base de clientes
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            rotulo="Usuários"
            valor={inteiro(s.totalUsers)}
            detalhe={plural(s.newUsersThisMonth, "novo no mês", "novos no mês")}
            comparacao={
              cadastros.length > 1 ? `Mês passado: ${plural(cadastros.at(-2) ?? 0, "cadastro", "cadastros")}` : undefined
            }
            serie={cadastros}
            definicao="Contas criadas no xcart. A linha mostra os cadastros por mês nos últimos 6 meses."
            href="/admin/users"
          />
          <KpiCard
            rotulo="Pagantes"
            valor={inteiro(s.payingUsers)}
            detalhe={`${inteiro(s.proUsers)} no plano Pro`}
            definicao="Quem está no plano Pro ou já comprou crédito alguma vez."
            href="/admin/users?plano=pro"
          />
          <KpiCard
            rotulo="Com acesso"
            valor={inteiro(s.withAccess)}
            detalhe={`de ${plural(s.totalUsers, "usuário", "usuários")}`}
            definicao="Administrador, plano Pro ou liberado à mão no admin."
            href="/admin/users?acesso=com"
          />
          <KpiCard
            rotulo="Lojas conectadas"
            valor={inteiro(s.totalStores)}
            detalhe={`em ${plural(contasComLoja, "conta", "contas")}`}
            definicao="Lojas Shopify conectadas por todos os clientes, ativas ou não."
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          titulo="Receita de crédito"
          descricao={`Últimos 6 meses · ${plural(s.creditPurchasesTotal, "compra", "compras")} e ${reais(s.creditRevenueTotalBrl, 0)} desde o início`}
        >
          {porMes.every((m) => m.compras === 0) ? (
            <EmptyState
              variante="tracejado"
              className="min-h-56"
              titulo="Nenhuma venda de crédito em 6 meses"
              descricao="As barras aparecem com a primeira compra de pacote."
            />
          ) : (
            <BarList
              rotulo="Receita de crédito por mês"
              itens={porMes.map((m, i) => ({
                id: m.mes,
                rotulo: i === porMes.length - 1 ? `${rotuloMes(m.mes)} · até agora` : rotuloMes(m.mes),
                valor: m.creditoBrl,
                valorTexto: reais(m.creditoBrl, 0),
                detalhe: `· ${plural(m.compras, "compra", "compras")}`,
                cor: "chart-2",
              }))}
            />
          )}
        </Section>

        {faturamento}
      </div>

      <Section
        titulo="Maiores consumidores de IA no mês"
        descricao="Os 10 clientes que mais gastaram IA no mês, em reais"
        acoes={
          <Link href="/admin/usage" className={LINK_ACAO}>
            Ver uso e custos
          </Link>
        }
        espaco="nenhum"
      >
        <DataTable
          legenda="Maiores consumidores de IA no mês"
          colunas={[
            { chave: "usuario", titulo: "Usuário", ordenarPor: "email", className: "min-w-56" },
            { chave: "plano", titulo: "Plano" },
            { chave: "lojas", titulo: "Lojas", alinhar: "direita" },
            { chave: "creditosTexto", titulo: "Créditos usados", alinhar: "direita", ordenarPor: "creditos" },
            { chave: "custoTexto", titulo: "Custo de IA", alinhar: "direita", ordenarPor: "custo" },
          ]}
          linhas={consumidores}
          ordenacaoInicial={[{ chave: "custoTexto", direcao: "desc" }]}
          vazio={
            <EmptyState
              variante="simples"
              className="min-h-40"
              titulo="Nenhum uso de IA neste mês"
              descricao="A lista aparece quando um cliente usar a IA."
            />
          }
        />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          titulo="Vendas de crédito recentes"
          descricao="As 12 compras de pacote mais novas"
          espaco="nenhum"
        >
          <DataTable
            legenda="Vendas de crédito recentes"
            colunas={[
              { chave: "quem", titulo: "Quem", className: "min-w-48" },
              { chave: "creditosTexto", titulo: "Créditos", alinhar: "direita", ordenarPor: "creditos" },
              { chave: "valorTexto", titulo: "Valor", alinhar: "direita", ordenarPor: "valor" },
              { chave: "quandoTexto", titulo: "Quando", ordenarPor: "quando", direcaoInicial: "desc" },
            ]}
            linhas={compras}
            vazio={
              <EmptyState
                variante="simples"
                className="min-h-40"
                titulo="Nenhuma compra de crédito ainda"
                descricao="As compras aparecem aqui assim que o pagamento cai."
              />
            }
          />
        </Section>

        <Section
          titulo="Cadastros recentes"
          descricao="As 8 contas criadas por último"
          acoes={
            <Link href="/admin/users" className={LINK_ACAO}>
              Ver todos os usuários
            </Link>
          }
          espaco="nenhum"
        >
          <DataTable
            legenda="Cadastros recentes"
            colunas={[
              { chave: "usuario", titulo: "Usuário", ordenarPor: "email", className: "min-w-48" },
              { chave: "plano", titulo: "Plano" },
              { chave: "acesso", titulo: "Acesso", ordenarPor: "acessoOrdem" },
              { chave: "cadastroTexto", titulo: "Cadastro", ordenarPor: "cadastro", direcaoInicial: "desc" },
            ]}
            linhas={recentes}
            vazio={
              <EmptyState variante="simples" className="min-h-40" titulo="Nenhum cadastro ainda" />
            }
          />
        </Section>
      </div>
    </div>
  );
}
