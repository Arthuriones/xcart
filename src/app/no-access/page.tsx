import Link from "next/link";
import { LogoXcart } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";
import { APP_HOME } from "@/lib/app-home";
import { lerAssinatura } from "@/lib/leitura/assinatura";
import { motivoDoBloqueio } from "@/components/billing/regras";
import { AssinarNoPaywall, BotaoSair } from "./assinar-paywall";

export const dynamic = "force-dynamic";

/**
 * Paywall. Fica fora da casca do painel (sem menu): quem chega aqui nao tem
 * acesso as outras telas. Diz por que chegou (clonagem gratuita usada, Pix de
 * 30 dias vencido, assinatura encerrada), o que o Pro inclui (a mesma lista
 * da Assinatura) e deixa assinar ali mesmo, com cartao ou Pix.
 *
 * Espaco de prova social: so com material real, que ainda nao existe -- por
 * isso nao ha bloco nenhum (ver pendencias do redesign).
 */

// TEXTO PARA O ARTHUR REVISAR: perguntas frequentes escritas a partir do que
// o codigo faz hoje (cancelamento no fim do periodo, Pix que soma dias,
// credito por imagem). Nada de teste gratis nem preco inventado.
const PERGUNTAS: { p: string; r: string }[] = [
  {
    p: "Quando o acesso libera?",
    r: "Na hora em que o cartão é aprovado ou o Pix é confirmado. Você entra no xcart sem precisar fazer login de novo.",
  },
  {
    p: "Posso cancelar quando quiser?",
    r: "Sim. No cartão, o cancelamento fica em Assinatura e créditos, e o acesso continua até o fim do período já pago. O Pix não renova sozinho, então não há o que cancelar.",
  },
  {
    p: "Como funciona o pagamento por Pix?",
    r: "Cada Pix libera 30 dias de Pro. Se pagar antes de acabar, os dias novos se somam aos que ainda faltam.",
  },
  {
    p: "O que é um crédito de IA?",
    r: `Um crédito neutraliza uma imagem com IA. O Pro inclui ${PRO_INCLUDED_CREDITS} por mês, e dá para comprar mais por Pix dentro do app. Neutralizar texto não usa crédito.`,
  },
];

export default async function NoAccessPage() {
  const d = await lerAssinatura({ completo: false });
  const motivo = motivoDoBloqueio(d.perfil, d.agora);

  return (
    <div className="min-h-dvh bg-bg px-4 py-8 text-ink md:py-14">
      <Toaster />
      <main className="mx-auto flex w-full max-w-240 flex-col gap-8">
        <LogoXcart altura={22} prioridade />

        {motivo === null ? (
          // Tem acesso e chegou aqui pelo endereco: nada a assinar.
          <section className="flex max-w-120 flex-col gap-3">
            <h1 className="text-page text-ink">Seu acesso está liberado</h1>
            <p className="text-body text-t1">Sua conta já pode usar o xcart. Não é preciso assinar de novo.</p>
            <Link href={APP_HOME} className={buttonVariants({ className: "self-start" })}>
              Ir para o xcart
            </Link>
          </section>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-12">
            <header className="flex flex-col gap-2">
              <h1 className="text-page text-ink">Assine o Pro para continuar</h1>
              <p className="max-w-[60ch] text-body text-t1">{motivo}</p>
              <p className="max-w-[60ch] text-body text-t1">
                Suas lojas, custos e configurações continuam salvos: assim que o pagamento for
                confirmado, tudo volta a abrir.
              </p>
            </header>

            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <AssinarNoPaywall temDocumento={d.perfil ? d.perfil.temDocumento : undefined} />
            </div>

            <section aria-labelledby="perguntas" className="flex flex-col gap-3">
              <h2 id="perguntas" className="text-section text-ink">
                Perguntas frequentes
              </h2>
              <dl className="flex flex-col divide-y divide-border-subtle rounded-card border border-border bg-surface">
                {PERGUNTAS.map((q) => (
                  <div key={q.p} className="flex flex-col gap-1 px-4 py-3">
                    <dt className="text-dense font-semibold text-ink">{q.p}</dt>
                    <dd className="text-dense text-t1">{q.r}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        )}

        <div className="flex justify-center border-t border-border-subtle pt-4 lg:justify-start">
          <BotaoSair />
        </div>
      </main>
    </div>
  );
}
