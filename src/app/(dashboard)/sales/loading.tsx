import { BarraPeriodo, CabecalhoVendas } from "./cabecalho";
import { EsqueletoVendas } from "./esqueleto";

/**
 * Navegacao para /sales: o cabecalho e o esqueleto. O periodo so e conhecido
 * na pagina (vem da URL), entao aqui a barra sai sem nenhum marcado.
 */
export default function Loading() {
  return (
    <>
      <CabecalhoVendas />
      <BarraPeriodo periodo={null} />
      <EsqueletoVendas />
    </>
  );
}
