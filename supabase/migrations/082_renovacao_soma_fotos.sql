-- ============================================================================
-- 082 -- A renovacao do plano SOMA as fotos com IA, nao sobrescreve.
--
-- Ate aqui reset_ai_credits (015) fazia `ai_credits = p_amount`: a renovacao
-- do cartao (Stripe, Pagou e AbacatePay chamam esta funcao) apagava as fotos
-- compradas e deixava o saldo em 20. Medido em 27/10/2026: uma conta comprou
-- 1.200, usou 596 e ficou com 20 na renovacao.
--
-- Agora soma, igual ao Pix de 30 dias: "o plano soma 20 fotos por mes,
-- nenhuma vence". A trava contra repor duas vezes no mesmo ciclo continua nos
-- webhooks (comparam current_period_end antes de chamar).
--
-- Ordem: tanto faz. O codigo nao muda a chamada; so a regra do banco.
-- CREATE OR REPLACE mantem os grants, mas a 027 e refeita aqui por garantia.
-- ============================================================================

create or replace function public.reset_ai_credits(p_user_id uuid, p_amount integer, p_period_end timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.profiles
       set ai_credits = coalesce(ai_credits, 0) + greatest(p_amount, 0),
           credits_reset_at = timezone('utc', now()),
           current_period_end = p_period_end,
           updated_at = timezone('utc', now())
     where id = p_user_id;
end;
$$;

revoke execute on function public.reset_ai_credits(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.reset_ai_credits(uuid, integer, timestamptz) to service_role;

-- Conferir (as tres primeiras false, a ultima true):
--   select r, has_function_privilege(r, 'public.reset_ai_credits(uuid, integer, timestamptz)', 'execute')
--     from unnest(array['public','anon','authenticated','service_role']) r;
