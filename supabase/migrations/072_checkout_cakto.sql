-- ============================================================================
-- 072 -- Cakto: o checkout externo de VENDA PROPRIA (o lojista e o produtor).
--
-- A Sphere (069) paga comissao; na Cakto o lojista vende e recebe o liquido.
-- O webhook manda faturamento, taxa da Cakto, comissoes de afiliado ou
-- coprodutor, Pix e boleto gerados, reembolso e chargeback, e as UTMs. Regras
-- em src/lib/checkouts-externos/plataformas/cakto.ts e venda.ts.
--
-- ORDEM: APLICAR ANTES DO DEPLOY. O codigo novo le com e sem esta migration
-- (cai nas colunas da 069 quando falta coluna), mas o cadastro da Cakto
-- depende do CHECK novo: sem ele o POST /api/checkouts da Cakto recebe 23514.
-- O codigo velho nao le nada daqui, entao aplicar antes nao quebra nada.
--
-- 1. plataforma 'cakto' nos dois CHECKs da 069.
-- 2. checkout_externo_segredos.segredo_plataforma: o secret do webhook da
--    Cakto (a chave do HMAC do X-Cakto-Signature e o `secret` do corpo).
--    Mora na tabela do token: RLS ligada e ZERO policy, so service_role.
-- 3. checkouts_externos: os avisos opcionais da Venda no celular (Pix ou
--    boleto gerado; reembolso e chargeback). Desligados por padrao.
-- 4. pedidos_externos: as colunas da venda. Na Sphere ficam null.
--
-- SEM DADO PESSOAL. O webhook da Cakto traz nome, e-mail, telefone, CPF e
-- endereco do comprador: nada disso tem coluna. O pedido guarda valores,
-- datas, o id curto do painel (refId), o grupo da cobranca e as UTMs (sem "@",
-- conferido aqui e no codigo, src/lib/tracking/utm.ts).
--
-- PERMISSOES: as da 069. O lojista LE pela RLS; quem escreve e so o
-- service_role (o webhook e as rotas /api/checkouts). Coluna nova herda o
-- grant da tabela; os revokes abaixo so reafirmam (027: confira com
-- has_table_privilege, o comando responde sucesso sem garantir nada).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Cakto nas plataformas
-- ---------------------------------------------------------------------------
alter table public.checkouts_externos drop constraint if exists checkouts_externos_plataforma_check;
alter table public.checkouts_externos
  add constraint checkouts_externos_plataforma_check check (plataforma in ('sphere', 'cakto'));

alter table public.checkout_externo_contas drop constraint if exists checkout_externo_contas_plataforma_check;
alter table public.checkout_externo_contas
  add constraint checkout_externo_contas_plataforma_check check (plataforma in ('sphere', 'cakto'));


-- ---------------------------------------------------------------------------
-- 2. O secret do webhook da plataforma (Cakto)
-- ---------------------------------------------------------------------------
-- ASCII visivel, sem espaco: o que a Cakto gera (uuid) ou o que o lojista
-- define no painel dela.
alter table public.checkout_externo_segredos
  add column if not exists segredo_plataforma text
    check (segredo_plataforma is null or segredo_plataforma ~ '^[!-~]{8,200}$');

alter table public.checkout_externo_segredos enable row level security;
revoke all on table public.checkout_externo_segredos from public, anon, authenticated;
grant select, insert, update, delete on table public.checkout_externo_segredos to service_role;


-- ---------------------------------------------------------------------------
-- 3. Avisos opcionais da venda no celular
-- ---------------------------------------------------------------------------
-- A venda aprovada sempre avisa (como o pedido criado da Sphere). Estes dois
-- so com o lojista pedindo.
alter table public.checkouts_externos
  add column if not exists notificar_pendente boolean not null default false,
  add column if not exists notificar_estorno  boolean not null default false;


