"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";

const ERRO_PADRAO = "Não deu para excluir a conta agora. Tente de novo em instantes.";

/**
 * Excluir a conta pelo site (Apple 5.1.1(v) e Google pedem o caminho na web
 * tambem). Pede o e-mail da conta; o servidor confere, cancela a assinatura e
 * apaga (DELETE /api/conta). A rota ja limpa o cookie da sessao. Fica em
 * /configuracoes e no paywall (/no-access): quem esta sem plano nao chega as
 * Configuracoes, e e quem mais quer excluir.
 */
export function ExcluirConta() {
  const idCampo = useId();
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState(ERRO_PADRAO);

  async function excluir() {
    setErro(ERRO_PADRAO);
    if (!email.trim()) {
      setErro("Digite o e-mail da conta para confirmar.");
      throw new Error("vazio");
    }
    let res: Response;
    try {
      res = await fetch("/api/conta", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacao: email }),
      });
    } catch {
      throw new Error("rede");
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; erro?: unknown };
    if (!res.ok || data.ok !== true) {
      setErro(typeof data.erro === "string" && data.erro ? data.erro : ERRO_PADRAO);
      throw new Error("excluir");
    }
    // Navegacao inteira (o roteador nao guarda nada da conta apagada) e sem
    // volta pelo Voltar. O botao fica pendente ate a pagina trocar.
    window.location.replace("/login");
    await new Promise(() => {});
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-dense font-semibold text-ink">Excluir conta</span>
        <span className="text-label text-t2">Apaga a conta e tudo o que está nela. Não dá para desfazer.</span>
      </span>
      <ConfirmDialog
        gatilho={
          <Button variant="destructive" className="shrink-0">
            Excluir conta
          </Button>
        }
        titulo="Excluir a conta?"
        descricao={
          <>
            <span className="block">
              Some de vez: as lojas conectadas, o rastreamento, os pedidos e todo o histórico, as contas de anúncio e
              os checkouts ligados. A assinatura é cancelada antes, sem nova cobrança. Não dá para desfazer.
            </span>
            <label htmlFor={idCampo} className="mt-3 block text-dense font-medium text-ink">
              Para confirmar, digite o e-mail da conta
            </label>
            <Input
              id={idCampo}
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
            />
          </>
        }
        confirmar="Excluir conta"
        cancelar="Manter conta"
        onConfirmar={excluir}
        mensagemErro={erro}
        onOpenChange={(aberto) => {
          if (!aberto) setEmail("");
        }}
      />
    </div>
  );
}
