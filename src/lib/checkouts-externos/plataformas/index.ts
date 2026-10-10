import type { IdPlataformaCheckout } from "../tipos";
import { sphere } from "./sphere";
import type { PlataformaCheckout } from "./tipos";

export type { EventoNormalizado, Leitura, PlataformaCheckout } from "./tipos";

const PLATAFORMAS: Record<IdPlataformaCheckout, PlataformaCheckout> = { sphere };

/** O adaptador da plataforma, ou null para uma que o xcart ainda nao recebe. */
export function plataformaDe(id: string | null | undefined): PlataformaCheckout | null {
  return (id && PLATAFORMAS[id as IdPlataformaCheckout]) || null;
}
