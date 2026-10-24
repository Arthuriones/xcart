import { ehPlanoAVenda, type PlanoAVendaId } from "@/lib/billing/plans";

// ============================================================================
// O plano escolhido na landing, guardado no navegador ate a pessoa chegar na
// escolha de plano (paywall ou Assinatura). O botao "Escolher plano" da
// landing manda ?plano= para o cadastro; o cadastro guarda aqui. Sobrevive a
// confirmacao por e-mail, que perderia um parametro de URL.
//
// So conveniencia: sem armazenamento (aba anonima, bloqueado), a escolha
// volta ao plano em destaque. Nada de cobranca le daqui. So guarda plano A
// VENDA: link velho com ?plano=loja1 (plano anterior) abre no em destaque.
// ============================================================================

const CHAVE = "xcart:plano";

export function guardarPlanoEscolhido(id: unknown): void {
  if (!ehPlanoAVenda(id)) return;
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    /* sem armazenamento: fica o plano em destaque */
  }
}

export function lerPlanoEscolhido(): PlanoAVendaId | null {
  try {
    const v = localStorage.getItem(CHAVE);
    return ehPlanoAVenda(v) ? v : null;
  } catch {
    return null;
  }
}

/** O valor guardado nao muda enquanto a tela esta aberta. */
export function semAvisos(): () => void {
  return () => {};
}
