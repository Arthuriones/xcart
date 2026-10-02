-- ============================================================================
-- 052 -- Financeiro: lucro por loja e por dia, contas de anuncio, cambio,
-- alertas e o feed de eventos ao vivo.
--
-- POR QUE O XCART PASSA A GUARDAR PEDIDO
--
-- src/lib/sales/queries.ts registra que o xcart NAO guarda pedido ("copiar o
-- pedido criaria uma segunda verdade que envelhece"). Para LUCRO isso nao
-- fecha:
--   - read_orders so deixa a Shopify devolver os ultimos 60 dias;
--   - o custo do produto tem que valer pela DATA da venda;
--   - o lucro do dia cruza pedido com gasto de anuncio, que vem de outra API.
-- A copia nao envelhece porque um cron rele na Shopify, a cada 15 minutos, tudo
-- que mudou (updated_at) -- a reconciliacao que a propria Shopify recomenda.
-- E e uma foto FINANCEIRA: sem e-mail, nome, telefone ou endereco do cliente.
--
-- O QUE NAO MUDA
--
-- Nada aqui toca o caminho do rastreamento: webhook, coletor, fila,
-- purge_tracking e tracking_painel ficam como estao. tracking_feed e leitura
-- nova, SECURITY INVOKER.
--
-- QUEM ESCREVE
--
-- So service_role (rotas de API e cron), como tracking_destinations desde a
-- 048. O lojista LE pela RLS. As policies tem USING e WITH CHECK mesmo assim
-- (030): se alguem devolver o GRANT de escrita um dia, a linha NOVA continua
-- conferida contra o dono da loja.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Trava de dono para tabela em que a loja e OPCIONAL
-- ---------------------------------------------------------------------------
--
-- tracking_config_dono() (035) exige store_id. Conta de anuncio nasce sem loja
-- (o lojista liga depois) e alerta pode ser da conta inteira.
create or replace function public.dono_da_loja_opcional()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.store_id is not null and not exists (
    select 1 from public.stores s
     where s.id = new.store_id and s.user_id = new.user_id
  ) then
    raise exception 'store_id % nao pertence ao usuario %', new.store_id, new.user_id;
  end if;
  return new;
end;
$$;

-- SECURITY DEFINER em public: fechar os dois caminhos de privilegio (027).
revoke all on function public.dono_da_loja_opcional() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. Ajustes financeiros por loja
-- ---------------------------------------------------------------------------
create table if not exists public.fin_store_settings (
  store_id          uuid primary key references public.stores (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- Taxa do gateway: percentual sobre o valor cobrado + fixo por pedido, na
  -- moeda da loja. Estimativa ate lermos a taxa real do Shopify Payments.
  taxa_pct          numeric(6,3) not null default 0
                    check (taxa_pct >= 0 and taxa_pct < 100),
  taxa_fixa         numeric(12,4) not null default 0
                    check (taxa_fixa >= 0),
  -- Custo estimado (% do preco) para linha cujo SKU nao tem custo cadastrado.
  -- Nulo = nao estimar: a linha fica "sem custo" e a tela avisa.
  custo_padrao_pct  numeric(6,3)
                    check (custo_padrao_pct is null
                           or (custo_padrao_pct >= 0 and custo_padrao_pct <= 100)),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists fin_store_settings_user_idx
  on public.fin_store_settings (user_id);

drop trigger if exists fin_store_settings_dono on public.fin_store_settings;
create trigger fin_store_settings_dono
  before insert or update on public.fin_store_settings
  for each row execute function public.tracking_config_dono();


-- ---------------------------------------------------------------------------
-- 2. Estado da sincronizacao de pedidos, por loja
-- ---------------------------------------------------------------------------
create table if not exists public.fin_sync_state (
  store_id            uuid primary key references public.stores (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  -- Shop.ianaTimezone e Shop.currencyCode, lidos a cada sincronizacao.
  -- stores.currency_code NAO serve: e ajuste de preco da importacao.
  fuso                text,
  moeda               text check (moeda is null or moeda ~ '^[A-Z]{3}$'),
  -- Maior updatedAt ja gravado. A proxima rodada rele a partir dele.
  cursor_atualizado   timestamptz,
  -- Trava: a Vercel pode disparar o mesmo cron duas vezes.
  sincronizando_desde timestamptz,
  ultimo_sync_em      timestamptz,
  ultimo_sync_ok_em   timestamptz,
  ultimo_erro         text,
  ultimo_erro_tipo    text check (ultimo_erro_tipo is null
                                  or ultimo_erro_tipo in ('negado', 'falhou')),
  -- Vira true quando uma rodada chega ao fim da lista (60 dias ja lidos).
  carga_inicial_ok    boolean not null default false,
  pedidos_total       integer not null default 0,
  updated_at          timestamptz not null default now()
);

create index if not exists fin_sync_state_user_idx
  on public.fin_sync_state (user_id);

drop trigger if exists fin_sync_state_dono on public.fin_sync_state;
create trigger fin_sync_state_dono
  before insert or update on public.fin_sync_state
  for each row execute function public.tracking_config_dono();


-- ---------------------------------------------------------------------------
-- 3. Foto financeira do pedido
-- ---------------------------------------------------------------------------
create table if not exists public.fin_orders (
  store_id          uuid not null references public.stores (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- Id numerico da Shopify (sem o prefixo gid://shopify/Order/).
  shopify_order_id  text not null,
  nome              text,
  processado_em     timestamptz not null,
  -- processado_em no fuso da LOJA: e o "dia" do lucro.
  dia_local         date not null,
  criado_em         timestamptz not null,
  -- updatedAt da Shopify: o cursor da sincronizacao.
  atualizado_em     timestamptz not null,
  cancelado_em      timestamptz,
  -- venda | reenvio (valor zero: custo sem receita) | teste | pdv
  tipo              text not null check (tipo in ('venda', 'reenvio', 'teste', 'pdv')),
  status_financeiro text,
  origem            text,
  -- Valores na moeda da LOJA (shopMoney). A do cliente fica so de referencia.
  moeda             text not null check (moeda ~ '^[A-Z]{3}$'),
  moeda_cliente     text,
  total_bruto       numeric(14,2) not null default 0,
  total_atual       numeric(14,2) not null default 0,
  imposto_atual     numeric(14,2) not null default 0,
  taxas_alfandega   numeric(14,2) not null default 0,
  gorjeta           numeric(14,2) not null default 0,
  descontos         numeric(14,2) not null default 0,
  frete_cobrado     numeric(14,2) not null default 0,
  recebido          numeric(14,2) not null default 0,
  reembolsado       numeric(14,2) not null default 0,
  -- netPaymentSet: recebido menos reembolsado.
  liquido_pago      numeric(14,2) not null default 0,
  total_cliente     numeric(14,2),
  gateways          text[] not null default '{}',
  -- [{sku, qtd, qtd_atual, qtd_nao_enviada, preco}] -- sem dado pessoal.
  linhas            jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(linhas) = 'array'),
  sincronizado_em   timestamptz not null default now(),
  primary key (store_id, shopify_order_id)
);

comment on table public.fin_orders is
  'Foto financeira do pedido, sem dado pessoal. Regravada pelo cron /api/jobs/financeiro/pedidos a partir do updated_at da Shopify.';

create index if not exists fin_orders_loja_dia_idx
  on public.fin_orders (store_id, dia_local);
create index if not exists fin_orders_user_idx
  on public.fin_orders (user_id);

drop trigger if exists fin_orders_dono on public.fin_orders;
create trigger fin_orders_dono
  before insert or update on public.fin_orders
  for each row execute function public.tracking_config_dono();


-- ---------------------------------------------------------------------------
-- 4. Custo por SKU, com vigencia
-- ---------------------------------------------------------------------------
--
-- Vale a versao com o maior valido_desde <= dia do pedido; antes da primeira
-- versao, vale a primeira (regra em custoVigente(), src/lib/financeiro/tipos.ts).
-- Mudar o custo cria versao nova: pedido antigo nao muda sozinho.
create table if not exists public.product_costs (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.stores (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  sku             text not null check (length(btrim(sku)) between 1 and 255),
  custo_unitario  numeric(12,4) not null check (custo_unitario >= 0),
  -- Frete do fornecedor por unidade (dropshipping: o fornecedor cobra o envio).
  frete_unitario  numeric(12,4) not null default 0 check (frete_unitario >= 0),
  moeda           text not null check (moeda ~ '^[A-Z]{3}$'),
  valido_desde    date not null,
  origem          text not null default 'manual' check (origem in ('manual', 'csv')),
  created_at      timestamptz not null default now()
);

create unique index if not exists product_costs_versao_key
  on public.product_costs (store_id, sku, valido_desde);
create index if not exists product_costs_user_idx
  on public.product_costs (user_id);

drop trigger if exists product_costs_dono on public.product_costs;
create trigger product_costs_dono
  before insert or update on public.product_costs
  for each row execute function public.tracking_config_dono();


-- ---------------------------------------------------------------------------
-- 5. Contas de anuncio
-- ---------------------------------------------------------------------------
--
-- external_id: Meta = account_id so com digitos (sem "act_"); Google = ID de
-- CLIENTE com 10 digitos (NAO e o AW- de tracking_destinations.conta).
create table if not exists public.ad_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  -- Nulo = ainda nao ligada a loja: o sync pula.
  store_id              uuid references public.stores (id) on delete set null,
  plataforma            text not null check (plataforma in ('meta', 'google')),
  external_id           text not null check (external_id ~ '^[0-9]{5,20}$'),
  nome                  text,
  -- Moeda e fuso DA CONTA: o gasto chega assim e e convertido na leitura.
  moeda                 text check (moeda is null or moeda ~ '^[A-Z]{3}$'),
  fuso                  text,
  status_externo        text,
  -- api = puxado pelo xcart (Meta; Google pela API no futuro).
  -- script = empurrado pelo Google Ads Script.
  fonte                 text not null check (fonte in ('api', 'script')),
  ativo                 boolean not null default true,
  sincronizando_desde   timestamptz,
  ultimo_sync_em        timestamptz,
  ultimo_sync_ok_em     timestamptz,
  ultimo_reprocesso_em  timestamptz,
  -- gerado_em do ultimo envio do script: recusa replay de dado mais velho.
  ultimo_dado_gerado_em timestamptz,
  ultimo_erro           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists ad_accounts_conta_key
  on public.ad_accounts (user_id, plataforma, external_id);
create index if not exists ad_accounts_store_idx
  on public.ad_accounts (store_id);

drop trigger if exists ad_accounts_dono on public.ad_accounts;
create trigger ad_accounts_dono
  before insert or update on public.ad_accounts
  for each row execute function public.dono_da_loja_opcional();

-- Segredo por conta. RLS e por LINHA: o token nao pode morar na linha que o
-- lojista le (mesmo motivo de tracking_destination_secrets, 043).
create table if not exists public.ad_account_secrets (
  ad_account_id      uuid primary key references public.ad_accounts (id) on delete cascade,
  -- Meta: token de system user com ads_read (le desempenho, nao gasta).
  meta_access_token  text,
  -- Google Script: sha256 hex do segredo. O segredo em si so aparece uma vez,
  -- na tela, dentro do script.
  ingest_token_hash  text,
  updated_at         timestamptz not null default now()
);

create unique index if not exists ad_account_secrets_hash_key
  on public.ad_account_secrets (ingest_token_hash)
  where ingest_token_hash is not null;


-- ---------------------------------------------------------------------------
-- 6. Gasto diario
-- ---------------------------------------------------------------------------
--
-- nivel 'conta' = total da conta no dia, a VERDADE do gasto (no Meta inclui
-- anuncio arquivado/apagado, que a lista por campanha omite). nivel
-- 'campanha' = detalhe. O lucro so le 'conta'.
create table if not exists public.ad_spend_daily (
  ad_account_id   uuid not null references public.ad_accounts (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Dia no fuso DA CONTA.
  data            date not null,
  nivel           text not null check (nivel in ('conta', 'campanha')),
  campanha_id     text not null default '',
  campanha_nome   text,
  moeda           text not null check (moeda ~ '^[A-Z]{3}$'),
  gasto           numeric(14,4) not null default 0 check (gasto >= 0),
  impressoes      bigint not null default 0,
  cliques         bigint not null default 0,
  -- O que a PLATAFORMA atribui. So comparacao: o ROAS real usa os pedidos.
  compras         numeric(12,2) not null default 0,
  valor_compras   numeric(14,2) not null default 0,
  fonte           text not null check (fonte in ('api', 'script')),
  sincronizado_em timestamptz not null default now(),
  primary key (ad_account_id, data, nivel, campanha_id),
  check ((nivel = 'conta') = (campanha_id = ''))
);

create index if not exists ad_spend_daily_user_data_idx
  on public.ad_spend_daily (user_id, data);


-- ---------------------------------------------------------------------------
-- 7. Cambio diario (unidades da moeda por 1 USD)
-- ---------------------------------------------------------------------------
create table if not exists public.fx_rates (
  data           date not null,
  moeda          text not null check (moeda ~ '^[A-Z]{3}$'),
  por_usd        numeric(20,8) not null check (por_usd > 0),
  fonte          text not null check (fonte in ('frankfurter', 'ptax')),
  atualizado_em  timestamptz not null default now(),
  primary key (data, moeda)
);

comment on table public.fx_rates is
  'Cotacao do dia em unidades por 1 USD. Frankfurter (BCE e outras) para todas; PTAX Fechamento do BCB sobrescreve BRL.';


-- ---------------------------------------------------------------------------
-- 8. Alertas
-- ---------------------------------------------------------------------------
create table if not exists public.alerta_config (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  telegram_chat_id     text check (telegram_chat_id is null
                                   or telegram_chat_id ~ '^-?[0-9]{1,20}$'),
  ativo                boolean not null default true,
  receber_avisos       boolean not null default true,
  -- "Gastou sem vender": minimo de gasto do dia, na moeda da conta de anuncio.
  gasto_sem_venda_min  numeric(12,2) not null default 30
                       check (gasto_sem_venda_min >= 0),
  updated_at           timestamptz not null default now()
);

-- Token do bot: so service_role. A URL da API do Telegram contem o token --
-- nunca logar a URL.
create table if not exists public.alerta_config_secrets (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  telegram_bot_token  text,
  updated_at          timestamptz not null default now()
);

create table if not exists public.alertas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  store_id         uuid references public.stores (id) on delete cascade,
  regra            text not null check (length(regra) between 1 and 64),
  chave            text not null default '',
  severidade       text not null check (severidade in ('critico', 'aviso')),
  titulo           text not null,
  detalhe          text,
  aberto_em        timestamptz not null default now(),
  confirmado_em    timestamptz not null default now(),
  -- Histerese: fecha so depois de 2 avaliacoes seguidas sem o problema.
  falsos_seguidos  integer not null default 0,
  notificado_em    timestamptz,
  n_notificacoes   integer not null default 0,
  silenciado_ate   timestamptz,
  resolvido_em     timestamptz
);

-- Um alerta ABERTO por (dono, loja, regra, chave). Torna a abertura
-- idempotente mesmo com duas execucoes do cron ao mesmo tempo.
create unique index if not exists alertas_aberto_key
  on public.alertas (
    user_id,
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    regra,
    chave
  )
  where resolvido_em is null;
create index if not exists alertas_user_idx
  on public.alertas (user_id, aberto_em desc);
create index if not exists alertas_store_idx
  on public.alertas (store_id);

drop trigger if exists alertas_dono on public.alertas;
create trigger alertas_dono
  before insert or update on public.alertas
  for each row execute function public.dono_da_loja_opcional();


-- ---------------------------------------------------------------------------
-- 9. RLS, policies e grants
-- ---------------------------------------------------------------------------

-- Tabelas com loja obrigatoria: o dono le; a linha nova confere a loja.
alter table public.fin_store_settings enable row level security;
drop policy if exists "Dono le fin_store_settings" on public.fin_store_settings;
create policy "Dono le fin_store_settings" on public.fin_store_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = fin_store_settings.store_id
                   and s.user_id = (select auth.uid())));

alter table public.fin_sync_state enable row level security;
drop policy if exists "Dono le fin_sync_state" on public.fin_sync_state;
create policy "Dono le fin_sync_state" on public.fin_sync_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = fin_sync_state.store_id
                   and s.user_id = (select auth.uid())));

alter table public.fin_orders enable row level security;
drop policy if exists "Dono le fin_orders" on public.fin_orders;
create policy "Dono le fin_orders" on public.fin_orders
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = fin_orders.store_id
                   and s.user_id = (select auth.uid())));

