"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { RoutingConsole } from "@/components/routed-checkout/routing-console";
import type { RouteGraph } from "@/lib/checkout-routes/graph";

// O wizard tem 1.6k linhas e so aparece depois de clicar em "Nova rota".
// Carregado sob demanda ele sai do primeiro download da tela, que e o que
// todo mundo paga toda vez que abre o roteamento.
const ConnectStoresWizard = dynamic(
  () =>
    import("@/components/routed-checkout/connect-stores-wizard").then(
      (m) => m.ConnectStoresWizard
    ),
  { ssr: false }
);

export function RoutedCheckoutScreen({
  grafoInicial,
  appOrigin,
}: {
  grafoInicial: RouteGraph;
  appOrigin: string;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  // Uma vez montado, fica: fechar e reabrir nao deve baixar de novo.
  const [montarWizard, setMontarWizard] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // As lojas ja vieram no grafo; o wizard nao precisa de uma consulta propria.
  const lojas = grafoInicial.stores.map((loja) => ({
    id: loja.id,
    name: loja.name,
    shop_domain: loja.shopDomain,
    niche: loja.niche,
    target_language: loja.targetLanguage,
  }));

  return (
    <>
      <RoutingConsole
        key={reloadKey}
        grafoInicial={grafoInicial}
        onConnectStores={() => {
          setMontarWizard(true);
          setWizardOpen(true);
        }}
      />
      {montarWizard && (
        <ConnectStoresWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          stores={lojas}
          appOrigin={appOrigin}
          onRouteCreated={() => setReloadKey((key) => key + 1)}
        />
      )}
    </>
  );
}
