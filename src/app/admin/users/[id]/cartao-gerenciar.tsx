"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { seloAcesso, temAcesso } from "../../formato";
import { FormPlanoCreditos, useAcessoUsuario, type Mudanca } from "../../gerenciar";
import type { UsuarioGerenciavel } from "../../tipos";

/**
 * Gerenciar no detalhe do cliente: acesso (liberar na hora, revogar com
 * confirmacao), plano e saldo. O que muda aparece aqui na hora e o resto da
 * pagina (numeros, selos) se atualiza com a nova leitura do servidor.
 */
export function CartaoGerenciar({ usuario, travaLigada }: { usuario: UsuarioGerenciavel; travaLigada: boolean }) {
  const router = useRouter();
  const [ajuste, setAjuste] = useState<Mudanca>({});
  const atual = { ...usuario, ...ajuste };

  function aplicar(m: Mudanca) {
    setAjuste((a) => ({ ...a, ...m }));
    router.refresh();
  }

  const acesso = useAcessoUsuario({ travaLigada, aoMudar: (_id, m) => aplicar(m) });
  const selo = seloAcesso(atual);
  const semAcesso = !atual.isAdmin && !temAcesso(atual);

  return (
    <Section titulo="Gerenciar" descricao="Acesso, plano e créditos deste cliente">
      <div className="flex flex-col gap-2 border-b border-border-subtle pb-4">
        <span className="text-dense font-medium text-ink">Acesso</span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge tom={selo.tom} texto={selo.texto} />
          <span className="text-label text-t2">{selo.motivo}</span>
        </div>
        {atual.isAdmin ? (
          <p className="text-label text-t2">Administrador sempre tem acesso.</p>
        ) : atual.accessGranted ? (
          <Button variant="destructive" className="w-fit" onClick={() => acesso.pedirRevogar(atual)}>
            Revogar acesso
          </Button>
        ) : (
          <Button
            variant={semAcesso ? "primary" : "secondary"}
            className="w-fit"
            pending={acesso.pendente === atual.id}
            onClick={() => void acesso.liberar(atual)}
          >
            Liberar acesso
          </Button>
        )}
        {!travaLigada ? (
          <p className="text-label text-t2">A trava de acesso está desligada: hoje todo mundo entra no painel.</p>
        ) : null}
      </div>

      <FormPlanoCreditos usuario={usuario} aoMudar={aplicar} />
      {acesso.dialogo}
    </Section>
  );
}
