-- ============================================================================
-- 065 -- Storage sem listagem publica + teto por IP no coletor.
--
-- ADITIVA E IDEMPOTENTE. Pode rodar de novo sem efeito. O codigo funciona
-- antes e depois dela: sem a coluna `ip_hash`, o coletor grava sem ela e o
-- teto por IP fica cego (nao fechado).
--
-- ---------------------------------------------------------------------------
-- 1) STORAGE: anonimo listava TODOS os arquivos de todos os clientes.
--
-- "Anyone can read logos / product images / store assets" (003, 004, 005) sao
-- SELECT para {public} -- inclui o anon. Bucket publico NAO precisa delas para
-- servir /storage/v1/object/public/...: esse caminho nao passa por RLS. Elas
-- so serviam para LISTAR. Com a anon key do bundle, um
--   POST /storage/v1/object/list/store-logos  {"prefix": ""}
-- devolvia o user_id de cada cliente; com prefix '<uid>/', o store_id e os
-- arquivos -- inclusive as fotos -neutral e -branded lado a lado.
--
-- O dono continua lendo a propria pasta: download() pela sessao em
-- /api/image/generate e /api/image/branded, upsert:true e remove() em
-- /api/store-assets (UPDATE/DELETE com RETURNING precisam enxergar a linha).
-- Conferido em 2026-10-08: os 7 logo_path e o 1 store_assets.file_path estao
-- todos na pasta do dono.
--
-- ---------------------------------------------------------------------------
-- 2) TETO POR IP em /api/tracking/collect.
--
-- O teto da loja e um balde so por hora, e storeId/shop estao no HTML do tema:
-- uma origem so, trocando o visitorId, enchia o balde de outra pessoa e o
-- funil real parava ate a hora virar. O coletor agora conta, por loja e por
-- hora, as linhas e as identidades novas de cada IP antes do teto da loja.
-- `ip_hash` e HMAC do IP (IPv6 pelo /64) -- ver src/lib/tracking/ip-balde.ts.
-- ============================================================================

-- 1) Storage --------------------------------------------------------------------

drop policy if exists "Anyone can read logos" on storage.objects;
drop policy if exists "Anyone can read product images" on storage.objects;
drop policy if exists "Anyone can read store assets" on storage.objects;

drop policy if exists "Dono le a propria pasta" on storage.objects;
create policy "Dono le a propria pasta"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('store-logos', 'product-images', 'store-assets')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- 2) Teto por IP -------------------------------------------------------------------

alter table public.tracking_events
  add column if not exists ip_hash text
  check (ip_hash is null or length(ip_hash) <= 64);

alter table public.tracking_identities
  add column if not exists ip_hash text
  check (ip_hash is null or length(ip_hash) <= 64);

-- As duas contagens do coletor: (store_id, ip_hash, created_at >= agora - 1 h).
-- Parciais: compra do webhook e linha antiga nao tem ip_hash.
create index if not exists tracking_events_loja_ip_idx
  on public.tracking_events (store_id, ip_hash, created_at)
  where ip_hash is not null;

create index if not exists tracking_identities_loja_ip_idx
  on public.tracking_identities (store_id, ip_hash, created_at)
  where ip_hash is not null;

-- ============================================================================
-- Conferir depois de aplicar:
--
-- -- (a) Nenhuma policy de leitura para public/anon nos tres buckets; so a do dono.
--   select policyname, cmd, roles, qual
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT';
--   -- esperado: uma linha, "Dono le a propria pasta", roles {authenticated}
--
-- -- (b) Anon nao lista mais nada (deve dar 0 em todos os buckets):
--   begin read only;
--   set local role anon;
--   select bucket_id, count(*) from storage.objects group by 1;
--   rollback;
--
-- -- (c) O link publico continua servindo (fora do SQL, deve dar 200):
--   curl -sI "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/public/store-logos/<logo_path>"
--
-- -- (d) Colunas e indices do teto por IP:
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and column_name = 'ip_hash';
--   -- esperado: tracking_events e tracking_identities
--   select indexname from pg_indexes
--    where indexname in ('tracking_events_loja_ip_idx', 'tracking_identities_loja_ip_idx');
--
-- -- (e) Depois do deploy, as linhas novas do coletor chegam com ip_hash:
--   select count(*) filter (where ip_hash is not null) com_ip, count(*) total
--     from public.tracking_events
--    where created_at > now() - interval '1 hour' and visitor_id is not null;
-- ============================================================================
