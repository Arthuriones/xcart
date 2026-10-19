-- ============================================================================
-- 073 -- Checkout externo: a compra pelo SERVIDOR ao Meta e ao TikTok (Cakto).
--
-- Decisao do Arthur (19/10/2026): nas vendas da Cakto quem manda a compra ao
-- Meta (Conversions API) e ao TikTok (Events API) e o xcart. O lojista tira o
-- pixel e o token nativos da Cakto (um emissor por pixel). O Google fica com
-- a tag nativa da Cakto: nada de Google aqui. A Sphere (comissao) nao ganha
-- rastreamento: nao manda dado do comprador nem click id.
--
-- TABELAS IRMAS das tracking_* das lojas: so acrescentam. Nada aqui encosta
-- em tracking_destinations, tracking_events, tracking_identities, no painel,
-- no feed ou no purge_tracking das lojas Shopify.
--
--   1. checkouts_externos.compra_quando   'gerada' (padrao) | 'aprovada'
--   2. checkout_externo_destinos          um pixel Meta e um TikTok por checkout
--   3. checkout_externo_destino_segredos  o token de cada um (ZERO policy)
--   4. checkout_externo_envios            a fila: unique (destino_id, event_id)
--   5. checkout_externo_identidades       o visitante da ponte (Fase D)
--   6. purge_checkout_externo_rastreio()  SECURITY DEFINER, so service_role
--
-- DADO PESSOAL: o payload da fila leva e-mail, telefone, nome, cidade, estado,
-- CEP e pais SO EM SHA-256 (src/lib/checkouts-externos/compra.ts), e sai no
-- purge: entregue em 8 dias; o que nao saiu perde o payload em 8 e a linha em
-- 30. O CHECK sem "@" no payload e a trava de que e-mail em claro nunca entra.
-- O lojista le o estado da fila (status, tentativas, erro) e NUNCA o payload
-- nem a resposta: o grant e por coluna. pedidos_externos continua sem dado
-- pessoal (072).
--
-- PERMISSOES: o lojista LE pela RLS (destinos e a fila, sem o payload); quem
-- escreve e so o service_role (o webhook, as rotas /api/checkouts e o cron do
-- drain). Segredo e identidade: RLS ligada e ZERO policy. Os dois caminhos de
-- privilegio fechados (o grant a PUBLIC e o do default privileges do
-- Supabase, 027) -- e o fim da migration CONFERE com has_*_privilege e
-- aborta se sobrou algum.
--
-- ORDEM: aplicar ANTES do deploy (recomendado). O codigo novo le com e sem
-- esta migration (sem ela: nenhum destino, o webhook segue como antes, a tela
-- de rastreamento do checkout diz que ainda nao foi liberado e o limite do
-- plano nao conta checkout). O codigo velho nao le nada daqui.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Quando a compra sai
-- ---------------------------------------------------------------------------
-- 'gerada': no PRIMEIRO evento de venda da cobranca (Pix/boleto/PicPay gerado
-- ou o cartao aprovado). 'aprovada': so no purchase_approved. Nos dois, uma
-- compra por cobranca: o Pix pago depois do gerado nao manda de novo.
alter table public.checkouts_externos
  add column if not exists compra_quando text not null default 'gerada';

alter table public.checkouts_externos drop constraint if exists checkouts_externos_compra_quando_check;
alter table public.checkouts_externos
  add constraint checkouts_externos_compra_quando_check check (compra_quando in ('gerada', 'aprovada'));


