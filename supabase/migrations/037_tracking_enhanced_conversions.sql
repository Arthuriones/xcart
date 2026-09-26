-- ============================================================================
-- Enhanced conversions do Google Ads, pelo caminho documentado.
--
-- POR QUE UMA SEGUNDA CHAMADA, E NAO UM CAMPO NO PING QUE JA EXISTE
--
-- O ping de /pagead/conversion carrega o dado hasheado no parametro `em`, mas
-- quem monta esse parametro e o gtag, a partir de configuracao que o Google
-- entrega por acao de conversao. Foi medido: com allow_enhanced_conversions
-- ligado e user_data preenchido, o gtag manda `gtm_ee=1` e NAO manda `em`
-- enquanto o Google nao reconhecer a acao como habilitada. Nao da para
-- reproduzir o encoding por observacao, e chutar aqui falha calado -- o
-- endpoint responde 200 de qualquer jeito.
--
-- O caminho suportado e ConversionAdjustmentUploadService com
-- adjustmentType = ENHANCEMENT, chaveado por ORDER ID. Ele nao substitui a
-- conversao: complementa uma que ja existe. Encaixa no que ja esta no ar,
-- porque o nosso ping manda `oid` = id do pedido da Shopify, que e o mesmo
-- transaction id que a tag mandaria.
--
-- A alternativa -- deixar um pixel no navegador emitir a conversao com EC --
-- criaria DOIS emissores da mesma venda, deduplicados pelo oid. O Google
-- mantem o primeiro que chega: se o pixel chegasse antes, a conversao perderia
-- o gclid. Trocar atribuicao garantida por EC marginal e mau negocio.
--
-- O QUE E SEGREDO E O QUE NAO E
--
-- developer token e client id/secret do OAuth sao do xcart, nao do lojista:
-- ficam em variavel de ambiente. Por loja o que existe e o refresh token da
-- conta Google DELE -- esse vai para tracking_secrets, que so o service_role
-- le. Refresh token do Google Ads da acesso de escrita a conta de anuncios.
-- ============================================================================

alter table public.tracking_configs
  add column if not exists google_customer_id          text,
  add column if not exists google_login_customer_id    text,
  add column if not exists google_conversion_action_id  text;

comment on column public.tracking_configs.google_customer_id is
  'Customer id da conta de anuncios, so digitos (1234567890, sem hifen). E o {customerId} da URL do upload.';
comment on column public.tracking_configs.google_login_customer_id is
  'Customer id da MCC, quando a conta e gerenciada. Vira o header login-customer-id. Nulo em conta avulsa.';
comment on column public.tracking_configs.google_conversion_action_id is
  'Id numerico da conversion action, descoberto pelo rotulo e guardado. O rotulo identifica a conversao na tag; a API exige o id numerico, que e outro numero.';

-- O refresh token e do lojista e da escrita na conta de anuncios dele. Mesmo
-- tratamento do token do Meta: tabela que so o service_role alcanca.
alter table public.tracking_secrets
  add column if not exists google_refresh_token text;

comment on column public.tracking_secrets.google_refresh_token is
  'Refresh token OAuth da conta Google Ads do lojista. Da escrita na conta: nunca sai para o cliente.';

-- Enhancement e um destino proprio na fila, nao um campo da linha da conversao.
-- Dois motivos: ele so pode ir DEPOIS que a conversao base existe no Google, e
-- ele falha por motivos proprios (credencial, acao sem EC habilitado). Junto na
-- mesma linha, uma falha esconderia a outra.
alter table public.tracking_events
  drop constraint if exists tracking_events_destination_check;
alter table public.tracking_events
  add constraint tracking_events_destination_check
  check (destination in ('meta', 'google', 'google_ec', 'ga4'));
