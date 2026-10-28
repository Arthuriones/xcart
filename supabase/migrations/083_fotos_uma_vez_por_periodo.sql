-- ============================================================================
-- 083 -- As 20 fotos com IA da renovacao entram UMA vez por periodo.
--
-- A 082 trocou `ai_credits = p_amount` por soma. Sobrescrever era idempotente
-- (chamar duas vezes dava 20); somar nao e: o webhook legado do Stripe chama
-- reset_ai_credits em todo invoice.paid sem dedupe, e na Pagou e na
-- AbacatePay dois avisos DIFERENTES da mesma renovacao leem o fim antigo e
-- chamam os dois. Cada um somaria +20.
--
-- A trava passa para dentro da funcao: `ai_credits_periodo` guarda o fim do
-- periodo ja creditado, e a soma so acontece quando o p_period_end e outro. O
-- UPDATE trava a linha, entao duas chamadas juntas do mesmo periodo somam uma
-- vez (a segunda reavalia o WHERE depois da primeira).
--
-- Quem ja tem periodo valendo entra com ele como "ja creditado": a reentrega
-- do invoice atual nao soma; a proxima renovacao (outro fim) soma.
-- ============================================================================

alter table public.profiles
    add column if not exists ai_credits_periodo timestamptz;

comment on column public.profiles.ai_credits_periodo is
    'Fim do periodo cujas fotos com IA do plano ja entraram (reset_ai_credits soma so quando o periodo e outro).';

update public.profiles
   set ai_credits_periodo = current_period_end
 where ai_credits_periodo is null
   and current_period_end is not null;

create or replace function public.reset_ai_credits(p_user_id uuid, p_amount integer, p_period_end timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- O fim do periodo anda sempre (como antes).
    update public.profiles
       set current_period_end = p_period_end,
           updated_at = timezone('utc', now())
     where id = p_user_id;

    -- As fotos do plano, uma vez por periodo.
    update public.profiles
       set ai_credits = coalesce(ai_credits, 0) + greatest(p_amount, 0),
           ai_credits_periodo = p_period_end,
           credits_reset_at = timezone('utc', now())
     where id = p_user_id
       and ai_credits_periodo is distinct from p_period_end;
end;
$$;

revoke execute on function public.reset_ai_credits(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reset_ai_credits(uuid, integer, timestamptz) to service_role;

-- Conferir (as tres primeiras false, a ultima true):
--   select r, has_function_privilege(r, 'public.reset_ai_credits(uuid, integer, timestamptz)', 'execute')
--     from unnest(array['public','anon','authenticated','service_role']) r;
