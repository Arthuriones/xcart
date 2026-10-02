# Plano da reformulação financeira

Plano para reformular o xcart em 7 pacotes paralelos e aditivos. Lucro vira a tela inicial, e cinco telas novas funcionam vazias até o Arthur configurar.

As cinco telas:
- **Lucro**: faturamento, gasto Meta/Google, lucro estimado e ROAS real, por loja e por dia, comparados com o período anterior.
- **Custos e taxas**: custo por SKU com data de vigência, frete do fornecedor, taxa do gateway e importação por CSV.
- **Contas de anúncio**: Meta conectado por token de system user; Google por script.
- **Eventos ao vivo**: feed lido de uma RPC nova, atualizado por polling.
- **Alertas**: mensagens no Telegram, com dedupe e histerese.

Por trás das telas:
- **Pedidos**: um cron a cada 15 min relê na Shopify (por updated_at) os pedidos que mudaram e grava uma foto financeira sem dado pessoal (fin_orders).
- **Gasto Meta**: cron via Marketing API Insights v25.0. O total sai de level=account, que inclui anúncio apagado. Reprocessa 28 dias uma vez por dia.
- **Gasto Google**: Google Ads Script por conta manda os dados por POST para um endpoint do xcart, autenticado com segredo próprio de cada conta (só o hash fica no banco).
- **Câmbio diário**: Frankfurter v2 para todas as moedas, com PTAX do BCB sobrescrevendo o BRL. Testei os dois hoje.

Uma mudança desde a decisão anterior: o Google aposentou o developer token em 09/09/2026, e MCC não é mais exigida. A Google Ads API passou a ser viável com conta de serviço no nível Explorer, que dá 2.880 operações/dia. Ela fica como evolução assim que o Arthur conseguir o Explorer. A tabela de gasto já aceita fonte 'api'.

Nada toca o caminho quente do rastreamento (webhook, collect, fila, purchase, normalizar, meta-capi.ts) nem SKU/rota.

O que está pronto aqui:
- **Migration 052** completa: RLS com USING + WITH CHECK, escrita só pelo service_role, segredos em tabelas sem policy, funções SECURITY DEFINER revogadas e a RPC tracking_feed como SECURITY INVOKER.
- **Contratos TS**: tipos.ts e filtro-global.ts, com o texto final.

O seletor global de loja, período e moeda fica em cookie, lido no servidor por cookies(). A explicação está na navegação.

Nenhum arquivo aparece em dois pacotes. O P0 entra primeiro no merge; o APP_HOME só muda junto com o P5.

## Decisões

- **Guardar pedido (inverte a decisão de src/lib/sales/queries.ts)**: O xcart passa a guardar uma 'foto financeira' de cada pedido em fin_orders: valores em shopMoney e linhas {sku, qtd, qtd_atual, qtd_nao_enviada, preco}, SEM e-mail, nome, telefone ou endereço. Um cron a cada 15 min relê na Shopify tudo com updated_at maior que o cursor.
  - Por quê: Três motivos tornam a foto necessária: read_orders só devolve 60 dias, o custo tem que valer pela data da venda e o lucro do dia cruza pedido com gasto de outra API. A 'segunda verdade' não envelhece porque a reconciliação por updated_at é o job que a própria Shopify recomenda.
  - Fontes: pesquisas shopify-financeiro, mercado e codigo; https://shopify.dev/docs/api/usage/access-scopes (read_orders = 60 dias); https://shopify.dev/docs/apps/build/webhooks/best-practices (reconciliation job); https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderSortKeys (UPDATED_AT existe, conferido hoje)
