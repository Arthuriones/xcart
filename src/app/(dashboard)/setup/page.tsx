import { Check } from "lucide-react";
import Link from "next/link";
import { getSetupStatus } from "@/lib/setup/status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const status = await getSetupStatus();
  const pronta = status.next === null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {pronta ? "Sua operação está no ar" : "Configure sua operação"}
        </h1>
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-t2">
          {pronta
            ? "Todos os passos concluídos. O roteamento está valendo para os pedidos reais."
            : "Sete passos para conectar sua vitrine às lojas de checkout. Você pode parar e continuar depois."}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <span className="text-[12.5px] font-medium text-ink">
              Configuração da operação
            </span>
            <span className="font-mono text-[12px] tabular-nums text-t2">
              {status.percent}%
            </span>
          </div>

          <ol className="flex flex-col">
            {status.steps.map((step, i) => {
              const atual = status.next?.id === step.id;
              return (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3.5",
                    i > 0 && "border-t border-[var(--border-subtle)]",
                    atual && "bg-surface-2"
                  )}
                >
                  {/* Numero vira marca de concluido: a lista E uma sequencia,
                      entao o marcador carrega ordem e estado ao mesmo tempo. */}
                  <span
                    className={cn(
                      "mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full font-mono text-[9.5px] tabular-nums",
                      step.done
                        ? "bg-[var(--ok)] text-white"
                        : atual
                          ? "bg-[var(--solid)] text-[var(--on-solid)]"
                          : "border border-[var(--border-strong)] text-t4"
                    )}
                  >
                    {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : String(i + 1).padStart(2, "0")}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-[13px] leading-snug",
                        step.done ? "text-t3" : "font-medium text-ink"
                      )}
                    >
                      {step.title}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-t3">
                      {step.description}
                    </span>
                  </span>

                  {atual && (
                    <Link
                      href={step.href}
                      className="shrink-0 rounded-md bg-[var(--solid)] px-3 py-1.5 text-[12px] font-medium text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
                    >
                      {step.cta}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <aside className="flex flex-col gap-2">
          <p className="px-0.5 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-t4">
            O que você está montando
          </p>

          <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
            <span className="flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--vitrine)" }}
                aria-hidden
              />
              <span className="text-[12.5px] font-medium text-ink">
                {status.vitrineName || "Sua vitrine"}
              </span>
            </span>
            <span className="mt-0.5 block pl-[14px] text-[11px] text-t3">
              {status.vitrineName ? "recebe o tráfego" : "não conectada"}
            </span>
          </div>

          {/* A caixa escura no meio e o xcart: e ele que decide o destino.
              O contraste diz que aqui algo acontece, nao e so mais um card. */}
          <div className="rounded-lg bg-[var(--solid)] px-3.5 py-3 text-[var(--on-solid)]">
            <span className="block text-[12.5px] font-medium">XCART</span>
            <span className="mt-0.5 block font-mono text-[11px] opacity-70">
              {status.routeActive ? "dividindo o tráfego" : "aguardando lojas"}
            </span>
          </div>

          {status.checkoutNames.length > 0 ? (
            status.checkoutNames.map((nome) => (
              <div
                key={nome}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--checkout)" }}
                    aria-hidden
                  />
                  <span className="truncate text-[12.5px] text-ink">{nome}</span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-t4">cobra</span>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-strong)] px-3.5 py-2.5">
              <span className="text-[12px] text-t3">Nenhuma loja de checkout ainda</span>
            </div>
          )}

          <p className="mt-1 px-0.5 text-[11.5px] leading-relaxed text-t3">
            A vitrine recebe as visitas. O xcart mantém os produtos ligados por SKU e
            decide qual loja de checkout cobra cada carrinho.
          </p>
        </aside>
      </div>
    </div>
  );
}
