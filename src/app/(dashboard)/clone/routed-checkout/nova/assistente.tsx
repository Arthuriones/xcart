"use client";

import { useRouter } from "next/navigation";
import { ConnectStoresWizard } from "@/components/routed-checkout/connect-stores-wizard";

/** Provisorio: o assistente antigo, aberto na pagina propria. */
export function Assistente({
  lojas,
  origem,
}: {
  lojas: { id: string; nome: string; dominio: string }[];
  origem: string;
}) {
  const router = useRouter();
  return (
    <ConnectStoresWizard
      open
      onOpenChange={(v) => {
        if (!v) router.push("/clone/routed-checkout");
      }}
      stores={lojas.map((l) => ({ id: l.id, name: l.nome, shop_domain: l.dominio }))}
      appOrigin={origem}
      onRouteCreated={() => router.refresh()}
    />
  );
}
