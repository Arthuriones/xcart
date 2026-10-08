import { Section } from "@/components/ui/section";
import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";
import { creditos, type FormaPagamento } from "@/components/billing/regras";

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
  forma,
  cobrancaLigada,
}: {
  saldo: number;
  usadosNoMes: number | null;
  inicioDoMes: string;
  erroUso: string | null;
  pro: boolean;
  forma: FormaPagamento | null;
  cobrancaLigada: boolean;
}) {
  const notas: string[] = [];
  if (pro && forma === "cartao") {
    // E o que o aviso de renovacao faz hoje (reset_ai_credits): o saldo VOLTA
    // para o incluso, nao soma. Dito aqui para ninguem achar que acumula.
    notas.push(
      `O plano inclui ${creditos(PRO_INCLUDED_CREDITS)} por mês. Na renovação do cartão, o saldo volta para ${PRO_INCLUDED_CREDITS}.`
    );
  } else if (pro && forma === "pix") {
    notas.push(`Cada Pix de 30 dias do plano soma ${creditos(PRO_INCLUDED_CREDITS)} ao saldo.`);
  } else if (pro) {
    notas.push(`O plano inclui ${creditos(PRO_INCLUDED_CREDITS)} por mês.`);
  }
  if (!cobrancaLigada) notas.push("Por enquanto, neutralizar imagens não desconta créditos do saldo.");

  return (
    <Section
      titulo="Créditos de IA"
      descricao="1 crédito = 1 imagem neutralizada com IA. Neutralizar texto não usa crédito."
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-2 p-3">
          <dt className="text-label font-medium text-t1">Saldo</dt>
          <dd className="num text-kpi text-ink">{saldo.toLocaleString("pt-BR")}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface-2 p-3">
          <dt className="text-label font-medium text-t1">Usados este mês</dt>
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
