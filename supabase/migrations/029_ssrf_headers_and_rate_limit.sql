-- Teto de gravacao nos eventos do loader.
--
-- /api/checkout-routes/track-fallback aceita POST sem autenticacao -- e precisa
-- mesmo: quem chama e o JavaScript na loja do comprador, que nao tem sessao
-- nossa. O token vai no HTML da vitrine, ou seja, e publico por construcao.
--
-- Sem teto, qualquer um que abra a vitrine enche a tabela num laco. Ela ja e a
-- maior do banco e alimenta a contagem que a tela de roteamento le a cada
-- carga.
--
-- O limite mora no BANCO, nao no processo: a app roda serverless, entao
-- contador em memoria nao e compartilhado entre instancias e nao limita nada.
-- A propria tabela e o estado.
--
-- 120/minuto por rota e folgado para uso real (o loader manda um loader_ready
-- por SESSAO, mais um evento por checkout) e corta o laco. Descarta em silencio
-- de proposito: o endpoint e best-effort e ja responde ok mesmo quando falha --
-- devolver erro so ensinaria o atacante a calibrar.
--
-- Comprovado: 200 INSERTs seguidos numa rota, 120 entraram.

create or replace function public.limitar_fallbacks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recentes integer;
begin
  select count(*) into recentes
  from public.routed_checkout_fallbacks
  where route_config_id = new.route_config_id
    and created_at > now() - interval '1 minute';

  if recentes >= 120 then
    return null; -- descarta a linha sem erro
  end if;

  return new;
end;
$$;

drop trigger if exists limitar_fallbacks_trg on public.routed_checkout_fallbacks;
create trigger limitar_fallbacks_trg
  before insert on public.routed_checkout_fallbacks
  for each row execute function public.limitar_fallbacks();

comment on function public.limitar_fallbacks() is
  'Teto de 120 eventos/minuto por rota. O endpoint que grava e publico por construcao.';

-- Ver a nota na 027: revogar de PUBLIC nao basta, o Supabase concede tambem
-- explicitamente a anon e authenticated em toda funcao nova de `public`.
revoke execute on function public.limitar_fallbacks() from public, anon, authenticated;

-- A contagem do trigger roda a cada INSERT: sem indice vira scan da tabela.
create index if not exists routed_checkout_fallbacks_recentes_idx
  on public.routed_checkout_fallbacks (route_config_id, created_at desc);
