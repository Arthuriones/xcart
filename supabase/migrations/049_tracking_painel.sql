-- ============================================================================
-- A tela de rastreamento passa a contar no banco, nao linha a linha.
--
-- A tela lia 7 dias de tracking_events e contava em TypeScript. O PostgREST
-- corta toda resposta em 1000 linhas, e quem enche a janela e o funil: uma loja
-- com trafego faz mil view_item em um dia. A consulta vinha ordenada do mais
-- novo para o mais velho, entao o corte levava justamente o que importa -- as
-- compras -- e a tela mostrava "0 compras" com vendas entrando. O alarme de
-- "pedidos x compras", que e o unico jeito de perceber que o envio quebrou
-- (o Google responde 200 mesmo ignorando), nunca podia disparar.
--
-- Agrupado, o resultado tem uma linha por (loja, destino, evento, status): o
-- tamanho deixa de depender do trafego.
--
-- SECURITY INVOKER, DE PROPOSITO
--
-- Quem chama e o lojista, com o cliente dele. Como INVOKER, a policy de
-- tracking_events ("Owners read their tracking events") vale aqui dentro: passar
-- o uuid de uma loja alheia em p_store_ids devolve zero linha, nao os numeros
-- dela. Como DEFINER, esta funcao viraria um leitor da fila de qualquer loja
-- exposto em /rest/v1/rpc/.
--
-- order_ids existe para o alarme saber QUAIS pedidos chegaram, e nao so
-- quantos: com perda parcial, "8 compras para 10 pedidos" so vira acusacao
-- quando da para dizer que os 2 que faltam nao sairam.
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
    -- O envio grava este aviso em linha ENVIADA sem click id. O TS so soma o
    -- das enviadas; aqui conta-se no grupo todo para nao esconder nada.
    (count(*) filter (where e.last_error like '%sem atribuicao%'))::integer
      as n_sem_atribuicao,
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
  'Contagem da fila de rastreamento por (loja, destino, evento, status), para a tela. INVOKER: a RLS de tracking_events limita ao dono.';

-- Funcao nova em public vira endpoint em /rest/v1/rpc/. Dois caminhos de
-- privilegio: o grant implicito a PUBLIC e o explicito que o default-privileges
-- do Supabase da a anon. Tirar um deixa o outro (ver migration 027). Conferir
-- com has_function_privilege('anon', 'public.tracking_painel(uuid[], timestamptz)', 'execute').
revoke all on function public.tracking_painel(uuid[], timestamptz) from public, anon;
grant execute on function public.tracking_painel(uuid[], timestamptz) to authenticated, service_role;
