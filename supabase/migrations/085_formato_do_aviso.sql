-- ============================================================================
-- 085 -- O formato do ultimo aviso real de um checkout externo.
--
-- A Sphere nao documenta onde o aviso traz o clique do anuncio (sub1..sub5,
-- UTMs), e sem ele a venda nao liga a campanha. O xcart guarda aqui, a cada
-- aviso real, os CAMINHOS de chave do corpo e o valor SO das chaves de clique
-- (src/lib/checkouts-externos/plataformas/sphere.ts, formatoDoAvisoSphere):
-- nada do comprador. Uma linha por checkout, sobrescrita: nao cresce.
-- So o service role grava (receber.ts); sem a coluna, o webhook marca o resto.
-- ============================================================================

alter table public.checkouts_externos add column if not exists ultimo_formato jsonb;
