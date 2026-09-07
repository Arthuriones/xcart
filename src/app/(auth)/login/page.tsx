"use client";

import { Suspense, useEffect, useState } from "react";
import { textos } from "@/lib/textos";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

type Mode = "login" | "signup" | "recovery";

// So aceita destino interno ("/algo"), nunca URL absoluta — evita open redirect.
function safeNextPath(value: string | null) {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

// useSearchParams exige um limite de Suspense (o default export abaixo faz isso).
function LoginForm() {
  const t = textos("auth");
  const searchParams = useSearchParams();
  // A landing manda ?mode=signup para quem clicou em "Comecar agora" cair
  // direto no formulario de cadastro (antes caia no de login).
  const initialMode: Mode =
    searchParams.get("mode") === "signup" ? "signup" : "login";
  const [mode, setMode] = useState<Mode>(initialMode);
  // O middleware e o /api/shopify/auth mandam ?next=... para retomar o fluxo
  // interrompido (ex.: instalacao do app na Shopify com a sessao expirada).
  // Antes esse parametro era ignorado e o usuario perdia o contexto.
  const redirectTarget = safeNextPath(searchParams.get("next")) || "/stores";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!cooldownUntil) return;

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || secondsRemaining > 0) return;

    setErrorMessage(null);
    setLoading(true);

    const supabase = createClient();

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              has_password: true,
            },
          },
        });
        if (error) throw error;
        // Com "Confirm email" ligado no Supabase, signUp retorna SEM erro e SEM
        // sessao. Antes o codigo assumia sucesso e mandava para /stores, onde o
        // middleware nao achava usuario e devolvia para /login sem explicacao —
        // o cadastro parecia simplesmente nao funcionar. Agora mostramos o
        // estado "confirme seu email".
        if (!data.session) {
          setSent(true);
          return;
        }
        router.push(redirectTarget);
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(redirectTarget);
      } else if (mode === "recovery") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/callback?type=recovery`,
        });
        if (error) throw error;
        setSent(true);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t("genericError");
      const normalizedMessage = message.toLowerCase();
      if (
        normalizedMessage.includes("429") ||
        normalizedMessage.includes("too many") ||
        normalizedMessage.includes("security purposes") ||
        normalizedMessage.includes("rate limit")
      ) {
        const secondsMatch = message.match(/(\d+)\s*seconds?/i);
        const waitSeconds = secondsMatch ? Number(secondsMatch[1]) : 60;
        setCooldownUntil(Date.now() + waitSeconds * 1000);
        setErrorMessage(t("tooManyAttempts", { seconds: waitSeconds }));
      } else if (normalizedMessage.includes("invalid login credentials")) {
        setErrorMessage(t("invalidCredentials"));
      } else if (
        normalizedMessage.includes("already registered") ||
        normalizedMessage.includes("already been registered") ||
        normalizedMessage.includes("user already exists")
      ) {
        // Erro mais comum no cadastro: antes vazava a mensagem crua em ingles.
        // Traduz e ja leva o usuario para o modo de login.
        setErrorMessage(t("alreadyRegistered"));
        setMode("login");
      } else {
        setErrorMessage(message);
      }
    } finally {
      setLoading(false);
    }
  }

  const enviando = loading;
  const emEspera = secondsRemaining > 0;

  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-2">
      {/* Formulário. Duas colunas com o modelo da operação ao lado: quem chega
          aqui pela primeira vez precisa entender o que o xcart faz antes de
          criar conta. */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-[8vw]">
        <div className="mb-10 flex items-center gap-2">
          <span
            className="h-5 w-5 rounded-[5px]"
            style={{ background: "var(--brand)" }}
            aria-hidden
          />
          <span className="text-[14px] font-bold tracking-[0.06em] text-ink">XCART</span>
        </div>

        {sent && (mode === "recovery" || mode === "signup") ? (
          <div className="max-w-[360px]">
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
              {mode === "signup" ? t("confirmEmailSent") : t("recoverySent")}
            </h1>
            <p className="mt-1.5 text-[13px] text-t2">
              {t("checkEmail")} <strong className="font-medium text-ink">{email}</strong>
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMode("login");
              }}
              className="mt-6 h-9 rounded-md border border-[var(--border-strong)] bg-surface px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              {t("backToLogin")}
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
              {mode === "signup"
                ? t("signup")
                : mode === "recovery"
                  ? t("forgotPassword")
                  : t("login")}
            </h1>
            <p className="mb-7 mt-1.5 max-w-[340px] text-[13px] text-t2">
              {t("tagline")}
            </p>

            <form
              onSubmit={handleSubmit}
              className="flex max-w-[360px] flex-col gap-3.5"
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-t1">{t("email")}</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com"
                  className="h-9 rounded-md border border-[var(--control-border)] bg-surface px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-[var(--brand)]"
                />
              </label>

              {mode !== "recovery" && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-t1">{t("password")}</span>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-9 rounded-md border border-[var(--control-border)] bg-surface px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-[var(--brand)]"
                  />
                </label>
              )}

              {errorMessage && (
                <p className="rounded-md border border-[var(--err-border)] bg-[var(--err-bg)] px-2.5 py-2 text-[12px] leading-relaxed text-ink">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={enviando || emEspera}
                className="mt-1 h-9 rounded-md bg-[var(--solid)] text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)] active:translate-y-px disabled:opacity-60"
              >
                {emEspera
                  ? t("wait", { seconds: secondsRemaining })
                  : mode === "signup"
                    ? t("signup")
                    : mode === "recovery"
                      ? t("sendAccessLink")
                      : t("login")}
              </button>

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => setMode("recovery")}
                  className="mt-0.5 self-start text-[12px] font-semibold text-[var(--brand)] hover:text-ink"
                >
                  {t("forgotPassword")}
                </button>
              )}

              <p className="mt-0.5 text-[12px] text-t2">
                {mode === "signup" ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
                <button
                  type="button"
                  onClick={() => setMode(mode === "signup" ? "login" : "signup")}
                  className="font-semibold text-[var(--brand)] hover:text-ink"
                >
                  {mode === "signup" ? t("login") : t("signup")}
                </button>
              </p>
            </form>
          </>
        )}
      </div>

      {/* O modelo da operação, do design: vitrine -> xcart -> checkouts. */}
      <div className="hidden flex-col justify-center gap-7 border-l border-border bg-surface-2 px-[6vw] py-12 lg:flex">
        <p className="font-mono text-[10px] tracking-[0.12em] text-t3">
          MODELO DA OPERAÇÃO
        </p>
        <div className="flex max-w-[300px] flex-col gap-2.5">
          <div className="rounded-[7px] border border-border bg-surface px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink">Vitrine</p>
            <p className="text-[11px] text-t3">Recebe o tráfego do anúncio</p>
          </div>
          <span className="ml-4 h-4 w-px bg-[var(--border-strong)]" aria-hidden />
          <div className="rounded-[7px] bg-[var(--solid)] px-3 py-2.5 text-[var(--on-solid)]">
            <p className="text-[12px] font-semibold">XCART</p>
            <p className="text-[11px] opacity-70">Mapeia, sincroniza e roteia</p>
          </div>
          <span className="ml-4 h-4 w-px bg-[var(--border-strong)]" aria-hidden />
          <div className="rounded-[7px] border border-border bg-surface px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink">Lojas de checkout</p>
            <p className="text-[11px] text-t3">Onde o pagamento acontece</p>
          </div>
        </div>
        <p className="max-w-[320px] text-[13px] text-t1">
          Uma vitrine, várias lojas de checkout. O xcart casa os SKUs e decide quem
          cobra cada carrinho.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen bg-background" aria-hidden />}
    >
      <LoginForm />
    </Suspense>
  );
}
