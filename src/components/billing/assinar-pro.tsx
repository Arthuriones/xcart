"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Check, CreditCard, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import type { CobrancaPix } from "@/components/billing/pix-dialog";
import { GARANTIA, ehPlanoAVenda, planoEmDestaque, planoPorId, type PlanoId } from "@/lib/billing/plans";
import { cpfValido, digitos } from "@/lib/billing/documento";
import { recursosDoPlano } from "@/components/billing/beneficios";
import { CampoCpf } from "@/components/billing/campo-cpf";
import { Escolha } from "@/components/billing/escolha";
import { EscolhaDePlano } from "@/components/billing/escolha-plano";
import { lerPlanoEscolhido, semAvisos } from "@/components/billing/plano-escolhido";
import { ERRO_PADRAO, brl, mensagemDeErro, type ErroNaTela } from "@/components/billing/regras";
import { pixAutomaticoLigado, provedorDeCobranca } from "@/lib/billing/provedor";

// So aparecem depois de escolher a forma de pagamento. Somados sao 16 KB que
// todo mundo baixava para ver o botao de assinar.
const PagouCardForm = dynamic(
  () => import("@/components/billing/pagou-card-form").then((m) => m.PagouCardForm),
  { ssr: false }
);
const PixDialog = dynamic(
  () => import("@/components/billing/pix-dialog").then((m) => m.PixDialog),
  { ssr: false }
);
const AssinarNaAbacatePay = dynamic(
  () => import("@/components/billing/assinar-na-abacatepay").then((m) => m.AssinarNaAbacatePay),
  { ssr: false }
);

// ============================================================================
// Assinar um dos planos. Usado na Assinatura e no paywall.
//
// Primeiro o plano (Roteamento, Completo, Ilimitado: o mesmo catalogo da
// landing; na renovacao por Pix, tambem o plano anterior de quem ainda paga
// por ele, pelo mesmo preco), depois a forma de pagamento. Dois caminhos,
// porque o processador nao tem um so que sirva para todo mundo:
//  - Cartao: assinatura de verdade, renova sozinha. Na Pagou o cartao e
//    digitado aqui (pagou-card-form); na AbacatePay (provedorDeCobranca) o
//    lojista paga na pagina dela, que tambem aceita Pix Automatico quando ele
//    esta liberado, e volta (assinar-na-abacatepay).
//  - Pix: cobranca avulsa que libera 30 dias. Nao renova.
// Corpos: { packId: "pro_month", plano, document? } para o Pix e
// { cardToken, plano } (Pagou) ou { plano, volta } (AbacatePay) em
// /api/billing/subscribe. O valor sai do servidor.
// ============================================================================

type Via = "cartao" | "pix";

