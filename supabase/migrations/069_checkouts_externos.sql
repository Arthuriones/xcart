-- ============================================================================
-- 069 -- Checkout externo: a "loja" que nao e Shopify. Primeiro a Sphere
-- Affiliates (rede de afiliados COD na Europa).
--
-- O lojista roda anuncio para uma oferta, o pedido acontece na plataforma
-- dele e o xcart recebe cada movimentacao por WEBHOOK: pedido criado, COD
-- expirado, comissao aprovada, comissao paga. No Dashboard o checkout vira
-- uma "loja" de comissao: Recebido = comissao aprovada + paga, A receber =
-- comissao pendente, Previsto pela taxa de aprovacao. Regras em
-- src/lib/checkouts-externos/.
--
-- POR QUE TABELA PROPRIA E NAO UMA LINHA DE `stores`
--
-- Quase todo .from("stores") do codigo supoe Shopify (Admin API, crons,
-- conserto da rota, webhook por shop_domain). Um checkout ali entraria em
-- cron que nao sabe o que fazer com ele. O nome foge de "checkouts" de
-- proposito: tracking_checkouts e routed_checkout_* sao outra coisa.
--
-- O TOKEN DO WEBHOOK
--
-- A Sphere nao assina o corpo nem deixa mandar header: a URL e a senha.
-- Ela mora em checkout_externo_segredos, RLS ligada e ZERO policy (como
-- ad_account_secrets na 052): a sessao do lojista nao le. O endpoint busca
-- pelo sha256 (indice unico); o token em claro fica so para mostrar a URL de
-- novo e para o "Enviar evento de teste".
--
-- QUEM ESCREVE
--
-- So service_role (o endpoint publico e as rotas /api/checkouts, que conferem
-- o dono pela sessao). O lojista LE pela RLS. As policies tem USING e WITH
-- CHECK mesmo assim (030).
--
-- SO ACRESCENTA. Nada muda para loja Shopify: ad_accounts ganha uma coluna
-- opcional, e o codigo le e grava com ou sem esta migration (tabela ausente
-- = nenhum checkout; coluna ausente = conta sem checkout).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. O checkout
-- ---------------------------------------------------------------------------
create table if not exists public.checkouts_externos (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  -- Cresce com as plataformas (yampi, cartpanda, kiwify...).
  plataforma             text not null check (plataforma in ('sphere')),
  nome                   text not null check (length(btrim(nome)) between 1 and 80),
  -- Pausado: pedido NOVO nao entra (200, ignorado) e nada notifica. Evento de
  -- pedido que ja existe segue valendo: a plataforma manda cada movimentacao
  -- uma vez so, e a comissao aprovada durante a pausa nao pode se perder.
  ativo                  boolean not null default true,
  -- A Sphere NAO manda a moeda da comissao: o lojista diz qual e.
  moeda_receita          text not null default 'EUR' check (moeda_receita ~ '^[A-Z]{3}$'),
  -- O "dia" do pedido (dia_local) e o "hoje" do Dashboard com so o checkout.
  fuso                   text not null default 'America/Sao_Paulo'
                         check (length(fuso) between 1 and 64),
  -- Taxa de aprovacao (%) do Previsto ate o checkout ter amostra propria.
  taxa_aprovacao_padrao  numeric(5,2) not null default 70
                         check (taxa_aprovacao_padrao >= 0 and taxa_aprovacao_padrao <= 100),
  -- Avisar no celular tambem a comissao aprovada (o pedido criado sempre avisa).
  notificar_aprovada     boolean not null default false,
  ultimo_evento_em       timestamptz,
  ultimo_evento          text check (ultimo_evento is null or length(ultimo_evento) <= 40),
  ultimo_evento_teste    boolean not null default false,
  ultimo_erro            text check (ultimo_erro is null or length(ultimo_erro) <= 500),
  ultimo_erro_em         timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Alvo das FKs compostas (mesmo motivo da 032): a linha filha tem o MESMO
  -- dono do checkout, inclusive quando quem grava e o service role.
  constraint checkouts_externos_id_user_key unique (id, user_id)
);

create index if not exists checkouts_externos_user_idx
  on public.checkouts_externos (user_id, created_at);


-- ---------------------------------------------------------------------------
-- 1b. Os codigos de afiliado de cada checkout
-- ---------------------------------------------------------------------------
--
-- O primeiro evento real de cada afiliado.codigo o liga ao checkout que
-- recebeu. Um checkout pode ter VARIOS codigos (a doc da Sphere nao garante
-- um codigo por conta: ele vem junto do programa_id), mas cada codigo e de UM
-- checkout do usuario -- a mesma conta da Sphere com a URL de dois checkouts
-- contaria a comissao em dobro, e o segundo recebe 409. "Trocar URL" solta os
-- codigos do checkout (a URL nova os liga de novo no primeiro evento).
create table if not exists public.checkout_externo_contas (
  user_id      uuid not null,
  plataforma   text not null check (plataforma in ('sphere')),
  conta        text not null check (length(conta) between 1 and 64),
  checkout_id  uuid not null,
  criado_em    timestamptz not null default now(),
  primary key (user_id, plataforma, conta),
  constraint checkout_externo_contas_checkout_fk
    foreign key (checkout_id, user_id)
    references public.checkouts_externos (id, user_id) on delete cascade
);

