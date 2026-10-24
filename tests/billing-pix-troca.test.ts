import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANOS, PLANOS_ANTERIORES, PRO_PRICE_CENTS } from "@/lib/billing/plans";

// apply_paid_purchase converte os dias que restam pelo PRECO quando o Pix e de
// outro plano. Sem Pix pago do plano atual, ela usa uma tabela de precos
// escrita no SQL -- espelho de plans.ts. Este teste le do disco a migration
// que define a funcao por ultimo (078, a dos planos de 24/10) e trava os dois
// juntos: preco novo em plans.ts sem migration nova faria a troca converter
// pelo valor velho. As permissoes das rotas continuam na 064.

const ler = (nome: string) => readFileSync(join(process.cwd(), "supabase/migrations", nome), "utf8");
const sql = ler("064_planos.sql");
const sql078 = ler("078_planos_novos.sql");
const funcao = sql078.slice(
  sql078.indexOf("create or replace function public.apply_paid_purchase"),
  sql078.indexOf("-- create or replace mantem os grants")
);
const TODOS = [...PLANOS, ...PLANOS_ANTERIORES];

describe("apply_paid_purchase (078)", () => {
  it("a tabela de preços do SQL é a de plans.ts, com os planos a venda e os anteriores", () => {
    expect(funcao.length).toBeGreaterThan(100);
    for (const plano of TODOS) {
      expect(funcao).toMatch(new RegExp(`when '${plano.id}'\\s+then ${plano.precoCentavos}\\b`));
    }
    // O Pro antigo, sem tier.
    expect(funcao).toMatch(new RegExp(`else ${PRO_PRICE_CENTS}\\b`));
  });

  it("os CHECKs aceitam os ids novos e os anteriores", () => {
    for (const tabela of ["profiles", "credit_purchases"]) {
      const check = sql078.match(new RegExp(`add constraint ${tabela}_plano_check\\s+check \\(([^;]*)\\);`));
      expect(check, tabela).not.toBeNull();
      for (const plano of TODOS) expect(check![1]).toContain(`'${plano.id}'`);
    }
  });

  it("segue só do service_role (SECURITY DEFINER, os dois caminhos revogados)", () => {
    expect(funcao).toMatch(/security definer/);
    expect(sql078).toMatch(
      /revoke all on function public\.apply_paid_purchase\(text\) from public, anon, authenticated;/
    );
    expect(sql078).toMatch(/grant execute on function public\.apply_paid_purchase\(text\) to service_role;/);
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
