-- ============================================================================
-- Rastreamento server-side, multi-loja.
--
-- O pixel do navegador perde evento: bloqueador derruba a requisicao e o ITP do
-- Safari apaga o cookie em 7 dias. O que nao se perde e o pedido -- ele chega
-- por webhook, no servidor, sem depender de JavaScript. Daqui sai o Purchase
-- que o Meta usa para otimizar.
--
-- Quatro tabelas, cada uma com um dono de acesso diferente:
--
--   tracking_configs     o lojista ve e edita   (pixel id, ligado/desligado)
--   tracking_secrets     SO service_role        (token da API de anunciante)
--   tracking_identities  SO service_role        (click id, IP, UA, hash de PII)
--   tracking_events      lojista LE, so isso    (fila de saida, para diagnostico)
--
-- A separacao entre configs e secrets existe porque RLS e por LINHA, nao por
-- coluna: deixar o token na mesma linha que o lojista precisa ler entregaria o
-- token junto. Token de API de anunciante compra midia -- vazar e prejuizo
-- direto.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuracao por loja (o lojista ve)
-- ---------------------------------------------------------------------------

create table if not exists public.tracking_configs (
  store_id    uuid primary key references public.stores (id) on delete cascade,
  -- Denormalizado de stores.user_id: a policy fica sem join e o planner nao
  -- reavalia a subconsulta por linha. Mesmo motivo das outras tabelas do repo.
  user_id     uuid not null references auth.users (id) on delete cascade,

  enabled     boolean not null default false,
  meta_pixel_id text,
  -- Codigo de teste do Events Manager. Nao e segredo: so faz o evento cair na
  -- aba de teste em vez da producao.
  meta_test_event_code text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tracking_configs is
  'Ajustes de rastreamento visiveis para o lojista. O token fica em tracking_secrets.';

create index if not exists tracking_configs_user_idx
  on public.tracking_configs (user_id);

-- Ligado sem pixel nao envia nada e ainda esconde o problema atras de um
-- "ativo" na tela. O banco recusa a combinacao.
alter table public.tracking_configs
  drop constraint if exists tracking_configs_ligado_precisa_pixel;
alter table public.tracking_configs
  add constraint tracking_configs_ligado_precisa_pixel
  check (enabled = false or nullif(btrim(meta_pixel_id), '') is not null);

-- A loja tem que ser do mesmo dono. Sem isto o usuario aponta a configuracao
-- para a loja de outro e passa a receber os eventos dela.
create or replace function public.tracking_config_dono()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.stores s
     where s.id = new.store_id and s.user_id = new.user_id
  ) then
    raise exception 'store_id % nao pertence ao usuario %', new.store_id, new.user_id;
  end if;
  return new;
end;
$$;

-- Funcao nova em public vira endpoint em /rest/v1/rpc/. Sendo SECURITY
-- DEFINER, os dois caminhos de privilegio (o grant a PUBLIC e o default do
-- Supabase) precisam ser fechados -- tirar um deixa o outro. Ver migration 027.
revoke all on function public.tracking_config_dono() from public, anon, authenticated;

drop trigger if exists tracking_configs_dono on public.tracking_configs;
create trigger tracking_configs_dono
  before insert or update on public.tracking_configs
  for each row execute function public.tracking_config_dono();

-- ---------------------------------------------------------------------------
-- 2. Segredos (ninguem le pelo Data API)
-- ---------------------------------------------------------------------------

create table if not exists public.tracking_secrets (
  store_id           uuid primary key references public.stores (id) on delete cascade,
  meta_access_token  text,
  updated_at         timestamptz not null default now()
);

comment on table public.tracking_secrets is
  'Token de API de anunciante. Mesmo tratamento de app_secrets: so service_role.';

-- ---------------------------------------------------------------------------
-- 3. Identidade do visitante (click id + sinais do CAPI)
-- ---------------------------------------------------------------------------
--
-- Guarda o que o Meta precisa para casar a conversao com o clique. E-mail e
-- telefone entram JA EM SHA-256: o xcart nunca precisa do valor em claro, e
-- guardar hash em vez do original tira a tabela do caminho de um vazamento de
-- dado pessoal.
--
-- IP e user agent ficam em claro porque o CAPI exige assim. Por isso o TTL: a
-- linha tem prazo de validade e o expurgo apaga.

create table if not exists public.tracking_identities (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete cascade,

  -- Cookie first-party que o snippet grava no dominio da loja.
  visitor_id  text not null,

  fbp         text,
  fbc         text,
  fbclid      text,
  gclid       text,
  wbraid      text,
  ttclid      text,

  email_sha256 text,
  phone_sha256 text,
  external_id_sha256 text,

  client_ip_address text,
  client_user_agent text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 90 dias: a janela de atribuicao do Meta para clique.
  expires_at  timestamptz not null default (now() + interval '90 days')
);