alter table public.product_costs enable row level security;
drop policy if exists "Dono le product_costs" on public.product_costs;
create policy "Dono le product_costs" on public.product_costs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.stores s
                 where s.id = product_costs.store_id
                   and s.user_id = (select auth.uid())));

-- Tabelas com loja opcional.
alter table public.ad_accounts enable row level security;
drop policy if exists "Dono le ad_accounts" on public.ad_accounts;
create policy "Dono le ad_accounts" on public.ad_accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (store_id is null
         or exists (select 1 from public.stores s
                     where s.id = ad_accounts.store_id
                       and s.user_id = (select auth.uid()))));

alter table public.alertas enable row level security;
drop policy if exists "Dono le alertas" on public.alertas;
create policy "Dono le alertas" on public.alertas
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (store_id is null
         or exists (select 1 from public.stores s
                     where s.id = alertas.store_id
                       and s.user_id = (select auth.uid()))));

-- Gasto: o dono da linha E o dono da conta, nos dois sentidos.
alter table public.ad_spend_daily enable row level security;
drop policy if exists "Dono le ad_spend_daily" on public.ad_spend_daily;
create policy "Dono le ad_spend_daily" on public.ad_spend_daily
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ad_accounts a
                 where a.id = ad_spend_daily.ad_account_id
                   and a.user_id = (select auth.uid())))
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ad_accounts a
                 where a.id = ad_spend_daily.ad_account_id
                   and a.user_id = (select auth.uid())));

