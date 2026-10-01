-- ============================================================================
-- "Sem clique" passa a ser lido do PAYLOAD, nao do texto do aviso.
--
-- A 049 contava `last_error like '%sem atribuicao%'`: a frase que o envio grava
-- quando o evento sai sem click id. Dois defeitos, os dois medidos em producao
-- na Lash Bestie (01/10/2026):
--
-- 1. Trocar a FRASE desligava o alarme. O commit d23ed30 reescreveu o aviso do
--    Meta para "sem fbc: nao veio de clique em anuncio do Meta" -- sem a
--    substring --, e a partir dali nenhuma linha do Meta sem fbc foi contada:
--    o alarme "venda sem clique no Meta" ficou mudo justamente na plataforma
--    em que o lojista anuncia. Texto de mensagem nao e contrato.
--
-- 2. Linha anterior ao aviso nunca contava. O aviso do Meta so passou a ser
--    gravado no commit 90fef21; a compra de 29/09 sem fbc tem last_error nulo e
--    aparecia como atribuida (0 de 3 sem clique, quando era 1 de 3).
--
-- O payload e o que foi de fato para a plataforma: se ali nao ha clique, o
-- evento saiu sem clique, qualquer que seja a frase gravada ao lado.
--   meta   -> user_data.fbc
--   google -> gclid, gbraid ou wbraid
-- Outro destino continua pelo aviso, que e o que havia.
-- ============================================================================

create or replace function public.tracking_painel(
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
  order_ids        text[]
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
    -- Do payload, nao da frase do aviso: ver o cabecalho. O TS so soma o das
    -- enviadas; aqui conta-se no grupo todo para nao esconder nada.
    (count(*) filter (where
      case e.destination
        when 'meta' then
          nullif(e.payload -> 'user_data' ->> 'fbc', '') is null
        when 'google' then
          coalesce(
            nullif(e.payload ->> 'gclid', ''),
            nullif(e.payload ->> 'gbraid', ''),
            nullif(e.payload ->> 'wbraid', '')
          ) is null
        else
          coalesce(e.last_error like '%sem atribuicao%', false)
      end
    ))::integer as n_sem_atribuicao,
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
    ) as order_ids
  from public.tracking_events e
  where e.store_id = any (p_store_ids)
    and e.created_at >= p_desde
  group by e.store_id, e.destination_id, e.destination, lower(e.event_name), e.status;
$$;

comment on function public.tracking_painel(uuid[], timestamptz) is
  'Contagem da fila de rastreamento por (loja, destino, evento, status), para a tela. Sem clique = lido do payload. INVOKER: a RLS de tracking_events limita ao dono.';

-- `create or replace` preserva os grants, mas a 049 e a regra da casa pedem os
-- dois caminhos fechados explicitamente (ver migration 027). Conferir com
-- has_function_privilege('anon', 'public.tracking_painel(uuid[], timestamptz)', 'execute').
revoke all on function public.tracking_painel(uuid[], timestamptz) from public, anon;
grant execute on function public.tracking_painel(uuid[], timestamptz) to authenticated, service_role;
