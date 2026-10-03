"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ROTAS, type SyncResposta } from "@/lib/financeiro/tipos";

/**
 * "Sincronizar agora" de uma loja: a mesma rota do "Atualizar agora" do Lucro
 * (POST /api/jobs/financeiro/pedidos?loja=<id>), que pela sessao so alcanca as
 * lojas do usuario. Na volta, os numeros da tela sao relidos no servidor.
 */
export function useSincronizarLoja() {
  const router = useRouter();
  const [emCurso, setEmCurso] = React.useState<string | null>(null);

  const sincronizar = React.useCallback(
    async (loja: { id: string; nome: string }) => {
      if (emCurso) return;
      setEmCurso(loja.id);
      try {
        const res = await fetch(`${ROTAS.apiSyncPedidos}?loja=${encodeURIComponent(loja.id)}`, {
          method: "POST",
        });
        let corpo: Partial<SyncResposta> = {};
        try {
          corpo = await res.json();
        } catch {
          // sem corpo: o status basta
        }
        if (!res.ok) throw new Error(String(res.status));
        const erros = Array.isArray(corpo.erros) ? corpo.erros : [];
        if (erros.length > 0) {
          toast.error(`Não deu para sincronizar ${loja.nome}`, {
            description: "A Shopify recusou. O motivo aparece na coluna Conexão.",
          });
          router.refresh();
        } else if ((corpo.processadas ?? 0) > 0) {
          toast.success(`${loja.nome} sincronizada`, {
            description: "Os números desta tela já foram atualizados.",
          });
          router.refresh();
        } else if ((corpo.puladas ?? 0) > 0) {
          toast(`${loja.nome} acabou de sincronizar`, {
            description: "Espere um minuto para pedir de novo.",
          });
        } else {
          toast(`Nada para sincronizar em ${loja.nome}`, {
            description: "O app não está instalado nesta loja. Reconecte para voltar a ler os pedidos.",
          });
        }
      } catch {
        toast.error(`Não deu para sincronizar ${loja.nome} agora`, {
          description: "Tente de novo em instantes.",
        });
      } finally {
        setEmCurso(null);
      }
    },
    [emCurso, router]
  );

  return { sincronizar, emCurso };
}
