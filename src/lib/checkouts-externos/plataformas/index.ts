import type { IdPlataformaCheckout } from "../tipos";
import { cakto } from "./cakto";
import { eve } from "./eve";
import { hotmart } from "./hotmart";
import { hubla } from "./hubla";
import { sphere } from "./sphere";
import type { PlataformaCheckout } from "./tipos";

export type { EventoNormalizado, Leitura, LeituraVarios, PlataformaCheckout } from "./tipos";

// So o servidor importa daqui: os adaptadores da Cakto, da Hubla, do Eve e da Hotmart usam node:crypto.
// O Eve so recebe na conta liberada (liberadas.ts): a rota do webhook confere.
const PLATAFORMAS: Record<IdPlataformaCheckout, PlataformaCheckout> = { sphere, cakto, hubla, eve, hotmart };

/** O adaptador da plataforma, ou null para uma que o xcart ainda nao recebe. */
export function plataformaDe(id: string | null | undefined): PlataformaCheckout | null {
  return (id && PLATAFORMAS[id as IdPlataformaCheckout]) || null;
}