- **Ingestão de pedidos sem webhook novo**: Só polling: orders(sortKey: UPDATED_AT, query: updated_at:>=cursor), de 20 em 20 pedidos, até 10 páginas por loja e por execução. A carga inicial é de 60 dias. ORDERS_UPDATED, REFUNDS_CREATE e o resto ficam para depois.
  - Por quê: Restrição dura: não mexer no webhook (caminho quente). Polling por updated_at pega reembolso, cancelamento e edição, que mudam updated_at. Webhook não é garantido ('delivery isn't always guaranteed') e é removido após 8 falhas em 4h, então a reconciliação seria necessária de qualquer jeito.
  - Fontes: pesquisa shopify-financeiro (opção A e riscos 5 e 6); https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks; https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
- **Receita e dia do pedido**: Receita = netPaymentSet − currentTotalTaxSet − currentTotalDutiesSet − totalTipReceivedSet, em shopMoney, nunca negativa. O dia é o processedAt no Shop.ianaTimezone. Classificação: valor ≤ 0 = 'reenvio' (custo sem receita), test = 'teste', sourceName 'pos' = 'pdv'. Pedido parcialmente reembolsado entra com o líquido; pendente entra com 0.
  - Por quê: Fórmula da pesquisa Shopify, que também corrige o bug de Vendas (financial_status:paid exclui partially_refunded). Reenvio é custo real sem receita (o filtro-pedido.ts já trata draft de valor zero como 'não é venda').
  - Fontes: pesquisa shopify-financeiro (fórmulas e riscos 2 e 6); https://shopify.dev/docs/api/admin-graphql/latest/objects/Order; src/lib/tracking/filtro-pedido.ts
- **Custo do produto (COGS)**: Tabela product_costs por loja e SKU, com valido_desde. Vale a versão mais recente com valido_desde ≤ dia do pedido; antes da primeira versão, vale a primeira (retroativa). O custo inclui custo do produto + frete do fornecedor por unidade, na moeda do fornecedor. Unidades que custam = max(qtd_atual, unidades já enviadas); cancelado antes de enviar = 0. Sem custo: usa o custo padrão % da loja, se configurado; senão a tela mostra a cobertura ('X% da receita sem custo').
  - Por quê: LineItem não expõe custo e InventoryItem.unitCost é só o atual. A vigência dá o efeito de 'custo congelado no pedido' sem precisar de tela de recálculo (o TrueProfit teve que criar uma justamente por congelar). Reembolso depois de enviar não devolve o custo do fornecedor.
  - Fontes: pesquisas mercado (Lifetimely https://help.useamp.com/article/652-product-costs-explained; TrueProfit https://helpdesk.trueprofit.io/en/articles/16051710-how-to-recalculate-cogs-for-past-orders) e shopify-financeiro (opção F e fórmula de COGS); https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem; https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem
- **Taxa de pagamento**: Na v1, regra por loja configurada na tela: percentual sobre o valor recebido + fixo por pedido, na moeda da loja. A taxa real do Shopify Payments (OrderTransaction.fees) fica para depois.
  - Por quê: fees só vem preenchido em Shopify Payments, e não sabemos se as lojas usam (o Brasil não é país suportado). Gateway de terceiro só tem estimativa. Sem campo novo na query, cai o risco de quebrar o sync.
  - Fontes: pesquisa shopify-financeiro (opções D e E); https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction; https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries
- **Gasto do Meta**: Marketing API Insights v25.0 com token de system user (ads_read, validade 'Nunca'), colado na tela e guardado em ad_account_secrets (sem policy). As contas são descobertas por GET me/adaccounts, com fallback para {system-user}/assigned_ad_accounts. O cron */15 busca hoje e ontem no fuso da conta; uma vez a cada 20h, reprocessa 28 dias. level=account é a verdade do gasto (inclui arquivado e apagado); level=campaign é detalhe. Sem action_attribution_windows. Compras = omni_purchase, senão offsite_conversion.fb_pixel_purchase, nunca somados. Dias sem linha viram 0.
  - Por quê: É o único caminho oficial, grátis e automático, e conta própria dispensa App Review. Os Insights atualizam a cada 15 min e congelam após 28 dias. level=ad/campaign omite objeto apagado. As janelas 7d_view e 28d_view voltam vazias desde 12/01/2026. A v21 já expirou na Marketing API.
  - Fontes: pesquisa meta-gasto; https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/; https://developers.facebook.com/docs/marketing-api/insights/best-practices/; https://developers.facebook.com/docs/marketing-api/get-started/authorization; https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/; https://developers.facebook.com/docs/marketing-api/best-practices/manage-your-ad-object-status
- **Gasto do Google: opções, custo e esforço**: AGORA: Google Ads Script colado em cada conta, rodando de hora em hora, faz POST JSON para /api/ads/google/ingest com 'Authorization: Bearer <segredo da conta>'. O banco guarda só o sha256 do segredo; o customer_id do corpo tem que bater com a conta do segredo; dado mais velho que o último recebido é recusado. DEPOIS: Google Ads API REST com conta de serviço no nível Explorer, puxada pelo cron, assim que o Arthur conseguir o Explorer. A tabela já aceita fonte 'api'. Opções avaliadas: (A) API + conta de serviço + Explorer: grátis, ~30-45 min do Arthur e aprovação 'may'. Desde 09/09/2026 não exige developer token nem MCC; 2.880 operações/dia. (B) Script: grátis, ~5 min por conta, funciona hoje sem aprovação; contras: de hora em hora, N cópias, falha silenciosa. (C) BigQuery DTS: diário, exige GCP com faturamento, ~US$2,50/conta/mês (não verificado). (D) Looker Studio: não exporta dados. (E) Complemento do Sheets: só nos EUA e em inglês. (F) Relatório por e-mail: diário, exige parser de anexo. (G) Windsor/Supermetrics: US$23 a US$598/mês e terceiro com acesso. (H) OAuth de usuário: refresh token expira em 7 dias no modo Testing.
  - Por quê: O B funciona hoje, sem depender de aprovação do Google, e cabe nos 45 min (a restrição pede que o 'script do Google Ads' seja configuração na tela). Bearer com hash em repouso é mais simples que HMAC e não guarda segredo legível no banco: o TLS protege o trânsito. O A é melhor no longo prazo (sem N cópias, frequência livre), mas a concessão do Explorer não é garantida.
  - Fontes: pesquisas google-gasto, mercado e atribuicao-alertas; https://developers.google.com/google-ads/api/docs/get-started/dev-token; https://developers.google.com/google-ads/api/docs/api-policy/access-levels; https://ads-developers.googleblog.com/2026/09/new-onboarding-experience-for-google-ads-api.html; https://developers.google.com/google-ads/scripts/docs/features/third-party-apis; https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp_account (getCustomerId no formato 123-456-7890, getCurrencyCode e getTimeZone conferidos hoje); https://developers.google.com/google-ads/scripts/docs/features/reports (campos em lowerCamelCase, conferido hoje); https://windsor.ai/pricing/
- **Câmbio**: Tabela fx_rates (dia, moeda, unidades por 1 USD). Cron a cada 6h. Fonte principal: Frankfurter v2 (https://api.frankfurter.dev/v2/rates?from=&to=&base=USD), filtrado para ~30 moedas. A PTAX 'Fechamento' (cotacaoVenda) do BCB sobrescreve o BRL. Cada valor é convertido pela cotação do SEU dia (fim de semana usa o último dia útil, até 10 dias antes). Sem cotação, cai na tabela fixa de src/lib/sales/cambio.ts com aviso 'câmbio aproximado'. Moeda do relatório: BRL, USD ou EUR, padrão BRL.
  - Por quê: Câmbio fixo com margem apertada troca o sinal do lucro: o USD=5,40 do repo erra ~3,7% contra a PTAX. As duas fontes são grátis e sem chave. Testei hoje: v2 devolve array {date, base, quote, rate}; PTAX USD de 01/10 = 5,2079; o v1 está descontinuado.
  - Fontes: pesquisa shopify-financeiro (opção I) e mercado; https://frankfurter.dev/; https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao; teste curl de 02/10/2026
- **Moeda e fuso**: O valor é guardado na moeda original: a da loja (shopMoney) e a da conta de anúncio (account_currency / script). A conversão acontece só na leitura. O dia do pedido segue o fuso da loja; o dia do gasto segue o fuso da conta. A tela avisa quando os fusos diferem. Com 'todas as lojas', o 'hoje' é o de America/Sao_Paulo.
  - Por quê: Fuso de dado já agregado por dia não tem conserto pela API (Fivetran e Profit Calc). No Google, fuso e moeda da conta são imutáveis.
  - Fontes: pesquisas mercado (https://github.com/fivetran/dbt_ad_reporting/blob/main/DECISIONLOG.md), google-gasto (https://developers.google.com/google-ads/api/docs/query/date-ranges) e meta-gasto
- **Fórmulas e rótulos**: Lucro estimado = receita − custo de produtos (produto + frete do fornecedor) − taxas − gasto (Meta + Google). ROAS real = receita ÷ gasto. ROAS de equilíbrio = receita ÷ (receita − custo − taxas). Margem = lucro ÷ receita. CPA = gasto ÷ pedidos. Semáforo por loja: vermelho se lucro < 0; amarelo se ROAS real < 1,2 × equilíbrio; verde no resto; cinza sem gasto. Rótulo 'ROAS real', nunca 'MER'. Comparação automática com o período anterior de mesmo tamanho.
  - Por quê: É a cascata comum a TrueProfit, BeProfit, Lifetimely e Polar (CM2 → CM3). O MER tem definições opostas (Triple Whale vs Northbeam/Polar). Comparação e semáforo são o padrão de UX que os líderes compartilham.
  - Fontes: pesquisa mercado; https://www.polaranalytics.com/post/contribution-margin-formula-for-ecommerce-how-to-calculate-it; https://triplewhale.readme.io/docs/blended-roas; https://helpdesk.trueprofit.io/en/articles/11324705-dashboard-metrics-glossary; https://help.wetracked.io/en/article/pulse-dashboard-by-wetrackedio-1p6oxou/
- **Navegação**: Cinco grupos: Financeiro (Lucro, Custos e taxas, Contas de anúncio), Rastreamento (Saúde dos pixels, Eventos ao vivo, Alertas), Operações (Lojas, Importar, Atividade), Roteamento (Visão da rota, Roteamento, Vendas por rota) e Sistema (Configuração, Assinatura, Claude MCP). /financeiro vira APP_HOME. Não criar telas separadas de 'Atribuição' e 'Diagnóstico de pixels'. 'Pedidos', 'Performance por produto' e 'Análise de campanhas' ficam para depois.
  - Por quê: A /overview só mostra roteamento e fica vazia para quem não usa vitrine (caso do Arthur). A /tracking já é o diagnóstico de pixels e atribuição. O menu de 4 grupos da outra IA custa 5 a 10x o MVP. NAV, TRILHA e MOBILE são três listas e o MOBILE usava índice.
  - Fontes: pesquisas codigo (navegacao_atual, telas_existentes), atribuicao-alertas (item 2) e mercado (item 9 e risco 14); src/components/layout/sidebar.tsx; src/lib/app-home.ts
- **Seletor global de loja, período e moeda**: Cookies xc_loja, xc_periodo e xc_moeda. Um seletor no topo (TopNav) aparece só nas telas que o usam: /financeiro*, /tracking/eventos e /alertas. Ele grava com document.cookie e chama router.refresh(). As páginas leem no servidor com cookies() e conferem a loja contra as lojas do usuário: loja alheia vira 'todas'. Os dados do seletor vêm num server component dentro de Suspense, passado ao TopNav como prop.
  - Por quê: No App Router o layout não recebe searchParams e não re-renderiza na navegação, então o filtro na URL se perderia a cada clique no menu. cookies() só grava em route handler ou server function, mas o navegador pode gravar um cookie de preferência não sensível. E consulta no layout precisa ficar em Suspense (sidebar-data.tsx explica o travamento).
  - Fontes: pesquisa codigo (padrões e restrições de navegação); node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md (cookies é async; set só em Server Function/Route Handler); src/components/layout/sidebar-data.tsx
- **Eventos ao vivo**: A RPC tracking_feed(p_store_ids, p_antes, p_limite) é SECURITY INVOKER (a RLS de tracking_events vale lá dentro) e devolve só colunas tratadas, sem payload, IP ou UA. A tela faz polling a cada 15 s, só com a aba visível. Supabase Realtime não é usado.
  - Por quê: Leitura pura, fora do caminho de envio. O payload tem IP e user agent em claro. postgres_changes autoriza cada mudança contra cada assinante, numa thread só, e tracking_events é a tabela que mais recebe escrita.
  - Fontes: pesquisa atribuicao-alertas (opção feed); https://supabase.com/docs/guides/realtime/postgres-changes; supabase/migrations/051_tracking_painel_sem_clique_pelo_payload.sql
- **Alertas e Telegram**: Tabela alertas com índice único parcial para alerta aberto, um cron */10 e 7 regras só com dados do banco: sync de anúncio atrasado, gastou sem vender hoje, token do CAPI recusado (190), compra falhando, fila parada, sync de pedidos com erro, app desinstalado com rastreamento ligado. Anti-spam: abre uma vez; crítico renotifica a cada 6h; aviso só ao abrir; fecha depois de 2 avaliações limpas; uma mensagem por execução e por chat. Envio por sendMessage em texto puro. O token do bot é configurado na tela e guardado em alerta_config_secrets (sem policy), com fallback na env TELEGRAM_BOT_TOKEN.
  - Por quê: Cobre o risco que mais custa: venda e gasto quebrando sem ninguém ver. As regras que chamam a Shopify (diagnosticar de hora em hora) e o resumo diário ficam para depois. A pesquisa preferia o token só em env; a restrição do plano pede configuração na tela, e o repo já guarda token de anunciante em tabela de segredo. Mitigação: nunca logar a URL.
  - Fontes: pesquisa atribuicao-alertas (regras F, anti-spam G e envio H); https://core.telegram.org/bots/api; https://core.telegram.org/bots/tutorial; supabase/migrations/043_tracking_destinos.sql e 048 (segredo sem policy)
- **Segurança e padrões do repo**: Toda escrita passa por createAdminClient() depois de conferir o dono pela sessão. As tabelas novas revogam INSERT/UPDATE/DELETE do authenticated, e as policies têm USING + WITH CHECK conferindo a loja. Segredos ficam em tabelas sem policy e com revoke. A função SECURITY DEFINER nova é revogada de public, anon e authenticated. Todo fetch de servidor usa safeFetch. O endpoint de ingestão aceita valor monetário, então a autenticação por conta é obrigatória.
  - Por quê: Padrões das migrations 027, 030, 043 e 048. tests/sem-fetch-cru.test.ts reprova fetch cru. O CLAUDE.md lembra que /api/tracking/collect é público justamente por NÃO aceitar valor; aqui é o contrário.
  - Fontes: pesquisa codigo (padroes, restricoes); CLAUDE.md; tests/sem-fetch-cru.test.ts; supabase/migrations/048_tracking_checkout_e_dono.sql
- **Vercel**: vercel.json ganha só as 4 entradas de crons. O maxDuration vai no export de cada rota, sem entradas novas em 'functions'.
  - Por quê: O Pro permite 100 crons com intervalo mínimo de 1 min. Com 7 pacotes em paralelo, uma entrada em 'functions' apontando para um arquivo que não entrou no merge pode quebrar o build (comportamento conhecido da Vercel, não verificado nesta pesquisa). O maxDuration exportado pela rota é suportado pela própria Next.
  - Fontes: https://vercel.com/docs/cron-jobs/usage-and-pricing; https://vercel.com/docs/cron-jobs/manage-cron-jobs (pode duplicar ou pular: travar e ser idempotente); node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md
- **O que NÃO mexer agora**: Ficam como estão: SHOPIFY_API_VERSION 2024-10, a v21 do meta-capi.ts, getOrdersSummary e a tela Vendas (renomeada no menu para 'Vendas por rota'), o webhook orders/create e nenhum escopo Shopify novo.
  - Por quê: Trocar a versão da Shopify afeta o app inteiro e exige regressão. getOrdersSummary é compartilhada com o faturamento do admin. read_orders já cobre tudo o que a v1 usa.
  - Fontes: pesquisas codigo (restricoes) e shopify-financeiro (riscos 1 e 7); src/lib/shopify/scopes.ts

## Navegação

MENU LATERAL FINAL (src/components/layout/sidebar.tsx, rótulos em messages/pt.json > nav)

FINANCEIRO (chave finance)
- Lucro: /financeiro (CircleDollarSign), chave profit. É a nova home: APP_HOME = '/financeiro'.
- Custos e taxas: /financeiro/custos (Calculator), chave costs.
- Contas de anúncio: /financeiro/anuncios (Megaphone), chave adAccounts.

RASTREAMENTO (chave trackingGroup)
- Saúde dos pixels: /tracking (Radar), chave trackingHealth. É a tela atual, intacta, e já cobre diagnóstico e atribuição.
- Eventos ao vivo: /tracking/eventos (RadioTower), chave liveEvents.
- Alertas: /alertas (Bell), chave alerts.

OPERAÇÕES (chave operations)
- Lojas conectadas: /stores (Store, contador de lojas).
- Importar produtos: /clone/shopify (Download).
- Atividade: /activity (Activity).

ROTEAMENTO (chave routingGroup)
- Visão da rota: /overview (LayoutGrid), chave routeOverview. É a overview atual, que só tem dado de rota.
- Roteamento: /clone/routed-checkout (Waypoints).
- Vendas por rota: /sales (TrendingUp), chave salesByRoute.

SISTEMA (chave system)
- Configuração: /setup (ListChecks).
- Assinatura e créditos: /billing (CreditCard, contador de créditos).
- Claude (MCP): /claude (Terminal).

Comportamento do menu:
- Item ativo: vence o href MAIS LONGO que casa com o pathname (igual, ou prefixo seguido de '/'). Sem isso, /tracking/eventos acenderia também /tracking. A função pura hrefAtivo() fica em src/components/layout/nav-ativo.ts, com teste.
- Mobile (barra de baixo, 4 itens): /financeiro, /tracking, /alertas e /stores, buscados por href. Nada de índice de NAV.
- O logo leva a APP_HOME.

Chaves novas em pt.json (nav): finance, profit, costs, adAccounts, trackingGroup, trackingHealth, liveEvents, alerts, routingGroup, routeOverview, salesByRoute, system. Nenhuma chave existente é apagada.

TRILHA do topo (top-nav.tsx), com prefixo mais longo vencendo:
- /financeiro → profit
- /financeiro/custos → costs
- /financeiro/anuncios → adAccounts
- /tracking → trackingHealth
- /tracking/eventos → liveEvents
- /alertas → alerts
- /overview → routeOverview
- /sales → salesByRoute
- /activity → activity
- as entradas que já existem continuam.

SELETOR GLOBAL (loja, período, moeda)

Onde fica:
- À direita do TopNav. O layout passa a prop acoes = <Suspense fallback={null}><SeletorGlobalDados/></Suspense>.
- SeletorGlobalDados (server component) chama listarLojasDoUsuario() e lerFiltroGlobal(), de src/lib/filtro-global.ts, e renderiza <SeletorGlobal lojas filtro/> (client).
- São leituras rápidas de banco, nunca Shopify, e ficam dentro de Suspense: o layout não trava (motivo registrado em sidebar-data.tsx).

Quais controles aparecem (prefixo mais longo vence):
- /financeiro: loja + período + moeda.
- /financeiro/custos: só loja.
- /financeiro/anuncios: nenhum.
- /tracking/eventos: só loja.
- /alertas: só loja.
- Qualquer outra rota: nada. As telas antigas (/tracking, /sales) mantêm os filtros próprios em useState, e um seletor que elas ignorassem confundiria.

Controles:
- São <select> nativos estilizados com tokens: h-[28px], text-[12px], border var(--control-border).
- Loja: 'Todas as lojas' + uma opção por loja, no formato 'nome · domínio sem .myshopify.com'. O nome no banco é velho, então o domínio vai sempre junto.
- Período: Hoje, Ontem, 7 dias (padrão), 30 dias, Este mês, Mês passado.
- Moeda: BRL (padrão), USD, EUR.

Como grava e lê:
- Na mudança: document.cookie = linhaDeCookie(COOKIE_x, valor), depois router.refresh() dentro de useTransition, com opacidade durante o pending.
- As páginas leem com filtroResolvido(), que confere a loja contra as lojas do usuário e devolve lojaIds. Loja inválida vira 'todas', nunca dado de outro.
- Por que cookie e não URL: o layout do App Router não recebe searchParams e não re-renderiza na navegação; o cookie sobrevive ao clique no menu e é lido em qualquer página servidor.
- Cabe em 375px: a loja tem max-w-[150px] com truncate, e o período e a moeda são compactos.

## Escopo desta rodada

- P0 Base: migration 052 (tabelas fin_*, product_costs, ad_*, fx_rates, alertas*, RPC tracking_feed), contratos TS, crons no vercel.json e a tela Custos e taxas (/financeiro/custos): taxa do gateway, custo padrão %, custos por SKU com vigência (edição inline dos SKUs vendidos nos últimos 60 dias), CSV com modelo e histórico de versões
- P1 Navegação nova (grupos, item ativo pelo prefixo mais longo, mobile por href, Lucro como home) + seletor global por cookie no topo + tela Eventos ao vivo (/tracking/eventos, polling de 15 s pela RPC tracking_feed)
- P2 Sync de pedidos Shopify para fin_orders (cron */15, cursor por updated_at, trava por loja, carga inicial de 60 dias, botão 'sincronizar agora' por sessão) + câmbio diário (Frankfurter v2 + PTAX BRL, cron 6/6h)
- P3 Meta Ads: conectar token de system user (lista e grava as contas e o segredo) + cron */15 de Insights (level=account e level=campaign, hoje e ontem, reprocesso de 28 dias a cada 20h, zera dias ausentes, classifica erro 190/limite)
- P4 Tela Contas de anúncio (/financeiro/anuncios): Meta (colar token, ligar conta→loja, ativar, sincronizar) e Google (cadastrar ID de cliente → script pronto com segredo, mostrado uma vez; gerar novo segredo; endpoint de ingestão autenticado)
- P5 Tela Lucro (/financeiro): 4 KPIs + 4 secundários com variação contra o período anterior, tabela por loja com semáforo e linha de total, dia a dia, avisos acionáveis (sem custo, sem taxa, conta sem loja, fuso diferente, câmbio aproximado, sync com erro) e 'Atualizar agora'
- P6 Alertas (/alertas): 7 regras SQL, tabela com dedupe e histerese, cron */10, Telegram (bot token + chat id na tela, botão Testar, passo a passo do BotFather), silenciar 24h

## Depois

- Google Ads API REST com conta de serviço e nível Explorer (JWT RS256 com node:crypto, googleads.googleapis.com/v25, searchStream a cada 15 min, listAccessibleCustomers e casamento automático pelo conversion_tracking_id = número do AW-). Substitui o script quando o Arthur conseguir o Explorer; a tabela já aceita fonte='api'
- Webhooks ORDERS_UPDATED, REFUNDS_CREATE e ORDERS_CANCELLED só marcando pedido 'sujo' (fin_dirty_orders) para cair a latência de 15 min. Mexe no webhook: entrar com teste
- Taxa real do Shopify Payments (Order.transactions.fees) e, se a loja usar, disputas e saldo (read_shopify_payments_*)
- Conferência por ShopifyQL (read_reports): 'Shopify diz X, xcart diz Y' por dia, com o COGS registrado pela Shopify
- Custos fixos mensais e DRE (lucro líquido), acréscimo de IOF/spread no gasto cobrado em USD em cartão brasileiro
- Análise de campanhas: tabela por campanha com gasto, cliques e compras atribuídas (o dado já é guardado em ad_spend_daily nivel='campanha')
- Lucro por produto/SKU (fin_orders.linhas já tem o SKU) e custo por país de destino
- Comparativo xcart × Meta × Google: pedidos, compras enviadas, Purchase recebido (/{pixel}/stats), compras atribuídas pelo Meta e conversions_by_conversion_date do Google
- Jornada do pedido (tabela tracking_pedidos gravada no webhook ANTES dos retornos antecipados + gaveta de jornada). Mexe no caminho quente: precisa de teste e revisão
- Diagnóstico extra na /tracking: última atividade por fonte (tema, pixel, webhook), latência p95 e pendente mais antigo
- Alertas que chamam a Shopify (diagnosticar() + saudeDaLoja() de hora em hora), resumo diário, ROAS abaixo do equilíbrio por 3 dias, conta Meta bloqueada (account_status ≠ 1)
- Tela de Pedidos (lista de fin_orders com tipo, receita, custo, lucro)
- Atualizar SHOPIFY_API_VERSION (2024-10 aposentada; a Shopify responde com a mais antiga acessível, 2026-01 a partir de 16/10/2026) e o CAPI v21 → v25, numa constante só, com regressão
- Corrigir a tela Vendas (financial_status:paid exclui partially_refunded, soma de moedas diferentes, só lojas de rota) ou aposentá-la em favor do Lucro
- read_all_orders, para o histórico das lojas paradas (aprovação da Shopify)
- Custo direto do fornecedor (CJ freightCalculate) e botão 'copiar custo da Shopify' (InventoryItem.unitCost)
- Venda como serviço: OAuth Meta (App Review de ads_read + Full access), OAuth Google com verificação, e client credentials que só vale na mesma organização Shopify

## Riscos

1) **Paralelismo e merge.** Os 7 pacotes dependem de P0 entrar primeiro, com o texto exato dos contratos.
- Se um pacote alterar tipos.ts, os outros quebram no typecheck.
- O APP_HOME = /financeiro (P1) só pode ir ao ar junto com a tela Lucro (P5). Se o P5 falhar, reverta essa linha de src/lib/app-home.ts.
- As entradas de cron para rotas que não entraram dão 404, o que é inofensivo.
- Não pus entradas em "functions" do vercel.json de propósito: uma entrada apontando para um arquivo inexistente pode quebrar o build (comportamento da Vercel não verificado nesta pesquisa).

2) **Migration antes do deploy.** Sem a 052 aplicada, as telas novas mostram erro de banco. As antigas não são afetadas. Nada na 052 altera tabela existente.

3) **Versão da Shopify.** O app ainda declara 2024-10, que foi aposentada. A Shopify responde com a 2025-10 e passa a 2026-01 em 16/10/2026.
- Todos os campos da query nova (netPaymentSet, currentTotalDutiesSet, totalTipReceivedSet, currentQuantity, unfulfilledQuantity, sortKey UPDATED_AT) estão na doc "latest".
- Mas a query nunca rodou contra uma loja real. Rodar "Sincronizar agora" logo após o deploy e olhar fin_sync_state.ultimo_erro.

4) **60 dias de histórico.** read_orders limita a carga inicial a 60 dias. Por isso "Mês passado" e o período anterior dos 30 dias podem sair incompletos no começo; o histórico cresce a partir de hoje.
- A carga inicial lê até 200 pedidos por loja a cada 15 min, então loja grande pode levar algumas rodadas.
- Pedido com mais de 25 linhas tem as linhas excedentes ignoradas no custo (raro em dropshipping).

