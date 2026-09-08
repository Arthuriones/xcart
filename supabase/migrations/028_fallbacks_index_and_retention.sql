-- Deixa a tabela de eventos do loader parar de crescer sem teto e a consulta
-- de carrinhos roteados parar de varrer o que nao interessa.
--
-- ================================= O INDICE =================================
--
-- getRouteGraph conta "routed_ok" dos ultimos 30 dias e roda em TODA carga da
-- tela de roteamento e em /api/checkout-routes/map. O indice existente cobria
-- (route_config_id, created_at) mas nao "reason", entao o Postgres lia 102
-- linhas para ficar com 6:
--
--   antes:  Index Scan ... Rows Removed by Filter: 96   -> 91,1 ms
--   depois: Index Only Scan (parcial), sem filtro       ->  0,21 ms
--
-- 434x, com 9,6k linhas. O ganho cresce com a tabela.
--
-- ================================ A RETENCAO ================================
--
-- loader_ready e 91,8% das linhas e sai uma vez por sessao de comprador. Com
-- anuncio escalando, esta vira a maior tabela do banco.
--
-- Quem le o que:
--   loader_ready         -> so a lista de atividade da Visao Geral (limite 8)
--   routed_ok            -> contagem de carrinhos (30d) e o passo "teste"
--   cart_checkout_error  -> diagnostico de falha
--
-- Dai 30 dias para o sinal de presenca e 180 para o resto, que e o que alimenta
-- numero e diagnostico. A funcao e chamada pelo cron /api/jobs/routes/heal, que
-- ja roda de hora em hora -- uma tabela de cron a menos para configurar.

create index if not exists routed_checkout_fallbacks_routed_ok_idx
  on public.routed_checkout_fallbacks (route_config_id, created_at desc)
  where reason = 'routed_ok';

comment on index public.routed_checkout_fallbacks_routed_ok_idx is
  'Contagem de carrinhos roteados por rota (getRouteGraph). Parcial: routed_ok e ~8% da tabela.';

create or replace function public.purge_routed_checkout_fallbacks()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  apagadas integer;
begin
  with removidas as (
    delete from public.routed_checkout_fallbacks
    where (reason = 'loader_ready' and created_at < now() - interval '30 days')
       or (reason <> 'loader_ready' and created_at < now() - interval '180 days')
    returning 1
  )
  select count(*) into apagadas from removidas;
  return apagadas;
end;
$$;

comment on function public.purge_routed_checkout_fallbacks() is
  'Retencao dos eventos do loader: 30d para loader_ready, 180d para o resto. Chamada pelo cron /api/jobs/routes/heal.';

revoke execute on function public.purge_routed_checkout_fallbacks() from public;
grant execute on function public.purge_routed_checkout_fallbacks() to service_role;
