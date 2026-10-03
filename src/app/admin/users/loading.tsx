import { EsqueletoTabela } from "../esqueletos";
import { CabecalhoUsuarios } from "./cabecalho";

/** Navegacao para /admin/users: o cabecalho de verdade e a tabela carregando. */
export default function Loading() {
  return (
    <>
      <CabecalhoUsuarios />
      <EsqueletoTabela rotulo="Carregando usuários" />
    </>
  );
}
