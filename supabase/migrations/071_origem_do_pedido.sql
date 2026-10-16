-- ============================================================================
-- 071 -- Campanha, conjunto e anuncio em cada pedido.
--
-- E a base do lucro por anuncio, e o passado nao se recupera: cada dia sem
-- gravar e dado perdido. Ate aqui o xcart so lia utm_source e utm_campaign da
-- URL do Purchase na hora de montar a tela -- e a URL do Purchase e o
-- landing_site, que a Shopify corta em 255 caracteres: com o fbclid do Meta
-- na frente, a campanha sobreviveu em 0 de 23 pedidos medidos. Loja sem
-- pixel do Meta nem isso tinha ("Sem dado").
--
-- Agora o pedido guarda a origem quando chega (webhook orders/create) e o
-- sync de pedidos completa com a jornada da Shopify (customerJourneySummary).
-- Regras em src/lib/tracking/origem-pedido.ts e src/lib/tracking/utm.ts.
--
-- 1. fin_order_origem: uma linha por pedido, chave (store_id,
--    shopify_order_id), SEM chave estrangeira para fin_orders -- o webhook
--    grava antes de o sync criar o pedido la, e o upsert inteiro do sync
--    apagaria colunas que o webhook gravou se elas morassem em fin_orders.
-- 2. tracking_identities.utm / utm_em: as UTMs do ultimo clique do visitante
--    e a hora dele. E o que acha a campanha do pedido que chega sem atributo e
--    sem jornada (app de COD, "Comprar agora"), pela mesma cascata do Purchase.
-- 3. fin_sync_state.origem_backfill_em / origem_backfill_ate: a passada unica
--    que recupera a origem dos pedidos dos ultimos 60 dias (jornada e
--    atributos), do mais novo para o mais velho.
--
-- SEM DADO PESSOAL: so UTMs (sem "@": o codigo descarta, o banco confere),
-- ids e o CAMINHO da pagina de entrada, sem query. Nunca endereco, e-mail,
-- telefone ou IP -- a nota do pedido do Releasit traz tudo isso, e dela so se
-- le uma lista fechada de chaves.
--
-- SO ACRESCENTA. O codigo funciona com e sem esta migration: sem a tabela
-- (42P01/PGRST205) nao grava nem le a origem e a tela cai no Purchase, como
-- antes; sem as colunas da identidade, grava a identidade sem elas. Ordem com
-- o deploy: qualquer uma.
--
-- PERMISSOES: as de fin_orders (052). O lojista LE pela RLS; quem escreve e
-- so o service_role (webhook e cron). As colunas novas de tracking_identities
-- e fin_sync_state herdam os grants da tabela.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. A origem do pedido
-- ---------------------------------------------------------------------------
create table if not exists public.fin_order_origem (
  store_id          uuid not null references public.stores (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- Id numerico da Shopify, como em fin_orders.
  shopify_order_id  text not null,
  -- createdAt do pedido: e por ele que a tela le o periodo.
  pedido_em         timestamptz not null,
  -- De onde veio: jornada da Shopify, URL de chegada (landing_site),
  -- atributo do pedido (_xc_utm_* do carrinho ou utm_* de app) ou a
  -- identidade do visitante.
  fonte             text not null check (fonte in ('jornada', 'landing', 'atributo', 'identidade')),
  -- O toque e da sessao que virou o pedido (ultima visita, URL de chegada).
  sessao            boolean not null default false,
  -- null = visita sem anuncio (Direto).
  plataforma        text check (plataforma is null or plataforma in ('meta', 'google', 'tiktok', 'outra')),
  -- Click id visto em qualquer fonte.
  clique            text check (clique is null or clique in ('meta', 'google', 'tiktok')),
  -- Brutos, como vieram (formato "nome|id" da Utmify incluido).
  utm_source        text check (utm_source is null or length(utm_source) <= 200),
  utm_medium        text check (utm_medium is null or length(utm_medium) <= 200),
  utm_campaign      text check (utm_campaign is null or length(utm_campaign) <= 200),
  utm_content       text check (utm_content is null or length(utm_content) <= 200),
  utm_term          text check (utm_term is null or length(utm_term) <= 200),
  -- Os ids da plataforma. Os NOMES vem do sync de gasto: renomear o anuncio
  -- nao divide o relatorio.
  campanha_id       text check (campanha_id is null or campanha_id ~ '^[0-9]{5,25}$'),
  conjunto_id       text check (conjunto_id is null or conjunto_id ~ '^[0-9]{5,25}$'),
  anuncio_id        text check (anuncio_id is null or anuncio_id ~ '^[0-9]{5,25}$'),
  -- utm_term quando nao e o conjunto: posicionamento ou palavra-chave.
  posicionamento    text check (posicionamento is null or length(posicionamento) <= 200),
  -- Hora do clique (cookie, identidade) ou da visita (jornada).
  toque_em          timestamptz,
  -- So o caminho: /products/x. Checkout e status viram "/checkouts", "/orders".
  pagina_entrada    text check (pagina_entrada is null
                                or (length(pagina_entrada) <= 200 and pagina_entrada ~ '^/')),
  atualizado_em     timestamptz not null default now(),
  primary key (store_id, shopify_order_id),
  -- Nenhum e-mail em lugar nenhum.
  constraint fin_order_origem_sem_email check (
    (coalesce(utm_source, '') || coalesce(utm_medium, '') || coalesce(utm_campaign, '') ||
     coalesce(utm_content, '') || coalesce(utm_term, '') || coalesce(posicionamento, '') ||
     coalesce(pagina_entrada, '')) !~ '@'
  )
);

comment on table public.fin_order_origem is
  'Campanha, conjunto e anuncio de cada pedido (UTMs e ids), sem dado pessoal. Gravada pelo webhook orders/create e completada pelo cron /api/jobs/financeiro/pedidos.';

-- A tela le por loja e periodo.
create index if not exists fin_order_origem_loja_pedido_idx
  on public.fin_order_origem (store_id, pedido_em);
create index if not exists fin_order_origem_user_idx
  on public.fin_order_origem (user_id);
-- A base do lucro por campanha (ainda nao construido).
create index if not exists fin_order_origem_campanha_idx
  on public.fin_order_origem (store_id, campanha_id)
  where campanha_id is not null;

drop trigger if exists fin_order_origem_dono on public.fin_order_origem;
create trigger fin_order_origem_dono
  before insert or update on public.fin_order_origem
  for each row execute function public.tracking_config_dono();

-- O dono so LE. Sem policy de escrita: com RLS ligada, nenhuma sessao grava,
-- mesmo que alguem devolva o grant um dia.
alter table public.fin_order_origem enable row level security;
drop policy if exists "Dono le fin_order_origem" on public.fin_order_origem;
create policy "Dono le fin_order_origem" on public.fin_order_origem
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on table public.fin_order_origem from public, anon, authenticated;
revoke select on table public.fin_order_origem from public, anon;
grant select on table public.fin_order_origem to authenticated;
grant select, insert, update, delete on table public.fin_order_origem to service_role;


-- ---------------------------------------------------------------------------
-- 2. As UTMs do clique na identidade do visitante
-- ---------------------------------------------------------------------------
alter table public.tracking_identities
  -- {source, medium, campaign, content, term, id}: so as chaves conhecidas,
  -- cada valor ate 200 caracteres e sem "@" (src/lib/tracking/utm.ts).
  add column if not exists utm    jsonb check (utm is null
                                               or (jsonb_typeof(utm) = 'object' and length(utm::text) <= 2000)),
  -- Hora do clique: a janela de 7 dias ate o pedido conta daqui. NAO e o
  -- updated_at, que muda a cada evento do visitante.
  add column if not exists utm_em timestamptz;


-- ---------------------------------------------------------------------------
-- 3. Recuperacao dos ultimos 60 dias
-- ---------------------------------------------------------------------------
alter table public.fin_sync_state
  -- A passada terminou: nao roda mais nesta loja.
  add column if not exists origem_backfill_em  timestamptz,
  -- Ate onde ja foi (createdAt do pedido mais velho lido): a proxima rodada
  -- continua dali.
  add column if not exists origem_backfill_ate timestamptz;


-- Conferir depois de aplicar:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fin_order_origem';                                  -- 20
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'tracking_identities'
--      and column_name in ('utm', 'utm_em');                                                              -- 2
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fin_sync_state'
--      and column_name in ('origem_backfill_em', 'origem_backfill_ate');                                  -- 2
--   select relrowsecurity from pg_class where relname = 'fin_order_origem';                               -- true
--   select count(*) from pg_policies where tablename = 'fin_order_origem';                                -- 1
--   select has_table_privilege('authenticated', 'public.fin_order_origem', 'select');                     -- true
--   select has_table_privilege('authenticated', 'public.fin_order_origem', 'insert');                     -- false
--   select has_table_privilege('authenticated', 'public.fin_order_origem', 'update');                     -- false
--   select has_table_privilege('anon', 'public.fin_order_origem', 'select');                              -- false
--   select has_table_privilege('service_role', 'public.fin_order_origem', 'insert');                      -- true
--   select has_column_privilege('authenticated', 'public.tracking_identities', 'utm', 'select');          -- false
--   select has_column_privilege('authenticated', 'public.fin_sync_state', 'origem_backfill_em', 'update'); -- false
--
-- Depois de uns dias, quantos pedidos tem origem e de qual fonte:
--   select o.fonte, o.plataforma, count(*), count(o.campanha_id) com_campanha
--     from public.fin_order_origem o
--    where o.pedido_em > now() - interval '7 days'
--    group by 1, 2 order by 3 desc;
--   select f.store_id, count(*) pedidos, count(o.shopify_order_id) com_origem
--     from public.fin_orders f
--     left join public.fin_order_origem o using (store_id, shopify_order_id)
--    where f.processado_em > now() - interval '7 days' and f.tipo = 'venda'
--    group by 1;
