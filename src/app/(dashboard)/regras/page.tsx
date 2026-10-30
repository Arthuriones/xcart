import { TelaRegras } from "./tela-regras";

export const metadata = {
  title: "Regras automáticas | Panda Track",
  description: "Regras que pausam ou mudam o orçamento de campanhas, conjuntos e anúncios do Meta, e o histórico de alterações.",
};

/**
 * /regras: so monta. A tela le GET /api/ads/regras no navegador -- criar,
 * ligar, simular e apagar mudam a lista ali mesmo, sem voltar ao servidor.
 */
export default function RegrasPage() {
  return <TelaRegras />;
}
