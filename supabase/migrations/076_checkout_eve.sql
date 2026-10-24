-- ============================================================================
-- 076 -- Eve (PixKit): o terceiro checkout externo de VENDA PROPRIA (como a
-- Cakto, 072, e a Hubla, 075). E o checkout Pix do proprio Arthur
-- (checkouteve.shop): SO a conta dele ve e cadastra -- a trava e no codigo
-- (src/lib/checkouts-externos/liberadas.ts), por id de conta.
--
-- O Eve manda o ESTADO INTEIRO do pedido a cada mudanca (contrato v1:
-- pix.gerado, pedido.pago, pix.expirado, pedido.cancelado,
-- pedido.reembolsado), em centavos, assinado com HMAC-SHA256 no header
-- X-Eve-Signature. Regras em src/lib/checkouts-externos/plataformas/eve.ts.
--
-- Nada de coluna nova: a venda usa as colunas da 072 e o secret do HMAC mora
-- em checkout_externo_segredos.segredo_plataforma (a do secret da Cakto, RLS
-- ligada e ZERO policy, so service_role).
--
-- ORDEM: APLICAR ANTES DO DEPLOY. Sem o CHECK novo o POST /api/checkouts do
-- Eve recebe 23514. O codigo velho nao cadastra Eve, entao aplicar antes nao
-- quebra nada.
--
-- 1. plataforma 'eve' nos dois CHECKs da 069 (refeitos na 072 e na 075).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Eve nas plataformas
-- ---------------------------------------------------------------------------
alter table public.checkouts_externos drop constraint if exists checkouts_externos_plataforma_check;
alter table public.checkouts_externos
  add constraint checkouts_externos_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla', 'eve'));

alter table public.checkout_externo_contas drop constraint if exists checkout_externo_contas_plataforma_check;
alter table public.checkout_externo_contas
  add constraint checkout_externo_contas_plataforma_check check (plataforma in ('sphere', 'cakto', 'hubla', 'eve'));


-- Conferir depois de aplicar:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('checkouts_externos_plataforma_check', 'checkout_externo_contas_plataforma_check');
--                                                     -- 2 linhas com 'sphere', 'cakto', 'hubla' e 'eve'
