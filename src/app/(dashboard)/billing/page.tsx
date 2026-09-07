"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { textos } from "@/lib/textos";
import { CreditCard, Loader2, QrCode, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import dynamic from "next/dynamic";
import { AssinarPro } from "@/components/billing/assinar-pro";
import type { CobrancaPix } from "@/components/billing/pix-dialog";

// So monta quando existe uma cobranca Pix aberta.
const PixDialog = dynamic(
  () => import("@/components/billing/pix-dialog").then((m) => m.PixDialog),
  { ssr: false }
);

interface BillingInfo {
  email: string;
  plan: string;
  subscriptionStatus: string | null;
  aiCredits: number;
  includedCredits: number;
  currentPeriodEnd: string | null;
  usageThisMonth: { costUsd: number; creditsUsed: number };
}

interface Pack {
  id: string;
  credits: number;
  amountCents: number;
  label: string;
}

interface Assinatura {
  provider: "pagou" | "stripe";
  legacy?: boolean;
  manageable?: boolean;
  subscription?: {
    id: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cardLast4?: string | null;
  } | null;
  status?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function BillingInner() {
  const t = textos("billing");
  const tc = textos("common");

  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [assinatura, setAssinatura] = useState<Assinatura | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [mostrarCartao, setMostrarCartao] = useState(false);
  const [pix, setPix] = useState<CobrancaPix | null>(null);
  // A Pagou exige CPF do pagador no Pix. Pedimos uma vez e o backend guarda.
  const [cpf, setCpf] = useState("");
  const [pedirCpf, setPedirCpf] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meRes, packsRes, subRes] = await Promise.all([
        fetch("/api/billing/me"),
        fetch("/api/billing/credits"),
        fetch("/api/billing/subscription"),
      ]);
      if (meRes.ok) setInfo(await meRes.json());
      if (packsRes.ok) setPacks((await packsRes.json()).packs || []);
      if (subRes.ok) setAssinatura(await subRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // --- assinatura ---------------------------------------------------------
  async function cancelar() {
    if (
      !confirm(
        "Cancelar a assinatura? O acesso continua até o fim do período já pago."
      )
    )
      return;
    setBusy("cancel");
    try {
      const res = await fetch("/api/billing/subscription", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || tc("fail"));
      toast.success(
        data.accessUntil
          ? `Cancelada. Acesso até ${new Date(data.accessUntil).toLocaleDateString("pt-BR")}.`
          : "Cancelamento agendado para o fim do período."
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("fail"));
    } finally {
      setBusy(null);
    }
  }

  // --- recarga ------------------------------------------------------------
  async function comprarPack(pack: Pack) {
    setBusy(pack.id);
    try {
      const res = await fetch("/api/billing/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: pack.id,
          ...(cpf.trim() ? { document: cpf } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Primeira compra: em vez de erro cru, abre o campo de CPF no pacote.
        if (data.needsDocument) {
          setPedirCpf(pack.id);
          toast.error(data.error);
          return;
        }
        throw new Error(data.error || tc("fail"));
      }
      setPedirCpf(null);
      setPix({
        transactionId: data.transactionId,
        credits: data.credits,
        amountCents: data.amountCents,
        pix: data.pix,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("fail"));
    } finally {
      setBusy(null);
    }
  }

  // 000.000.000-00 enquanto digita
  function mascaraCpf(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }

  const isPro = info?.plan === "pro";
  const sub = assinatura?.subscription;
  const cancelada = sub?.cancelAtPeriodEnd || assinatura?.cancelAtPeriodEnd;
  const fimPeriodo = sub?.currentPeriodEnd || info?.currentPeriodEnd;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-[13px] text-t2">{t("subtitle")}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : (
        <>
          {/* Plano atual */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {t("planTitle", { name: isPro ? "Pro" : "Free" })}
                    <Badge
                      variant={isPro ? "default" : "secondary"}
                      className="rounded-md"
                    >
                      {isPro
                        ? info?.subscriptionStatus || t("statusActive")
                        : t("statusNone")}
                    </Badge>
                    {cancelada && (
                      <Badge variant="outline" className="rounded-md">
                        cancelamento agendado
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isPro ? t("proDesc") : t("freeDesc")}
                  </CardDescription>
                </div>

                {isPro && assinatura?.manageable && !cancelada && (
                  <Button variant="outline" onClick={cancelar} disabled={busy === "cancel"}>
                    {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Cancelar assinatura
                  </Button>
                )}
                {!isPro && !mostrarCartao && (
                  <Button onClick={() => setMostrarCartao(true)}>
                    <Sparkles className="h-4 w-4" />
                    {t("subscribe")}
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-t3">
                    <Zap className="h-3.5 w-3.5 text-primary" /> {t("aiCredits")}
                  </div>
                  <p className="mt-1 font-mono text-[22px] font-medium leading-none tabular-nums text-ink">
                    {info?.aiCredits ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                  <div className="text-[11.5px] text-t3">{t("usedThisMonth")}</div>
                  <p className="mt-1 font-mono text-[22px] font-medium leading-none tabular-nums text-ink">
                    {info?.usageThisMonth.creditsUsed ?? 0}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
                  <div className="text-[11.5px] text-t3">{t("estimatedCost")}</div>
                  <p className="mt-1 font-mono text-[22px] font-medium leading-none tabular-nums text-ink">
                    US$ {info?.usageThisMonth.costUsd?.toFixed(2) ?? "0.00"}
                  </p>
                </div>
              </div>

              {fimPeriodo && (
                <p className="text-xs text-muted-foreground">
                  {cancelada
                    ? `Acesso até ${new Date(fimPeriodo).toLocaleDateString("pt-BR")}.`
                    : t("renewsOn", {
                        date: new Date(fimPeriodo).toLocaleDateString("pt-BR"),
                      })}
                </p>
              )}

              {assinatura?.legacy && (
                <p className="rounded-lg border border-border/60 bg-background/45 p-3 text-xs text-muted-foreground">
                  Esta assinatura foi criada no provedor anterior e continua
                  sendo cobrada normalmente. Para trocar a forma de pagamento ou
                  cancelar, fale com o suporte.
                </p>
              )}

              {/* Assinar: cartao (recorrente) ou Pix (30 dias) */}
              {!isPro && mostrarCartao && (
                <div className="rounded-xl border border-border/60 p-4">
                  <AssinarPro
                    onPronto={async () => {
                      setMostrarCartao(false);
                      await load();
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recarga de créditos */}
          <Card>
            <CardHeader>
              <CardTitle>{t("rechargeTitle")}</CardTitle>
              <CardDescription>{t("rechargeDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                {packs.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/45 p-4"
                  >
                    <p className="text-lg font-semibold text-foreground">
                      {t("creditsCount", { n: pack.credits })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {brl(pack.amountCents)}
                    </p>
                    {pedirCpf === pack.id && (
                      <input
                        autoFocus
                        inputMode="numeric"
                        placeholder="CPF do pagador"
                        value={mascaraCpf(cpf)}
                        onChange={(e) => setCpf(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && comprarPack(pack)}
                        className="rounded-lg border border-border/60 bg-background/45 px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    )}
                    <Button
                      variant="outline"
                      className="mt-1"
                      onClick={() => comprarPack(pack)}
                      disabled={busy === pack.id}
                    >
                      {busy === pack.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <QrCode className="h-4 w-4" />
                      )}
                      Pagar no Pix
                    </Button>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                O Pix cai na hora. Os créditos entram assim que o pagamento é
                confirmado. O CPF é exigido pelo banco emissor da cobrança e
                fica salvo para as próximas.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {pix && (
        <PixDialog
          cobranca={pix}
          onPago={load}
          onFechar={() => {
            setPix(null);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  );
}
