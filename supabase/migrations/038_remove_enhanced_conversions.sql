-- ============================================================================
-- Desfaz a 037: enhanced conversions sai.
--
-- A 037 ficou no historico de proposito, em vez de eu apagar o arquivo: ela
-- rodou no banco de producao, e reescrever o registro esconderia por onde o
-- schema passou. Quem montar um banco novo roda as duas e chega no mesmo lugar
-- (os `if exists` cuidam disso).
--
-- POR QUE SAIU
--
-- Enhanced conversions pela Google Ads API exigia, por loja: developer token de
-- producao, client OAuth, refresh token do lojista e a acao de conversao marcada
-- como "Google Ads API" no painel. O requisito do produto e outro -- o
-- rastreamento tem que funcionar com ID de conversao e rotulo, e mais nada, do
-- mesmo jeito que o lojista ja conhece de outras ferramentas.
--
-- O que sobra e o que ja estava funcionando e nao dependia disso: a conversao
-- enviada do servidor quando o pedido entra, com gclid/gbraid/wbraid e `oid`
-- para deduplicar. ID e rotulo bastam.
--
-- Nenhuma das colunas tinha valor gravado quando esta migration foi escrita --
-- conferido linha por linha antes do drop.
-- ============================================================================

alter table public.tracking_configs
  drop column if exists google_customer_id,
  drop column if exists google_login_customer_id,
  drop column if exists google_conversion_action_id;

alter table public.tracking_secrets
  drop column if exists google_refresh_token;

-- Volta a lista de destinos de antes. Nao havia nenhuma linha 'google_ec' na
-- fila, entao o check mais estreito nao rejeita nada que ja exista.
alter table public.tracking_events
  drop constraint if exists tracking_events_destination_check;
alter table public.tracking_events
  add constraint tracking_events_destination_check
  check (destination in ('meta', 'google', 'ga4'));