create index if not exists checkout_externo_contas_checkout_idx
  on public.checkout_externo_contas (checkout_id);


-- ---------------------------------------------------------------------------
-- 2. O segredo da URL do webhook
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_externo_segredos (
  checkout_id  uuid primary key references public.checkouts_externos (id) on delete cascade,
  -- 32 bytes aleatorios em base64url (gerarSegredo): 43 caracteres.
  token        text not null check (token ~ '^[A-Za-z0-9_-]{43}$'),
  -- sha256 hex do token: a busca do endpoint.
  token_hash   text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  updated_at   timestamptz not null default now()
);

create unique index if not exists checkout_externo_segredos_hash_key
  on public.checkout_externo_segredos (token_hash);


-- ---------------------------------------------------------------------------
-- 3. Os pedidos (uma linha por pedido, no ULTIMO estado)
-- ---------------------------------------------------------------------------
--
-- Sem dado pessoal: a Sphere nao manda nome, endereco nem telefone, e nada
-- disso caberia aqui.
create table if not exists public.pedidos_externos (
  checkout_id       uuid not null,
  user_id           uuid not null,
  pedido_id         text not null check (length(pedido_id) between 1 and 64),
  -- pendente -> aprovado -> pago; expirado (COD nao entregue) e revertido.
  situacao          text not null
                    check (situacao in ('pendente', 'aprovado', 'pago', 'expirado', 'revertido')),
  -- Como a plataforma escreveu (pending, approved...): so para conferencia.
  status_comissao   text check (status_comissao is null or length(status_comissao) <= 40),
  status_pedido     text check (status_pedido is null or length(status_pedido) <= 40),
  metodo_pagamento  text check (metodo_pagamento is null or length(metodo_pagamento) <= 40),
  produto           text check (produto is null or length(produto) <= 200),
  pais              text check (pais is null or pais ~ '^[A-Z]{2}$'),
  programa          text check (programa is null or length(programa) <= 120),
  -- Total do pedido na moeda do pedido. So dica: nao entra no faturamento.
  moeda             text not null check (moeda ~ '^[A-Z]{3}$'),
  valor             numeric(14,2) not null default 0 check (valor >= 0 and valor <= 100000),
  -- A comissao LIQUIDA do afiliado: e a receita no Dashboard.
  receita           numeric(14,2) not null default 0 check (receita >= 0 and receita <= 100000),
  -- null = a moeda_receita do checkout (a Sphere nao diz qual e).
  moeda_receita     text check (moeda_receita is null or moeda_receita ~ '^[A-Z]{3}$'),
  criado_em         timestamptz not null,
  -- Dia do pedido no fuso do checkout: o periodo do Dashboard le por ele.
  dia_local         date not null,
  aprovado_em       timestamptz,
  pago_em           timestamptz,
  perdido_em        timestamptz,
  -- data_evento do ultimo evento aplicado: evento mais velho nao regride.
  atualizado_em     timestamptz not null,
  -- Trava otimista: dois eventos do mesmo pedido ao mesmo tempo nao se perdem.
  versao            integer not null default 0,
  recebido_em       timestamptz not null default now(),
  primary key (checkout_id, pedido_id),
  constraint pedidos_externos_checkout_fk
    foreign key (checkout_id, user_id)
    references public.checkouts_externos (id, user_id) on delete cascade
);

create index if not exists pedidos_externos_dia_idx
  on public.pedidos_externos (checkout_id, dia_local);
create index if not exists pedidos_externos_user_idx
  on public.pedidos_externos (user_id, dia_local);


-- ---------------------------------------------------------------------------
-- 4. Os eventos recebidos: trava de idempotencia e o log da tela
-- ---------------------------------------------------------------------------
--
-- O insert E a trava (como shopify_webhook_events): a mesma movimentacao do
-- mesmo pedido entra uma vez so, mesmo com a retentativa da plataforma.
create table if not exists public.checkout_externo_eventos (
  checkout_id   uuid not null,
  user_id       uuid not null,
  pedido_id     text not null check (length(pedido_id) between 1 and 64),
  evento        text not null check (length(evento) between 1 and 40),
  data_evento   timestamptz,
  recebido_em   timestamptz not null default now(),
  primary key (checkout_id, pedido_id, evento),
  constraint checkout_externo_eventos_checkout_fk
    foreign key (checkout_id, user_id)
    references public.checkouts_externos (id, user_id) on delete cascade
);

create index if not exists checkout_externo_eventos_recentes_idx
  on public.checkout_externo_eventos (checkout_id, recebido_em desc);