-- ---------------------------------------------------------------------------
-- 2. Os destinos do checkout
-- ---------------------------------------------------------------------------
create table if not exists public.checkout_externo_destinos (
  id               uuid primary key default gen_random_uuid(),
  checkout_id      uuid not null,
  -- Denormalizado do checkout (a FK composta garante que e o mesmo): a RLS
  -- e a contagem do limite do plano ficam sem join.
  user_id          uuid not null,
  plataforma       text not null check (plataforma in ('meta', 'tiktok')),
  -- Id do pixel no Meta (so digitos); Pixel Code no TikTok (letras e digitos).
  conta            text not null,
  -- Joga o evento para a aba de teste do Gerenciador de Eventos.
  test_event_code  text check (test_event_code is null or test_event_code ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Ligado = conta no limite de rastreamento do plano (src/lib/billing/limites.ts).
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint checkout_externo_destinos_conta_check check (
    (plataforma = 'meta' and conta ~ '^[0-9]{5,25}$')
    or (plataforma = 'tiktok' and conta ~ '^[A-Za-z0-9]{10,30}$')),
  constraint checkout_externo_destinos_checkout_fk
    foreign key (checkout_id, user_id)
    references public.checkouts_externos (id, user_id) on delete cascade,
  -- Alvo da FK composta da fila: a linha da fila e do MESMO checkout e dono.
  constraint checkout_externo_destinos_alvo_key unique (id, checkout_id, user_id)
);

-- Um pixel por rede em cada checkout (a tela edita um Meta e um TikTok).
create unique index if not exists checkout_externo_destinos_rede_key
  on public.checkout_externo_destinos (checkout_id, plataforma);

-- lerUso do limite do plano: os destinos ligados do usuario.
create index if not exists checkout_externo_destinos_user_idx
  on public.checkout_externo_destinos (user_id)
  where ativo;


-- ---------------------------------------------------------------------------
-- 3. O token de cada destino
-- ---------------------------------------------------------------------------
-- O token posta conversao na conta de anuncios do lojista. Tabela separada
-- porque RLS e por LINHA, nao por coluna (o mesmo motivo da 043).
create table if not exists public.checkout_externo_destino_segredos (
  destino_id    uuid primary key
                references public.checkout_externo_destinos (id) on delete cascade,
  access_token  text not null
                check (length(access_token) between 10 and 1000 and access_token !~ '\s'),
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 4. A fila de envios
-- ---------------------------------------------------------------------------
-- A linha nasce 'pendente' ANTES de qualquer chamada de rede (o webhook grava
-- e responde; o envio sai depois). O indice unico (destino_id, event_id) e a
-- trava contra a compra em dobro: event_id e um por cobranca
-- (purchase_cakto_<grupo>), entao o Pix pago, a retentativa e o order bump
-- que chega em outra entrega caem em "duplicado".
create table if not exists public.checkout_externo_envios (
  id               uuid primary key default gen_random_uuid(),
  checkout_id      uuid not null,
  user_id          uuid not null,
  destino_id       uuid not null,
  plataforma       text not null check (plataforma in ('meta', 'tiktok')),
  event_name       text not null check (length(event_name) between 1 and 40),
  event_id         text not null check (length(event_id) between 1 and 120),
  -- A cobranca (o refId do principal): o "Pedido" da tela.
  grupo            text check (grupo is null or length(grupo) between 1 and 64),
  -- O evento no formato da rede, com o dado do comprador SO em hash.
  payload          jsonb not null,
  status           text not null default 'pendente'
                   check (status in ('pendente', 'enviado', 'falhou')),
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  last_error       text check (last_error is null or length(last_error) <= 500),
  response         jsonb,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  -- E-mail em claro nunca entra (o hash e hex, fbc/fbp e URL nao tem "@").
  constraint checkout_externo_envios_sem_email check (payload::text !~ '@'),
  constraint checkout_externo_envios_destino_fk
    foreign key (destino_id, checkout_id, user_id)
    references public.checkout_externo_destinos (id, checkout_id, user_id) on delete cascade,
  constraint checkout_externo_envios_unico unique (destino_id, event_id)
);

-- O drain: so o pendente que ja pode tentar.
create index if not exists checkout_externo_envios_fila_idx
  on public.checkout_externo_envios (next_attempt_at)
  where status = 'pendente';

-- A tela: os ultimos envios do checkout.
create index if not exists checkout_externo_envios_checkout_idx
  on public.checkout_externo_envios (checkout_id, created_at desc);

-- O purge.
create index if not exists checkout_externo_envios_criado_idx
  on public.checkout_externo_envios (created_at);


-- ---------------------------------------------------------------------------
-- 5. O visitante da ponte (Fase D)
-- ---------------------------------------------------------------------------
-- A ponte (xcart-bridge.js) na VSL poe o vid no `callback` do link da Cakto,
-- e o coletor guarda aqui o que a Cakto nao manda: click ids, _fbp/_ttp, IP e
-- user agent. O webhook acha a linha pelo vid. IP e user agent ficam em claro
-- porque o Meta e o TikTok exigem assim (como tracking_identities, 035) -- por
-- isso a tabela nao tem policy e expira. Nenhum dado do comprador (nome,
-- e-mail, telefone) entra aqui.
create table if not exists public.checkout_externo_identidades (
  checkout_id        uuid not null,
  user_id            uuid not null,
  visitor_id         text not null check (visitor_id ~ '^[A-Za-z0-9]{1,32}\.[A-Za-z0-9]{1,32}$'),
  fbp                text check (fbp is null or length(fbp) <= 300),
  fbc                text check (fbc is null or length(fbc) <= 700),
  fbclid             text check (fbclid is null or length(fbclid) <= 600),
  ttclid             text check (ttclid is null or length(ttclid) <= 1000),
  ttp                text check (ttp is null or length(ttp) <= 300),
  gclid              text check (gclid is null or length(gclid) <= 300),
  client_ip_address  text check (client_ip_address is null or length(client_ip_address) <= 64),
  client_user_agent  text check (client_user_agent is null or length(client_user_agent) <= 500),
  -- As UTMs do clique (as regras de utm.ts) e a hora dele. Sem "@".
  utm                jsonb check (utm is null or utm::text !~ '@'),
  utm_em             timestamptz,
  -- O teto por IP do coletor (065), sem guardar o IP para isso.
  ip_hash            text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 30 dias: o boleto vence em dias, e a compra so vai ao Meta ate 7 depois.
  expires_at         timestamptz not null default (now() + interval '30 days'),
  primary key (checkout_id, visitor_id),
  constraint checkout_externo_identidades_checkout_fk
    foreign key (checkout_id, user_id)
    references public.checkouts_externos (id, user_id) on delete cascade
);

create index if not exists checkout_externo_identidades_expira_idx
  on public.checkout_externo_identidades (expires_at);


-- ---------------------------------------------------------------------------
-- 6. O expurgo (chamado pelo cron do drain, uma vez por hora)
-- ---------------------------------------------------------------------------
create or replace function public.purge_checkout_externo_rastreio()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.checkout_externo_identidades
   where expires_at < now();

  -- Entregue: 8 dias. O Meta e o TikTok so aceitam compra de ate 7; depois
  -- a linha so serve para a tela.
  delete from public.checkout_externo_envios
   where status = 'enviado'
     and created_at < now() - interval '8 days';

  -- O que nao saiu em 8 dias nunca mais sai: o payload (o hash do comprador)
  -- vai embora e o pendente fecha com o motivo; a linha fica para a tela.
  update public.checkout_externo_envios
     set payload = '{}'::jsonb,
         status = case when status = 'pendente' then 'falhou' else status end,
         last_error = case when status = 'pendente'
                           then 'passou dos 7 dias que o Meta e o TikTok aceitam'
                           else last_error end
   where status <> 'enviado'
     and created_at < now() - interval '8 days'
     and payload <> '{}'::jsonb;

  delete from public.checkout_externo_envios
   where created_at < now() - interval '30 days';
end;
$$;

comment on function public.purge_checkout_externo_rastreio() is
  'Apaga identidade de checkout vencida, envio entregue com mais de 8 dias, tira o payload do que nao saiu em 8 e apaga tudo com mais de 30. Chamado pelo drain, uma vez por hora.';

revoke all on function public.purge_checkout_externo_rastreio() from public, anon, authenticated;
grant execute on function public.purge_checkout_externo_rastreio() to service_role;


-- ---------------------------------------------------------------------------
-- 7. RLS, policies e grants
-- ---------------------------------------------------------------------------
alter table public.checkout_externo_destinos         enable row level security;
alter table public.checkout_externo_destino_segredos enable row level security;
alter table public.checkout_externo_envios           enable row level security;
alter table public.checkout_externo_identidades      enable row level security;

-- O lojista LE os destinos do checkout dele (sem o token: outra tabela).
drop policy if exists "Dono le checkout_externo_destinos" on public.checkout_externo_destinos;
create policy "Dono le checkout_externo_destinos" on public.checkout_externo_destinos
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- E a fila: o que saiu, o que falhou e por que (as colunas abaixo, sem o payload).
drop policy if exists "Dono le checkout_externo_envios" on public.checkout_externo_envios;
create policy "Dono le checkout_externo_envios" on public.checkout_externo_envios
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Tudo fechado primeiro (os dois caminhos), depois so o que vale.
revoke all on table
  public.checkout_externo_destinos, public.checkout_externo_destino_segredos,
  public.checkout_externo_envios, public.checkout_externo_identidades
  from public, anon, authenticated;

grant select on table public.checkout_externo_destinos to authenticated;
-- Por coluna: payload e response NUNCA saem pela sessao.
grant select (id, checkout_id, user_id, destino_id, plataforma, event_name, event_id, grupo,
              status, attempts, next_attempt_at, last_error, sent_at, created_at)
  on table public.checkout_externo_envios to authenticated;

grant select, insert, update, delete on table
  public.checkout_externo_destinos, public.checkout_externo_destino_segredos,
  public.checkout_externo_envios, public.checkout_externo_identidades
  to service_role;


-- ---------------------------------------------------------------------------
-- 8. Conferencia (027: o revoke responde sucesso sem garantir nada)
-- ---------------------------------------------------------------------------
-- Aborta a migration inteira se sobrou algum caminho de privilegio.
do $$
declare
  papel text;
begin
  foreach papel in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(papel, 'public.purge_checkout_externo_rastreio()', 'execute') then
      raise exception '073: % ainda executa purge_checkout_externo_rastreio()', papel;
    end if;
    if has_table_privilege(papel, 'public.checkout_externo_destino_segredos', 'select') then
      raise exception '073: % le checkout_externo_destino_segredos', papel;
    end if;
    if has_table_privilege(papel, 'public.checkout_externo_identidades', 'select') then
      raise exception '073: % le checkout_externo_identidades', papel;
    end if;
    if has_column_privilege(papel, 'public.checkout_externo_envios', 'payload', 'select')
       or has_column_privilege(papel, 'public.checkout_externo_envios', 'response', 'select') then
      raise exception '073: % le o payload da fila do checkout', papel;
    end if;
    if has_table_privilege(papel, 'public.checkout_externo_envios', 'insert')
       or has_table_privilege(papel, 'public.checkout_externo_envios', 'update')
       or has_table_privilege(papel, 'public.checkout_externo_destinos', 'insert')
       or has_table_privilege(papel, 'public.checkout_externo_destinos', 'update')
       or has_table_privilege(papel, 'public.checkout_externo_destinos', 'delete') then
      raise exception '073: % escreve no rastreamento do checkout', papel;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.checkout_externo_destinos', 'select') then
    raise exception '073: anon le checkout_externo_destinos';
  end if;
  if not has_function_privilege('service_role', 'public.purge_checkout_externo_rastreio()', 'execute') then
    raise exception '073: service_role sem execute no purge';
  end if;
  if not has_table_privilege('service_role', 'public.checkout_externo_destino_segredos', 'select') then
    raise exception '073: service_role sem acesso ao segredo';
  end if;
  if not has_column_privilege('authenticated', 'public.checkout_externo_envios', 'status', 'select') then
    raise exception '073: o lojista nao le o status da fila';
  end if;
end;
$$;


-- Conferir tambem depois de aplicar:
--   select count(*) from pg_policies where tablename in ('checkout_externo_destino_segredos', 'checkout_externo_identidades'); -- 0
--   select relname, relrowsecurity from pg_class
--    where relname in ('checkout_externo_destinos', 'checkout_externo_destino_segredos',
--                      'checkout_externo_envios', 'checkout_externo_identidades');            -- 4 linhas, true
--   select has_table_privilege('authenticated', 'public.checkout_externo_destinos', 'select');     -- true
--   select has_column_privilege('authenticated', 'public.checkout_externo_envios', 'payload', 'select'); -- false
--   select has_function_privilege('authenticated', 'public.purge_checkout_externo_rastreio()', 'execute'); -- false
--   select column_default from information_schema.columns
--    where table_name = 'checkouts_externos' and column_name = 'compra_quando';               -- 'gerada'::text
