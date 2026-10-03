import { CabecalhoCustos } from "./cabecalho";
import { EsqueletoCustos } from "./esqueleto";

/** Navegacao para /financeiro/custos: o cabecalho de verdade e o esqueleto da tela. */
export default function Loading() {
  return (
    <>
      <CabecalhoCustos />
      <EsqueletoCustos />
    </>
  );
}
