-- ============================================================================
-- Tres coisas, as tres achadas na revisao final do rastreamento.
--
-- 1. A PONTE checkout -> visitante, para a compra nao perder o clique.
-- 2. tracking_destinations sem trava de dono (buraco aberto pela 043).
-- 3. O expurgo deixava linha 'falhou'/'pendente' para sempre.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. tracking_checkouts
-- ---------------------------------------------------------------------------
--
-- Hoje a UNICA ligacao entre o clique e o pedido e o cart attribute. Quando ele
-- nao chega ao pedido -- botao "Comprar agora", Shop Pay/Apple Pay na pagina de
-- produto, carrinho recriado --, o `_xc_vid` tambem nao chega, a busca de
-- identidade nem roda, e a compra sai sem gclid para o Google e sem fbc para o
-- Meta. Medido: nas compras reais, nenhuma trazia `_xc_vid`.
--
-- A ponte e o token do checkout. O Web Pixel conhece o `checkout.token` e o
-- `clientId` da Shopify no mesmo evento; o pedido traz `checkout_token`, que a
-- documentacao da Shopify confirma ser o mesmo valor. O clientId ja esta ligado
-- aos click ids em tracking_identities, publicado pelo tema.
--
-- POR QUE TABELA PROPRIA, E NAO LER tracking_events.checkout_token
--
-- A linha em tracking_events so existe se algum destino aceitar o evento e se o
-- teto nao tiver cortado. Loja sem rotulo de begin_checkout no Google e sem Meta
-- nunca gravaria a ponte. Aqui a gravacao acontece ANTES dessas saidas.
create table if not exists public.tracking_checkouts (
  store_id          uuid not null references public.stores (id) on delete cascade,
  checkout_token    text not null,
  shopify_client_id text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (store_id, checkout_token)
);

comment on table public.tracking_checkouts is
  'Checkout -> clientId da Shopify, gravado pelo Web Pixel. E o que liga o pedido ao clique quando o cart attribute nao chega.';

-- So o service_role. Nao ha leitura pela tela, e RLS sem policy fecha tudo.
alter table public.tracking_checkouts enable row level security;
revoke all on table public.tracking_checkouts from public, anon, authenticated;
grant select, insert, update, delete on table public.tracking_checkouts to service_role;


-- ---------------------------------------------------------------------------
-- 2. tracking_destinations com trava de dono
-- ---------------------------------------------------------------------------
--
-- A 043 criou a policy so com `user_id = auth.uid()`. Nao conferia a LOJA, e
-- anon/authenticated tinham INSERT/UPDATE/DELETE. O cadastro do xcart e aberto
-- e o store_id e publico no HTML de toda loja (`data-xcart-store`). Entao
-- qualquer conta podia inserir um destino Google com o AW DELA na loja de outro:
--
--   - na proxima reinstalacao da tag, o gtag do intruso carregaria nos
--     visitantes, e ele montaria publico de remarketing com trafego pago pelo
--     dono da loja;
--   - centenas de destinos estourariam o teto por hora e o funil real passaria
--     a ser descartado.
--
-- Medido antes desta migration: 0 linhas assim. Fecha antes que exista uma.
--
-- Mesmo tratamento que tracking_configs ja tinha: gatilho de dono e WITH CHECK
-- conferindo a loja. E mais: nenhuma escrita do app passa pelo cliente do
-- usuario -- a API usa service_role --, entao a escrita direta e revogada.
drop trigger if exists tracking_destinations_dono on public.tracking_destinations;
create trigger tracking_destinations_dono
  before insert or update on public.tracking_destinations
  for each row execute function public.tracking_config_dono();

drop policy if exists "Owners manage their tracking destinations" on public.tracking_destinations;
create policy "Owners manage their tracking destinations"
  on public.tracking_destinations
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.stores s
       where s.id = store_id and s.user_id = (select auth.uid())
    )
  );

revoke insert, update, delete on table public.tracking_destinations from public, anon, authenticated;
-- A tela le os destinos pelo admin; anon nao tem o que ler aqui.
revoke select on table public.tracking_destinations from public, anon;

-- O segredo ja estava fechado por RLS sem policy, mas o GRANT continuava la.
-- Dois caminhos de privilegio (ver migration 027): fecha os dois.
revoke all on table public.tracking_destination_secrets from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Expurgo que tambem limpa o que falhou
-- ---------------------------------------------------------------------------
--
-- O expurgo da 035 so apagava 'enviado' com mais de 90 dias. Linha 'falhou' ou
-- 'pendente' ficava para sempre -- e o coletor e publico: um POST grande vira
-- linha permanente, e disco cheio poe o Postgres em somente leitura, o que para
-- webhook, coletor e roteamento juntos.
--
-- 30 dias e folgado: o Meta recusa evento com mais de 7, entao uma linha que nao
-- saiu em 30 nunca mais sai.
create or replace function public.purge_tracking()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.tracking_identities
   where expires_at < now();

  delete from public.tracking_events
   where status = 'enviado'
     and created_at < now() - interval '90 days';

  delete from public.tracking_events
   where status in ('falhou', 'pendente')
     and created_at < now() - interval '30 days';

  -- A ponte so importa ate o pedido chegar, que e questao de minutos. 30 dias
  -- cobre pagamento pendente que conclui depois.
  delete from public.tracking_checkouts
   where created_at < now() - interval '30 days';
end;
$$;

comment on function public.purge_tracking() is
  'Apaga identidade vencida, evento entregue com mais de 90 dias, evento que nunca saiu com mais de 30, e ponte de checkout com mais de 30. Chamado pelo drain, uma vez por hora.';

revoke all on function public.purge_tracking() from public, anon, authenticated;
grant execute on function public.purge_tracking() to service_role;
