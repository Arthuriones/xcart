-- ============================================================================
-- Google pela Data Manager API (modo offline, acoes "Importar de cliques").
--
-- O ping /pagead/conversion que o servidor mandava devolvia 200 e nao contava
-- nada: 26 cliques reais, zero conversoes. O caminho oficial para conversao
-- vinda do servidor e a Data Manager API, e ela pede tres coisas que o destino
-- Google nao tinha:
--
--   customer_id        a conta que recebe (operatingAccount), 10 digitos, NAO
--                      e o AW-;
--   login_customer_id  a MCC, so quando a service account entrou por ela;
--   acoes              o ID numerico da acao UPLOAD_CLICKS por evento:
--                      {"purchase": "123", "add_to_cart": "456", ...}.
--
-- POR QUE COLUNA NOVA, E NAO `labels`
--
-- As 4 contas Google ativas guardam ROTULOS de texto em `labels`. Reaproveitar
-- o campo mandaria o rotulo como productDestinationId. Com coluna propria, o
-- destino sem `customer_id` + `acoes` continua no caminho antigo, intocado, ate
-- o Arthur configurar.
--
-- O DIAGNOSTICO VEM DEPOIS
--
-- A resposta do envio traz so o requestId; o resultado (aceito, recusado,
-- clique de outra conta) sai pelo requestStatus:retrieve, de 30 min a 24 h
-- depois. `tracking_events.conferir_em` diz quando olhar de novo; o resto
-- (requestId, situacao, motivo) mora em `response`, sem status novo na
-- constraint da 035.
--
-- So ADITIVA: nenhuma coluna existente muda, nenhum dado e reescrito.
-- ============================================================================

alter table public.tracking_destinations
  add column if not exists customer_id text,
  add column if not exists login_customer_id text,
  add column if not exists acoes jsonb not null default '{}'::jsonb;

comment on column public.tracking_destinations.customer_id is
  'Google Data Manager: ID do cliente (operatingAccount), 10 digitos sem traco. Null = caminho antigo.';
comment on column public.tracking_destinations.login_customer_id is
  'Google Data Manager: MCC por onde a service account acessa. Null = acesso direto a conta.';
comment on column public.tracking_destinations.acoes is
  'Google Data Manager: ID da acao UPLOAD_CLICKS por evento ({"purchase": "123"}). Nao confundir com labels (rotulos do caminho antigo).';

-- O formato e conferido na API; aqui fica a trava contra escrita direta.
alter table public.tracking_destinations
  drop constraint if exists tracking_destinations_customer_id_formato;
alter table public.tracking_destinations
  add constraint tracking_destinations_customer_id_formato
  check (customer_id is null or customer_id ~ '^[0-9]{10}$');

alter table public.tracking_destinations
  drop constraint if exists tracking_destinations_login_customer_id_formato;
alter table public.tracking_destinations
  add constraint tracking_destinations_login_customer_id_formato
  check (login_customer_id is null or login_customer_id ~ '^[0-9]{10}$');

alter table public.tracking_destinations
  drop constraint if exists tracking_destinations_acoes_objeto;
alter table public.tracking_destinations
  add constraint tracking_destinations_acoes_objeto
  check (jsonb_typeof(acoes) = 'object');

-- ---------------------------------------------------------------------------
-- Quando conferir o diagnostico do envio
-- ---------------------------------------------------------------------------
--
-- Null = nada a conferir (Meta, ping antigo, ou diagnostico ja lido). O indice
-- e parcial: so as linhas Google esperando resposta entram nele, entao o cron
-- acha a fila de conferencia sem varrer tracking_events.
alter table public.tracking_events
  add column if not exists conferir_em timestamptz;

comment on column public.tracking_events.conferir_em is
  'Google Data Manager: quando consultar o requestId de novo. Null = nada a conferir.';

create index if not exists tracking_events_conferir_idx
  on public.tracking_events (conferir_em)
  where conferir_em is not null;

-- Sem tabela nova e sem funcao nova: as policies da 035/048 sao por linha e ja
-- cobrem as colunas novas, e a escrita em tracking_destinations continua so
-- pelo service_role (revogada de anon/authenticated na 048).
