-- ============================================================================
-- Web Pixel no checkout, e a tabela de identidade saindo do papel.
--
-- O PROBLEMA QUE ISTO RESOLVE
--
-- O snippet do tema nao entra no checkout da Shopify -- o checkout nao e tema.
-- Por isso `begin_checkout` hoje e o CLIQUE no botao, e nao existe
-- `payment_info_submitted`, que e o passo que separa "desistiu no frete" de
-- "cartao recusou".
--
-- O Web Pixel entra. Mas ele roda em sandbox e NAO LE OS COOKIES DA LOJA --
-- entao ele nao enxerga o nosso `_xc_gclid`. Ou seja, o evento chega sabendo
-- que aconteceu e sem saber de qual anuncio veio.
--
-- A ponte e o identificador de visitante da propria Shopify
-- (ShopifyAnalytics.lib.user().traits().uniqToken no tema, `event.clientId` no
-- pixel). O snippet grava a associacao "clientId -> click ids" aqui, e o evento
-- do pixel consulta por ela.
--
-- `tracking_identities` ja existia para isso e nunca foi preenchida: o webhook
-- le e ninguem escreve. Agora o coletor escreve.
-- ============================================================================

alter table public.tracking_identities
  add column if not exists shopify_client_id text,
  -- gbraid faltava: so wbraid existia, e o Google manda um OU outro no iOS.
  -- Sem a coluna, metade do trafego de app ficava sem onde guardar.
  add column if not exists gbraid text,
  add column if not exists auid text;

comment on column public.tracking_identities.shopify_client_id is
  'Identificador de visitante da Shopify. E a UNICA chave que o Web Pixel conhece: ele roda em sandbox e nao le cookie da loja.';

-- A consulta do pixel e sempre por esta chave.
create index if not exists tracking_identities_shopify_client_idx
  on public.tracking_identities (store_id, shopify_client_id)
  where shopify_client_id is not null;

-- Uma linha por visitante por loja. Sem isto, cada evento criaria outra linha e
-- a consulta do pixel acharia varias identidades parciais em vez de uma.
create unique index if not exists tracking_identities_loja_visitante_key
  on public.tracking_identities (store_id, visitor_id);

-- ---------------------------------------------------------------------------
-- checkout_token: a chave de juncao que nao depende de cart attribute
-- ---------------------------------------------------------------------------
--
-- Hoje o elo visitante -> pedido e o cart attribute. Ele funciona e tem um
-- buraco medido: o pedido #NM100499 chegou SEM ATRIBUTO NENHUM, porque a sessao
-- comecou no proprio checkout. Com o token, esse pedido ainda teria dono.
alter table public.tracking_events
  add column if not exists checkout_token text;

comment on column public.tracking_events.checkout_token is
  'Token do checkout da Shopify. Liga evento de checkout ao pedido sem depender de cart attribute, que se perde quando a sessao comeca no proprio checkout.';

-- ---------------------------------------------------------------------------
-- Quem cobre o checkout: o tema ou o pixel
-- ---------------------------------------------------------------------------
--
-- Com o pixel ativo, o clique no botao (tema) e o `checkout_started` (pixel)
-- descrevem a MESMA acao. Os dois contariam duas conversoes, e eles nao tem como
-- compartilhar event_id -- um nasce do clique, o outro do checkout.
--
-- A decisao fica no SERVIDOR, nao no tema: assim ligar o pixel nao exige
-- reinstalar snippet em loja nenhuma, e nao ha janela em que os dois valem.
alter table public.tracking_configs
  add column if not exists web_pixel_ativo boolean not null default false;

comment on column public.tracking_configs.web_pixel_ativo is
  'O Custom Pixel esta instalado? Quando sim, o coletor ignora o begin_checkout vindo do tema -- o do pixel e o checkout de verdade.';
