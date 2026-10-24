-- ============================================================================
-- 078 -- Planos novos: Roteamento, Completo e Ilimitado (decisao de 24/10/2026).
--
-- ORDEM: aplicar ANTES do deploy do codigo que vende os planos novos.
--   - Sem a 078, o codigo novo grava profiles.plano = 'roteamento' (ou
--     'completo', 'ilimitado_v2') e o CHECK da 064 recusa (23514). O app nao
--     deixa quem pagou sem o Pro (grava o resto e cai nos limites do Pro
--     antigo -- bancoRecusouPlano em src/lib/billing/limites.ts), mas o
--     limite fica o errado ate a migration e o proximo aviso da Pagou.
--   - O codigo velho segue funcionando com a 078: os ids antigos continuam
--     aceitos e os precos antigos continuam na troca por Pix.
--   Idempotente: rodar de novo so refaz os mesmos CHECKs e a mesma funcao.
--
-- O que muda:
--   1. profiles.plano e credit_purchases.plano aceitam os ids novos E os de
--      08/10 (loja1, lojas3, ilimitado), que sairam da venda mas seguem valendo
--      para quem ja paga por eles (mesmo preco, mesmo limite).
--   2. apply_paid_purchase (a da 064) conhece os precos novos na tabela de
--      troca de plano por Pix. So a tabela do `case` muda; o resto e a 064.
--
-- Os numeros (preco e limites) moram em src/lib/billing/plans.ts; o banco so
-- guarda QUAL plano. tests/billing-pix-troca.test.ts trava a tabela desta
-- funcao contra plans.ts.
--
--   id            nome        preco      venda
--   roteamento    Roteamento  R$ 197,00  sim
--   completo      Completo    R$ 497,00  sim
--   ilimitado_v2  Ilimitado   R$ 997,00  sim
--   loja1         1 Loja      R$  79,90  nao (anterior)
--   lojas3        3 Lojas     R$ 119,90  nao (anterior)
--   ilimitado     Ilimitado   R$ 169,90  nao (anterior)
--   null          Pro antigo  R$  89,00  nao (sem tier)
-- ============================================================================

-- A 064 criou as colunas; aqui so por seguranca, se a 064 nao rodou.
alter table public.profiles add column if not exists plano text;
alter table public.credit_purchases add column if not exists plano text;

-- ----------------------------------------------------------------------------
-- 1. Os CHECKs. Os da 064 nasceram na coluna (nome gerado pelo Postgres,
-- profiles_plano_check / credit_purchases_plano_check); sai todo CHECK que so
-- olha a coluna plano, seja qual for o nome, e entra o novo com nome fixo.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tabela
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = c.conkey[1]
     where c.contype = 'c'
       and c.conrelid in ('public.profiles'::regclass, 'public.credit_purchases'::regclass)
       and array_length(c.conkey, 1) = 1
       and a.attname = 'plano'
  loop
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
  end loop;
end
$$;

alter table public.profiles
  add constraint profiles_plano_check
  check (plano is null or plano in (
    'roteamento', 'completo', 'ilimitado_v2',   -- a venda (24/10/2026)
    'loja1', 'lojas3', 'ilimitado'              -- anteriores (08/10/2026)
  ));

alter table public.credit_purchases
  add constraint credit_purchases_plano_check
  check (plano is null or plano in (
    'roteamento', 'completo', 'ilimitado_v2',
    'loja1', 'lojas3', 'ilimitado'
  ));

comment on column public.profiles.plano is
  'Tier pago: roteamento, completo ou ilimitado_v2 (a venda); loja1, lojas3 ou ilimitado (anteriores, mesmo preco e limite). null = Pro antigo (R$ 89) ou sem plano: limites do loja1.';

comment on column public.credit_purchases.plano is
  'Tier do Pix de 30 dias (kind = pro_month). null nas recargas de credito.';

