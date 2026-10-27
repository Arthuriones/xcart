-- ============================================================================
-- 081 -- Cobranca pela AbacatePay (docs/migracao-abacatepay/estudo.md).
--
-- ORDEM: aplicar ANTES do deploy do codigo que le as colunas novas. A porta
-- de acesso (access.ts), os limites e o menu passam a ler
-- abacatepay_subscription_id e subscription_status: sem a coluna, a leitura
-- do perfil da 42703 e a conta perde o acesso. A cobranca so passa a ser da
-- AbacatePay com NEXT_PUBLIC_BILLING_PROVIDER=abacatepay; ate la tudo segue
-- na Pagou e estas colunas ficam vazias.
--
-- So acrescenta: nenhuma coluna ou funcao que existe muda. Idempotente.
--
--   1. profiles: os ids da AbacatePay e o metodo da assinatura (card | pix,
--      para a tela dizer "no cartao" ou "no Pix").
--   2. credit_purchases: o id do Pix da AbacatePay (pix_char_...), unico --
--      e a trava que impede aplicar o mesmo Pix duas vezes.
--   3. apply_paid_charge: a apply_paid_purchase da 078 para o Pix da
--      AbacatePay. Mesma conta (troca de plano pelo valor), mesma trava, e o
--      perfil sai com payment_provider = 'abacatepay'.
--
-- A escrita e so do service role: a 030 tirou o UPDATE de profiles e a 031 o
-- de credit_purchases da sessao, e coluna nova nao ganha grant sozinha.
-- ============================================================================

-- 1. profiles -----------------------------------------------------------------
alter table public.profiles
    add column if not exists abacatepay_customer_id text,
    add column if not exists abacatepay_subscription_id text,
    add column if not exists subscription_method text
        check (subscription_method is null or subscription_method in ('card', 'pix'));

create index if not exists profiles_abacatepay_customer_idx
    on public.profiles (abacatepay_customer_id);
create index if not exists profiles_abacatepay_subscription_idx
    on public.profiles (abacatepay_subscription_id);

comment on column public.profiles.payment_provider is
    'pagou | abacatepay = quem cobra (o atual em NEXT_PUBLIC_BILLING_PROVIDER). stripe = assinatura legada, somente leitura.';
comment on column public.profiles.subscription_method is
    'Metodo da assinatura recorrente da AbacatePay: card ou pix (Pix Automatico).';

-- 2. credit_purchases ----------------------------------------------------------
alter table public.credit_purchases
    add column if not exists abacatepay_charge_id text;

create unique index if not exists credit_purchases_abacatepay_charge_uidx
    on public.credit_purchases (abacatepay_charge_id)
    where abacatepay_charge_id is not null;

-- 3. apply_paid_charge -----------------------------------------------------------
--
-- A copia da apply_paid_purchase da 078 com a chave da AbacatePay. Na troca de
-- plano por Pix, os dias que restam valem pelo preco (restante x preco do
-- plano atual / preco do novo); sem Pix dele, a tabela abaixo, espelho de
-- src/lib/billing/plans.ts (tests/billing-pix-troca.test.ts trava as duas).
-- O perfil e lido com FOR UPDATE: dois Pix pagos juntos nao leem o mesmo fim.
-- A assinatura recorrente que ainda cobra fica; a que ja nao cobra sai.
create or replace function public.apply_paid_charge(p_charge_id text)
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
     where abacatepay_charge_id = p_charge_id
       and status <> 'paid'
       for update;

    if v_user_id is null then
        return false;   -- inexistente ou ja aplicada
    end if;

    update public.credit_purchases
       set status = 'paid',
           credited_at = v_agora
     where abacatepay_charge_id = p_charge_id;

    if v_kind = 'pro_month' then
        select plan, plano, current_period_end
          into v_plan, v_plano_atual, v_fim_atual
          from public.profiles
         where id = v_user_id
           for update;

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
               and cp.abacatepay_charge_id is distinct from p_charge_id
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
               abacatepay_subscription_id = case
                   when subscription_status in ('active', 'trialing', 'past_due')
                   then abacatepay_subscription_id
                   else null
               end,
               subscription_status = 'active',
               payment_provider = 'abacatepay',
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

-- SECURITY DEFINER so para o service_role: DOIS caminhos de privilegio (o
-- grant a PUBLIC e o explicito do default-privileges do Supabase). Ver 027.
revoke all on function public.apply_paid_charge(text) from public, anon, authenticated;
grant execute on function public.apply_paid_charge(text) to service_role;

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name in ('abacatepay_customer_id', 'abacatepay_subscription_id', 'subscription_method'); -- 3
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'credit_purchases' and column_name = 'abacatepay_charge_id'; -- 1
--   select has_function_privilege('anon', 'public.apply_paid_charge(text)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.apply_paid_charge(text)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.apply_paid_charge(text)', 'execute');  -- true
