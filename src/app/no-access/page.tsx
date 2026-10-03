import { lerAssinatura } from "@/lib/leitura/assinatura";
import { motivoDoBloqueio } from "@/components/billing/regras";
import { TelaPaywall } from "./tela-paywall";

export const dynamic = "force-dynamic";

/**
 * Paywall: o layout do painel manda para ca quem nao tem acesso. Le so o
 * perfil (sem uso nem historico) para dizer por que a pessoa chegou aqui e
 * se o CPF ja esta salvo. Leitura que falha vira a frase generica, nunca
 * um motivo inventado.
 */
export default async function NoAccessPage() {
  const d = await lerAssinatura({ completo: false });
  return (
    <TelaPaywall
      motivo={motivoDoBloqueio(d.perfil, d.agora)}
      temDocumento={d.perfil ? d.perfil.temDocumento : undefined}
    />
  );
}
