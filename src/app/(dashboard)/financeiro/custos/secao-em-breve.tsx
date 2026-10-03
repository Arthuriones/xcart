import { Section } from "@/components/ui/section";

// ============================================================================
// (4) Custos que ainda nao existem (funcao #23 do brief). Mudam o calculo do
// lucro, entao so entram com aprovacao: aqui ficam como "Em breve", sem botao
// e sem numero -- nada disso entra no lucro hoje.
// ============================================================================

const ITENS: { titulo: string; texto: string }[] = [
  { titulo: "Aplicar a todas as lojas", texto: "Lançar o mesmo custo em todas as lojas que vendem o SKU." },
  { titulo: "Importar da Shopify e do AliExpress", texto: "Puxar o custo por item da Shopify e o preço do fornecedor." },
  { titulo: "Taxa por gateway ou país", texto: "Uma taxa para cada forma de pagamento ou país do comprador." },
  { titulo: "Taxas da Shopify", texto: "Plano mensal e taxa de transação descontados do lucro." },
  { titulo: "Custos fixos do mês", texto: "Apps, assinaturas e equipe divididos pelos dias do período." },
  { titulo: "Contestação e devolução", texto: "Uma reserva para chargeback e produto devolvido." },
];

export function SecaoEmBreve() {
  return (
    <Section titulo="Mais custos" descricao="Em preparação. Nada desta lista entra no lucro ainda.">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ITENS.map((i) => (
          <li
            key={i.titulo}
            className="flex flex-col gap-1 rounded-control border border-dashed border-border-strong px-3 py-2.5"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-dense font-semibold text-ink">{i.titulo}</span>
              <span className="rounded-full border border-border-strong px-2 text-label font-medium text-t2">
                Em breve
              </span>
            </span>
            <span className="text-label text-t2">{i.texto}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
