import "server-only";
import { PLATAFORMAS_CHECKOUT, type IdPlataformaCheckout, type PlataformaDaLista } from "./tipos";

// ============================================================================
// Plataforma de checkout restrita a algumas contas: o Eve (o checkout Pix
// proprio do Arthur, 076) so aparece e so e cadastrado na conta dele.
//
// A trava e por ID DE CONTA, nunca is_admin: ha outro admin no xcart (a conta
// de demonstracao). A lista mora SO aqui, no servidor ("server-only"): a tela
// recebe a lista de plataformas ja filtrada, nunca os ids.
//
// Quem confere:
//   - Integracoes > Checkouts (page.tsx): a escolha de plataforma.
//   - POST /api/checkouts: recusa com a mesma resposta de plataforma desconhecida.
//   - O webhook: checkout de plataforma restrita em conta fora da lista = 404.
// Fora disso o Eve nao aparece em lugar nenhum: /conectar, landing, paleta,
// guia e navegacao leem PLATAFORMAS_CHECKOUT, que nao o tem.
// ============================================================================

/** As contas que veem e cadastram o Eve. */
export const CONTAS_COM_EVE: readonly string[] = ["55c773d6-873a-456a-8695-296ff1433a53"];

/** Plataforma restrita -> as contas liberadas. A que nao esta aqui vale para todas. */
const CONTAS_POR_PLATAFORMA: Partial<Record<IdPlataformaCheckout, readonly string[]>> = { eve: CONTAS_COM_EVE };

/** As linhas da escolha que so a conta liberada ve. */
const PLATAFORMAS_RESTRITAS: PlataformaDaLista[] = [
  { id: "eve", nome: "Eve", descricao: "Seu checkout Pix: faturamento de cada Pix.", ativa: true },
];

/**
 * A conta pode ver, cadastrar e receber esta plataforma? A publica: sempre (o
 * resto -- ativa, desconhecida -- quem chama confere). A restrita: so a conta
 * da lista.
 */
export function plataformaLiberada(id: string | null | undefined, userId: string | null | undefined): boolean {
  const contas = id ? CONTAS_POR_PLATAFORMA[id as IdPlataformaCheckout] : undefined;
  if (!contas) return true;
  return typeof userId === "string" && contas.includes(userId);
}

/**
 * A escolha de plataforma desta conta: as ativas publicas, as restritas que
 * ela pode, e as "em breve" no fim. Sem conta: so a publica.
 */
export function plataformasDaConta(userId: string | null | undefined): PlataformaDaLista[] {
  const restritas = PLATAFORMAS_RESTRITAS.filter((p) => plataformaLiberada(p.id, userId));
  return [...PLATAFORMAS_CHECKOUT.filter((p) => p.ativa), ...restritas, ...PLATAFORMAS_CHECKOUT.filter((p) => !p.ativa)];
}
