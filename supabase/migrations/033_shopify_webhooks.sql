-- ============================================================================
-- Webhooks da Shopify: desinstalacao e idempotencia.
--
-- O xcart nao tinha NENHUM webhook da Shopify. Consequencia concreta: quando o
-- lojista desinstala o app, nada avisa. A loja fica no banco com token morto e
-- o auto-conserto continua tentando de hora em hora, gastando chamada e
-- sujando o log, ate alguem olhar. Pior: a rota continua marcada "Ativa" na
-- tela, entao o comprador vai para um checkout que nao responde mais.
--
-- Este arquivo cria as duas coisas que faltavam no banco:
--   1. onde marcar que a loja foi desinstalada;
--   2. onde lembrar que um webhook ja foi processado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Estado de instalacao da loja
-- ---------------------------------------------------------------------------

alter table public.stores
  add column if not exists uninstalled_at timestamptz;

comment on column public.stores.uninstalled_at is
  'Quando o app/uninstalled chegou. Nao-nulo = token morto, nao chame a Admin API.';

-- Fila do conserto: pular loja desinstalada sem varrer a tabela.
create index if not exists stores_instaladas_idx
  on public.stores (user_id)
  where uninstalled_at is null;

-- ---------------------------------------------------------------------------
-- 2. Idempotencia dos webhooks
-- ---------------------------------------------------------------------------
--
-- A Shopify reentrega. O proprio doc dela diz para tratar entrega duplicada
-- como normal: retry apos timeout, reenvio apos falha de rede, e as vezes duas
-- entregas do mesmo evento sem nenhuma falha. Processar "app/uninstalled"
-- duas vezes e inofensivo, mas o mesmo endpoint vai receber topicos que NAO
-- sao idempotentes, e a hora de criar a trava e antes disso.
--
-- A chave e o header X-Shopify-Webhook-Id, que a Shopify mantem estavel entre
-- as tentativas do MESMO evento.

create table if not exists public.shopify_webhook_events (
  webhook_id   text primary key,
  topic        text not null,
  shop_domain  text not null,
  store_id     uuid references public.stores (id) on delete set null,
  received_at  timestamptz not null default now()
);

comment on table public.shopify_webhook_events is
  'Ja processados. O insert e a trava: colisao de PK = entrega repetida, responde 200 e sai.';

-- Retencao: a janela de retry da Shopify e de 48 h. Guardar 30 dias e folga
-- de sobra e mantem a tabela pequena o suficiente para nunca doer.
create index if not exists shopify_webhook_events_received_idx
  on public.shopify_webhook_events (received_at);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
--
-- Quem escreve aqui e o handler do webhook, com service_role. Nenhum usuario
-- precisa ler. RLS ligada sem policy = ninguem entra pelo Data API, que e
-- exatamente o desejado (service_role passa por cima, como sempre).

alter table public.shopify_webhook_events enable row level security;

revoke all on table public.shopify_webhook_events from anon, authenticated;
