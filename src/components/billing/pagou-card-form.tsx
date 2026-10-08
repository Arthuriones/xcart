"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Spinner } from "@/components/ui/spinner";
import {
  ERRO_PADRAO,
  desfechoDoCartao,
  mensagemDeErro,
  type DesfechoCartao,
} from "@/components/billing/regras";
import type { PlanoId } from "@/lib/billing/plans";

// ============================================================================
// Payment Element da Pagou.
//
// A Pagou nao tem checkout hospedado: o cartao e digitado num iframe servido
// por js.pagou.ai, que devolve um token pgct_. O numero do cartao nunca passa
// pelo nosso dominio nem pelo nosso servidor.
//
// O fluxo (developer.pagou.ai/frontend/payment-element/sdk-reference):
// elements.submit({ mode: "subscription", createTransaction }) tokeniza,
// chama o callback (que cria a assinatura no nosso servidor e devolve a
// TRANSACAO da 1a cobranca), roda o 3DS se ela pedir e SO ENTAO resolve com o
// desfecho. O pai so fica sabendo depois disso: ele troca de tela, e trocar
// antes desmontava o iframe no meio do 3DS.
// ============================================================================

const SCRIPT = "https://js.pagou.ai/payments/v3.js";

interface PagouElements {
  create(
    tipo: "card",
    opts?: {
      theme?: "default" | "night" | "flat" | "soft";
      locale?: string;
      style?: Record<string, string | Record<string, string>>;
    }
  ): { mount(seletor: string): void };
  submit(opts: {
    // "subscription": captura de cartao para iniciar assinatura (token pgct_).
    mode?: "payment" | "upsell" | "subscription";
    createTransaction: (tokenData: { token: string }) => Promise<unknown>;
  }): Promise<
    | {
        // O SDK devolve status terminal ou requires_action; error vem como
        // string em erro de tokenizacao e como objeto vindo da API.
        status?: string;
        error?: string | { message?: string };
      }
    | undefined
  >;
}
interface PagouGlobal {
  setEnvironment(env: "sandbox" | "production"): void;
  elements(opts: { publicKey: string; locale?: string; origin?: string }): PagouElements;
}
declare global {
  interface Window {
    Pagou?: PagouGlobal;
  }
}

let carregando: Promise<void> | null = null;
function carregarScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("sem window"));
  if (window.Pagou) return Promise.resolve();
  if (carregando) return carregando;
  carregando = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Não foi possível carregar o formulário de pagamento."));
    document.head.appendChild(s);
  });
  return carregando;
}

/**
 * Opcoes visuais do iframe, tiradas dos tokens do tema ATUAL (o iframe aplica
 * as cores inline, entao vao os valores e nao as variaveis). Antes era sempre
 * "night" com hex fixo: um formulario escuro dentro do app claro.
 *
 * Os temas aceitos sao default, night, flat e soft -- NAO existe "dark":
 * qualquer valor desconhecido cai em "default", que e claro. As chaves de
 * style sao as que o elemento le (base/focus/invalid/placeholder/
 * cellBackground/labelColor/defaultBorder). Le no momento de montar: trocar
 * o tema com o formulario aberto so vale na proxima vez que ele abrir.
 */
function aparenciaDoTema(): {
  theme: "default" | "night";
  style: Record<string, string | Record<string, string>>;
} {
  const raiz = document.documentElement;
  const css = getComputedStyle(raiz);
  const v = (nome: string) => css.getPropertyValue(nome).trim();
  const so = (obj: Record<string, string>) =>
    Object.fromEntries(Object.entries(obj).filter(([, valor]) => valor));

  const style: Record<string, string | Record<string, string>> = {
    base: so({
      color: v("--ink"),
      fontFamily: "'Public Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      // 16px: abaixo disso o iPhone da zoom ao focar o campo.
      fontSize: "16px",
      letterSpacing: "0",
    }),
    placeholder: so({ color: v("--t3") }),
    focus: so({ borderColor: v("--focus") }),
    invalid: so({ color: v("--err") }),
  };
  const extras = so({
    cellBackground: v("--surface"),
    focusBackground: v("--surface"),
    labelColor: v("--t1"),
    defaultBorder: v("--control-border"),
  });
  return { theme: raiz.classList.contains("dark") ? "night" : "default", style: { ...style, ...extras } };
}

/** O que /api/billing/subscribe responde quando cria a assinatura. */
interface RespostaAssinatura {
  subscriptionId: string;
  status: string;
  /** A transacao da 1a cobranca ({ id, status, next_action }); null = sem ela. */
  transaction: Record<string, unknown> | null;
  pending: boolean;
  /** Quando o servidor nao conseguiu a transacao: o que dizer enquanto espera. */
  mensagem?: string;
}

function textoDoErro(err: unknown): string | null {
  if (typeof err === "string") return err;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" ? msg : null;
}

