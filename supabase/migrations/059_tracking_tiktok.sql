-- ============================================================================
-- 059 -- TikTok Ads como destino de rastreamento (Events API pelo servidor).
--
-- O TikTok entra do mesmo jeito que o Meta: uma linha em
-- tracking_destinations (conta = Pixel Code), o Access Token em
-- tracking_destination_secrets (a mesma tabela e a mesma protecao do token do
-- Meta: RLS ligado, ZERO policy, revogada de anon/authenticated na 048 -- so o
-- service_role le), e as linhas da fila com destination = 'tiktok'.
--
-- SO ADITIVA. Nada que ja existe muda de valor:
--
--   1. os dois CHECK de plataforma passam a aceitar 'tiktok'. Sem o da fila,
--      enfileirar lanca 23514, o coletor responde "falha interna" e o webhook
--      devolve 503 -- a Shopify reentregaria a compra em laco;
--   2. tracking_identities ganha `ttp` (o cookie _ttp do pixel do TikTok). O
--      `ttclid` ja existia desde a 035, so ninguem gravava;
--   3. a regra de teste, o painel e o feed (055/058) aprendem a ler o clique do
--      TikTok no payload: `payload.user.ttclid`. Sem isso o painel contaria
--      toda linha do TikTok como "de anuncio" (o else da 051 olha o aviso) e o
--      feed mostraria o clique como "—".
--
-- APLICAR ANTES DO DEPLOY. Antes dela o app novo nao quebra nada do Meta (a
-- leitura de identidade e por `*`, e a escrita que falha pelo `ttp` e refeita
-- sem ele), mas o cadastro do TikTok e recusado pelo CHECK.
--
-- As funcoes: mesmo nome, mesmos argumentos, mesmas colunas de retorno na
-- mesma ordem -- `create or replace` serve, sem DROP, e o app no ar continua
-- chamando sem perceber a troca. Painel e feed seguem SECURITY INVOKER (a
-- policy de tracking_events vale la dentro); a regra de teste segue pura. Os
-- grants sao os da 055, repetidos para a migration valer sozinha.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Plataforma 'tiktok'
-- ---------------------------------------------------------------------------
-- O CHECK inline da 043 nasceu com o nome padrao do Postgres.
alter table public.tracking_destinations
  drop constraint if exists tracking_destinations_plataforma_check;
alter table public.tracking_destinations
  add constraint tracking_destinations_plataforma_check
  check (plataforma in ('google', 'meta', 'tiktok'));

-- A lista da 038, mais 'tiktok'. Nenhuma linha atual fica de fora.
-- tracking_events e a tabela quente (coletor, webhook, drain): o CHECK nasce
-- NOT VALID, sem varrer a tabela sob ACCESS EXCLUSIVE, e o VALIDATE depois so
-- pega SHARE UPDATE EXCLUSIVE -- as escritas seguem. Drop e add na mesma
-- transacao: se o add falhar, a tabela nao fica sem CHECK.
begin;
alter table public.tracking_events
  drop constraint if exists tracking_events_destination_check;
alter table public.tracking_events
  add constraint tracking_events_destination_check
  check (destination in ('meta', 'google', 'ga4', 'tiktok')) not valid;
commit;
alter table public.tracking_events
  validate constraint tracking_events_destination_check;


-- ---------------------------------------------------------------------------
-- 2. O cookie _ttp na identidade do visitante
-- ---------------------------------------------------------------------------
-- O mesmo papel do `fbp`: o id de navegador que o pixel do TikTok grava. O
-- checkout (Web Pixel, que nao le cookie da loja) e a compra sem cart attribute
-- recuperam por aqui, como recuperam o _fbp.
alter table public.tracking_identities
  add column if not exists ttp text;

comment on column public.tracking_identities.ttp is
  'Cookie _ttp do pixel do TikTok, em claro (a Events API recebe sem hash, em user.ttp).';


-- ---------------------------------------------------------------------------
-- 3a. A regra de teste (055) com o clique do TikTok
-- ---------------------------------------------------------------------------
create or replace function public.tracking_evento_teste(
  p_destination text,
  p_payload     jsonb
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    (p_payload ->> 'teste') in ('true', '1')
    or nullif(p_payload ->> 'test_event_code', '') is not null
    or case p_destination
         when 'meta' then
           (p_payload -> 'user_data' ->> 'fbc') like '%TEST%'
         when 'google' then
           concat_ws(' ',
             p_payload ->> 'gclid',
             p_payload ->> 'gbraid',
             p_payload ->> 'wbraid') like '%TEST%'
         when 'tiktok' then
           (p_payload -> 'user' ->> 'ttclid') like '%TEST%'
         else false
       end,
    false
  );
