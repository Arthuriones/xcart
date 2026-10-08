import { ehPlanoId, type PlanoId } from "@/lib/billing/plans";

// ============================================================================
// O plano escolhido na landing, guardado no navegador ate a pessoa chegar na
// escolha de plano (paywall ou Assinatura). O botao "Escolher plano" da
// landing manda ?plano= para o cadastro; o cadastro guarda aqui. Sobrevive a
// confirmacao por e-mail, que perderia um parametro de URL.
//
// So conveniencia: sem armazenamento (aba anonima, bloqueado), a escolha
// volta ao plano em destaque. Nada de cobranca le daqui.
// ============================================================================

const CHAVE = "xcart:plano";

export function guardarPlanoEscolhido(id: unknown): void {
  if (!ehPlanoId(id)) return;
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* sem armazenamento: fica o plano em destaque */
  }
}

export function lerPlanoEscolhido(): PlanoId | null {
  try {
    const v = localStorage.getItem(CHAVE);
    return ehPlanoId(v) ? v : null;
  } catch {
    return null;
  }
}

/** O valor guardado nao muda enquanto a tela esta aberta. */
export function semAvisos(): () => void {
  return () => {};
}
