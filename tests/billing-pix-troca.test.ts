import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANOS, PRO_PRICE_CENTS } from "@/lib/billing/plans";

// apply_paid_purchase (migration 064) converte os dias que restam pelo PRECO
// quando o Pix e de outro plano. Sem Pix pago do plano atual, ela usa uma
// tabela de precos escrita no SQL -- espelho de plans.ts. Este teste le a
// migration do disco e trava os dois juntos: preco novo em plans.ts sem
// migration nova faria a troca converter pelo valor velho.

const sql = readFileSync(join(process.cwd(), "supabase/migrations/064_planos.sql"), "utf8");
const funcao = sql.slice(
  sql.indexOf("create or replace function public.apply_paid_purchase"),
  sql.indexOf("-- create or replace mantem os grants")
);

describe("apply_paid_purchase (064)", () => {
  it("a tabela de preços do SQL é a de plans.ts", () => {
    for (const plano of PLANOS) {
      expect(funcao).toMatch(new RegExp(`when '${plano.id}'\\s+then ${plano.precoCentavos}\\b`));
    }
    // O Pro antigo, sem tier.
    expect(funcao).toMatch(new RegExp(`else ${PRO_PRICE_CENTS}\\b`));
  });

  it("converte o que resta na troca de plano e soma no mesmo plano", () => {
    expect(funcao).toMatch(/v_plano is distinct from v_plano_atual/);
    expect(funcao).toMatch(/v_resta := v_resta \* \(v_preco_atual::float8/);
    expect(funcao).toMatch(/current_period_end = v_agora \+ v_resta \+ interval '30 days'/);
  });

  it("trava o perfil enquanto calcula (dois Pix ao mesmo tempo)", () => {
    expect(funcao).toMatch(/from public\.profiles\s+where id = v_user_id\s+for update/);
  });

  it("solta o cartão que já não cobra, para os avisos dele não passarem por cima do Pix", () => {
    expect(funcao).toMatch(
      /pagou_subscription_id = case\s+when subscription_status in \('active', 'trialing', 'past_due'\)/
    );
  });

  it("a sessão não cria rota nem troca loja de rota pela API do Supabase", () => {
    expect(sql).toMatch(/revoke insert, update on public\.routed_checkout_configs from anon, authenticated;/);
    expect(sql).toMatch(/revoke insert, update on public\.routed_checkout_targets from anon, authenticated;/);
    const configs = sql.match(/grant update \(([^)]*)\)\s+on public\.routed_checkout_configs/);
    const destinos = sql.match(/grant update \(([^)]*)\)\s+on public\.routed_checkout_targets/);
    expect(configs?.[1]).not.toMatch(/store_id|user_id/);
    expect(destinos?.[1]).not.toMatch(/store_id|route_id/);
  });
});
