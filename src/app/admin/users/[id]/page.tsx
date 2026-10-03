import { notFound } from "next/navigation";
import { accessControlEnabled } from "@/lib/billing/access";
import { lerDestinosDoUsuario } from "@/lib/leitura/admin-rotas";
import { ErroAdmin } from "../../estados-admin";
import { lerUsuario } from "../../ler-api";
import { Trilha } from "./trilha";
import { Detalhe } from "./vista";

export const dynamic = "force-dynamic";

/**
 * /admin/users/[id]: tudo de um cliente. Perfil, lojas, rotas, recargas e uso
 * de IA vem de GET /api/admin/users/[id]; os destinos de cada rota, com a
 * divisao do rodizio, de uma leitura nova (src/lib/leitura/admin-rotas.ts).
 */
export default async function DetalheUsuarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [r, destinos] = await Promise.all([lerUsuario(id), lerDestinosDoUsuario(id)]);

  if (!r.ok && r.status === 404) notFound();
  if (!r.ok) {
    return (
      <>
        <Trilha atual="Cliente" />
        <ErroAdmin titulo="Não deu para carregar este cliente" detalhe={r.detalhe} />
      </>
    );
  }
  return <Detalhe d={r.dados} destinos={destinos} travaLigada={accessControlEnabled()} />;
}
