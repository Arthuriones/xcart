import { CabecalhoAlertas } from "./cabecalho";
import { EsqueletoAlertas } from "./esqueleto";

/** Navegacao para /alertas: o cabecalho de verdade e o esqueleto da lista. */
export default function Loading() {
  return (
    <>
      <CabecalhoAlertas />
      <EsqueletoAlertas />
    </>
  );
}
