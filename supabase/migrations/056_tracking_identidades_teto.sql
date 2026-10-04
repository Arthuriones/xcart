-- ============================================================================
-- 056 -- Teto de identidades novas por loja, no coletor publico.
--
-- /api/tracking/collect e publico e o visitorId vem do navegador: cada id
-- inventado virava uma linha nova em tracking_identities, sem limite. O coletor
-- agora conta as linhas da loja criadas na ultima hora e, acima de 20 mil, so
-- atualiza visitante que ja existe.
--
-- A contagem e (store_id, created_at >= agora - 1 h) a cada identidade
-- publicada. Sem este indice, seria varredura da tabela inteira da loja.
--
-- SO ADITIVA. Nao mexe em dado nem em permissao.
-- ============================================================================

create index if not exists tracking_identities_loja_criado_idx
  on public.tracking_identities (store_id, created_at);
