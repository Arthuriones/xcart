import { getPickerStores } from "@/lib/stores/picker";
import { CloneScreen } from "./clone-screen";

// Lojas buscadas no servidor: a tela deixa de autenticar e consultar pelo
// navegador antes de poder desenhar os seletores.
export default async function ClonePage() {
  const stores = await getPickerStores();
  return (
    <CloneScreen
      initialStores={stores.map((s) => ({
        id: s.id,
        name: s.name,
        shop_domain: s.shop_domain,
      }))}
    />
  );
}