-- ---------------------------------------------------------------------------
-- 4. A venda em pedidos_externos
-- ---------------------------------------------------------------------------
--
-- Na venda: valor = faturamento (baseAmount - discount, sem a taxa que o
-- comprador paga a Cakto), receita = o liquido do produtor (a linha
-- "producer" de commissions), taxa = fees da Cakto, comissoes = o resto
-- (afiliado, coprodutor). O metodo de pagamento usa a coluna da 069
-- (metodo_pagamento).
alter table public.pedidos_externos
  -- O id curto que o painel da Cakto mostra (refId). O pedido_id e o data.id.
  add column if not exists referencia          text check (referencia is null or length(referencia) between 1 and 64),
  add column if not exists taxa                numeric(14,2) check (taxa is null or (taxa >= 0 and taxa <= 100000)),
  add column if not exists comissoes           numeric(14,2) check (comissoes is null or (comissoes >= 0 and comissoes <= 100000)),
  -- A cobranca: o refId do principal (o parent_order do order bump e do
  -- upsell). O Dashboard conta UM pedido por grupo.
  add column if not exists grupo               text check (grupo is null or length(grupo) between 1 and 64),
  add column if not exists oferta_tipo         text check (oferta_tipo is null or oferta_tipo in ('main', 'orderbump', 'upsell', 'downsell')),
  -- Pix e boleto: a Cakto nao avisa quando vence. Pendente vencido conta
  -- como perdido na leitura (venda.ts).
  add column if not exists vence_em            timestamptz,
  add column if not exists reembolsado_em      timestamptz,
  add column if not exists chargeback_em       timestamptz,
  -- refund_requested: a venda segue paga, "em risco", ate o reembolso.
  add column if not exists reembolso_pedido_em timestamptz,
  -- As UTMs como vieram e os ids da plataforma (as regras de utm.ts, as
  -- mesmas da 071 em fin_order_origem).
  add column if not exists utm_source          text check (utm_source is null or length(utm_source) <= 200),
  add column if not exists utm_medium          text check (utm_medium is null or length(utm_medium) <= 200),
  add column if not exists utm_campaign        text check (utm_campaign is null or length(utm_campaign) <= 200),
  add column if not exists utm_content         text check (utm_content is null or length(utm_content) <= 200),
  add column if not exists utm_term            text check (utm_term is null or length(utm_term) <= 200),
  add column if not exists campanha_id         text check (campanha_id is null or campanha_id ~ '^[0-9]{5,25}$'),
  add column if not exists conjunto_id         text check (conjunto_id is null or conjunto_id ~ '^[0-9]{5,25}$'),
  add column if not exists anuncio_id          text check (anuncio_id is null or anuncio_id ~ '^[0-9]{5,25}$');

-- Nenhum e-mail nas UTMs (a de campanha de e-mail leva o do cliente).
alter table public.pedidos_externos drop constraint if exists pedidos_externos_utm_sem_email;
alter table public.pedidos_externos
  add constraint pedidos_externos_utm_sem_email check (
    (coalesce(utm_source, '') || coalesce(utm_medium, '') || coalesce(utm_campaign, '') ||
     coalesce(utm_content, '') || coalesce(utm_term, '')) !~ '@'
  );

-- A base do lucro por campanha do checkout (ainda nao construido).
create index if not exists pedidos_externos_campanha_idx
  on public.pedidos_externos (checkout_id, campanha_id)
  where campanha_id is not null;


-- ---------------------------------------------------------------------------
-- 5. Grants (os da 069, reafirmados)
-- ---------------------------------------------------------------------------
revoke insert, update, delete on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_contas
  from public, anon, authenticated;
revoke select on table public.checkouts_externos, public.pedidos_externos, public.checkout_externo_contas
  from public, anon;
grant select on table public.checkouts_externos, public.pedidos_externos, public.checkout_externo_contas
  to authenticated;
grant select, insert, update, delete on table
  public.checkouts_externos, public.pedidos_externos, public.checkout_externo_contas
  to service_role;


-- Conferir depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('checkouts_externos_plataforma_check', 'checkout_externo_contas_plataforma_check');
--                                                     -- 2 linhas com 'sphere' e 'cakto'
--   select has_table_privilege('authenticated', 'public.checkout_externo_segredos', 'select');  -- false
--   select has_table_privilege('anon', 'public.checkout_externo_segredos', 'select');           -- false
--   select has_column_privilege('authenticated', 'public.checkout_externo_segredos', 'segredo_plataforma', 'select'); -- false
--   select has_table_privilege('service_role', 'public.checkout_externo_segredos', 'update');   -- true
--   select count(*) from pg_policies where tablename = 'checkout_externo_segredos';            -- 0
--   select has_table_privilege('authenticated', 'public.pedidos_externos', 'select');           -- true
--   select has_table_privilege('authenticated', 'public.pedidos_externos', 'update');           -- false
--   select has_table_privilege('authenticated', 'public.checkouts_externos', 'update');         -- false
--   select has_table_privilege('anon', 'public.pedidos_externos', 'select');                    -- false
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'pedidos_externos'
--      and column_name in ('referencia', 'taxa', 'comissoes', 'grupo', 'oferta_tipo', 'vence_em',
--                          'reembolsado_em', 'chargeback_em', 'reembolso_pedido_em', 'utm_source',
--                          'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'campanha_id',
--                          'conjunto_id', 'anuncio_id');                                       -- 17
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'checkouts_externos'
--      and column_name in ('notificar_pendente', 'notificar_estorno');                         -- 2
--   select conname from pg_constraint where conname = 'pedidos_externos_utm_sem_email';       -- 1 linha