alter table public.alerta_config enable row level security;
drop policy if exists "Dono le alerta_config" on public.alerta_config;
create policy "Dono le alerta_config" on public.alerta_config
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Cambio e dado publico (BCE/BCB): qualquer usuario logado le. So SELECT, entao
-- WITH CHECK nao se aplica; a escrita e revogada abaixo.
alter table public.fx_rates enable row level security;
drop policy if exists "Logado le fx_rates" on public.fx_rates;
create policy "Logado le fx_rates" on public.fx_rates
  for select to authenticated
  using (true);

-- Segredos: RLS ligada e ZERO policy = ninguem entra pelo Data API.
alter table public.ad_account_secrets    enable row level security;
alter table public.alerta_config_secrets enable row level security;
revoke all on table public.ad_account_secrets    from public, anon, authenticated;
revoke all on table public.alerta_config_secrets from public, anon, authenticated;
grant select, insert, update, delete on table public.ad_account_secrets    to service_role;
grant select, insert, update, delete on table public.alerta_config_secrets to service_role;

-- Escrita so pelo servidor (service_role), como tracking_destinations na 048.
-- anon nao tem o que ler em nenhuma delas.
revoke insert, update, delete on table
  public.fin_store_settings, public.fin_sync_state, public.fin_orders,
  public.product_costs, public.ad_accounts, public.ad_spend_daily,
  public.fx_rates, public.alerta_config, public.alertas
  from public, anon, authenticated;
