import { getPickerStores } from "@/lib/stores/picker";
import { MultiSiteScreen } from "./multi-site-screen";

// Lojas buscadas no servidor: a tela nao precisa autenticar e consultar pelo
// navegador antes de poder desenhar o seletor.
export default async function Page() {
  const stores = await getPickerStores();
  return <MultiSiteScreen initialStores={stores} />;
}
