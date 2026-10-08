import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { USD_BRL_REPORTING, precoMensalCentavos } from "@/lib/billing/plans";
import { lerComPlano } from "@/lib/billing/limites";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const now = new Date();
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 29);
  since30.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(now);
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const since6m = new Date(now);
  since6m.setUTCMonth(since6m.getUTCMonth() - 5);
  since6m.setUTCDate(1);
  since6m.setUTCHours(0, 0, 0, 0);

  const [{ data: usage30 }, { data: purchases }, perfisLidos, { data: newProfiles }] =
    await Promise.all([
      admin
        .from("ai_usage_log")
        .select("created_at, cost_usd, credits_used, action")
        .gte("created_at", since30.toISOString()),
      admin
        .from("credit_purchases")
        .select("amount_cents, created_at")
        .gte("created_at", since6m.toISOString()),
      // Sem a coluna `plano` (064 pendente), le sem ela: o MRR cai nos R$ 89.
      lerComPlano((plano) => admin.from("profiles").select(`plan${plano}`)),
      admin.from("profiles").select("created_at").gte("created_at", since6m.toISOString()),
    ]);

  const profiles = perfisLidos.data as { plan: string | null; plano?: string | null }[] | null;

  // Por acao (30 dias)
  const byActionMap = new Map<string, { costUsd: number; count: number; credits: number }>();
  // Por dia (30 dias)
  const byDayMap = new Map<string, number>();
  let costThisMonthUsd = 0;
  for (const row of usage30 || []) {
    const a = byActionMap.get(row.action) || { costUsd: 0, count: 0, credits: 0 };
    a.costUsd += Number(row.cost_usd || 0);
    a.count += 1;
    a.credits += Number(row.credits_used || 0);
    byActionMap.set(row.action, a);

    const day = String(row.created_at).slice(0, 10);
    byDayMap.set(day, (byDayMap.get(day) || 0) + Number(row.cost_usd || 0));

    if (new Date(row.created_at) >= startOfMonth) {
      costThisMonthUsd += Number(row.cost_usd || 0);
    }
  }

  // Serie diaria continua (preenche dias sem uso com 0)
  const byDay: { date: string; costUsd: number }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const d = new Date(since30);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.push({ date: key, costUsd: Number((byDayMap.get(key) || 0).toFixed(4)) });
  }

  const byAction = [...byActionMap.entries()]
    .map(([action, v]) => ({
      action,
      costUsd: Number(v.costUsd.toFixed(4)),
      count: v.count,
      credits: v.credits,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // Receita em BRL (Pagou). O custo de IA fica em USD: o Gemini cobra em
  // dolar. Sao moedas diferentes e nao devem ser somadas.
  // Cada Pro pelo preco do proprio plano; o Pro antigo (sem tier), R$ 89.
  const mrrBrl = (profiles || []).reduce((t, p) => t + precoMensalCentavos(p), 0) / 100;

  // Credit sales + new signups grouped by month (last 6 months)
  const monthlyMap = new Map<string, { revenueBrl: number; newUsers: number }>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    d.setUTCDate(1);
    monthlyMap.set(d.toISOString().slice(0, 7), { revenueBrl: 0, newUsers: 0 });
  }
  for (const p of purchases || []) {
    const month = String(p.created_at).slice(0, 7);
    const entry = monthlyMap.get(month);
    if (entry) entry.revenueBrl += Number(p.amount_cents || 0) / 100;
  }
  for (const p of newProfiles || []) {
    const month = String(p.created_at).slice(0, 7);
    const entry = monthlyMap.get(month);
    if (entry) entry.newUsers += 1;
  }
  // Add MRR to current month
  const currentMonth = now.toISOString().slice(0, 7);
  const currentEntry = monthlyMap.get(currentMonth);
  if (currentEntry) currentEntry.revenueBrl += mrrBrl;

  const byMonth = [...monthlyMap.entries()].map(([month, v]) => ({
    month,
    revenueBrl: Number(v.revenueBrl.toFixed(2)),
    newUsers: v.newUsers,
  }));

  const creditSalesThisMonthBrl =
    (purchases || [])
      .filter((p) => String(p.created_at).slice(0, 7) === currentMonth)
      .reduce((s, p) => s + Number(p.amount_cents || 0), 0) / 100;

  const revenueThisMonthBrl = mrrBrl + creditSalesThisMonthBrl;
  // Receita entra em BRL (Pagou), custo sai em USD (Gemini). Converter antes
  // de subtrair — senao a margem soma moedas diferentes.
  const costThisMonthBrl = costThisMonthUsd * USD_BRL_REPORTING;
  const marginBrl = revenueThisMonthBrl - costThisMonthBrl;

  return NextResponse.json({
    byAction,
    byDay,
    byMonth,
    revenue: {
      mrrBrl,
      creditSalesThisMonthBrl: Number(creditSalesThisMonthBrl.toFixed(2)),
      revenueThisMonthBrl: Number(revenueThisMonthBrl.toFixed(2)),
    },
    cost: {
      thisMonthUsd: Number(costThisMonthUsd.toFixed(2)),
      thisMonthBrl: Number(costThisMonthBrl.toFixed(2)),
    },
    marginBrl: Number(marginBrl.toFixed(2)),
    usdBrlRate: USD_BRL_REPORTING,
  });
}
