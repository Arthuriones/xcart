import { getPickerStores } from "@/lib/stores/picker";
import { BulkScreen } from "./bulk-screen";

// Lojas buscadas no servidor: a tela nao precisa autenticar e consultar pelo
// navegador antes de poder desenhar o seletor.
export default async function Page() {
  const stores = await getPickerStores();
  return <BulkScreen initialStores={stores} />;
}
