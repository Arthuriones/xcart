-- ============================================================================
-- 058 -- O painel nao conta como enviado o que nao saiu: o expresso cancelado.
--
-- O begin_checkout do checkout expresso entra 'pendente' e espera o pixel
-- (057). Quando o begin_checkout do pixel (ou o clique comum, sem pixel) chega,
-- o coletor fecha a linha do expresso SEM enviar: status 'enviado', sent_at
-- null, response.enviado = false. E o mesmo "fechado sem sair" do teste, de
-- proposito -- 'pendente' o cron mandaria, 'falhou' acenderia alerta.
--
-- So que a tracking_painel_v2 (055) conta `n` por status, e essa linha caia em
-- "enviados". No tema com shadow fechado cada "Comprar agora" cria uma reserva
-- que o pixel cancela: a aba de rastreamento da loja mostrava 2 enviados ao
-- Meta por checkout, e o Meta recebeu 1. Antes, so o teste caia nesse caso, e
-- teste a tela ja separa (n_teste, "Mostrar testes").
--
-- A REGRA: linha 'enviado' sem sent_at e SEM marca de teste nao saiu e nao e
-- teste -- e o cancelado. Fica fora de todas as contagens (n, sem atribuicao,
-- teste, de anuncio). O teste fechado sem sair continua contando como antes:
-- a tela tira e devolve com "Mostrar testes". Em Eventos ao vivo (tracking_feed_v2)
-- a linha continua aparecendo, com o selo "Nao enviado".
--
-- `gravarSucesso` sempre carimba sent_at, entao 'enviado' sem sent_at nao
-- nasce por outro caminho (teste.ts, registrarSemEnviar).
--
-- SO A DEFINICAO DA FUNCAO. Mesmo nome, mesmos argumentos, mesmas colunas de
-- retorno na mesma ordem da 055: `create or replace` serve, sem DROP, e o app
-- no ar continua chamando sem perceber a troca. SECURITY INVOKER, como na 055:
-- a policy de tracking_events vale la dentro, e o uuid de uma loja alheia
-- devolve zero linha. Os grants sao os mesmos da 055, repetidos aqui para a
-- migration valer sozinha.
-- ============================================================================

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
  'Contagem da fila de rastreamento por (loja, destino, evento, status), com testes e "de anuncio" separados; o fechado sem sair que nao e teste (expresso cancelado) fica fora. INVOKER: a RLS de tracking_events limita ao dono.';

-- Os mesmos da 055. `create or replace` preserva os privilegios, mas repetir
-- deixa a migration correta sozinha.
revoke all on function public.tracking_painel_v2(uuid[], timestamptz) from public, anon;
grant execute on function public.tracking_painel_v2(uuid[], timestamptz) to authenticated, service_role;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada).
-- A primeira deve dar false; a segunda, true; a terceira, false (INVOKER).
--   select has_function_privilege('anon', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_painel_v2(uuid[], timestamptz)', 'execute');
--   select prosecdef from pg_proc where oid = 'public.tracking_painel_v2(uuid[], timestamptz)'::regprocedure;
--
-- E a regra, contando so os cancelados dos ultimos 7 dias (devem sumir do painel):
--   select count(*) from public.tracking_events
--    where status = 'enviado' and sent_at is null
--      and not public.tracking_evento_teste(destination, payload)
--      and created_at >= now() - interval '7 days';
