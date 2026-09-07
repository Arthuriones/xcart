import { getRouteGraph } from "@/lib/checkout-routes/graph";
import { getPublicAppUrl } from "@/lib/public-url";
import { RoutedCheckoutScreen } from "./routed-checkout-screen";

/**
 * A pagina monta no servidor e ja entrega o grafo desenhado.
 *
 * Antes eram duas idas do navegador antes de aparecer qualquer coisa: uma ao
 * Supabase pelas lojas e outra a /api/checkout-routes/map. As duas saiam
 * depois da hidratacao, entao quem abria o roteamento via "Carregando" por
 * dois arredondamentos de rede seguidos.
 */
export default async function RoutedCheckoutPage() {
  const grafo = await getRouteGraph();
  return (
    <RoutedCheckoutScreen
      grafoInicial={grafo}
      appOrigin={getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "")}
    />
  );
}
