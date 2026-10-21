-- ============================================================================
-- 075 -- Hubla: o segundo checkout externo de VENDA PROPRIA (como a Cakto, 072).
--
-- O lojista e o produtor: o webhook de fatura da Hubla manda faturamento (em
-- centavos), o liquido do vendedor (receivers role "seller"), Pix e boleto
-- gerados, reembolso, chargeback e a sessao do pagamento (UTMs, IP, user
-- agent, fbp, fbclid, ttclid). Regras em
-- src/lib/checkouts-externos/plataformas/hubla.ts.
--
-- Nada de coluna nova: a venda usa as colunas da 072 e o token fixo do header
-- x-hubla-token mora em checkout_externo_segredos.segredo_plataforma (a do
-- secret da Cakto, RLS ligada e ZERO policy, so service_role).
--
-- ORDEM: APLICAR ANTES DO DEPLOY. Sem o CHECK novo o POST /api/checkouts da
-- Hubla recebe 23514. O codigo velho nao cadastra Hubla, entao aplicar antes
-- nao quebra nada.
--
-- 1. plataforma 'hubla' nos dois CHECKs da 069 (refeitos na 072).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Hubla nas plataformas
-- ---------------------------------------------------------------------------
alter table public.checkouts_externos drop constraint if exists checkouts_externos_plataforma_check;
alter table public.checkouts_externos
  add constraint checkouts_externos_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla'));

alter table public.checkout_externo_contas drop constraint if exists checkout_externo_contas_plataforma_check;
alter table public.checkout_externo_contas
  add constraint checkout_externo_contas_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla'));


-- Conferir depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('checkouts_externos_plataforma_check', 'checkout_externo_contas_plataforma_check');
--                                                     -- 2 linhas com 'sphere', 'cakto' e 'hubla'
