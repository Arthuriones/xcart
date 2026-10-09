-- ============================================================================
-- 068 -- Contra entrega (COD) no financeiro.
--
-- No COD o pedido nasce PENDING com o total inteiro em aberto, e marcar como
-- pago na Shopify e opcional. Ate aqui o pedido COD ficava fora do
-- faturamento ate alguem marcar, mas o custo entrava assim que ele era
-- enviado: o lucro e o ROAS da loja COD so mostravam prejuizo.
--
-- Agora cada pedido COD (reconhecido pelo gateway; loja mista funciona) tem
-- uma situacao -- aguardando envio, em transito, entregue a receber, pago,
-- recusado/devolvido, cancelado -- e a loja marcada "Contra entrega" ve no
-- Dashboard o Recebido, o A receber e o Previsto pela taxa de entrega.
-- Regras em src/lib/financeiro/contra-entrega.ts.
--
-- SO ACRESCENTA COLUNAS. Nada muda para pedido online, e o codigo le e grava
-- com ou sem esta migration (o sync grava sem as colunas novas enquanto ela
-- nao estiver aplicada; a leitura cai na lista antiga).
--
-- SEM DADO PESSOAL: das tags do pedido so ficam dois sim/nao (e COD? tem
-- marca de recusa?); dos envios, a situacao e as datas, sem rastreio nem
-- endereco.
--
-- PERMISSOES: as da 052 valem para as colunas novas (grant por tabela). O
-- lojista le pela RLS; quem escreve e so o service_role (sync e
-- POST /api/financeiro/config). Nenhum grant novo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Envio e entrega do pedido
-- ---------------------------------------------------------------------------
alter table public.fin_orders
  -- Gateway de contra entrega, ou tag de app de COD (a tag nao e gravada).
  add column if not exists cod           boolean not null default false,
  -- displayFulfillmentStatus da Shopify (FULFILLED, UNFULFILLED, RESTOCKED...).
  add column if not exists status_envio  text,
  -- Resumo dos fulfillments: null = nada enviado.
  add column if not exists entrega       text
                           check (entrega is null or entrega in ('em_transito', 'entregue', 'falhou')),
  -- Primeiro envio e ultima entrega (so quando tudo foi entregue).
  add column if not exists enviado_em    timestamptz,
  add column if not exists entregue_em   timestamptz,
  -- returnStatus da Shopify; null = sem devolucao.
  add column if not exists devolucao     text,
  -- Alguma tag de recusa/devolucao ("returned", "rts", "rto"...).
  add column if not exists marca_recusa  boolean not null default false;


-- ---------------------------------------------------------------------------
-- 2. Como a loja recebe
-- ---------------------------------------------------------------------------
alter table public.fin_store_settings
  -- Muda so o Dashboard: o pedido COD e reconhecido pelo gateway em qualquer modo.
  add column if not exists contra_entrega       boolean not null default false,
  -- Taxa de entrega (%) usada no Previsto ate a loja ter 20 pedidos COD
  -- finalizados; depois vale a dela.
  add column if not exists cod_taxa_entrega     numeric(5,2) not null default 70
                           check (cod_taxa_entrega >= 0 and cod_taxa_entrega <= 100),
  -- Frete de volta e taxa da transportadora por recusado enviado, moeda da loja.
  add column if not exists cod_custo_devolucao  numeric(12,4) not null default 0
                           check (cod_custo_devolucao >= 0 and cod_custo_devolucao <= 10000);


-- ---------------------------------------------------------------------------
-- Opcional, depois de aplicar: os pedidos ja gravados so ganham as colunas de
-- envio quando mudam na Shopify. Para reler os 60 dias de uma loja que ja
-- vende contra entrega (a carga anda em varias rodadas do cron, sem mexer em
-- carga_inicial_ok):
--
--   update public.fin_sync_state
--      set cursor_atualizado = null, retomar_busca = null, retomar_cursor = null
--    where store_id = '<id da loja>';
-- ---------------------------------------------------------------------------

-- Conferir depois de aplicar:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fin_orders'
--      and column_name in ('cod', 'status_envio', 'entrega', 'enviado_em',
--                          'entregue_em', 'devolucao', 'marca_recusa');                        -- 7
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fin_store_settings'
--      and column_name in ('contra_entrega', 'cod_taxa_entrega', 'cod_custo_devolucao');     -- 3
--   select has_column_privilege('authenticated', 'public.fin_orders', 'cod', 'select');                    -- true
--   select has_column_privilege('authenticated', 'public.fin_store_settings', 'contra_entrega', 'select'); -- true
--   select has_column_privilege('authenticated', 'public.fin_store_settings', 'contra_entrega', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.fin_orders', 'entrega', 'update');                -- false
--   select has_table_privilege('anon', 'public.fin_store_settings', 'select');                             -- false
--   select has_table_privilege('anon', 'public.fin_orders', 'select');                                     -- false
