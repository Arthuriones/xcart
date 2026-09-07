import type { Metadata } from "next";
import { textosLanding } from "./textos-landing";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Globe2,
  ImageOff,
  Languages,
  Route,
  ShoppingBag,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import { PRO_PRICE_BRL, PRO_INCLUDED_CREDITS, CREDIT_PACKS } from "@/lib/billing/plans";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://user.xcart.app";

export function generateMetadata(): Metadata {
  const t = textosLanding();
  return { title: t("metaTitle"), description: t("metaDesc") };
}

const FEATURE_ICONS = [ShoppingBag, Languages, ImageOff, Route, Store, Zap];

export default function LandingPage() {
  const t = textosLanding();
  const loginUrl = `${appUrl}/login`;
  // Os CTAs de conversao abrem direto o formulario de CADASTRO. Antes todos
  // apontavam para /login, entao quem clicava em "Comecar agora" caia numa tela
  // de entrar e precisava achar a aba "Criar Conta".
  const signupUrl = `${loginUrl}?mode=signup`;
  const features = t.raw("features") as { title: string; desc: string }[];
  const steps = t.raw("steps") as { title: string; desc: string }[];
  const proFeatures = (t.raw("proFeatures") as string[]).map((s) =>
    s.replace("{credits}", String(PRO_INCLUDED_CREDITS))
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/lp" className="flex items-center">
            <img src="/logo.png" alt="xcart" className="h-8 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#recursos" className="hover:text-foreground">{t("navFeatures")}</a>
            <a href="#como-funciona" className="hover:text-foreground">{t("navHow")}</a>
            <a href="#precos" className="hover:text-foreground">{t("navPricing")}</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href={loginUrl} className="text-sm text-muted-foreground hover:text-foreground">
              {t("signIn")}
            </a>
            <a
              href={signupUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              {t("start")} <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 -z-0 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="relative z-10 mx-auto max-w-6xl px-5 py-20 text-center md:py-28">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {t("heroBadge")}
          </div>
          <h1 className="mx-auto max-w-3xl font-heading text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            {t("heroTitlePre")}
            <span className="text-primary">{t("heroTitleHighlight")}</span>
            {t("heroTitlePost")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            {t("heroSubtitle")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={signupUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-base font-medium text-primary-foreground transition hover:opacity-90"
            >
              {t("ctaStartNow")} <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#precos"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-6 py-3 text-base font-medium transition hover:bg-muted"
            >
              {t("ctaSeePricing")}
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {t("heroNote", { credits: PRO_INCLUDED_CREDITS })}
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">{t("featuresTitle")}</h2>
          <p className="mt-3 text-muted-foreground">{t("featuresSubtitle")}</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const Icon = FEATURE_ICONS[i] ?? ShoppingBag;
            return (
              <div
                key={f.title}
                className="rounded-2xl border border-border/60 bg-card p-6 transition hover:border-primary/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="border-y border-border/40 bg-muted/30">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-heading text-3xl font-bold tracking-tight">{t("howTitle")}</h2>
            <p className="mt-3 text-muted-foreground">{t("howSubtitle")}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {steps.map((s, i) => (
              <div key={s.title} className="relative">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Preços */}
      <section id="precos" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">{t("pricingTitle")}</h2>
          <p className="mt-3 text-muted-foreground">{t("pricingSubtitle")}</p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-[1.2fr_1fr]">
          {/* Plano Pro */}
          <div className="relative rounded-3xl border-2 border-primary bg-card p-8">
            <div className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              {t("popular")}
            </div>
            <h3 className="text-lg font-semibold">Pro</h3>
            <div className="mt-3 flex items-end gap-1">
              <span className="text-5xl font-bold">R$ {PRO_PRICE_BRL}</span>
              <span className="mb-1.5 text-muted-foreground">{t("perMonth")}</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm">
              {proFeatures.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <a
              href={signupUrl}
              className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition hover:opacity-90"
            >
              {t("subscribePro")} <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          {/* Recargas de crédito */}
          <div className="rounded-3xl border border-border/60 bg-card p-8">
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">{t("creditsExtra")}</h3>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{t("creditsExtraDesc")}</p>
            <ul className="mt-6 space-y-3">
              {CREDIT_PACKS.map((pack) => (
                <li
                  key={pack.id}
                  className="flex items-center justify-between rounded-xl border border-border/50 px-4 py-3 text-sm"
                >
                  <span className="font-medium">{pack.label}</span>
                  <span className="text-muted-foreground">
                    R$ {(pack.amountCents / 100).toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">{t("buyInApp")}</p>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 className="font-heading text-3xl font-bold tracking-tight">{t("finalTitle")}</h2>
          <p className="mt-3 text-muted-foreground">{t("finalSubtitle")}</p>
          <a
            href={signupUrl}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3 text-base font-medium text-primary-foreground transition hover:opacity-90"
          >
            {t("ctaStartNow")} <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <img src="/logo.png" alt="xcart" className="h-6 w-auto" />
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-foreground">{t("privacy")}</Link>
            <Link href="/terms" className="hover:text-foreground">{t("terms")}</Link>
            <a href={loginUrl} className="hover:text-foreground">{t("signIn")}</a>
          </div>
          <p>© {new Date().getFullYear()} xcart</p>
        </div>
      </footer>
    </div>
  );
}
