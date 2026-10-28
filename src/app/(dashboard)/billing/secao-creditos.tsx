import { Section } from "@/components/ui/section";
import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";
import { creditos } from "@/components/billing/regras";

function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Saldo e uso do mes, com o que 1 credito compra. O custo interno de IA em
 * dolar (que a tela antiga mostrava) nao aparece: e numero do xcart, nao do
 * lojista. Uso que nao veio vira "—", nunca 0.
 */
export function SecaoCreditos({
  saldo,
  usadosNoMes,
  inicioDoMes,
  erroUso,
  pro,
  cobrancaLigada,
}: {
  saldo: number;
  usadosNoMes: number | null;
  inicioDoMes: string;
  erroUso: string | null;
  pro: boolean;
  cobrancaLigada: boolean;
}) {
  const notas: string[] = [];
  // Renovacao do cartao (reset_ai_credits, 082) e Pix de 30 dias SOMAM: uma
  // regra so para os dois.
  if (pro) notas.push(`O plano soma ${creditos(PRO_INCLUDED_CREDITS)} por mês. Nenhuma vence.`);
  if (!cobrancaLigada) notas.push("Por enquanto, refazer fotos não desconta do saldo.");

  return (
    <Section
      titulo="Fotos com IA"
      descricao="Refaz sem marca a foto principal do produto, no roteamento e na importação. Texto e tradução são grátis."
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-2 p-3">
          <dt className="text-label font-medium text-t1">Disponíveis</dt>
          <dd className="num text-kpi text-ink">{saldo.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-2 p-3">
          <dt className="text-label font-medium text-t1">Usadas este mês</dt>
          <dd className="num text-kpi text-ink">
            {usadosNoMes === null ? "—" : usadosNoMes.toLocaleString("pt-BR")}
          </dd>
          <dd className="text-label text-t2">
            {usadosNoMes === null && erroUso ? "Não deu para somar agora" : `Desde ${diaMes(inicioDoMes)}`}
          </dd>
        </div>
      </dl>

      {notas.length > 0 ? (
        <ul className="flex flex-col gap-1 text-label text-t2">
          {notas.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