5) **Lucro superestimado sem custo.** SKU sem custo cadastrado infla o lucro. A tela mostra a cobertura e o custo padrão % mitiga.
- Linha sem SKU não recebe custo; a tela de Custos avisa.
- A taxa de pagamento é estimada: a taxa real do Shopify Payments e a de conversão de moeda (cliente em EUR na loja em USD) ficam para depois.

6) **Moeda e fuso.**
- O câmbio é de referência (BCE/PTAX), não o que o banco ou o gateway cobraram. Não há IOF nem spread.
- O dia do gasto segue o fuso da conta e o do pedido segue o fuso da loja; com fusos diferentes o dia a dia desalinha. Isso não tem conserto pela API, só aviso.
- Se o Frankfurter e a PTAX falharem, cai na tabela fixa com o aviso "aproximado".

7) **Dados de anúncio mudam depois do fato.**
- Meta: o spend é "estimado", reprocessamos 28 dias e o número congela depois disso.
- Google: o crédito por clique inválido vai para a fatura e não reduz cost_micros. O script reenvia 30 dias às 04h e 7 dias nas outras horas. Hoje é sempre parcial.
- As compras atribuídas pelas plataformas ficam guardadas só para comparação: o ROAS real usa os pedidos.

8) **Meta.**
- A doc é contraditória sobre App Review para system user. O token do CAPI pode ser de um "Conversions API app" criado pelo Meta, sem ads_read. O limite é de 1 system user + 1 admin no nível Limited.
- me/adaccounts com token de system user não está verificado; há fallback para assigned_ad_accounts.
- A v24 da Marketing API expira em 06/10/2026; o sync novo usa a v25. O CAPI continua na v21 por auto-upgrade, sem mudança neste plano.

