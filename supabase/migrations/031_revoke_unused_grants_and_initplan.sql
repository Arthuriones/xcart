-- ============================================================================
-- Parte 1 -- tira privilegio que nenhum fluxo usa
-- ============================================================================
--
-- Levantamento: 15 combinacoes tabela+comando onde `authenticated` tinha GRANT
-- e NAO existia policy. A RLS nega por padrao, entao nao havia furo hoje. Mas
-- e armadilha: no dia em que alguem adicionar uma policy permissiva -- ou
-- desligar RLS para debugar -- o privilegio ja esta concedido e o acesso abre
-- sozinho, sem ninguem ter pedido.
--
-- Conferi tabela a tabela quem escreve de verdade. TODAS as escritas passam por
-- service-role (webhooks de pagamento, /api/admin, track-fallback, usage). Pelo
-- cliente so existe SELECT. Entao o grant de escrita nao serve a ninguem.
--
-- payment_events perde ate o SELECT: nao tem policy nenhuma e so o webhook da
-- Pagou toca nela.

revoke insert, update, delete on public.ai_usage_log from anon, authenticated;
revoke insert, update, delete on public.credit_purchases from anon, authenticated;
revoke insert, update, delete on public.routed_checkout_fallbacks from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;
revoke select, insert, update, delete on public.payment_events from anon, authenticated;

-- ============================================================================
-- Parte 2 -- auth.uid() dentro de subselect (InitPlan)
-- ============================================================================
--
-- `auth.uid() = user_id` faz o Postgres chamar a funcao UMA VEZ POR LINHA
-- avaliada. Envolvendo em `(select auth.uid())` ele reconhece a expressao como
-- constante da consulta, calcula uma vez e reaproveita.
--
-- A semantica e IDENTICA -- auth.uid() nao muda no meio da consulta. E a
-- recomendacao da propria Supabase para RLS em tabela grande, e aqui
-- routed_checkout_fallbacks ja tem 9,6k linhas crescendo com o trafego dos
-- anuncios.
--
-- Cada policy abaixo mantem o predicado exato que tinha; a unica mudanca e o
-- subselect. As tres reescritas na 030 (profiles, mcp_tokens update,
-- background_jobs update) ja nasceram assim.

drop policy if exists "Owners can read their route fallbacks" on public.routed_checkout_fallbacks;
create policy "Owners can read their route fallbacks" on public.routed_checkout_fallbacks
  for select to authenticated
  using (exists (select 1 from public.routed_checkout_configs c
                  where c.id = routed_checkout_fallbacks.route_config_id
                    and c.user_id = (select auth.uid())));

drop policy if exists ai_usage_select_own_or_admin on public.ai_usage_log;
create policy ai_usage_select_own_or_admin on public.ai_usage_log
  for select to authenticated
  using ((select auth.uid()) = user_id or is_admin());

drop policy if exists "Users can view their own jobs" on public.background_jobs;
create policy "Users can view their own jobs" on public.background_jobs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own jobs" on public.background_jobs;
create policy "Users can delete their own jobs" on public.background_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own jobs" on public.background_jobs;
create policy "Users can insert their own jobs" on public.background_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own clone runs" on public.clone_runs;
create policy "Users can manage their own clone runs" on public.clone_runs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own stores" on public.stores;
create policy "Users can manage their own stores" on public.stores
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or is_admin());

drop policy if exists credit_purchases_select_own_or_admin on public.credit_purchases;
create policy credit_purchases_select_own_or_admin on public.credit_purchases
  for select to authenticated
  using ((select auth.uid()) = user_id or is_admin());

-- A rota so vale se a vitrine E o checkout forem do mesmo dono: sem isso o
-- usuario apontaria a propria rota para a loja de outro.
drop policy if exists "Users can manage their routed checkout configs" on public.routed_checkout_configs;
create policy "Users can manage their routed checkout configs" on public.routed_checkout_configs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = routed_checkout_configs.source_store_id
                   and s.user_id = (select auth.uid()))
    and exists (select 1 from public.stores s
                 where s.id = routed_checkout_configs.target_store_id
                   and s.user_id = (select auth.uid())));

drop policy if exists "Owners manage their route targets" on public.routed_checkout_targets;
create policy "Owners manage their route targets" on public.routed_checkout_targets
  for all to authenticated
  using (exists (select 1 from public.routed_checkout_configs c
                  where c.id = routed_checkout_targets.route_id
                    and c.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.routed_checkout_configs c
             where c.id = routed_checkout_targets.route_id
               and c.user_id = (select auth.uid()))
    and exists (select 1 from public.stores s
                 where s.id = routed_checkout_targets.target_store_id
                   and s.user_id = (select auth.uid())));

drop policy if exists "Users can manage products in their stores" on public.products;
create policy "Users can manage products in their stores" on public.products
  for all to authenticated
  using (store_id in (select id from public.stores where user_id = (select auth.uid())))
  with check (store_id in (select id from public.stores where user_id = (select auth.uid())));

drop policy if exists "Users can manage assets of their own stores" on public.store_assets;
create policy "Users can manage assets of their own stores" on public.store_assets
  for all to authenticated
  using (store_id in (select id from public.stores where user_id = (select auth.uid())))
  with check (store_id in (select id from public.stores where user_id = (select auth.uid())));

drop policy if exists "Users can manage their own AI product reviews" on public.ai_product_reviews;
create policy "Users can manage their own AI product reviews" on public.ai_product_reviews
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
              and exists (select 1 from public.stores s
                           where s.id = ai_product_reviews.store_id
                             and s.user_id = (select auth.uid())));

drop policy if exists "Users can manage their own Instagram connections" on public.instagram_connections;
create policy "Users can manage their own Instagram connections" on public.instagram_connections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can manage their own Instagram posts" on public.instagram_posts;
create policy "Users can manage their own Instagram posts" on public.instagram_posts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users read own mcp tokens" on public.mcp_tokens;
create policy "Users read own mcp tokens" on public.mcp_tokens
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users delete own mcp tokens" on public.mcp_tokens;
create policy "Users delete own mcp tokens" on public.mcp_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users create own mcp tokens" on public.mcp_tokens;
create policy "Users create own mcp tokens" on public.mcp_tokens
  for insert to authenticated with check ((select auth.uid()) = user_id);
