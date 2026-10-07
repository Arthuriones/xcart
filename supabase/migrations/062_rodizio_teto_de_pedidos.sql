-- ============================================================================
-- 062 -- Teto de pedidos por dia no rodizio (aquecer conta de pagamento).
--
-- A vitrine manda carrinho para varias lojas de checkout; o peso divide o
-- trafego, mas nao segura volume. Para aquecer uma conta nova se quer "no
-- maximo N pedidos por dia nela", e o resto na principal. Ver
-- src/lib/checkout-routes/pedidos-24h.ts e pickTarget em rotation.ts.
--
--   1. routed_checkout_targets.daily_limit: null = sem teto.
--   2. routed_checkout_orders: um pedido real por linha, gravado pelo webhook
--      orders/create de cada loja de checkout. A contagem e sobre as ultimas
--      24 h (janela deslizante, sem fuso e sem rajada a meia-noite), e o
--      webhook apaga o que passou de 3 dias.
-- ============================================================================

alter table public.routed_checkout_targets
  add column if not exists daily_limit integer
  check (daily_limit is null or (daily_limit >= 1 and daily_limit <= 100000));

comment on column public.routed_checkout_targets.daily_limit is
  'Teto de pedidos nas ultimas 24 h para esta loja de checkout; null = sem teto. Bateu, sai do sorteio (teto macio: todos cheios, o carrinho vai assim mesmo).';

create table if not exists public.routed_checkout_orders (
  store_id   uuid not null references public.stores (id) on delete cascade,
  order_id   text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, order_id)
);

comment on table public.routed_checkout_orders is
  'Pedidos reais por loja de checkout, para o teto de pedidos/dia do rodizio. Gravado pelo webhook orders/create; retencao de 3 dias.';

create index if not exists routed_checkout_orders_loja_dia_idx
  on public.routed_checkout_orders (store_id, created_at);

alter table public.routed_checkout_orders enable row level security;

-- Escrita so pelo service_role (o webhook). Leitura pelo dono da loja: a tela
-- do rodizio mostra "N/teto hoje" com o cliente do usuario, sob RLS.
revoke all on table public.routed_checkout_orders from anon, authenticated;
grant select on table public.routed_checkout_orders to authenticated;

drop policy if exists routed_checkout_orders_dono_le on public.routed_checkout_orders;
create policy routed_checkout_orders_dono_le
  on public.routed_checkout_orders
  for select
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = routed_checkout_orders.store_id
        and s.user_id = (select auth.uid())
    )
  );

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_name = 'routed_checkout_targets' and column_name = 'daily_limit';
--   select has_table_privilege('anon', 'public.routed_checkout_orders', 'select');          -- false
--   select has_table_privilege('authenticated', 'public.routed_checkout_orders', 'insert'); -- false
--   select has_table_privilege('authenticated', 'public.routed_checkout_orders', 'select'); -- true (RLS limita ao dono)
