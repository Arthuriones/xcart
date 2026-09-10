"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Package,
  Route as RouteIcon,
  Settings as SettingsIcon,
  Store as StoreIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Detail {
  profile: {
    id: string;
    email: string;
    plan: string;
    subscription_status: string | null;
    ai_credits: number;
    current_period_end: string | null;
    access_granted: boolean;
    is_admin: boolean;
    hasAccess: boolean;
    created_at: string;
  };
  stores: {
    id: string;
    shop_domain: string;
    name: string;
    niche: string | null;
    target_language: string | null;
    created_at: string;
    productCount: number;
  }[];
  routes: {
    id: string;
    name: string;
    public_token: string;
    enabled: boolean;
    sourceName: string;
    targetName: string;
  }[];
  totals: { stores: number; products: number; routes: number };
  usage: {
    action: string;
    cost_usd: number;
    credits_used: number;
    created_at: string;
  }[];
  purchases: {
    credits: number;
    amount_cents: number;
    currency: string;
    created_at: string;
  }[];
}

const ACTION_LABEL: Record<string, string> = {
  neutralize_image: "Imagem",
  neutralize_text: "Texto",
  translate: "Tradução",
  clone: "Clonagem",
  optimize: "Otimização",
  other: "Outro",
};

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState("free");
  const [credits, setCredits] = useState("0");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Falha.");
      setData(body);
      setPlan(body.profile.plan);
      setCredits(String(body.profile.ai_credits));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // A funcao abaixo e async e TODO setState dela acontece depois do primeiro
    // await: nao ha atualizacao sincrona no corpo deste efeito, entao nao ha o
    // render em cascata que a regra combate. O compilador nao consegue provar
    // isso ao atravessar a funcao, e assume o pior.
    //
    // O conserto que a regra realmente quer aqui e nao buscar dados em efeito:
    // esta pagina e client component e busca da propria API. Mover para o
    // servidor e mudanca de arquitetura por pagina, nao ajuste de lint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patch(payload: object, label: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Falha.");
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive">
        {error || "Não encontrado."}
      </div>
    );
  }

  const p = data.profile;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Usuários
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{p.email}</h1>
        {p.is_admin && <Badge variant="secondary">admin</Badge>}
        {p.hasAccess ? (
          <Badge className="bg-primary/15 text-primary">com acesso</Badge>
        ) : (
          <Badge variant="outline">bloqueado</Badge>
        )}
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Plano", value: p.plan },
          { label: "Créditos", value: p.ai_credits },
          { label: "Lojas", value: data.totals.stores },
          { label: "Produtos", value: data.totals.products },
          { label: "Rotas", value: data.totals.routes },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-0.5 text-xl font-semibold text-foreground">
                {c.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gestão */}
      <Card>
        <CardHeader>
          <CardTitle>Gerenciar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Acesso</Label>
            <Button
              variant={p.access_granted ? "outline" : "default"}
              className="w-full"
              disabled={saving || p.is_admin}
              onClick={() =>
                patch(
                  { accessGranted: !p.access_granted },
                  p.access_granted ? "Acesso revogado." : "Acesso liberado."
                )
              }
            >
              {p.access_granted ? "Revogar acesso" : "Liberar acesso"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Plano</Label>
            <Select value={plan} onValueChange={(v) => setPlan(v || "free")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="pro">Pro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Créditos</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => patch({ addCredits: 100 }, "+100 créditos")}
                disabled={saving}
              >
                +100
              </Button>
            </div>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={saving}
              onClick={() =>
                patch({ plan, aiCredits: Number(credits) || 0 }, "Salvo")
              }
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lojas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StoreIcon className="h-4 w-4" /> Lojas ({data.stores.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma loja conectada.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.stores.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-border/60 bg-background/45 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {s.name || s.shop_domain}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.shop_domain}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                      <Package className="h-3 w-3" />
                      {s.productCount}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    {s.niche && <span>{s.niche}</span>}
                    {s.target_language && <span>· {s.target_language}</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`https://${s.shop_domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir loja
                      </Button>
                    </a>
                    <a
                      href={`https://${s.shop_domain}/admin`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="sm">
                        <SettingsIcon className="h-3.5 w-3.5" />
                        Shopify admin
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rotas de checkout */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RouteIcon className="h-4 w-4" /> Rotas de checkout ({data.routes.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.routes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma rota.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.routes.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-2"
                >
                  <span className="text-foreground">
                    {r.sourceName} → {r.targetName}
                  </span>
                  <Badge
                    variant={r.enabled ? "secondary" : "outline"}
                    className="rounded-md"
                  >
                    {r.enabled ? "ativa" : "pausada"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Compras */}
        <Card>
          <CardHeader>
            <CardTitle>Recargas ({data.purchases.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {data.purchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma recarga.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.purchases.map((pur, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-foreground">+{pur.credits} créditos</span>
                    <span className="text-xs text-muted-foreground">
                      R${(pur.amount_cents / 100).toFixed(2)} ·{" "}
                      {new Date(pur.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico de uso */}
      <Card>
        <CardHeader>
          <CardTitle>Uso de IA (últimas 50 ações)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.usage.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem uso registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">Ação</th>
                    <th className="py-2 pr-3">Créditos</th>
                    <th className="py-2 pr-3">Custo</th>
                    <th className="py-2 pr-3">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usage.map((row, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 text-foreground">
                        {ACTION_LABEL[row.action] || row.action}
                      </td>
                      <td className="py-1.5 pr-3 text-foreground">
                        {row.credits_used}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        US${Number(row.cost_usd).toFixed(3)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
