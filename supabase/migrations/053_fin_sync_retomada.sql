-- ============================================================================
-- 053 -- Retomada da paginacao de pedidos entre rodadas.
--
-- O sync de pedidos le por updated_at crescente e, a cada rodada, recomecava
-- em cursor_atualizado - 2 min. Uma acao em massa que atualiza mais pedidos
-- do que cabem numa rodada (25 paginas x 8) dentro desses 2 min prendia o
-- cursor: as mesmas primeiras paginas voltavam sempre e nenhum pedido novo
-- entrava, com o sync dando "ok".
--
-- Agora a rodada que para no meio guarda a busca e o endCursor da Shopify, e
-- a seguinte continua dali. Quando a lista acaba, as duas voltam a null e o
-- caminho normal (cursor - folga) volta a valer.
--
-- Sem dado pessoal: a busca e so "updated_at:>='<data>'" e o cursor e opaco.
-- Quem escreve continua sendo so service_role (052).
-- ============================================================================

alter table public.fin_sync_state
  add column if not exists retomar_busca  text,
  add column if not exists retomar_cursor text;
