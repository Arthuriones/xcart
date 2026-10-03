import Link from "next/link";
import { Callout } from "@/components/ui/callout";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { calcularVariacao } from "@/components/ui/variacao";
import { ROTULO_PERIODO, rotuloFuso, rotuloIntervalo } from "@/components/layout/contexto";
import {
  lerAlertasDaLoja,
  lerFinanceiroDaLoja,
  lerRastreamentoDaLoja,
  type LojaBase,
} from "@/lib/leitura/resumo-lojas";
import { SELO_CONEXAO, diaDe, plural, quandoFoi } from "@/lib/leitura/lojas-estado";
import { quando, type Saude } from "@/app/(dashboard)/tracking/saude";
import { LinkComLoja } from "./acoes-loja";
import { ESTADO_LUCRO, dinheiroKpi, numero, vezes } from "./formato";

const LINK = "mt-auto self-start rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const SELO_SAUDE: Record<Saude, { tom: "ok" | "warn" | "err" | "neutral"; texto: string }> = {
  ok: STATUS.saude.tudoCerto,
  atencao: STATUS.saude.atencao,
  parado: STATUS.saude.parado,
  desligado: STATUS.saude.desligado,
};

/** Visao geral: numeros do periodo, rastreamento, alertas e conexao. */
export async function AbaVisao({ base }: { base: LojaBase }) {
  const [fin, alertas, rast] = await Promise.allSettled([
    lerFinanceiroDaLoja(base),
    lerAlertasDaLoja(base.id),
    lerRastreamentoDaLoja(base.id, false),
  ]);
  if (fin.status === "rejected") console.error("[loja] financeiro", fin.reason);
  if (alertas.status === "rejected") console.error("[loja] alertas", alertas.reason);
  if (rast.status === "rejected") console.error("[loja] rastreamento", rast.reason);

  return (
    <div className="flex flex-col gap-4">
      {fin.status === "fulfilled" ? (
        <Numeros dados={fin.value} lojaId={base.id} />
      ) : (
        <Callout tom="warn" titulo="Não deu para calcular os números desta loja agora">
          Faturamento e lucro voltam quando a leitura responder. Recarregue a página em instantes.
        </Callout>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Section titulo="Rastreamento" nivel={2} className="min-h-40">
          {rast.status === "fulfilled" ? (
            <>
              <StatusBadge {...SELO_SAUDE[rast.value.saude]} />
              {rast.value.saude === "desligado" ? (
                <p className="text-dense text-t1">O rastreamento não está ligado nesta loja.</p>
              ) : rast.value.motivos.length > 0 ? (
                <ul className="flex flex-col gap-1 text-dense text-t1">
                  {rast.value.motivos.slice(0, 2).map((m) => (
                    <li key={m.texto}>{m.texto}</li>
                  ))}
                  {rast.value.motivos.length > 2 ? (
                    <li className="text-label text-t2">e mais {rast.value.motivos.length - 2}</li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-dense text-t1">Os envios dos últimos 7 dias estão saindo.</p>
              )}
            </>
          ) : (
            <p className="text-dense text-t2">Não deu para ler o rastreamento agora.</p>
          )}
          <Link href={`/stores/${base.id}?aba=rastreamento`} scroll={false} className={LINK}>
            Conferir na Shopify
          </Link>
        </Section>

        <Section titulo="Alertas abertos" nivel={2} className="min-h-40">
          {alertas.status === "fulfilled" ? (
            alertas.value.total === 0 ? (
              <p className="text-dense text-t1">Nenhum alerta aberto nesta loja.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-dense">
                {alertas.value.itens.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5">
                    <span>
                      <strong className={a.severidade === "critico" ? "font-semibold text-err" : "font-semibold text-warn"}>
                        {a.severidade === "critico" ? "Crítico:" : "Aviso:"}
                      </strong>{" "}
                      {a.titulo}
                    </span>
                    <span className="text-label text-t2">Aberto {quando(a.abertoEm)}</span>
                  </li>
                ))}
                {alertas.value.total > alertas.value.itens.length ? (
                  <li className="text-label text-t2">
                    e mais {alertas.value.total - alertas.value.itens.length}
                  </li>
                ) : null}
              </ul>
            )
          ) : (
            <p className="text-dense text-t2">Não deu para ler os alertas agora.</p>
          )}
          <LinkComLoja lojaId={base.id} href="/alertas" className={LINK}>
            Ver alertas da loja
          </LinkComLoja>
        </Section>

        <Section titulo="Conexão" nivel={2} className="min-h-40">
          <StatusBadge {...SELO_CONEXAO[base.conexao.chave]} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-dense">
            <dt className="text-t2">Situação</dt>
            <dd className="text-ink">{base.conexao.detalhe}</dd>
            <dt className="text-t2">Última busca</dt>
            <dd className="num text-ink">{quandoFoi(base.sync?.ultimoSyncOkEm, new Date()) ?? "—"}</dd>
            <dt className="text-t2">Pedidos</dt>
            <dd className="num text-ink">
              {base.sync ? plural(base.sync.pedidosTotal, "sincronizado", "sincronizados") : "—"}
            </dd>
            <dt className="text-t2">Conectada em</dt>
            <dd className="num text-ink">{diaDe(base.criadaEm) ?? "—"}</dd>
          </dl>
          <p className="text-label text-t2">O histórico começa uns 60 dias antes da conexão.</p>
        </Section>
      </div>
    </div>
  );
}

function Numeros({
  dados,
  lojaId,
}: {
  dados: Awaited<ReturnType<typeof lerFinanceiroDaLoja>>;
  lojaId: string;
}) {
  const { resultado: r, filtro, comparacao, fuso } = dados;
  const moeda = r.moeda;
  const a = r.atual;
  const p = r.anterior;
  const comparar = comparacao === "anterior";
  const linha = r.porLoja[0];
  // porDia vem do mais novo para o mais velho; a sparkline le da esquerda.
  const dias = [...r.porDia].reverse();
  const varia = (atual: number, anterior: number) => (comparar ? calcularVariacao(atual, anterior) : undefined);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-t2">
        <span>
          {ROTULO_PERIODO[filtro.periodo]} · {rotuloIntervalo(r.intervalos.atual)} · {rotuloFuso(fuso)} · {moeda}
        </span>
        <LinkComLoja
          lojaId={lojaId}
          href="/financeiro"
          className="rounded-sm font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ver no Lucro
        </LinkComLoja>
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          rotulo="Faturamento"
          valor={dinheiroKpi(a.receita, moeda)}
          variacao={varia(a.receita, p.receita)}
          anterior={comparar ? dinheiroKpi(p.receita, moeda) : undefined}
          serie={dias.map((d) => d.receita)}
        />
        <KpiCard
          rotulo="Lucro estimado"
          valor={dinheiroKpi(a.lucro, moeda)}
          variacao={varia(a.lucro, p.lucro)}
          anterior={comparar ? dinheiroKpi(p.lucro, moeda) : undefined}
          estado={linha ? ESTADO_LUCRO[linha.semaforo] : undefined}
          definicao="Faturamento menos produto, frete, taxas e anúncio. Estimado, não contábil."
          serie={dias.map((d) => d.lucro)}
        />
        <KpiCard
          rotulo="Pedidos"
          valor={numero(a.pedidos)}
          variacao={varia(a.pedidos, p.pedidos)}
          anterior={comparar ? numero(p.pedidos) : undefined}
          detalhe={a.reenvios > 0 ? `+ ${plural(a.reenvios, "reenvio", "reenvios")}` : undefined}
          serie={dias.map((d) => d.pedidos)}
        />
        <KpiCard
          rotulo="ROAS real"
          valor={vezes(a.roas)}
          motivoSemDado="Sem gasto de anúncio no período"
          variacao={a.roas !== null && p.roas !== null ? varia(a.roas, p.roas) : comparar ? null : undefined}
          anterior={comparar ? (vezes(p.roas) ?? undefined) : undefined}
          detalhe={a.roasEquilibrio !== null ? `equilíbrio ${vezes(a.roasEquilibrio)}` : undefined}
          definicao="Faturamento dividido pelo gasto em anúncio. Abaixo do equilíbrio, o anúncio dá prejuízo."
        />
      </div>
    </div>
  );
}
