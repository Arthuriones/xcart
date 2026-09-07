import { getActivity, type ActivityKind } from "@/lib/activity/queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const COR: Record<ActivityKind, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  info: "var(--t4)",
};

function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  const d = new Date(iso);
  const ontem = Math.round(h / 24) === 1;
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (ontem) return `ontem, ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${hora}`;
}

export default async function ActivityPage() {
  const itens = await getActivity();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Atividade
        </h1>
        <span className="font-mono text-[11px] text-t3">
          {itens.length === 0 ? "nada registrado" : `últimos ${itens.length} eventos`}
        </span>
      </div>

      {itens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-surface px-8 py-12 text-center">
          <p className="text-[15px] font-semibold text-ink">Nada aconteceu ainda</p>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[12.5px] leading-relaxed text-t2">
            Conectar uma loja, criar uma rota ou importar produtos aparece aqui, junto
            com cada carrinho que a vitrine rotear.
          </p>
        </div>
      ) : (
        <>
          <ol className="overflow-hidden rounded-xl border border-border bg-surface">
            {itens.map((item, i) => (
              <li
                key={item.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  i > 0 && "border-t border-[var(--border-subtle)]"
                )}
              >
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: COR[item.kind] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-t3">
                    {item.description}
                  </span>
                </span>
                <span className="shrink-0 pt-px font-mono text-[10.5px] text-t4">
                  {quando(item.at)}
                </span>
              </li>
            ))}
          </ol>

          {/* Fechado por padrão: quem opera não precisa do nome da tabela, mas
              quem vem depurar precisa saber de onde a linha veio. */}
          <details className="group">
            <summary className="cursor-pointer list-none text-[12px] text-t3 transition-colors hover:text-ink">
              Detalhes técnicos
              <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                &rsaquo;
              </span>
            </summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3">
              <ul className="flex flex-col gap-1">
                {itens.map((item) => (
                  <li key={item.id} className="font-mono text-[10.5px] text-t3">
                    {item.tech}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
