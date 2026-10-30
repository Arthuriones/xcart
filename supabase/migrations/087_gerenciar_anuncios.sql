-- ============================================================================
-- 087 -- Gerenciar anuncios pelo Panda Track (plano-de-acao/03).
--
-- 1. ad_regras: as regras automaticas do lojista ("custo por IC do anuncio
--    passou de 20 -> pausa"), checadas de tanto em tanto tempo pelo cron
--    /api/jobs/ads/regras. Escopo: UMA operacao (loja ou checkout) ou UMA
--    conta de anuncio. O usuario so LE pela sessao; criar, mudar e apagar e
--    pela rota /api/ads/regras (service role), que confere que a loja, o
--    checkout ou a conta sao dele -- uma policy de INSERT so conferiria o
--    user_id, e o cron agiria na conta de outra pessoa pelo store_id.
-- 2. ad_alteracoes: o historico de toda mudanca feita por nos no Meta (mao ou
--    regra): quem, o que, de quanto para quanto, quando e se deu certo. So o
--    service role grava.
-- ============================================================================

create table if not exists public.ad_regras (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  nome                 text not null check (char_length(nome) between 1 and 80),
  ativa                boolean not null default true,
  store_id             uuid references public.stores (id) on delete cascade,
  checkout_id          uuid references public.checkouts_externos (id) on delete cascade,
  ad_account_id        uuid references public.ad_accounts (id) on delete cascade,
  nivel                text not null check (nivel in ('campanha', 'grupo', 'anuncio')),
  -- Pedaco do nome (sem diferenca de maiuscula): so os objetos que o contem.
  filtro_nome          text check (filtro_nome is null or char_length(filtro_nome) between 1 and 80),
  metrica              text not null check (metrica in ('custo_por_ic', 'custo_por_compra', 'gasto', 'cpc', 'ctr', 'cpm', 'roas')),
  operador             text not null check (operador in ('maior', 'menor')),
  valor                numeric(14, 4) not null check (valor >= 0),
  -- Na moeda da conta de anuncio. Abaixo disso a regra nao julga o objeto.
  gasto_minimo         numeric(14, 2) not null default 0 check (gasto_minimo >= 0),
  janela               text not null default 'hoje' check (janela in ('hoje', '3d', '7d')),
  acao                 text not null check (acao in ('pausar', 'diminuir_orcamento', 'aumentar_orcamento', 'avisar')),
  acao_percentual      numeric(5, 2) check (acao_percentual is null or (acao_percentual > 0 and acao_percentual <= 100)),
  -- Piso (diminuir) ou teto (aumentar) do orcamento diario, moeda da conta.
  orcamento_limite     numeric(14, 2) check (orcamento_limite is null or orcamento_limite > 0),
  intervalo_minutos    integer not null default 60 check (intervalo_minutos in (30, 60, 120, 180, 360, 720, 1440)),
  ultima_execucao_em   timestamptz,
  proxima_execucao_em  timestamptz not null default now(),
  ultimo_resultado     jsonb,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  check (num_nonnulls(store_id, checkout_id, ad_account_id) = 1),
  check (acao not in ('diminuir_orcamento', 'aumentar_orcamento') or acao_percentual is not null)
);

create index if not exists ad_regras_user_idx on public.ad_regras (user_id);
create index if not exists ad_regras_proxima_idx on public.ad_regras (proxima_execucao_em) where ativa;

alter table public.ad_regras enable row level security;
revoke all on public.ad_regras from public, anon, authenticated;
grant select on public.ad_regras to authenticated;
grant all on public.ad_regras to service_role;

drop policy if exists ad_regras_select_dono on public.ad_regras;
create policy ad_regras_select_dono on public.ad_regras
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.ad_alteracoes (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  ad_account_id  uuid not null references public.ad_accounts (id) on delete cascade,
  plataforma     text not null default 'meta' check (plataforma in ('meta')),
  nivel          text not null check (nivel in ('campanha', 'grupo', 'anuncio')),
  objeto_id      text not null check (objeto_id ~ '^[0-9]{5,25}$'),
  objeto_nome    text,
  campo          text not null check (campo in ('status', 'orcamento_diario', 'orcamento_total', 'lance', 'roas_minimo')),
  antes          text,
  depois         text,
  origem         text not null check (origem in ('manual', 'regra')),
  regra_id       uuid references public.ad_regras (id) on delete set null,
  ok             boolean not null,
  erro           text,
  criado_em      timestamptz not null default now()
);

create index if not exists ad_alteracoes_user_idx on public.ad_alteracoes (user_id, criado_em desc);
create index if not exists ad_alteracoes_objeto_idx on public.ad_alteracoes (ad_account_id, objeto_id, criado_em desc);

alter table public.ad_alteracoes enable row level security;
revoke all on public.ad_alteracoes from public, anon, authenticated;
grant select on public.ad_alteracoes to authenticated;
grant all on public.ad_alteracoes to service_role;

drop policy if exists ad_alteracoes_select_dono on public.ad_alteracoes;
create policy ad_alteracoes_select_dono on public.ad_alteracoes
  for select to authenticated using (user_id = auth.uid());

comment on table public.ad_regras is
  'Regras automaticas de anuncio (Meta). Leitura pela sessao; escrita so pela rota /api/ads/regras (service role), que confere o dono do escopo.';
comment on table public.ad_alteracoes is
  'Historico das mudancas feitas pelo Panda Track no Meta (status, orcamento, lance), a mao ou por regra. So o service role grava.';
