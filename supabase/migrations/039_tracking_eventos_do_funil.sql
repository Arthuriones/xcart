-- ============================================================================
-- Um rotulo por evento: ver produto, adicionar ao carrinho, iniciar checkout,
-- compra.
--
-- POR QUE UM MAPA, E NAO UMA COLUNA POR EVENTO
--
-- No Google Ads cada evento e uma conversion action propria, com rotulo
-- proprio. Coluna por evento significa uma migration a cada evento novo, e o
-- conjunto e exatamente o tipo de coisa que muda (amanha `view_cart`,
-- `add_payment_info`). O mapa guarda so os eventos que o lojista escolheu:
-- evento sem rotulo nao e rastreado, entao nao existe uma flag "ligado" por
-- evento para ficar fora de sincronia com o rotulo.
--
-- O que NAO muda: continua sendo id de conversao + rotulo, e nada mais. So que
-- agora e um rotulo por evento, que e como o Google organiza.
--
-- A COLUNA ANTIGA FICA (por enquanto)
--
-- `google_conversion_label` guardava o rotulo da compra. Ela e preenchida numa
-- loja em producao agora, e durante um deploy as duas versoes do codigo rodam
-- ao mesmo tempo -- a antiga lendo a coluna, a nova lendo o mapa. Derrubar a
-- coluna aqui pararia a conversao de venda pelos minutos do deploy. Ela vira
-- fallback de leitura, e sai numa migration proxima, depois de confirmado.
-- ============================================================================

alter table public.tracking_configs
  add column if not exists google_labels jsonb not null default '{}'::jsonb;

comment on column public.tracking_configs.google_labels is
  'Rotulo da conversion action por evento: {"add_to_cart":"AbC-D_efGh", ...}. Evento ausente = nao rastreado. O app descarta chave desconhecida e valor vazio antes de gravar (limparMapaDeRotulos).';

comment on column public.tracking_configs.google_conversion_label is
  'LEGADO: rotulo da compra, antes de google_labels existir. Lido so como fallback. Escreva em google_labels.';

-- Traz o rotulo da compra que ja estava configurado para dentro do mapa, para a
-- versao nova encontrar o que a antiga gravou.
update public.tracking_configs
   set google_labels = jsonb_build_object('purchase', btrim(google_conversion_label))
 where nullif(btrim(google_conversion_label), '') is not null
   and not google_labels ? 'purchase';

-- Ligado sem nenhum destino nao envia nada e ainda mostra "ativo" na tela.
--
-- `google_labels <> '{}'` em vez de vasculhar os valores: CHECK nao aceita
-- subconsulta, e quem grava (limparMapaDeRotulos) ja remove chave desconhecida e
-- valor vazio. O mapa nunca chega aqui com {"purchase": ""}.
alter table public.tracking_configs
  drop constraint if exists tracking_configs_ligado_precisa_destino;
alter table public.tracking_configs
  add constraint tracking_configs_ligado_precisa_destino
  check (
    enabled = false
    or nullif(btrim(meta_pixel_id), '') is not null
    or (
      nullif(btrim(google_conversion_id), '') is not null
      and (
        google_labels <> '{}'::jsonb
        or nullif(btrim(google_conversion_label), '') is not null
      )
    )
  );

comment on constraint tracking_configs_ligado_precisa_destino on public.tracking_configs is
  'Ligado exige pelo menos um destino de fato configurado. No Google: o id da conta mais ao menos um rotulo de evento.';

-- O evento do funil nasce no navegador e chega por um endpoint publico -- nao ha
-- sessao para autenticar, porque quem dispara e o visitante da loja. A fila ja
-- tem unique (store_id, destination, event_id), que impede a mesma acao de virar
-- duas conversoes. O que falta e um teto por visitante, para ninguem inflar a
-- conta de anuncios do lojista chamando o coletor em loop -- e para contar isso
-- barato precisa da coluna e do indice.
alter table public.tracking_events
  add column if not exists visitor_id text;

comment on column public.tracking_events.visitor_id is
  'Id de visitante do cookie first-party, nos eventos que nascem no navegador. Serve ao teto de abuso do coletor; nulo no evento que vem de webhook.';

create index if not exists tracking_events_loja_visitante_idx
  on public.tracking_events (store_id, visitor_id, created_at desc)
  where visitor_id is not null;
