-- ============================================================================
-- 061_campanhas_dashboard.sql
--
-- Suporte ao Dashboard de Campanhas / Tráfego Pago (estilo Cakto / UTMify).
-- 1. ad_insights_granular: métricas diárias por conta, campanha, grupo (adset)
--    e anúncio (ad), com métricas completas de tráfego, funil e lucro.
-- 2. user_dashboard_preferences: preferências de colunas personalizadas e
--    ordenação por usuário.
-- ============================================================================

-- 1. Insights granulares (Conta, Campanha, Conjunto, Anúncio)
create table if not exists public.ad_insights_granular (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  ad_account_id       uuid not null references public.ad_accounts (id) on delete cascade,
  plataforma          text not null check (plataforma in ('meta', 'google', 'tiktok')),
  data                date not null,
  -- Nível de agregação: conta, campanha, grupo (adset/conjunto), anuncio (ad)
  nivel               text not null check (nivel in ('conta', 'campanha', 'grupo', 'anuncio')),
  -- Identificador do objeto na plataforma
  objeto_id           text not null,
  objeto_nome         text not null,
  objeto_status       text not null default 'ACTIVE',
  -- Hierarquia pai (quando nivel for grupo ou anuncio)
  campanha_id         text,
  campanha_nome       text,
  grupo_id            text,
  grupo_nome          text,
  -- Métricas financeiras e de orçamento
  tipo                text, -- CBO, ABO, SEARCH, PMAX, etc.
  orcamento           numeric(14,2) not null default 0,
  cpa_desejado        numeric(14,2),
  gasto               numeric(14,4) not null default 0 check (gasto >= 0),
  impressoes          bigint not null default 0 check (impressoes >= 0),
  cliques             bigint not null default 0 check (cliques >= 0),
  cpc                 numeric(12,4) default 0,
  cpm                 numeric(12,4) default 0,
  ctr                 numeric(8,4) default 0,
  -- Vendas, receita e lucro
  vendas              numeric(12,2) not null default 0,
  faturamento         numeric(14,2) not null default 0,
  custo_produto       numeric(14,2) not null default 0,
  lucro               numeric(14,2) not null default 0,
  roas                numeric(10,2) not null default 0,
  roi                 numeric(10,2) not null default 0,
  margem              numeric(8,2) not null default 0,
  cpa                 numeric(12,2) not null default 0,
  -- Métricas de funil
  ic                  bigint not null default 0 check (ic >= 0),
  cpi                 numeric(12,2) not null default 0,
  -- Métricas de engajamento e vídeo
  vis_video           bigint not null default 0 check (vis_video >= 0),
  vis_3s              bigint not null default 0 check (vis_3s >= 0),
  retencao_75         numeric(8,2) not null default 0,
  hook_rate           numeric(8,2) not null default 0,
  hold_rate           numeric(8,2) not null default 0,
  frequencia          numeric(8,2) not null default 1,
  -- Moeda
  moeda               text not null default 'BRL' check (moeda ~ '^[A-Z]{3}$'),
  sincronizado_em     timestamptz not null default now(),
  constraint ad_insights_granular_unique unique (ad_account_id, data, nivel, objeto_id)
);

create index if not exists ad_insights_granular_user_data_idx
  on public.ad_insights_granular (user_id, data desc, nivel, plataforma);

create index if not exists ad_insights_granular_account_idx
  on public.ad_insights_granular (ad_account_id);

alter table public.ad_insights_granular enable row level security;

create policy "Dono le ad_insights_granular"
  on public.ad_insights_granular
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Service role gerencia ad_insights_granular"
  on public.ad_insights_granular
  for all
  to service_role
  using (true)
  with check (true);


-- 2. Preferências de colunas personalizadas do Dashboard
create table if not exists public.user_dashboard_preferences (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  colunas             jsonb not null default '["status", "nome", "tipo", "orcamento", "cpa_desejado", "vendas", "cpa", "gastos", "faturamento", "lucro", "roas", "margem"]'::jsonb,
  filtros_padrao      jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);

alter table public.user_dashboard_preferences enable row level security;

create policy "Dono le e grava user_dashboard_preferences"
  on public.user_dashboard_preferences
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Service role gerencia user_dashboard_preferences"
  on public.user_dashboard_preferences
  for all
  to service_role
  using (true)
  with check (true);
