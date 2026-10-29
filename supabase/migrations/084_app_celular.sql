-- ============================================================================
-- 084 -- App do celular, Fase 1 (backend).
--
-- 1. app_aparelhos: o token de push (Expo) de cada celular com o app logado.
--    Sem policy, como venda_webhooks (070): so o service role le e grava -- o
--    app registra pela rota /api/app/v1/aparelhos, nunca direto no PostgREST.
--    expo_token e unico: o mesmo celular que entra em outra conta passa para
--    ela (upsert pelo token), e nao avisa duas contas.
-- 2. background_jobs.user_id sem cascata (008) travava apagar o usuario: as
--    outras FKs para auth.users ja sao cascade. Excluir a conta (exigencia da
--    Apple e do Google) precisa disso.
-- 3. ad_connection_secrets (060) nascia sem RLS no arquivo. Em producao ja
--    estava com RLS ligado e sem policy (conferido em 28/10/2026); aqui so
--    passa a constar, com o revoke, antes de o token ganhar ads_management.
-- ============================================================================

create table if not exists public.app_aparelhos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  expo_token       text not null unique
                   check (expo_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  plataforma       text not null check (plataforma in ('ios', 'android')),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  ultimo_envio_em  timestamptz,
  ultimo_erro      text
);

create index if not exists app_aparelhos_user_idx on public.app_aparelhos (user_id);

alter table public.app_aparelhos enable row level security;
revoke all on public.app_aparelhos from public, anon, authenticated;
grant all on public.app_aparelhos to service_role;

alter table public.background_jobs drop constraint if exists background_jobs_user_id_fkey;
alter table public.background_jobs
  add constraint background_jobs_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.ad_connection_secrets enable row level security;
revoke all on public.ad_connection_secrets from public, anon, authenticated;
grant all on public.ad_connection_secrets to service_role;
