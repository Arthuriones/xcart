-- ============================================================================
-- Trava de concorrencia do auto-conserto.
--
-- O PROBLEMA, com a ordem exata dos fatos:
--
--   1. o cron seleciona destinos ordenados por last_healed_at (mais antigo
--      primeiro);
--   2. healRoute pagina os dois catalogos, CRIA produtos faltantes na loja de
--      checkout e monta o mapa novo -- isso leva minutos;
--   3. so no FIM ele grava last_healed_at.
--
-- Entre 1 e 3 o destino continua parecendo "nao consertado". Qualquer segunda
-- execucao nesse intervalo escolhe os MESMOS destinos.
--
-- E ha tres jeitos de isso acontecer:
--   - a propria Vercel: "Cron delivery can also occasionally invoke the same
--     scheduled run more than once" (docs de Cron Jobs);
--   - execucao que passa da hora e encontra a proxima comecando;
--   - o lojista clicando "Corrigir agora" enquanto o cron roda -- o caminho
--     mais provavel no dia a dia.
--
-- O estrago nao e teorico. Dois heals concorrentes no mesmo destino:
--   - criam o MESMO produto duas vezes na loja de checkout (o passo 2 nao
--     enxerga o que o outro acabou de criar);
--   - fazem read-modify-write no sku_map: `{...antigo, ...novo}`. Quem grava
--     por ultimo apaga o que o outro mapeou, e SKU que sumiu do mapa nao
--     roteia -- o comprador cai no checkout da vitrine, que nao cobra.
--
-- A fila de importacao ja resolve isso com claim atomico (claimJob em
-- bulk-import-processor.ts). Aqui usa o mesmo padrao.
-- ============================================================================

alter table public.routed_checkout_targets
  add column if not exists healing_since timestamptz;

comment on column public.routed_checkout_targets.healing_since is
  'Nao-nulo = ha um conserto em andamento. Claim atomico; liberado no fim, e considerado abandonado depois de 20 min.';

-- A fila do cron le por (enabled, last_healed_at) e agora tambem filtra por
-- healing_since. Indice parcial: so o que esta ligado interessa.
create index if not exists routed_checkout_targets_fila_idx
  on public.routed_checkout_targets (last_healed_at nulls first)
  where enabled;
