import { redirect } from "next/navigation";

/** /integracoes abre na primeira plataforma do menu. */
export default function IntegracoesPage() {
  redirect("/integracoes/meta");
}
