import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import type { LojaDoSeletor } from "@/lib/financeiro/tipos";
import type { DestinoDeCompra } from "@/lib/leitura/integracoes";
import { estadoDoDestino } from "./regras";

/** Id de pixel longo encurtado: 482938221093 -> 4829…1093. */
function idCurto(conta: string): string {
  return /^\d{11,}$/.test(conta) ? `${conta.slice(0, 4)}…${conta.slice(-4)}` : conta;
}

/**
 * "Para enviar as compras": os destinos de conversao que o rastreamento ja
 * tem, so leitura. Cadastrar, editar e ligar continuam em Saude dos pixels --
 * aqui e o atalho, para o lojista ver lado a lado com a leitura do gasto que
 * sao duas coisas diferentes.
 */
export function EnvioCompras({
  plataforma,
  destinos,
  lojas,
  erro,
}: {
  plataforma: "meta" | "google";
  destinos: DestinoDeCompra[];
  lojas: LojaDoSeletor[];
  erro: string | null;
}) {
  const meta = plataforma === "meta";
  const nomeLoja = new Map(lojas.map((l) => [l.id, l.nome]));
  const id = `envio-${plataforma}`;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-2.5 rounded-card border border-border bg-surface p-4"
    >
      <span className="text-label font-semibold text-t2">Para enviar as compras</span>
      <h3 id={id} className="text-section text-ink">
        {meta ? "Token de conversões, por pixel" : "Tag do Google no navegador (AW-)"}
      </h3>
      {erro ? (
        <p role="alert" className="text-dense text-err">
          Não deu para ler os destinos agora. Eles continuam enviando; confira em Rastreamento.
        </p>
      ) : destinos.length === 0 ? (
        <p className="text-dense text-t1 text-pretty">
          {meta
            ? "Nenhum pixel do Meta cadastrado. As compras não vão para o Meta."
            : "Nenhum AW- do Google cadastrado. As compras não vão para o Google Ads."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {destinos.map((d) => {
            const e = estadoDoDestino({ ...d, plataforma });
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-dense">
                <span className="min-w-36 flex-1">
                  <span className="text-ink">{nomeLoja.get(d.storeId) ?? "Loja removida"}</span>
                  {d.nome ? <span className="text-t2"> · {d.nome}</span> : null}{" "}
                  <span className="font-mono text-label whitespace-nowrap text-t2">{idCurto(d.conta)}</span>
                </span>
                <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
                {e.detalhe ? <span className="w-full text-label text-t2">{e.detalhe}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/tracking"
        className="mt-auto self-start rounded-sm text-dense font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {destinos.length > 0 ? "Gerenciar em Rastreamento" : "Cadastrar em Rastreamento"}
      </Link>
    </section>
  );
}
