-- ============================================================================
-- 054 -- Conexoes OAuth de perfis de anuncio (Meta e Google).
-- Guarda o perfil conectado (nome, foto, ID da plataforma)
-- para login com 1 clique estilo UTMify e sincronizacao automatica das contas.
-- ============================================================================

create table if not exists public.ad_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  plataforma          text not null check (plataforma in ('meta', 'google')),
  external_user_id    text not null,
  nome                text,
  email               text,
  foto_url            text,
  token_expira_em     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, plataforma, external_user_id)
);

alter table public.ad_connections enable row level security;

create policy "ad_connections_dono" on public.ad_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists ad_connections_user_idx
  on public.ad_connections (user_id, plataforma);

drop trigger if exists ad_connections_updated_at on public.ad_connections;
create trigger ad_connections_updated_at
  before update on public.ad_connections
  for each row execute function public.update_updated_at();

-- Segredos por conexao (long-lived access token do Meta, refresh token do Google).
-- Sem politica publica: apenas service_role acessa.
create table if not exists public.ad_connection_secrets (
  connection_id       uuid primary key references public.ad_connections (id) on delete cascade,
  access_token        text not null,
  refresh_token       text,
  updated_at          timestamptz not null default now()
);

-- Vincular ad_accounts a conexao de origem (opcional)
alter table public.ad_accounts
  add column if not exists connection_id uuid references public.ad_connections (id) on delete set null;

create index if not exists ad_accounts_connection_idx
  on public.ad_accounts (connection_id);
