-- ============================================================================
-- 057 -- O checkout expresso espera o pixel: clientId na linha da fila.
--
-- O clique num botao de checkout expresso (Shop Pay, Apple/Google Pay) vira
-- begin_checkout no Meta pelo coletor, porque o Web Pixel nao roda na tela do
-- Shop Pay nem na janela da carteira. Mas o tema nao distingue a carteira do
-- "Comprar agora" quando o shadow DOM e fechado, e o "Comprar agora" cai no
-- checkout normal, onde o pixel manda o IC dele.
--
-- Entao o pixel vence: a linha do expresso nasce 'pendente' com
-- next_attempt_at 5 min a frente, e o begin_checkout do pixel do MESMO
-- comprador a cancela antes de o cron mandar. O pixel acha o comprador pelo
-- visitante do tema (resolvido pelo clientId) ou pelo clientId direto -- e o
-- clientId direto precisa estar na linha.
--
-- A coluna so e gravada na linha do expresso. O indice parcial cobre a busca
-- do pixel: so linha pendente com clientId, que e pouca e vive minutos.
--
-- SO ADITIVA. Nao mexe em dado nem em permissao.
-- ============================================================================

alter table public.tracking_events
  add column if not exists shopify_client_id text;

comment on column public.tracking_events.shopify_client_id is
  'clientId da Shopify do comprador, so na linha do checkout expresso: e por ele que o begin_checkout do Web Pixel acha e cancela o expresso pendente.';

create index if not exists tracking_events_expresso_cliente_idx
  on public.tracking_events (store_id, shopify_client_id)
  where status = 'pendente' and shopify_client_id is not null;