9) **Google.**
- O script roda como o usuário do Arthur e falha em silêncio. A regra de alerta "sync atrasado" (3h) e o status na tela cobrem isso.
- O segredo fica legível no código do script para quem tem acesso à conta Google Ads. Ele só permite enviar gasto daquela conta, porque o customer_id tem que bater; se vazar, basta gerar outro.
- O agendamento por hora só é confirmado por fonte de terceiros.
- O nível Explorer da API pode não ser concedido; nesse caso o script continua.

10) **Endpoint de ingestão aceita dinheiro.** Ele é público. A proteção vem de:
- segredo por conta, guardado só como hash;
- customer_id conferido;
- recusa de dado mais velho que o último recebido;
- limite de 5 MB e de 40 dias por envio.
Sem isso, qualquer um inflaria ou zeraria o gasto de uma loja (princípio inverso ao do /api/tracking/collect).

11) **Token do Telegram no banco.** A pesquisa recomendava variável de ambiente; a restrição do plano pede configuração na tela. Ele fica numa tabela sem policy e com acesso revogado, como o token do CAPI. A URL da API contém o token, então nunca deve ser logada. A env TELEGRAM_BOT_TOKEN funciona como alternativa.

12) **Cron da Vercel.** A entrega é best effort: pode duplicar ou pular execuções. Mitigações:
- trava por linha (sincronizando_desde) e upserts idempotentes;
- abertura de alerta idempotente pelo índice único parcial;
- quatro crons novos, bem abaixo do limite de 100.

