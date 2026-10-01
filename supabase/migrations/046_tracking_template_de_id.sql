-- ============================================================================
-- O formato do id de produto passa a ser do DESTINO.
--
-- O PROBLEMA, MEDIDO
--
-- O feed que a Shopify manda para o Google Merchant Center identifica o item
-- como `shopify_<PAIS>_<idDoProduto>_<idDaVariante>`. Nos mandavamos o id da
-- variante cru -- "67606346727697" contra
-- "shopify_US_15406223950097_67606346727697". Nunca casou.
--
-- E a falha e silenciosa: o evento e aceito, a tela mostra "enviado", e o
-- anuncio dinamico simplesmente nao serve aquele item. No painel aparece como
-- "98% of id values didn't match your feed", que ninguem ve sem procurar.
--
-- POR QUE POR DESTINO, E NAO POR LOJA
--
-- O catalogo do Meta e o feed do Google sao dois catalogos distintos, montados
-- por caminhos distintos na mesma loja. Uma coluna por loja obrigaria a
-- escolher qual das duas plataformas ficaria errada.
--
-- POR QUE TEMPLATE, E NAO TRES OPCOES
--
-- Nao ha um formato certo: variante, produto, SKU e o formato do feed da
-- Shopify sao todos reais, e loja que exporta por planilha inventa prefixo
-- proprio. O lojista cola o formato que o catalogo dele ja usa.
--
-- NULL = `{variant_id}`, que e exatamente o que o codigo fazia antes. Destino
-- que ja estava casando nao pode mudar de formato por causa desta migration.
-- ============================================================================

alter table public.tracking_destinations
  add column if not exists id_template text;

comment on column public.tracking_destinations.id_template is
  'Formato do id de produto, com {variant_id}, {product_id} e {sku}. NULL = {variant_id}, o comportamento anterior.';

-- O valor vai cru para dentro de `content_ids` do Meta e de `ecomm_prodid` do
-- Google. O CHECK aqui e a ultima barreira: a API valida melhor (exige ao menos
-- um marcador conhecido), mas o script de operacao escreve direto na tabela.
alter table public.tracking_destinations
  drop constraint if exists tracking_destinations_id_template_valido;
alter table public.tracking_destinations
  add constraint tracking_destinations_id_template_valido
  check (
    id_template is null
    or (
      length(id_template) between 1 and 120
      and id_template ~ '\{(variant_id|product_id|sku)\}'
      and id_template !~ '[^A-Za-z0-9_.{}-]'
    )
  );
