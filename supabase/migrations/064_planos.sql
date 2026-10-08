-- ============================================================================
-- 064 -- Os 3 planos: 1 Loja, 3 Lojas e Ilimitado (decisao de 08/10/2026).
--
-- Os tres continuam sendo profiles.plan = 'pro' para fins de acesso. O que
-- muda e o LIMITE de lojas, e ele mora no tier:
--
--   profiles.plano         o tier pago. null = assinante de antes dos planos
--                          (Stripe ou Pagou a R$ 89) ou conta sem assinatura;
--                          o app aplica os limites do 1 Loja.
--   credit_purchases.plano o tier de um Pix de 30 dias (kind = 'pro_month').
--                          apply_paid_purchase grava no perfil quando o Pix cai.
--
-- Os numeros (preco e limites) moram em src/lib/billing/plans.ts. O banco so
-- guarda QUAL plano.
-- ============================================================================

alter table public.profiles
  add column if not exists plano text
  check (plano is null or plano in ('loja1', 'lojas3', 'ilimitado'));

comment on column public.profiles.plano is
  'Tier pago: loja1, lojas3 ou ilimitado. null = Pro antigo (R$ 89) ou sem plano: limites do loja1.';

alter table public.credit_purchases
  add column if not exists plano text
  check (plano is null or plano in ('loja1', 'lojas3', 'ilimitado'));

comment on column public.credit_purchases.plano is
  'Tier do Pix de 30 dias (kind = pro_month). null nas recargas de credito.';

-- ----------------------------------------------------------------------------
-- apply_paid_purchase: igual a da 023, mais o tier.
--
-- O Pix pago grava o tier que foi COBRADO. coalesce: Pix antigo, sem tier na
-- linha, nao apaga o tier que o perfil ja tem.
-- ----------------------------------------------------------------------------
create or replace function public.apply_paid_purchase(p_transaction_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_credits integer;
    v_kind    text;
    v_plano   text;
    v_fim     timestamptz;
begin
    select user_id, credits, kind, plano
      into v_user_id, v_credits, v_kind, v_plano
      from public.credit_purchases
     where pagou_transaction_id = p_transaction_id
       and status <> 'paid'
       for update;

    if v_user_id is null then
        return false;   -- inexistente ou ja aplicada
    end if;

    update public.credit_purchases
       set status = 'paid',
           credited_at = timezone('utc', now())
     where pagou_transaction_id = p_transaction_id;

    if v_kind = 'pro_month' then
        -- Empilha sobre o que ainda resta, para quem paga adiantado nao perder
        -- os dias que sobraram.
        select greatest(coalesce(current_period_end, timezone('utc', now())),
                        timezone('utc', now())) + interval '30 days'
          into v_fim
          from public.profiles
         where id = v_user_id;

        update public.profiles
           set plan = 'pro',
               plano = coalesce(v_plano, plano),
               subscription_status = 'active',
               payment_provider = 'pagou',
               current_period_end = v_fim,
               cancel_at_period_end = false,
               ai_credits = ai_credits + v_credits,
               credits_reset_at = timezone('utc', now()),
               updated_at = timezone('utc', now())
         where id = v_user_id;
    else
        update public.profiles
           set ai_credits = ai_credits + v_credits,
               updated_at = timezone('utc', now())
         where id = v_user_id;
    end if;

    return true;
end;
$$;

-- create or replace mantem os grants, mas a regra da 027 e conferir sempre.
revoke all on function public.apply_paid_purchase(text) from public, anon, authenticated;
grant execute on function public.apply_paid_purchase(text) to service_role;

-- ----------------------------------------------------------------------------
-- tracking_configs: escrita so pelo servidor.
--
-- O limite de lojas com rastreamento e conferido nas rotas do app
-- (/api/tracking/config e /api/tracking/destinos), que ja gravam pelo
-- service_role. Mas `authenticated` ainda tinha INSERT e UPDATE na tabela, e a
-- policy deixava o dono escrever a propria linha: com o token da sessao, um
-- PATCH /rest/v1/tracking_configs {"enabled": true} ligava o rastreamento em
-- quantas lojas quisesse, por fora da trava. Nenhum caminho do app escreve
-- aqui pela sessao (conferido: config, destinos e collect usam o admin), entao
-- o grant sai. SELECT fica: as telas leem pela sessao.
-- ----------------------------------------------------------------------------
revoke insert, update on public.tracking_configs from anon, authenticated;

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'plano'
--      and table_name in ('profiles', 'credit_purchases');                  -- 2 linhas
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'update'); -- false
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'insert'); -- false
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'select'); -- true
--   select has_column_privilege('authenticated', 'public.profiles', 'plano', 'update'); -- false
--   select has_function_privilege('anon', 'public.apply_paid_purchase(text)', 'execute'); -- false
