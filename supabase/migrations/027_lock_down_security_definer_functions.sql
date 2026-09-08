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
-- ================== A ARMADILHA: revogar de anon NAO BASTA ==================
--
-- A ACL das funcoes tinha "=X/postgres", que e o grant ao pseudo-papel PUBLIC.
-- anon e authenticated HERDAM execute dali. `revoke ... from anon` nao tira
-- nada, porque o privilegio nunca foi deles. Confirmado na pratica: a primeira
-- tentativa respondeu sucesso e has_function_privilege('anon', ...) continuou
-- true. Tem que revogar de PUBLIC e devolver o grant explicito a service_role.
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

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.update_updated_at() from public;

-- search_path fixo: sem isso quem chama pode plantar um schema no caminho de
-- busca e sequestrar os nomes que a funcao resolve. Roda em 9 triggers.
alter function public.update_updated_at() set search_path = pg_catalog, public;
