-- ============================================================================
-- 079 -- Fila curta + historico enxuto de 12 meses no rastreamento.
--
-- O PROBLEMA (medido em producao em 24/10/2026, banco de 182 MB no plano free)
--
-- tracking_events era fila de envio E historico ao mesmo tempo: 93,7 MB para
-- 45.652 linhas (~2 KB por linha com os 10 indices), UMA LINHA POR DESTINO, o
-- payload inteiro do Meta/TikTok (hashes, IP, user agent, itens) guardado 90
-- dias depois de entregue. Na Softnook, 95% das linhas sao view_item. Um
-- cliente tipico passava de ~200 MB so de rastreamento.
--
-- O DESENHO
--
--   tracking_events      continua a FILA de envio. Funil (tudo que nao e
--                        Purchase) entregue sai aos 14 dias; Purchase entregue
--                        fica 90 dias (o "sem_registro" da tela Pedidos), mas
--                        aos 8 dias o payload vira o RESUMO; o que nunca saiu
--                        (falhou/pendente) fica os 30 dias de antes.
--                        O id POR CHECKOUT (`<evento>_ck_<token>`: o IC e o
--                        AddPaymentInfo do Web Pixel e o IC de garantia do
--                        webhook) fica os 90 dias da compra: e a linha dele
--                        que, pelo indice unico da fila, segura UM IC por
--                        checkout. Apagada aos 14, o comprador que volta ao
--                        mesmo checkout (e-mail de recuperacao, aba velha)
--                        mandava um 2o IC com o mesmo event_id, fora das 48 h
--                        de dedupe do Meta, e derrubava o expresso pendente
--                        junto. Sao ~260 linhas nas lojas reais (~0,4 MB).
--   tracking_historico   uma linha POR EVENTO (nao por destino), sem payload e
--                        sem dado pessoal, 12 meses: loja, dono, instante,
--                        evento, fonte, visitante (hash), campanha/conjunto/
--                        anuncio, pedido, valor/moeda da compra, destinos e
--                        quais nao receberam. ~172 B por linha (medido). O
--                        funil de VOLUME (page_view, view_item, add_to_cart:
--                        98% dos eventos) so fica aqui ate sair da fila.
--   tracking_historico_diario  o funil de volume depois disso: uma linha por
--                        loja, dia (no fuso da loja), evento, fonte e anuncio,
--                        com as contagens, 12 meses. Uma linha por view_item
--                        por 12 meses dava ~50 MB numa loja como a Softnook
--                        (~520 eventos/dia) -- mais que a meta inteira dela.
--
-- QUEM GRAVA O HISTORICO: o proprio expurgo, a partir da fila. Nao o coletor
-- nem o webhook: a fila tem SEIS escritores (coletor, webhook da compra, IC de
-- garantia, teste.ts, enriquecimento da reserva, a loja de demonstracao), e
-- copiar de cada um deixaria o proximo de fora. A fila ja e o registro de todo
-- evento, inclusive o que falhou -- e o que falhou entra no historico com o
-- destino em `nao_enviados`, nao some. Duas passadas por hora
-- (tracking_arquivar), sempre ANTES de qualquer DELETE:
--   - o que nasceu nas ultimas 48 h: o historico fica em dia (retentativa,
--     reserva cancelada e compra enriquecida mudam a linha nas primeiras horas);
--   - tudo que tem mais de 14 dias: o que este expurgo pode apagar agora.
-- A juncao e monotona: destino que recebeu nao "desrecebe", campanha gravada
-- no FUNIL nao e trocada (a identidade do visitante muda com o proximo
-- clique), e linha igual nao e regravada (sem linha morta por hora). No evento
-- com pedido (compra, IC de garantia) vale a origem do pedido
-- (fin_order_origem): o sync a troca pela jornada da Shopify 20-30 min depois
-- do pedido, e o historico a segue enquanto a compra estiver na fila.
-- A reserva CANCELADA (o expresso ou o clique comum que o begin_checkout do
-- pixel fechou: 'enviado' sem sent_at, last_error 'cancelado:') nao e evento:
-- nao entra, e sai se a passada das 48 h a gravou ainda pendente.
--
-- Depois dos DELETE da fila, tracking_compactar_funil junta o funil de volume
-- no dia: so dia inteiro com mais de 14 dias, e so quando nenhuma linha dele
-- esta mais na fila (o falhou/pendente fica 30). Ai nada mais muda nem regrava
-- o evento: cada um conta uma vez, e os visitantes distintos do dia saem exatos.
--
-- O RESUMO DO PAYLOAD (tracking_payload_resumo): so as chaves que alguem le
-- depois do envio -- Pedidos (user_data.fbc, event_source_url, teste,
-- test_event_code), Eventos ao vivo (os click ids e a URL das tres
-- plataformas) e a regra de teste (055/059). Fica DENTRO do payload, e nao em
-- coluna nova: a coluna e NOT NULL e todo leitor (painel, feed, regra de
-- teste, pedidos-banco.ts) continua lendo o mesmo caminho, sem deploy.
-- Conferido em producao (24/10, so SELECT): nas 45.747 linhas, resumo e
-- payload dao o MESMO valor em todo campo lido, e o resumo do resumo e ele.
--
-- tracking_identities NAO muda de prazo (decisao pendente do Arthur): so sai o
-- indice unico duplicado.
--
-- INDICES QUE SAEM (pg_stat_user_indexes desde 30/03/2026; pg_constraint sem
-- constraint em nenhum deles):
--   tracking_events_loja_referrer_idx       0 scans, 4,1 MB. (store_id,
--       created_at desc) where referrer is not null: o tracking_events_loja_idx
--       cobre a mesma ordem.
--   tracking_identities_visitante_idx       1,4 MB. Unico (store_id,
--       visitor_id), IGUAL ao tracking_identities_loja_visitante_key (041),
--       que fica e sustenta o upsert onConflict "store_id,visitor_id" do
--       coletor -- o ON CONFLICT infere qualquer unico com essas colunas.
--   routed_checkout_fallbacks_recentes_idx  2,2 MB. (route_config_id,
--       created_at desc), IGUAL ao routed_checkout_fallbacks_route_idx (018),
--       que fica e serve a contagem do gatilho limitar_fallbacks (029).
-- Os unicos que seguram a dedupe da fila (tracking_events_dedupe_destino_key,
-- 0 scans porque unicidade nao conta como scan, e _dedupe_sem_destino_key)
-- FICAM: o enfileirar depende do 23505 deles. As PKs tambem ficam.
--
-- ORDEM: antes OU depois do deploy -- nenhum codigo depende dela, e nenhum
-- leitor muda. O codigo no ar ja chama purge_tracking() de hora em hora (o
-- drain, nos 10 primeiros minutos), que passa a ser a versao daqui. Depois de
-- aplicar, o agente principal roda, nesta ordem e cada comando sozinho (o
-- VACUUM nao roda dentro de transacao, nem na implicita de varios comandos):
--
--   select public.purge_tracking();            -- a primeira passada, sem o
--                                               -- teto de 8 s do PostgREST
--   vacuum (full, analyze, skip_locked) public.tracking_events;
--   analyze public.tracking_historico;
--   analyze public.tracking_historico_diario;
--
-- DELETE nao devolve espaco ao disco: o autovacuum so deixa as paginas
-- reaproveitaveis para linha nova da MESMA tabela. Quem devolve e o VACUUM
-- FULL, que reescreve a tabela e os indices -- com ACCESS EXCLUSIVE durante a
-- copia (segundos para ~30 MB vivos): coletor e webhook esperam esse tempo.
-- SKIP_LOCKED porque a ESPERA pelo lock e pior que a copia: com qualquer
-- transacao aberta na tabela (o purge da hora, uma leitura do painel -- ate
-- 7,8 s medidos --, o DELETE da demonstracao, uma sessao idle in transaction)
-- o VACUUM FULL ficaria na fila do lock, e todo INSERT/UPDATE do coletor, do
-- webhook e do drain entraria na fila ATRAS dele; o PostgREST desiste em 8 s
-- (lock_timeout e statement_timeout do authenticator) e o funil desse
-- intervalo se perde (o sendBeacon nao reenvia). Sem o lock na hora, o
-- SKIP_LOCKED pula a tabela com um WARNING ("lock not available") e o tamanho
-- em (e) nao cai: rode de novo. Numa sessao de psql, `set lock_timeout = '3s'`
-- antes do VACUUM da no mesmo (o lock_timeout precisa estar na MESMA sessao).
-- Rodar de madrugada (Brasilia) e FORA dos 10 primeiros minutos da hora,
-- quando o drain chama o purge_tracking(). Os DROP INDEX devolvem o espaco na
-- hora (o arquivo do indice sai), sem VACUUM.
--
-- EFEITO MEDIDO (24/10, so SELECT): o expurgo novo apaga hoje 18.016 linhas de
-- funil entregue com mais de 14 dias (25,6 MB de tupla, todas da Softnook e da
-- AmpleStep) e resume 34 compras; nada falhou/pendente na fila. Estimativa:
-- tracking_events de 93,7 MB para ~30 MB depois do VACUUM FULL (o que sobra e
-- 85% da loja de demonstracao), -7,7 MB dos tres indices, +~4 MB do
-- historico logo depois do backfill (15.579 eventos das lojas reais). O
-- primeiro purge junta no dia os 11.491 eventos de volume de dias com mais de
-- 14 dias (42 dias-evento de loja: umas cem linhas do diario) e ficam ~4.100
-- linhas por evento.
--
-- EM REGIME (loja como a Softnook, ~520 eventos/dia, 98,4% de volume): fila
-- ~23 MB + identidades ~10,4 MB + historico ~3,5 MB = ~37 MB, dentro da meta
-- de 20-40 MB. O historico: checkout, pagamento e compra (~8 eventos/dia) por
-- evento os 12 meses, ~0,8 MB; o volume por evento so nos ~15 dias antes de
-- juntar, ~2,1 MB; o diario, ~0,4 MB/ano com as 4 linhas/dia medidas na maior
-- loja (ate ~5 MB/ano se cada visita do dia vier de um anuncio diferente). A
-- ~280 B por linha com os indices. Sem o diario, o historico por evento
-- passava de ~50 MB no mes 12 e a loja ia a ~85 MB.
--
-- A loja de demonstracao (stores.demonstracao, 074) NAO entra no historico:
-- ela grava ~7 mil eventos de funil por dia e apaga o proprio funil em 48 h --
-- arquivado, seriam ~2,6 milhoes de linhas por ano no banco free.
--
-- Funcao nova em public vira endpoint em /rest/v1/rpc/: as cinco daqui
-- revogam de public, anon e authenticated e dao EXECUTE so ao service_role
-- (migration 027). Conferir no fim do arquivo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. As tabelas
-- ---------------------------------------------------------------------------
-- Ordem das colunas pelo alinhamento: as de tamanho fixo primeiro.
create table if not exists public.tracking_historico (
  store_id      uuid not null references public.stores (id) on delete cascade,
  -- Denormalizado de stores.user_id, como em fin_order_origem: a policy fica
  -- sem join e 12 meses de linhas nao reavaliam subconsulta por linha.
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- md5 do event_id. O event_id do navegador carrega o visitor_id em claro
  -- (`view_item_<visitante>_<ms>`) e o do pixel, o token do checkout: guardado
  -- cru, o hash do visitante nao serviria de nada. E a chave da juncao.
  chave         uuid not null,
  -- md5 do visitor_id (o _xc_vid do tema; no pixel, o clientId da Shopify).
  -- Conta visitante unico e junta o funil de uma pessoa sem guardar o cookie.
  visitante     uuid,
  -- O created_at mais antigo entre as linhas do evento (uma por destino).
  instante      timestamptz not null,
  -- Algum destino o marcou como teste (tracking_evento_teste, 055/059).
  teste         boolean not null default false,
  -- Saiu com click id para algum destino (fbc, gclid/gbraid/wbraid, ttclid).
  com_clique    boolean not null default false,
  -- lower(event_name): purchase, view_item, add_to_cart, begin_checkout...
  evento        text not null check (length(evento) between 1 and 60),
  fonte         text not null check (fonte in
                  ('webhook', 'garantia', 'pixel', 'navegador', 'ponte', 'expresso', 'reserva')),
  -- Os ids da plataforma: da origem do pedido (fin_order_origem, 071) na
  -- compra e no IC de garantia -- seguindo a origem enquanto a compra esta na
  -- fila --; da UTM do ultimo clique do visitante (tracking_identities.utm,
  -- ate 7 dias antes do evento) no funil.
  campanha_id   text check (campanha_id is null or campanha_id ~ '^[0-9]{5,25}$'),
  conjunto_id   text check (conjunto_id is null or conjunto_id ~ '^[0-9]{5,25}$'),
  anuncio_id    text check (anuncio_id is null or anuncio_id ~ '^[0-9]{5,25}$'),
  -- Id numerico do pedido da Shopify: compra, IC de garantia, reserva enriquecida.
  pedido_id     text check (pedido_id is null or pedido_id ~ '^[0-9]{1,30}$'),
  -- So na compra, como foi para a plataforma.
  valor         numeric(14, 2),
  moeda         text check (moeda is null or moeda ~ '^[A-Z]{3}$'),
  -- tracking_destinations.id de cada destino que teve linha na fila. SEM FK:
  -- apagar o destino leva as linhas da fila (cascade), mas o historico fica.
  destinos      uuid[] not null default '{}',
  -- Os destinos em que o evento NAO chegou a plataforma (falhou, pendente,
  -- teste fechado sem sair). null = chegou a todos.
  nao_enviados  uuid[],
  primary key (store_id, chave)
);

