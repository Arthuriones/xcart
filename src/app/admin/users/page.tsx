"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Check, Loader2, Lock, Settings2, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AdminUser {
  id: string;
  email: string;
  plan: string;
  subscriptionStatus: string | null;
  aiCredits: number;
  accessGranted: boolean;
  isAdmin: boolean;
  hasAccess: boolean;
  createdAt: string | null;
  stores: { domain: string; name: string }[];
  usageThisMonth: { costUsd: number; costBrl?: number; credits: number };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const brlAdmin = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [manage, setManage] = useState<AdminUser | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/overview");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Falha.");
      setUsers(body.users || []);
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
  }, []);

  async function patch(id: string, payload: object) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Falha.");
  }

  async function toggleAccess(u: AdminUser) {
    setTogglingId(u.id);
    try {
      await patch(u.id, { accessGranted: !u.accessGranted });
      toast.success(!u.accessGranted ? "Acesso liberado." : "Acesso revogado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setTogglingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? users.filter((u) => u.email.toLowerCase().includes(q)) : users;
  }, [users, query]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Libere acesso, defina plano e créditos. Free sem liberação = sem acesso.
          </p>
        </div>
        <Input
          placeholder="Buscar por email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="py-2.5 pl-4 pr-3">Email</th>
                  <th className="py-2.5 pr-3">Acesso</th>
                  <th className="py-2.5 pr-3">Plano</th>
                  <th className="py-2.5 pr-3">Créditos</th>
                  <th className="py-2.5 pr-3">Lojas</th>
                  <th className="py-2.5 pr-3">AI cost (mo)</th>
                  <th className="py-2.5 pr-3">Signed up</th>
                  <th className="py-2.5 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border/40 align-top">
                    <td className="py-2.5 pl-4 pr-3 text-foreground">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="hover:underline"
                      >
                        {u.email}
                      </Link>
                      {u.isAdmin && (
                        <Badge variant="secondary" className="ml-2 rounded-md">
                          admin
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {u.hasAccess ? (
                        <Badge className="rounded-md bg-primary/15 text-primary">
                          <Check className="mr-1 h-3 w-3" /> com acesso
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-md text-muted-foreground">
                          <Lock className="mr-1 h-3 w-3" /> bloqueado
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        variant={u.plan === "pro" ? "default" : "secondary"}
                        className="rounded-md"
                      >
                        {u.plan}
                        {u.subscriptionStatus ? ` · ${u.subscriptionStatus}` : ""}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-foreground">{u.aiCredits}</td>
                    <td className="py-2.5 pr-3">
                      {u.stores.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {/* Eram spans: dava para ver a loja, nao para abrir.
                              O nome leva a vitrine; o icone, ao admin dela. */}
                          {u.stores.slice(0, 3).map((store) => (
                            <span
                              key={store.domain}
                              className="flex items-center gap-1.5 text-xs"
                            >
                              <StoreIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <a
                                href={`https://${store.domain}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={store.domain}
                                className="truncate text-foreground hover:text-primary hover:underline"
                              >
                                {store.name}
                              </a>
                              <a
                                href={`https://${store.domain}/admin`}
                                target="_blank"
                                rel="noreferrer noopener"
                                title="Abrir admin da Shopify"
                                className="shrink-0 text-muted-foreground hover:text-primary"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                          ))}
                          {u.stores.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{u.stores.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-foreground">
                      {brlAdmin(u.usageThisMonth.costBrl ?? 0)}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground text-xs">
                      {fmtDate(u.createdAt)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={u.accessGranted ? "outline" : "default"}
                          size="sm"
                          onClick={() => toggleAccess(u)}
                          disabled={togglingId === u.id || u.isAdmin}
                          title={u.isAdmin ? "Admin sempre tem acesso" : ""}
                        >
                          {togglingId === u.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : u.accessGranted ? (
                            "Revogar"
                          ) : (
                            "Liberar"
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setManage(u)}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ManageUserDialog
        user={manage}
        onClose={() => setManage(null)}
        onSaved={() => {
          setManage(null);
          load();
        }}
      />
    </div>
  );
}

function ManageUserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plan, setPlan] = useState("free");
  const [credits, setCredits] = useState("0");
  const [saving, setSaving] = useState(false);

  // Popula o formulario quando muda o usuario em edicao, no RENDER.
  //
  // Como efeito, isto rodava depois do commit: o painel pintava uma vez com o
  // plano do usuario ANTERIOR e so entao corrigia. Comparando o id com o do
  // render passado, o valor certo ja sai na primeira pintura -- e a edicao em
  // andamento nao e sobrescrita quando o pai re-renderiza por outro motivo.
  const [idAnterior, setIdAnterior] = useState<string | null>(user?.id ?? null);
  if ((user?.id ?? null) !== idAnterior) {
    setIdAnterior(user?.id ?? null);
    if (user) {
      setPlan(user.plan);
      setCredits(String(user.aiCredits));
    }
  }

  async function patch(payload: object, label: string) {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Falha.");
      toast.success(label);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerenciar usuário</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
            <Label className="text-xs">Créditos (definir saldo)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                className="w-32"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ addCredits: 20 }, "+20 créditos")}
                disabled={saving}
              >
                +20
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ addCredits: 100 }, "+100 créditos")}
                disabled={saving}
              >
                +100
              </Button>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={saving}
            onClick={() =>
              patch({ plan, aiCredits: Number(credits) || 0 }, "Usuário atualizado")
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
