import { CabecalhoGuia } from "./cabecalho";
import { EsqueletoGuia } from "./esqueleto";

/** Navegacao para /setup: o cabecalho de verdade e o esqueleto do guia. */
export default function Loading() {
  return (
    <>
      <CabecalhoGuia />
      <EsqueletoGuia />
    </>
  );
}