export function AssinarPro({
  onPronto,
  somentePix = false,
  temDocumento,
  mostrarResumo = true,
  planoInicial,
  volta = "billing",
}: {
  /** Para onde a pagina da AbacatePay devolve: a Assinatura ou o paywall. */
  volta?: "billing" | "paywall";
  /** Pagamento confirmado (cartao aceito ou Pix pago). */
  onPronto: () => void;
  /**
   * O plano marcado de partida (o atual, ao renovar). Sem ele, o em destaque.
   * Plano anterior (fora da venda) so entra na escolha aqui, na renovacao.
   */
  planoInicial?: PlanoId | null;
  /** So o Pix: renovar quem ja paga por Pix (os dias se somam). */
  somentePix?: boolean;
  /** O CPF ja esta salvo? undefined = nao se sabe (pede so se o servidor pedir). */
  temDocumento?: boolean;
  /** A lista do que todo plano inclui. */
  mostrarResumo?: boolean;
}) {
  // De partida: o plano atual (renovacao), o escolhido na landing, ou o em
  // destaque. O da landing so existe no navegador: no servidor e null.
  const daLanding = useSyncExternalStore(semAvisos, lerPlanoEscolhido, () => null);
  const [escolhido, setPlanoId] = useState<PlanoId | null>(null);
  // O plano anterior so se oferece na renovacao por Pix (o servidor confere
  // que e o da conta); fora dela, a escolha e so entre os a venda.
  const anterior = somentePix && planoInicial && !ehPlanoAVenda(planoInicial) ? planoInicial : null;
  const inicial = planoInicial && (anterior || ehPlanoAVenda(planoInicial)) ? planoInicial : null;
  const planoId = escolhido ?? inicial ?? daLanding ?? planoEmDestaque().id;
  const plano = planoPorId(planoId) ?? planoEmDestaque();
  const [via, setVia] = useState<Via | null>(somentePix ? "pix" : null);
  const [cpf, setCpf] = useState("");
  const [pedirCpf, setPedirCpf] = useState(temDocumento === false);
  const [erroCpf, setErroCpf] = useState<string | null>(null);
  const [erro, setErro] = useState<ErroNaTela | null>(null);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<CobrancaPix | null>(null);
  const pixPago = useRef(false);
  const abacate = provedorDeCobranca() === "abacatepay";
  const comPixAutomatico = abacate && pixAutomaticoLigado();
  // Estavel: o PixDialog reinicia a consulta quando onPago muda.
  const marcarPago = useCallback(() => {
    pixPago.current = true;
  }, []);

  async function gerarPix() {
    setErro(null);
    // CPF conferido aqui antes de ir ao servidor: o erro aparece no campo.
    if (pedirCpf && !cpfValido(digitos(cpf))) {
      setErroCpf(digitos(cpf) ? "CPF inválido. Confira os números." : "Informe o CPF do pagador.");
      return;
    }
    setErroCpf(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: "pro_month",
          plano: plano.id,
          ...(cpf.trim() ? { document: cpf } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.needsDocument) {
          setPedirCpf(true);
          setErroCpf(pedirCpf ? mensagemDeErro(res.status, data.error, "Confira o CPF.").texto : null);
          return;
        }
        setErro(mensagemDeErro(res.status, data.error, ERRO_PADRAO.pix));
        return;
      }
      setPedirCpf(false);
      setPix({
        transactionId: data.transactionId,
        credits: data.credits,
        amountCents: data.amountCents,
        kind: "pro_month",
        nomePlano: plano.nome,
        pix: data.pix,
      });
    } catch {
      setErro({ texto: ERRO_PADRAO.pix, detalhe: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    // @container: os cartoes de forma de pagamento ficam lado a lado so quando
    // o bloco e largo (Assinatura), e empilhados na coluna estreita do paywall.
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-dense font-medium text-ink">Escolha o plano</p>
        <EscolhaDePlano
          valor={planoId}
          planoAnterior={anterior}
          onValor={(v) => {
            setPlanoId(v);
            setErro(null);
          }}
          desabilitado={busy}
        />
      </div>

      {mostrarResumo ? (
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-4">
          <span className="text-dense font-semibold text-ink">O plano {plano.nome} inclui</span>
          <ul aria-label={`O que o plano ${plano.nome} inclui`} className="flex flex-col gap-1.5">
            {recursosDoPlano(plano.limites).map((item) => (
              <li key={item} className="flex items-start gap-2 text-dense text-t1">
                <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ok" strokeWidth={2} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!somentePix ? (
        <div className="flex flex-col gap-2">
          <p className="text-dense font-medium text-ink">
            Como você prefere pagar?
          </p>
          <Escolha<Via>
            rotulo="Forma de pagamento"
            valor={via}
            onValor={(v) => {
              setVia(v);
              setErro(null);
            }}
            className="@md:grid-cols-2"
            opcoes={[
              {
                valor: "cartao",
                titulo: comPixAutomatico ? "Cartão ou Pix Automático" : "Cartão de crédito",
                descricao: "Renova sozinho todo mês",
                icone: <CreditCard />,
              },
              {
                valor: "pix",
                titulo: "Pix",
                descricao: "Libera 30 dias na hora, sem renovação automática",
                icone: <QrCode />,
              },
            ]}
          />
        </div>
      ) : null}

      {via === "cartao" && abacate ? (
        <AssinarNaAbacatePay
          plano={plano.id}
          rotulo={`Assinar o ${plano.nome} por ${brl(plano.precoCentavos)} por mês`}
          volta={volta}
          comPix={comPixAutomatico}
        />
      ) : null}

      {via === "cartao" && !abacate ? (
        <PagouCardForm
          plano={plano.id}
          // O botao diz o que acontece e quanto custa, em vez de um
          // "Assinar agora" que esconde o valor.
          labelBotao={`Assinar o ${plano.nome} por ${brl(plano.precoCentavos)} por mês`}
          // Chamado so depois do desfecho do SDK (3DS incluso); recusa fica
          // no formulario, com a mensagem, para tentar de novo.
          onSuccess={(dados) => {
            const pendente = dados.pending === true;
            if (pendente) {
              toast.info(
                dados.mensagem || "Pagamento em processamento. O plano libera assim que o banco confirmar."
              );
            }
            else toast.success("Assinatura confirmada.");
            onPronto();
          }}
        />
      ) : null}

      {via === "pix" ? (
        <div className="flex flex-col gap-3">
          {pedirCpf ? (
            <CampoCpf
              valor={cpf}
              onValor={(v) => {
                setCpf(v);
                setErroCpf(null);
              }}
              erro={erroCpf}
              onEnter={gerarPix}
              autoFocus={temDocumento !== false}
            />
          ) : null}
          {erro ? (
            <Callout tom="err" titulo={erro.texto} role="alert">
              {erro.detalhe ? (
                <details className="text-label text-t2">
                  <summary className="cursor-pointer">Detalhes para o suporte</summary>
                  <p className="mt-1 break-words font-mono">{erro.detalhe}</p>
                </details>
              ) : null}
            </Callout>
          ) : null}
          <Button size="lg" className="w-full" onClick={gerarPix} pending={busy}>
            {busy ? null : <QrCode aria-hidden />}
            Gerar Pix de {brl(plano.precoCentavos)}
          </Button>
          <p className="text-center text-label text-t2">
            {somentePix
              ? planoInicial && planoInicial !== plano.id
                ? `30 dias do plano ${plano.nome}, que vale assim que o Pix cair. Os dias que ainda faltam do plano atual viram dias do ${plano.nome}, pelo valor de cada um. Não renova sozinho.`
                : `Mais 30 dias do plano ${plano.nome}, somados aos que ainda faltam. Não renova sozinho.`
              : `Libera 30 dias do plano ${plano.nome} assim que o pagamento cair. Não renova sozinho: quando acabar, é só pagar de novo.`}
          </p>
        </div>
      ) : null}

      {!somentePix ? <p className="text-center text-label text-t2">{GARANTIA.longa}</p> : null}

      {pix ? (
        <PixDialog
          cobranca={pix}
          onPago={marcarPago}
          // A tela de tras so muda quando o lojista sai do "Pagamento
          // confirmado". Fechar sem pagar nao libera nada: so tira o QR.
          onFechar={() => {
            setPix(null);
            if (pixPago.current) {
              pixPago.current = false;
              onPronto();
            }
          }}
        />
      ) : null}
    </div>
  );
}
