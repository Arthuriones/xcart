-- ============================================================================
-- 063 -- Notificacao de venda no celular (Pushcut, ntfy, Discord, webhook).
--
-- O lojista cola uma URL de webhook e o xcart chama ela a cada venda, pelo
-- webhook orders/create da loja. Ver src/lib/alertas/venda-webhook.ts.
--
--   alerta_config.notificar_vendas      liga/desliga, sem apagar a URL.
--   alerta_config_secrets.venda_webhook_url
--     A URL e SEGREDO: a do Pushcut carrega a chave da conta, a do ntfy e o
--     proprio topico. Mesma tabela do token do bot -- sem policy, so o
--     service_role le --, e nunca volta inteira para a tela (so o host).
-- ============================================================================

alter table public.alerta_config
  add column if not exists notificar_vendas boolean not null default true;

alter table public.alerta_config_secrets
  add column if not exists venda_webhook_url text
  check (venda_webhook_url is null or (venda_webhook_url ~ '^https://' and length(venda_webhook_url) <= 2000));

-- Conferir depois de aplicar:
--   select column_name from information_schema.columns
--    where table_name in ('alerta_config', 'alerta_config_secrets')
--      and column_name in ('notificar_vendas', 'venda_webhook_url');
--   select has_table_privilege('authenticated', 'public.alerta_config_secrets', 'select'); -- false
