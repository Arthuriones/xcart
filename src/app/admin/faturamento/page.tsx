"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FaturamentoAdmin } from "@/lib/sales/admin-types";

const PERIODOS = [
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "60", label: "60 dias" },
];

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const nativo = (centavos: number, moeda: string) =>
  (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: moeda || "BRL",
    maximumFractionDigits: 0,
  });

const num = (n: number) => n.toLocaleString("pt-BR");

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function AdminFaturamentoPage() {
  const [dados, setDados] = useState<FaturamentoAdmin | null>(null);
  const [periodo, setPeriodo] = useState("30");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  const buscar = useCallback(async (p: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/admin/revenue?period=${p}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao carregar.");
      setDados(j);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    buscar(periodo);
  }, [periodo, buscar]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Faturamento no roteamento</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos pagos nas lojas de checkout que recebem comprador por rota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* O Select entrega `string | null` ao limpar a selecao; manter o
              periodo atual evita pedir a API com period=null. */}
          <Select value={periodo} onValueChange={(v) => setPeriodo(v ?? periodo)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => buscar(periodo)}
            disabled={carregando}
            aria-label="Atualizar"
          >
            <RefreshCw className={carregando ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {erro && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-sm text-destructive">{erro}</CardContent>
        </Card>
      )}

      {carregando && !dados && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Perguntando a cada loja de checkout na Shopify…
        </div>
      )}

      {dados && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Faturamento no período</CardDescription>
                <CardTitle className="text-2xl">{brl(dados.totalRevenueBrlCents)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                convertido para real, taxa de relatório
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Pedidos pagos</CardDescription>
                <CardTitle className="text-2xl">{num(dados.totalOrders)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                sem teste e sem cancelado
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Lojas de checkout</CardDescription>
                <CardTitle className="text-2xl">{num(dados.storeCount)}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                apurado às {hora(dados.computedAt)}
              </CardContent>
            </Card>
          </div>

          {(dados.deniedCount > 0 || dados.failedCount > 0 || dados.moedasSemTaxa.length > 0) && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="space-y-1 py-4 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />O total está incompleto
                </div>
                {dados.deniedCount > 0 && (
                  <p className="text-muted-foreground">
                    {dados.deniedCount} loja(s) sem <code>read_orders</code> — conectadas antes do
                    app pedir o escopo. Precisam ser reautorizadas pelo dono.
                  </p>
                )}
                {dados.failedCount > 0 && (
                  <p className="text-muted-foreground">
                    {dados.failedCount} loja(s) não responderam (app desinstalado, plano vencido ou
                    loja em revisão).
                  </p>
                )}
                {dados.moedasSemTaxa.length > 0 && (
                  <p className="text-muted-foreground">
                    Sem taxa de conversão para {dados.moedasSemTaxa.join(", ")} — esse valor ficou
                    fora do total. Defina em <code>FX_BRL_RATES</code>.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quem mais fatura</CardTitle>
              <CardDescription>
                Últimos {dados.maxDays >= Number(dados.period) ? dados.period : dados.maxDays} dias.
                A Shopify só libera 60 dias com <code>read_orders</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {dados.usuarios.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground">
                  Nenhuma rota ligada com loja de checkout respondendo.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-6 py-2 text-left font-medium">Usuário</th>
                      <th className="px-3 py-2 text-right font-medium">Pedidos</th>
                      <th className="px-3 py-2 text-right font-medium">Faturamento</th>
                      <th className="px-6 py-2 text-right font-medium">Lojas c/ dados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.usuarios.map((u, i) => {
                      const expandido = aberto === u.userId;
                      // Nenhuma loja respondeu: nao sabemos o faturamento, e
                      // mostrar R$ 0,00 aqui seria afirmar que nao vendeu.
                      const cego = u.lojasComDados === 0;
                      return (
                        <>
                          <tr
                            key={u.userId}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                            onClick={() => setAberto(expandido ? null : u.userId)}
                          >
                            <td className="px-6 py-3">
                              <div className="flex items-center gap-2">
                                {expandido ? (
                                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="w-5 text-xs text-muted-foreground">
                                  {cego ? "—" : `${i + 1}º`}
                                </span>
                                <Link
                                  href={`/admin/users/${u.userId}`}
                                  className="truncate hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {u.email}
                                </Link>
                                {u.plan === "pro" && (
                                  <Badge className="rounded-md bg-primary/15 text-primary">
                                    pro
                                  </Badge>
                                )}
                                {u.semTaxa.length > 0 && (
                                  <Badge variant="outline" className="rounded-md text-amber-600">
                                    {u.semTaxa.join(", ")} fora
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {cego ? "—" : num(u.orders)}
                            </td>
                            <td className="px-3 py-3 text-right font-medium tabular-nums">
                              {cego ? (
                                <span className="text-xs font-normal text-muted-foreground">
                                  sem dados
                                </span>
                              ) : (
                                brl(u.revenueBrlCents)
                              )}
                            </td>
                            <td className="px-6 py-3 text-right text-muted-foreground">
                              {u.lojasComDados}/{u.lojas.length}
                            </td>
                          </tr>

                          {expandido &&
                            u.lojas.map((l) => (
                              <tr key={l.storeId} className="border-b bg-muted/20 last:border-0">
                                <td className="py-2 pl-16 pr-6">
                                  <div className="truncate">{l.name}</div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {l.domain}
                                    {l.vitrines.length > 0 && ` · recebe de ${l.vitrines.join(", ")}`}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                  {l.problem ? "—" : num(l.orders)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {l.problem === "denied" ? (
                                    <span className="text-xs text-amber-600">sem read_orders</span>
                                  ) : l.problem === "failed" ? (
                                    <span className="text-xs text-muted-foreground">
                                      não respondeu
                                    </span>
                                  ) : (
                                    <>
                                      <div>{nativo(l.revenueCents, l.currency)}</div>
                                      {l.revenueBrlCents !== null && l.currency !== "BRL" && (
                                        <div className="text-xs text-muted-foreground">
                                          {brl(l.revenueBrlCents)}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </td>
                                <td className="px-6 py-2" />
                              </tr>
                            ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
