-- ============================================================================
-- 074 -- Loja de demonstracao: uma marca interna, invisivel na tela.
--
-- A loja de demonstracao e uma linha de `stores` com pedidos, custos, gasto
-- de anuncio e eventos gravados direto no banco (scripts/demo-loja.ts), sem
-- Shopify, Meta ou Google por tras. As telas a leem como qualquer loja.
--
-- O que fala com fora pula a loja marcada -- o sync de pedidos, o gasto do
-- Meta, o diagnostico do tema e dos pedidos, os nomes de produto em Custos, o
-- coletor publico -- e os alertas tambem (src/lib/demonstracao.ts). Sem a
-- marca, o cron de 15 em 15 min tentaria a credencial inventada e gravaria
-- "Token invalido" na loja, e o alerta de sync abriria.
--
-- 1. stores.demonstracao: false em toda loja que existe. Nenhuma tela mostra.
-- 2. Trava: so o service_role liga ou desliga a marca. A sessao do lojista
--    que marcasse a propria loja mataria o sync dela em silencio.
-- 3. demonstracao_catalogo: nome, variante e foto de cada SKU da loja de
--    demonstracao (o que a tela Custos pergunta a Shopify numa loja real).
--    RLS ligada e ZERO policy: so o service_role le, depois de conferir o dono.
--
-- SO ACRESCENTA. O codigo le com e sem esta migration: sem a coluna (42703),
-- le sem ela e nenhuma loja e de demonstracao. O script de semear recusa
-- rodar sem ela.
--
-- ORDEM: APLICAR ANTES DO DEPLOY (ou junto). O codigo velho nao le nada
-- daqui. O novo sem a 074 funciona, mas paga uma leitura a mais de `stores`
-- por evento no coletor publico (/api/tracking/collect): pede a coluna, leva
-- o 42703 e le de novo sem ela.
--
-- Desfazer: scripts/demo-loja.ts limpar apaga a loja e tudo dela. A coluna e
-- a tabela podem ficar: sem loja marcada, nada muda.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. A marca
-- ---------------------------------------------------------------------------
alter table public.stores
  add column if not exists demonstracao boolean not null default false;

comment on column public.stores.demonstracao is
  'Loja de demonstracao (dados gravados pelo script, sem Shopify): crons, alertas e chamadas externas a pulam. So o service_role muda.';


-- ---------------------------------------------------------------------------
-- 2. A trava
-- ---------------------------------------------------------------------------
-- current_user e o papel do comando: 'authenticated'/'anon' pela Data API com
-- a sessao do lojista, 'service_role' com a chave de servico, o dono no SQL
-- editor. So os dois primeiros sao recusados.
create or replace function public.stores_guarda_demonstracao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       (tg_op = 'INSERT' and new.demonstracao)
    or (tg_op = 'UPDATE' and new.demonstracao is distinct from old.demonstracao)
  ) then
    raise exception 'stores.demonstracao so muda pelo service_role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Funcao em public vira endpoint (027): fechar os dois caminhos de privilegio.
-- O gatilho continua disparando (o EXECUTE e conferido ao criar o gatilho).
revoke all on function public.stores_guarda_demonstracao() from public, anon, authenticated;

drop trigger if exists stores_guarda_demonstracao on public.stores;
create trigger stores_guarda_demonstracao
  before insert or update of demonstracao on public.stores
  for each row execute function public.stores_guarda_demonstracao();


-- ---------------------------------------------------------------------------
-- 3. O catalogo da loja de demonstracao
-- ---------------------------------------------------------------------------
create table if not exists public.demonstracao_catalogo (
  store_id  uuid not null references public.stores (id) on delete cascade,
  sku       text not null check (length(btrim(sku)) between 1 and 120),
  nome      text not null check (length(btrim(nome)) between 1 and 200),
  -- "Queen", "15 lb". null = variante unica.
  variante  text check (variante is null or length(variante) <= 120),
  -- Miniatura https (a tela so mostra https). null = sem foto.
  imagem    text check (imagem is null or (imagem ~ '^https://' and length(imagem) <= 1000)),
  primary key (store_id, sku)
);

comment on table public.demonstracao_catalogo is
  'Nome, variante e foto por SKU da loja de demonstracao (stores.demonstracao). So service_role.';

alter table public.demonstracao_catalogo enable row level security;
revoke all on table public.demonstracao_catalogo from public, anon, authenticated;
grant select, insert, update, delete on table public.demonstracao_catalogo to service_role;


-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada):
--   select count(*) from stores where demonstracao;                                             -- 0
--   select has_function_privilege('anon', 'public.stores_guarda_demonstracao()', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.stores_guarda_demonstracao()', 'execute'); -- false
--   select has_table_privilege('authenticated', 'public.demonstracao_catalogo', 'select');      -- false
--   select has_table_privilege('anon', 'public.demonstracao_catalogo', 'select');               -- false
--   select has_table_privilege('service_role', 'public.demonstracao_catalogo', 'select');       -- true
--   select count(*) from pg_policies where tablename = 'demonstracao_catalogo';                 -- 0
--   select relrowsecurity from pg_class where relname = 'demonstracao_catalogo';                -- true
--   select tgname from pg_trigger where tgname = 'stores_guarda_demonstracao';                  -- 1 linha