13) **Números diferentes em Vendas e em Lucro.** A tela Vendas (agora "Vendas por rota") continua:
- excluindo pedidos partially_refunded;
- usando câmbio fixo;
- olhando só lojas de rota.
Para o Arthur, a fonte é o Lucro; a nota "Como calculamos" explica a diferença.

14) **RLS.** Policies com USING + WITH CHECK, escrita revogada do authenticated e triggers de dono com SECURITY DEFINER revogados. Conferir com has_*_privilege depois de aplicar (027: um revoke responde sucesso sem garantir nada). A RPC tracking_feed é INVOKER e não devolve payload (IP/UA).

15) **Regras de alerta novas sem histórico.** Os limites (90 min, 3h, 45 min, 30 de gasto, 1,2× do equilíbrio) são palpites das pesquisas. Pode haver falso positivo nos primeiros dias; ajuste na tela, e a histerese de 2 avaliações ajuda.

## Crítica do plano (antes de implementar)

**Veredito:** APROVAR COM CORREÇÕES. O plano se sustenta na maior parte, mas não roda como está.

O que conferi no repo e está certo:
- A 052 está livre (a última é a 051) e nenhum nome de tabela ou função colide com as existentes.
- Nenhum arquivo aparece em dois pacotes e /api/ads, src/lib/financeiro, src/lib/ads e src/lib/alertas não existem ainda.
- A SQL está coerente com o schema real: tracking_config_dono() é SECURITY DEFINER e já está revogada; tracking_events tem status, attempts, last_error, response, referrer, checkout_token, destination_id, order_id e sent_at; tracking_destinations.nome existe; o authenticated mantém SELECT em tracking_destinations (a 048 só revogou de public e anon).
- Toda policy tem USING + WITH CHECK e as tabelas de segredo não têm policy.
- tracking_feed é INVOKER e o tipo de cada coluna bate com o RETURNS TABLE.
- O padrão `.or('x.is.null,x.lt.<iso>')` já roda em produção (src/lib/checkout-routes/heal.ts:211).
- O proxy deixa /api passar sem sessão (src/lib/supabase/middleware.ts), então o ingest público funciona.
- shopifyGraphQL(creds, query, vars) e ShopifyCredentials batem com o que o P2 descreve.
- safeFetch aceita timeoutMs. sem-fetch-cru libera arquivo com 'use client'.
- Os exports de selo.tsx, getCurrentUser, getPublicAppUrl e TAXAS_BRL existem.
- Frankfurter v2 confirmado por curl hoje: array com {date, base, quote, rate}, 165 moedas por dia.
- O fim do developer token em 09/09/2026 está confirmado em https://developers.google.com/google-ads/api/docs/get-started/dev-token.
- O alerta do plano sobre entrada em `functions` do vercel.json apontando para arquivo inexistente é real (https://community.vercel.com/t/pattern-in-functions-doesnt-match-any-serverless-functions/829).
- Nada toca webhook, collect, fila, meta-capi.ts nem SKU/rota.

Não executei a SQL: a revisão foi manual, sem Postgres local.

Onde o plano cai:
1. A query GraphQL do P2 provavelmente estoura o teto de 1.000 pontos por query.
2. O custo de pedido cancelado antes do envio provavelmente é contado.
3. No P3, a regra de throttle apaga o detalhe por campanha.
4. Recriar os contratos em cada worktree é frágil.
5. A conferência com "Vendas líquidas" vai dar diferença falsa.
6. O P0 pede um Aviso de tom 'neutro', e o componente não aceita.
7. Sete pacotes em 45 minutos, com o P1 acoplando o menu à tela de eventos, é irreal sem uma regra de corte.
8. Há afirmações escritas como fato sem fonte.

### Correções obrigatórias aplicadas

1. **Problema:** P2: custo da query GraphQL não verificado e provavelmente acima do teto. O plano diz 'custo ~ 20 x 26 pontos', mas a tabela oficial dá Object = 1 e Connection 'sized by first', com teto de 'A single query may not exceed a cost of 1,000 points' (https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits). Pelo modelo linear documentado, cada Order vale cerca de 1 + 21 (dez MoneyBag com shopMoney, mais presentmentMoney) + lineItems(first:25) a 2 + 25×3 = 77, ou seja cerca de 99 por pedido. Com first:20 dá cerca de 1.980 pontos: MAX_COST_EXCEEDED antes de executar, e o sync inteiro fica parado. Só a comunidade relata um modelo novo, logarítmico, sem doc oficial (https://community.shopify.com/t/how-is-the-requested-cost-of-a-graphql-connection-calculated/646476). shopifyGraphQL só devolve json.data, então não dá para ler extensions.cost sem editar client.ts, que é proibido.
   **Correção:** No P2 (shopify-pedidos.ts), substituir pelo texto abaixo e apagar a frase 'custo ~ 20 x 26 pontos, abaixo do teto de 1000':

'query FinPedidos($busca: String!, $cursor: String, $n: Int!) { shop { ianaTimezone currencyCode } orders(first: $n, after: $cursor, sortKey: UPDATED_AT, query: $busca) { ... mesmos campos ..., displayFulfillmentStatus, lineItems(first: 25) {...} } }'

- Começar com n = 8 (cerca de 2 + 8×99 = 794 pontos no modelo linear) e usar maxPaginas = 25, o que mantém 200 pedidos por rodada.
- Se a mensagem do erro casar com /MAX_COST_EXCEEDED/, repetir o MESMO cursor com n = Math.max(2, Math.floor(n/2)). Com n = 2 ainda falhando, lançar o erro.
- Teste: 'erro MAX_COST_EXCEEDED reduz n e repete o cursor'.
- Em riscos, registrar: 'custo exato da query não verificado (doc só dá a tabela); primeiro POST /api/jobs/financeiro/pedidos pós-deploy é a verificação'.

2. **Problema:** P2/contrato: o custo de pedido cancelado ou de item removido antes do envio provavelmente é contado. qtdParaCusto calcula enviadas = qtd − qtd_nao_enviada, e qtd_nao_enviada vem de unfulfilledQuantity. A doc só diz 'The number of units not yet fulfilled'. Ela também tem nonFulfillableQuantity, descrito como 'if items have been refunded' (https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem). Se a Shopify zerar o unfulfilled de uma linha cancelada ou reembolsada sem envio (o que não está verificado), todo cancelamento vira custo cheio. Em dropshipping isso é frequente. O teste do contrato passa porque a fixture é montada à mão e não prova o comportamento real.
   **Correção:** No P2, acrescentar displayFulfillmentStatus (Order, enum não nulo, custo 0) na query e em NoPedidoShopify. Em mapearPedido:

'const NADA_ENVIADO = new Set(["UNFULFILLED","OPEN","RESTOCKED","ON_HOLD","SCHEDULED"]); qtd_nao_enviada: NADA_ENVIADO.has(no.displayFulfillmentStatus) ? n.quantity : (n.unfulfilledQuantity ?? 0)'

Os valores do enum estão em https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderDisplayFulfillmentStatus.

Novo teste em tests/financeiro-mapear-pedido.test.ts: 'cancelado com displayFulfillmentStatus UNFULFILLED e unfulfilledQuantity 0 -> qtdParaCusto(linha, true) = 0'.

Em riscos: 'semântica de unfulfilledQuantity para linha reembolsada não verificada; pedido parcialmente enviado usa unfulfilledQuantity'.

3. **Problema:** P3 (meta-sync.ts, item C.7 combinado com C.5): quando o throttle passa de 75%, o plano pula a chamada de level=campaign. Logo depois, o passo 5 apaga em ad_spend_daily tudo da janela com sincronizado_em < runTs, sem filtrar por nível. Resultado: todas as linhas 'campanha' da janela somem, e no reprocesso são 28 dias de detalhe. O Lucro não quebra (lê só 'conta'), mas a 'Análise de campanhas' futura herda buracos.
   **Correção:** Texto novo do passo 5 em P3/C:

'Grave: runTs = agora.toISOString(); niveis = campanhaBuscada ? ["conta","campanha"] : ["conta"]; upsert de 500 em 500 (onConflict ad_account_id,data,nivel,campanha_id, sincronizado_em = runTs); depois delete().eq("ad_account_id", id).in("nivel", niveis).gte("data", desde).lte("data", ate).lt("sincronizado_em", runTs).'

O P4 (ingest do Google) fica como está, porque o script sempre manda os dois níveis.

Teste: 'com throttle alto, linhas campanha da janela sobrevivem'.

4. **Problema:** Dependência escondida e conflito latente: P1 a P6 recebem a instrução 'crie tipos.ts e filtro-global.ts localmente e NÃO commite'. Isso tem três problemas:
- Seis agentes no Windows (CRLF, BOM do PowerShell) recriando o mesmo texto: se um deles commitar por engano com um byte diferente, o merge conflita no contrato.
- 'Faltou algo: defina localmente' gera seis cópias divergentes de helpers.
- O layout.tsx do P1 importa filtro-global (P0) em tempo de build. Se o P1 entrar antes do P0, o deploy quebra.
   **Correção:** Trocar a ordem por esta:

'Fase 0 (antes de abrir qualquer worktree, cerca de 5 min): P0-A commita em main só supabase/migrations/052_financeiro.sql, src/lib/financeiro/tipos.ts, src/lib/filtro-global.ts, a entrada crons do vercel.json e tests/financeiro-tipos.test.ts, com typecheck e test verdes. Os worktrees de P0-B (tela Custos), P1, P2, P3, P4, P5 e P6 nascem desse commit.'

A regra 1 dos pacotes vira: 'Os contratos já estão no branch base: importe, não recrie. Se faltar algo, defina no SEU arquivo e reporte.'

Isso não é deploy perigoso: os crons para rota inexistente dão 404 inofensivo, e nada lê a 052 até as telas entrarem. Lembrar que, com a migration aplicada antes, nada quebra.

5. **Problema:** Conferência errada. Tanto o P5 ('Depois do merge') quanto o passo 17 das ações do Arthur mandam comparar o Faturamento do xcart com 'Vendas líquidas' do admin. O faturamento do plano é netPayment − imposto − alfândega − gorjeta, portanto INCLUI o frete cobrado. Na Shopify, Net sales é 'Sales revenue after discounts and sales reversals, excluding taxes, shipping, duties, and fees', e Total sales é 'including taxes, shipping, duties, and fees' (https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales). O Arthur vai ver uma diferença igual ao frete e concluir que o cálculo está errado.
   **Correção:** Novo texto do passo 17 e da conferência do P5:

'Comparar o Faturamento de ontem com Shopify > Análises > Vendas totais MENOS Impostos (e taxas alfandegárias, se houver). Não comparar com Vendas líquidas, que exclui o frete; o xcart inclui o frete cobrado. Diferenças esperadas: (a) pedido com pagamento pendente, que a Shopify conta e o xcart soma como 0 até ser pago; (b) reembolso, que o xcart abate na data do PEDIDO, enquanto o relatório da Shopify lança a devolução em outra data (não verificado).'

No '<details> Como calculamos' do P5, acrescentar: 'inclui o frete cobrado do cliente'.

6. **Problema:** P0, tela Custos, caixa 2: o plano pede 'Aviso neutro', mas Aviso em src/app/(dashboard)/tracking/selo.tsx aceita só tom: "err" | "warn". O typecheck reprova, ou o agente improvisa editando selo.tsx, que fica fora da lista de arquivos dele.
   **Correção:** Trocar no P0 por: 'Se !sincronizado: uma caixa neutra <p className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[12px] text-t2">Os SKUs vendidos aparecem depois da primeira sincronização de pedidos (até 15 min, ou Atualizar agora na tela Lucro).</p>. NÃO use Aviso (só err ou warn) e não edite selo.tsx.'

7. **Problema:** Escopo irreal para 45 min, mais acoplamento de risco no P1. São cerca de 60 arquivos novos. O P5 (motor de cálculo, 6 leituras paginadas e uma tela com 5 blocos), o P4 (10 arquivos, CRUD, ingest público e tela com duas seções) e o P1 (menu, seletor no layout e tela nova) passam de 45 min com ciclos de typecheck e teste, e a revisão vem depois. O P1 mistura a mudança de maior alcance (layout, menu e APP_HOME, que valem para todas as páginas) com uma feature nova (Eventos ao vivo). Se os eventos atrasarem, o menu e o APP_HOME não entram, e o P5 fica sem home.
   **Correção:** Acrescentar ao plano uma REGRA DE CORTE:

'Núcleo (tem que entrar): P0, P2, P3, P4, P5 e P1a. Stretch (entra só se estiver verde e revisado no tempo; senão fica para a rodada 2, sem bloquear nada): P1b e P6.'

O P1 se divide em dois commits:
- P1a: nav-ativo.ts e o teste, sidebar, top-nav, layout, pt.json, app-home, seletor-global e seletor-global-dados.
- P1b: tracking/feed.ts, api/tracking/eventos e a tela /tracking/eventos.

No P1a, o menu inclui o item /tracking/eventos só se o P1b entrar; senão, o item fica fora do NAV.

Ordem de merge: P0-A → P2 → P3 → P4 → P0-B → P5 junto com P1a (o APP_HOME só muda com /financeiro no ar) → P1b → P6.

8. **Problema:** Afirmações escritas como fato que não têm fonte ou contradizem a fonte (a regra pede marcar 'não verificado'):
(a) 'custo ~ 20 x 26 pontos' (ver item 1).
(b) 'MCC não é mais exigida', sem ressalva. A doc diz 'You need a manager account only if you need to link to and manage multiple accounts using the API' (https://developers.google.com/google-ads/api/docs/get-started/dev-token). Ler 3 contas avulsas com uma conta de serviço sem MCC não está confirmado.
(c) Risco 7: 'o crédito por clique inválido vai para a fatura e não reduz cost_micros', sem fonte.
(d) Decisão 'Guardar pedido': 'a segunda verdade não envelhece'. Com read_orders, a Shopify só devolve os últimos 60 dias (o próprio plano cita https://shopify.dev/docs/api/usage/access-scopes). Reembolso ou chargeback lançado num pedido com mais de 60 dias NÃO aparece na releitura por updated_at, e a foto fica velha.
   **Correção:** Reescrever:
(a) Apagar e substituir pelo texto do item 1.
(b) No 'depois' e no passo 11: 'Desde 09/09/2026 não há developer token; a doc exige MCC só para "link to and manage multiple accounts using the API". Ler várias contas avulsas com uma conta de serviço sem MCC: não verificado.'
(c) 'Clique inválido detectado depois vira crédito na fatura e não reduz cost_micros: não verificado.'
(d) 'A cópia é reconciliada para pedidos dos últimos 60 dias (limite de read_orders). Reembolso ou chargeback num pedido mais antigo não é visto sem read_all_orders: o lucro de meses antigos pode ficar superestimado.' Pôr isso também na lista de riscos.

### Opcionais

- P6, regras R2 e R3: a consulta em tracking_events filtra só por created_at, sem store_id. Não há índice só em created_at (os existentes são loja_idx (store_id, created_at desc), fila_idx parcial e destino_idx), então vira seq scan da tabela mais escrita a cada 10 min. A projeção da própria 048 é de cerca de 10 GB/mês com 100 lojas. Correção: buscar antes as lojas com tracking_configs.enabled e filtrar com .in('store_id', ids), para cair no tracking_events_loja_idx. Não é preciso criar índice novo na 052.
- P6, R2 (token do CAPI): com pouco volume, a janela de 1 h faz o alerta fechar (2 avaliações limpas) e reabrir a cada venda enquanto o token continua quebrado, e cada reabertura notifica de novo. Alternativa: a condição vale enquanto o ÚLTIMO evento meta daquele destination_id for 'falhou' com response->error->>code = '190', sem janela de tempo.
- P6, R5: loja pausada (Gotoku) responde 402 para sempre e gera um aviso eterno de 'pedidos sem atualizar'. Considerar pular loja com o mesmo erro há mais de 3 dias, ou um 'silenciar 7 dias'.
- P4, ingest: o limite de corpo da Vercel é 4,5 MB ('The maximum payload size for the request body ... is 4.5 MB', https://vercel.com/docs/functions/limitations). Os 5.000.000 caracteres do plano nunca são alcançados, e um envio maior recebe 413 da própria plataforma. Usar 4.000.000 como teto e, no script, mandar o reprocesso de 30 dias em blocos de 10 dias.
- P4, ingest: conferir o Authorization com a busca do hash ANTES de request.text() e do JSON.parse. Assim uma chamada sem segredo válido não custa parse de MB.
- P4, contas.ts: para montar temSegredo, não traga meta_access_token para a memória. Use select('ad_account_id, ingest_token_hash') mais .not('meta_access_token','is',null) em consultas separadas, ou uma coluna gerada booleana.
- P3, conectar: o fallback {system-user}/assigned_ad_accounts não traz permissão documentada na página de referência (https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_ad_accounts) e pode exigir business_management (não verificado). Acrescentar um terceiro caminho: o usuário digita os act_ IDs e o xcart valida cada um com GET act_{id}?fields=name,currency,timezone_name,account_status, que só precisa de ads_read.
- Ações do Arthur, passo 5: antes de 'Gerar novo token', o app precisa estar atribuído ao usuário do sistema (Atribuir ativos > Apps); senão ele não aparece na lista. Não verificado na doc desta pesquisa.
- Modelo 1 conta → 1 loja: perguntar ao Arthur se alguma conta Meta atende as duas lojas. Se atender, todo o gasto cai numa loja só. O TrueProfit resolve isso com filtro por nome de campanha (pesquisa mercado).
- Câmbio no dia 1: o fx_rates fica vazio até a primeira execução do cron (até 6 h, no minuto :20), e todo valor sai 'aproximado'. Acrescentar às ações: 'depois do deploy, logado como admin, abrir /api/jobs/financeiro/cambio uma vez'. Ou deixar o 'Atualizar agora' do P5 chamar o câmbio quando fx_rates estiver vazio.
- Taxa de pagamento: o plano só aplica a taxa em pedido que 'conta'. Pedido 100% reembolsado normalmente não devolve a taxa do gateway (não verificado). Considerar cobrar sobre recebido > 0 em qualquer 'venda'.
- Menu: o grupo 'Roteamento' tem um item também chamado 'Roteamento'. Renomear o item para 'Configurar rota'. O h1 da /tracking continua 'Rastreamento' enquanto o menu diz 'Saúde dos pixels': alinhar depois, sem tocar o tracking-screen.
- APP_HOME = /financeiro: usuário novo, sem loja, cai num estado vazio do Lucro em vez do convite da /overview. Se um dia vender como serviço, redirecionar para /setup quando não houver lojas.
- Eventos ao vivo: o campo 'fonte' é deduzido (checkout_token não nulo = pixel). Evento do Web Pixel sem token de checkout aparece como 'tema'. Rotular como 'tema ou pixel' nesse caso, ou deixar para a rodada 2.
- SQL (higiene, mesmo padrão da 048): as tabelas novas continuam com TRUNCATE, REFERENCES e TRIGGER para anon e authenticated pelo default do Supabase. Não é explorável pelo PostgREST, mas 'revoke all ... from public, anon, authenticated' seguido de 'grant select ... to authenticated' fecha de vez.
- Google Script: se a Vercel estiver com Bot Protection ou Attack Challenge ligado, o UrlFetchApp pode receber um desafio (não verificado). Testar com o Visualizar antes de agendar.
- Agendamento 'De hora em hora' dos Scripts: segue confirmado só por fonte de terceiros (https://nilsrooijmans.com/google-ads-scripts-faq/can-you-run-a-google-ads-script-multiple-times-per-hour/). O plano já marca isso; manter o aviso na tela.

## Pacotes

### P0 — Base (migration, contratos, crons) + tela Custos e taxas

Arquivos novos: `supabase/migrations/052_financeiro.sql`, `src/lib/financeiro/tipos.ts`, `src/lib/filtro-global.ts`, `src/lib/financeiro/csv-custos.ts`, `src/lib/financeiro/custos-queries.ts`, `src/app/(dashboard)/financeiro/custos/page.tsx`, `src/app/(dashboard)/financeiro/custos/custos-screen.tsx`, `src/app/api/financeiro/custos/route.ts`, `src/app/api/financeiro/config/route.ts`, `tests/financeiro-tipos.test.ts`, `tests/financeiro-csv-custos.test.ts`

Arquivos editados: `vercel.json`

### P1 — Navegação nova + seletor global + Eventos ao vivo

Arquivos novos: `src/components/layout/nav-ativo.ts`, `src/components/layout/seletor-global.tsx`, `src/components/layout/seletor-global-dados.tsx`, `src/lib/tracking/feed.ts`, `src/app/api/tracking/eventos/route.ts`, `src/app/(dashboard)/tracking/eventos/page.tsx`, `src/app/(dashboard)/tracking/eventos/eventos-screen.tsx`, `tests/nav-ativo.test.ts`

Arquivos editados: `src/components/layout/sidebar.tsx`, `src/components/layout/top-nav.tsx`, `src/app/(dashboard)/layout.tsx`, `messages/pt.json`, `src/lib/app-home.ts`

### P2 — Sync de pedidos Shopify + câmbio diário

Arquivos novos: `src/lib/financeiro/mapear-pedido.ts`, `src/lib/financeiro/shopify-pedidos.ts`, `src/app/api/jobs/financeiro/pedidos/route.ts`, `src/lib/financeiro/cambio-parse.ts`, `src/lib/financeiro/cambio-diario.ts`, `src/app/api/jobs/financeiro/cambio/route.ts`, `tests/financeiro-mapear-pedido.test.ts`, `tests/financeiro-cambio-parse.test.ts`

Arquivos editados: nenhum

### P3 — Meta Ads: conectar token e cron de Insights

Arquivos novos: `src/lib/ads/meta-mapear.ts`, `src/lib/ads/meta-graph.ts`, `src/lib/ads/meta-sync.ts`, `src/app/api/ads/meta/conectar/route.ts`, `src/app/api/jobs/ads/meta/route.ts`, `tests/ads-meta-mapear.test.ts`

Arquivos editados: nenhum

### P4 — Tela Contas de anúncio + Google Ads Script (ingestão)

Arquivos novos: `src/lib/ads/contas.ts`, `src/lib/ads/google-script.ts`, `src/lib/ads/google-ingest.ts`, `src/app/api/ads/google/ingest/route.ts`, `src/app/api/ads/google/contas/route.ts`, `src/app/api/ads/google/contas/[id]/segredo/route.ts`, `src/app/api/ads/contas/[id]/route.ts`, `src/app/(dashboard)/financeiro/anuncios/page.tsx`, `src/app/(dashboard)/financeiro/anuncios/anuncios-screen.tsx`, `tests/ads-google-ingest.test.ts`

Arquivos editados: nenhum

### P5 — Tela Lucro (home) + cálculo

Arquivos novos: `src/lib/financeiro/calculo.ts`, `src/lib/financeiro/queries.ts`, `src/app/(dashboard)/financeiro/page.tsx`, `src/app/(dashboard)/financeiro/financeiro-screen.tsx`, `tests/financeiro-calculo.test.ts`

Arquivos editados: nenhum

### P6 — Alertas + Telegram

Arquivos novos: `src/lib/alertas/regras.ts`, `src/lib/alertas/avaliar.ts`, `src/lib/alertas/telegram.ts`, `src/lib/alertas/queries.ts`, `src/app/api/jobs/alertas/route.ts`, `src/app/api/alertas/canal/route.ts`, `src/app/api/alertas/[id]/route.ts`, `src/app/(dashboard)/alertas/page.tsx`, `src/app/(dashboard)/alertas/alertas-screen.tsx`, `tests/alertas-regras.test.ts`

Arquivos editados: nenhum
