-- ============================================================================
-- 077 -- Dados do cadastro no perfil: nome, sobrenome, telefone e CPF/CNPJ.
--
-- O "Criar conta" (src/app/(auth)/login/formulario-acesso.tsx) passou a pedir
-- nome, sobrenome, telefone com DDD e CPF ou CNPJ. O signUp e do navegador
-- direto no Supabase e manda tudo em options.data (raw_user_meta_data):
--
--   { nome, sobrenome, full_name, telefone, documento, has_password }
--
-- telefone e documento SO com digitos. Quem grava no perfil e o trigger que ja
-- cria o perfil (handle_new_user, da 015), agora lendo essas chaves.
--
-- O documento vai para a coluna que JA existe, profiles.document_number (+
-- document_type), da 022: e a que a cobranca Pix da Pagou le
-- (/api/billing/credits). Uma coluna "documento" nova seria uma segunda
-- verdade para o mesmo CPF -- e o cliente que se cadastra agora nao precisa
-- digitar o CPF de novo no primeiro Pix.
--
-- O que o banco confere (o minimo; o resto e no formulario, src/lib/cadastro.ts):
--   nome/sobrenome  sem caractere de controle, espacos juntados, ate 60;
--   telefone        DDD (2 digitos, sem 0) + celular 9XXXXXXXX ou fixo [2-5]XXXXXXX;
--   documento       11 (CPF) ou 14 (CNPJ) digitos, nao todos iguais.
-- Fora do formato vira null -- o trigger NUNCA derruba o cadastro (sem CHECK
-- nas colunas novas: um CHECK que falhasse aqui faria o signUp responder
-- "Database error saving new user"). O digito verificador e conferido so no
-- formulario: quem chama a API do Supabase na mao grava um CPF de formato
-- certo e digito errado, e a cobranca da Pagou recusa e pede outro.
--
-- Telefone e documento SAEM do raw_user_meta_data depois de copiados: o
-- user_metadata vai dentro do JWT da sessao (cookie, header de toda chamada) e
-- na lista de usuarios do painel do Supabase. Ficam so no perfil. Se essa
-- limpeza falhar, o cadastro segue (bloco com exception).
--
-- Privilegio (CLAUDE.md, migration 030): nada aqui da escrita ao usuario.
--   - profiles continua sem grant de INSERT/UPDATE/DELETE para anon e
--     authenticated (030 e 031): coluna nova nao ganha grant de coluna, e o
--     grant de tabela foi revogado. O usuario so LE o proprio perfil
--     (profiles_select_own_or_admin) -- inclusive telefone e documento.
--   - O trigger so escreve id, nome, sobrenome, telefone, document_number e
--     document_type. is_admin, plan, plano, access_granted, ai_credits e o
--     resto ficam no default: o raw_user_meta_data e do usuario (ele escolhe
--     o que manda no signUp) e nunca chega nessas colunas.
--   - create or replace mantem os grants, mas a regra da 027 e conferir
--     sempre: o revoke vai de novo no fim.
-- Travado por tests/cadastro-migration.test.ts.
--
-- Usuario antigo fica com null nas colunas novas (nao ha de onde tirar).
-- Idempotente: pode rodar de novo.
-- ============================================================================

alter table public.profiles
    add column if not exists nome text,
    add column if not exists sobrenome text,
    add column if not exists telefone text;

comment on column public.profiles.nome is
    'Nome do cadastro (Criar conta). null = conta de antes da 077.';
comment on column public.profiles.sobrenome is
    'Sobrenome do cadastro (Criar conta). null = conta de antes da 077.';
comment on column public.profiles.telefone is
    'Telefone do Brasil, so digitos: DDD + numero (10 fixo, 11 celular). Dado pessoal: nao logar.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    -- raw_user_meta_data e do usuario: pode vir null, lista ou numero.
    v_meta jsonb := case
        when jsonb_typeof(new.raw_user_meta_data) = 'object' then new.raw_user_meta_data
        else '{}'::jsonb
    end;
    v_nome text := nullif(btrim(left(regexp_replace(regexp_replace(
        coalesce(v_meta->>'nome', ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'), 60)), '');
    v_sobrenome text := nullif(btrim(left(regexp_replace(regexp_replace(
        coalesce(v_meta->>'sobrenome', ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'), 60)), '');
    v_telefone text := regexp_replace(coalesce(v_meta->>'telefone', ''), '[^0-9]', '', 'g');
    v_documento text := regexp_replace(coalesce(v_meta->>'documento', ''), '[^0-9]', '', 'g');
begin
    if v_telefone !~ '^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$' then
        v_telefone := null;
    end if;
    if v_documento !~ '^([0-9]{11}|[0-9]{14})$' or v_documento ~ '^(.)\1+$' then
        v_documento := null;
    end if;

    insert into public.profiles (id, nome, sobrenome, telefone, document_number, document_type)
    values (
        new.id,
        v_nome,
        v_sobrenome,
        v_telefone,
        v_documento,
        case when length(v_documento) = 14 then 'CNPJ' else 'CPF' end
    )
    on conflict (id) do nothing;

    if v_meta ?| array['telefone', 'documento'] then
        begin
            update auth.users
               set raw_user_meta_data = raw_user_meta_data - array['telefone', 'documento']
             where id = new.id;
        exception when others then
            null;
        end;
    end if;

    return new;
end;
$$;

-- O trigger on_auth_user_created (015) continua o mesmo: chama esta funcao.

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Conferir depois de aplicar (todas devem bater):
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name in ('nome', 'sobrenome', 'telefone');                -- 3 linhas
--   select has_table_privilege('authenticated', 'public.profiles', 'update');            -- false
--   select has_table_privilege('authenticated', 'public.profiles', 'insert');            -- false
--   select has_column_privilege('authenticated', 'public.profiles', 'telefone', 'update'); -- false
--   select has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'update'); -- false
--   select has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'); -- false
--   select has_function_privilege('anon', 'public.handle_new_user()', 'execute');          -- false
-- ----------------------------------------------------------------------------