export function PagouCardForm({
  onSuccess,
  labelBotao,
  plano,
}: {
  /** So depois do desfecho do SDK (3DS incluso). `pending` diz se o banco ainda vai confirmar. */
  onSuccess: (dados: RespostaAssinatura) => void;
  labelBotao: string;
  /** O plano escolhido: vai no corpo, e o servidor cobra o valor dele. */
  plano: PlanoId;
}) {
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_PAGOU_PUBLIC_KEY;
  // Sem a chave publica o cartao nao funciona nesta instalacao. A tela diz
  // isso em portugues e oferece o Pix; o nome da configuracao nao aparece.
  const semChave = !publicKey;
  const [enviando, setEnviando] = useState(false);
  const elementsRef = useRef<PagouElements | null>(null);
  const montado = useRef(false);

  useEffect(() => {
    // A chave publica e constante de build: se falta, falta desde o primeiro
    // render. Setar isso no efeito custava um render so para mostrar um erro
    // que ja era conhecido -- agora sai de `semChave`, derivado.
    if (!publicKey) return;
    let vivo = true;

    carregarScript()
      .then(() => {
        if (!vivo || montado.current || !window.Pagou) return;
        montado.current = true;

        window.Pagou.setEnvironment(
          process.env.NEXT_PUBLIC_PAGOU_ENV === "production" ? "production" : "sandbox"
        );
        const elements = window.Pagou.elements({
          publicKey,
          locale: "pt",
          origin: window.location.origin,
        });
        const { theme, style } = aparenciaDoTema();
        elements.create("card", { theme, locale: "pt", style }).mount("#pagou-card-element");
        elementsRef.current = elements;
        setPronto(true);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Falha ao carregar."));

    return () => {
      vivo = false;
    };
  }, []);

  async function enviar() {
    if (!elementsRef.current || enviando) return;
    setEnviando(true);
    setErro(null);
    // O que o nosso servidor disse, guardado aqui: o pai so recebe depois que
    // o submit resolver. Cada tentativa comeca do zero (token novo, chave nova).
    const tentativa: { resposta: RespostaAssinatura | null; erro: string | null } = {
      resposta: null,
      erro: null,
    };
    let desfecho: DesfechoCartao;
    try {
      // O SDK tokeniza o cartao e chama este callback com o token pgct_.
      // A assinatura e criada no nosso backend, nunca no browser.
      const resultado = await elementsRef.current.submit({
        mode: "subscription",
        createTransaction: async (tokenData) => {
          const res = await fetch("/api/billing/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardToken: tokenData.token, plano }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg: string =
              typeof data.error === "string" && data.error ? data.error : "Falha ao assinar.";
            tentativa.erro = msg;
            throw new Error(msg);
          }
          const resposta = data as RespostaAssinatura;
          tentativa.resposta = resposta;
          // A TRANSACAO da 1a cobranca, intacta (id/status/next_action): e
          // por ela que o SDK roda o 3DS e le o desfecho. Sem ela nao ha o que
          // resolver; o desfecho vem do servidor (pending), nao do SDK.
          return resposta.transaction ?? { status: resposta.status };
        },
      });
      desfecho = desfechoDoCartao({
        status: resultado?.status,
        erro: tentativa.erro ?? textoDoErro(resultado?.error),
        servidor: tentativa.resposta,
      });
    } catch (e) {
      desfecho = desfechoDoCartao({
        status: "error",
        erro: tentativa.erro ?? textoDoErro(e) ?? "Falha ao processar o cartão.",
        servidor: tentativa.resposta,
      });
    }
    setEnviando(false);
    if (desfecho.tipo === "erro") {
      // O iframe continua montado: e so corrigir o cartao (ou trocar) e tentar.
      setErro(desfecho.bruto);
      return;
    }
    if (tentativa.resposta) {
      onSuccess({ ...tentativa.resposta, pending: desfecho.tipo === "pendente" });
    }
  }

  // O texto cru (do SDK ou do processador) pode vir em ingles ou com nome de
  // fornecedor: a tela mostra a versao em portugues e guarda o cru recolhido.
  const erroNaTela = erro ? mensagemDeErro(null, erro, ERRO_PADRAO.cartao) : null;

  if (semChave) {
    return (
      <Callout tom="warn" titulo="O pagamento com cartão está indisponível agora">
        Use o Pix, que libera 30 dias na hora, ou fale com o suporte.
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* O iframe tem 320px fixos e desenha os proprios campos. O respiro
          precisa vir daqui: sem ele o formulario encostava nas bordas. */}
      <div className="rounded-card border border-border bg-surface px-3 py-1">
        <div id="pagou-card-element" className="min-h-80 w-full" />
      </div>

      {!pronto && !erroNaTela ? (
        <p role="status" className="flex items-center justify-center gap-2 text-label text-t2">
          <Spinner size={12} />
          Carregando o formulário seguro…
        </p>
      ) : null}

      {erroNaTela ? (
        <Callout tom="err" titulo={erroNaTela.texto} role="alert">
          {erroNaTela.detalhe ? (
            <details className="text-label text-t2">
              <summary className="cursor-pointer">Detalhes para o suporte</summary>
              <p className="mt-1 break-words font-mono">{erroNaTela.detalhe}</p>
            </details>
          ) : null}
        </Callout>
      ) : null}

      <Button onClick={enviar} disabled={!pronto} pending={enviando} size="lg" className="w-full">
        {labelBotao}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-center text-label text-t2">
        <ShieldCheck aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        O cartão é digitado num ambiente seguro do processador e não passa pelos nossos servidores.
      </p>
    </div>
  );
}
