import Link from "next/link";
import { BarList, type ItemBarra } from "@/components/ui/bar-list";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { LineChart } from "@/components/ui/line-chart";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { calcularVariacao } from "@/components/ui/variacao";
import { ROTULO_PERIODO, diaCurto, rotuloFuso, rotuloIntervalo } from "@/components/layout/contexto";
import { formatarDinheiro } from "@/lib/financeiro/tipos";
import {
  lerConfigFinanceiraDaLoja,
  lerFinanceiroDaLoja,
  type LojaBase,
} from "@/lib/leitura/resumo-lojas";
import { LinkComLoja } from "./acoes-loja";
import { ESTADO_LUCRO, dinheiro, dinheiroKpi, porcento } from "./formato";

const BOTAO = buttonVariants({ variant: "secondary", size: "sm" });

/** Financeiro da loja: KPIs do periodo, composicao do lucro, dia a dia, custos e taxas. */
export async function AbaFinanceiro({ base }: { base: LojaBase }) {
  const [fin, cfg] = await Promise.allSettled([
    lerFinanceiroDaLoja(base),
    lerConfigFinanceiraDaLoja(base.id),
  ]);
  if (fin.status === "rejected") console.error("[loja] financeiro", fin.reason);
  if (cfg.status === "rejected") console.error("[loja] config financeira", cfg.reason);

  if (fin.status === "rejected") {
    return (
      <EmptyState
        titulo="Não deu para calcular os números desta loja agora"
        descricao="Os pedidos continuam guardados; foi o cálculo que falhou. Recarregue em instantes."
        className="py-12"
      />
    );
  }

  const { resultado: r, filtro, comparacao, fuso, hoje } = fin.value;
  const moeda = r.moeda;
  const a = r.atual;
  const p = r.anterior;
  const comparar = comparacao === "anterior";
  const varia = (x: number, y: number) => (comparar ? calcularVariacao(x, y) : undefined);
  const linha = r.porLoja[0];
  const dias = [...r.porDia].reverse();

  // Cascata: cada custo "tira" um pedaco do faturamento, da direita para a esquerda.
  const aposProduto = a.receita - a.cmv;
  const aposTaxas = aposProduto - a.taxas;
  const cascata: ItemBarra[] = [
    { id: "f", rotulo: "Faturamento", valor: a.receita, valorTexto: dinheiro(a.receita, moeda), cor: "chart-2", destaque: true },
    { id: "p", rotulo: "− Produtos e frete", valor: a.cmv, inicio: Math.max(0, aposProduto), cor: "t4", valorTexto: dinheiro(a.cmv, moeda) },
    { id: "t", rotulo: "− Taxas", valor: a.taxas, inicio: Math.max(0, aposTaxas), cor: "t4", valorTexto: dinheiro(a.taxas, moeda) },
    { id: "a", rotulo: "− Anúncio", valor: a.gasto, inicio: Math.max(0, a.lucro), cor: "chart-3", valorTexto: dinheiro(a.gasto, moeda) },
    {
      id: "l",
      rotulo: "Lucro estimado",
      valor: Math.abs(a.lucro),
      cor: a.lucro < 0 ? "err" : "chart-1",
      valorTexto: dinheiro(a.lucro, moeda),
      destaque: true,
    },
  ];

  const avisos = [
    r.avisos.moedasSemCotacao.length > 0
      ? `Sem cotação para ${r.avisos.moedasSemCotacao.join(", ")}: esses valores ficaram de fora.`
      : null,
    r.avisos.cambioAproximado ? "Alguns dias usaram câmbio aproximado (a cotação do dia ainda não chegou)." : null,
    r.avisos.lojasSemCustoPadraoComFalta.length > 0
      ? "Há produtos vendidos sem custo cadastrado e sem custo padrão: o lucro está alto demais."
      : null,
  ].filter((t): t is string => Boolean(t));

  const config = cfg.status === "fulfilled" ? cfg.value : null;
  const moedaLoja = base.moeda || moeda;

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-t2">
        <span>
          {ROTULO_PERIODO[filtro.periodo]} · {rotuloIntervalo(r.intervalos.atual)} · {rotuloFuso(fuso)} · {moeda}
        </span>
        <span>O período e a moeda mudam na tela Lucro.</span>
      </p>

      {avisos.length > 0 ? (
        <Callout tom="warn" titulo="Leia estes números com cuidado">
          <ul className="list-disc pl-4">
            {avisos.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          rotulo="Faturamento"
          valor={dinheiroKpi(a.receita, moeda)}
          variacao={varia(a.receita, p.receita)}
          anterior={comparar ? dinheiroKpi(p.receita, moeda) : undefined}
          detalhe={a.ticket !== null ? `ticket médio ${dinheiro(a.ticket, moeda)}` : undefined}
        />
        <KpiCard
          rotulo="Lucro estimado"
          valor={dinheiroKpi(a.lucro, moeda)}
          variacao={varia(a.lucro, p.lucro)}
          anterior={comparar ? dinheiroKpi(p.lucro, moeda) : undefined}
          estado={linha ? ESTADO_LUCRO[linha.semaforo] : undefined}
          definicao="Faturamento menos produto, frete, taxas e anúncio. Estimado, não contábil."
        />
        <KpiCard
          rotulo="Margem"
          valor={porcento(a.margem)}
          motivoSemDado="Sem faturamento no período"
          formatoVariacao="pp"
          variacao={comparar ? (a.margem !== null && p.margem !== null ? a.margem - p.margem : null) : undefined}
          anterior={comparar ? (porcento(p.margem) ?? undefined) : undefined}
          definicao="Lucro estimado dividido pelo faturamento."
        />
        <KpiCard
          rotulo="Gasto em anúncio"
          valor={dinheiroKpi(a.gasto, moeda)}
          bom="neutro"
          variacao={varia(a.gasto, p.gasto)}
          anterior={comparar ? dinheiroKpi(p.gasto, moeda) : undefined}
          detalhe={`Meta ${dinheiro(a.gastoMeta, moeda)} · Google ${dinheiro(a.gastoGoogle, moeda)}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section titulo="De onde sai o lucro" descricao="Cada custo tira um pedaço do faturamento.">
          {a.receita > 0 || a.gasto > 0 ? (
            <BarList itens={cascata} rotulo="Composição do lucro estimado" />
          ) : (
            <EmptyState variante="simples" titulo="Sem pedidos no período" className="min-h-45" />
          )}
        </Section>

        <Section titulo="Por dia" descricao="Faturamento e lucro estimado de cada dia.">
          {dias.length > 1 ? (
            <LineChart
              rotulos={dias.map((d) => diaCurto(d.dia))}
              descricao={`Faturamento e lucro estimado por dia, ${rotuloIntervalo(r.intervalos.atual)}`}
              formato={{ style: "currency", currency: moeda }}
              parcialUltimo={dias[dias.length - 1]?.dia === hoje}
              series={[
                { id: "f", rotulo: "Faturamento", valores: dias.map((d) => d.receita), cor: "chart-2" },
                { id: "l", rotulo: "Lucro estimado", valores: dias.map((d) => d.lucro), cor: "chart-1", destaque: true },
              ]}
            />
          ) : (
            <EmptyState
              variante="simples"
              className="min-h-45"
              titulo="Um dia só no período"
              descricao="Escolha 7 dias ou mais na tela Lucro para ver a linha."
            />
          )}
        </Section>
      </div>

      <Section
        titulo="Custos e taxas"
        descricao="O que entra no cálculo do lucro desta loja."
        acoes={
          <>
            <LinkComLoja lojaId={base.id} href="/financeiro/custos" className={BOTAO}>
              Abrir Custos desta loja
            </LinkComLoja>
            <LinkComLoja lojaId={base.id} href="/financeiro" className={BOTAO}>
              Ver no Lucro
            </LinkComLoja>
          </>
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-dense sm:grid-cols-[max-content_1fr]">
          <dt className="text-t2">Custo dos produtos</dt>
          <dd className="text-ink">
            {a.coberturaCusto === null
              ? "—"
              : `${porcento(a.coberturaCusto)} do valor vendido no período tem custo cadastrado`}
          </dd>
          <dt className="text-t2">Taxa do gateway</dt>
          <dd className="text-ink">
            {!config ? (
              "Não deu para ler agora"
            ) : config.taxa ? (
              `${Number(config.taxa.taxa_pct).toLocaleString("pt-BR")}% + ${formatarDinheiro(Number(config.taxa.taxa_fixa), moedaLoja)} por pedido`
            ) : (
              <StatusBadge tom="warn">Não cadastrada: o lucro não desconta taxa</StatusBadge>
            )}
          </dd>
          <dt className="text-t2">Custo padrão</dt>
          <dd className="text-ink">
            {config?.taxa?.custo_padrao_pct != null
              ? `${Number(config.taxa.custo_padrao_pct).toLocaleString("pt-BR")}% do preço quando falta o custo do SKU`
              : "—"}
          </dd>
          <dt className="text-t2">Contas de anúncio</dt>
          <dd className="text-ink">
            {!config ? (
              "Não deu para ler agora"
            ) : config.contas.length === 0 ? (
              <span className="flex flex-wrap items-center gap-2">
                Nenhuma conta ligada: o lucro não desconta anúncio.
                <Link href="/financeiro/anuncios" className="font-medium text-brand underline-offset-2 hover:underline">
                  Ligar conta
                </Link>
              </span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {config.contas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {c.plataforma === "google" ? "Google" : "Meta"} · {c.nome}
                    </span>
                    {!c.ativo ? (
                      <StatusBadge tom="neutral">Pausada</StatusBadge>
                    ) : c.ultimoErro ? (
                      <StatusBadge tom="err">Erro</StatusBadge>
                    ) : (
                      <StatusBadge tom="ok">Atualizada</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
      </Section>
    </div>
  );
}
