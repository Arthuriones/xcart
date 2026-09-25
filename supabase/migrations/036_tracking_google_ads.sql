-- ============================================================================
-- Google Ads no rastreamento server-side.
--
-- A 035 nasceu so com o Meta e cravou uma regra que hoje atrapalha: "ligado
-- exige meta_pixel_id". Loja que so usa Google nao conseguiria ativar -- o
-- banco recusaria a linha.
--
-- Aqui entram as colunas do Google e a regra vira "ligado exige PELO MENOS UM
-- destino configurado".
-- ============================================================================

alter table public.tracking_configs
  add column if not exists google_conversion_id    text,
  add column if not exists google_conversion_label text;

comment on column public.tracking_configs.google_conversion_id is
  'O AW-XXXXXXXXX do Google Ads. Guardado com o prefixo, como o lojista copia.';
comment on column public.tracking_configs.google_conversion_label is
  'Rotulo da conversion action. O par id+rotulo identifica UMA conversao.';

-- Nem id nem rotulo sao segredo -- vao no navegador em qualquer instalacao
-- normal do gtag. Por isso ficam em tracking_configs, que o lojista le, e nao
-- em tracking_secrets.

alter table public.tracking_configs
  drop constraint if exists tracking_configs_ligado_precisa_pixel;

alter table public.tracking_configs
  drop constraint if exists tracking_configs_ligado_precisa_destino;
alter table public.tracking_configs
  add constraint tracking_configs_ligado_precisa_destino
  check (
    enabled = false
    or nullif(btrim(meta_pixel_id), '') is not null
    or (
      nullif(btrim(google_conversion_id), '') is not null
      and nullif(btrim(google_conversion_label), '') is not null
    )
  );

comment on constraint tracking_configs_ligado_precisa_destino on public.tracking_configs is
  'Ligado sem destino nao envia nada e ainda mostra "ativo" na tela. O Google exige id E rotulo: um sem o outro nao identifica conversao nenhuma.';
