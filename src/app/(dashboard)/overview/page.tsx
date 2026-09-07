import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getOverview, type OverviewTarget } from "@/lib/overview/queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  return `${Math.round(h / 24)} d atrás`;
}

const COR_ESTADO: Record<OverviewTarget["state"], string> = {
  ok: "var(--ok)",
  paused: "var(--t4)",
  attention: "var(--warn)",
};

const TEXTO_ESTADO: Record<OverviewTarget["state"], string> = {
  ok: "Ativo",
  paused: "Pausado",
  attention: "Atenção",
};

function Numero({
  valor,
  rotulo,
  nota,
  alerta,
}: {
  valor: string | number;
  rotulo: string;
  nota: string;
  alerta?: boolean;
}) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[11.5px] text-t3">{rotulo}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[22px] font-medium leading-none tabular-nums",
            alerta ? "text-[var(--err)]" : "text-ink"
          )}
        >
          {valor}
        </span>
        <span className="text-[11px] text-t3">{nota}</span>
      </p>
    </div>
  );
}

export default async function OverviewPage() {
  const o = await getOverview();

  if (!o.routeName) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
          Nada acontecendo ainda
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-t2">
          Quando sua vitrine estiver ligada a uma loja de checkout, o movimento da
          operação aparece aqui.
        </p>
        <Link
          href="/setup"
          className="mt-5 rounded-md bg-[var(--solid)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
        >
          Configurar operação
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {o.issues.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3">
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-[var(--warn)]"
            strokeWidth={2}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">
              {o.issues.length === 1
                ? "1 item precisa da sua atenção"
                : `${o.issues.length} itens precisam da sua atenção`}
            </span>
            <span className="mt-0.5 block text-[12px] text-t2">
              {o.chargingCount} de {o.checkoutCount} lojas de checkout cobrando
              {o.mappedVariants > 0 && ` · ${o.mappedVariants} produtos ligados`}
            </span>
          </span>
          <Link
            href="#requer-atencao"
            className="shrink-0 rounded-md border border-[var(--warn-border)] bg-surface px-3 py-1.5 text-[12px] font-medium text-ink"
          >
            Ver o que fazer
          </Link>
        </div>
      )}

      <div className="grid divide-y divide-[var(--border-subtle)] rounded-xl border border-border bg-surface sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        <Numero
          valor={o.storeCount}
          rotulo="Lojas"
          nota={`${o.vitrineCount} vitrine · ${o.checkoutCount} checkout`}
        />
        <Numero
          valor={o.chargingCount}
          rotulo="Lojas cobrando"
          nota={`de ${o.checkoutCount} conectadas`}
        />
        <Numero valor={o.mappedVariants} rotulo="Produtos ligados" nota="por SKU" />
        <Numero
          valor={o.issues.length}
          rotulo="Problemas"
          nota={o.issues.length ? "requerem ação" : "tudo certo"}
          alerta={o.issues.length > 0}
        />
      </div>

      <section className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span className="text-[12.5px] font-medium text-ink">Sua operação</span>
          <Link
            href="/clone/routed-checkout"
            className="inline-flex items-center gap-1 text-[12px] text-t2 hover:text-ink"
          >
            Roteamento
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>

        <div className="grid items-center gap-4 px-4 py-5 lg:grid-cols-[minmax(0,200px)_minmax(0,180px)_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
            <span className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--vitrine)" }}
                aria-hidden
              />
              <span className="truncate text-[12.5px] font-medium text-ink">
                {o.vitrineName || "vitrine"}
              </span>
            </span>
            <span className="mt-0.5 block pl-[14px] font-mono text-[10.5px] text-t3">
              vitrine
            </span>
          </div>

          <div className="rounded-lg bg-[var(--solid)] px-3.5 py-3 text-[var(--on-solid)]">
            <span className="block text-[12.5px] font-medium">XCART</span>
            <span className="mt-0.5 block font-mono text-[10.5px] opacity-70">
              {o.routeEnabled ? o.rotationLabel : "rota pausada"}
            </span>
          </div>

          <ul className="flex flex-col gap-px">
            {o.targets.map((alvo) => (
              <li key={alvo.id} className="flex items-center gap-3 py-1.5">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: COR_ESTADO[alvo.state] }}
                  aria-hidden
                />
                <span className="w-[120px] shrink-0 truncate text-[12.5px] text-ink">
                  {alvo.name}
                </span>
                <span
                  className="w-[58px] shrink-0 text-[11px]"
                  style={{ color: COR_ESTADO[alvo.state] }}
                >
                  {TEXTO_ESTADO[alvo.state]}
                </span>
                <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--track)]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${alvo.sharePercent}%`,
                      background: alvo.state === "ok" ? "var(--ink)" : "var(--t4)",
                    }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-t2">
                  {alvo.sharePercent > 0 ? `${alvo.sharePercent}%` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {o.issues.length > 0 && (
        <section id="requer-atencao" className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <span className="text-[12.5px] font-medium text-ink">Requer atenção</span>
          </div>
          <ul className="flex flex-col">
            {o.issues.map((issue, i) => (
              <li
                key={issue.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  i > 0 && "border-t border-[var(--border-subtle)]"
                )}
              >
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--err)" }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">
                    {issue.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-t3">
                    {issue.detail}
                  </span>
                </span>
                <Link
                  href={issue.href}
                  className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-[var(--border-strong)]"
                >
                  {issue.cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <span className="text-[12.5px] font-medium text-ink">Atividade recente</span>
        </div>
        {o.activity.length === 0 ? (
          <p className="px-4 py-6 text-[12.5px] text-t3">
            Nada registrado ainda. Os eventos aparecem aqui assim que a vitrine começar a
            rotear compradores.
          </p>
        ) : (
          <ul className="flex flex-col">
            {o.activity.map((ev, i) => (
              <li
                key={ev.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  i > 0 && "border-t border-[var(--border-subtle)]"
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      ev.kind === "ok"
                        ? "var(--ok)"
                        : ev.kind === "err"
                          ? "var(--err)"
                          : "var(--warn)",
                  }}
                  aria-hidden
                />
                <span className="shrink-0 text-[12.5px] text-ink">{ev.label}</span>
                {ev.detail && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-t3">
                    {ev.detail}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-t4">
                  {quando(ev.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
