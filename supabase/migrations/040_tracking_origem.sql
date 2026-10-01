-- ============================================================================
-- De onde o visitante veio.
--
-- Faltou tres vezes seguidas investigando por que nenhum `gclid` chegava numa
-- loja com trafego: da para ver QUANTOS eventos tem click id, e nao da para ver
-- de onde vieram os que NAO tem. Sem isso, "o Google mandou trafego hoje" e
-- "a Shopify chama busca organica do google.com de Google" sao indistinguiveis
-- do nosso lado -- e sao diagnosticos opostos.
--
-- Guarda o document.referrer da PRIMEIRA pagina da sessao, nao a URL atual.
-- `event_source_url`, que ja existia no payload do Meta, e a pagina onde o
-- evento aconteceu: depois do primeiro clique interno ela vira a propria loja e
-- nao diz mais nada sobre a origem.
-- ============================================================================

alter table public.tracking_events
  add column if not exists referrer text;

comment on column public.tracking_events.referrer is
  'document.referrer da primeira pagina da sessao, como o navegador mandou. Vazio = acesso direto, app, ou referrer suprimido. So em evento que nasce no navegador.';

-- Agrupar por origem e por dia e a consulta que isto serve.
create index if not exists tracking_events_loja_referrer_idx
  on public.tracking_events (store_id, created_at desc)
  where referrer is not null;
