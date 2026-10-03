import { CabecalhoVisao } from "./cabecalho";
import { EsqueletoVisao } from "./esqueleto";

/** Navegacao para /overview: o cabecalho de verdade e o esqueleto da tela. */
export default function Loading() {
  return (
    <>
      <CabecalhoVisao />
      <EsqueletoVisao />
    </>
  );
}
