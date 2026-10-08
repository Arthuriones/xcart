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
-- apply_paid_purchase: a da 023, mais o tier.
--
-- O Pix pago grava o tier que foi COBRADO. coalesce: Pix antigo, sem tier na
-- linha, nao apaga o tier que o perfil ja tem.
--
-- Os dias que ainda restam continuam somando, mas na TROCA de plano eles
-- valem pelo preco: restante x preco do plano atual / preco do novo. Sem isso,
-- 11 Pix do 1 Loja seguidos (330 dias) e um do Ilimitado davam 360 dias de
-- Ilimitado pelo preco do 1 Loja; no sentido contrario, um Pix do 1 Loja
-- apagava o Ilimitado dos dias ja pagos. O preco do plano atual e o do ultimo
-- Pix pago dele; sem Pix dele (o tier veio do cartao), a tabela abaixo --
-- espelho de src/lib/billing/plans.ts, travado por tests/billing-pix-troca.test.ts.
--
-- O perfil e lido com FOR UPDATE: dois Pix pagos ao mesmo tempo nao leem o
-- mesmo fim de periodo.
--
-- O cartao que ja nao cobra (cancelado, com cancelamento agendado ou parado no
-- primeiro pagamento) sai do perfil: senao os avisos dele, e a sincronizacao
-- da tela de Assinatura, regravavam plan e fim do periodo por cima do Pix, e a
-- faxina do Pix vencido (expire_pix_pro, que so olha perfil sem assinatura)
-- nunca rodava para essa conta.
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
                when 'loja1'     then 7990
                when 'lojas3'    then 11990
                when 'ilimitado' then 16990
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

-- ----------------------------------------------------------------------------
-- Rotas: criar rota e por loja nela so pelo servidor.
--
-- O limite de lojas no roteamento e conferido nas rotas do app
-- (/api/checkout-routes, connect-by-sku, o clone). Mas `authenticated` tinha
-- INSERT e UPDATE nas duas tabelas: com o token da sessao, um
-- POST /rest/v1/routed_checkout_targets {route_id, target_store_id} ou um
-- PATCH no source_store_id da rota punha loja no roteamento por fora da
-- trava (a RLS so confere o dono). Essas escritas passaram para o service
-- role, depois da checagem de posse e de limite.
--
-- O que a tela grava pela sessao continua: ligar/desligar e configurar a rota
-- (toggle, settings, rodizio) e peso/liga/teto/ordem de cada loja de checkout.
-- Apagar tambem: e o que libera vaga. Revogar o UPDATE da tabela tira as
-- concessoes por coluna; o grant abaixo devolve so estas.
-- ----------------------------------------------------------------------------
revoke insert, update on public.routed_checkout_configs from anon, authenticated;
revoke insert, update on public.routed_checkout_targets from anon, authenticated;

grant update (enabled, settings, rotation, updated_at)
   on public.routed_checkout_configs to authenticated;
grant update (weight, enabled, daily_limit, position)
   on public.routed_checkout_targets to authenticated;

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'plano'
--      and table_name in ('profiles', 'credit_purchases');                  -- 2 linhas
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'update'); -- false
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'insert'); -- false
--   select has_table_privilege('authenticated', 'public.tracking_configs', 'select'); -- true
--   select has_column_privilege('authenticated', 'public.profiles', 'plano', 'update'); -- false
--   select has_table_privilege('authenticated', 'public.routed_checkout_configs', 'insert'); -- false
--   select has_table_privilege('authenticated', 'public.routed_checkout_targets', 'insert'); -- false
--   select has_column_privilege('authenticated', 'public.routed_checkout_configs', 'source_store_id', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.routed_checkout_configs', 'target_store_id', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.routed_checkout_targets', 'target_store_id', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.routed_checkout_targets', 'route_id', 'update');        -- false
--   select has_column_privilege('authenticated', 'public.routed_checkout_configs', 'enabled', 'update');  -- true
--   select has_column_privilege('authenticated', 'public.routed_checkout_targets', 'weight', 'update');   -- true
--   select has_table_privilege('authenticated', 'public.routed_checkout_targets', 'delete');              -- true
--   select has_function_privilege('anon', 'public.apply_paid_purchase(text)', 'execute'); -- false
