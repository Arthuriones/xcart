-- ============================================================================
-- O teto por loja para de descartar evento em silencio.
--
-- O coletor e publico: quem dispara e o visitante da loja, e nao ha sessao para
-- autenticar. O teto por hora existe para ninguem inflar a conta de anuncios do
-- lojista chamando o endpoint em laco.
--
-- O PROBLEMA EM ESCALA
--
-- Quando o teto estoura, o evento e DESCARTADO e a resposta e 200. Ninguem
-- fica sabendo: nem o lojista, nem nos. Uma loja que cresceu simplesmente para
-- de medir metade do funil, e a tela continua dizendo que esta tudo bem.
--
-- Com uma loja isso nunca apareceu -- a maior fez 764 eventos no dia. Com
-- muitas lojas, uma delas vai passar, e o primeiro sintoma seria o lojista
-- reclamando que o Meta parou de otimizar.
--
-- O carimbo e o que torna visivel. A tela le e avisa.
-- ============================================================================

alter table public.tracking_configs
  add column if not exists teto_atingido_em timestamptz;

comment on column public.tracking_configs.teto_atingido_em is
  'Ultima vez que o teto por hora do coletor descartou evento desta loja. Carimbado no maximo uma vez por hora.';
