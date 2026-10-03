import { BarList } from "@/components/ui/bar-list";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { LineChart } from "@/components/ui/line-chart";
import { Section } from "@/components/ui/section";
import { STATUS } from "@/components/ui/status-badge";
import { BotaoAtualizar } from "../estados-admin";
import { diaMes, dolares, hora, inteiro, naMoeda, plural, reais, rotuloAcao, rotuloMes } from "../formato";
import type { AnaliseAdmin } from "../tipos";

/** Uso e custos prontos, so com dados (a leitura fica no page.tsx). */
export function Uso({ a, lidoEm }: { a: AnaliseAdmin; lidoEm: number }) {
  const imagens = a.byAction.find((x) => x.action === "neutralize_image");
  const custo30 = a.byDay.reduce((s, d) => s + d.costUsd, 0);
  const usos30 = a.byAction.reduce((s, x) => s + x.count, 0);
  const primeiroDia = a.byDay[0]?.date;
  const ultimoDia = a.byDay.at(-1)?.date;
  const mesAtual = a.byMonth.at(-1)?.month;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-label text-t2">
          Receita e margem: mês de {mesAtual ? rotuloMes(mesAtual, "longo") : "agora"}, até agora · custo por dia: últimos
          30 dias · câmbio de relatório US$ 1 = {reais(a.usdBrlRate)} · atualizado às {hora(lidoEm)}
        </p>
        <BotaoAtualizar />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          rotulo="Receita do mês"
          valor={reais(a.revenue.revenueThisMonthBrl)}
          detalhe={`Assinaturas ${reais(a.revenue.mrrBrl, 0)} · créditos ${reais(a.revenue.creditSalesThisMonthBrl, 0)}`}
          definicao="Assinantes Pro × preço do plano (estimado) mais os pacotes de crédito pagos no mês, em reais."
        />
        <KpiCard
          rotulo="Custo de IA no mês"
          valor={reais(a.cost.thisMonthBrl)}
          detalhe={`${naMoeda(a.cost.thisMonthUsd, "USD")} · câmbio ${a.usdBrlRate.toLocaleString("pt-BR")}`}
          definicao="A IA é cobrada em dólar; o valor em reais usa o câmbio de relatório."
        />
        <KpiCard
          rotulo="Margem do mês"
          valor={reais(a.marginBrl)}
          estado={a.marginBrl < 0 ? STATUS.lucro.prejuizo : STATUS.lucro.lucro}
          detalhe="Receita menos custo de IA, em reais"
          definicao="Receita do mês menos o custo de IA convertido para real. Não inclui outros custos."
        />
        <KpiCard
          rotulo="Imagens sem marca"
          valor={inteiro(imagens?.count ?? 0)}
          detalhe={`Últimos 30 dias · ${dolares(imagens?.costUsd ?? 0)}`}
          definicao="Fotos de produto refeitas pela IA sem a marca, nos últimos 30 dias, e quanto custaram."
        />
      </div>

      <Section
        titulo="Custo de IA por dia"
        descricao={
          primeiroDia && ultimoDia
            ? `De ${diaMes(primeiroDia)} a ${diaMes(ultimoDia)} · em dólar · total ${dolares(custo30)}`
            : "Últimos 30 dias · em dólar"
        }
      >
        <LineChart
          descricao={`Custo de IA por dia, em dólar, nos últimos 30 dias. Total ${dolares(custo30)}.`}
          rotulos={a.byDay.map((d) => diaMes(d.date))}
          series={[{ id: "custo", rotulo: "Custo de IA", valores: a.byDay.map((d) => d.costUsd), cor: "chart-3", destaque: true }]}
          formato={{ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 }}
          formatoEixo={{ style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }}
          parcialUltimo
          altura={220}
          vazio={
            <EmptyState
              variante="tracejado"
              className="min-h-55"
              titulo="Nenhum uso de IA em 30 dias"
              descricao="O gráfico aparece com a primeira ação de IA."
            />
          }
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          titulo="Custo por tipo de ação"
          descricao={`Últimos 30 dias · em dólar · ${plural(usos30, "uso", "usos")}`}
        >
          {a.byAction.length === 0 ? (
            <EmptyState
              variante="tracejado"
              className="min-h-48"
              titulo="Nenhum uso de IA em 30 dias"
              descricao="Cada tipo de ação aparece com o primeiro uso."
            />
          ) : (
            <BarList
              rotulo="Custo de IA por tipo de ação"
              itens={a.byAction.map((x) => ({
                id: x.action,
                rotulo: rotuloAcao(x.action),
                valor: x.costUsd,
                valorTexto: dolares(x.costUsd),
                detalhe: `· ${plural(x.count, "uso", "usos")}`,
                cor: "chart-3",
              }))}
            />
          )}
        </Section>

        <Section titulo="Receita e cadastros por mês" descricao="Últimos 6 meses · em reais">
          <BarList
            rotulo="Receita e cadastros por mês"
            itens={a.byMonth.map((m, i) => {
              const atual = i === a.byMonth.length - 1;
              return {
                id: m.month,
                rotulo: atual ? `${rotuloMes(m.month)} · até agora` : rotuloMes(m.month),
                valor: m.revenueBrl,
                valorTexto: reais(m.revenueBrl, 0),
                detalhe: `· ${plural(m.newUsers, "cadastro", "cadastros")}`,
                cor: "chart-2",
              };
            })}
          />
          <p className="text-label text-t2">
            Nos meses passados a barra mostra só créditos vendidos: o histórico da assinatura não é guardado. O mês atual
            soma a assinatura estimada.
          </p>
        </Section>
      </div>
    </div>
  );
}
