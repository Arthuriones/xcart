import { CabecalhoCampanhas, EsqueletoCampanhas } from "./esqueleto";

/**
 * Navegacao para Campanhas: a forma da tela desde o clique (o prefetch para
 * aqui), na largura total como a pagina -- sem o esqueleto generico de KPIs
 * antes nem o pulo de largura depois.
 */
export default function Carregando() {
  return (
    <div className="flex flex-col gap-6" data-largura="total">
      <CabecalhoCampanhas />
      <EsqueletoCampanhas />
    </div>
  );
}