revoke select on table
  public.fin_store_settings, public.fin_sync_state, public.fin_orders,
  public.product_costs, public.ad_accounts, public.ad_spend_daily,
  public.fx_rates, public.alerta_config, public.alertas
  from public, anon;
grant select on table
  public.fin_store_settings, public.fin_sync_state, public.fin_orders,
  public.product_costs, public.ad_accounts, public.ad_spend_daily,
  public.fx_rates, public.alerta_config, public.alertas
  to authenticated;
grant select, insert, update, delete on table
  public.fin_store_settings, public.fin_sync_state, public.fin_orders,
  public.product_costs, public.ad_accounts, public.ad_spend_daily,
  public.fx_rates, public.alerta_config, public.alertas
  to service_role;


-- ---------------------------------------------------------------------------
-- 10. Feed de eventos ao vivo (leitura, SECURITY INVOKER)
-- ---------------------------------------------------------------------------
--
-- INVOKER: a policy "Owners read their tracking events" (035) vale aqui dentro,
-- entao o lojista so ve as proprias lojas mesmo passando ids de outras.
-- Devolve so colunas tratadas: o payload tem IP e user agent em claro.
-- Sem clique = lido do PAYLOAD, como a 051 (texto de aviso nao e contrato).
create or replace function public.tracking_feed(
  p_store_ids uuid[],
  p_antes     timestamptz default null,
  p_limite    integer default 100
)
returns table (
  id            uuid,
  store_id      uuid,
  criado_em     timestamptz,
  enviado_em    timestamptz,
  latencia_s    numeric,
  evento        text,
  fonte         text,
  plataforma    text,
  destino_id    uuid,
  destino_nome  text,
  status        text,
  tentativas    integer,
  erro          text,
  com_clique    boolean,
  origem_host   text,
  utm_source    text,
  utm_campaign  text,
  pedido        text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.store_id,
    e.created_at,
    e.sent_at,
    round(extract(epoch from (e.sent_at - e.created_at))::numeric, 1),
    lower(e.event_name),
    case
      when lower(e.event_name) = 'purchase' then 'webhook'
      when e.checkout_token is not null then 'pixel'
      else 'tema'
    end,
    e.destination,
    e.destination_id,
    d.nome,
    e.status,
    e.attempts,
    left(e.last_error, 300),
    case e.destination
      when 'meta' then nullif(e.payload -> 'user_data' ->> 'fbc', '') is not null
      when 'google' then coalesce(
        nullif(e.payload ->> 'gclid', ''),
        nullif(e.payload ->> 'gbraid', ''),
        nullif(e.payload ->> 'wbraid', '')
      ) is not null
      else null
    end,
    substring(e.referrer from '^https?://([^/:?#]+)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl')
              from '[?&]utm_source=([^&#]*)'),
    substring(coalesce(e.payload ->> 'event_source_url', e.payload ->> 'pageUrl')
              from '[?&]utm_campaign=([^&#]*)'),
    case when lower(e.event_name) = 'purchase' then nullif(e.order_id, '') end
  from public.tracking_events e
  left join public.tracking_destinations d on d.id = e.destination_id
  where e.store_id = any (p_store_ids)
    and e.created_at < coalesce(p_antes, now() + interval '1 minute')
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limite, 100), 1), 200);
$$;

comment on function public.tracking_feed(uuid[], timestamptz, integer) is
  'Ultimos eventos da fila de rastreamento, sem payload. INVOKER: a RLS de tracking_events limita ao dono.';

revoke all on function public.tracking_feed(uuid[], timestamptz, integer) from public, anon;
grant execute on function public.tracking_feed(uuid[], timestamptz, integer) to authenticated, service_role;

-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada):
--   select has_function_privilege('anon', 'public.tracking_feed(uuid[], timestamptz, integer)', 'execute');      -- false
--   select has_function_privilege('authenticated', 'public.dono_da_loja_opcional()', 'execute');                 -- false
--   select has_table_privilege('authenticated', 'public.ad_account_secrets', 'select');                          -- false
--   select has_table_privilege('authenticated', 'public.fin_orders', 'insert');                                  -- false
