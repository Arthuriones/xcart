-- ============================================================================
-- 067_ad_connection_tickets.sql
--
-- Tickets temporários para conexão OAuth em navegadores multilogin / antidetect
-- (Dolphin Anty, AdsPower, etc.) ou compartilhamento seguro com colaboradores.
-- ============================================================================

create table if not exists public.ad_connection_tickets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  plataforma          text not null check (plataforma in ('meta', 'google', 'tiktok')),
  ticket_hash         text not null unique,
  status              text not null default 'pending' check (status in ('pending', 'completed', 'expired', 'error')),
  resultado           jsonb not null default '{}'::jsonb,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default now()
);

create index if not exists ad_connection_tickets_hash_idx
  on public.ad_connection_tickets (ticket_hash);

create index if not exists ad_connection_tickets_user_idx
  on public.ad_connection_tickets (user_id);

alter table public.ad_connection_tickets enable row level security;

create policy "Dono gerencia seus tickets"
  on public.ad_connection_tickets
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Service role gerencia tickets"
  on public.ad_connection_tickets
  for all
  to service_role
  using (true)
  with check (true);
