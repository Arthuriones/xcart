-- ============================================================================
-- 070 -- "Venda no celular" em varios celulares.
--
-- A 063 guardava UMA URL por usuario (alerta_config_secrets.venda_webhook_url).
-- Agora cada celular e uma linha: um nome curto ("Celular do Arthur"), a URL
-- e como foi o ultimo envio. O liga/desliga geral continua em
-- alerta_config.notificar_vendas. Ver src/lib/alertas/venda-webhook.ts.
--
-- A URL e SEGREDO (a do Pushcut tem a chave da conta; a do ntfy e o proprio
-- topico): RLS ligada e ZERO policy, como checkout_externo_segredos na 069 e
-- alerta_config_secrets na 052. So o service_role le e grava; as rotas
-- /api/alertas/venda-webhook conferem o dono pela sessao e a tela recebe so o
-- host.
--
-- SO ACRESCENTA. A coluna da 063 fica (o codigo antigo continua lendo dela
-- num rollback) e a URL que ja existe vira o primeiro celular ("Celular").
-- O codigo le daqui e, sem esta tabela (42P01/PGRST205), cai na coluna
-- antiga: funciona antes e depois desta migration. Remover um celular pela
-- tela tambem limpa a coluna antiga quando e a mesma URL, entao rodar esta
-- migration de novo nao ressuscita celular removido.
--
-- ORDEM: DEPLOY PRIMEIRO, ESTA MIGRATION DEPOIS. Antes do deploy, o codigo
-- antigo so grava na coluna da 063: URL removida nesse intervalo continuaria
-- aqui (e voltaria a receber), URL nova ficaria so na coluna (que o codigo
-- novo ignora quando esta tabela existe). Rodando depois do deploy, a copia
-- pega o estado final da coluna. Se ja rodou antes do deploy, rode de novo o
-- INSERT abaixo (idempotente) depois dele e confira com as consultas do fim.
-- ============================================================================

create table if not exists public.venda_webhooks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  nome             text not null default 'Celular'
                   check (length(btrim(nome)) between 1 and 40),
  -- Mesmo CHECK da 063.
  url              text not null
                   check (url ~ '^https://' and length(url) <= 2000),
  created_at       timestamptz not null default now(),
  -- O ultimo envio (venda ou teste) e o erro DELE: null = chegou. O texto e
  -- montado so com o host e o status -- nunca a URL.
  ultimo_envio_em  timestamptz,
  ultimo_erro      text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  constraint venda_webhooks_user_url_key unique (user_id, url)
);

-- A leitura e sempre "os celulares deste usuario, na ordem do cadastro".
create index if not exists venda_webhooks_user_idx
  on public.venda_webhooks (user_id, created_at);


-- ---------------------------------------------------------------------------
-- Segredo: RLS ligada e ZERO policy = ninguem entra pelo Data API. E os dois
-- caminhos de privilegio fechados (o grant a PUBLIC e o do default
-- privileges do Supabase), como na 027.
-- ---------------------------------------------------------------------------
alter table public.venda_webhooks enable row level security;
revoke all on table public.venda_webhooks from public, anon, authenticated;
grant select, insert, update, delete on table public.venda_webhooks to service_role;


-- ---------------------------------------------------------------------------
-- A URL da 063 vira o primeiro celular. Idempotente: o unique (user_id, url)
-- e o on conflict seguram a segunda passada.
-- ---------------------------------------------------------------------------
insert into public.venda_webhooks (user_id, nome, url)
select s.user_id, 'Celular', btrim(s.venda_webhook_url)
  from public.alerta_config_secrets s
 where s.venda_webhook_url is not null
   and btrim(s.venda_webhook_url) ~ '^https://'
   and length(btrim(s.venda_webhook_url)) <= 2000
on conflict (user_id, url) do nothing;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada):
--   select has_table_privilege('authenticated', 'public.venda_webhooks', 'select');  -- false
--   select has_table_privilege('authenticated', 'public.venda_webhooks', 'insert');  -- false
--   select has_table_privilege('anon', 'public.venda_webhooks', 'select');           -- false
--   select has_table_privilege('service_role', 'public.venda_webhooks', 'select');   -- true
--   select has_table_privilege('service_role', 'public.venda_webhooks', 'update');   -- true
--   select count(*) from pg_policies where tablename = 'venda_webhooks';             -- 0
--   select relrowsecurity from pg_class where relname = 'venda_webhooks';            -- true
--   -- Toda URL antiga copiada (os dois numeros iguais):
--   select count(*) from public.alerta_config_secrets where venda_webhook_url is not null;
--   select count(distinct user_id) from public.venda_webhooks;
