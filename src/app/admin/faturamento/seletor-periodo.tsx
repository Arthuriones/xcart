"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import type { PeriodoFaturamento } from "../formato";

/**
 * 7, 30 ou 60 dias, na URL (?periodo=). 60 e o teto: a Shopify so libera os
 * pedidos dos ultimos 60 dias. A escolha marca na hora; os numeros chegam
 * quando o servidor termina de perguntar as lojas.
 */
export function SeletorPeriodo({ valor }: { valor: PeriodoFaturamento }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mudando, iniciar] = useTransition();
  const [marcado, marcar] = useOptimistic(valor);

  return (
    <div className="flex items-center gap-2">
      <Segmented<PeriodoFaturamento>
        rotulo="Período"
        valor={marcado}
        tamanho="md"
        onValorChange={(p) =>
          iniciar(() => {
            marcar(p);
            router.replace(p === "30" ? pathname : `${pathname}?periodo=${p}`, { scroll: false });
          })
        }
        opcoes={[
          { valor: "7", rotulo: "7 dias" },
          { valor: "30", rotulo: "30 dias" },
          { valor: "60", rotulo: "60 dias" },
        ]}
      />
      {mudando ? <Spinner size={16} rotulo="Buscando o novo período" className="text-t2" /> : null}
    </div>
  );
}
