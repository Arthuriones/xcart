-- ============================================================================
-- Saber se o pixel do checkout instalado e a versao com o id da loja.
--
-- A 2f8c4da passou o trecho colado a carregar `?store=<uuid>`: sem ele o
-- coletor so tem o dominio, e qualquer conta do xcart que cadastrasse o mesmo
-- dominio desviaria os eventos do checkout. O trecho antigo continua
-- funcionando, mas sem essa protecao -- e a tela nao tinha como saber qual dos
-- dois estava colado, entao nao tinha como pedir para atualizar.
--
-- Mesmo desenho do `web_pixel_visto_em`: CARIMBO, nao booleano. O pixel novo
-- se anuncia mandando o storeId, e se alguem voltar para o trecho antigo o
-- carimbo envelhece e a tela volta a pedir a atualizacao sozinha.
-- ============================================================================

alter table public.tracking_configs
  add column if not exists web_pixel_com_id_em timestamptz;

comment on column public.tracking_configs.web_pixel_com_id_em is
  'Ultima vez que chegou evento do Web Pixel COM o id da loja (trecho novo). Carimbado no maximo uma vez por hora.';