comment on table public.tracking_identities is
  'Click ids e sinais de match por visitante. PII so em SHA-256. Expira em 90 dias.';

create unique index if not exists tracking_identities_visitante_idx
  on public.tracking_identities (store_id, visitor_id);

create index if not exists tracking_identities_expira_idx
  on public.tracking_identities (expires_at);

-- ---------------------------------------------------------------------------
-- 4. Fila de saida
-- ---------------------------------------------------------------------------
--
-- O envio ao Meta falha -- rede, token vencido, limite de taxa. Falha que some
-- e conversao que nunca foi contada, entao o evento nasce aqui como 'pendente'
-- e so sai da fila quando o destino confirma.

create table if not exists public.tracking_events (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete cascade,

  destination   text not null check (destination in ('meta', 'google', 'ga4')),
  event_name    text not null,

  -- A MESMA chave que o pixel do navegador manda. E o que permite ao Meta
  -- juntar os dois e contar uma conversao so; sem ela, duplica ou descarta.
  event_id      text not null,

  -- Pedido da Shopify, quando o evento nasce do webhook.
  order_id      text,

  payload       jsonb not null,

  status        text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'falhou')),
  attempts      integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error    text,
  response      jsonb,

  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

comment on table public.tracking_events is
  'Fila de saida do rastreamento. Uma linha por (loja, destino, event_id).';

-- Reentrega de webhook e retentativa nossa nao podem virar duas conversoes.
create unique index if not exists tracking_events_unico_idx
  on public.tracking_events (store_id, destination, event_id);

-- Fila do worker: so o que esta pendente e ja pode tentar de novo.
create index if not exists tracking_events_fila_idx
  on public.tracking_events (next_attempt_at)
  where status = 'pendente';

create index if not exists tracking_events_loja_idx
  on public.tracking_events (store_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Expurgo
-- ---------------------------------------------------------------------------
--
-- tracking_identities cresce com o TRAFEGO, nao com o numero de lojas: sem
-- expurgo vira a maior tabela do banco. Evento entregue tambem nao precisa
-- ficar para sempre -- 90 dias cobrem qualquer conferencia de atribuicao.

create or replace function public.purge_tracking()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tracking_identities
   where expires_at < now();

  delete from public.tracking_events
   where status = 'enviado'
     and created_at < now() - interval '90 days';
end;
$$;

comment on function public.purge_tracking() is
  'Apaga identidade vencida e evento entregue com mais de 90 dias. Chamado pelo cron.';

revoke all on function public.purge_tracking() from public, anon, authenticated;
grant execute on function public.purge_tracking() to service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table public.tracking_configs    enable row level security;
alter table public.tracking_secrets    enable row level security;
alter table public.tracking_identities enable row level security;
alter table public.tracking_events     enable row level security;

-- configs: o dono gerencia. WITH CHECK alem de USING -- sem ele, USING prende
-- so a linha ANTIGA e o usuario reatribui o dono na propria atualizacao.
-- Ver migration 030.
drop policy if exists "Owners manage their tracking config" on public.tracking_configs;
create policy "Owners manage their tracking config" on public.tracking_configs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = tracking_configs.store_id
                   and s.user_id = (select auth.uid())));

-- events: o lojista LE, para ver o que saiu e o que falhou. Quem escreve e o
-- servidor -- evento forjado pelo cliente viraria conversao inventada.
drop policy if exists "Owners read their tracking events" on public.tracking_events;
create policy "Owners read their tracking events" on public.tracking_events
  for select to authenticated
  using (exists (select 1 from public.stores s
                  where s.id = tracking_events.store_id
                    and s.user_id = (select auth.uid())));

-- secrets e identities: RLS ligada SEM policy = ninguem entra pelo Data API.
-- service_role passa por cima, como sempre. Mesmo padrao de
-- shopify_webhook_events e app_secrets.
revoke all on table public.tracking_secrets    from anon, authenticated;
revoke all on table public.tracking_identities from anon, authenticated;

-- O lojista nunca escreve na fila, so le.
revoke insert, update, delete on table public.tracking_events from anon, authenticated;

grant select, insert, update, delete on table public.tracking_configs    to service_role;
grant select, insert, update, delete on table public.tracking_secrets    to service_role;
grant select, insert, update, delete on table public.tracking_identities to service_role;
grant select, insert, update, delete on table public.tracking_events     to service_role;
