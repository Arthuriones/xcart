-- Fecha as funcoes SECURITY DEFINER que estavam abertas ao publico.
--
-- ============================ O QUE ESTAVA ERRADO ============================
--
-- Toda funcao em `public` vira endpoint em /rest/v1/rpc/<nome>. As de credito
-- eram SECURITY DEFINER -- rodam com privilegio total e ignoram RLS -- e
-- estavam com EXECUTE liberado. Qualquer pessoa com a chave anon, que e publica
-- e vai no JavaScript do navegador, podia chamar:
--
--   POST /rest/v1/rpc/add_ai_credits {"p_user_id": "<qualquer>", "p_amount": 99999}
--
-- e se dar credito infinito. Credito e o que paga a neutralizacao de imagem com
-- IA, entao era bypass direto de faturamento.
--
-- ===================== A ARMADILHA: SAO DOIS CAMINHOS =====================
--
-- Existem DUAS rotas de privilegio ate anon, e tirar uma deixa a outra:
--
--   =X/postgres      <- grant ao pseudo-papel PUBLIC, herdado por todos
--   anon=X/postgres  <- grant EXPLICITO, do ALTER DEFAULT PRIVILEGES que o
--                       Supabase aplica a toda funcao criada em `public`
--
-- Errei as duas vezes antes de acertar. Revogar so de anon nao mexe no PUBLIC;
-- revogar so de PUBLIC deixa o explicito. Nos dois casos o comando respondeu
-- sucesso e has_function_privilege('anon', ...) continuou true.
--
-- Regra: revogar de `public, anon, authenticated` e depois conceder a quem
-- precisa. E CONFERIR com has_function_privilege -- "success" nao prova nada.
--
-- As funcoes de trigger entram junto por higiene: retornam trigger/event_trigger
-- e sao disparadas pelo Postgres, nunca pelo cliente. Revogar nao afeta o
-- disparo -- trigger roda no contexto do dono da tabela.
--
-- is_admin() fica de fora de proposito: e usada nas policies de profiles,
-- ai_usage_log e credit_purchases. Sem EXECUTE, a policy ERRA em vez de negar,
-- e uma consulta anonima a profiles quebraria em vez de voltar vazia.

revoke execute on function public.add_ai_credits(uuid, integer) from public, anon, authenticated;
revoke execute on function public.reset_ai_credits(uuid, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.consume_ai_credits(uuid, integer) from public, anon, authenticated;

grant execute on function public.add_ai_credits(uuid, integer) to service_role;
grant execute on function public.reset_ai_credits(uuid, integer, timestamptz) to service_role;
grant execute on function public.consume_ai_credits(uuid, integer) to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.update_updated_at() from public, anon, authenticated;

-- search_path fixo: sem isso quem chama pode plantar um schema no caminho de
-- busca e sequestrar os nomes que a funcao resolve. Roda em 9 triggers.
alter function public.update_updated_at() set search_path = pg_catalog, public;
