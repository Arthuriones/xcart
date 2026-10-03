import { CabecalhoFaturamento, EsqueletoFaturamento } from "./partes";

/** Navegacao para /admin/faturamento: o periodo padrao (30) ate a URL chegar. */
export default function Loading() {
  return (
    <>
      <CabecalhoFaturamento periodo="30" />
      <EsqueletoFaturamento />
    </>
  );
}
