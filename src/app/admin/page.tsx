"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FaturamentoAdmin } from "@/lib/sales/admin-types";

interface AdminUser {
  id: string;
  email: string;
  plan: string;
  hasAccess: boolean;
  createdAt: string | null;
  usageThisMonth: { costUsd: number; costBrl: number; credits: number };
  stores: { domain: string; name: string }[];
}

interface Purchase {
  email: string;
  credits: number;
  amountBrl: number;
  currency: string;
  createdAt: string;
}

interface Overview {
  summary: {
    totalUsers: number;
    proUsers: number;
    withAccess: number;
    newUsersThisMonth: number;
    mrrBrl: number;
    aiCostThisMonthUsd: number;
    aiCostThisMonthBrl: number;
    usdBrlRate: number;
    totalStores: number;
    creditRevenueMonthBrl: number;
    creditRevenueTotalBrl: number;
    creditPurchasesTotal: number;
    grossMarginMonthBrl: number;
    payingUsers: number;
  };
  recentPurchases: Purchase[];
  revenueByMonth: { mes: string; creditoBrl: number; compras: number }[];
  users: AdminUser[];
}

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Antes o nome da loja era texto puro: dava para ver que o cliente tinha loja,
// mas nao para abrir. Agora vai direto para a vitrine, e o icone ao lado leva
// ao admin da Shopify daquela loja.
function LojasDoUsuario({ lojas }: { lojas: { domain: string; name: string }[] }) {
  if (!lojas?.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {lojas.slice(0, 3).map((loja) => (
        <span key={loja.domain} className="flex items-center gap-1.5 text-xs">
          <a
            href={`https://${loja.domain}`}
            target="_blank"
            rel="noreferrer noopener"
            title={loja.domain}
            className="truncate text-foreground hover:text-primary hover:underline"
          >
            {loja.name}
          </a>
          <a
            href={`https://${loja.domain}/admin`}
            target="_blank"
            rel="noreferrer noopener"
            title="Abrir admin da Shopify"
            className="shrink-0 text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      ))}
      {lojas.length > 3 && (
        <span className="text-xs text-muted-foreground">+{lojas.length - 3}</span>
      )}
    </div>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Faturamento dos clientes vem em outra chamada de proposito: ela pergunta
  // a cada loja de checkout na Shopify e leva alguns segundos. Junto com o
  // overview, seguraria o painel inteiro nesse tempo.
  const [gmv, setGmv] = useState<FaturamentoAdmin | null>(null);
  const [gmvErro, setGmvErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Falha.");
        setData(body);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/admin/revenue?period=30")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Falha.");
        setGmv(body);
      })
      .catch((e) => setGmvErro(e instanceof Error ? e.message : "Falha."));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const s = data?.summary;
  const margem = s?.grossMarginMonthBrl ?? 0;

  // Separado em dois blocos: dinheiro primeiro, base depois. Antes eram sete
  // cards na mesma fileira misturando receita, custo e contagem de usuario —
  // dava para olhar e nao saber se o mes tinha sido bom.
  const cardsDinheiro = [
    { label: "MRR (assinaturas)", value: brl(s?.mrrBrl ?? 0) },
    { label: "Créditos (mês)", value: brl(s?.creditRevenueMonthBrl ?? 0) },
    {
      label: "Receita do mês",
      value: brl((s?.mrrBrl ?? 0) + (s?.creditRevenueMonthBrl ?? 0)),
      highlight: true,
    },
    {
      label: "Custo de IA (mês)",
      value: `-${brl(s?.aiCostThisMonthBrl ?? 0)}`,
      // O Gemini cobra em dolar; convertemos para o painel nao misturar moeda.
      nota: `US$ ${(s?.aiCostThisMonthUsd ?? 0).toFixed(2)} · câmbio ${(s?.usdBrlRate ?? 0).toFixed(2)}`,
    },
    {
      label: "Margem do mês",
      value: `${margem < 0 ? "-" : ""}${brl(Math.abs(margem))}`,
      tone: margem < 0 ? "ruim" : "bom",
    },
  ];

  const cardsBase = [
    { label: "Usuários", value: s?.totalUsers ?? 0 },
    { label: "Pagantes", value: s?.payingUsers ?? 0 },
    { label: "Pro ativos", value: s?.proUsers ?? 0 },
    { label: "Com acesso", value: s?.withAccess ?? 0 },
    { label: "Novos no mês", value: s?.newUsersThisMonth ?? 0 },
    { label: "Lojas", value: s?.totalStores ?? 0 },
  ];

  const compras = data?.recentPurchases ?? [];
  const porMes = data?.revenueByMonth ?? [];
  const maxMes = Math.max(1, ...porMes.map((m) => m.creditoBrl));

  const topUsers = (data?.users || [])
    .filter((u) => u.usageThisMonth.costUsd > 0)
    .slice(0, 10);

  const recentUsers = (data?.users || [])
    .filter((u) => u.createdAt)
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Visão geral</h1>
        <p className="text-sm text-muted-foreground">
          Usuários, receita e custo de IA. Tudo em reais.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dinheiro</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {cardsDinheiro.map((c) => (
            <Card key={c.label} className={c.highlight ? "border-primary/40" : ""}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold ${
                    c.tone === "ruim"
                      ? "text-destructive"
                      : c.tone === "bom"
                        ? "text-emerald-500"
                        : c.highlight
                          ? "text-primary"
                          : "text-foreground"
                  }`}
                >
                  {c.value}
                </p>
                {"nota" in c && c.nota ? (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{c.nota}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Dinheiro do CLIENTE, nao nosso. Fica em bloco separado de proposito:
          misturar GMV de terceiro com MRR na mesma fileira faz olhar o painel e
          nao saber qual parte e receita nossa. */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Faturamento dos clientes · 30 dias
          </p>
          <Link
            href="/admin/faturamento"
            className="text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            ver detalhe →
          </Link>
        </div>

        {gmvErro ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">{gmvErro}</CardContent>
          </Card>
        ) : !gmv ? (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Perguntando a cada loja de checkout na Shopify…
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Card className="border-emerald-500/40">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">Total faturado pelos clientes</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-500">
                  {brl(gmv.totalRevenueBrlCents / 100)}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {gmv.totalOrders} pedidos pagos · {gmv.storeCount} lojas de checkout
                </p>
                {(gmv.deniedCount > 0 || gmv.failedCount > 0) && (
                  <p className="mt-1 text-[10px] text-amber-600">
                    parcial: {gmv.deniedCount + gmv.failedCount} de {gmv.storeCount} lojas não
                    responderam
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="mb-2 text-xs text-muted-foreground">Quem mais fatura</p>
                {gmv.usuarios.filter((u) => u.lojasComDados > 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma loja de checkout entregou números ainda.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {gmv.usuarios
                      .filter((u) => u.lojasComDados > 0)
                      .slice(0, 5)
                      .map((u, i) => (
                        <div key={u.userId} className="flex items-center gap-2 text-sm">
                          <span className="w-4 shrink-0 text-xs text-muted-foreground">
                            {i + 1}º
                          </span>
                          <Link
                            href={`/admin/users/${u.userId}`}
                            className="truncate text-foreground hover:text-primary hover:underline"
                          >
                            {u.email}
                          </Link>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {u.orders} ped.
                          </span>
                          <span className="ml-auto shrink-0 font-medium text-foreground">
                            {brl(u.revenueBrlCents / 100)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base</p>
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          {cardsBase.map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendas de crédito</CardTitle>
            <CardDescription>
              {s?.creditPurchasesTotal ?? 0} compras, {brl(s?.creditRevenueTotalBrl ?? 0)} no total
            </CardDescription>
          </CardHeader>
          <CardContent>
            {compras.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma compra de crédito ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Quem</th>
                    <th className="py-2 pr-3">Créditos</th>
                    <th className="py-2 pr-3">Valor</th>
                    <th className="py-2">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {compras.map((c, i) => (
                    <tr key={`${c.email}-${c.createdAt}-${i}`} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-foreground">{c.email}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{c.credits}</td>
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {brl(c.amountBrl)}
                      </td>
                      <td className="py-2 text-muted-foreground">{fmt(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receita de crédito por mês</CardTitle>
            <CardDescription>Últimos 6 meses</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {porMes.map((m) => (
              <div key={m.mes} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{m.mes}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${Math.max(m.creditoBrl > 0 ? 4 : 0, (m.creditoBrl / maxMes) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-foreground">
                  {brl(m.creditoBrl)}
                  <span className="ml-1 text-muted-foreground">({m.compras})</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top AI consumers */}
        <Card>
          <CardHeader>
            <CardTitle>Top AI consumers (month)</CardTitle>
            <CardDescription>
              <Link href="/admin/users" className="underline">
                View and manage all users
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI usage recorded this month.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Plano</th>
                    <th className="py-2 pr-3">Lojas</th>
                    <th className="py-2 pr-3">Créditos</th>
                    <th className="py-2 pr-3">Custo de IA</th>
                  </tr>
                </thead>
                <tbody>
                  {topUsers.map((u) => (
                    <tr key={u.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-foreground">
                        <Link href={`/admin/users/${u.id}`} className="hover:underline">
                          {u.email}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{u.plan}</td>
                      <td className="py-2 pr-3">
                        <LojasDoUsuario lojas={u.stores} />
                      </td>
                      <td className="py-2 pr-3 text-foreground">{u.usageThisMonth.credits}</td>
                      <td className="py-2 pr-3 text-foreground">
                        {brl(u.usageThisMonth.costBrl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Recent signups */}
        <Card>
          <CardHeader>
            <CardTitle>Recent signups</CardTitle>
            <CardDescription>Latest accounts created</CardDescription>
          </CardHeader>
          <CardContent>
            {recentUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Plano</th>
                    <th className="py-2 pr-3">Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map((u) => (
                    <tr key={u.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-foreground">
                        <Link href={`/admin/users/${u.id}`} className="hover:underline">
                          {u.email}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{u.plan}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{fmt(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
