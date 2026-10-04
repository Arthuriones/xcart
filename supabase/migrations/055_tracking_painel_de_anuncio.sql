-- ============================================================================
-- 055 -- A tela de rastreamento separa "de anuncio" do total, e os testes.
--
-- A tela mostrava o TOTAL enviado por evento, e o lojista comparava com o
-- Gerenciador de Anuncios. Nao bate, e nao tinha como bater: o total mistura
--   - visita sem clique de anuncio (Lash Bestie, 7 dias ate 03/10/2026: 113
--     carrinhos enviados ao Meta, so 37 com clique);
--   - teste do proprio dono (Softnook: 26 dos 38 carrinhos Google com clique
--     tinham gclid TESTE_V4, TESTE-ATC-SOFT...);
--   - e, na Softnook, o mesmo evento nas 2 contas Google -- isso a tela ja
--     resolve contando por destino, nunca somando.
--
-- "De anuncio" = com click id (fbc no Meta; gclid, gbraid ou wbraid no Google)
-- e sem teste. E o que a plataforma PODE ligar a um anuncio. Ainda nao e o
-- numero dela (janela de atribuicao, data do clique), mas e o comparavel.
--
-- O QUE CONTA COMO TESTE (tracking_evento_teste, uma regra so)
--   - payload.teste = true: o coletor marca quem chegou pelo link
--     ?xcart_teste=1 (cookie _xc_teste);
--   - payload com test_event_code;
--   - click id com "TEST" (pega TESTE, TESTE_V4, TEST-...). Caixa exata de
--     proposito: click id real e aleatorio, com maiusculas e minusculas, e
--     "TEST" exato num gclid de ~90 caracteres sai uma vez em ~200 mil.
-- Pedido de teste da Shopify nem entra na fila (filtro-pedido.ts).
--
-- SO ADITIVA
--
-- tracking_painel (051) e tracking_feed (052) ficam como estao. Mudar as
-- colunas de retorno de uma funcao pede DROP, e o app no ar continua chamando
-- as duas ate o deploy novo. As versoes novas tem nome proprio (_v2): as
-- mesmas colunas, na mesma ordem, mais as novas no fim. As antigas saem numa
-- migration futura, quando nada mais chamar por elas.
--
-- SECURITY INVOKER, como as originais: a policy de tracking_events ("Owners
-- read their tracking events") vale la dentro. Passar o uuid de uma loja
-- alheia devolve zero linha. Como DEFINER, viraria leitor da fila de qualquer
-- loja exposto em /rest/v1/rpc/.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. A regra de teste
-- ---------------------------------------------------------------------------
-- Funcao, e nao trecho repetido: o painel e o feed precisam concordar. Se cada
-- um tivesse a sua copia, um dia a tela diria "3 testes fora" e o Eventos ao
-- vivo mostraria selo em 5.
--
-- Pura (so le os argumentos, nenhuma tabela). Exposta em /rest/v1/rpc/ como
-- toda funcao em public, mas nao devolve nada que quem chama ja nao tenha.
-- O EXECUTE para authenticated e necessario: o painel e o feed sao INVOKER e
-- a chamam com o privilegio do lojista.
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
         else false
       end,
    false
  );
$$;

comment on function public.tracking_evento_teste(text, jsonb) is
  'O evento da fila e teste? payload.teste, test_event_code ou click id com TEST. Regra unica do painel e do feed.';

revoke all on function public.tracking_evento_teste(text, jsonb) from public, anon;
grant execute on function public.tracking_evento_teste(text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. O painel: tracking_painel (051) + n_teste e n_de_anuncio
-- ---------------------------------------------------------------------------
-- Mesmo agrupamento, mesmas colunas: uma linha por (loja, destino, evento,
-- status). O tamanho continua sem depender do trafego.
--
--   n_sem_atribuicao  sem click id (igual a 051, testes inclusive);
--   n_teste           e teste, com ou sem clique;
--   n_de_anuncio      com click id, sem teste e que saiu para esta conta
--                     (ver `saiu` abaixo).
--
-- A tela tira o teste do total por padrao e devolve com "Mostrar testes".
-- Com os testes a vista, "de anuncio" vira n - n_sem_atribuicao.
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
    -- A compra foi gravada como "Purchase" (nome do Meta); o resto em minusculo.
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
      -- (051). Outro destino continua pelo aviso, como na 051.
      case e.destination
        when 'meta' then
          nullif(e.payload -> 'user_data' ->> 'fbc', '') is not null
        when 'google' then
          coalesce(
            nullif(e.payload ->> 'gclid', ''),
            nullif(e.payload ->> 'gbraid', ''),
            nullif(e.payload ->> 'wbraid', '')
          ) is not null
        else
          not coalesce(e.last_error like '%sem atribuicao%', false)
      end as com_clique,
      public.tracking_evento_teste(e.destination, e.payload) as teste,
      -- Saiu e valeu PARA ESTA CONTA. Fica fora do "de anuncio":
      --   - 'enviado' sem sent_at: fechado sem envio (teste, sem clique);
      --   - Google pela Data Manager (054) com diagnostico dizendo que o
      --     clique e de outra conta da loja, ou descartado por consentimento.
      -- Status 'falhou' ja fica fora pelo agrupamento (vai para as falhas).
      (e.status <> 'enviado' or e.sent_at is not null)
        and coalesce(e.response -> 'dm' ->> 'situacao', '')
              not in ('nao_e_desta_conta', 'sem_consentimento') as saiu
  ) c
  where e.store_id = any (p_store_ids)
    and e.created_at >= p_desde
  group by e.store_id, e.destination_id, e.destination, lower(e.event_name), e.status;
$$;

comment on function public.tracking_painel_v2(uuid[], timestamptz) is
  'Contagem da fila de rastreamento por (loja, destino, evento, status), com testes e "de anuncio" separados. INVOKER: a RLS de tracking_events limita ao dono.';

revoke all on function public.tracking_painel_v2(uuid[], timestamptz) from public, anon;
grant execute on function public.tracking_painel_v2(uuid[], timestamptz) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. O feed: tracking_feed (052) + teste
-- ---------------------------------------------------------------------------
-- Em Eventos ao vivo o teste NAO some: e la que o dono confere o proprio
-- teste. Ele aparece com o selo "teste". Esconder vale so para as contagens.
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
      else null
    end,
    substring(e.referrer from '^https?://([^/:?#]+)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl')
              from '[?&]utm_source=([^&#]*)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl')
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
  'Ultimos eventos da fila de rastreamento, sem payload, com a marca de teste. INVOKER: a RLS de tracking_events limita ao dono.';

revoke all on function public.tracking_feed_v2(uuid[], timestamptz, integer) from public, anon;
grant execute on function public.tracking_feed_v2(uuid[], timestamptz, integer) to authenticated, service_role;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada).
-- As tres primeiras devem dar false; as tres ultimas, true.
--   select has_function_privilege('anon', 'public.tracking_evento_teste(text, jsonb)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_feed_v2(uuid[], timestamptz, integer)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_evento_teste(text, jsonb)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_feed_v2(uuid[], timestamptz, integer)', 'execute');
--
-- E a regra, sem tocar em dado:
--   select public.tracking_evento_teste('google', '{"gclid":"TESTE_V4"}');          -- true
--   select public.tracking_evento_teste('google', '{"gclid":"Cj0KCQjw"}');          -- false
--   select public.tracking_evento_teste('meta', '{"user_data":{"fbc":"fb.1.1.TEST"}}'); -- true
--   select public.tracking_evento_teste('meta', '{"teste":true}');                   -- true
