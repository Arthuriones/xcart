import { CabecalhoLote } from "../bulk/cabecalho";
import { EsqueletoLote } from "../bulk/esqueleto";

/** Navegacao para /multi-site: o cabecalho de verdade e o esqueleto do formulario. */
export default function Loading() {
  return (
    <>
      <CabecalhoLote origem="sites" />
      <EsqueletoLote />
    </>
  );
}
