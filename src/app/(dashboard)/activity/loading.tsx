import { CabecalhoAtividade } from "./cabecalho";
import { EsqueletoAtividade } from "./esqueleto";

/** Navegacao para /activity: o cabecalho de verdade e o esqueleto da linha do tempo. */
export default function Loading() {
  return (
    <>
      <CabecalhoAtividade />
      <EsqueletoAtividade />
    </>
  );
}
