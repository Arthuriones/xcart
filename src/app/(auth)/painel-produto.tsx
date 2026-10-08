import { Activity, Bell, CircleDollarSign, type LucideIcon } from "lucide-react";

// ============================================================================
// O que o xcart faz, ao lado do formulario. Dinheiro e rastreamento primeiro;
// importacao e roteamento entram como modulos. Sem numero: quem ainda nao
// entrou nao tem dado para mostrar, e exemplo inventado nao entra aqui.
// No celular vem resumido embaixo do formulario (so os titulos).
// ============================================================================

const PONTOS: { Icone: LucideIcon; titulo: string; texto: string }[] = [
  {
    Icone: CircleDollarSign,
    titulo: "Lucro estimado por loja, todo dia",
    texto: "Faturamento menos produto, frete, taxa de pagamento e anúncio do Meta e do Google.",
  },
  {
    Icone: Activity,
    titulo: "Rastreamento de compras",
    texto: "Cada compra no Meta e no TikTok pelo servidor, e no Google pela tag.",
  },
  {
    Icone: Bell,
    titulo: "Alertas com o caminho para resolver",
    texto: "Gastou com anúncio e não vendeu, compra que não chegou ao Meta ou ao TikTok, pedidos ou gasto sem atualizar, também no Telegram.",
  },
];

export function PainelProduto() {
  return (
    <aside
      aria-labelledby="painel-produto-titulo"
      className="border-t border-border bg-surface-2 px-4 py-8 sm:px-10 lg:flex lg:flex-col lg:justify-center lg:border-t-0 lg:border-l lg:px-16 lg:py-12"
    >
      <div className="mx-auto w-full max-w-sm lg:max-w-md">
        <p className="text-label font-medium text-t2">Para quem opera várias lojas Shopify</p>
        <h2 id="painel-produto-titulo" className="mt-2 text-section text-ink lg:text-page">
          Quanto cada loja lucrou e se os anúncios estão vendo as vendas.
        </h2>

        <ul className="mt-5 flex flex-col gap-3 lg:mt-8 lg:gap-5">
          {PONTOS.map(({ Icone, titulo, texto }) => (
            <li key={titulo} className="flex gap-3">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-control border border-border bg-surface text-t1 lg:size-8"
              >
                <Icone className="size-4" strokeWidth={1.75} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-1 lg:pt-1.5">
                <p className="text-dense font-semibold text-ink">{titulo}</p>
                <p className="hidden text-dense text-t1 lg:block">{texto}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-5 border-t border-border pt-4 text-dense text-t2 lg:mt-8">
          Também: importação de produtos com tradução por IA e, para quem usa loja vitrine, o checkout dividido
          entre várias lojas.
        </p>
      </div>
    </aside>
  );
}
