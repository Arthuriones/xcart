"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

// ============================================================================
// Payment Element da Pagou.
//
// A Pagou nao tem checkout hospedado: o cartao e digitado num iframe servido
// por js.pagou.ai, que devolve um token pgct_. O numero do cartao nunca passa
// pelo nosso dominio nem pelo nosso servidor.
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

export function PagouCardForm({
  onSuccess,
  labelBotao,
}: {
  onSuccess: (dados: unknown) => void;
  labelBotao: string;
}) {
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const publicKey = process.env.NEXT_PUBLIC_PAGOU_PUBLIC_KEY;
  const erroDeConfig = publicKey ? null : "NEXT_PUBLIC_PAGOU_PUBLIC_KEY não configurada.";
  const erroVisivel = erro ?? erroDeConfig;
  const [enviando, setEnviando] = useState(false);
  const elementsRef = useRef<PagouElements | null>(null);
  const montado = useRef(false);

  useEffect(() => {
    // A chave publica e constante de build: se falta, falta desde o primeiro
    // render. Setar isso no efeito custava um render so para mostrar um erro
    // que ja era conhecido -- agora sai de `erroDeConfig`, derivado.
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
        // Os temas aceitos sao default, night, flat e soft — NAO existe
        // "dark": qualquer valor desconhecido cai em "default", que e claro.
        // Era por isso que o formulario aparecia branco dentro do app escuro.
        //
        // As chaves de style abaixo sao as que o elemento realmente le
        // (base/focus/invalid/placeholder/cellBackground/labelColor/
        // defaultBorder). Os valores vem da paleta do app, convertidos de
        // oklch para hex porque o iframe aplica as cores inline.
        elements
          .create("card", {
            theme: "night",
            locale: "pt",
            style: {
              base: {
                color: "#eff2f6",
                fontFamily:
                  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
                fontSize: "15px",
                letterSpacing: "0",
              },
              placeholder: { color: "#8b93a0" },
              focus: { borderColor: "#566be9" },
              invalid: { color: "#ea3c3f" },
              // Campo um tom acima da superficie do cartao: em UI escura e o
              // que faz o input parecer clicavel.
              cellBackground: "#1a1e27",
              focusBackground: "#1a1e27",
              labelColor: "#8b93a0",
              defaultBorder: "#282e39",
            },
          })
          .mount("#pagou-card-element");
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
    try {
      // O SDK tokeniza o cartao e chama este callback com o token pgct_.
      // A assinatura e criada no nosso backend, nunca no browser.
      const resultado = await elementsRef.current.submit({
        createTransaction: async (tokenData) => {
          const res = await fetch("/api/billing/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardToken: tokenData.token }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Falha ao assinar.");
          onSuccess(data);
          // O SDK passa este retorno para resolvePayment(), que espera uma
          // TRANSACAO (le id/status/next_action). Devolver a assinatura faria
          // ele tratar 3DS com o objeto errado.
          return data.transaction || { id: data.subscriptionId, status: data.status };
        },
      });
      // O SDK devolve { status, error } — error pode ser string ou objeto.
      const err = resultado?.error as unknown;
      const msg =
        typeof err === "string" ? err : (err as { message?: string })?.message;
      if (msg) setErro(msg);
      else if (resultado?.status === "requires_action")
        setErro("O banco pediu autenticação adicional. Tente outro cartão.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao processar o cartão.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* O iframe tem 320px fixos e desenha os proprios campos. O respiro
          precisa vir daqui: sem ele o formulario encostava nas bordas. */}
      <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-1">
        <div id="pagou-card-element" className="min-h-[320px] w-full" />
      </div>

      {!pronto && !erroVisivel && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando formulário seguro…
        </p>
      )}

      {erroVisivel && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs leading-relaxed text-destructive">{erroVisivel}</p>
        </div>
      )}

      <Button
        onClick={enviar}
        disabled={!pronto || enviando}
        size="lg"
        className="w-full"
      >
        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
        {labelBotao}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Dados processados pela Pagou — não passam pelos nossos servidores
      </p>
    </div>
  );
}