-- ----------------------------------------------------------------------------
-- 2. apply_paid_purchase: a da 064, com os precos novos na tabela da troca.
--
-- Na TROCA de plano por Pix, os dias que ainda restam valem pelo preco:
-- restante x preco do plano atual / preco do novo. O preco do plano atual e o
-- do ultimo Pix pago dele; sem Pix dele (o tier veio do cartao), a tabela
-- abaixo -- espelho de src/lib/billing/plans.ts. Sem os ids novos ali, quem
-- assinou o Completo no cartao e passou para o Pix teria os dias convertidos
-- pelo preco do Pro antigo (R$ 89).
--
-- O perfil e lido com FOR UPDATE: dois Pix pagos ao mesmo tempo nao leem o
-- mesmo fim de periodo. O cartao que ja nao cobra sai do perfil (ver 064).
-- ----------------------------------------------------------------------------
create or replace function public.apply_paid_purchase(p_transaction_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id     uuid;
    v_credits     integer;
    v_kind        text;
    v_plano       text;
    v_valor       integer;
    v_plan        text;
    v_plano_atual text;
    v_fim_atual   timestamptz;
    v_preco_atual integer;
    v_agora       timestamptz := now();
    v_resta       interval;
begin
    select user_id, credits, kind, plano, amount_cents
      into v_user_id, v_credits, v_kind, v_plano, v_valor
      from public.credit_purchases
     where pagou_transaction_id = p_transaction_id
       and status <> 'paid'
       for update;

    if v_user_id is null then
        return false;   -- inexistente ou ja aplicada
    end if;

    update public.credit_purchases
       set status = 'paid',
           credited_at = v_agora
     where pagou_transaction_id = p_transaction_id;

    if v_kind = 'pro_month' then
        select plan, plano, current_period_end
          into v_plan, v_plano_atual, v_fim_atual
          from public.profiles
         where id = v_user_id
           for update;

        -- O que resta do periodo pago (so conta se o Pro esta valendo).
        v_resta := case
            when v_plan = 'pro' and v_fim_atual > v_agora then v_fim_atual - v_agora
            else interval '0'
        end;

        if v_plano is not null
           and v_plano is distinct from v_plano_atual
           and v_resta > interval '0' then
            select cp.amount_cents
              into v_preco_atual
              from public.credit_purchases cp
             where cp.user_id = v_user_id
               and cp.kind = 'pro_month'
               and cp.status = 'paid'
               and cp.pagou_transaction_id <> p_transaction_id
               and cp.plano is not distinct from v_plano_atual
             order by cp.credited_at desc nulls last
             limit 1;

            v_preco_atual := coalesce(v_preco_atual, case v_plano_atual
                when 'roteamento'   then 19700
                when 'completo'     then 49700
                when 'ilimitado_v2' then 99700
                when 'loja1'        then 7990
                when 'lojas3'       then 11990
                when 'ilimitado'    then 16990
                else 8900                      -- Pro antigo, sem tier
            end);

            v_resta := v_resta * (v_preco_atual::float8 / greatest(coalesce(v_valor, 0), 1)::float8);
        end if;

        update public.profiles
           set plan = 'pro',
               plano = coalesce(v_plano, plano),
               pagou_subscription_id = case
                   when subscription_status in ('active', 'trialing', 'past_due')
                   then pagou_subscription_id
                   else null
               end,
               subscription_status = 'active',
               payment_provider = 'pagou',
               current_period_end = v_agora + v_resta + interval '30 days',
               cancel_at_period_end = false,
               ai_credits = ai_credits + v_credits,
               credits_reset_at = v_agora,
               updated_at = v_agora
         where id = v_user_id;
    else
        update public.profiles
           set ai_credits = ai_credits + v_credits,
               updated_at = v_agora
         where id = v_user_id;
    end if;

    return true;
end;
$$;

-- create or replace mantem os grants, mas a regra da 027 e conferir sempre:
-- SECURITY DEFINER so para o service_role (DOIS caminhos: o grant a PUBLIC e
-- o explicito do default-privileges do Supabase).
revoke all on function public.apply_paid_purchase(text) from public, anon, authenticated;
grant execute on function public.apply_paid_purchase(text) to service_role;

-- Conferir depois de aplicar:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('profiles_plano_check', 'credit_purchases_plano_check');      -- 2 linhas, 6 ids cada
--   select count(*) from pg_constraint c join pg_attribute a
--       on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
--    where c.contype = 'c' and a.attname = 'plano'
--      and c.conrelid in ('public.profiles'::regclass, 'public.credit_purchases'::regclass); -- 2
--   select has_function_privilege('anon', 'public.apply_paid_purchase(text)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.apply_paid_purchase(text)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.apply_paid_purchase(text)', 'execute');  -- true
