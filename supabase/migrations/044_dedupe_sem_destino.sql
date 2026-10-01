-- ============================================================================
-- Conserta uma janela que a 043 abriu.
--
-- A 043 trocou o indice unico por um PARCIAL -- `where destination_id is not
-- null` -- mas o codigo em producao ainda grava sem destination_id. Entre a
-- migration e o deploy do codigo, nenhuma linha nova e coberta: a deduplicacao
-- fica DESLIGADA, e reentrega de webhook vira conversao dobrada.
--
-- Este indice cobre exatamente o caso que ficou fora. Os dois convivem: cada um
-- cuida de uma forma de linha, e nenhum evento fica sem chave.
--
-- Ele continua valendo depois do deploy, para a linha antiga e para qualquer
-- caminho que ainda nao carimbe o destino.
-- ============================================================================

create unique index if not exists tracking_events_dedupe_sem_destino_key
  on public.tracking_events (store_id, destination, event_id)
  where destination_id is null;
