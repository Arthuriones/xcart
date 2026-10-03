import Link from "next/link";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { ErroAdmin } from "./estados-admin";
import { hora, inteiro, plural, reais, reaisKpi } from "./formato";
import type { FaturamentoAdmin } from "@/lib/sales/admin-types";
import { lerFaturamento } from "./ler-api";

const LINK_ACAO =
  "rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const TITULO = "Faturamento dos clientes";
const DESCRICAO = "Últimos 30 dias · pedidos pagos nas lojas de checkout com rota";

function VerDetalhe() {
  return (
    <Link href="/admin/faturamento" className={LINK_ACAO}>
      Ver por cliente
    </Link>
  );
}

/** Mesma geometria do bloco pronto: numero grande e cinco linhas. */
export function EsqueletoBlocoFaturamento() {
  return (
    <Section titulo={TITULO} descricao={DESCRICAO} aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <div className="flex flex-col gap-3 pt-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      <p className="text-label text-t2">Perguntando a cada loja de checkout na Shopify…</p>
    </Section>
  );
}

/**
 * Dinheiro do CLIENTE, nao do xcart: fica num bloco separado de proposito,
 * para nao se confundir com a receita. Pergunta a cada loja de checkout na
 * Shopify (leva segundos), por isso mora no proprio Suspense.
 */
export async function BlocoFaturamento() {
  const r = await lerFaturamento("30");
  if (!r.ok) {
    return (
      <Section titulo={TITULO} descricao={DESCRICAO} acoes={<VerDetalhe />}>
        <ErroAdmin
          compacto
          titulo="Não deu para perguntar às lojas agora"
          descricao="O resto do painel está certo. Tente de novo em instantes."
          detalhe={r.detalhe}
        />
      </Section>
    );
  }

  return <VistaBlocoFaturamento g={r.dados} />;
}

/** O bloco pronto, so com dados. */
export function VistaBlocoFaturamento({ g }: { g: FaturamentoAdmin }) {
  const semResposta = g.deniedCount + g.failedCount;
  const ninguemRespondeu = g.storeCount > 0 && semResposta >= g.storeCount;
  const ranking = g.usuarios.filter((u) => u.lojasComDados > 0).slice(0, 5);

  return (
    <Section
      titulo={TITULO}
      descricao={`${DESCRICAO} · apurado às ${hora(g.computedAt)}`}
      acoes={<VerDetalhe />}
    >
      {g.storeCount === 0 ? (
        <EmptyState
          variante="tracejado"
          className="min-h-56"
          titulo="Nenhuma loja de checkout com rota ligada"
          descricao="Esta conta só olha lojas que recebem comprador por rota."
        />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="num text-kpi text-ink">
              {ninguemRespondeu ? "—" : reaisKpi(g.totalRevenueBrlCents / 100)}
            </span>
            <span className="num text-label text-t2">
              {ninguemRespondeu
                ? "Nenhuma loja respondeu"
                : `${plural(g.totalOrders, "pedido pago", "pedidos pagos")} · ${plural(g.storeCount, "loja de checkout", "lojas de checkout")}`}
            </span>
          </div>

          {semResposta > 0 && !ninguemRespondeu ? (
            <Callout tom="warn" titulo="Total incompleto">
              {inteiro(semResposta)} de {inteiro(g.storeCount)} lojas{" "}
              {semResposta === 1 ? "não respondeu" : "não responderam"}. O total conta só as que responderam.
            </Callout>
          ) : null}

          {ranking.length === 0 ? (
            <p className="text-dense text-t2">Nenhuma loja de checkout entregou números ainda.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-label font-medium text-t2">Quem mais fatura</h3>
              <ol className="flex flex-col">
                {ranking.map((u, i) => (
                  <li
                    key={u.userId}
                    className="flex min-h-10 items-center gap-2 border-b border-border-subtle text-dense last:border-0"
                  >
                    <span className="num w-6 shrink-0 text-label text-t2">{i + 1}º</span>
                    <Link
                      href={`/admin/users/${u.userId}`}
                      className="min-w-0 truncate rounded-sm text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {u.email}
                    </Link>
                    <span className="num ml-auto shrink-0 text-label text-t2">
                      {plural(u.orders, "pedido", "pedidos")}
                    </span>
                    <span className="num w-28 shrink-0 text-right font-medium text-ink">
                      {reais(u.revenueBrlCents / 100, 0)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-label text-t2">
            Quem vende sem rota (anúncio direto na loja de checkout) ainda não entra nesta conta.
          </p>
        </>
      )}
    </Section>
  );
}
