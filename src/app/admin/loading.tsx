import { CabecalhoVisao, EsqueletoVisao } from "./visao-partes";

/** Navegacao para /admin: o cabecalho de verdade e o esqueleto da visao geral. */
export default function Loading() {
  return (
    <>
      <CabecalhoVisao />
      <EsqueletoVisao />
    </>
  );
}
