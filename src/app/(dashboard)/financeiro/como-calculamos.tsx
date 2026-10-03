import { ChevronRight } from "lucide-react";

// ============================================================================
// "Como calculamos": as regras do numero, em linguagem de lojista. Server
// component; cada item e um <details> (abre por toque, teclado e leitor de
// tela sem JavaScript). O id e o alvo do "Ver como calculamos" das pendencias.
// ============================================================================

const ITENS: { titulo: string; texto: string }[] = [
  {
    titulo: "O lucro é estimado, não contábil",
    texto:
      "Faturamento menos custo do produto, frete do fornecedor, taxa de pagamento e gasto em anúncios. Ainda não entram a taxa real cobrada pelo gateway (usamos a que você configurou), custos fixos do mês e IOF do cartão.",
  },
  {
    titulo: "O faturamento inclui o frete cobrado",
    texto:
      "Faturamento é o que foi pago, menos reembolsos, impostos, taxas alfandegárias e gorjetas. Inclui o frete cobrado do cliente: na Shopify, compare com “Vendas totais menos impostos”, não com “Vendas líquidas”. Pedido de teste e de PDV fica de fora; pedido com pagamento pendente entra com zero até ser pago.",
  },
  {
    titulo: "Produtos, frete e taxas",
    texto:
      "Produtos + frete é o custo de cada SKU que valia no dia do pedido. Item cancelado antes do envio não custa; reembolso depois do envio continua custando. SKU sem custo usa o custo padrão da loja, quando existe. A taxa é o percentual mais o valor fixo por pedido configurados em Custos e taxas.",
  },
  {
    titulo: "ROAS real e ROAS de equilíbrio",
    texto:
      "ROAS real é o faturamento dividido pelo gasto em anúncios, com os pedidos da Shopify, não os da plataforma. ROAS de equilíbrio é o ROAS em que o lucro fica em zero: faturamento dividido pelo que sobra depois de produto, frete e taxa. Abaixo dele, cada anúncio dá prejuízo; abaixo de 1,2 vez ele, a loja fica “no limite”.",
  },
  {
    titulo: "De onde vêm os números e quando atualizam",
    texto:
      "Pedidos da Shopify a cada 15 minutos. Gasto do Meta a cada 15 minutos (inclui anúncio apagado ou arquivado); do Google, de hora em hora, pelo script. Câmbio quatro vezes por dia.",
  },
  {
    titulo: "Câmbio",
    texto:
      "Cada valor é convertido pela cotação do dia dele. Em fim de semana e feriado vale a última cotação dos 10 dias anteriores; sem nenhuma, usamos uma tabela fixa e a tela avisa que o câmbio está aproximado. Moeda sem cotação nenhuma fica de fora do total, nunca somada como se fosse real.",
  },
  {
    titulo: "Dias, fuso e histórico",
    texto:
      "O dia do pedido segue o fuso da loja; o dia do gasto, o da conta de anúncio. Com todas as lojas, “hoje” é o de São Paulo, e hoje é parcial até a meia-noite. A Shopify entrega uns 60 dias de pedidos antes da conexão de cada loja: antes disso a linha do período anterior fica em branco, nunca em zero.",
  },
];

export function ComoCalculamos() {
  return (
    <section
      id="como-calculamos"
      aria-labelledby="como-calculamos-t"
      className="scroll-mt-32 rounded-card border border-border bg-surface"
    >
      <h2 id="como-calculamos-t" className="border-b border-border-subtle px-4 py-3.5 text-section text-ink">
        Como calculamos
      </h2>
      {ITENS.map((item, i) => (
        <details key={item.titulo} open={i === 0} className="group border-b border-border-subtle last:border-b-0">
          <summary className="flex min-h-ctl-lg cursor-pointer list-none items-center gap-2.5 px-4 text-dense font-medium text-ink hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 text-t2 transition-transform group-open:rotate-90"
              strokeWidth={1.75}
            />
            <h3>{item.titulo}</h3>
          </summary>
          <p className="max-w-190 pb-3.5 pl-10 pr-4 text-dense text-t1 text-pretty">{item.texto}</p>
        </details>
      ))}
    </section>
  );
}
