import { CabecalhoAssinatura } from "./cabecalho";
import { EsqueletoAssinatura } from "./esqueleto";

/** Navegacao para /billing: o cabecalho de verdade e o esqueleto da tela. */
export default function Loading() {
  return (
    <>
      <CabecalhoAssinatura />
      <EsqueletoAssinatura />
    </>
  );
}
