-- ============================================================================
-- mcp_tokens: o dono so cria e revoga -- nao mexe em validade, contador nem
-- desfaz revogacao.
-- ============================================================================
--
-- `authenticated` tinha INSERT e UPDATE na tabela inteira, e a policy de
-- UPDATE so conferia o dono. Com o token da sessao, um
--   PATCH /rest/v1/mcp_tokens?id=eq.X {"calls_in_window": 0}       -- zera o limite
--   PATCH ... {"expires_at": "2099-01-01"}                          -- estende a validade
--   PATCH ... {"revoked_at": null}                                  -- desrevoga
-- passava, e o INSERT aceitava expires_at/calls_in_window no corpo.
--
-- Conferido em src/ quem escreve aqui:
--   - POST /api/mcp-tokens: INSERT PELA SESSAO, so (user_id, name,
--     token_hash, token_suffix). O resto vem do default.
--   - DELETE /api/mcp-tokens: UPDATE PELA SESSAO (atualizarDoUsuario), so
--     revoked_at = now().
--   - mcp_authenticate (020): SECURITY DEFINER, dono da tabela -- contador e
--     last_used_at nao dependem de grant de `authenticated`.
--
-- Como os dois caminhos do app escrevem pela sessao, o privilegio NAO sai
-- inteiro: sai o da tabela e volta so por coluna, o que o app usa (mesmo
-- molde da 064). E a policy de UPDATE passa a exigir revoked_at preenchido na
-- linha nova: revogar continua, desrevogar nao. DELETE e SELECT ficam como
-- estao (apagar o proprio token so o mata).
-- ----------------------------------------------------------------------------

revoke insert, update on public.mcp_tokens from public, anon, authenticated;

grant insert (user_id, name, token_hash, token_suffix)
   on public.mcp_tokens to authenticated;
grant update (revoked_at)
   on public.mcp_tokens to authenticated;

drop policy if exists "Users revoke own mcp tokens" on public.mcp_tokens;
create policy "Users revoke own mcp tokens" on public.mcp_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and revoked_at is not null);

-- Conferir depois de aplicar:
--   select has_table_privilege('authenticated', 'public.mcp_tokens', 'update');                     -- false
--   select has_table_privilege('authenticated', 'public.mcp_tokens', 'insert');                     -- false
--   select has_table_privilege('anon', 'public.mcp_tokens', 'insert');                              -- false
--   select has_table_privilege('anon', 'public.mcp_tokens', 'update');                              -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'revoked_at', 'update');      -- true
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'calls_in_window', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'window_started_at', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'expires_at', 'update');      -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'expires_at', 'insert');      -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'calls_in_window', 'insert'); -- false
--   select has_column_privilege('authenticated', 'public.mcp_tokens', 'token_hash', 'insert');      -- true
--   select has_table_privilege('authenticated', 'public.mcp_tokens', 'select');                     -- true (RLS limita ao dono)
--   select has_table_privilege('authenticated', 'public.mcp_tokens', 'delete');                     -- true
--   select has_table_privilege('service_role', 'public.mcp_tokens', 'update');                      -- true
-- E no app: gerar token e revogar na tela de integracoes continuam funcionando.
