-- ============================================================================
-- "O pixel esta instalado" vira "o pixel foi visto em", e o motivo e um buraco.
--
-- A 041 criou `web_pixel_ativo`, um booleano que o coletor liga no primeiro
-- evento do pixel e que NUNCA desliga. Isso cria uma falha silenciosa: se o
-- lojista remover o Custom Pixel da Shopify, o coletor continua suprimindo o
-- `begin_checkout` que vem do tema -- e o evento simplesmente deixa de existir,
-- sem erro, sem fila parada, sem nada na tela.
--
-- O estado certo nao e "foi instalado um dia", e sim "esta mandando evento". O
-- carimbo responde isso e se cura sozinho: parou de chegar, o tema volta a
-- valer depois da janela.
-- ============================================================================

alter table public.tracking_configs
  add column if not exists web_pixel_visto_em timestamptz;

comment on column public.tracking_configs.web_pixel_visto_em is
  'Ultimo evento recebido do Custom Pixel. Suprimir o begin_checkout do tema depende DISTO, nao de um booleano -- pixel removido volta a deixar o tema cobrir, sem ninguem precisar notar.';

-- Quem ja estava marcado continua coberto: sem isto, ligar este deploy faria o
-- tema e o pixel contarem juntos ate o proximo checkout carimbar a coluna.
update public.tracking_configs
   set web_pixel_visto_em = now()
 where web_pixel_ativo is true and web_pixel_visto_em is null;

alter table public.tracking_configs
  drop column if exists web_pixel_ativo;
