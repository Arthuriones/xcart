-- ============================================================================
-- O dono da rota e o dono das lojas da rota: agora no banco, nao so na policy.
--
-- A migration 030 poe `with check` nas policies exigindo que source_store_id e
-- target_store_id pertencam a quem esta gravando. Isso vale para o papel
-- `authenticated` e resolve o caminho normal do app.
--
-- Nao vale para o `service_role`. Ele burla RLS por definicao, e o xcart usa
-- cliente admin em varios lugares: cron de conserto, fila de importacao,
-- finalize do clone. Uma linha gravada por qualquer um desses caminhos podia
-- apontar para a loja de outra pessoa sem nada reclamar -- e o conserto
-- automatico, que roda com admin, leria o client_secret e o access_token dela
-- e escreveria produtos na loja da vitima.
--
-- Constraint nao tem papel: vale para todo mundo, inclusive service_role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. routed_checkout_configs: chave estrangeira composta (id, user_id)
-- ---------------------------------------------------------------------------

-- Alvo da FK composta. Redundante como unicidade (id ja e PK), mas o Postgres
-- exige um indice unico exatamente sobre as colunas referenciadas.
create unique index if not exists stores_id_user_id_key
  on public.stores (id, user_id);

alter table public.stores
  drop constraint if exists stores_id_user_id_unique;
alter table public.stores
  add constraint stores_id_user_id_unique unique using index stores_id_user_id_key;

alter table public.routed_checkout_configs
  drop constraint if exists routed_checkout_configs_source_store_do_dono;
alter table public.routed_checkout_configs
  add constraint routed_checkout_configs_source_store_do_dono
  foreign key (source_store_id, user_id)
  references public.stores (id, user_id)
  on delete cascade;

-- target_store_id e NOT NULL nesta tabela (conferido no banco), entao esta FK
-- e sempre checada. A rota multi-destino usa routed_checkout_targets por cima,
-- mas a coluna aqui continua apontando para o destino original.
alter table public.routed_checkout_configs
  drop constraint if exists routed_checkout_configs_target_store_do_dono;
alter table public.routed_checkout_configs
  add constraint routed_checkout_configs_target_store_do_dono
  foreign key (target_store_id, user_id)
  references public.stores (id, user_id)
  on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. routed_checkout_targets: trigger, porque nao ha user_id na tabela
-- ---------------------------------------------------------------------------
--
-- A tabela se liga ao dono por route_id. Sem coluna user_id nao da para fazer
-- FK composta, entao a checagem vai num trigger.
--
-- SECURITY INVOKER (o padrao) de proposito: sob RLS, o usuario nao enxerga a
-- loja alheia, o EXISTS da falso e o insert morre -- que e o resultado certo.
-- Sob service_role, a RLS sai da frente e a comparacao user_id a user_id
-- acontece de verdade. Os dois caminhos ficam corretos sem precisar de
-- DEFINER, que so acrescentaria superficie.

create or replace function public.checar_target_store_do_dono()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.routed_checkout_configs c
    join public.stores s on s.id = new.target_store_id
    where c.id = new.route_id
      and s.user_id = c.user_id
  ) then
    raise exception
      'target_store_id % nao pertence ao dono da rota %', new.target_store_id, new.route_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.checar_target_store_do_dono is
  'Impede destino de rodizio apontando para loja de outro usuario. Vale tambem para service_role, que burla RLS.';

-- Regra da casa: funcao nova em public vira endpoint em /rest/v1/rpc/. Esta
-- devolve trigger e o PostgREST nao a expoe, mas revogar sai de graca e o
-- default privileges do Supabase concede a anon/authenticated sem avisar.
revoke all on function public.checar_target_store_do_dono() from public, anon, authenticated;

drop trigger if exists routed_checkout_targets_dono on public.routed_checkout_targets;
create trigger routed_checkout_targets_dono
  before insert or update of target_store_id, route_id
  on public.routed_checkout_targets
  for each row
  execute function public.checar_target_store_do_dono();
