import { Suspense } from "react";
import { accessControlEnabled } from "@/lib/billing/access";
import { EsqueletoTabela } from "../esqueletos";
import { ErroAdmin } from "../estados-admin";
import { filtrosDaUrl, type FiltrosUsuarios } from "../formato";
import { lerVisao } from "../ler-api";
import { CabecalhoUsuarios } from "./cabecalho";
import { ListaUsuarios } from "./lista-usuarios";

export const dynamic = "force-dynamic";

/**
 * /admin/users: liberar ou revogar acesso e ajustar plano e creditos de cada
 * cliente. A lista vem de GET /api/admin/overview (campo `users`), lida no
 * servidor; os filtros ficam na URL (?q=&acesso=&plano=).
 */
export default async function AdminUsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const filtros = filtrosDaUrl(await searchParams);
  return (
    <>
      <CabecalhoUsuarios />
      <Suspense fallback={<EsqueletoTabela rotulo="Carregando usuários" />}>
        <Lista filtros={filtros} />
      </Suspense>
    </>
  );
}

async function Lista({ filtros }: { filtros: FiltrosUsuarios }) {
  const r = await lerVisao();
  if (!r.ok) {
    return <ErroAdmin titulo="Não deu para carregar os usuários" detalhe={r.detalhe} />;
  }
  return (
    <ListaUsuarios
      usuarios={r.dados.users}
      travaLigada={accessControlEnabled()}
      filtrosIniciais={filtros}
      lidoEm={r.lidoEm}
    />
  );
}
