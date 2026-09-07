import landing from "../../../messages/landing.json";
import { criarTradutor, type Tradutor } from "@/lib/textos";

/**
 * A copia da landing, separada do resto.
 *
 * Ela e um quarto do dicionario e nenhuma tela do app usa uma linha dela. Num
 * arquivo so, esse texto entrava no download de todo componente de cliente que
 * chamasse textos() -- e sao quase todos.
 */
export function textosLanding(): Tradutor {
  return criarTradutor(landing.landing as Record<string, unknown>);
}
