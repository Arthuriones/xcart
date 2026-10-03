import { CabecalhoLote } from "./cabecalho";
import { EsqueletoLote } from "./esqueleto";

/** Navegacao para /bulk: o cabecalho de verdade e o esqueleto do formulario. */
export default function Loading() {
  return (
    <>
      <CabecalhoLote origem="links" />
      <EsqueletoLote />
    </>
  );
}
