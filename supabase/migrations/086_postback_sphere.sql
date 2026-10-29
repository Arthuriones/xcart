-- ============================================================================
-- 086 -- O postback da Sphere: de que anuncio veio a comissao.
--
-- O webhook da Sphere NAO traz o clique (sub1/UTM): o aviso real de 29/10
-- so tem pedido, comissao e afiliado (085, ultimo_formato). O unico dado do
-- clique que ela devolve por servidor e o sub1, no `{clickid}` do postback
-- GET que cada programa configura (vaga do RedTrack). Nos url_tags do
-- Arthur o sub1 e o id do anuncio do Meta.
--
-- O postback chega na MESMA URL do webhook, em GET com a query
-- (src/app/api/webhooks/checkout/[token]/route.ts), e fica aqui ate casar
-- com o pedido que o webhook gravou: pelo `{t}` na hora, se for o mesmo id;
-- senao pela hora do aviso, decidida pelo cron do drain so com a janela
-- fechada. Dois pedidos na janela = nao casa, nunca chuta. Casado, o pedido
-- ganha a UTM e os ids do anuncio (src/lib/checkouts-externos/postback.ts).
--
-- Sem dado do comprador: a URL que o xcart da so leva clickid, t, sum,
-- currency, status e type. So o service role le e grava (sem policy).
-- Linha com mais de 30 dias sai no cron.
-- ============================================================================

create table if not exists public.checkout_externo_postbacks (
  id           bigint generated always as identity primary key,
  checkout_id  uuid not null references public.checkouts_externos(id) on delete cascade,
  recebido_em  timestamptz not null default now(),
  -- O `{clickid}` (sub1) como chegou, e o id do anuncio quando ele e um.
  clickid      text check (clickid is null or length(clickid) <= 200),
  anuncio_id   text check (anuncio_id is null or anuncio_id ~ '^\d{5,25}$'),
  -- O `{t}` (o painel chama de "ID do pedido").
  pedido_ref   text check (pedido_ref is null or pedido_ref ~ '^[A-Za-z0-9_-]{1,64}$'),
  soma         numeric(12,2) check (soma is null or (soma >= 0 and soma <= 100000)),
  moeda        text check (moeda is null or moeda ~ '^[A-Z]{3}$'),
  status       text check (status is null or length(status) <= 40),
  -- pendente: o cron ainda decide. casado: o pedido_id ganhou a origem.
  -- conflito: o pedido_id ja tinha OUTRO anuncio (nada mudou). ambiguo e
  -- sem_pedido: a janela fechou com dois ou nenhum. sem_anuncio: o clickid
  -- nao e id de anuncio.
  situacao     text not null default 'pendente'
               check (situacao in ('pendente', 'casado', 'conflito', 'ambiguo', 'sem_pedido', 'sem_anuncio')),
  pedido_id    text,
  casado_em    timestamptz,
  constraint checkout_externo_postbacks_sem_email check (
    (coalesce(clickid, '') || coalesce(status, '')) !~ '@'
  )
);

-- O cron le os pendentes pela hora e apaga o que passou dos 30 dias. A
-- janela do casamento le as travas pelo checkout_externo_eventos_recentes_idx
-- (checkout_id, recebido_em desc), que ja existe.
create index if not exists checkout_externo_postbacks_recebido_idx
  on public.checkout_externo_postbacks (recebido_em);

alter table public.checkout_externo_postbacks enable row level security;
revoke all on public.checkout_externo_postbacks from public, anon, authenticated;
grant all on public.checkout_externo_postbacks to service_role;

-- Conferir:
--   select has_table_privilege('authenticated', 'public.checkout_externo_postbacks', 'select'); -- false
--   select relrowsecurity from pg_class where relname = 'checkout_externo_postbacks';          -- true
