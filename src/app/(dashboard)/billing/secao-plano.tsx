"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { AssinarPro } from "@/components/billing/assinar-pro";
import type { PlanoId } from "@/lib/billing/plans";
import type { UsoDoPlano } from "@/lib/leitura/assinatura";
import {
  ERRO_PADRAO,
  dataCurta,
  mensagemDeErro,
  type SituacaoPlano,
} from "@/components/billing/regras";

/** O que o servidor leu do banco, para conferir com o processador. */
export interface PlanoNoBanco {
  status: string | null;
  cancelaNoFim: boolean;
  fimPeriodo: string | null;
  temAssinaturaCartao: boolean;
}

function mesmoInstante(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * O plano: situacao em portugues, renovacao ou fim do acesso, cancelar (com
 * confirmacao), assinar e, para quem paga por Pix, pagar mais 30 dias.
 *
 * Depois de montar, consulta GET /api/billing/subscription -- e ela que
 * acerta o banco com o processador quando um aviso de pagamento se perde, e
 * devolve o final do cartao. Se o estado mudou, a tela le de novo.
 */
export function SecaoPlano({
  situacao,
  noBanco,
  temDocumento,
  uso,
  planoAtual,
}: {
  situacao: SituacaoPlano;
  noBanco: PlanoNoBanco;
  temDocumento: boolean;
  /** Lojas usadas x limite do plano. null = nao deu para ler. */
  uso: UsoDoPlano | null;
  /** O tier de agora, para o Pix de renovacao ja vir marcado nele. */
  planoAtual: PlanoId | null;
}) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const [cartaoFinal, setCartaoFinal] = useState<string | null>(null);
  const [renovando, setRenovando] = useState(false);
  // Pagamento aceito: o formulario sai da tela ate o refresh trazer o Pro
  // (como a fase "liberando" do paywall), para nao pagar duas vezes.
  const [assinou, setAssinou] = useState(false);
  const [erroCancelar, setErroCancelar] = useState<string>(ERRO_PADRAO.cancelar);
  const atualizar = () => iniciar(() => router.refresh());

  // Dependencias primitivas: depois de um refresh o objeto noBanco e novo,
  // mas so muda de valor se a conferencia acertou o banco -- ai confere mais
  // uma vez e para (nao entra em laco de refresh).
  const { temAssinaturaCartao, status, cancelaNoFim, fimPeriodo } = noBanco;
  useEffect(() => {
    if (!temAssinaturaCartao) return;
    let vivo = true;
    fetch("/api/billing/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = d?.subscription;
        if (!vivo || !s) return;
        if (s.cardLast4) setCartaoFinal(String(s.cardLast4));
        // "stale" = o processador nao respondeu e a rota devolveu o banco.
        const mudou =
          !d.stale &&
          (s.status !== status ||
            (s.cancelAtPeriodEnd === true) !== cancelaNoFim ||
            !mesmoInstante(s.currentPeriodEnd, fimPeriodo));
        if (mudou) iniciar(() => router.refresh());
      })
      .catch(() => {
        /* sem rede: a tela fica com o que o banco disse */
      });
    return () => {
      vivo = false;
    };
  }, [temAssinaturaCartao, status, cancelaNoFim, fimPeriodo, router]);

  async function cancelar() {
    setErroCancelar(ERRO_PADRAO.cancelar);
    let res: Response;
    try {
      res = await fetch("/api/billing/subscription", { method: "DELETE" });
    } catch {
      throw new Error("rede");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErroCancelar(mensagemDeErro(res.status, data.error, ERRO_PADRAO.cancelar).texto);
      throw new Error("cancelar");
    }
    const ate = dataCurta(data.accessUntil);
    toast.success(
      ate
        ? `Assinatura cancelada. O acesso continua até ${ate}.`
        : "Cancelamento agendado para o fim do período."
    );
    atualizar();
  }

  const fim = dataCurta(noBanco.fimPeriodo);
  const botaoRenovarNoAviso = situacao.podeRenovarPix && !!situacao.aviso && !renovando;

  return (
    <Section
      titulo="Plano"
      acoes={
        situacao.podeCancelar ? (
          <ConfirmDialog
            gatilho={<Button variant="destructive">Cancelar assinatura</Button>}
            titulo="Cancelar a assinatura?"
            descricao={
              fim
                ? `O cartão não será mais cobrado. Você continua com o plano até ${fim}; depois disso, a conta fica sem assinatura.`
                : "O cartão não será mais cobrado. Você continua com o plano até o fim do período já pago; depois disso, a conta fica sem assinatura."
            }
            confirmar="Cancelar assinatura"
            cancelar="Manter assinatura"
            onConfirmar={cancelar}
            mensagemErro={erroCancelar}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-page text-ink">{situacao.titulo}</span>
          <StatusBadge tom={situacao.selo.tom} texto={situacao.selo.texto} />
        </div>
        {situacao.linha ? <p className="text-dense text-t1">{situacao.linha}</p> : null}
        {cartaoFinal && situacao.forma === "cartao" ? (
          <p className="num text-label text-t2">Cartão final {cartaoFinal}</p>
        ) : null}
        {uso ? <p className="num text-dense text-t1">{uso.resumo}</p> : null}
        {uso?.acima ? (
          <p className="text-label text-warn">
            Acima do limite do plano: o que já está ligado continua, mas não dá para ligar mais lojas.
          </p>
        ) : null}
        {situacao.mudarPlano ? <p className="text-label text-t2">{situacao.mudarPlano}</p> : null}
      </div>

      {situacao.aviso ? (
        <Callout
          tom={situacao.aviso.tom}
          titulo={situacao.aviso.titulo}
          // Pix perto do fim: a saida fica no proprio aviso.
          acao={
            botaoRenovarNoAviso ? (
              <Button variant="secondary" size="sm" onClick={() => setRenovando(true)}>
                Pagar mais 30 dias
              </Button>
            ) : undefined
          }
        >
          {situacao.aviso.texto}
        </Callout>
      ) : null}

      {situacao.podeAssinar ? (
        assinou ? (
          <div role="status" className="flex flex-col items-start gap-2">
            <p className="flex items-center gap-2 text-dense font-medium text-ink">
              <Spinner size={14} />
              Conferindo o pagamento…
            </p>
            <p className="text-dense text-t1">
              O plano libera assim que o banco confirmar. Não precisa pagar de novo.
            </p>
            <Button variant="secondary" size="sm" onClick={atualizar}>
              Conferir de novo
            </Button>
          </div>
        ) : (
          <AssinarPro
            onPronto={() => {
              setAssinou(true);
              atualizar();
            }}
            temDocumento={temDocumento}
          />
        )
      ) : null}

      {situacao.podeRenovarPix ? (
        renovando ? (
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
            <p className="text-dense font-medium text-ink">Pagar mais 30 dias por Pix</p>
            <AssinarPro
              somentePix
              mostrarResumo={false}
              planoInicial={planoAtual}
              temDocumento={temDocumento}
              onPronto={() => {
                setRenovando(false);
                atualizar();
              }}
            />
            <Button variant="ghost" className="self-start" onClick={() => setRenovando(false)}>
              Agora não
            </Button>
          </div>
        ) : botaoRenovarNoAviso ? null : (
          <Button variant="secondary" className="self-start" onClick={() => setRenovando(true)}>
            Pagar mais 30 dias por Pix
          </Button>
        )
      ) : null}
    </Section>
  );
}