$$;

comment on function public.tracking_evento_teste(text, jsonb) is
  'O evento da fila e teste? payload.teste, test_event_code ou click id com TEST (fbc no Meta, gclid/gbraid/wbraid no Google, ttclid no TikTok). Regra unica do painel e do feed.';

revoke all on function public.tracking_evento_teste(text, jsonb) from public, anon;
grant execute on function public.tracking_evento_teste(text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3b. O painel (058) com o clique do TikTok
-- ---------------------------------------------------------------------------
-- Identica a 058, mais o ramo 'tiktok' de com_clique.
create or replace function public.tracking_painel_v2(
  p_store_ids uuid[],
  p_desde     timestamptz
)
returns table (
  store_id         uuid,
  destination_id   uuid,
  destination      text,
  event_key        text,
  status           text,
  n                integer,
  n_sem_atribuicao integer,
  ultimo_envio     timestamptz,
  ultimo_erro      text,
  ultimo_erro_em   timestamptz,
  order_ids        text[],
  n_teste          integer,
  n_de_anuncio     integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.store_id,
    e.destination_id,
    e.destination,
    -- A compra foi gravada como "Purchase" (nome do Meta, mantido no TikTok);
    -- o resto em minusculo.
    lower(e.event_name) as event_key,
    e.status,
    count(*)::integer as n,
    (count(*) filter (where not c.com_clique))::integer as n_sem_atribuicao,
    max(e.sent_at) as ultimo_envio,
    -- O erro MAIS RECENTE, nao um qualquer: depois de trocar o token, o erro
    -- velho na tela mandaria o lojista consertar o que ja foi consertado.
    (array_agg(e.last_error order by e.created_at desc)
       filter (where e.status = 'falhou' and e.last_error is not null))[1]
      as ultimo_erro,
    max(e.created_at) filter (where e.status = 'falhou' and e.last_error is not null)
      as ultimo_erro_em,
    -- O webhook grava String(pedido.id ?? ""): vazio nao e pedido.
    coalesce(
      array_agg(distinct e.order_id)
        filter (where lower(e.event_name) = 'purchase'
                  and nullif(e.order_id, '') is not null),
      '{}'::text[]
    ) as order_ids,
    (count(*) filter (where c.teste))::integer as n_teste,
    (count(*) filter (where c.com_clique and not c.teste and c.saiu))::integer as n_de_anuncio
  from public.tracking_events e
  cross join lateral (
    select
      -- O click id e lido do PAYLOAD, o que foi de fato para a plataforma
      -- (051). No TikTok, user.ttclid (059). Outro destino continua pelo
      -- aviso, como na 051.
      case e.destination
        when 'meta' then
          nullif(e.payload -> 'user_data' ->> 'fbc', '') is not null
        when 'google' then
          coalesce(
            nullif(e.payload ->> 'gclid', ''),
            nullif(e.payload ->> 'gbraid', ''),
            nullif(e.payload ->> 'wbraid', '')
          ) is not null
        when 'tiktok' then
          nullif(e.payload -> 'user' ->> 'ttclid', '') is not null
        else
          not coalesce(e.last_error like '%sem atribuicao%', false)
      end as com_clique,
      public.tracking_evento_teste(e.destination, e.payload) as teste,
      -- Saiu e valeu PARA ESTA CONTA. Fica fora do "de anuncio":
      --   - 'enviado' sem sent_at: fechado sem envio (teste);
      --   - Google pela Data Manager (054) com diagnostico dizendo que o
      --     clique e de outra conta da loja, ou descartado por consentimento.
      -- Status 'falhou' ja fica fora pelo agrupamento (vai para as falhas).
      (e.status <> 'enviado' or e.sent_at is not null)
        and coalesce(e.response -> 'dm' ->> 'situacao', '')
              not in ('nao_e_desta_conta', 'sem_consentimento') as saiu
  ) c
  where e.store_id = any (p_store_ids)
    and e.created_at >= p_desde
    -- O cancelado (058): 'enviado' sem sent_at e sem marca de teste. Nao saiu e
    -- nao e teste -- fora de toda contagem.
    and not (e.status = 'enviado' and e.sent_at is null and not c.teste)
  group by e.store_id, e.destination_id, e.destination, lower(e.event_name), e.status;
$$;

comment on function public.tracking_painel_v2(uuid[], timestamptz) is
  'Contagem da fila de rastreamento por (loja, destino, evento, status), com testes e "de anuncio" separados (clique: fbc no Meta, gclid/gbraid/wbraid no Google, ttclid no TikTok); o fechado sem sair que nao e teste (expresso cancelado) fica fora. INVOKER: a RLS de tracking_events limita ao dono.';

revoke all on function public.tracking_painel_v2(uuid[], timestamptz) from public, anon;
grant execute on function public.tracking_painel_v2(uuid[], timestamptz) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3c. O feed (055) com o clique e a URL do TikTok
-- ---------------------------------------------------------------------------
-- Identico a 055, mais o ramo 'tiktok' de com_clique e a URL do evento do
-- TikTok (payload.page.url) na leitura da utm.
create or replace function public.tracking_feed_v2(
  p_store_ids uuid[],
  p_antes     timestamptz default null,
  p_limite    integer default 100
)
returns table (
  id            uuid,
  store_id      uuid,
  criado_em     timestamptz,
  enviado_em    timestamptz,
  latencia_s    numeric,
  evento        text,
  fonte         text,
  plataforma    text,
  destino_id    uuid,
  destino_nome  text,
  status        text,
  tentativas    integer,
  erro          text,
  com_clique    boolean,
  origem_host   text,
  utm_source    text,
  utm_campaign  text,
  pedido        text,
  teste         boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.store_id,
    e.created_at,
    e.sent_at,
    round(extract(epoch from (e.sent_at - e.created_at))::numeric, 1),
    lower(e.event_name),
    case
      when lower(e.event_name) = 'purchase' then 'webhook'
      when e.checkout_token is not null then 'pixel'
      else 'tema'
    end,
    e.destination,
    e.destination_id,
    d.nome,
    e.status,
    e.attempts,
    left(e.last_error, 300),
    case e.destination
      when 'meta' then nullif(e.payload -> 'user_data' ->> 'fbc', '') is not null
      when 'google' then coalesce(
        nullif(e.payload ->> 'gclid', ''),
        nullif(e.payload ->> 'gbraid', ''),
        nullif(e.payload ->> 'wbraid', '')
      ) is not null
      when 'tiktok' then nullif(e.payload -> 'user' ->> 'ttclid', '') is not null
      else null
    end,
    substring(e.referrer from '^https?://([^/:?#]+)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl',
                       e.payload -> 'page' ->> 'url')
              from '[?&]utm_source=([^&#]*)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl',
                       e.payload -> 'page' ->> 'url')
              from '[?&]utm_campaign=([^&#]*)'),
    case when lower(e.event_name) = 'purchase' then nullif(e.order_id, '') end,
    public.tracking_evento_teste(e.destination, e.payload)
  from public.tracking_events e
  left join public.tracking_destinations d on d.id = e.destination_id
  where e.store_id = any (p_store_ids)
    and e.created_at < coalesce(p_antes, now() + interval '1 minute')
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limite, 100), 1), 200);
$$;

