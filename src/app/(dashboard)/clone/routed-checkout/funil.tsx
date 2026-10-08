import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import type { FunilDaRota } from "@/lib/checkout-routes/sensor";
import { blocosDoFunil, lojasSemAviso } from "./logica";

/**
 * O funil da rota nos ultimos 7 dias: carrinhos levados, escapes para o
 * checkout da vitrine, erros do script e pedidos na loja de checkout.
 * Leitura em src/lib/leitura/funil-rota.ts; regras em sensor.ts.
 */
export function FunilDaRotaView({ funil, erro }: { funil: FunilDaRota | null; erro: boolean }) {
  if (!funil) {
    return (
      <Section titulo="Últimos 7 dias">
        <p className="text-dense text-t2">
          {erro ? "Não deu para ler o funil agora. Atualize a página." : "Sem dados desta rota ainda."}
        </p>
      </Section>
    );
  }

  const blocos = blocosDoFunil(funil);
  const semAviso = lojasSemAviso(funil);
  const faltaPermissao = semAviso.some((l) => /read_orders/.test(l.motivo));

  return (
    <Section titulo={`Últimos ${funil.dias} dias`} descricao="Do carrinho levado ao pedido na loja de checkout.">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {blocos.map((b) => (
          <div key={b.rotulo} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface-2 px-3 py-2.5">
            <dt className="text-label text-t2">{b.rotulo}</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              <span className="num truncate text-section text-ink">{b.valor}</span>
              <span className="truncate text-label text-t2">{b.sub}</span>
            </dd>
          </div>
        ))}
      </dl>

      {semAviso.length > 0 ? (
        <Callout tom="warn" titulo="A Shopify não está avisando o xcart">
          <ul className="flex flex-col gap-0.5">
            {semAviso.map((l) => (
              <li key={`${l.nome}|${l.motivo}`}>
                <span className="font-medium">{l.nome}</span>: {l.motivo}.
              </li>
            ))}
          </ul>
          <p className="mt-1">
            {faltaPermissao
              ? "Sem esse aviso não dá para contar pedidos nem carrinhos que caem na vitrine. Marque read_orders no app do xcart da loja e clique em Testar agora, no Diagnóstico."
              : "Sem esse aviso não dá para contar pedidos nem carrinhos que caem na vitrine. O xcart confere de novo em até 24 h."}
          </p>
        </Callout>
      ) : null}

      <p className="text-label text-t2 text-pretty">
        Pedidos contam toda venda da loja de checkout. Caídas na vitrine são as que a Shopify avisa: o número é
        um piso.
      </p>
    </Section>
  );
}