comment on table public.tracking_historico is
  'Um evento de rastreamento por linha, 12 meses, sem payload e sem dado pessoal. Gravado pelo expurgo a partir da fila (tracking_arquivar), nunca pelo cliente. O funil de volume vai para tracking_historico_diario depois de sair da fila.';

-- Relatorio: loja + periodo. A PK serve a juncao e a cascata da loja.
create index if not exists tracking_historico_loja_instante_idx
  on public.tracking_historico (store_id, instante);

alter table public.tracking_historico enable row level security;

-- O dono so LE. Sem policy de escrita: com RLS ligada nenhuma sessao grava,
-- mesmo que alguem devolva o grant um dia. Quem escreve e o expurgo.
drop policy if exists "Dono le o historico do rastreamento" on public.tracking_historico;
create policy "Dono le o historico do rastreamento" on public.tracking_historico
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.tracking_historico from public, anon, authenticated;
grant select on table public.tracking_historico to authenticated;
grant select, insert, update, delete on table public.tracking_historico to service_role;

-- O funil de VOLUME por dia. Gravado so por tracking_compactar_funil, a partir
-- das linhas do dia em tracking_historico, que saem de la na mesma instrucao.
-- Os ids de anuncio podem ser null (visita sem clique identificado): a chave
-- e NULLS NOT DISTINCT (PostgreSQL 15+; producao e 17), senao o ON CONFLICT
-- nao acharia a linha do dia sem campanha.
create table if not exists public.tracking_historico_diario (
  store_id      uuid not null references public.stores (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- No fuso da loja (fin_sync_state.fuso, o Shop.ianaTimezone; sem ele, UTC):
  -- o mesmo dia do lucro (fin_orders.dia_local).
  dia           date not null,
  eventos       integer not null,
  -- Distintos no dia, NESTA linha: somar linhas conta a pessoa mais de uma vez.
  visitantes    integer not null,
  -- Quantos sairam com click id, quantos eram teste, e quantos nao chegaram a
  -- algum destino (o nao_enviados da linha por evento).
  com_clique    integer not null,
  testes        integer not null,
  nao_enviados  integer not null,
  evento        text not null check (evento in ('page_view', 'view_item', 'add_to_cart')),
  fonte         text not null check (fonte in
                  ('webhook', 'garantia', 'pixel', 'navegador', 'ponte', 'expresso', 'reserva')),
  campanha_id   text check (campanha_id is null or campanha_id ~ '^[0-9]{5,25}$'),
  conjunto_id   text check (conjunto_id is null or conjunto_id ~ '^[0-9]{5,25}$'),
  anuncio_id    text check (anuncio_id is null or anuncio_id ~ '^[0-9]{5,25}$'),
  -- A chave natural. Comeca por (store_id, dia): serve tambem o relatorio.
  constraint tracking_historico_diario_chave
    unique nulls not distinct (store_id, dia, evento, fonte, campanha_id, conjunto_id, anuncio_id)
);

comment on table public.tracking_historico_diario is
  'O funil de volume (page_view, view_item, add_to_cart) por loja, dia, evento, fonte e anuncio, 12 meses. Gravado pelo expurgo (tracking_compactar_funil) a partir de tracking_historico, nunca pelo cliente.';

alter table public.tracking_historico_diario enable row level security;

drop policy if exists "Dono le o funil por dia do rastreamento" on public.tracking_historico_diario;
create policy "Dono le o funil por dia do rastreamento" on public.tracking_historico_diario
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.tracking_historico_diario from public, anon, authenticated;
grant select on table public.tracking_historico_diario to authenticated;
grant select, insert, update, delete on table public.tracking_historico_diario to service_role;


-- ---------------------------------------------------------------------------
-- 2. O id de anuncio de um valor de UTM
-- ---------------------------------------------------------------------------
-- O idDe() de src/lib/tracking/utm.ts: o que vem depois da ULTIMA barra
-- ("nome|id", formato da Utmify) ou o proprio valor, se for so digitos (5 a
-- 25); com "@", nada. A UTM gravada em tracking_identities ja passou pelo
-- limparValor do TS. Travado contra o TS por tests/tracking-historico.test.ts.
create or replace function public.tracking_id_de_utm(p_valor text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when p_valor !~ '@'
              then (regexp_match(p_valor, '(?:^|\|)\s*([0-9]{5,25})\s*$'))[1]
         end;
$$;

comment on function public.tracking_id_de_utm(text) is
  'O id de campanha/conjunto/anuncio de um valor de UTM (idDe de utm.ts): depois da ultima barra, ou o valor so com digitos.';

revoke all on function public.tracking_id_de_utm(text) from public, anon, authenticated;
grant execute on function public.tracking_id_de_utm(text) to service_role;


-- ---------------------------------------------------------------------------
-- 3. O resumo do payload
-- ---------------------------------------------------------------------------
-- Tudo que algum leitor le do payload depois do envio, e nada mais. A lista e
-- CAMPOS_DO_RESUMO em src/lib/tracking/retencao.ts; o teste trava as duas, e
-- trava que nenhum leitor de linha velha le chave fora dela. So string fica
-- nos tres aninhados: assim o resumo do resumo e ele mesmo (o UPDATE do
-- expurgo nao regrava a mesma linha toda hora).
create or replace function public.tracking_payload_resumo(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_strip_nulls(jsonb_build_object(
    'teste',            p_payload -> 'teste',
    'test_event_code',  p_payload -> 'test_event_code',
    'event_source_url', p_payload -> 'event_source_url',
    'pageUrl',          p_payload -> 'pageUrl',
    'gclid',            p_payload -> 'gclid',
    'gbraid',           p_payload -> 'gbraid',
    'wbraid',           p_payload -> 'wbraid',
    'user_data', case when jsonb_typeof(p_payload -> 'user_data' -> 'fbc') = 'string'
                      then jsonb_build_object('fbc', p_payload -> 'user_data' -> 'fbc') end,
    'user',      case when jsonb_typeof(p_payload -> 'user' -> 'ttclid') = 'string'
                      then jsonb_build_object('ttclid', p_payload -> 'user' -> 'ttclid') end,
    'page',      case when jsonb_typeof(p_payload -> 'page' -> 'url') = 'string'
                      then jsonb_build_object('url', p_payload -> 'page' -> 'url') end
  )), '{}'::jsonb);
$$;

comment on function public.tracking_payload_resumo(jsonb) is
  'O payload da fila so com o que Pedidos, Eventos ao vivo e a regra de teste leem depois do envio. O expurgo troca o da compra entregue aos 8 dias.';

revoke all on function public.tracking_payload_resumo(jsonb) from public, anon, authenticated;
grant execute on function public.tracking_payload_resumo(jsonb) to service_role;


-- ---------------------------------------------------------------------------
-- 4. Fila -> historico
-- ---------------------------------------------------------------------------
-- As linhas da fila com created_at em [p_desde, p_ate) viram uma linha por
-- (loja, event_id), juntada com a que ja estiver gravada. null = sem limite.
-- Devolve quantas linhas do historico nasceram, mudaram ou sairam (a reserva
-- cancelada).
--
-- INVOKER: quem chama e o purge_tracking (DEFINER, dono postgres) e a
-- migration. Nada aqui pode lancar por dado da fila -- uma excecao derruba o
-- expurgo da hora inteira --, entao todo valor que vai para coluna com CHECK
-- sai de regra fixa ou de filtro com a mesma regex do CHECK.
create or replace function public.tracking_arquivar(p_desde timestamptz, p_ate timestamptz)
returns integer
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  with lojas as (
    -- A loja de demonstracao fica de fora (ver o cabecalho).
    select s.id, s.user_id from public.stores s where not s.demonstracao
  ),
  linhas as (
    -- `= any` e nao join: usa o indice (store_id, created_at) por loja.
    select e.store_id, e.event_id, e.event_name, e.destination, e.destination_id,
           e.status, e.sent_at, e.visitor_id, e.checkout_token, e.order_id,
           e.payload, e.created_at,
           -- A reserva CANCELADA: o expresso ou o clique comum que o
           -- begin_checkout do pixel (ou do tema) fechou sem mandar --
           -- fechamentoDoExpresso do coletor. Nao e evento: contada, o
           -- checkout tinha dois IC no historico, e ela saia igual a reserva
           -- que falhou de verdade (Shop Pay com o Meta fora do ar).
           coalesce(e.status = 'enviado' and e.sent_at is null and e.last_error like 'cancelado:%'
                    and (e.event_id like 'begin_checkout_xp_%' or e.event_id like 'begin_checkout_rs_%'),
                    false) as cancelada
      from public.tracking_events e
     where e.store_id = any (array(select l.id from lojas l))
       and e.created_at >= coalesce(p_desde, '-infinity'::timestamptz)
       and e.created_at <  coalesce(p_ate, 'infinity'::timestamptz)
  ),
  -- Evento em que TODA linha e reserva cancelada: sai do historico, porque a
  -- passada das 48 h pode te-lo gravado ainda pendente (a reserva espera 2 a 5
  -- min pelo pixel).
  cancelados as (
    select l.store_id, md5(l.event_id)::uuid as chave
      from linhas l
     group by l.store_id, l.event_id
    having bool_and(l.cancelada)
  ),
  eventos as (
    -- UMA linha por evento: as linhas de cada destino tem o mesmo event_id
    -- (coletor e webhook mandam o mesmo id a todos os destinos).
    select l.store_id,
           l.event_id,
           min(l.created_at) as instante,
           coalesce(nullif(left(lower(min(l.event_name)), 60), ''), '?') as evento,
           case
             when lower(min(l.event_name)) = 'purchase' then 'webhook'
             -- Os prefixos de src/lib/tracking/eventos.ts (PREFIXOS_DE_RESERVA).
             when l.event_id like 'begin_checkout_xp_%' then 'expresso'
             when l.event_id like 'begin_checkout_rs_%' then 'reserva'
             -- O IC de garantia nasce no orders/create com o pedido em order_id;
             -- o coletor grava o proprio event_id ali.
             when lower(min(l.event_name)) = 'begin_checkout'
                  and max(l.order_id) ~ '^[0-9]{1,30}$' and max(l.order_id) <> l.event_id then 'garantia'
             -- So a ponte (xcart-bridge.js) manda page_view (eventos.ts).
             when lower(min(l.event_name)) = 'page_view' then 'ponte'
             when max(l.checkout_token) is not null then 'pixel'
             else 'navegador'
           end as fonte,
           min(l.visitor_id) as visitor_id,
           max(l.checkout_token) is not null as do_checkout,
           max(l.order_id) filter (where l.order_id ~ '^[0-9]{1,30}$' and l.order_id <> l.event_id) as pedido_id,
           coalesce(array_agg(distinct l.destination_id) filter (where l.destination_id is not null),
                    '{}'::uuid[]) as destinos,
           -- Chegou = 'enviado' COM sent_at; o 'enviado' sem sent_at fechou sem
           -- sair (teste -- 058). A reserva cancelada nem chega aqui.
           array_agg(distinct l.destination_id) filter (
             where l.destination_id is not null
               and not (l.status = 'enviado' and l.sent_at is not null)) as nao_enviados,
           coalesce(bool_or(public.tracking_evento_teste(l.destination, l.payload)), false) as teste,
           -- O clique como o painel le (059): do payload que foi para a plataforma.
           coalesce(bool_or(case l.destination
             when 'meta' then nullif(l.payload -> 'user_data' ->> 'fbc', '') is not null
             when 'google' then coalesce(nullif(l.payload ->> 'gclid', ''), nullif(l.payload ->> 'gbraid', ''),
                                         nullif(l.payload ->> 'wbraid', '')) is not null
             when 'tiktok' then nullif(l.payload -> 'user' ->> 'ttclid', '') is not null
             else false
           end), false) as com_clique,
           -- Valor e moeda so da compra: Meta (custom_data), TikTok (properties),
           -- Google antigo (raiz).
           max(coalesce(l.payload -> 'custom_data' ->> 'value', l.payload -> 'properties' ->> 'value',
                        l.payload ->> 'value'))
             filter (where lower(l.event_name) = 'purchase') as valor_txt,
           max(upper(coalesce(l.payload -> 'custom_data' ->> 'currency', l.payload -> 'properties' ->> 'currency',
                              l.payload ->> 'currency')))
             filter (where lower(l.event_name) = 'purchase') as moeda_txt
      from linhas l
     where not l.cancelada
     group by l.store_id, l.event_id
  ),
  novos as (
    select ev.store_id,
           lj.user_id,
           md5(ev.event_id)::uuid as chave,
           case when ev.visitor_id is not null then md5(ev.visitor_id)::uuid end as visitante,
           ev.instante,
           ev.teste,
           ev.com_clique,
           ev.evento,
           ev.fonte,
           -- O pedido tem origem gravada: ela manda na campanha (ver gravados).
           o.shopify_order_id is not null as com_origem,
           -- niveisDoAnuncio (utm.ts) com a plataforma do toque "identidade" de
           -- origem-pedido.ts: o `clique` da UTM, senao a fonte.
           coalesce(o.campanha_id,
                    public.tracking_id_de_utm(idt.utm ->> 'campaign'),
                    public.tracking_id_de_utm(idt.utm ->> 'id'),
                    case when idt.utm ->> 'gad' ~ '^[0-9]{5,25}$' then idt.utm ->> 'gad' end) as campanha_id,
           coalesce(o.conjunto_id,
                    public.tracking_id_de_utm(idt.utm ->> 'medium'),
                    case when idt.meta then public.tracking_id_de_utm(idt.utm ->> 'term') end) as conjunto_id,
           coalesce(o.anuncio_id, public.tracking_id_de_utm(idt.utm ->> 'content')) as anuncio_id,
           ev.pedido_id,
           case when ev.valor_txt ~ '^-?[0-9]{1,12}([.][0-9]+)?$' then round(ev.valor_txt::numeric, 2) end as valor,
           case when ev.moeda_txt ~ '^[A-Z]{3}$' then ev.moeda_txt end as moeda,
           ev.destinos,
           ev.nao_enviados
      from eventos ev
      join lojas lj on lj.id = ev.store_id
      -- Compra e IC de garantia: a origem gravada no pedido (071), que ja e a
      -- cascata inteira do TS.
      left join public.fin_order_origem o
        on ev.pedido_id is not null and o.store_id = ev.store_id and o.shopify_order_id = ev.pedido_id
      -- Funil: a UTM do ultimo clique do visitante, na janela de naJanela()
      -- (origem-pedido.ts): ate 7 dias antes e 1 dia depois do evento. O
      -- visitante do tema pelo visitor_id; o do pixel (visitor_id = clientId)
      -- pelo shopify_client_id.
      left join lateral (
        select i.utm,
               coalesce(
                 case when lower(btrim(i.utm ->> 'clique')) in ('meta', 'google', 'tiktok')
                      then lower(btrim(i.utm ->> 'clique')) = 'meta' end,
                 -- FONTES_META de utm.ts.
                 lower(btrim(i.utm ->> 'source')) in
                   ('facebook', 'fb', 'ig', 'instagram', 'meta', 'facebook_ads', 'fbads', 'an', 'msg', 'messenger'),
                 false) as meta
          from public.tracking_identities i
         where ev.pedido_id is null
           and ev.visitor_id is not null
           and i.store_id = ev.store_id
           and (i.visitor_id = ev.visitor_id or (ev.do_checkout and i.shopify_client_id = ev.visitor_id))
           and i.utm is not null
           and i.utm_em >= ev.instante - interval '7 days'
           and i.utm_em <= ev.instante + interval '1 day'
         order by i.utm_em desc
         limit 1
      ) idt on true
  ),
  gravados as (
    insert into public.tracking_historico as h
      (store_id, user_id, chave, visitante, instante, teste, com_clique, evento, fonte,
       campanha_id, conjunto_id, anuncio_id, pedido_id, valor, moeda, destinos, nao_enviados)
    select n.store_id, n.user_id, n.chave,
           coalesce(a.visitante, n.visitante),
           least(a.instante, n.instante),
           coalesce(a.teste, false) or n.teste,
           coalesce(a.com_clique, false) or n.com_clique,
           coalesce(a.evento, n.evento),
           coalesce(a.fonte, n.fonte),
           -- No evento com origem do pedido, ela vence: o sync troca a origem
           -- pela jornada da Shopify 20-30 min depois do pedido, e a passada
           -- da hora ja tinha gravado a do webhook -- a aba Campanhas le a
           -- fin_order_origem, e o historico tem que bater com ela. No funil
           -- o que ja estava gravado vence: a identidade muda com o proximo
           -- clique. Valor e moeda tambem: o payload da compra vira resumo aos
           -- 8 dias.
           case when n.com_origem then n.campanha_id else coalesce(a.campanha_id, n.campanha_id) end,
           case when n.com_origem then n.conjunto_id else coalesce(a.conjunto_id, n.conjunto_id) end,
           case when n.com_origem then n.anuncio_id else coalesce(a.anuncio_id, n.anuncio_id) end,
           coalesce(a.pedido_id, n.pedido_id),
           coalesce(a.valor, n.valor),
           coalesce(a.moeda, n.moeda),
           m.destinos,
           nullif(array(select x from unnest(m.destinos) x where x <> all (m.enviados) order by x), '{}'::uuid[])
      from novos n
      left join public.tracking_historico a on a.store_id = n.store_id and a.chave = n.chave
      -- A uniao: os destinos de antes e de agora, e quem recebeu em qualquer
      -- das duas leituras (a linha 'enviado' do funil sai aos 14 dias e a
      -- 'falhou' aos 30: a segunda leitura nao ve a primeira).
      cross join lateral (
        select array(select distinct x from unnest(coalesce(a.destinos, '{}'::uuid[]) || n.destinos) x order by x)
                 as destinos,
               array(select x from unnest(coalesce(a.destinos, '{}'::uuid[])) x
                      where x <> all (coalesce(a.nao_enviados, '{}'::uuid[])))
               || array(select x from unnest(n.destinos) x
                         where x <> all (coalesce(n.nao_enviados, '{}'::uuid[])))
                 as enviados
      ) m
    on conflict (store_id, chave) do update set
      (visitante, instante, teste, com_clique, campanha_id, conjunto_id, anuncio_id,
       pedido_id, valor, moeda, destinos, nao_enviados)
      = (excluded.visitante, excluded.instante, excluded.teste, excluded.com_clique,
         excluded.campanha_id, excluded.conjunto_id, excluded.anuncio_id, excluded.pedido_id,
         excluded.valor, excluded.moeda, excluded.destinos, excluded.nao_enviados)
    -- Igual nao regrava: a passada das 48 h le as mesmas linhas toda hora.
    where (h.visitante, h.instante, h.teste, h.com_clique, h.campanha_id, h.conjunto_id, h.anuncio_id,
           h.pedido_id, h.valor, h.moeda, h.destinos, h.nao_enviados)
          is distinct from
          (excluded.visitante, excluded.instante, excluded.teste, excluded.com_clique,
           excluded.campanha_id, excluded.conjunto_id, excluded.anuncio_id, excluded.pedido_id,
           excluded.valor, excluded.moeda, excluded.destinos, excluded.nao_enviados)
    returning 1
  ),
  -- Chaves disjuntas das de `gravados` (o evento cancelado nao chega a
  -- `eventos`): o INSERT e o DELETE nunca tocam a mesma linha.
  apagados as (
    delete from public.tracking_historico h
     using cancelados c
     where h.store_id = c.store_id and h.chave = c.chave
    returning 1
  )
  select ((select count(*) from gravados) + (select count(*) from apagados))::integer;
$$;

comment on function public.tracking_arquivar(timestamptz, timestamptz) is
  'Fila -> historico: as linhas de tracking_events com created_at em [p_desde, p_ate) viram uma linha por evento em tracking_historico, juntada com a gravada. Sem a loja de demonstracao e sem a reserva cancelada.';

revoke all on function public.tracking_arquivar(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.tracking_arquivar(timestamptz, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 5. Funil de volume -> o dia
-- ---------------------------------------------------------------------------
-- As linhas de page_view, view_item e add_to_cart de tracking_historico viram
-- uma linha por (loja, dia, evento, fonte, campanha, conjunto, anuncio) em
-- tracking_historico_diario, e saem do historico na MESMA instrucao: o DELETE
-- ... RETURNING alimenta o INSERT, entao so conta o que de fato saiu, e duas
-- chamadas ao mesmo tempo nao contam a mesma linha duas vezes. A lista e
-- EVENTOS_DO_DIARIO em src/lib/tracking/retencao.ts (travada pelo teste).
--
-- So o DIA INTEIRO, e so quando nada dele pode mais mudar:
--   - o dia (no fuso da loja) acabou antes de now() - 14 dias: o funil
--     entregue dele ja saiu da fila;
--   - nenhuma linha de volume da loja daquele dia esta na fila (o falhou/
--     pendente fica 30 dias). Enquanto houver, a passada de 14 dias do
--     tracking_arquivar ainda regrava o evento no historico -- juntado antes,
--     contaria duas vezes. A linha da fila prende o dia dela E o de 1 min
--     antes: a do segundo destino nasce milissegundos depois da do primeiro, e
--     na virada do dia cairia no dia seguinte.
-- Juntado o dia de uma vez, os visitantes distintos saem exatos. O ON
-- CONFLICT soma: so acontece se um dia ja juntado ganhar linha nova.
--
-- INVOKER, como o tracking_arquivar: quem chama e o purge_tracking, DEPOIS dos
-- DELETE da fila (e a fila vazia do dia que o libera). Nada lanca por dado:
-- os valores vem de linhas que ja passaram pelos mesmos CHECKs no historico,
-- a chave do INSERT e unica por construcao (o dono sai da loja, nao da linha),
-- e o fuso so entra se o banco o conhece (pg_timezone_names).
create or replace function public.tracking_compactar_funil()
returns integer
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  with lojas as (
    -- A loja de demonstracao nao tem historico (ver o cabecalho).
    select s.id, s.user_id,
           coalesce((select z.name from pg_catalog.pg_timezone_names z where z.name = f.fuso limit 1), 'UTC')
             as fuso
      from public.stores s
      left join public.fin_sync_state f on f.store_id = s.id
     where not s.demonstracao
  ),
  -- Os dias que a fila ainda prende. 13 dias: cobre o dia mais novo que pode
  -- ser juntado (acabou antes de now() - 14 dias) com folga.
  -- MATERIALIZED: inline, o planejador (com a estimativa de 1 linha do
  -- historico) fazia nested loop anti join e relia a fila inteira para CADA
  -- linha do historico -- o ensaio da 079 em producao passou de 90 s.
  presos as materialized (
    select distinct e.store_id, d.dia
      from public.tracking_events e
      join lojas lj on lj.id = e.store_id
     cross join lateral (values ((e.created_at at time zone lj.fuso)::date),
                                (((e.created_at - interval '1 minute') at time zone lj.fuso)::date)) d (dia)
     where e.store_id = any (array(select l.id from lojas l))
       and lower(e.event_name) in ('page_view', 'view_item', 'add_to_cart')
       and e.created_at < now() - interval '13 days'
  ),
  prontos as (
    select h.store_id, h.chave
      from public.tracking_historico h
      join lojas lj on lj.id = h.store_id
     where h.store_id = any (array(select l.id from lojas l))
       and h.evento in ('page_view', 'view_item', 'add_to_cart')
       and h.instante < now() - interval '14 days'
       and (h.instante at time zone lj.fuso)::date < ((now() - interval '14 days') at time zone lj.fuso)::date
       and not exists (select 1 from presos p
                        where p.store_id = h.store_id and p.dia = (h.instante at time zone lj.fuso)::date)
  ),
  saidos as (
    delete from public.tracking_historico h
     using prontos p
     where h.store_id = p.store_id and h.chave = p.chave
    returning h.store_id, h.instante, h.evento, h.fonte, h.campanha_id, h.conjunto_id, h.anuncio_id,
              h.visitante, h.com_clique, h.teste, h.nao_enviados
  ),
  gravados as (
    insert into public.tracking_historico_diario as d
      (store_id, user_id, dia, eventos, visitantes, com_clique, testes, nao_enviados,
       evento, fonte, campanha_id, conjunto_id, anuncio_id)
    select s.store_id, lj.user_id, (s.instante at time zone lj.fuso)::date,
           count(*)::integer,
           count(distinct s.visitante)::integer,
           (count(*) filter (where s.com_clique))::integer,
           (count(*) filter (where s.teste))::integer,
           (count(*) filter (where s.nao_enviados is not null))::integer,
           s.evento, s.fonte, s.campanha_id, s.conjunto_id, s.anuncio_id
      from saidos s
      join lojas lj on lj.id = s.store_id
     group by s.store_id, lj.user_id, (s.instante at time zone lj.fuso)::date,
              s.evento, s.fonte, s.campanha_id, s.conjunto_id, s.anuncio_id
    on conflict (store_id, dia, evento, fonte, campanha_id, conjunto_id, anuncio_id) do update set
      (eventos, visitantes, com_clique, testes, nao_enviados)
      = (d.eventos + excluded.eventos, d.visitantes + excluded.visitantes, d.com_clique + excluded.com_clique,
         d.testes + excluded.testes, d.nao_enviados + excluded.nao_enviados)
    returning 1
  )
  select count(*)::integer from gravados;
$$;

comment on function public.tracking_compactar_funil() is
  'Funil de volume (page_view, view_item, add_to_cart) do historico -> tracking_historico_diario: so dia inteiro com mais de 14 dias e sem linha na fila. Chamado pelo purge_tracking depois dos DELETE.';

revoke all on function public.tracking_compactar_funil() from public, anon, authenticated;
grant execute on function public.tracking_compactar_funil() to service_role;


-- ---------------------------------------------------------------------------
-- 6. Backfill: a fila inteira de hoje vira historico
-- ---------------------------------------------------------------------------
-- ANTES do expurgo novo existir: o payload das compras ainda esta inteiro (o
-- valor sai dele) e nada foi apagado. Idempotente: rodar de novo nao muda nada.
-- O funil de volume velho vai para o diario no primeiro purge_tracking().
select public.tracking_arquivar(null, null);
-- Estatistica da tabela nova ja com as linhas do backfill: sem ela o
-- planejador estima 1 linha e escolhe nested loop no primeiro expurgo.
analyze public.tracking_historico;


-- ---------------------------------------------------------------------------
-- 7. O expurgo novo
-- ---------------------------------------------------------------------------
-- Mesmo nome, sem argumento, sem retorno: o drain (src/app/api/jobs/tracking/
-- drain/route.ts) chama igual, de hora em hora. Os prazos sao RETENCAO em
-- src/lib/tracking/retencao.ts (travados pelo teste).
--
-- `store_id = any (todas as lojas)` nos DELETE e no UPDATE: o mesmo conjunto
-- de linhas de antes, mas pelo indice (store_id, created_at) em vez de varrer
-- a tabela.
create or replace function public.purge_tracking()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lojas uuid[] := array(select s.id from public.stores s);
begin
  -- 1. O historico ANTES de qualquer DELETE: o recente (desfecho em dia) e
  --    tudo que este expurgo pode apagar agora. Falhou aqui, a funcao inteira
  --    volta atras e nada e apagado -- o drain mostra "expurgo: falhou".
  perform public.tracking_arquivar(now() - interval '48 hours', null);
  perform public.tracking_arquivar(null, now() - interval '14 days');

  -- Identidade: o prazo de sempre (expires_at, 90 dias).
  delete from public.tracking_identities
   where expires_at < now();

  -- 2. A fila. Funil entregue: 14 dias -- menos o id POR CHECKOUT
  --    (`<evento>_ck_<token>`, idDoEventoDoCheckout de eventos.ts), que fica
  --    com a compra: o indice unico sobre ele e o que segura um IC e um
  --    AddPaymentInfo por checkout, e o IC de garantia de quem volta ao mesmo
  --    checkout dias depois.
  delete from public.tracking_events
   where store_id = any (v_lojas)
     and status = 'enviado'
     and lower(event_name) <> 'purchase'
     and position('_ck_' in event_id) = 0
     and created_at < now() - interval '14 days';

  -- Compra entregue e o id por checkout: 90 dias, o "sem_registro" da tela
  -- Pedidos.
  delete from public.tracking_events
   where store_id = any (v_lojas)
     and status = 'enviado'
     and (lower(event_name) = 'purchase' or position('_ck_' in event_id) > 0)
     and created_at < now() - interval '90 days';

  -- O que nunca saiu: 30 dias, como na 048 (o Meta recusa evento com mais de 7).
  delete from public.tracking_events
   where store_id = any (v_lojas)
     and status in ('falhou', 'pendente')
     and created_at < now() - interval '30 days';

  -- 3. Compra entregue com mais de 8 dias: payload vira o resumo. So a que ja
  --    esta no historico (o valor e a campanha saem do payload inteiro), e so
  --    a que ainda nao e resumo (o resumo do resumo e ele: sem UPDATE vazio).
  --    falhou/pendente nunca: o reenvio precisa do payload inteiro.
  update public.tracking_events e
     set payload = public.tracking_payload_resumo(e.payload)
   where e.store_id = any (v_lojas)
     and e.status = 'enviado'
     and lower(e.event_name) = 'purchase'
     and e.created_at < now() - interval '8 days'
     and e.payload is distinct from public.tracking_payload_resumo(e.payload)
     and exists (select 1 from public.tracking_historico h
                  where h.store_id = e.store_id and h.chave = md5(e.event_id)::uuid);

  -- A ponte so importa ate o pedido chegar (048).
  delete from public.tracking_checkouts
   where created_at < now() - interval '30 days';

  -- 4. O funil de volume que ja saiu da fila vira a linha do dia. DEPOIS dos
  --    DELETE: e a fila vazia do dia que o libera.
  perform public.tracking_compactar_funil();

  -- 5. O historico: 12 meses.
  delete from public.tracking_historico
   where store_id = any (v_lojas)
     and instante < now() - interval '12 months';

  delete from public.tracking_historico_diario
   where store_id = any (v_lojas)
     and dia < (now() - interval '12 months')::date;
end;
$$;

comment on function public.purge_tracking() is
  'Arquiva a fila no historico e expurga: funil entregue com mais de 14 dias (o id por checkout fica 90), compra entregue com mais de 90 (payload resumido aos 8), o que nunca saiu com mais de 30, identidade vencida, ponte de checkout com mais de 30; junta no dia o funil de volume que saiu da fila; historico com mais de 12 meses. Chamado pelo drain, uma vez por hora.';

revoke all on function public.purge_tracking() from public, anon, authenticated;
grant execute on function public.purge_tracking() to service_role;


-- ---------------------------------------------------------------------------
-- 8. Indices sem uso e duplicados
-- ---------------------------------------------------------------------------
-- No fim: DROP INDEX pega ACCESS EXCLUSIVE na tabela, e numa transacao so ele
-- seguraria o coletor durante o backfill. lock_timeout para nao enfileirar o
-- coletor atras de uma consulta longa: estourou, roda de novo (if exists).
-- Rodando comando a comando, fora de transacao, da para trocar por
-- `drop index concurrently`.
set lock_timeout = '5s';
drop index if exists public.tracking_events_loja_referrer_idx;
drop index if exists public.tracking_identities_visitante_idx;
drop index if exists public.routed_checkout_fallbacks_recentes_idx;
reset lock_timeout;


-- ============================================================================
-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada).
--
-- (a) As dez primeiras devem dar false; as cinco ultimas, true:
--   select has_function_privilege('anon', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_compactar_funil()', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_compactar_funil()', 'execute');
--   select has_function_privilege('anon', 'public.tracking_payload_resumo(jsonb)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_payload_resumo(jsonb)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_id_de_utm(text)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_id_de_utm(text)', 'execute');
--   select has_function_privilege('anon', 'public.purge_tracking()', 'execute');
--   select has_function_privilege('authenticated', 'public.purge_tracking()', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_compactar_funil()', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_payload_resumo(jsonb)', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_id_de_utm(text)', 'execute');
--   select has_function_privilege('service_role', 'public.purge_tracking()', 'execute');
--
-- (b) As tabelas: anon nada; authenticated so le (e a RLS limita ao dono).
--   select has_table_privilege('anon', 'public.tracking_historico', 'select');                  -- false
--   select has_table_privilege('authenticated', 'public.tracking_historico', 'insert');         -- false
--   select has_table_privilege('authenticated', 'public.tracking_historico', 'select');         -- true
--   select has_table_privilege('anon', 'public.tracking_historico_diario', 'select');           -- false
--   select has_table_privilege('authenticated', 'public.tracking_historico_diario', 'insert');  -- false
--   select has_table_privilege('authenticated', 'public.tracking_historico_diario', 'select');  -- true
--
-- (c) Todo evento da fila esta no historico (sem a loja de demonstracao e sem a
--     reserva cancelada, que nao e evento). Vale a qualquer hora, antes ou
--     depois do purge, para as linhas de antes do ULTIMO arquivamento -- o
--     apply da 079 ou o ultimo purge_tracking(), troque a hora. Esperado 0.
--     (Contar linhas do historico contra eventos da fila NAO confere nada: a
--     PK ja garante uma linha por chave, e o purge apaga da fila o funil que o
--     historico guarda.)
--   select count(*) from (
--     select distinct e.store_id, e.event_id
--       from public.tracking_events e join public.stores s on s.id = e.store_id
--      where not s.demonstracao
--        and e.created_at < '<hora do ultimo arquivamento>'
--        and not (e.status = 'enviado' and e.sent_at is null and e.last_error like 'cancelado:%'
--                 and (e.event_id like 'begin_checkout_xp_%' or e.event_id like 'begin_checkout_rs_%'))
--   ) f
--   where not exists (select 1 from public.tracking_historico h
--                      where h.store_id = f.store_id and h.chave = md5(f.event_id)::uuid);
--
-- (d) Os indices que sairam (nenhuma linha):
--   select indexname from pg_indexes where indexname in
--     ('tracking_events_loja_referrer_idx', 'tracking_identities_visitante_idx',
--      'routed_checkout_fallbacks_recentes_idx');
--   -- e o unico que sustenta o upsert do coletor continua:
--   select indexdef from pg_indexes where indexname = 'tracking_identities_loja_visitante_key';
--
-- (e) Depois do primeiro purge_tracking(): nada de funil entregue com mais de
--     14 dias fora o id por checkout, e nenhuma compra entregue com mais de 8
--     dias com payload inteiro:
--   select count(*) from public.tracking_events
--    where status = 'enviado' and lower(event_name) <> 'purchase' and position('_ck_' in event_id) = 0
--      and created_at < now() - interval '14 days';
--   select count(*) from public.tracking_events
--    where status = 'enviado' and lower(event_name) = 'purchase' and created_at < now() - interval '8 days'
--      and payload is distinct from public.tracking_payload_resumo(payload);
--   select pg_size_pretty(pg_total_relation_size('public.tracking_events')),
--          pg_size_pretty(pg_total_relation_size('public.tracking_historico')),
--          pg_size_pretty(pg_total_relation_size('public.tracking_historico_diario'));
--
-- (f) O funil de volume foi para o dia: nenhuma linha por evento dele com mais
--     de 32 dias (a fila o solta aos 30, e o dia junta inteiro), e o diario
--     com as ~11,5 mil de hoje:
--   select count(*) from public.tracking_historico
--    where evento in ('page_view', 'view_item', 'add_to_cart') and instante < now() - interval '32 days';
--   select evento, count(*), sum(eventos) from public.tracking_historico_diario group by 1;
-- ============================================================================