comment on function public.tracking_feed_v2(uuid[], timestamptz, integer) is
  'Ultimos eventos da fila de rastreamento, sem payload, com a marca de teste (Meta, Google e TikTok). INVOKER: a RLS de tracking_events limita ao dono.';

revoke all on function public.tracking_feed_v2(uuid[], timestamptz, integer) from public, anon;
grant execute on function public.tracking_feed_v2(uuid[], timestamptz, integer) to authenticated, service_role;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada).
-- As tres primeiras devem dar false; as tres seguintes, true; as duas ultimas,
-- false (INVOKER, como na 055).
--   select has_function_privilege('anon', 'public.tracking_evento_teste(text, jsonb)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_feed_v2(uuid[], timestamptz, integer)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_evento_teste(text, jsonb)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_feed_v2(uuid[], timestamptz, integer)', 'execute');
--   select prosecdef from pg_proc where oid = 'public.tracking_painel_v2(uuid[], timestamptz)'::regprocedure;
--   select prosecdef from pg_proc where oid = 'public.tracking_feed_v2(uuid[], timestamptz, integer)'::regprocedure;
--
-- Os CHECK e a coluna:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('tracking_destinations_plataforma_check', 'tracking_events_destination_check');
--   select column_name from information_schema.columns
--    where table_name = 'tracking_identities' and column_name = 'ttp';
--
-- A regra, sem tocar em dado:
--   select public.tracking_evento_teste('tiktok', '{"user":{"ttclid":"TESTE_TT"}}');  -- true
--   select public.tracking_evento_teste('tiktok', '{"user":{"ttclid":"E.C.P.Cx9"}}'); -- false
--   select public.tracking_evento_teste('meta', '{"user_data":{"fbc":"fb.1.1.TEST"}}'); -- true (como antes)
