-- ============================================================================
-- O destino vira LINHA, para a loja poder ter mais de um.
--
-- Ate aqui `tracking_configs` guardava UM Google e UM Meta por loja, em colunas.
-- Isso impede o que o Arthur pediu -- varios pixels na mesma loja, como ja
-- funciona com alvo de checkout -- e tambem impede casos reais: agencia e
-- lojista com pixels separados, duas contas de anuncio no mesmo catalogo,
-- migracao de uma conta para outra sem apagar a antiga.
--
-- A CONSEQUENCIA QUE DECIDE O DESENHO
--
-- O indice unico da fila e (store_id, destination, event_id), com destination
-- sendo 'google' ou 'meta'. Com DOIS pixels Meta, o mesmo evento colidiria
-- consigo mesmo e o segundo seria descartado como "duplicado" -- silenciosamente,
-- que e o pior jeito de falhar. Por isso `destination_id` entra na chave.
-- ============================================================================

create table if not exists public.tracking_destinations (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,
  -- Denormalizado de stores.user_id, como nas outras tabelas do repo: a policy
  -- fica sem join e o planner nao reavalia a subconsulta por linha.
  user_id     uuid not null references auth.users (id) on delete cascade,

  plataforma  text not null check (plataforma in ('google', 'meta')),
  -- Apelido do lojista. Com dois pixels da mesma plataforma, o id numerico
  -- sozinho nao diz qual e qual na tela.
  nome        text,

  -- AW-XXXXXXXXX no Google, id do pixel no Meta.
  conta       text not null,
  -- So Google: um rotulo por evento. No Meta um pixel cobre todos.
  labels      jsonb not null default '{}'::jsonb,
  -- So Meta: joga o evento para a aba de teste do Events Manager.
  test_event_code text,

  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tracking_destinations is
  'Um destino de conversao. Varios por loja, inclusive da mesma plataforma.';

create index if not exists tracking_destinations_loja_idx
  on public.tracking_destinations (store_id);

-- A mesma conta duas vezes na mesma loja duplicaria toda conversao.
create unique index if not exists tracking_destinations_loja_conta_key
  on public.tracking_destinations (store_id, plataforma, conta);

alter table public.tracking_destinations enable row level security;

-- UPDATE/INSERT precisa de WITH CHECK, nao so USING: USING prende a linha
-- ANTIGA, e sem WITH CHECK o usuario reatribuiria o dono na linha NOVA.
-- Ver migration 030.
drop policy if exists "Owners manage their tracking destinations" on public.tracking_destinations;
create policy "Owners manage their tracking destinations"
  on public.tracking_destinations
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Segredo por destino
-- ---------------------------------------------------------------------------
--
-- Mesmo tratamento de tracking_secrets: o token posta evento na conta de
-- anuncios do lojista, entao RLS ligado e ZERO policy -- so o service_role
-- alcanca. Tabela separada porque RLS e por LINHA, nao por coluna: deixar o
-- token na linha que o lojista le entregaria o token junto.
create table if not exists public.tracking_destination_secrets (
  destination_id uuid primary key
    references public.tracking_destinations (id) on delete cascade,
  access_token   text,
  updated_at     timestamptz not null default now()
);

alter table public.tracking_destination_secrets enable row level security;

-- ---------------------------------------------------------------------------
-- Migra o que ja existe
-- ---------------------------------------------------------------------------
insert into public.tracking_destinations
  (store_id, user_id, plataforma, nome, conta, labels)
select c.store_id, c.user_id, 'google', 'Google Ads',
       btrim(c.google_conversion_id), coalesce(c.google_labels, '{}'::jsonb)
from public.tracking_configs c
where nullif(btrim(c.google_conversion_id), '') is not null
on conflict (store_id, plataforma, conta) do nothing;

insert into public.tracking_destinations
  (store_id, user_id, plataforma, nome, conta, test_event_code)
select c.store_id, c.user_id, 'meta', 'Meta',
       btrim(c.meta_pixel_id), c.meta_test_event_code
from public.tracking_configs c
where nullif(btrim(c.meta_pixel_id), '') is not null
on conflict (store_id, plataforma, conta) do nothing;

-- O token do Meta acompanha o destino que ele autentica.
insert into public.tracking_destination_secrets (destination_id, access_token)
select d.id, sec.meta_access_token
from public.tracking_destinations d
join public.tracking_secrets sec on sec.store_id = d.store_id
where d.plataforma = 'meta' and sec.meta_access_token is not null
on conflict (destination_id) do nothing;

-- ---------------------------------------------------------------------------
-- A fila passa a saber de QUAL destino e cada linha
-- ---------------------------------------------------------------------------
alter table public.tracking_events
  add column if not exists destination_id uuid
    references public.tracking_destinations (id) on delete cascade;

comment on column public.tracking_events.destination_id is
  'Qual destino. Entra na chave de deduplicacao: sem isto, dois pixels da mesma plataforma colidiriam e o segundo sumiria como "duplicado".';

-- Carimba o historico, para a contagem da tela nao perder as linhas antigas.
update public.tracking_events e
   set destination_id = d.id
  from public.tracking_destinations d
 where e.destination_id is null
   and d.store_id = e.store_id
   and d.plataforma = case when e.destination = 'google' then 'google' else 'meta' end;

-- A chave nova. A antiga sai: ela e que impediria o segundo pixel.
drop index if exists tracking_events_unico_idx;
create unique index if not exists tracking_events_dedupe_destino_key
  on public.tracking_events (store_id, destination_id, event_id)
  where destination_id is not null;

create index if not exists tracking_events_destino_idx
  on public.tracking_events (destination_id, created_at desc)
  where destination_id is not null;
