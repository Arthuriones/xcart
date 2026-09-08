-- ============================================================================
-- P0: escalacao de privilegio via UPDATE em profiles
-- ============================================================================
--
-- A policy profiles_update_own era:
--
--   FOR UPDATE USING (auth.uid() = id)      -- e WITH CHECK NULO
--
-- Sem WITH CHECK o Postgres NAO valida a linha depois da alteracao. E o papel
-- `authenticated` tinha grant de UPDATE em TODAS as colunas de profiles,
-- inclusive is_admin, ai_credits, plan, access_granted, subscription_status e
-- o proprio id. Conferido em information_schema.column_privileges.
--
-- Ou seja, qualquer usuario logado podia:
--
--   PATCH /rest/v1/profiles?id=eq.<proprio-id>
--   {"is_admin": true, "plan": "pro", "ai_credits": 999999}
--
-- e virar admin -- as rotas /api/admin/* autorizam justamente por
-- profiles.is_admin. Alem de assinatura e credito de graca.
--
-- Correcao em duas camadas, porque uma so nao basta:
--
--   1. Tira o grant. Conferi as escritas legitimas: TODAS passam por
--      service-role (webhooks de pagamento, /api/admin, billing/*). O unico
--      caminho por RLS e /api/billing/me, que so le. O cliente nao precisa de
--      UPDATE em profiles.
--   2. Poe o WITH CHECK assim mesmo. Sem grant a policy nem dispara, mas se
--      alguem reconceder o privilegio amanha a policy volta a segurar. Sem
--      isso, o buraco reabre em silencio.

revoke update on public.profiles from anon, authenticated;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ============================================================================
-- P1: outras duas policies de UPDATE sem WITH CHECK
-- ============================================================================
--
-- Mesma classe de problema, menor alcance -- nas duas o USING prende a linha
-- ANTIGA ao dono, mas nada impedia a linha NOVA de sair com user_id de outro:
-- o usuario doava a propria linha e ela sumia do painel dele, aparecendo no do
-- outro. Aqui as duas escritas sao legitimas pelo cliente (revogar token MCP,
-- atualizar job), entao o grant fica -- o que faltava era o WITH CHECK.

drop policy if exists "Users revoke own mcp tokens" on public.mcp_tokens;
create policy "Users revoke own mcp tokens" on public.mcp_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own jobs" on public.background_jobs;
create policy "Users can update their own jobs" on public.background_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ============================================================================
-- P2: indice em foreign key
-- ============================================================================
--
-- Sete FKs sem indice. Postgres NAO indexa o lado filho automaticamente, entao
-- cada DELETE ou UPDATE de chave no pai varre a filha inteira para checar a
-- referencia -- e apagar uma loja toca cinco dessas tabelas de uma vez.
-- Tambem serve para o caminho comum de leitura ("tudo desta loja").

create index if not exists background_jobs_user_idx
  on public.background_jobs (user_id);
create index if not exists ai_usage_log_store_idx
  on public.ai_usage_log (store_id);
create index if not exists routed_checkout_configs_source_store_idx
  on public.routed_checkout_configs (source_store_id);
create index if not exists routed_checkout_configs_target_store_idx
  on public.routed_checkout_configs (target_store_id);
create index if not exists routed_checkout_targets_store_idx
  on public.routed_checkout_targets (target_store_id);
create index if not exists clone_runs_target_store_idx
  on public.clone_runs (target_store_id);
create index if not exists instagram_posts_connection_idx
  on public.instagram_posts (connection_id);
