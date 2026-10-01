-- ============================================================================
-- O interruptor da loja para de depender das colunas legadas.
--
-- Desde a 043 o destino e LINHA em tracking_destinations, nao coluna em
-- tracking_configs. Mas `tracking_configs_ligado_precisa_destino` ainda testava
-- as colunas: loja cujos destinos moram so na tabela nova nao conseguiria mais
-- ligar o rastreamento -- o CHECK recusaria o UPDATE de `enabled`.
--
-- POR QUE O CHECK NAO VIRA OUTRO CHECK
--
-- A invariante que ele guardava ("ligado precisa de destino") passou a ser
-- entre TABELAS, e CHECK nao consulta outra tabela. Trigger daria, mas nao
-- fecharia o buraco de verdade: o destino pode ser apagado depois, e a loja
-- continuaria ligada sem destino de qualquer forma.
--
-- Entao a garantia muda de lugar com honestidade: a API recusa ligar sem
-- destino que de fato envie, e a tela mostra "ligado, nenhum destino recebe" em
-- vez de fingir que esta tudo certo. Ligado sem destino nao envia nada -- e
-- visivel, nao silencioso.
-- ============================================================================

alter table public.tracking_configs
  drop constraint if exists tracking_configs_ligado_precisa_destino;

-- As colunas legadas FICAM. Nao sao mais lidas por nada no app, mas sao a copia
-- de onde a 043 migrou cada destino -- apagar agora tiraria a unica forma de
-- conferir a migracao se alguma linha tiver vindo errada.
comment on column public.tracking_configs.google_conversion_id is
  'LEGADO: migrado para tracking_destinations pela 043. Nao e mais lido.';
comment on column public.tracking_configs.meta_pixel_id is
  'LEGADO: migrado para tracking_destinations pela 043. Nao e mais lido.';

-- A tela filtra por loja e lista os destinos de cada uma; sem isto a consulta
-- varre a tabela por loja aberta.
create index if not exists tracking_destinations_loja_plataforma_idx
  on public.tracking_destinations (store_id, plataforma, created_at);
