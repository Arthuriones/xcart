import { redirect } from "next/navigation";

// Endereco antigo de quando o roteamento estava espalhado em varias telas.
// Mantido so para link salvo nao dar 404.
export default function LegacyRoutedCheckoutView() {
  redirect("/clone/routed-checkout");
}