-- ---------------------------------------------------------------------------
-- 5. Gasto de anuncio ligado ao checkout
-- ---------------------------------------------------------------------------
--
-- A conta liga a UMA loja OU a UM checkout. A FK composta confere o dono
-- mesmo para o service role; apagar o checkout so solta a conta (o gasto
-- continua gravado, fora do lucro ate ela ser ligada de novo).
alter table public.ad_accounts
  add column if not exists checkout_id uuid;

alter table public.ad_accounts drop constraint if exists ad_accounts_checkout_fk;
alter table public.ad_accounts
  add constraint ad_accounts_checkout_fk
  foreign key (checkout_id, user_id)
  references public.checkouts_externos (id, user_id)
  on delete set null (checkout_id);

alter table public.ad_accounts drop constraint if exists ad_accounts_loja_ou_checkout;
alter table public.ad_accounts
  add constraint ad_accounts_loja_ou_checkout
  check (store_id is null or checkout_id is null);

create index if not exists ad_accounts_checkout_idx
  on public.ad_accounts (checkout_id)
  where checkout_id is not null;

-- A policy da 052, agora conferindo tambem o checkout na linha nova.
drop policy if exists "Dono le ad_accounts" on public.ad_accounts;
create policy "Dono le ad_accounts" on public.ad_accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (store_id is null
         or exists (select 1 from public.stores s
                     where s.id = ad_accounts.store_id
                       and s.user_id = (select auth.uid())))
    and (checkout_id is null
         or exists (select 1 from public.checkouts_externos c
                     where c.id = ad_accounts.checkout_id
                       and c.user_id = (select auth.uid()))));


-- ---------------------------------------------------------------------------
-- 6. RLS, policies e grants
-- ---------------------------------------------------------------------------
alter table public.checkouts_externos enable row level security;
drop policy if exists "Dono le checkouts_externos" on public.checkouts_externos;
create policy "Dono le checkouts_externos" on public.checkouts_externos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.pedidos_externos enable row level security;
drop policy if exists "Dono le pedidos_externos" on public.pedidos_externos;
create policy "Dono le pedidos_externos" on public.pedidos_externos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.checkouts_externos c
                 where c.id = pedidos_externos.checkout_id
                   and c.user_id = (select auth.uid())));

alter table public.checkout_externo_eventos enable row level security;
drop policy if exists "Dono le checkout_externo_eventos" on public.checkout_externo_eventos;
create policy "Dono le checkout_externo_eventos" on public.checkout_externo_eventos
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.checkouts_externos c
                 where c.id = checkout_externo_eventos.checkout_id
                   and c.user_id = (select auth.uid())));

alter table public.checkout_externo_contas enable row level security;
drop policy if exists "Dono le checkout_externo_contas" on public.checkout_externo_contas;
create policy "Dono le checkout_externo_contas" on public.checkout_externo_contas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.checkouts_externos c
                 where c.id = checkout_externo_contas.checkout_id
                   and c.user_id = (select auth.uid())));

-- Segredo: RLS ligada e ZERO policy = ninguem entra pelo Data API. E os dois
-- caminhos de privilegio fechados (o grant a PUBLIC e o do default privileges).
alter table public.checkout_externo_segredos enable row level security;
revoke all on table public.checkout_externo_segredos from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_externo_segredos to service_role;

-- Escrita so pelo servidor (service_role); o lojista so le.
revoke insert, update, delete on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_eventos,
  public.checkout_externo_contas
  from public, anon, authenticated;
revoke select on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_eventos,
  public.checkout_externo_contas
  from public, anon;
grant select on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_eventos,
  public.checkout_externo_contas
  to authenticated;
grant select, insert, update, delete on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_eventos,
  public.checkout_externo_contas
  to service_role;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada):
--   select has_table_privilege('authenticated', 'public.checkout_externo_segredos', 'select');   -- false
--   select has_table_privilege('anon', 'public.checkout_externo_segredos', 'select');            -- false
--   select has_table_privilege('service_role', 'public.checkout_externo_segredos', 'select');    -- true
--   select has_table_privilege('authenticated', 'public.checkouts_externos', 'select');          -- true
--   select has_table_privilege('authenticated', 'public.checkouts_externos', 'insert');          -- false
--   select has_table_privilege('authenticated', 'public.checkouts_externos', 'update');          -- false
--   select has_table_privilege('authenticated', 'public.pedidos_externos', 'insert');            -- false
--   select has_table_privilege('authenticated', 'public.checkout_externo_eventos', 'delete');    -- false
--   select has_table_privilege('anon', 'public.pedidos_externos', 'select');                     -- false
--   select has_table_privilege('authenticated', 'public.checkout_externo_contas', 'select');     -- true
--   select has_table_privilege('authenticated', 'public.checkout_externo_contas', 'insert');     -- false
--   select count(*) from pg_policies where tablename = 'checkout_externo_segredos';             -- 0
--   select relrowsecurity from pg_class where relname = 'checkout_externo_segredos';            -- true
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'ad_accounts' and column_name = 'checkout_id'; -- 1
--   select conname from pg_constraint
--    where conname in ('ad_accounts_checkout_fk', 'ad_accounts_loja_ou_checkout');             -- 2 linhas
