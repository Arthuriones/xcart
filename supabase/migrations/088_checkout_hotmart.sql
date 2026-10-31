-- ============================================================================
-- 088 -- Hotmart: o quarto checkout externo de VENDA PROPRIA (como a Cakto,
-- 072, a Hubla, 075, e o Eve, 076).
--
-- O lojista e o PRODUTOR: o webhook 2.0 da Hotmart manda a transacao (HP...),
-- o valor, as comissoes de cada papel (a taxa da Hotmart, o produtor, o
-- coprodutor, o afiliado), Pix/boleto aguardando pagamento, reembolso,
-- chargeback e o `sck` com que o comprador abriu o checkout (a ponte poe o
-- visitante nele). Regras em src/lib/checkouts-externos/plataformas/hotmart.ts.
--
-- Nada de coluna nova: a venda usa as colunas da 072 e o hottok (o token fixo
-- do header X-HOTMART-HOTTOK) mora em checkout_externo_segredos.segredo_plataforma
-- (a do secret da Cakto e do token da Hubla, RLS ligada e ZERO policy, so
-- service_role).
--
-- ORDEM: APLICAR ANTES DO DEPLOY. Sem o CHECK novo o POST /api/checkouts da
-- Hotmart recebe 23514. O codigo velho nao cadastra Hotmart, entao aplicar
-- antes nao quebra nada.
--
-- 1. plataforma 'hotmart' nos dois CHECKs da 069 (refeitos na 072, 075 e 076).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Hotmart nas plataformas
-- ---------------------------------------------------------------------------
alter table public.checkouts_externos drop constraint if exists checkouts_externos_plataforma_check;
alter table public.checkouts_externos
  add constraint checkouts_externos_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla', 'eve', 'hotmart'));

alter table public.checkout_externo_contas drop constraint if exists checkout_externo_contas_plataforma_check;
alter table public.checkout_externo_contas
  add constraint checkout_externo_contas_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla', 'eve', 'hotmart'));


-- Conferir depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('checkouts_externos_plataforma_check', 'checkout_externo_contas_plataforma_check');
--                                                     -- 2 linhas com as 5 plataformas
