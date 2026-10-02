# Pesquisa da reformulação financeira (02/10/2026)

Seis pesquisas independentes, feitas por agentes com acesso à web e ao código. Toda afirmação sobre API vem com fonte; o que não tinha fonte está marcado como "não verificado" no texto.


---

## Gasto do Google Ads

**Resumo.** Uma mudança de setembro de 2026 muda a conclusão. Em 09/09/2026 o Google aposentou o developer token. O acesso à Google Ads API agora pertence ao projeto do Google Cloud, e a inscrição é feita direto no Cloud Console, sem conta MCC. Fontes: https://developers.google.com/google-ads/api/docs/get-started/dev-token e o post de 10/09/2026 (https://ads-developers.googleblog.com/2026/09/new-onboarding-experience-for-google-ads-api.html). As três barreiras da decisão anterior (token, aprovação e MCC) não valem mais para quem só lê dados das próprias contas.

O nível Explorer existe desde 06/02/2026. Ele dá acesso a contas reais com até 2.880 operações por dia, conta em janela de 24h móvel. Não pede verificação de marca. A doc diz que o Google "pode" aprovar automaticamente depois do pedido (https://developers.google.com/google-ads/api/docs/api-policy/access-levels). Cada Search/SearchStream conta como 1 operação, e páginas seguintes não contam (https://developers.google.com/google-ads/api/docs/best-practices/quotas).

Com conta de serviço do Google Cloud (adicionada como usuário na conta Google Ads, sem Workspace, sem OAuth e sem tela de consentimento), o xcart consegue puxar por REST a cada 15 min, de forma automática:
- custo, cliques e impressões por dia e por campanha;
- cliques inválidos;
- conversões e valor atribuídos.

Não há biblioteca nem custo.

A alternativa sem nenhuma aprovação é um Google Ads Script colado em cada conta, rodando de hora em hora e fazendo POST assinado (HMAC) num endpoint do xcart. Funciona hoje, mas sem MCC são N cópias para manter.

Não servem para o caso:
- BigQuery Data Transfer: diário, exige GCP e BigQuery, e ainda precisaria de outro conector até o Supabase.
- Looker Studio: a API dele não exporta dados.
- Complemento do Sheets: só existe nos EUA e em inglês.
- Relatório agendado por e-mail: diário, chega como anexo.
- Ferramentas de terceiros (Windsor a partir de US$ 23/mês diário, US$ 118/mês por hora): pagas e dão acesso das contas a um terceiro.

**Recomendação.** Recomendo a opção A: Google Ads API via REST, com conta de serviço e nível Explorer, puxada por um cron da Vercel. A opção B (Ads Script com webhook) fica como plano B, se o Google não liberar o Explorer.

Por que A, no caso do Arthur (3 a 10 contas próprias, sem MCC):

1. O motivo de "não usar API" sumiu. Desde 09/09/2026 não existe developer token nem exigência de MCC: o acesso fica no projeto do Cloud. A conta de serviço é o fluxo que o próprio Google recomenda para quem acessa as próprias contas (https://developers.google.com/google-ads/api/docs/oauth/overview).

2. Por conta, o trabalho é só adicionar um e-mail. Na conta Google Ads basta Admin > Acesso e segurança > + usuário com o e-mail da conta de serviço, nível "Somente leitura". Conta de serviço só não aceita o nível "Somente e-mail" (https://developers.google.com/google-ads/api/docs/oauth/service-accounts). Não tem código colado em 10 contas para manter.

3. O controle fica do nosso lado: o xcart decide quando buscar. Dá para sincronizar a cada 15 min, reprocessar janelas e atualizar sob demanda. Também dá para descobrir as contas sozinho: listAccessibleCustomers lista as contas onde a conta de serviço foi adicionada (https://developers.google.com/google-ads/api/docs/account-management/listing-accounts). Para casar conta e loja, o campo customer.conversion_tracking_setting.conversion_tracking_id devolve o número do AW- que já está em tracking_destinations.conta.

4. A cota sobra. Com 10 contas a cada 15 min dá cerca de 960 operações por dia; somando metadados e reprocesso, cerca de 1.000 de 2.880. Acima de cerca de 20 contas, passar para cada 30 min.

5. Custo zero. A API não cobra (afirmação de terceiros, não verificada na doc oficial), e o cron cabe no Pro: até 100 crons por projeto, intervalo mínimo de 1 min (https://vercel.com/docs/cron-jobs/usage-and-pricing). Dá para fazer sem dependência nova: o JWT RS256 assina com node:crypto, e o fetch vai direto em googleads.googleapis.com/v25.

Fluxo passo a passo de A:
1. O Arthur cria o projeto no Cloud, ativa a Google Ads API e pede o Explorer na página "Google Ads API Overview".
2. Ele cria a conta de serviço e a chave, ou usa federação OIDC da Vercel sem chave (https://vercel.com/docs/oidc/gcp).
3. Ele adiciona o e-mail da conta de serviço como Somente leitura em cada conta Google Ads.
4. A chave vai para as variáveis de ambiente da Vercel. Quem coloca é o Arthur; ela não passa pelo chat.
5. Uma migration cria ad_accounts e ad_spend_daily, com RLS por user_id e WITH CHECK.
6. Um cron `*/15` pega hoje e ontem no fuso da conta para cada conta ativa.
7. Um cron diário reprocessa os últimos 30 dias, com cliques inválidos e conversões por data de conversão.
8. Um cron semanal reprocessa 90 dias, só para conversões.
9. A tela mostra "hoje (parcial, atualizado às HH:MM)".

Quando trocar para B: se a página de Overview não oferecer o Explorer, ou se o pedido ficar parado. Nesse caso, o Ads Script por hora com POST HMAC num endpoint de ingestão grava na mesma tabela, com source='script'. Vale desenhar a tabela já aceitando as duas fontes.

### Opções avaliadas

#### A) Google Ads API (REST) com conta de serviço e nível Explorer, puxada pelo cron da Vercel

- **Como funciona:** Projeto no Google Cloud com a Google Ads API ativada e nível Explorer pedido na página 'Google Ads API Overview' do Cloud Console. Uma conta de serviço é adicionada como usuário 'Somente leitura' em cada conta Google Ads. O xcart troca um JWT RS256 assinado pela chave por um access token de 1 hora (POST https://oauth2.googleapis.com/token, grant_type urn:ietf:params:oauth:grant-type:jwt-bearer). Depois faz POST https://googleads.googleapis.com/v25/customers/{id}/googleAds:searchStream com {"query": GAQL}. Os cabeçalhos são só Authorization e Content-Type: developer-token é opcional e ignorado desde 09/09/2026, e login-customer-id só é exigido quando o acesso passa por MCC. A resposta é um array JSON de lotes {results:[...]}, com campos em lowerCamelCase e int64 (costMicros) como string.
- **Requisitos:** Conta Google com acesso de administrador nas contas Google Ads (para adicionar usuário). Projeto no Google Cloud, de preferência sem organização ou em organização que permita chave de conta de serviço. Nível Explorer concedido. Variáveis na Vercel: e-mail da conta de serviço e chave privada, ou configuração de federação OIDC. Não precisa de MCC, developer token, tela de consentimento OAuth nem verificação de marca (esta só é exigida para Basic e Standard).
- **Limites:** Explorer: 2.880 operações por dia em contas de produção (janela de 24h móvel); Search/SearchStream = 1 operação; páginas seguintes não contam. Bloqueados no Explorer: CreateCustomerClient, gestão de usuários, Planning (KeywordPlan*, AudienceInsights, ReachPlan) e cobrança/pagamento. Relatório não está bloqueado. Basic: 15.000/dia, exige verificação de marca, aprovação automatizada em minutos. Standard: ilimitado, cerca de 10 dias úteis. Dado por data em granularidade fina só até 37 meses atrás. Access token dura 3.600 s.
- **Prós:** Custo zero, totalmente automático, frequência escolhida por nós (15 min), reprocessamento e atualização sob demanda. Conta nova = só adicionar o e-mail. Descobre as contas sozinho (listAccessibleCustomers) e casa com a loja pelo conversion_tracking_id (o número do AW-). Nenhum código nem segredo dentro do Google Ads. A conta de serviço não depende do login pessoal do Arthur. Escala para o futuro serviço: o cliente adiciona o e-mail da conta de serviço do xcart.
- **Contras:** A concessão do Explorer não é garantida: a doc diz que o Google 'pode deixar você pedir' e 'pode aprovar automaticamente'. Prazo de revisão manual não publicado. A chave da conta de serviço é segredo de longa duração (mitigação: Somente leitura e federação OIDC da Vercel). Limite de 20 contas Google Ads por e-mail; acima disso, MCC. Não existe biblioteca Node oficial: a npm google-ads-api (Opteo, v25.1.0 de 17/09/2026, 9,6 MB, gRPC) é comunitária e voltada a refresh token; REST puro via fetch é mais leve. Versão a cada ~3 meses: v25 tem sunset em ago/2027 e a v26 sai em out/2026.
- **Fontes:** https://developers.google.com/google-ads/api/docs/get-started/dev-token · https://developers.google.com/google-ads/api/docs/api-policy/access-levels · https://ads-developers.googleblog.com/2026/09/new-onboarding-experience-for-google-ads-api.html · https://developers.google.com/google-ads/api/docs/best-practices/quotas · https://developers.google.com/google-ads/api/docs/oauth/overview · https://developers.google.com/google-ads/api/docs/oauth/service-accounts · https://developers.google.com/google-ads/api/docs/get-started/make-first-call · https://developers.google.com/google-ads/api/docs/concepts/call-structure · https://developers.google.com/google-ads/api/rest/common/search · https://protobuf.dev/programming-guides/json/ · https://developers.google.com/identity/protocols/oauth2/service-account · https://developers.google.com/google-ads/api/docs/account-management/listing-accounts · https://developers.google.com/google-ads/api/docs/sunset-dates · https://developers.google.com/google-ads/api/docs/release-notes · https://developers.google.com/google-ads/api/docs/client-libs · https://www.npmjs.com/package/google-ads-api · https://vercel.com/docs/oidc/gcp · https://vercel.com/docs/cron-jobs/usage-and-pricing · https://ppc.land/google-faces-developer-token-application-backlog-as-new-api-tier-debuts/ · https://developers.google.com/google-ads/api/docs/reporting/zero-metrics

#### B) Google Ads Script por conta, com POST assinado (HMAC) num webhook do xcart

- **Como funciona:** Um JavaScript colado em Ferramentas > Ações em massa > Scripts de cada conta Google Ads (o caminho no menu não foi verificado). Ele roda AdsApp.search(GAQL), que é executado sobre a própria Google Ads API, com a versão mais nova por padrão. Monta o JSON com custo, cliques, impressões, cliques inválidos e conversões por dia e campanha. Pega moeda e fuso por AdsApp.currentAccount().getCurrencyCode() e getTimeZone(). Assina com Utilities.computeHmacSha256Signature e Utilities.base64Encode e envia com UrlFetchApp.fetch (POST, contentType application/json, muteHttpExceptions). É agendado de hora em hora. O servidor confere o HMAC sobre `timestamp.corpo` com timingSafeEqual (mesmo padrão de src/lib/shopify/webhook.ts) e faz upsert.
- **Requisitos:** Só uma conta Google Ads. A doc diz: 'All you need is a Google Ads account'. Não precisa de developer token, Cloud, conta de serviço nem MCC. O Arthur autoriza o script com o login dele (Authorize > Grant access) e agenda.
- **Limites:** Execução: 30 min por script (60 min em MCC com executeInParallel). 250 scripts autorizados por conta. Iterador com 50.000 resultados por padrão. Log truncado em 100 KB. UrlFetch: a doc de Ads Scripts só diz que há cotas; no Apps Script de conta pessoal o limite é 20.000 chamadas/dia e 50 MB por POST (não verificado especificamente para Ads Scripts). Agendamento por hora: confirmado só por fonte de terceiros (Nils Rooijmans); a página oficial de ajuda lista 'once, daily, weekly or monthly at a certain hour'. Confira na interface.
- **Prós:** Funciona hoje, sem aprovação de ninguém. Custo zero. Nenhuma credencial do Google sai da conta: o xcart só recebe dados. Endpoint simples.
- **Contras:** Sem MCC são N cópias: cada mudança no script tem que ser colada de novo em todas as contas. Frequência mínima de 1 hora, sem escolher o minuto. É push, então o xcart não consegue pedir reprocesso sob demanda: a janela de reprocesso fica dentro do script. Roda como o usuário do Arthur; se ele perder o acesso, para. O segredo fica visível no código para qualquer usuário da conta. Falha só aparece por e-mail do Google ou por ausência de dado, então o xcart precisa de alarme de 'sem dados há mais de 2h'. Com MCC, um único script cobre até 50 contas em paralelo (executeInParallel), mas o Arthur decidiu não ter MCC.
- **Fontes:** https://developers.google.com/google-ads/scripts/docs/start · https://developers.google.com/google-ads/scripts/docs/limits · https://developers.google.com/google-ads/scripts/docs/features/reports · https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp · https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp_account · https://developers.google.com/google-ads/scripts/docs/features/third-party-apis · https://developers.google.com/apps-script/reference/utilities/utilities · https://developers.google.com/apps-script/guides/services/quotas · https://developers.google.com/google-ads/scripts/docs/concepts/manager-scripts · https://support.google.com/google-ads/answer/188712 · https://nilsrooijmans.com/google-ads-scripts-faq/can-you-run-a-google-ads-script-multiple-times-per-hour/

#### C) BigQuery Data Transfer Service (conector Google Ads)

- **Como funciona:** Uma transferência agendada copia relatórios do Google Ads (tabelas p_ads_*, por exemplo p_ads_CampaignBasicStats) para um dataset do BigQuery, com janela de atualização que reprocessa os últimos N dias. O xcart ainda teria que ler o BigQuery e gravar no Supabase.
- **Requisitos:** Projeto GCP com faturamento e BigQuery. Autorização com o login que acessa a conta Google Ads (customer ID ou MCC). Uma segunda integração, BigQuery até o Supabase, com conta de serviço.
- **Limites:** Frequência diária. Preço: a referência histórica é de US$ 2,50 por customer ID por mês; não verificado para 2026, porque a página de preços não carregou.
- **Prós:** Gerenciado pelo Google. Reprocessa sozinho dentro da janela (padrão de 7 dias, máximo de 30 segundo a página, extraído com falha parcial). Histórico.
- **Contras:** Só diário: não serve para ver o gasto de hoje. Exige Cloud e faturamento de qualquer jeito, então dá mais trabalho que a opção A e entrega menos. Duas integrações em vez de uma.
- **Fontes:** https://docs.cloud.google.com/bigquery/docs/google-ads-transfer · https://docs.cloud.google.com/bigquery/docs/adwords-transfer · https://cloud.google.com/bigquery/pricing

#### D) Looker Studio

- **Como funciona:** O conector nativo do Google Ads alimenta painéis.
- **Requisitos:** Conta Google.
- **Limites:** Sem saída de dados por API.
- **Prós:** Grátis, bom para olhar.
- **Contras:** Não serve para ingestão: a API do Looker Studio só busca e gerencia assets e permissões, não exporta dados de relatório.
- **Fontes:** https://developers.google.com/looker-studio/integrate/api

#### E) Complemento oficial 'Google Ads' para Google Sheets

- **Como funciona:** Cria relatórios numa planilha com atualização agendada. O xcart leria a planilha pela Sheets API.
- **Requisitos:** Google Sheets em inglês, nos EUA. Uma conta Google Ads por planilha. Para o xcart ler, ainda é preciso Cloud e credencial da Sheets API.
- **Limites:** Uma conta por planilha; disponibilidade geográfica restrita.
- **Prós:** Sem código no Google Ads.
- **Contras:** Oficialmente 'only available in the United States' e só em inglês. Uma conta por planilha. Precisa de Cloud para ler, então é pior que a opção A em tudo.
- **Fontes:** https://support.google.com/google-ads/answer/9000139

#### F) Relatório agendado por e-mail

- **Como funciona:** No editor de relatórios ou na tabela de estatísticas: Agendar, com frequência diária ou semanal, formatos CSV, XLSX, PDF etc., enviado a usuários com acesso à conta.
- **Requisitos:** O xcart precisaria de recebimento de e-mail (inbound) e de um parser de anexo.
- **Limites:** Diário no melhor caso.
- **Prós:** Sem Cloud e sem código no Google Ads.
- **Contras:** Frequência mínima diária. Só vai para usuários da conta. Formato frágil. O xcart não tem infraestrutura de e-mail de entrada. Relatório salvo sem acesso por 18 meses é apagado.
- **Fontes:** https://support.google.com/google-ads/answer/2404176

#### G) Ferramentas de terceiros (Windsor.ai, Supermetrics etc.)

- **Como funciona:** O SaaS se conecta às contas Google Ads com o projeto Cloud dele e grava num destino. O Windsor grava direto em PostgreSQL, que seria o Supabase.
- **Requisitos:** Assinatura e autorização OAuth da conta Google do Arthur para o terceiro.
- **Limites:** Windsor (página oficial): Basic US$ 23/mês com sync diário; sync por hora só a partir do Standard, US$ 118/mês; 15 min no Professional, US$ 598/mês. Supermetrics: a partir de cerca de US$ 49/mês, só anual (fonte de terceiros, não verificado na página oficial).
- **Prós:** Zero código do lado Google. O mesmo fornecedor cobre o Meta.
- **Contras:** Custo mensal recorrente. Um terceiro com acesso de leitura a todas as contas. O esquema de dados é dele. Depende da conformidade dele com a nova política contra 'programmatic proxies' de 31/08/2026, que exige integração com projeto Cloud próprio.
- **Fontes:** https://windsor.ai/pricing/ · https://blog.coupler.io/supermetrics-pricing/ · https://ads-developers.googleblog.com/2026/08/making-google-ads-more-secure-with.html

#### H) OAuth de usuário (refresh token) em vez de conta de serviço

- **Como funciona:** É a mesma API da opção A, mas autenticada pelo login do Arthur: cliente OAuth do tipo Desktop, refresh token via gcloud ou OAuth Playground.
- **Requisitos:** Tela de consentimento OAuth. O escopo https://www.googleapis.com/auth/adwords é sensível desde 2020, e app não verificado mostra aviso (aceitável para uso próprio).
- **Limites:** 100 refresh tokens por conta Google por client ID; o mais antigo é invalidado sem aviso.
- **Prós:** Não precisa de chave de conta de serviço.
- **Contras:** Com o app em status 'Testing', o refresh token expira em 7 dias. Em 'Production' sem verificação aparece aviso e há limite de 100 usuários. O acesso morre se o usuário perder acesso à conta. O próprio Google recomenda conta de serviço para contas próprias.
- **Fontes:** https://developers.google.com/google-ads/api/docs/oauth/single-user-authentication · https://developers.google.com/identity/protocols/oauth2#expiration · https://ads-developers.googleblog.com/2020/10/google-ads-and-adwords-apis-upgrading.html

### Detalhes técnicos

VERSÃO VIGENTE: v25.2, de 23/09/2026 (https://developers.google.com/google-ads/api/docs/release-notes). Na URL REST usa-se /v25/. O sunset da v25 é em ago/2027, a v26 sai em out/2026 e a v22 sai do ar em out/2026 (https://developers.google.com/google-ads/api/docs/sunset-dates). Nas versões v25+, projeto só com nível Test chamando conta real recebe AuthorizationError.CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION; o conserto é pedir o Explorer (https://developers.google.com/google-ads/api/docs/get-started/dev-token).

1) AUTENTICAÇÃO COM CONTA DE SERVIÇO, SEM DEPENDÊNCIA NOVA
Ver https://developers.google.com/identity/protocols/oauth2/service-account.
```ts
import "server-only";
import { createSign } from "node:crypto";
const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
export async function tokenGoogleAds(email: string, chavePem: string) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64u({ alg: "RS256", typ: "JWT" });
  const cor = b64u({ iss: email, scope: "https://www.googleapis.com/auth/adwords",
    aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 });
  const ass = createSign("RSA-SHA256").update(`${cab}.${cor}`).sign(chavePem).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cab}.${cor}.${ass}` }) });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token as string; // vale 3600 s: 1 por execução do cron
}
```
Alternativa sem chave: federação OIDC da Vercel (@vercel/oidc + google-auth-library ExternalAccountClient), em https://vercel.com/docs/oidc/gcp.

2) CONSULTA
Ver https://developers.google.com/google-ads/api/rest/common/search.
```ts
if (!/^\d{10}$/.test(cid)) throw new Error("customer id invalido");
const r = await fetch(`https://googleads.googleapis.com/v25/customers/${cid}/googleAds:searchStream`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query }) });
const lotes = (await r.json()) as Array<{ results?: any[] }>;   // array de lotes
const linhas = lotes.flatMap(l => l.results ?? []);             // r.metrics.costMicros e string
```
Os hosts são fixos do Google, então dá para usar fetch direto (o safeFetch do repo é para URL vinda do usuário). Mas o customer id tem que ser validado antes de entrar na URL. O customer id tem 10 dígitos, sem hífens. Não é o AW-.

3) GAQL (campos conferidos na referência v25)
Fontes: https://developers.google.com/google-ads/api/fields/v25/metrics, /customer e /campaign. Teste no Query Validator v25 antes.

(a) A cada 15 min, por conta (1 operação):
```sql
SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
       metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value
FROM campaign WHERE segments.date BETWEEN '<ontem>' AND '<hoje>'
```
As datas são calculadas no fuso da conta, com Intl.DateTimeFormat(time_zone). TODAY, YESTERDAY e BETWEEN são avaliados no customer.time_zone, e LAST_7_DAYS exclui hoje (https://developers.google.com/google-ads/api/docs/query/date-ranges).

(b) Diário, metadados (1 operação):
```sql
SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status,
       customer.conversion_tracking_setting.conversion_tracking_id
FROM customer
```
currency_code e time_zone são imutáveis. conversion_tracking_id é o número do AW- e casa com tracking_destinations.conta, o que permite sugerir a loja sozinho.

(c) Diário, reprocesso de 30 dias: a consulta (a) com BETWEEN de D-30 a hoje, mais metrics.conversions_by_conversion_date e metrics.conversions_value_by_conversion_date (com data, "a data é a da conversão").

(d) Diário, cliques inválidos:
```sql
SELECT segments.date, metrics.invalid_clicks, metrics.invalid_click_rate, metrics.clicks, metrics.cost_micros
FROM customer WHERE segments.date BETWEEN ...
```
invalid_clicks só é selecionável com campaign/customer e segments de data, rede, clique e dispositivo; NÃO com segments.hour.

(e) Semanal: (a) com 90 dias, só por causa das conversões.

Orçamento com 10 contas a cada 15 min: cerca de 960 + 10 + 10 + 10 operações por dia, ou seja cerca de 1.000 de 2.880. listAccessibleCustomers (GET /v25/customers:listAccessibleCustomers, ignora login-customer-id) roda uma vez por dia.

4) PARTICULARIDADES DOS DADOS
- Dia de hoje é parcial. A maioria das métricas, incluindo conversões último clique, atualiza de hora em hora (SLO de 1h). Conversões não último clique e outros relatórios têm atraso maior. O Google avisa que métricas mudam "um ou mais dias depois" por tráfego inválido, conversão atrasada e ajuste de fim de mês (https://support.google.com/google-ads/answer/2544985).
- metrics.conversions e conversions_value ficam na data do CLIQUE. A janela de conversão vai de 1 a 30, 60 ou 90 dias, padrão de 30 (https://support.google.com/google-ads/answer/3123169, https://support.google.com/google-ads/answer/9549009). Por isso o reprocesso de 30 e 90 dias. Para comparar com pedidos do Shopify, use *_by_conversion_date.
- Cliques inválidos detectados na hora saem das métricas e da cobrança. Os detectados depois viram CRÉDITO na fatura, não reduzem cost_micros retroativamente. Há o Invalid Activity Credit Report (https://support.google.com/google-ads/answer/42995, https://support.google.com/google-ads/answer/1704323, https://support.google.com/google-ads/answer/16826168). Logo, o "gasto" do relatório pode ficar acima do valor faturado.
- Linha com todas as métricas zeradas não volta quando se segmenta por data (https://developers.google.com/google-ads/api/docs/reporting/zero-metrics). No reprocesso, zere ou apague as linhas da janela que não vieram, senão um custo corrigido para 0 fica velho no banco.
- Moeda: cost_micros vem na moeda da conta (divida por 1.000.000). Guarde o valor original e a moeda, e converta para a moeda da loja com câmbio do dia congelado. O BCE publica USD e BRL contra EUR em dias úteis por volta das 16h CET, em XML e CSV (https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html).
- Fuso: se o fuso da conta for diferente do fuso da loja, puxe segments.hour (compatível com cost_micros em campaign) e reagrupe por hora no fuso da loja. Cliques inválidos ficam no dia da conta.
- ROAS "real" deve usar a receita dos pedidos Shopify do xcart. O conversions_value do Google fica só como comparação, porque o envio /pagead não tem confirmação.

5) ESQUEMA SUGERIDO (não criado)
- ad_accounts: id, user_id, store_id, plataforma ('google'), external_id de 10 dígitos, nome, currency_code, time_zone, conversion_tracking_id, ativo, ultimo_sync_em, ultimo_erro. RLS user_id = auth.uid() com USING e WITH CHECK, conforme a migration 030.
- ad_spend_daily: ad_account_id, data (no fuso da conta), campaign_id, campaign_name, campaign_status, canal, cost_micros bigint, clicks, impressions, invalid_clicks, conversions numeric, conversions_value numeric, conv_by_conv_date, conv_value_by_conv_date, currency_code, source ('api' ou 'script'), synced_at. Chave única (ad_account_id, data, campaign_id). Escrita só pelo service role.
- O cron segue o padrão de src/app/api/jobs/tracking/drain/route.ts (CRON_SECRET), com entrada nova em vercel.json, por exemplo "*/15 * * * *" e outra diária. No Next 16 conferido em node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md: route handler POST com request.text(), export const runtime = 'nodejs', export const maxDuration.

6) SCRIPT COMPLETO DA OPÇÃO B (um por conta, segredo próprio por conta)
```js
// xcart: envia gasto do Google Ads. Agendar: De hora em hora.
var XCART_URL = 'https://user.xcart.app/api/ads/google/ingest';
var XCART_SEGREDO = 'COLE_O_SEGREDO_DESTA_CONTA';
var DIAS_NORMAL = 3, DIAS_REPROCESSO = 30, HORA_REPROCESSO = 4; // 04h no fuso da conta
function main() {
  var conta = AdsApp.currentAccount();
  var tz = conta.getTimeZone();
  var agora = new Date();
  var hora = Number(Utilities.formatDate(agora, tz, 'H'));
  var dias = hora === HORA_REPROCESSO ? DIAS_REPROCESSO : DIAS_NORMAL;
  var fim = Utilities.formatDate(agora, tz, 'yyyy-MM-dd');
  var inicio = Utilities.formatDate(new Date(agora.getTime() - (dias - 1) * 86400000), tz, 'yyyy-MM-dd');
  var q = 'SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.invalid_clicks, metrics.conversions, metrics.conversions_value ' +
    "FROM campaign WHERE segments.date BETWEEN '" + inicio + "' AND '" + fim + "'";
  var linhas = [], it = AdsApp.search(q);   // campos voltam em lowerCamelCase
  while (it.hasNext()) {
    var r = it.next();
    linhas.push({ data: r.segments.date, campanha_id: String(r.campaign.id), campanha: r.campaign.name,
      status: r.campaign.status, canal: r.campaign.advertisingChannelType,
      custo_micros: String(r.metrics.costMicros || 0), cliques: Number(r.metrics.clicks || 0),
      impressoes: Number(r.metrics.impressions || 0), cliques_invalidos: Number(r.metrics.invalidClicks || 0),
      conversoes: Number(r.metrics.conversions || 0), valor_conversoes: Number(r.metrics.conversionsValue || 0) });
  }
  // Corpo 100% ASCII: o HMAC e os bytes enviados ficam iguais seja qual for o charset.
  var corpo = JSON.stringify({ v: 1, customer_id: conta.getCustomerId().replace(/-/g, ''),
    moeda: conta.getCurrencyCode(), fuso: tz, inicio: inicio, fim: fim, gerado_em: agora.toISOString(), linhas: linhas })
    .replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
  var ts = String(Math.floor(agora.getTime() / 1000));
  var assinatura = Utilities.base64Encode(Utilities.computeHmacSha256Signature(ts + '.' + corpo, XCART_SEGREDO));
  var resp = UrlFetchApp.fetch(XCART_URL, { method: 'post', contentType: 'application/json', payload: corpo,
    headers: { 'X-Xcart-Conta': conta.getCustomerId().replace(/-/g, ''), 'X-Xcart-Timestamp': ts, 'X-Xcart-Assinatura': assinatura },
    muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('xcart ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
  Logger.log(linhas.length + ' linhas de ' + inicio + ' a ' + fim);
}
```
No servidor:
- leia o corpo cru com request.text();
- ache o segredo pela conta em X-Xcart-Conta, numa tabela só do service role, como tracking_destination_secrets;
- confira createHmac('sha256', segredo).update(`${ts}.${raw}`, 'utf8') contra o base64 do cabeçalho com timingSafeEqual, verificando o tamanho antes;
- recuse timestamp com mais de 2h de diferença e gerado_em mais velho que o último gravado (replay de dado velho);
- confira que o customer_id do corpo é igual ao do cabeçalho;
- faça upsert e zere as linhas da janela que faltarem.
Gere o segredo com crypto.randomBytes(32) e mostre o script pronto na tela. A doc de Scripts confirma POST com JSON e muteHttpExceptions; a doc do Apps Script confirma computeHmacSha256Signature(String, String) e base64Encode(Byte[]).

### Riscos

1. O Explorer pode não ser concedido. A doc diz que o Google "may let you apply" e "may automatically upgrade", e houve fila em fev/2026 (ppc.land). O prazo de revisão manual do Explorer não é publicado. Mitigação: opção B grava na mesma tabela.

2. Chave da conta de serviço vazada dá leitura de todas as contas onde ela está. Mitigação: nível Somente leitura, variável Sensitive na Vercel, rotação, ou federação OIDC da Vercel (sem chave). Organizações do Google Cloud criadas a partir de 03/05/2024 bloqueiam criação de chave por padrão (iam.managed.disableServiceAccountKeyCreation, https://docs.cloud.google.com/organization-policy/manage-baseline-constraints). Projeto pessoal de @gmail não tem organização, então isso não deve se aplicar (não verificado no caso dele).

3. Limite de 20 contas Google Ads por e-mail, o que inclui o da conta de serviço. Acima disso precisa de MCC.

4. O Google está pilotando o bloqueio de ações sensíveis, como mudança de acesso de usuário, para logins de e-mail grátis (@gmail) num subconjunto de anunciantes (fonte de terceiros: https://seroundtable.com/google-ads-free-email-account-security-41827.html). Se a conta do Arthur estiver no piloto, adicionar a conta de serviço pode ser bloqueado. A aprovação multipessoa (desde jul/2026) isenta funções somente leitura e usuários de API (https://support.google.com/google-ads/answer/16891189).

5. Dados mudam depois do fato:
- hoje é parcial;
- custo é ajustado por tráfego inválido;
- crédito de clique inválido tardio vai para a fatura, não para cost_micros;
- conversões ficam na data do clique e mudam por até 90 dias.
Sem reprocesso e sem zerar as linhas ausentes, o lucro do painel fica errado.

6. Moeda e fuso: o custo vem na moeda e no fuso da conta, que podem diferir dos da loja (Lash Bestie em USD, cliente pagando EUR). É preciso câmbio diário congelado e reagrupamento por hora se os fusos diferirem.

7. Versões: v26 em out/2026 e sunset da v25 em ago/2027. Conferir a versão uma vez por ano. Os Scripts usam a mais nova por padrão.

8. Biblioteca Node comunitária (google-ads-api da Opteo): o Google diz "use at your own risk", e ela tem 9,6 MB com gRPC. Prefira REST.

9. Política de 31/08/2026 contra "programmatic proxies": integrações têm que usar projeto Cloud próprio. A opção A cumpre. Ferramentas de terceiros e "MCPs sem developer token" são o alvo.

10. Venda futura como serviço: o Explorer (2.880 operações por dia) vale por projeto Cloud e seria compartilhado entre todos os clientes. Para escalar: Basic (verificação de marca, 15.000/dia) e, se usar OAuth multiusuário, verificação do app OAuth (escopo adwords é sensível).

11. Opção B: roda como o usuário do Arthur, o segredo fica legível na conta, são N cópias para manter, não dá para escolher o minuto da execução por hora e falha é silenciosa (precisa de alarme por ausência).

12. Premissa velha no repo: o comentário em C:/Onedrive/shopify-creator/src/lib/tracking/google-ads.ts diz que o caminho por API (importação offline) "exige developer token aprovado". Isso não vale desde 09/09/2026, e a lista de bloqueios do Explorer não inclui ConversionUploadService. Só anotado, nada mudado.

13. Em C:/Onedrive/shopify-creator/supabase/migrations/043_tracking_destinos.sql, tracking_destinations.conta guarda o AW- (conversion id), que NÃO é o customer id de 10 dígitos. Gasto precisa de tabela própria conta de anúncio para loja. O casamento automático é possível via customer.conversion_tracking_setting.conversion_tracking_id.

### O que só o Arthur pode fazer

OPÇÃO A (recomendada), cerca de 30 a 45 min no total:
1. Entrar em https://console.cloud.google.com com a conta Google que administra as contas de anúncio e criar um projeto, por exemplo "xcart-ads". Se aparecer escolha de organização, deixe "Sem organização".
2. APIs e serviços > Biblioteca > "Google Ads API" > Ativar.
3. Abrir a página "Google Ads API Overview" do projeto e concluir a inscrição, aceitando os termos (essa aceitação é dele). Em "Upgrade access level", conferir que o próximo nível é "Explorer" e clicar em "Apply for access". Me dizer qual nível aparece depois: Test ou Explorer. NÃO pedir developer token no "Central de API" de MCC; o Google diz que esses pedidos não são mais processados.
4. IAM e administrador > Contas de serviço > Criar, com o nome "xcart-ads-leitura" e sem papel no projeto. Copiar o e-mail (…@xcart-ads.iam.gserviceaccount.com). Em Chaves > Adicionar chave > JSON, baixar o arquivo. NÃO colar a chave no chat: ele mesmo cria na Vercel (Settings > Environment Variables, marcar Sensitive) GOOGLE_ADS_SA_EMAIL e GOOGLE_ADS_SA_PRIVATE_KEY (o campo private_key do JSON). Depois apaga o arquivo baixado. Se preferir sem chave, peça para eu passar o roteiro de federação OIDC da Vercel.
5. Em CADA conta Google Ads (Softnook: as 2 contas, AW-18463833677 e AW-18463882690; Lash Bestie: AW-18419000686), logado como administrador: Admin > Acesso e segurança > Usuários > "+". Colar o e-mail da conta de serviço, escolher "Somente leitura" e clicar em Adicionar conta. Se o Google bloquear por causa do login @gmail (piloto de ações sensíveis), me avise.
6. Me passar o customer ID de 10 dígitos de cada conta (aparece no topo do Google Ads, formato 123-456-7890) e a loja de cada uma. Isso é opcional: o xcart pode descobrir as contas e casar pelo número do AW-.

OPÇÃO B (só se o Explorer não sair), cerca de 5 min por conta:
1. No xcart, gerar o script da conta, que já vem com o segredo dela.
2. No Google Ads: Ferramentas > Ações em massa > Scripts > "+" > Novo script. Colar, clicar em Autorizar e conceder acesso, rodar Visualizar uma vez e Salvar.
3. Na coluna Frequência, escolher "De hora em hora". Se a opção não aparecer, me avise: a doc oficial não confirma o agendamento por hora.
4. Repetir em cada conta. Quando o script mudar, colar de novo em todas.

---

## Gasto do Meta Ads

**Resumo.** Dá para puxar sozinho o gasto e as métricas do Meta usando o endpoint oficial de relatórios da Marketing API, o Ads Insights (GET /act_{id}/insights). Ele entrega por dia, por campanha, por conjunto e por anúncio: spend, impressions, clicks, cpm, ctr, actions, action_values e purchase_roas. Não precisa de App Review, porque as contas são do próprio Arthur. A autenticação é um token de system user do Business Manager, com permissão ads_read, que não expira e tem as contas de anúncio atribuídas como ativo.

A versão vigente é a v26.0 (Graph/Marketing, lançada em 29/07/2026). A v25.0 também está em vigor. Na Marketing API, a v24.0 expira em 06/10/2026 e a v21.0 já expirou em 09/09/2025. O meta-capi.ts do repo ainda usa v21.0 e hoje só funciona por causa do auto-upgrade.

O nível de acesso padrão de um app novo é o "Limited access" (antes chamado "Standard Access"). Para Insights, o teto é 600 + 400 × anúncios ativos, por conta e por hora. O sync do Arthur vai usar de 4 a 10 chamadas por hora por conta.

O Meta recalcula os Insights a cada 15 minutos, e os números não mudam mais depois de 28 dias. A estratégia, então:
- a cada 15 a 30 minutos, buscar hoje e ontem;
- uma vez por dia, reprocessar os últimos 28 dias, gravando por cima (upsert).

Duas armadilhas fortes:
1. **Contas zeradas sem erro:** as janelas 7d_view e 28d_view foram removidas em 12/01/2026. Pedir essas janelas volta vazio, sem erro.
2. **Gasto sumindo:** a consulta por anúncio (level=ad) não traz anúncio arquivado ou apagado. A verdade do gasto tem que vir do total da conta (level=account).

A lista das contas para a tela "vincular conta → loja" sai do próprio token (GET /me/adaccounts ou /{system-user-id}/assigned_ad_accounts), com moeda e fuso de cada conta.

**Recomendação.** FLUXO RECOMENDADO para o caso do Arthur (contas próprias, cerca de 10 lojas, sem vitrine):

1) CREDENCIAL. Um token de system user, só com ads_read, sem expiração, gerado num app do próprio Arthur, de tipo Business, com o caso de uso "Create & manage ads with Marketing API". Ligar esse token ao portfólio de negócios dono das contas. Atribuir cada conta de anúncio a esse system user com acesso parcial "Ver desempenho". Na API essa tarefa se chama ANALYZE, que é o papel "Report Only" (https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts).

Usar um token SEPARADO do token do CAPI, mesmo que seja o mesmo system user:
- o token de leitura de gasto não precisa poder escrever evento no pixel;
- revogar um não derruba o outro.

Gerar um token novo não revoga o antigo. A doc trata a revogação como ação explícita via oauth/revoke (https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens).

Dá para reaproveitar o system user do CAPI? Provavelmente sim, se ele pertencer a um app do próprio Arthur. Se o token do CAPI foi gerado pelo Events Manager ("Generate access token"), o Meta cria sozinho um "Conversions API app" e um "Conversions API system user" (https://developers.facebook.com/docs/marketing-api/conversions-api/get-started). Não confirmei se esse app criado pelo Meta aceita ads_read. Primeiro passo: colar o token atual no Access Token Debugger e ver de qual app e de qual usuário ele é.

Cuidado com o limite do nível Limited: só 1 system user e 1 system user admin por portfólio (https://developers.facebook.com/docs/business-management-apis/system-users/overview). Por isso, reaproveitar ou usar o admin costuma ser obrigatório.

2) DESCOBERTA DAS CONTAS. Numa tela "Contas de anúncio", o xcart lista as contas com GET /v25.0/me/adaccounts?fields=id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status,business{id,name}. O Arthur escolhe a loja de cada conta. A tabela de vínculo guarda a moeda e o fuso da conta.

3) SYNC (cron na Vercel, a cada 15 ou 30 min; o Pro permite 100 crons por projeto, em intervalo de minuto). Para cada conta ativa:
   a) GET /act_{id}/insights com level=account, time_increment=1, time_range de ontem até hoje (no fuso da conta). É o total fiel de gasto e inclui o que foi arquivado ou apagado.
   b) A mesma chamada com level=ad, para o detalhe por campanha, conjunto e anúncio.
   c) Uma vez por dia, de madrugada no fuso da conta, repetir (a) e (b) para os últimos 28 dias.
   Tudo gravado por cima (upsert) com chave (conta, nível, objeto, data).

Ler sempre os cabeçalhos x-business-use-case-usage e x-fb-ads-insights-throttle. Se passar de cerca de 75%, pular a conta naquela rodada. Se vier erro de limite (80000, 17, 4 ou 613), esperar o estimated_time_to_regain_access.

4) MÉTRICAS. Gravar spend, impressions, clicks, inline_link_clicks e as listas brutas actions, action_values e purchase_roas em jsonb.

Compras e valor: derivar de omni_purchase. Se não vier, usar offsite_conversion.fb_pixel_purchase. NUNCA somar entre tipos de ação. CPM e CTR do painel devem ser recalculados a partir das somas, e não tirados da média das linhas. Reach não se soma entre dias.

Para bater com o Ads Manager: não passar action_attribution_windows. Desde 10/06/2025 a API usa a configuração de atribuição de cada conjunto, segundo fonte de terceiros. Se quiser, pedir também 1d_click e 7d_click para comparar.

5) MOEDA E FUSO. Guardar o gasto na moeda original da conta (account_currency) e a data no fuso da conta. Converter para a moeda da loja com câmbio do dia, gravado junto. Para BRL, a PTAX do BCB serve.

Sempre que possível, o Arthur deveria deixar o fuso da conta igual ao da loja. Senão, o "dia" do gasto e o "dia" do pedido não batem.

6) VERSÃO. Fixar v25.0 (ou v26.0) numa constante compartilhada pelo CAPI e pelo Insights. A v21.0 de src/lib/tracking/meta-capi.ts já expirou na Marketing API.

7) FUTURO SaaS. Para ler contas de outras empresas são necessários: Advanced Access em ads_read com App Review, verificação da empresa, nível Full access e login dos clientes via Facebook Login for Business, no lugar de system user. Não é preciso agora.

Por que este caminho: é o único oficial, gratuito e automático. Não exige App Review para contas próprias. O token não expira. A cota do nível Limited sobra para o volume dele. E o modelo de segredo já existe no repo (tabela de segredos com RLS e nenhuma policy).

### Opções avaliadas

#### A) Marketing API Insights direto, com token de system user (RECOMENDADA)

- **Como funciona:** Um cron do xcart chama GET https://graph.facebook.com/v25.0/act_{id}/insights para cada conta vinculada, com level=account e level=ad, time_increment=1 e time_range. A resposta é paginada por cursor e gravada por cima numa tabela diária. Para volume grande existe o modo assíncrono: POST /act_{id}/insights devolve um report_run_id.
- **Requisitos:** App do Arthur no developers.facebook.com com o caso de uso de Marketing API, ligado ao portfólio de negócios. System user com as contas atribuídas como 'Ver desempenho' (ANALYZE). Token gerado com ads_read e validade 'Nunca'. Para contas próprias basta o acesso padrão a ads_read, sem App Review.
- **Limites:** ads_insights: 600 + 400 × anúncios ativos − 0,001 × erros, por conta e por hora, no nível Limited (190000 + ... no Full). Histórico de 37 meses para totais; 13 meses para métricas únicas e por hora; 6 meses para frequência. time_increment de 1 a 90 dias. Lote (batch) de até 50 chamadas, cada uma conta no limite. report_run_id vale 30 dias. Limited permite 1 system user e 1 admin por portfólio.
- **Prós:** Oficial e grátis. Token que não expira. Granularidade de dia, campanha, conjunto e anúncio. Traz compras e valor atribuídos pelo Meta (actions, action_values, purchase_roas). Cota do nível Limited folgada (600 + 400 × anúncios ativos, por hora e por conta). ads_read não gasta dinheiro: se vazar, expõe dados, não orçamento.
- **Contras:** Exige criar e cuidar do código de sync: paginação, limite de taxa, reprocessamento, moeda e fuso. Pegadinhas: level=ad omite o que foi arquivado ou apagado; janelas 7d_view e 28d_view voltam vazias; omni_purchase e os outros tipos de compra se sobrepõem. O nível Limited é descrito como 'for development only', mas a doc diz que contas próprias bastam com acesso padrão.
- **Fontes:** https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/ · https://developers.facebook.com/docs/marketing-api/insights/best-practices/ · https://developers.facebook.com/docs/marketing-api/overview/rate-limiting · https://developers.facebook.com/docs/marketing-api/get-started/authorization · https://developers.facebook.com/docs/marketing-api/access/ · https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens · https://developers.facebook.com/docs/business-management-apis/system-users/overview · https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/ · https://developers.facebook.com/docs/graph-api/batch-requests

#### B) Marketing API com token de usuário via Facebook Login for Business (OAuth)

- **Como funciona:** O lojista entra com o Facebook dentro do xcart, autoriza ads_read e o xcart guarda o token dele. As chamadas de Insights são as mesmas da opção A.
- **Requisitos:** Para contas de terceiros: acesso Advanced a ads_read, com App Review que pede exemplos e gravação de tela, verificação da empresa e, para cota de produção, nível Full access (500 chamadas em 15 dias com menos de 15% de erro, segundo o changelog de 04/05/2026).
- **Limites:** Os mesmos limites por conta da opção A. App Review obrigatório para acesso Advanced.
- **Prós:** É o caminho certo se o xcart virar serviço para outros lojistas. Cada cliente autoriza as próprias contas.
- **Contras:** Desnecessário para as contas do próprio Arthur. Exige App Review e verificação da empresa. Token de usuário tem validade e precisa de renovação. O system user da opção A é mais simples para uso interno.
- **Fontes:** https://developers.facebook.com/docs/permissions/reference/ads_read · https://developers.facebook.com/docs/marketing-api/get-started/authorization · https://developers.facebook.com/docs/marketing-api/marketing-api-changelog · https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases

#### C) Meta Ads MCP server / Ads CLI oficiais (Ads AI connectors)

- **Como funciona:** Servidor MCP hospedado pelo Meta em https://mcp.facebook.com/ads, para agentes de IA (Claude Desktop/Code e outros). Usa login do Facebook Business e tem ferramentas de relatório. O Ads CLI é a versão de terminal e usa token de system user.
- **Requisitos:** Conta do Facebook Business com acesso às contas. Para o CLI: token de system user com escopos como ads_management, business_management e read_insights.
- **Limites:** Limites e status de beta não estão descritos na página oficial (não verificado).
- **Prós:** Zero código para análise pontual e conversada ('quanto gastei ontem na Lash Bestie por campanha?'). Pode substituir o item 'Claude MCP' da proposta, pelo lado do Meta.
- **Contras:** Feito para agentes interativos, não para alimentar o banco do xcart de forma automática e confiável. Não serve como fonte do painel de lucro. A data de lançamento (29/04/2026, beta grátis) vem de fonte de terceiros.
- **Fontes:** https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview · https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/setup/get-started

#### D) Conectores de terceiros (ETL: Supermetrics, Windsor.ai, Airbyte etc.)

- **Como funciona:** Um serviço externo puxa a Marketing API e entrega numa planilha ou banco. O xcart leria de lá.
- **Requisitos:** Conta no serviço e autorização das contas Meta nele. Em geral pago; o Airbyte pode ser auto-hospedado.
- **Limites:** Dependem do fornecedor (não verificado).
- **Prós:** Não precisa escrever o sync.
- **Contras:** Custo mensal (preços não verificados). Mais um intermediário com acesso aos dados de anúncio. Atraso adicional. Continua dependendo da mesma API e das mesmas pegadinhas. Para cerca de 10 contas, o sync próprio da opção A é pequeno.
- **Fontes:** https://docs.supermetrics.com/docs/facebook-ads-reach-and-attribution-changes-june-10-2025

### Detalhes técnicos

=== 1. VERSÃO DA API (hoje, 02/10/2026) ===

- A Graph API mais recente é a v26.0, de 29/07/2026. A v25.0, de 18/02/2026, vale até 29/07/2028 na Graph (https://developers.facebook.com/docs/graph-api/changelog/versions).
- A Marketing API v26.0 também saiu em 29/07/2026 (https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/). As mudanças da v26 citadas não tocam o Insights.
- A tabela da Marketing API mostra:
  - v24.0 expira em 06/10/2026;
  - v23.0 expirou em 09/06/2026;
  - v22.0 expirou em 19/02/2026;
  - v21.0 expirou em 09/09/2025.
- Desde maio/2024, uma chamada a versão expirada é promovida para a próxima versão disponível, se o endpoint não foi afetado (https://developers.facebook.com/docs/marketing-api/overview/versioning).
- Achado colateral: src/lib/tracking/meta-capi.ts:12 usa const VERSAO = "v21.0". Funciona por auto-upgrade, mas deveria virar v25.0 ou v26.0, numa constante única para o CAPI e o Insights.

=== 2. ENDPOINT DE INSIGHTS ===

GET /{versão}/act_{AD_ACCOUNT_ID}/insights. Também existe em /{campaign-id}/insights, /{adset-id}/insights e /{ad-id}/insights. Exige ads_read (https://developers.facebook.com/docs/marketing-api/insights).

Parâmetros (https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/):

- **level**: ad, adset, campaign ou account.
- **time_increment**: inteiro de 1 a 90, ou monthly, ou all_days (padrão all_days). Ignorado se vier time_ranges.
- **time_range**: {"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}.
- **date_preset**: today, yesterday, last_3d, last_7d, last_14d, last_28d, last_30d, last_90d, this_month, maximum e outros (padrão last_30d). Ignorado se vier time_range.
  - A doc de boas práticas diz que o date_preset é mais eficiente que intervalo customizado (https://developers.facebook.com/docs/marketing-api/insights/best-practices/).
- **action_attribution_windows**: 1d_view, 7d_view, 28d_view, 1d_click, 7d_click, 28d_click, 1d_ev, dda, default e outros. O "default" equivale a ["7d_click","1d_view"].
- **use_account_attribution_setting** (padrão false) e **use_unified_attribution_setting** (usa a configuração do conjunto e ignora a da conta).
- **action_report_time**: impression, conversion, mixed ou lifetime.
- **filtering**: lista de {field, operator, value}.
- **breakdowns** e **action_breakdowns**: action_breakdowns exige pedir o campo actions junto.
- **limit** e **sort**.
- Limite: "The start date of the time range cannot be beyond 37 months from the current date".

ATENÇÃO, janelas removidas:
- Desde 12/01/2026 as janelas 7d_view e 28d_view "will no longer be returned".
- Métricas únicas (unique_*) e breakdowns por hora: 13 meses de histórico. Frequência (frequency_value): 6 meses. MMM: só assíncrono. Totais seguem com 37 meses (https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/).
- Segundo terceiros, pedir janela removida devolve dado vazio, sem erro (https://docs.supermetrics.com/docs/facebook-ads-new-historical-limitations-attribution-window-and-metric-removals-january-12-2026). Não verificado em texto do Meta.

Atribuição unificada:
- Desde 10/06/2025, use_unified_attribution_setting e action_report_time seriam desconsiderados. A API imitaria o Ads Manager: configuração do conjunto, e reporte "mixed", com compra fora do Meta contada na data da conversão.
- Fonte só de terceiros (https://docs.supermetrics.com/docs/facebook-ads-reach-and-attribution-changes-june-10-2025). Não achei o texto na doc oficial; marcar como não verificado.

Campos úteis (https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign-group/insights):
- account_id, account_currency ("Currency that is used by your ad account").
- campaign_id/name, adset_id/name, ad_id/name, date_start, date_stop.
- spend: "estimated total amount of money you've spent...". É estimado.
- impressions, clicks (todos os cliques), inline_link_clicks (janela fixa de 1 dia após clique), outbound_clicks, cpc, cpm, ctr, cost_per_inline_link_click.
- reach e frequency: estimados.
- actions, action_values, cost_per_action_type, conversions, conversion_values.
- purchase_roas: compras de qualquer Business Tool. website_purchase_roas: só do pixel.
- attribution_setting, objective, optimization_goal.
- Sem fields, a API devolve impressions e spend.

Tipos de ação de compra (https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/):
- omni_purchase = "Purchases";
- offsite_conversion.fb_pixel_purchase = "Purchases";
- onsite_conversion.purchase = "On-Facebook Purchases".
- Cada item de actions e action_values traz action_type, value e uma chave por janela pedida (1d_click, 7d_click, 1d_view...).
- Não verificado em doc oficial: que omni_purchase equivale à coluna "Compras" do Ads Manager e que os tipos se sobrepõem. É o consenso de conectores de terceiros. Regra: escolher UM tipo (omni_purchase e, se faltar, offsite_conversion.fb_pixel_purchase) e nunca somar tipos.
- Não verificado: action_values viriam convertidos para a moeda da conta, mesmo que o pixel mande EUR.

Exemplo de detalhe diário por anúncio:

GET https://graph.facebook.com/v25.0/act_123/insights?level=ad&time_increment=1&time_range={"since":"2026-09-05","until":"2026-10-02"}&fields=account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values,purchase_roas,attribution_setting&limit=500

Total da conta, a verdade do gasto: a mesma chamada com level=account e fields=account_currency,date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values,purchase_roas.

Arquivado e apagado (https://developers.facebook.com/docs/marketing-api/best-practices/manage-your-ad-object-status):
- Os stats do objeto pai incluem todos os filhos "no matter if the child is active, archived, or deleted".
- Mas a lista de /{pai}/insights?level=... traz só objetos ativos ("live").
- Para trazer os outros: filtering=[{"field":"ad.effective_status","operator":"IN","value":["ARCHIVED","DELETED"]}].
- Conclusão: gravar sempre o total level=account e tratar a diferença como "anúncios removidos".

Paginação (https://developers.facebook.com/docs/graph-api/results): seguir paging.next até ele sumir. Não guardar cursores.

Assíncrono (https://developers.facebook.com/docs/marketing-api/insights/best-practices/):
1. POST /act_{id}/insights com os mesmos parâmetros devolve o id de um Ad Report Run.
2. Consultar GET /{report_run_id} até async_status = "Job Completed" e async_percent_completion = 100.
3. Buscar GET /{report_run_id}/insights.
- O id expira em 30 dias.
- O erro 100, subcódigo 1487534, significa "muito dado por chamada": quebrar por intervalo de datas ou ir para o assíncrono. Para o volume do Arthur, a chamada síncrona deve bastar.

Atualização dos dados (mesma fonte): "Insights refresh every 15 minutes and do not change after 28 days". As métricas podem continuar mudando por alguns dias depois que o anúncio termina. Além disso, o CAPI aceita event_time de até 7 dias atrás (https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event), então uma compra pode chegar dias depois.

Plano de polling:
- a cada 15 ou 30 min: hoje e ontem;
- uma vez por dia: últimos 28 dias, gravando por cima.

Custo por conta: cerca de 2 a 4 chamadas por rodada, ou 8 a 16 por hora no pior caso. A cota Limited é de 600 + 400 × anúncios ativos por hora.

=== 3. LIMITES DE TAXA ===

Fontes: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting e https://developers.facebook.com/docs/graph-api/overview/rate-limiting/

- Desde 04/05/2026 os níveis se chamam "Limited access" (antes Standard) e "Full access" (antes Advanced) (https://developers.facebook.com/docs/marketing-api/marketing-api-changelog).
- ads_insights, por conta, numa janela de 1 hora: (190000 no Full ou 600 no Dev/Limited) + 400 × anúncios ativos − 0,001 × erros do usuário.
- ads_management no Limited: pontuação máxima 60, com decaimento de 300 s.
- Cabeçalhos a ler:
  - X-Business-Use-Case-Usage: {"<conta>":[{type, call_count, total_cputime, total_time, estimated_time_to_regain_access, ads_api_access_tier}]}, em percentuais.
  - X-FB-Ads-Insights-Throttle: {app_id_util_pct, acc_id_util_pct, ads_api_access_tier}.
- Erros de limite:
  - 80000 (subcódigo 2446079): ads_insights estourado;
  - 17 (subcódigo 2446079);
  - 4 (subcódigo 1504022): limite de plataforma do Insights;
  - 613 (subcódigo 5044001).
  - O erro 190 (token) e o 200 (permissão) são permanentes. É a mesma classificação que já existe em meta-capi.ts.
- Batch: até 50 chamadas por lote, e cada uma conta no limite (https://developers.facebook.com/docs/graph-api/batch-requests).
- Para subir ao Full access: pelo menos 500 chamadas em 15 dias, com erro abaixo de 15% nas últimas 500. O próprio sync atinge isso (https://developers.facebook.com/docs/marketing-api/access/).

=== 4. PERMISSÕES, APP E SYSTEM USER ===

Permissões:
- "If your app is only managing your ad account, standard access to the ads_read and ads_management permissions are sufficient". Para contas de terceiros é preciso acesso Advanced (https://developers.facebook.com/docs/marketing-api/get-started/authorization).
- ads_read serve para "pull Ads report information"; o App Review só entra para acesso em nome de outras empresas (https://developers.facebook.com/docs/permissions/reference/ads_read).
- Limited access é "Automatically granted when you add the Marketing API product to your app".

Criação do app: no caso de uso "Create & manage ads with Marketing API", ads_read, ads_management e business_management vêm como permissões do caso de uso (https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases).

Contradição na doc:
- A página de system users diz que o app "precisará passar pelo processo de análise (e pela verificação da empresa) para obter as permissões necessárias aos usuários do sistema" (https://developers.facebook.com/docs/business-management-apis/system-users/overview).
- A página de autorização diz que contas próprias bastam com acesso padrão.
- Na prática, o Arthur já gera token de system user hoje. Testar ads_read antes de assumir que vai precisar de App Review.

System user:
- O app precisa pertencer ao mesmo portfólio.
- Limite: no nível padrão, 1 system user e 1 system user admin; no avançado, 10 e 1.
- O admin enxerga todos os ativos do portfólio. O comum (employee) só os ativos atribuídos (https://www.facebook.com/business/help/503306463479099, lido via resumo de busca porque a página não renderiza).

Token (https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens):
- "Nunca expira" ou "Válido por 60 dias".
- Pela API: POST /{system-user-id}/access_tokens com business_app, appsecret_proof, scope e set_token_expires_in_60_days.
- Revogação explícita via oauth/revoke.
- A doc oficial de Autenticação confirma que o token de system user não expira (https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authentication.md).

Atribuir a conta ao system user pela API: POST /act_{id}/assigned_users com user=<id do system user> e tasks=['ANALYZE']. ANALYZE é "Report Only"; ADVERTISE+ANALYZE é "General User"; MANAGE+ADVERTISE+ANALYZE é "Administrator" (https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts).

O guia oficial do Ads CLI manda também adicionar o system user como App Admin em App Settings > Roles (https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/setup/get-started). Não confirmei se isso é obrigatório só para ads_read.

appsecret_proof = HMAC-SHA256(token, app_secret). É obrigatório se o app tiver "Require App Secret" ligado (https://developers.facebook.com/docs/graph-api/securing-requests). Recomendado em chamadas de servidor, mas aí o xcart também precisa guardar o app secret.

Token do CAPI de hoje:
- Se foi gerado pelo Events Manager, "automatically creates a Conversions API app and Conversions API system user" (https://developers.facebook.com/docs/marketing-api/conversions-api/get-started).
- Não verificado: se esse app criado pelo Meta aceita ads_read, e se esse system user conta no limite de 1 + 1.
- "read_ads_dataset_quality": não achei a referência oficial dessa permissão. A Dataset Quality API pede ads_read e ads_management ou business_management, segundo resumo de busca da doc https://developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api. Não verificado diretamente.

=== 5. DESCOBRIR AS CONTAS QUE O TOKEN ENXERGA ===

- GET /v25.0/me/adaccounts?fields=id,account_id,name,currency,timezone_name,timezone_offset_hours_utc,account_status,business{id,name}&limit=100. É o uso comum com token de system user, mas a referência atual de User não lista mais a aresta adaccounts: NÃO VERIFICADO na doc atual. Testar primeiro no Graph API Explorer.
- Alternativa documentada: GET /{system-user-id}/assigned_ad_accounts, que devolve AdAccount mais tasks e permitted_tasks (https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user/assigned_ad_accounts). O id sai de GET /me?fields=id.
- Por portfólio: GET /{business-id}/owned_ad_accounts (https://developers.facebook.com/docs/business-management-apis/business-asset-management/guides/ad-accounts). Provavelmente exige business_management (não verificado).
- Campos da AdAccount (https://developers.facebook.com/docs/marketing-api/reference/ad-account/):
  - currency;
  - timezone_id, timezone_name, timezone_offset_hours_utc;
  - account_status: 1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW, 8 PENDING_SETTLEMENT, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED;
  - disable_reason, amount_spent, spend_cap.
  - attribution_spec está descontinuado.
- Contas em outro portfólio: compartilhar com o portfólio do app como parceiro (https://www.facebook.com/business/help/1717412048538897) e depois atribuir ao system user.

=== 6. MOEDA E FUSO ===

- Moeda: o Insights traz account_currency. USD, EUR e BRL têm offset 100 (https://developers.facebook.com/docs/marketing-api/currencies). Isso afeta orçamento e lance, não o spend do Insights, que vem em decimal (formato string decimal não verificado).
- Não verificado: amount_spent da conta viria em centavos.
- Fuso: o dia de date_start segue o fuso da conta de anúncio. O breakdown por hora fala em "advertiser's time zone" (https://developers.facebook.com/docs/marketing-api/insights/breakdowns/). Não achei frase oficial explícita para o diário: não verificado, mas é o comportamento conhecido.
- Lash Bestie (loja em USD, cliente pagando em EUR): comparar o gasto, na moeda da conta, com a receita em shop_money da Shopify. Se a conta for BRL, converter pela PTAX do BCB (https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao, recurso CotacaoMoedaDia). Guardar o valor original, a taxa e a data da taxa.
- Não verificado: o spend do Insights não inclui impostos que o Meta cobra na fatura. Conferir na fatura antes de chamar de "lucro real".

=== 7. ESBOÇO DE MODELO (não implementado; somente leitura) ===

- **ad_accounts**: id, user_id, plataforma 'meta', conta 'act_…', nome, moeda, fuso, account_status, store_id (o vínculo), credencial_id, ativo, last_synced_at, last_error. RLS por user_id, com WITH CHECK (ver migration 030).
- **ad_credential_secrets**: token. RLS ligado e zero policy, como tracking_destination_secrets na 043.
- **ad_insights_daily**: chave única (ad_account_id, nivel, objeto_id, data). Colunas: spend, impressions, clicks, inline_link_clicks, compras, valor_compras, moeda, actions e action_values em jsonb, attribution_setting, fetched_at.
- **Cron**: /api/jobs/ads/meta-sync, autenticado por CRON_SECRET como /api/jobs/tracking/drain. As URLs são fixas em graph.facebook.com, mas manter safeFetch por consistência.
- **Cron na Vercel**: o Pro aceita 100 crons por projeto, com intervalo mínimo de 1 minuto (https://vercel.com/docs/cron-jobs/usage-and-pricing).

### Riscos

- **Doc contraditória sobre App Review para system user.** A página de system users diz que o app precisa de análise e verificação; a de autorização diz que contas próprias bastam com acesso padrão. Mitigação: testar com o app do Arthur antes de construir. Se o token com ads_read ler o Insights, está resolvido.
- **Token do CAPI talvez seja do "Conversions API app" criado pelo Meta.** Aí pode não dar para gerar ads_read nele, e o limite de 1 system user + 1 admin no nível Limited pode estar ocupado. Talvez seja preciso usar o system user admin ou um app próprio novo.
- **Contas de anúncio em portfólios diferentes**, comum para isolar bloqueio. Cada portfólio precisa compartilhar a conta como parceiro, ou ter system user e token próprios. Se um portfólio for restringido, o token perde o acesso, e o sync tem que marcar a conta com erro, sem zerar o gasto.
- **Gasto subestimado se somar só level=ad.** Anúncio arquivado ou apagado não aparece na lista. Usar level=account como total.
- **Janelas 7d_view e 28d_view removidas em 12/01/2026** voltam vazias, sem erro (segundo terceiros). Não pedir essas janelas.
- **Compras contadas em dobro** ao somar omni_purchase com offsite_conversion.fb_pixel_purchase ou purchase. A sobreposição não está documentada oficialmente; escolher um tipo só.
- **Números do Meta mudam por até 28 dias** (segundo o Meta). Sem reprocessar, o ROAS de dias recentes fica errado. O spend é "estimated".
- **Fuso da conta diferente do fuso da loja:** o "dia" do gasto não bate com o "dia" do pedido.
- **Moeda da conta diferente da loja:** sem câmbio do dia gravado, o lucro fica errado. Impostos da fatura do Meta podem não estar no spend (não verificado).
- **Nível Limited descrito como "for development only".** A cota é folgada para o Arthur, mas se o Meta apertar, é preciso pedir Full access (500 chamadas em 15 dias, erro abaixo de 15%).
- **Versão:** a v24.0 da Marketing API expira em 06/10/2026, e o repo usa v21.0 (expirada, rodando por auto-upgrade). Se o endpoint for "afetado" numa versão, a chamada falha em vez de subir.
- **Vazamento de token.** ads_read não gasta orçamento, mas expõe todo o desempenho e o faturamento atribuído. Guardar em tabela de segredo sem policy. Nunca na querystring de logs; o repo já põe o token no corpo do POST do CAPI. Num GET, avaliar mandar o token por cabeçalho (suporte a Authorization: Bearer na Graph não verificado) ou aceitar o token na querystring só no servidor.
- **/me/adaccounts com token de system user** não está na referência atual (não verificado). Ter o fallback /{system-user-id}/assigned_ad_accounts.
- **Viés da comparação xcart × Meta:** a atribuição unificada (configuração do conjunto, reporte "mixed") foi imposta desde 10/06/2025 (fonte de terceiros). O "Compras" do Meta não vai bater com os pedidos da Shopify, e isso é esperado.

### O que só o Arthur pode fazer

Passo a passo do que só o Arthur pode fazer. Nenhum token deve ser colado no chat: vai direto na tela do xcart, quando ela existir.

1) Descobrir de onde vem o token atual do CAPI. Abrir https://developers.facebook.com/tools/debug/accesstoken/, colar o token e anotar quatro coisas:
- o App ID e o nome do app;
- o usuário (o system user e o nome dele);
- os escopos;
- a validade.
Se o app se chamar algo como "Conversions API ..." (criado pelo Events Manager), seguir o passo 2. Se for um app dele, pular para o 3.

2) Se precisar, criar um app próprio:
- em developers.facebook.com > Meus apps > Criar app, escolher o caso de uso "Create & manage ads with Marketing API";
- ligar ao portfólio de negócios dono das contas de anúncio;
- pode ficar em modo de desenvolvimento.

3) Em Meta Business Suite > Configurações > Usuários > Usuários do sistema, escolher o system user existente. O nível Limited só permite 1 comum e 1 admin por portfólio; se não houver vaga, usar o admin.

4) Ainda no system user, em "Atribuir ativos" > Contas de anúncio, marcar cada conta das lojas com acesso parcial "Ver desempenho". Esse é o mínimo; não precisa de controle total.
- Se alguma conta estiver em OUTRO portfólio: no portfólio dono, compartilhar a conta como parceiro com o portfólio do app (https://www.facebook.com/business/help/1717412048538897). Depois atribuir ao system user.

5) Se o painel pedir, em developers.facebook.com > app > Configurações do app > Funções, adicionar o system user como administrador do app. O guia oficial do Ads CLI manda; não confirmei se é obrigatório.

6) De volta ao system user, clicar em "Gerar novo token" e:
- escolher o app;
- validade "Nunca";
- marcar SÓ ads_read.
Copiar uma vez só. Esse token novo não substitui o do CAPI: o do CAPI continua funcionando e fica onde está.

7) Testar antes de construir qualquer coisa. No Graph API Explorer (https://developers.facebook.com/tools/explorer/), com esse token, rodar:
- GET me/adaccounts?fields=id,name,currency,timezone_name,account_status → devem aparecer as contas atribuídas;
- GET act_<ID>/insights?date_preset=yesterday&fields=spend,impressions,clicks,actions,action_values → deve vir o gasto de ontem.
Se der erro de permissão (200 ou 10), avisar: aí entra a questão do App Review.

8) Me passar, sem token:
- a lista "conta de anúncio → loja" (Lash Bestie qkgknv-w3, Softnook kphigm-76 e as outras);
- a moeda e o fuso que o Graph API Explorer mostrou para cada conta.
Se possível, deixar o fuso de cada conta igual ao da loja.

9) Depois que a tela existir, colar o token nela. Ele fica numa tabela de segredo sem acesso pelo navegador.

10) Só se um dia vender como serviço: fazer o App Review de ads_read (Advanced), a verificação da empresa e o pedido de Full access. Os clientes entrariam por login do Facebook, não por system user.

---

## Receita, reembolso, taxas e custo na Shopify

**Resumo.** Dá para tirar quase tudo da própria Shopify, só com o read_orders que o app já tem. Isso cobre receita bruta e líquida, desconto, frete cobrado, imposto, reembolsos com data, cancelamento, gateway e status de disputa. Cobre também as taxas reais por transação, mas só se a loja usa Shopify Payments: o campo OrderTransaction.fees pede só read_orders.

O custo do produto ("Cost per item" = InventoryItem.unitCost) já é legível hoje. read_products basta, e write_inventory implica leitura. Só que a Shopify NÃO expõe esse custo congelado na linha do pedido: LineItem não tem campo de custo. O único lugar onde ela entrega o COGS "na hora da venda" é o ShopifyQL (shopifyqlQuery, escopo read_reports, sem aprovação), e lá ele vem agregado.

O que a Shopify não tem, temos que estimar ou pedir ao Arthur:
- frete do fornecedor;
- taxa de gateway de terceiro;
- taxa da Shopify por usar gateway de terceiro;
- chargeback fora do Shopify Payments;
- custos fixos.

Situação no repo:
- escopos em src/lib/shopify/scopes.ts: read_orders sim, read_all_orders não, read_inventory não explícito (mas write_inventory implica), read_reports e read_shopify_payments_* não;
- só o webhook orders/create é inscrito, e é tratado apenas para rastreamento: se o rastreamento da loja estiver desligado, o pedido é ignorado;
- não existe tabela de pedidos no banco, por decisão registrada em src/lib/sales/queries.ts.

Achei 4 problemas que afetam qualquer número financeiro:
1. O app declara a versão 2024-10, que já está fora do ar. A Shopify serve a 2025-10 hoje e a 2026-01 a partir de 16/10/2026.
2. getOrdersSummary filtra financial_status:paid, então pedido com reembolso parcial (status partially_refunded) some inteiro do faturamento.
3. O câmbio está fixo em USD=5,40. A PTAX de 01/10/2026 foi 5,2079.
4. A tela de Vendas só enxerga lojas que são destino de rota. A operação do Arthur não tem vitrine.

**Recomendação.** Recomendação para o caso do Arthur (2 lojas ativas, tráfego direto, Lash Bestie em USD com cliente pagando em EUR):

1) Núcleo: guardar uma "foto financeira" própria de cada pedido, sem dado pessoal. Isso é sair conscientemente da decisão "o xcart não guarda pedido", e há três motivos:
- a Shopify só deixa ler 60 dias de pedidos com read_orders;
- o custo precisa ficar congelado no dia da venda;
- o lucro por dia precisa cruzar com o gasto de anúncio.

O risco de "segunda verdade que envelhece" se resolve assim:
- os webhooks ORDERS_CREATE, ORDERS_UPDATED, REFUNDS_CREATE e ORDERS_CANCELLED só marcam "o pedido X mudou";
- um cron a cada 10 minutos relê esses pedidos e também tudo com updated_at maior que o último cursor, via GraphQL. É exatamente a "reconciliation job" que a própria Shopify recomenda.

O tratamento financeiro tem que ficar desacoplado do interruptor de rastreamento. Hoje o orders/create sai cedo quando o rastreamento está desligado.

2) Receita: usar sempre o shopMoney (moeda da loja, USD na Lash Bestie) como valor oficial, e guardar o presentmentMoney (EUR) só como informação. A fórmula:
- receita líquida = netPaymentSet (recebido menos reembolsado) − currentTotalTaxSet − currentTotalDutiesSet − gorjeta;
- faturamento bruto para exibir = totalPriceSet.
O dia do pedido é contado pelo processedAt, no fuso da loja (Shop.ianaTimezone).

3) Reembolso: tabela própria, com a data do reembolso. A tela mostra por padrão a "visão por data do pedido", que é a que bate com ROAS e campanha. A "visão caixa" (por data do reembolso) fica disponível ao lado.

4) Custo do produto (COGS): tabela própria por SKU com vigência, com custo do produto e frete do fornecedor por unidade, moeda e país de destino opcional. O custo é copiado para a linha do pedido no momento da ingestão e não muda mais. Se faltar custo na tabela, usa o "Cost per item" da Shopify (unitCost) lido na hora. Se não houver nenhum dos dois, a linha fica marcada como "sem custo" e o lucro mostra o aviso.
- A importação em massa é um CSV no próprio xcart, com modelo já preenchido com os SKUs da loja.
- Opcionalmente, o xcart espelha o custo na Shopify via inventoryItemUpdate (o app já tem write_inventory).
- NUNCA usar o CSV de produtos da Shopify com "sobrescrever": sem as colunas de opção ele apaga as variantes, o que derruba SKU, rota e rastreamento.

5) Taxas:
- Primeiro, descobrir se cada loja usa Shopify Payments. O Brasil não está na lista de países suportados; depende do país de cadastro da loja.
- Se usa: taxa real via OrderTransaction.fees, sem escopo novo. Opcionalmente, saldo detalhado e disputas com read_shopify_payments_payouts e read_shopify_payments_disputes, que não exigem aprovação.
- Se não usa: regra configurável por gateway (percentual + fixo), mais a taxa da Shopify por gateway de terceiro, que varia com o plano.

6) Câmbio: tabela diária no banco (fx_rates). Fontes:
- PTAX do Banco Central para qualquer par com BRL: oficial, grátis, sem chave; testei hoje e funciona;
- Frankfurter/BCE para os outros pares;
- fim de semana e feriado usam o último dia útil.
Cada dia é convertido pelo câmbio daquele dia. A moeda do relatório é escolhida pelo usuário (sugestão: BRL). Se a conta de anúncio cobra em USD num cartão brasileiro, entra um acréscimo configurável de IOF/spread.

7) ShopifyQL (read_reports) não entra como base, entra como conferência: um "Shopify diz X, xcart diz Y" por dia, já com o COGS congelado pela própria Shopify.

8) read_all_orders: não precisa agora. As lojas são novas, e a partir do primeiro sync a foto fica guardada para sempre. Antes de pedir, vale um teste de 1 minuto para ver se o app já enxerga além de 60 dias. Um funcionário da Shopify disse que app criado pelo próprio lojista pode não ter o limite, mas isso não está confirmado para apps do Dev Dashboard.

9) Antes de construir:
- fixar uma versão atual da API (2026-07 ou 2026-10) e testar;
- trocar financial_status:paid por um filtro que não exclua reembolso parcial;
- aposentar o câmbio fixo.

Estimativa de esforço (minha, não verificada):
- núcleo de foto + webhooks + reconciliação: 3 a 5 dias;
- custo com CSV: 1 a 2 dias;
- câmbio: meio dia;
- taxas do Shopify Payments: meio dia;
- conferência por ShopifyQL: meio a 1 dia.

### Opções avaliadas

#### A. Foto própria por pedido via Admin GraphQL (orders + webhooks + reconciliação) -- RECOMENDADA como núcleo

- **Como funciona:** - Os webhooks ORDERS_CREATE (já existe), ORDERS_UPDATED, REFUNDS_CREATE e ORDERS_CANCELLED gravam uma linha 'pedido sujo'. Resposta rápida: o limite é 5 s.
- Um cron a cada 10 minutos (o Vercel Pro permite até 1 por minuto) busca cada pedido sujo com order(id) e também roda orders(query:"updated_at:>='cursor'") como rede de segurança.
- O resultado é gravado (upsert) em fin_orders, fin_order_lines e fin_refunds.
- Carga inicial: uma bulk operation com os últimos 60 dias.
- A query não pede customer/email/endereço, então não entra dado pessoal.
- **Requisitos:** read_orders, que já existe. Inscrever 3 tópicos novos com webhookSubscriptionCreate; eles exigem read_orders. Migration nova com RLS e WITH CHECK, conforme o CLAUDE.md.
- **Limites:** - read_orders cobre pedidos criados nos últimos 60 dias. Reembolso ou chargeback que chega num pedido mais velho que isso pode não ser relido pelo GraphQL. Não verificado se o webhook continua chegando nesse caso.
- Custo GraphQL de no máximo 1000 pontos por query, 250 itens por conexão, paginação limitada a 25.000 objetos.
- **Prós:** - Valores exatos da Shopify: bruto, desconto, frete cobrado, imposto, taxas alfandegárias, gorjeta, recebido, reembolsado e netPayment, em shopMoney e presentmentMoney.
- Gateway, status de disputa (Order.disputes, com read_orders), sourceName (identifica draft de reenvio) e SKU por linha.
- A foto vive além dos 60 dias.
- Permite congelar o custo na linha.
- **Contras:** - Duplica dado que mora na Shopify, e precisa de reconciliação.
- Mais código: migration, webhook, cron e tela.
- A Shopify remove a inscrição de webhook depois de 8 falhas em 4 h, então o cron precisa reinscrever.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/objects/Order · https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem · https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund · https://shopify.dev/docs/api/admin-graphql/latest/queries/orders · https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic · https://shopify.dev/docs/apps/build/webhooks/best-practices · https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks · https://shopify.dev/docs/api/usage/access-scopes · https://shopify.dev/docs/api/usage/limits · https://vercel.com/docs/cron-jobs/usage-and-pricing

#### B. Livro-razão de vendas da Shopify (Order.agreements / Sale)

- **Como funciona:** Cada pedido, edição e reembolso vira um SalesAgreement com happenedAt. Dentro dele, cada Sale traz actionType (ORDER/RETURN/UPDATE), lineType (produto, frete, gorjeta, taxa alfandegária...), quantity, totalAmount, totalTaxAmount e descontos, com ProductSale.lineItem apontando para o SKU. É o mesmo tipo de lançamento que a Shopify usa no Analytics.
- **Requisitos:** read_orders (já existe).
- **Limites:** Mesmo limite de 60 dias. Recomendo como evolução de A só se a visão caixa por SKU virar requisito.
- **Prós:** Venda líquida por dia e por SKU, com reembolso lançado na data em que aconteceu. Fica igual ao relatório da Shopify sem reimplementar a regra de alocação de desconto.
- **Contras:** Mais complexo de modelar (uma linha por lançamento). Bulk operation permite no máximo 5 conexões e 2 níveis, e agreements e sales são conexões aninhadas.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/interfaces/SalesAgreement · https://shopify.dev/docs/api/admin-graphql/latest/interfaces/Sale · https://shopify.dev/docs/api/usage/bulk-operations/queries

#### C. ShopifyQL (shopifyqlQuery) -- conferência e atalho de MVP

- **Como funciona:** Uma query no estilo SQL sobre o armazém de dados de análise da Shopify, por exemplo: FROM sales SHOW gross_sales, discounts, returns, net_sales, shipping_charges, taxes, cost_of_goods_sold, gross_profit GROUP BY day, product_variant_sku SINCE -30d. Valores na moeda da loja e no fuso da loja.
- **Requisitos:** Escopo read_reports (sem aprovação) e dado protegido de cliente nível 2. Pela tabela da Shopify, app custom tem os dois níveis sempre disponíveis. Disponível desde a API 2025-10.
- **Limites:** A documentação não informa limite de linhas nem de período (não verificado).
- **Prós:** - COGS 'registrado no momento da venda' calculado pela Shopify: ela documenta que o lucro só sai para variante que tinha custo na hora da venda.
- Bate com o relatório que o Arthur vê no admin.
- Pouco código.
- **Contras:** - Dado agregado, sem taxa de gateway.
- COGS só existe se o 'Cost per item' estiver preenchido na Shopify antes da venda.
- Não verificado: atraso dos dados, restrição por plano e se o limite de 60 dias se aplica.
- Exige novo escopo, então nova versão do app.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery · https://shopify.dev/changelog/shopifyqlquery-now-available-in-graphql-admin-api · https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales.md · https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api/build-a-sales-dashboard.md · https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/profit-reports · https://shopify.dev/docs/apps/launch/protected-customer-data

#### D. Taxas reais do Shopify Payments (fees por transação, saldo, disputas)

- **Como funciona:** - Por pedido: Order.transactions[].fees (TransactionFee: amount, rate, flatFee, taxAmount, type). Esse campo só vem preenchido em Shopify Payments.
- Visão de saque: shopifyPaymentsAccount.balanceTransactions (amount, fee, net, type, associatedOrder, associatedPayout).
- Chargeback: query disputes / ShopifyPaymentsDispute (valor, status, motivo, prazo de evidência) e os webhooks DISPUTES_CREATE e DISPUTES_UPDATE.
- **Requisitos:** - fees: read_orders (já existe).
- Saldo e saques: read_shopify_payments_payouts (sem aprovação) ou read_shopify_payments_accounts.
- Disputas: read_shopify_payments_disputes (sem aprovação).
- A loja precisa usar Shopify Payments, que não está disponível no Brasil; depende do país de cadastro da loja.
- **Limites:** A documentação não diz o que shopifyPaymentsAccount devolve em loja sem Shopify Payments (não verificado: testar).
- **Prós:** Taxa real em vez de estimada, incluindo a taxa de conversão de moeda (o cliente EUR na loja USD paga 1,5% de conversão em loja dos EUA e 2% nas outras regiões, segundo a ajuda da Shopify). Chargeback com valor e status.
- **Contras:** Inútil se a loja usa gateway de terceiro. Os campos de shopifyPaymentsSet são só para Plus.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction · https://shopify.dev/docs/api/admin-graphql/latest/objects/TransactionFee · https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction · https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsAccount · https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsDispute · https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderDisputeSummary · https://shopify.dev/docs/api/usage/access-scopes · https://help.shopify.com/en/manual/payments/shopify-payments/supported-countries · https://help.shopify.com/en/manual/payments/shopify-payments/store-currency/currency-conversion-calculation

#### E. Taxa estimada por gateway de terceiro (configuração)

- **Como funciona:** - Tabela gateway_fee_rules (loja, nome do gateway, percentual, fixo, moeda do fixo, valid_from), casando com OrderTransaction.gateway/formattedGateway ou Order.paymentGatewayNames.
- Por cima, a taxa da Shopify por usar gateway de terceiro, que depende do plano. A página de preços da Shopify só diz 'The rate depends on your plan'; os valores 2% Basic, 1% Grow e 0,6% Advanced vêm de fonte secundária e não estão verificados na Shopify.
- **Requisitos:** Nenhum escopo novo. O Arthur informa as taxas do contrato de cada gateway e o plano da loja.
- **Limites:** A cobrança da Shopify (fatura com a taxa de terceiro) não tem API conhecida no Admin (não verificado).
- **Prós:** Funciona com qualquer gateway, e é simples.
- **Contras:** É estimativa. Reembolso devolve ou não a taxa conforme o gateway (não verificado: deixar configurável). Chargeback de gateway de terceiro não aparece na Shopify; precisa de lançamento manual ou da API do gateway.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction · https://www.shopify.com/pricing

#### F. Custo do produto: tabela própria com vigência + CSV no xcart (+ espelho opcional no 'Cost per item')

- **Como funciona:** - product_costs(loja, sku, custo do produto, frete por unidade, moeda, país opcional, valid_from, origem).
- Na ingestão do pedido, procura o maior valid_from que seja menor ou igual ao processedAt e grava o valor na fin_order_lines.
- Se não houver custo, usa variant.inventoryItem.unitCost.
- Importação: CSV no xcart com modelo pré-preenchido com todos os SKUs da loja, vindos de productVariants. Validação do SKU contra a loja.
- Opcional: inventoryItemUpdate(input:{cost}) para a Shopify também mostrar lucro.
- **Requisitos:** - Ler unitCost: read_inventory ou read_products. O app tem read_products, e write_inventory já inclui leitura, porque escopo de escrita concede leitura.
- Escrever: write_inventory (já existe).
- **Limites:** - unitCost está na moeda da loja.
- Para tokens de usuário com permissões granulares, o usuário precisa da permissão 'View product costs'. Não verificado se isso afeta token de client credentials.
- O CSV de produtos da Shopify aceita a coluna 'Cost per item', MAS na atualização por handle, sem Option1 name/value, 'existing variants are deleted'.
- **Prós:** - Histórico de custo, que a Shopify não guarda (InventoryItem não tem histórico de custo).
- Frete do fornecedor separado e por país (EU x US).
- Moeda do fornecedor (USD) independente.
- **Contras:** Trabalho manual do Arthur para manter o custo em dia. Pedido antigo sem custo na época fica marcado como 'sem custo'.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem · https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventoryItemUpdate · https://shopify.dev/docs/api/usage/access-scopes · https://help.shopify.com/en/manual/products/import-export/using-csv

#### G. Custo e frete direto da API do fornecedor (CJ / AliExpress)

- **Como funciona:** - CJ: POST /api2.0/v1/logistic/freightCalculate com o header CJ-Access-Token, o corpo {startCountryCode, endCountryCode, products:[{vid, quantity}]}, e resposta com logisticName, logisticPrice (USD) e logisticAging.
- AliExpress: Open Platform com AppKey e assinatura. Métodos de dropshipping não verificados. Hoje o repo só raspa o AliExpress (src/lib/aliexpress/scraper.ts).
- **Requisitos:** Conta e token do fornecedor, mais um mapeamento SKU da loja -> id da variante no fornecedor (vid).
- **Limites:** Fase 2. O CSV resolve o caso de 2 lojas.
- **Prós:** Frete por país de destino automático. O custo acompanha o fornecedor.
- **Contras:** Precisa do mapeamento SKU -> vid. AliExpress exige aprovação de app. Mais uma integração para manter.
- **Fontes:** https://developers.cjdropshipping.com/en/api/api2/api/logistic.html

#### H. Histórico além de 60 dias (read_all_orders + bulk operations)

- **Como funciona:** - Bulk: bulkOperationRunQuery com orders > lineItems; refunds e transactions são listas, não conexões, então cabem no limite. Resultado em JSONL com __parentId e URL válida por 1 semana.
- Desde a API 2026-01 são até 5 bulk queries simultâneas por loja.
- **Requisitos:** read_all_orders exige aprovação da Shopify, e o caminho no Dev Dashboard está confuso:
- funcionário da Shopify, jan/2026: pedir no Partner Dashboard e depois declarar no Dev Dashboard;
- outro funcionário, jul/2026: 'This scope can be requested in the Dev Dashboard';
- app criado pelo próprio lojista pode não ter o limite (fala de funcionário da Shopify; não confirmado para app do Dev Dashboard).
- **Limites:** Bulk query precisa terminar em 10 dias. Máximo de 5 conexões e 2 níveis.
- **Prós:** Histórico completo das ~10 lojas, inclusive as paradas.
- **Contras:** Aprovação manual, sem prazo. Para as lojas ativas, que são novas, não muda nada.
- **Fontes:** https://shopify.dev/docs/api/usage/access-scopes · https://shopify.dev/docs/api/usage/bulk-operations/queries · https://community.shopify.dev/t/read-all-orders-through-admin-api/28964 · https://community.shopify.dev/t/request-read-all-orders-scope-for-public-app-goodmorning-new-dev-dashboard-no-request-card/36073 · https://community.shopify.dev/t/read-all-orders-scope-in-custom-apps-created-in-admin/4361

#### I. Câmbio: PTAX do BCB + Frankfurter/BCE (tabela diária) em vez de taxa fixa

- **Como funciona:** - Cron diário grava fx_rates(data, base, quote, taxa, fonte).
- PTAX 'Fechamento' (cotacaoVenda) para USD/BRL e EUR/BRL. Frankfurter para pares sem BRL (EUR/USD etc.).
- Fim de semana e feriado usam o último dia útil.
- Cada dia de receita e de gasto é convertido pela taxa daquele dia.
- **Requisitos:** Nenhuma chave. Testei os dois endpoints hoje: PTAX USD de 01/10/2026 = 5,2079 venda; Frankfurter USD->BRL = 5,1885 e USD->EUR = 0,88511 (data 2026-10-01).
- **Limites:** A PTAX só existe em dia útil (por volta das 13h de Brasília). O BCE publica por volta das 16h CET em dias úteis TARGET. O Frankfurter v1 está descontinuado, mas continua disponível; o v2 é o atual.
- **Prós:** - Gratuito e oficial: o BCB publica sob licença ODbL.
- O BCE avisa que suas taxas são 'for information purposes only', o que basta para relatório.
- O Frankfurter não pede chave e não tem cota diária; dá para hospedar por conta própria.
- **Contras:** Não é o câmbio que o gateway ou o banco realmente aplicou: spread, taxa de conversão do Shopify Payments, IOF.
- **Fontes:** https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/aplicacao · https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios · https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html · https://frankfurter.dev/

### Detalhes técnicos

## 1. O que o repo tem hoje

**Escopos** (C:\Onedrive\shopify-creator\src\lib\shopify\scopes.ts): write_legal_policies, write_online_store_navigation, read/write_products, read/write_publications, read/write_content, read/write_themes, read/write_metaobjects, read/write_metaobject_definitions, read/write_shipping, read/write_discounts, read_locations, write_inventory, read/write_markets, read_product_listings, read_orders, write_pixels, read_customer_events.

O que NÃO está lá:
- read_all_orders;
- read_customers;
- read_reports;
- read_returns;
- read_shopify_payments_*.

read_inventory não está explícito, mas a documentação diz: "Any scope that writes a resource also grants read access". A lista acima é o que o código espera. O escopo efetivo de cada loja é o da versão do app no Dev Dashboard, e dá para conferir com { currentAppInstallation { accessScopes { handle } } }, como scripts/registrar-webhook-pedidos.ts já faz.

**Versão da API** (src/lib/shopify/client.ts:5): SHOPIFY_API_VERSION = "2024-10". Pela documentação de versões, "If your app targets an inaccessible version, Shopify falls forward and responds using the oldest accessible stable version". Hoje isso é a 2025-10, acessível até 16/10/2026 15:00 UTC. Depois disso, passa a ser a 2026-01. Webhooks seguem a mesma regra; o header X-Shopify-Api-Version mostra a versão usada.

**Webhook** (src/app/api/shopify/webhooks/route.ts):
- endpoint único, HMAC sobre o corpo cru, idempotência por X-Shopify-Webhook-Id em shopify_webhook_events, janela de 72 h;
- trata app/uninstalled e orders/create;
- orders/create sai na linha 224 se o rastreamento estiver desligado (rastreamentoLigado) e depois aplica filtro-pedido.ts, que ignora teste, valor zero, PDV e draft (reenvio);
- outros tópicos caem no default, "topico sem tratamento" (linha 171).

**Inscrição de webhook:**
- ensureWebhook (client.ts:2645) usa sub: { callbackUrl, format: "JSON" }. O campo callbackUrl está marcado como Deprecated; o atual é uri.
- Na instalação, só APP_UNINSTALLED e ORDERS_CREATE são inscritos (auth/route.ts:306-326).

**Vendas:**
- src/lib/shopify/orders.ts:69 busca com `financial_status:paid`. Os valores válidos do filtro são paid, pending, authorized, partially_paid, partially_refunded, refunded, voided e expired. Ou seja, pedido parcialmente reembolsado fica fora do faturamento.
- src/lib/sales/queries.ts:38 devolve vazio se não houver rota, então loja sem vitrine não aparece.
- src/lib/sales/cambio.ts tem USD=5,4 fixo.

## 2. Campos da Shopify que importam

Todos com read_orders, dentro de Order:

| Uso | Campo |
|---|---|
| Bruto | totalPriceSet (antes de devoluções) |
| Atual | currentTotalPriceSet (depois de devoluções) |
| Subtotal | subtotalPriceSet, currentSubtotalPriceSet |
| Desconto | totalDiscountsSet, currentTotalDiscountsSet |
| Frete cobrado | totalShippingPriceSet, currentShippingPriceSet, totalRefundedShippingSet |
| Imposto | totalTaxSet, currentTotalTaxSet, taxesIncluded |
| Taxa alfandegária | originalTotalDutiesSet, currentTotalDutiesSet |
| Taxas adicionais | originalTotalAdditionalFeesSet, currentTotalAdditionalFeesSet |
| Gorjeta | totalTipReceivedSet |
| Dinheiro | totalReceivedSet, totalRefundedSet, netPaymentSet ("total amount received minus the total amount refunded"; o netPayment escalar é que está deprecated), totalOutstandingSet |
| Moeda | currencyCode (da loja), presentmentCurrencyCode (do cliente) |
| Status | cancelledAt, cancelReason, displayFinancialStatus, test, processedAt |
| Origem | sourceName ('web', 'pos', ...) |
| Gateway | paymentGatewayNames |
| Listas | refunds [lista com first], transactions [lista com first], lineItems [conexão], agreements [conexão], disputes [lista OrderDisputeSummary: id, initiatedAs, status] |

**LineItem:** sku, quantity (inclui reembolsado e removido), currentQuantity (exclui), unfulfilledQuantity, originalUnitPriceSet, discountedUnitPriceAfterAllDiscountsSet, discountedTotalSet, totalDiscountSet, taxLines, duties, variant, product. NÃO existe campo de custo.

**OrderTransaction:** kind, status, gateway, formattedGateway, amountSet, processedAt, test, settlementCurrency, settlementCurrencyRate, currencyExchangeAdjustment. O campo fees ([TransactionFee], com read_orders) é "Only present for Shopify Payments transactions".

**Refund:** createdAt, processedAt, totalRefundedSet, refundLineItems, refundShippingLines, orderAdjustments, transactions. A documentação avisa que um Refund existir não garante que o dinheiro saiu: é preciso olhar o status das transactions.

**InventoryItem.unitCost:** "Unit cost associated with the inventory item. The shop's currency is used." Exige read_inventory ou read_products.

## 3. Query de foto por pedido (sem dado pessoal)

```graphql
query FotoFinanceira($id: ID!) {
  order(id: $id) {
    id name createdAt processedAt updatedAt cancelledAt cancelReason test sourceName
    displayFinancialStatus currencyCode presentmentCurrencyCode taxesIncluded paymentGatewayNames
    totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount } }
    totalDiscountsSet { shopMoney { amount } }
    currentShippingPriceSet { shopMoney { amount } }
    totalShippingPriceSet { shopMoney { amount } }
    currentTotalTaxSet { shopMoney { amount } }
    currentTotalDutiesSet { shopMoney { amount } }
    totalTipReceivedSet { shopMoney { amount } }
    totalReceivedSet { shopMoney { amount } }
    totalRefundedSet { shopMoney { amount } }
    netPaymentSet { shopMoney { amount } presentmentMoney { amount currencyCode } }
    disputes { id status initiatedAs }
    refunds(first: 50) { id processedAt totalRefundedSet { shopMoney { amount } } }
    transactions(first: 50) {
      id kind status gateway formattedGateway processedAt test
      amountSet { shopMoney { amount currencyCode } }
      fees { type rate amount { amount currencyCode } flatFee { amount currencyCode } taxAmount { amount } }
    }
    lineItems(first: 100) { nodes {
      id sku quantity currentQuantity unfulfilledQuantity
      originalUnitPriceSet { shopMoney { amount } }
      discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount } }
      variant { id inventoryItem { id unitCost { amount currencyCode } } }
    } }
  }
}
```

**Reconciliação:**
```
orders(first: 100, after: $c, sortKey: UPDATED_AT, query: "updated_at:>='<cursor ISO>'")
```
O valor UPDATED_AT do sortKey não está verificado; conferir em OrderSortKeys. O filtro updated_at existe.

**Inscrição nova:**
```
webhookSubscriptionCreate(topic: ORDERS_UPDATED,
  webhookSubscription: { uri: ".../api/shopify/webhooks", format: JSON,
    includeFields: ["id", "updated_at"] })
```
includeFields: "Only the fields specified will be included in the webhook payload". Mantém o payload sem dado pessoal. O mesmo vale para ORDERS_CANCELLED. Para REFUNDS_CREATE, manter o payload completo e gravar como reserva, por causa dos pedidos com mais de 60 dias.

## 4. ShopifyQL de conferência (não testado)

```
shopifyqlQuery(query: "FROM sales SHOW gross_sales, discounts, returns, net_sales, shipping_charges, taxes, cost_of_goods_sold, gross_profit GROUP BY day, product_variant_sku SINCE -30d ORDER BY day")
```
- Resposta: tableData { columns { name dataType } rows } e parseErrors.
- Existe a dimensão cost_is_recorded.
- Fórmulas da Shopify: net_sales = gross_sales − discounts − estornos; gross_profit = net_sales − COGS.

## 5. Modelo de dados proposto (Supabase, todas as tabelas com RLS e WITH CHECK)

**product_costs**
- id, user_id, store_id
- sku text
- unit_cost numeric(12,4): custo do produto
- shipping_cost numeric(12,4) default 0: frete do fornecedor por unidade
- currency char(3)
- country_code char(2) null: null = padrão; serve para sobrescrever por país de destino
- valid_from timestamptz
- source ('csv', 'manual', 'shopify', 'cj')
- note, created_at
- Índice único: (store_id, sku, coalesce(country_code, '*'), valid_from).
- Busca: o maior valid_from que seja menor ou igual ao processed_at do pedido. Primeiro com o país do pedido, depois com null.

**fin_orders** (PK store_id + shopify_order_id)
- name, processed_at, day_local (date, no Shop.ianaTimezone), cancelled_at, test, source_name
- kind: 'venda', 'reenvio' (draft de valor zero), 'teste', 'pdv'
- shop_currency, presentment_currency
- Valores em shopMoney: gross_total, discounts, shipping_charged, taxes_current, duties_current, tips, received, refunded, net_payment
- presentment_total
- gateway_names text[], uses_shopify_payments bool
- fees_actual (soma de fees; null se não houver), fees_estimated, fee_rule_id
- cogs_total, supplier_shipping_total, lines_without_cost int
- dispute_status
- shopify_updated_at, synced_at, needs_resync bool

**fin_order_lines**
- store_id, shopify_order_id, line_item_id, sku, variant_id
- quantity, current_quantity, unfulfilled_quantity
- unit_price, discounted_unit_price
- Congelados na primeira ingestão e nunca reescritos: unit_cost_frozen, shipping_cost_frozen, cost_currency, cost_source, product_cost_id

**fin_refunds**
- store_id, shopify_order_id, refund_id, processed_at, day_local
- amount, shipping_refunded, status (das transactions)

**gateway_fee_rules**
- store_id, gateway_match text, percent numeric, fixed numeric, fixed_currency
- shopify_third_party_pct numeric
- refund_returns_fee bool
- valid_from

**fixed_costs**
- user_id, store_id null (null = dividido entre as lojas)
- name, amount, currency
- period ('mensal', 'unico', 'diario')
- valid_from, valid_to

**fx_rates**
- PK (date, base, quote): date, base, quote, rate, source ('ptax', 'frankfurter')

**fin_sync_state**
- store_id, updated_at_cursor, last_reconcile_at, oldest_order_visible

**fin_dirty_orders**
- PK (store_id, shopify_order_id): store_id, shopify_order_id, reason, enqueued_at

## 6. Fórmulas (moeda da loja; converter só na hora de juntar com o anúncio)

- **receita_liquida** = net_payment − taxes_current − duties_current − tips. Pedido não pago tem net_payment 0.
- **cogs**:
  - linha cancelada ou reembolsada ANTES de enviar: 0 (usar quantity − unfulfilled/current);
  - reembolsada DEPOIS de enviar: o custo continua (configurável);
  - reenvio (draft de valor zero): custo cheio, receita zero.
- **frete_fornecedor** = Σ quantidade × shipping_cost_frozen.
- **taxas**:
  - se houver fees reais: soma das fees;
  - senão: percent × received + fixed × nº de transações de venda + shopify_third_party_pct × received.
- **lucro_pedido** = receita_liquida − cogs − frete_fornecedor − taxas − chargeback.
- **lucro_dia_loja** = Σ lucro_pedido do dia − gasto de anúncio do dia (convertido) − custo fixo do dia.
  - Mensal ÷ dias do mês; acréscimo de IOF/spread se a conta de anúncio cobra em USD num cartão brasileiro. A alíquota de 3,5% vem do Decreto 12.466/2025; conferir se ainda está em vigor.

## 7. Câmbio (testado em 02/10/2026)

**PTAX:**
```
https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='USD'&@dataInicial='09-28-2026'&@dataFinalCotacao='10-01-2026'&$format=json&$filter=tipoBoletim eq 'Fechamento'
```
Devolve cotacaoVenda 5.2079 para 01/10. As datas vão no formato MM-DD-AAAA.

**Frankfurter:**
```
https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL,EUR
```
Devolve {BRL: 5.1885, EUR: 0.88511}. Também aceita data específica e o intervalo from/to.

## 8. Importação de custo em massa

- **Modelo:** CSV exportado pelo xcart com sku, produto, variante, preço atual e custo atual da Shopify. O Arthur preenche custo_produto, frete_unitario, moeda, pais (opcional) e valido_desde (opcional, padrão = agora). Ao subir, o xcart valida o SKU contra a loja e mostra a prévia: X novos, Y alterados, Z SKUs desconhecidos.
- **Espelho na Shopify:** inventoryItemUpdate(id, input:{cost}) com write_inventory, que já existe.
- **Regra do repo (CLAUDE.md):** nunca mexer em variantes nem SKUs. É por isso que o CSV da Shopify com "overwrite" está fora: sem Option1 name/value, a Shopify apaga as variantes existentes.

## 9. Next.js

Para não estourar os 5 s do webhook, o padrão é: o webhook grava fin_dirty_orders e responde, e o trabalho pesado fica no cron. Se quiser tentar processar na hora, `after` de 'next/server' roda depois da resposta dentro do maxDuration da rota (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md). O repo já usa after em create-destination e nos jobs.

### Riscos

**1. Versão da API**
O app declara 2024-10, mas recebe a 2025-10 hoje e a 2026-01 depois de 16/10/2026. Qualquer campo novo (netPaymentSet, fees, agreements, shopifyqlQuery a partir da 2025-10) precisa de versão explícita e testada. Trocar a versão afeta o app inteiro (produto, tema, rota), então precisa de teste de regressão.

**2. Bug atual de faturamento**
`financial_status:paid` exclui partially_refunded. O pedido com reembolso parcial some inteiro da tela de Vendas e do admin/faturamento. O fato está verificado na lista de valores do filtro; o efeito não foi visto em pedido real.

**3. Câmbio fixo**
src/lib/sales/cambio.ts usa USD=5,40, contra a PTAX de 01/10/2026 de 5,2079: cerca de 3,7% a mais no valor em BRL.

**4. Limite de 60 dias**
Chargeback costuma chegar depois de 60 dias. Com read_orders, o GraphQL pode não reler o pedido antigo. Mitigações:
- gravar o payload de REFUNDS_CREATE e de disputas;
- ou pedir read_all_orders.
Não verificado: se o webhook de pedido com mais de 60 dias continua chegando.

**5. Webhooks não são garantidos**
Pela documentação: "Webhook delivery isn't always guaranteed". Depois de 8 falhas em 4 h, "the subscription is removed". Sem cron de reconciliação e de reinscrição, o financeiro desvia em silêncio.

**6. Acoplamento com o rastreamento**
O orders/create de hoje só trata pedido com o rastreamento ligado e ignora draft e valor zero. O financeiro NÃO pode herdar isso: reenvio é custo real sem receita.

**7. Decisão de arquitetura**
src/lib/sales/queries.ts diz que o xcart não guarda pedido de propósito. A foto financeira inverte essa decisão. Precisa do OK do Arthur, e as duas telas (Vendas e Lucro) não podem mostrar números diferentes sem explicação.

**8. Dados pessoais e RLS**
- Não gravar email, endereço nem nome do cliente.
- Usar includeFields nos webhooks novos.
- Tabelas novas com RLS USING e WITH CHECK.
- Função SECURITY DEFINER revogada de public, anon e authenticated, conforme o CLAUDE.md.

**9. ShopifyQL**
Exige dado protegido de cliente nível 2 (a documentação diz "always available" para app custom) e um escopo novo. Não verificado: atraso dos dados, plano mínimo e o comportamento com 60 dias.

**10. Taxas estimadas**
Gateway de terceiro e taxa da Shopify por terceiro são estimativa. Os percentuais por plano vêm de fonte secundária; conferir em Configurações > Faturamento. Chargeback de gateway de terceiro é invisível para a Shopify.

**11. Shopify Payments**
O Brasil não está entre os países suportados, e não sei em que país cada loja está cadastrada. Também não está documentado o que shopifyPaymentsAccount devolve em loja sem Shopify Payments.

**12. CSV de produtos da Shopify**
Usar "overwrite" sem as colunas de opção apaga as variantes. Isso quebra SKU, rota e rastreamento.

**13. Fuso horário**
O dia da loja (Shop.ianaTimezone) e o dia da conta de anúncio podem ser diferentes; o lucro diário fica desalinhado em algumas horas. Mostrar o fuso de cada lado.

**14. Moeda**
A Lash Bestie cobra em EUR e registra em USD. O shopMoney usa a conversão da Shopify no momento do pedido; o dinheiro que realmente cai depende do gateway (settlementCurrencyRate). Diferença esperada: alguns pontos percentuais.

**15. Venda como serviço**
O client credentials grant "only works when the app and the store belong to the same Shopify organization". Loja de terceiro exigiria outro fluxo de autorização, o que afeta qualquer plano de vender isso.

**16. Instrução desatualizada**
scripts/registrar-webhook-pedidos.ts manda o lojista em "Desenvolver apps" e diz que o token pega o escopo novo sem reinstalar. Para app do Dev Dashboard, a documentação do client credentials diz: "release a new app version and approve the change on your store".

### O que só o Arthur pode fazer

**1. Shopify Payments: usa ou não?** (5 min por loja)
Em cada loja (Lash Bestie qkgknv-w3, Softnook kphigm-76): Configurações > Pagamentos. Anotar:
- se Shopify Payments está ativo;
- quais gateways de terceiro estão ligados, com taxa percentual e fixa de cada um;
- o país de cadastro da loja.

**2. Plano Shopify de cada loja**
Em Configurações > Plano. É o que define a taxa da Shopify por gateway de terceiro. Confirmar o percentual na própria fatura.

**3. Nova versão do app no Dev Dashboard** (dev.shopify.com > o app da loja > nova versão > marcar os escopos > lançar > aprovar a atualização no admin da loja)
É um app por loja, então repetir nas duas. Escopos a marcar:
- read_reports: só se quiser a conferência por ShopifyQL;
- read_shopify_payments_payouts e read_shopify_payments_disputes: só se o passo 1 der "usa Shopify Payments". Nenhum dos dois exige aprovação da Shopify.
Não precisa marcar read_inventory, porque write_inventory já dá leitura. Não precisa read_customers.

**4. Histórico além de 60 dias** (só se quiser o passado das lojas paradas)
Pedir read_all_orders pelo Dev Dashboard: "Request access", com a justificativa "relatório financeiro e de lucro das minhas próprias lojas". Antes disso, eu posso rodar um teste só de leitura para ver se o app já enxerga pedidos mais velhos.

**5. Custos dos produtos**
Preencher o CSV que o xcart vai gerar, com estes campos por SKU:
- custo do produto em USD;
- frete do fornecedor por unidade;
- se o frete muda por destino (por exemplo, EU x US), uma linha por país.
Alternativa: preencher o "Cost per item" na Shopify, mas nunca pelo CSV de produtos com "sobrescrever".

**6. Custos fixos mensais**
Plano Shopify, apps, domínio, ferramentas e o que mais quiser ratear por loja.

**7. Moedas e cobrança**
- Escolher a moeda do relatório (sugestão: BRL).
- Dizer em que moeda as contas de anúncio cobram. Se for USD num cartão brasileiro, a gente aplica IOF + spread.

**8. Aprovar a mudança de arquitetura**
O xcart passa a guardar uma foto financeira de cada pedido, sem dado de cliente. Hoje a decisão registrada é não guardar pedido.

---

## Como os líderes fazem (TrueProfit, BeProfit, Triple Whale…)

**Resumo.** Pesquisei TrueProfit, BeProfit, Triple Whale, Lifetimely, Shopify Analytics, WeTracked, Polar, Northbeam e o GitHub. O que encontrei:

1) Todos fazem a mesma conta, em degraus. Receita líquida, menos custo do produto (COGS), taxas de pagamento e frete, dá a margem de contribuição antes de anúncio (CM2). Tirando o gasto com anúncio, sobra o lucro de contribuição (CM3). Tirando os custos fixos, sobra o lucro líquido. As diferenças são poucas: se o imposto entra na receita, e se o reembolso cai na data do pedido ou na data do reembolso. Polar dá nome aos degraus (CM1/CM2/CM3). BeProfit usa Gross Profit, depois Contribution Profit, depois Net Profit. Lifetimely mostra a mesma cascata como DRE diária.

2) A tela principal é parecida em todos:
- seletor de período, com comparação automática com o período anterior;
- cards de faturamento, gasto em anúncio, lucro, ROAS blended, margem e pedidos/ticket médio;
- gráfico ao longo do tempo;
- visão "todas as lojas" com troca para uma loja só (TrueProfit "All stores", Triple Whale "Pods view", que é uma tabela de lojas com uma linha somada no topo).
O WeTracked Pulse acrescenta cores verde/amarelo/vermelho por desempenho.

3) O essencial para um dropshipper com várias lojas:
- custo por SKU com data de validade (TrueProfit congela o custo no pedido e permite recalcular por período; Lifetimely usa custo com data de início e fim);
- gasto de anúncio diário por conta, ligado a uma loja (TrueProfit permite dividir uma conta entre lojas por filtro no nome da campanha);
- taxa de pagamento (percentual + fixo por gateway, ou o valor real);
- conversão de moeda para a moeda da loja com cotação diária (TrueProfit, Lifetimely, Triple Whale).
O que é enfeite para o seu caso agora: LTV e coortes, atribuição multi-toque, MMM, incrementalidade, ncROAS/aMER (dropshipping quase não tem cliente que volta), IA/MCP, DRE com custos fixos.

4) Os apps sincronizam o gasto de anúncio com frequência:
- TrueProfit: a cada 5 a 10 minutos.
- ProfitMetrics: de hora em hora o dia de hoje, e à meia-noite busca de novo os últimos 30 dias (vi isso só num trecho de busca; a página não abriu).
O Meta diz oficialmente que os insights atualizam a cada 15 minutos e não mudam depois de 28 dias. O Google diz que o atraso é normalmente menor que 3 horas e que clique inválido é estornado dias depois. Por isso todos reprocessam os dias anteriores.

5) O dia do gasto segue o fuso da conta de anúncio. Ninguém consegue corrigir isso pela API, porque o pedido é feito por data, sem hora (o help do Profit Calc diz isso, e o log de decisões do dbt da Fivetran também). No Google, moeda e fuso da conta não mudam depois de criada.

6) A Shopify NÃO expõe pela API o custo do item no momento da venda, só o custo atual (InventoryItem.unitCost). O relatório de lucro dela usa o custo da hora da venda, mas não inclui frete, taxas nem anúncio. Logo, ou o xcart guarda o custo, ou mantém uma tabela de custo com data de validade.

7) O Google desligou o developer token em 09/09/2026. Ele continua aceito, mas é ignorado. O nível de acesso agora vem do projeto do Google Cloud, e não precisa mais de conta MCC. O nível Explorer dá 2.880 operações/dia em contas reais, e cada consulta conta como 1 operação. Isso muda a premissa de "sem developer token". Ainda há atrito: é preciso pedir o Explorer, e o OAuth em modo "Testing" dá um refresh token que expira em 7 dias. Para 3 contas, Google Ads Scripts mandando os dados para o xcart continua sendo o caminho com menos atrito.

8) Não achei nenhum projeto open-source maduro de lucro para Shopify: os repositórios têm de 0 a 1 estrela. A referência útil é o modelo de dados de gasto do fivetran/dbt_ad_reporting (222 estrelas).

9) O repositório já tem uma tela de Vendas por loja (períodos de 7, 30 e 60 dias, receita via currentTotalPriceSet, câmbio fixo para BRL em src/lib/sales/cambio.ts). O MVP deve crescer a partir dela, e não começar o menu de 4 grupos da outra IA.

**Recomendação.** Recomendo construir um MVP enxuto dentro do xcart, e não assinar um app. O TrueProfit cobra por loja, de US$35 a US$200 por mês (https://apps.shopify.com/trueprofit); com cerca de 10 lojas fica caro, e o Google ainda exigiria OAuth do lado deles. O MVP responde a uma pergunta só: "qual loja dá dinheiro e qual queima verba", e copia o que os líderes têm em comum.

MVP (fase 1), em 5 peças:

1. Pedidos guardados no banco.
- Tabela de pedidos e itens, alimentada pelo webhook orders/create (já existe) e pelo orders/updated (que cobre reembolso, cancelamento e edição). Para não perder nada, um cron por noite busca de novo os pedidos dos últimos 7 dias.
- Carga inicial dos últimos 60 dias, que é o limite do read_orders.
- Vantagem: a partir do dia em que entrar no ar, o histórico se acumula além dos 60 dias sem precisar de read_all_orders.
- Não use tracking_events como fonte de receita: ela é apagada depois de 90 dias e não é uma tabela de pedidos.

2. Custo por SKU com data de validade (como no Lifetimely).
- Uma tabela com loja, SKU, custo, moeda e "vale a partir de". O custo de um pedido é o que valia no dia dele.
- Para dropshipping, o custo já inclui o frete do fornecedor.
- Se o SKU não tiver custo, usa uma margem padrão por loja, e a tela mostra quanto da receita está sem custo cadastrado (a Shopify faz o mesmo com net_sales_without_cost_recorded).
- Prefiro isso a "congelar o custo no pedido". A API não dá o custo histórico, o custo do fornecedor provavelmente nem está no "Cost per item" da Shopify (não verificado), e corrigir um custo para trás vira só editar uma data. O TrueProfit teve que criar uma tela de "recalcular COGS de pedidos passados" justamente por congelar.

3. Gasto de anúncio diário por conta.
- Uma tabela de vínculo conta de anúncio → loja (plataforma, ID, moeda, fuso, filtro de campanha opcional) e uma tabela de gasto por dia e por campanha.
- Meta: Insights API com nível campanha e um dia por linha. Cron a cada 15 minutos para hoje e ontem, e uma vez por noite reprocessa os últimos 7 dias.
- Google, fase 1: um Google Ads Script em cada uma das 3 contas, rodando de hora em hora e mandando (POST) os últimos 7 dias para um endpoint do xcart autenticado com um segredo por conta. Não precisa de aprovação, projeto no Cloud nem OAuth. Dados de hora em hora bastam, porque o próprio Google promete atraso de até ~3 horas.
- Google, fase 2 (opcional): trocar pela Google Ads API no modelo novo sem developer token, se o Explorer for aprovado.

4. Câmbio diário para BRL.
- Cotação PTAX do Banco Central, gravada uma vez por dia; nos fins de semana usa a do último dia útil. Se a moeda não existir na PTAX, cai na tabela fixa do cambio.ts.
- Câmbio fixo serve para ranquear faturamento, mas não para lucro: receita em USD/EUR menos gasto possivelmente em BRL, com margem apertada, troca o sinal do lucro com 5% de erro no câmbio.

5. Uma tela "Lucro" (ou a evolução da tela de Vendas).
- Período: Hoje, Ontem, 7 dias, 30 dias, Mês atual, sempre comparado com o período anterior.
- 4 cards com a variação em %: Faturamento, Gasto em ads, Lucro e ROAS real.
- Tabela de lojas ordenada por lucro: faturamento, pedidos, gasto (Meta e Google), ROAS real, ROAS de equilíbrio, lucro, margem, lucro por pedido e uma cor:
  - vermelho: lucro abaixo de zero;
  - amarelo: lucro positivo mas ROAS real abaixo de 1,2× o de equilíbrio (limite a ajustar);
  - verde: acima disso;
  - cinza: sem gasto.
- Avisos na linha: "X% da receita sem custo", "fuso da conta ≠ fuso da loja", "Google sem dado há Nh".
- Clicar numa loja abre a mesma tabela dia a dia.
- Configuração mínima: vincular contas, editar custos (com importação de CSV e botão "copiar custo da Shopify"), taxa do gateway por loja quando não for Shopify Payments, e margem padrão.

Fórmulas do MVP:
- Receita = total atual do pedido − imposto, na data do pedido no fuso da loja.
- CM2 = Receita − COGS − taxas.
- Lucro = CM2 − Ads.
- ROAS real = Receita ÷ Ads.
- ROAS de equilíbrio = Receita ÷ CM2.
- Lucro por pedido = Lucro ÷ pedidos.
- CPA = Ads ÷ pedidos.
Na tela, use o rótulo "ROAS real" e não "MER": o Triple Whale define MER como gasto ÷ receita, e Northbeam e Polar como receita ÷ gasto.

Deixar para depois:
- custos fixos e lucro líquido / DRE mensal;
- tabela por campanha (o dado já vai ser guardado por campanha);
- lucro por produto;
- comparativo xcart × Meta × Google (atribuição);
- alertas no Telegram;
- custo por país;
- puxar o custo direto do fornecedor (o TrueProfit faz isso com CJ/AutoDS a cada 2 horas);
- LTV, CAC de cliente novo, ncROAS, aMER;
- jornada/atribuição;
- MCP;
- escolher a moeda de exibição.
O diagnóstico de pixels já existe na tela de rastreamento.

Esforço estimado (é estimativa minha, não verificado): 4 a 7 dias de desenvolvimento. São cerca de 5 tabelas, 1 webhook novo mais a carga inicial, 2 crons (Meta e câmbio), 1 endpoint de recebimento do Google, 1 tela e 3 formulários de configuração.

### Opções avaliadas

#### TrueProfit (referência principal / comprar pronto)

- **Como funciona:** Dashboard em tempo real. Net Profit = Revenue + Tips + Gift Card Sales − Total Costs − Taxes Collected (configurável) − chargebacks. Total Costs = COGS + Handling + Shipping Costs + Ad Spend + Transaction Fees + Custom Costs. Revenue = Gross Sales − Discounts − Returns + Taxes + Shipping Charged. Gross Profit = Revenue − COGS − Shipping − Transaction Fees − Handling. Métricas: Net/Gross margin, AOV, Average Order Cost, Average Order Profit, Ad Spend per Order, CAC (ad spend ÷ clientes novos), Blended ROAS = Revenue ÷ Total Ad Spend, POAS = Gross Profit ÷ Ad Spend, ncROAS. COGS = custo unitário × unidades − custo das unidades devolvidas; por padrão o custo novo vale só para pedidos novos (fica congelado), com recálculo opcional 'All time' ou por período; tem 'COGS zones' (custo por região) e puxa custo e frete reais da CJ/AutoDS/eProlo a cada 2 horas. Taxa de gateway = % + fixo, com gateways detectados nos pedidos e sync de PayPal/Stripe. Gasto de anúncio a cada 5–10 min (Facebook, Google, TikTok…), com histórico de até 3 anos; filtro por nome de campanha (1 por conta) para dividir uma conta de anúncio entre lojas. Converte tudo para a moeda da loja com cotação diária da openexchangerates.org. Visão 'All stores' grátis, que converte cada loja para uma moeda antes de somar.
- **Requisitos:** Instalar o app em cada loja (uma assinatura por loja) e conectar as contas de anúncio via OAuth.
- **Limites:** Basic US$35/mês (300 pedidos), Advanced US$60 (600), Ultimate US$100 (1.500, regras de sync de anúncio), Enterprise US$200 (3.500). Cobra excedente.
- **Prós:** É o mais próximo do caso do dropshipper: custo congelado, integração com fornecedor, visão de todas as lojas, sync rápido de anúncio e app de celular.
- **Contras:** Cobra por loja: com ~10 lojas fica em centenas de dólares por mês. Os dados ficam fora do xcart. O help não documenta como trata fuso diferente entre loja e conta de anúncio.
- **Fontes:** https://helpdesk.trueprofit.io/en/articles/11324705-dashboard-metrics-glossary · https://helpdesk.trueprofit.io/en/articles/15561827-how-trueprofit-calculates-your-net-profit · https://helpdesk.trueprofit.io/en/articles/16051710-how-to-recalculate-cogs-for-past-orders · https://helpdesk.trueprofit.io/en/articles/15919801-why-is-my-trueprofit-data-not-updating · https://helpdesk.trueprofit.io/en/articles/13349042-manage-marketing-channel-accounts-and-set-up-ad-spend-sync-by-campaign-filter · https://helpdesk.trueprofit.io/en/articles/11325376-what-if-my-store-currency-differs-from-my-ad-account-currency · https://helpdesk.trueprofit.io/en/articles/16117542-multi-currency-shopify-stores-does-a-consolidated-profit-dashboard-convert-everything-to-one-currency · https://helpdesk.trueprofit.io/en/articles/11330347-switch-between-multiple-stores · https://helpdesk.trueprofit.io/en/articles/11325353-integrate-dropshipping-platforms-with-trueprofit · https://helpdesk.trueprofit.io/en/articles/11325244-set-up-transaction-fees · https://apps.shopify.com/trueprofit · https://trueprofit.io/solutions/profit-dashboard

#### BeProfit (Viably)

- **Como funciona:** Cascata documentada no glossário (só consegui ler pelo trecho de busca; a página dá 404 no fetch). Total Sales = receita bruta − descontos − devoluções. Gross Profit = Net Sales − Transaction Fees − Fulfillment Costs − Product Costs. Fulfillment = Shipping + Handling + Duties. Contribution Profit = Gross Profit − Marketing Costs. Contribution Margin = Contribution Profit ÷ (Total Sales − Sales Taxes). Net Profit = Contribution Profit − Operating Expenses. Tem lucro por pedido, produto, país, plataforma e loja; o plano Plus junta várias lojas; tem configuração de fuso e 'prioridade do método de COGS'.
- **Requisitos:** Instalar o app e conectar as plataformas de anúncio.
- **Limites:** Basic US$49 (450 pedidos), Pro US$99 (900), Ultimate US$149 (1.700), Plus US$249 (ilimitado, várias lojas).
- **Prós:** Separa com clareza contribuição (antes de custo fixo) de lucro líquido. Analisa por país.
- **Contras:** O help center migrou e várias páginas não abrem. Um terceiro afirma que só conta gasto atribuído por UTM (não verificado).
- **Fontes:** https://help.runviably.com/beprofit/the-profit-glossary-beprofit-help-center · https://help.runviably.com/beprofit/general · https://apps.shopify.com/beprofit-profit-tracker

#### Triple Whale

- **Como funciona:** Net Profit = receita dos pedidos − reembolsos − ad spend (das plataformas + gasto manual marcado como anúncio) − Total Costs. Total Costs = COGS − COGS reembolsado + gateway + frete + handling + impostos + custom expenses. Blended ROAS = Order Revenue ÷ Blended Ad Spend. O MER deles é o INVERSO: (Ad Spend + Custom Ad Spend) ÷ Order Revenue. O reembolso e o COGS do reembolso caem na data em que o reembolso foi processado, não na do pedido; por isso diverge da Shopify. Converte gasto de anúncio para a moeda da loja; em dado histórico usa a cotação média do período, da OANDA (trecho da KB, página com 403). A Pods view mostra todas as lojas com 'Blended Metrics' somadas no topo, seletor de datas e escolha de quais lojas entram na soma.
- **Requisitos:** App + Triple Pixel + integrações.
- **Limites:** Plano Free (12 meses de histórico, atribuição first/last-click); Foundation US$219/mês; Automate US$749/mês.
- **Prós:** Visão de várias lojas pronta. Fórmulas públicas e detalhadas na documentação de dados.
- **Contras:** Foco em atribuição e IA (Moby), caro nos planos pagos, avaliação 4/5 com 18% de 1 estrela na App Store.
- **Fontes:** https://triplewhale.readme.io/docs/net-profit · https://triplewhale.readme.io/docs/blended-roas · https://triplewhale.readme.io/docs/why-is-my-cogs-in-triple-whale-different-from-my-shopify-cogs · https://kb.triplewhale.com/en/articles/6127778-summary-page-metrics-library · https://kb.triplewhale.com/en/articles/9590400-which-currencies-are-supported-in-triple-whale · https://kb.triplewhale.com/en/articles/6224580-navigating-the-pods-view · https://apps.shopify.com/triplewhale-1

#### Lifetimely (AMP)

- **Como funciona:** DRE diária. Net Sales = receita de produto + frete cobrado − descontos − reembolsos − impostos. Contribution Margin = vendas − descontos − reembolsos − impostos − COGS − marketing. Net Profit = Contribution Margin − Operating Expenses (custos personalizados que não são marketing). Indicadores: Gross/Net Margin %, COGS %, Marketing %, Refund %, CAC blended = marketing ÷ clientes novos, ROAS blended = Net Sales ÷ marketing, New Customer ROAS. Custo do produto em ordem de prioridade: custo manual do app > 'Cost per item' da Shopify > margem padrão %. O custo pode ter data de início e fim; sem data, vale para todo o histórico, para trás também; CSV por SKU. Custos personalizados recorrentes (frequência + início/fim), via Google Sheets, CSV ou cobrança da Shopify. Converte cada pedido pela cotação do dia do processamento, e o gasto de anúncio a partir da moeda de cada conta. Taxa de transação = % + fixo por gateway.
- **Requisitos:** App + integrações (Meta, Google, TikTok…).
- **Limites:** Free; S US$49 (500 pedidos/mês); M US$149 (3.000); L US$299 (7.000).
- **Prós:** O modelo de custo com data de validade + margem padrão é o mais simples de copiar. Plano grátis.
- **Contras:** Foco em LTV/coortes. Frequência de sync não documentada.
- **Fontes:** https://help.useamp.com/article/687-income-statement-walkthrough · https://help.useamp.com/article/652-product-costs-explained · https://help.useamp.com/article/691-marketing-costs-currency-conversion · https://help.useamp.com/article/692-what-are-custom-costs · https://help.useamp.com/article/685-how-to-set-up-transaction-costs-in-lifetimely · https://apps.shopify.com/lifetimely-lifetime-value-and-profit-analytics

#### Shopify Analytics nativo (+ ShopifyQL pela API)

- **Como funciona:** Tela inicial com cards numéricos e gráficos, variação % contra o período anterior ou o mesmo período do ano passado, e datas pré-definidas ou personalizadas. Relatórios de lucro (por produto, variante, pedido, mercado) usam o custo registrado NA HORA DA VENDA. Mudar o 'Cost per item' não altera pedidos passados. Margem bruta = (vendas líquidas − custo) ÷ vendas líquidas. NÃO entram frete pago, taxas nem anúncio. Pela API, o ShopifyQL (shopifyqlQuery) expõe gross_sales, net_sales, total_sales, cost_of_goods_sold, gross_profit, net_sales_without_cost_recorded, returns, shipping_charges, taxes, orders, com dimensões day, product_variant_sku, utm_*, sempre na moeda e no fuso da loja.
- **Requisitos:** shopifyqlQuery só existe a partir da API 2025-10, com escopo read_reports e Protected Customer Data nível 2. O xcart usa a 2024-10.
- **Limites:** A API pede Protected Customer Data nível 2 (a aprovação pode demorar, segundo a Shopify).
- **Prós:** COGS no custo histórico sem guardar nada. Bate com o que o lojista vê no admin.
- **Contras:** Não tem gasto de anúncio. Exige subir a versão da API e um escopo novo. Pela Admin API comum não existe custo histórico por item (só o InventoryItem.unitCost atual; pedido aberto na comunidade desde 2018).
- **Fontes:** https://help.shopify.com/manual/reports-and-analytics/shopify-reports/report-types/profit-reports · https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard · https://shopify.dev/docs/apps/build/shopifyql/graphql-admin-api/build-a-sales-dashboard · https://shopify.dev/docs/api/shopifyql/latest/schemas/sales_revenue/sales · https://community.shopify.com/t/cost-on-orders-api/1610

#### WeTracked

- **Como funciona:** É ferramenta de rastreamento (pixel server-side), não de lucro. O Pulse Dashboard mostra métricas das campanhas e contas do Meta: spend, revenue, ROAS, CPA e funil. Filtros: loja (uma por vez), período (diário, semanal, quinzenal, personalizado) e várias contas de anúncio. Compara automaticamente com o período anterior (7 dias contra os 7 anteriores). Cores verde/amarelo/vermelho por limite, e abas Campanha/Conjunto/Anúncio. O relatório usa last-click e depende de UTM no conjunto de anúncios. O help explica que o Google Ads põe a conversão na data do CLIQUE por padrão; para bater com a loja, use a coluna 'Conversions (by conv. time)'.
- **Requisitos:** Pixel deles instalado na loja.
- **Limites:** Não documentado no help.
- **Prós:** Bons padrões de interface: comparação automática e semáforo.
- **Contras:** Sem COGS, sem lucro; não documenta frequência de sync nem moeda.
- **Fontes:** https://help.wetracked.io/en/article/pulse-dashboard-by-wetrackedio-1p6oxou/ · https://help.wetracked.io/en/article/how-to-use-the-reporting-in-wetrackedio-1q8lc6n/ · https://help.wetracked.io/en/article/how-google-ads-conversions-conv-by-time-works-18tsjpk/ · https://www.wetracked.io/post/introducing-pulse-dashboard-real-meta-ads-performance-inside-wetracked-io

#### Polar Analytics

- **Como funciona:** Camada semântica com 400+ métricas sobre um Snowflake dedicado. 'Blended' traz ROAS/MER, ncROAS, POAS, CAC, CPO, CM3/CM4. No blog: CM1 = vendas líquidas − COGS; CM2 = CM1 − pagamento − 3PL/frete/embalagem − reserva para devolução; CM3 = CM2 − custo de aquisição; ROAS de equilíbrio = 1 ÷ margem de contribuição (2,5 com margem de 40%). Nas 'Data Settings' o usuário escolhe se desconto, devolução, frete, imposto, gorjeta e COGS entram em Total Sales, e isso recalcula todo o histórico.
- **Requisitos:** Contrato (preço por faturamento anual, sob demonstração).
- **Limites:** Planos Core/Custom, preço não publicado; refresh diário (intraday como add-on).
- **Prós:** A melhor nomenclatura de margem (CM1/2/3). Deixar a definição de receita configurável é um bom padrão.
- **Contras:** Caro e para marca grande. Refresh padrão diário; intraday é pago à parte.
- **Fontes:** https://intercom.help/polar-app/en/articles/8287323-blended-metrics · https://intercom.help/polar-app/en/articles/10861666-data-settings · https://www.polaranalytics.com/post/contribution-margin-formula-for-ecommerce-how-to-calculate-it · https://www.polaranalytics.com/post/mer-marketing-efficiency-ratio · https://www.polaranalytics.com/pricing

#### Northbeam

- **Como funciona:** Atribuição multi-toque. MER = Rev ÷ Spend, em contabilidade de caixa e sem janela de atribuição. ROAS = Attributed Rev ÷ Spend, em contabilidade por competência, com janelas (1d, 7d…). CAC = Spend ÷ Transactions, separado em novo e recorrente. A página de métricas não traz COGS, lucro nem margem.
- **Requisitos:** Contrato.
- **Limites:** Starter US$1.500/mês (gasto anual abaixo de US$1,5M); Professional US$3.500; Enterprise sob consulta.
- **Prós:** Deixa clara a diferença caixa × competência: o MER responde ao fluxo de caixa, o ROAS atribuído incorpora o atraso da conversão.
- **Contras:** Não calcula lucro. Fora da escala do Arthur.
- **Fontes:** https://docs.northbeam.io/docs/northbeam-metrics-101 · https://www.northbeam.io/pricing

#### Open-source (GitHub)

- **Como funciona:** Não há projeto maduro: a busca 'shopify profit' ordenada por estrelas devolve repositórios com 0 a 1 estrela. Exemplos: d2c-profit-os (Next.js 15 + Drizzle + Neon; Profit = Receita − COGS − Ads − Taxas − Frete − Despesas; snapshots diários de anúncio); ultimate-profit-tracker (Supabase + pg-boss; lucro por pedido com frete por zona, COD, devolução; gasto ligado por UTM/click id, e o que não liga é rateado proporcionalmente); everlasting-profit (Vercel + Supabase + token de System User do Meta com ads_read). Referências sérias: fivetran/dbt_ad_reporting (222 estrelas) junta 11 plataformas no grão dia × conta × campanha × anúncio, com spend, clicks, impressions, conversions; o log de decisões admite que o fuso não tem como ser corrigido em dado pré-agregado e recomenda contas em UTC. fivetran/dbt_shopify NÃO calcula COGS. O conector Facebook do Airbyte relê os últimos 28 dias a cada sync e ajusta o intervalo ao fuso de cada conta; o do Google Ads sincroniza até ONTEM no fuso da conta e já aceita developer token fictício desde 09/09/2026.
- **Requisitos:** —
- **Limites:** —
- **Prós:** Confirmam o modelo de dados (grão dia/conta/campanha) e a releitura dos últimos dias.
- **Contras:** Nada pronto para reaproveitar.
- **Fontes:** https://github.com/fivetran/dbt_ad_reporting · https://github.com/fivetran/dbt_ad_reporting/blob/main/DECISIONLOG.md · https://github.com/fivetran/dbt_shopify · https://github.com/gauravkoolyadav-cmd/d2c-profit-os · https://github.com/Omar92953/the-ultimate-profit-tracker · https://github.com/hellodeeep/everlasting-profit · https://docs.airbyte.com/integrations/sources/facebook-marketing · https://docs.airbyte.com/integrations/sources/google-ads

#### Gasto Google — A: Google Ads Script mandando (POST) para o xcart (RECOMENDADO na fase 1)

- **Como funciona:** Um script colado em cada conta do Google Ads, agendado de hora em hora. Ele roda uma consulta GAQL (AdsApp.search) de segments.date, campaign.id/name e metrics.cost_micros dos últimos 7 dias e manda o resultado com UrlFetchApp.fetch (POST JSON) para um endpoint do xcart autenticado com segredo por conta. O xcart grava por cima do que já existe por (conta, campanha, data).
- **Requisitos:** Acesso de administrador às 3 contas. Um endpoint novo no xcart e um segredo gerado para cada conta.
- **Limites:** 30 min por execução; até 50.000 resultados por iterator; 250 scripts autorizados por conta; quota do UrlFetchApp não detalhada na página.
- **Prós:** Custo zero. Não precisa de developer token, projeto Cloud, OAuth, MCC nem aprovação. Releitura de 7 dias embutida (cobre o estorno de clique inválido).
- **Contras:** Frequência mínima é de hora em hora, sem escolher o minuto (fonte terceira, a doc oficial não fala do agendamento). Precisa colar o script em cada conta nova. Pode falhar sem avisar, então a tela precisa mostrar 'última sincronização'.
- **Fontes:** https://developers.google.com/google-ads/scripts/docs/features/third-party-apis · https://developers.google.com/google-ads/scripts/docs/limits · https://developers.google.com/google-ads/scripts/docs/concepts/reports · https://nilsrooijmans.com/google-ads-scripts-faq/can-you-run-a-google-ads-script-multiple-times-per-hour/ · https://support.google.com/google-ads/answer/2544985

#### Gasto Google — B: Google Ads API no modelo novo (sem developer token)

- **Como funciona:** Desde 09/09/2026 o developer token é opcional e ignorado; o nível de acesso vem do projeto do Google Cloud cujo OAuth é usado. Não precisa mais de MCC. O xcart chama o GoogleAdsService.search com GAQL (cost_micros por dia e campanha) a cada 10–15 min, como já faz com o Meta.
- **Requisitos:** Projeto no Cloud com a Google Ads API ativada (começa no nível Test, que só acessa contas de teste). Pedir o Explorer no Console ('Google may automatically upgrade'). Tela de consentimento OAuth publicada como 'In production', porque em 'Testing' com usuário externo o refresh token expira em 7 dias. Client OAuth e autorização do Arthur. Brand verification só é exigida para Basic/Standard.
- **Limites:** Explorer: 2.880 operações/dia em contas reais, numa janela móvel de 24h. Cada consulta conta como 1 operação, com ou sem paginação. 3 contas a cada 10 min = 432/dia.
- **Prós:** Custo zero. Mesmo modelo do Meta, frequência de 10 min, conta nova sem colar script.
- **Contras:** Aprovação do Explorer não garantida e sem prazo. OAuth com escopo do Ads pode mostrar aviso de app não verificado (não verificado). O dado do Google atrasa até ~3h de qualquer forma.
- **Fontes:** https://developers.google.com/google-ads/api/docs/first-call/dev-token · https://developers.google.com/google-ads/api/docs/api-policy/access-levels · https://developers.google.com/google-ads/api/docs/best-practices/quotas · https://developers.google.com/identity/protocols/oauth2 · https://ppc.land/google-drops-developer-tokens-from-ads-api-access-decisions/ · https://developers.google.com/google-ads/api/reference/rpc/v25/Customer

#### Gasto Google — C: BigQuery Data Transfer Service

- **Como funciona:** Transferência gerenciada do Google Ads para o BigQuery, com janela de releitura configurável de 1 a 30 dias. O xcart leria do BigQuery.
- **Requisitos:** Projeto GCP com BigQuery e faturamento. Não confirmei na documentação oficial se exige developer token: a página não renderizou no fetch.
- **Limites:** US$2,50 por Customer ID por mês (fonte terceira, não verificado na página de preços do Google).
- **Prós:** Gerenciado e com histórico.
- **Contras:** Cadência diária. Mais peças (BigQuery + leitura). Custo por conta.
- **Fontes:** https://docs.cloud.google.com/bigquery/docs/google-ads-transfer · https://petri.com/google-announces-general-availability-bigquery-data-transfer-service/

#### Gasto Google — D: CSV manual

- **Como funciona:** O Arthur exporta do Google Ads o relatório de custo diário por campanha e sobe na tela do xcart.
- **Requisitos:** Uma tela de importação.
- **Limites:** —
- **Prós:** Zero integração; serve de reserva para qualquer plataforma.
- **Contras:** Manual e atrasado; não responde 'hoje'.
- **Fontes:** https://support.google.com/google-ads/answer/2544985

#### Gasto Meta — Marketing API Insights (via System User)

- **Como funciona:** GET /act_{id}/insights com level=campaign, fields=campaign_id,campaign_name,spend,impressions,clicks, time_increment=1 e time_range {since, until}. Os dias seguem o fuso da conta (AdAccount.timezone_name) e os valores vêm na moeda da conta (AdAccount.currency). Os insights atualizam a cada 15 minutos e não mudam depois de 28 dias. Espaçar as consultas e acompanhar o cabeçalho x-fb-ads-insights-throttle.
- **Requisitos:** Token de System User do BM com ads_read nas contas. Para contas próprias basta o acesso Standard/Limited, sem App Review (trecho de busca da página de acesso). Versão atual do Graph: v25.0.
- **Limites:** Limite de taxa dos insights (cabeçalho de throttle); time_increment de 1 a 90.
- **Prós:** O xcart já fala com o Meta (CAPI). Cron a cada 15 min, releitura de 7 dias por noite.
- **Contras:** Não dá para converter o fuso (os dados vêm agregados por dia).
- **Fontes:** https://developers.facebook.com/docs/marketing-api/insights/best-practices · https://developers.facebook.com/docs/marketing-api/reference/ad-account/ · https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights · https://developers.facebook.com/docs/marketing-api/access/

### Detalhes técnicos

A. O QUE JÁ EXISTE NO REPO (só li, não editei)
- C:\Onedrive\shopify-creator\src\lib\shopify\orders.ts: getOrdersSummary consulta a Shopify ao vivo com `created_at:>=… AND financial_status:paid` e soma currentTotalPriceSet.shopMoney (reembolso e edição já aplicados na data do pedido). Limite de 60 dias do read_orders documentado no próprio arquivo.
- C:\Onedrive\shopify-creator\src\lib\sales\cambio.ts: tabela FIXA de câmbio para BRL, ajustável por env FX_BRL_RATES. Moeda desconhecida fica fora da soma.
- C:\Onedrive\shopify-creator\src\app\(dashboard)\sales\sales-screen.tsx e src\lib\sales\types.ts: tela de Vendas por loja, períodos 7/30/60.
- C:\Onedrive\shopify-creator\supabase\migrations\035_tracking_server_side.sql: tracking_events é fila de saída, apagada depois de 90 dias. NÃO serve como fonte de receita.
- C:\Onedrive\shopify-creator\src\app\api\shopify\webhooks\route.ts e src\app\api\shopify\auth\route.ts: só ORDERS_CREATE é inscrito. Não há coluna de fuso nas lojas nem tabela de gasto de anúncio.

B. MODELO DE DADOS DO MVP (proposta)
- store_orders: store_id, shopify_order_id (único por loja), created_at (UTC), dia_loja (date no shop.ianaTimezone), moeda_loja, receita (currentTotalPrice − currentTotalTax), imposto, frete_cobrado, reembolsado, cancelado_em, gateway, taxas_reais (soma de OrderTransaction.fees, quando houver), atualizado_em.
- store_order_lines: order_id, sku, variant_id, quantidade_atual (líquida de remoção/devolução), preço.
- sku_costs: store_id, sku, custo_unit, moeda, vale_desde (date). O custo de um pedido é a linha com o maior vale_desde ≤ dia_loja. A loja também guarda uma margem padrão % (quando o SKU não tem custo) e, para gateway que não é Shopify Payments, taxa % + taxa fixa.
- ad_accounts: plataforma ('meta'|'google'), external_id (act_… / customer id XXX-XXX-XXXX, que NÃO é o AW-…), store_id, moeda, fuso, filtro_campanha (nulo = conta toda), segredo_hash (só Google via script), ultimo_sync_em.
- ad_spend_daily: ad_account_id, dia (fuso da CONTA), campaign_id, campaign_name, gasto (decimal na moeda da conta), cliques, impressões, sincronizado_em. Chave única (ad_account_id, dia, campaign_id). É o mesmo grão do fivetran/dbt_ad_reporting.
- fx_rates: dia, moeda, brl_por_unidade, fonte ('ptax'|'fixo').
RLS por dono da loja, como nas outras tabelas. Como em 027/030, função SECURITY DEFINER revogada de public/anon/authenticated, e policy com WITH CHECK.

C. SHOPIFY (Admin GraphQL 2024-10, escopo read_orders já usado)
- Webhooks que existem na 2024-10: ORDERS_CREATE, ORDERS_UPDATED, ORDERS_PAID, ORDERS_CANCELLED, REFUNDS_CREATE (read_orders). Com ORDERS_UPDATED basta para reembolso, edição e cancelamento. Um cron noturno de reconciliação relê os pedidos dos últimos 7 dias.
- Taxa real: OrderTransaction.fees: [TransactionFee] (amount, flatFee, rate, type, taxAmount), "Only present for Shopify Payments transactions". Em qualquer outro gateway, usar % + fixo configurado. Não verifiquei se a taxa de conversão de moeda da Shopify Payments (loja USD, cliente pagando EUR) aparece como fee.
- Fuso e moeda da loja: Shop.ianaTimezone e Shop.currencyCode.
- Custo: a API só tem InventoryItem.unitCost ATUAL, sem histórico por item de pedido. Daí a tabela sku_costs com vale_desde. O botão "copiar custo da Shopify" pode semear o custo a partir do unitCost.
- Campos do pedido a buscar: createdAt, cancelledAt, displayFinancialStatus, currentTotalPriceSet, currentTotalTaxSet, transactions{gateway, fees{amount{amount currencyCode}}}, lineItems{sku quantity currentQuantity variant{id}}. Os nomes currentTotalTaxSet e currentQuantity precisam ser conferidos no schema 2024-10 antes de codar (não verificado nesta pesquisa).

D. FÓRMULAS (moeda da loja; converter para BRL só na visão de todas as lojas)
- Receita = Σ (currentTotalPrice − currentTotalTax) dos pedidos não cancelados e pagos, por dia_loja. Lifetimely e BeProfit tiram o imposto; o TrueProfit põe na receita e subtrai depois; o Triple Whale trata como custo.
- COGS = Σ quantidade_atual × custo(sku, dia_loja). TrueProfit e Triple Whale descontam o custo das unidades devolvidas.
- Taxas = Σ taxas_reais, ou Receita × % + pedidos × fixo.
- CM2 = Receita − COGS − Taxas (frete do fornecedor já dentro do custo).
- Ads = Σ gasto × câmbio(moeda da conta → moeda da loja).
- Lucro (CM3) = CM2 − Ads.
- Margem = Lucro ÷ Receita.
- ROAS real = Receita ÷ Ads. TrueProfit chama de "Blended ROAS"; Lifetimely de "ROAS (Blended)".
- ROAS de equilíbrio = Receita ÷ CM2 = 1 ÷ margem CM2 (Polar).
- POAS = CM2 ÷ Ads (TrueProfit usa Gross Profit ÷ Ad Spend; > 1 significa lucro).
- CPA = Ads ÷ Pedidos. Lucro por pedido = Lucro ÷ Pedidos (TrueProfit: Ad Spend per Order, Average Order Profit).
- Cobertura de custo = receita de linhas com custo ÷ receita (padrão net_sales_without_cost_recorded do ShopifyQL).
- Depois: Lucro líquido = Lucro − custos fixos rateados por dia (BeProfit: Net Profit = Contribution Profit − Operating Expenses; Lifetimely tem custos recorrentes com frequência); CAC = Ads ÷ clientes novos; aMER = receita de clientes novos ÷ Ads.

E. META (cron */15 hoje e ontem + noturno com 7 dias)
GET https://graph.facebook.com/v25.0/act_{ID}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_increment=1&time_range={"since":"AAAA-MM-DD","until":"AAAA-MM-DD"}&access_token=…
- Ler AdAccount.currency e timezone_name uma vez e guardar em ad_accounts.
- "Insights refresh every 15 minutes and do not change after 28 days". Para gasto, 7 dias de releitura bastam; para guardar conversões da plataforma, seriam 28 (o Airbyte usa 28 por padrão).
- Espaçar as chamadas e respeitar x-fb-ads-insights-throttle.

F. GOOGLE VIA SCRIPT (um por conta, agendado de hora em hora)
```js
var URL = 'https://user.xcart.app/api/ads/google/ingest'; // endpoint novo
var SEGREDO = 'colar-o-segredo-gerado-no-xcart';
function main() {
  var conta = AdsApp.currentAccount();
  var tz = conta.getTimeZone();
  var fim = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var ini = Utilities.formatDate(new Date(Date.now() - 7 * 864e5), tz, 'yyyy-MM-dd');
  var it = AdsApp.search("SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '" + ini + "' AND '" + fim + "'");
  var linhas = [];
  while (it.hasNext()) { var r = it.next(); linhas.push({ dia: r.segments.date, campanha: r.campaign.id, nome: r.campaign.name, cost_micros: r.metrics.costMicros, cliques: r.metrics.clicks, impressoes: r.metrics.impressions }); }
  UrlFetchApp.fetch(URL, { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + SEGREDO }, payload: JSON.stringify({ customer_id: conta.getCustomerId(), moeda: conta.getCurrencyCode(), fuso: tz, linhas: linhas }), muteHttpExceptions: true });
}
```
- Confirmados nas fontes: UrlFetchApp POST JSON, AdsApp.search com GAQL, metrics.cost_micros, segments.date. NÃO verificados aqui: getTimeZone(), getCurrencyCode(), getCustomerId() e se costMicros vem como string. Conferir na referência do AdsApp antes de colar.
- Gasto = cost_micros ÷ 1.000.000. Campanha com gasto zero pode não aparecer.
- O endpoint recebe VALOR MONETÁRIO. Então: segredo por conta (guardado só o hash), customer_id precisa bater com o segredo, limite de linhas e de datas (no máximo 31 dias para trás), e grava por cima. Isso é o oposto de /api/tracking/collect, que é público e por isso recusa valor (CLAUDE.md).
- Em customer.time_zone e currency_code o Google marca como imutáveis.

G. CÂMBIO
- PTAX/BCB por OData: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/ (conjunto "Taxas de câmbio – todos os boletins diários"). Rodar 1 vez por dia; em fim de semana ou feriado, usar o último dia útil. Se a moeda faltar, cair no cambio.ts.
- Converter gasto e receita pela cotação do DIA (como o Lifetimely faz com o pedido). O Triple Whale usa a média do período (OANDA); o TrueProfit atualiza diariamente pela openexchangerates.

H. FUSO
- Receita agrupada por dia no fuso da loja; gasto pelo dia da conta. Se os fusos diferem, o dia a dia desalinha em horas, mas 7 e 30 dias quase batem. Mostrar aviso na tela. O Profit Calc documenta que não dá para corrigir pela API (a requisição é só por data); a Fivetran recomenda padronizar as contas.

I. PADRÕES DE UX COPIADOS
- Período pré-definido + personalizado, comparado com o período anterior: Shopify Analytics, WeTracked Pulse, ShopifyQL `COMPARE TO previous_period`.
- Cards KPI com variação %, tabela de lojas com linha de total no topo (Triple Whale Pods), troca "todas as lojas / uma loja" (TrueProfit), cores verde/amarelo/vermelho por limite (WeTracked), e clique da loja para o dia a dia.

J. ARMADILHAS DE NOMENCLATURA
- MER: o Triple Whale define como gasto ÷ receita; Northbeam e Polar como receita ÷ gasto. Rotular como "ROAS real".
- Reembolso: o Triple Whale lança na data do reembolso, a Shopify ajusta para a data da compra. O MVP usa os totais atuais na data do pedido (igual à tela de Vendas de hoje).

### Riscos

1) Câmbio: se a receita está em USD/EUR e o gasto da conta de anúncio está em BRL, um câmbio fixo errado em 5% pode mostrar lucro onde há prejuízo quando a margem é baixa. Por isso a cotação diária (PTAX) entra no MVP.
2) Fuso: o gasto vem pelo dia da conta de anúncio, e isso não tem conserto via API. Conta do Google não muda fuso nem moeda depois de criada. Ao criar conta nova, usar o mesmo fuso da loja.
3) Custo faltando: SKU sem custo infla o lucro. Mitigação: margem padrão por loja e aviso "X% da receita sem custo".
4) read_orders só dá 60 dias: a carga inicial fica limitada, e o histórico só passa disso a partir do dia em que a gravação começar.
5) Webhook perdido: sem orders/updated e sem a reconciliação noturna, reembolso e cancelamento não aparecem e o lucro fica alto demais.
6) O script do Google falha sem avisar (token, mudança de API, script pausado). É preciso mostrar "última sincronização" por conta e alertar se passar de algumas horas. Ele só roda de hora em hora.
7) O endpoint que recebe o gasto do Google aceita valor monetário. Sem autenticação por conta, qualquer um pode inflar ou zerar o gasto de uma loja. É o mesmo princípio do CLAUDE.md sobre /api/tracking/collect, só que ao contrário: aqui o valor é aceito, então a autenticação é obrigatória.
8) Google Ads API no modelo novo: o Explorer pode não ser aprovado; OAuth em 'Testing' derruba o refresh token em 7 dias; a regra é recente (09/09/2026) e pode mudar de novo. O Google diz que vai rejeitar o developer token "em versão futura".
9) Gasto e conversão mudam para trás: Meta até 28 dias, Google com estorno de clique inválido dias depois. Sem reprocessar, o número de ontem fica errado.
10) Uma conta de anúncio para duas lojas: separar pelo nome da campanha é frágil (o TrueProfit permite só 1 filtro por conta). O melhor é uma conta por loja.
11) Taxas: o valor real só existe para Shopify Payments. Em outro gateway vale o % configurado, que pode estar desatualizado. Não verifiquei se a taxa de conversão de moeda da Shopify Payments (loja USD com cliente em EUR) vem nos fees.
12) Imposto: se a Lash Bestie cobra VAT, a receita precisa excluir o imposto, senão o ROAS fica inflado.
13) Fontes fracas, marcadas como não verificadas: glossário do BeProfit (só trecho de busca, página dá 404), KB do Triple Whale (403, só trecho), cadência de 1h + 30 dias da ProfitMetrics (só trecho), preços do Northbeam e do BigQuery DTS (o do Northbeam conferido na página oficial, o do DTS só em terceiro), agendamento de hora em hora do Google Ads Script (fonte terceira), refresh da Polar (página de preços diz diário + intraday pago).
14) Escopo: o menu de 4 grupos da outra IA pede de 5 a 10 vezes mais trabalho que o MVP. Atribuição e jornada dependem do click id, que o roteamento perde (CLAUDE.md), embora no tráfego direto da operação atual isso não se aplique.

### O que só o Arthur pode fazer

1) Decidir: MVP próprio no xcart (recomendado) ou assinar o TrueProfit em cada loja (US$35 a US$200 por loja por mês).

2) Mandar a lista de contas de anúncio por loja:
- Meta: o ID da conta (act_XXXXXXXX) de cada loja ativa.
- Google: o ID de CLIENTE de cada conta, no formato XXX-XXX-XXXX, que aparece no topo do Google Ads. NÃO é o AW-18463833677, AW-18463882690 nem AW-18419000686: esses são IDs de conversão da tag. São 2 contas na Softnook e 1 na Lash Bestie.
- Dizer se alguma conta de anúncio é usada por mais de uma loja.

3) Conferir a moeda e o fuso de cada conta:
- Meta: Gerenciador de Negócios > Configurações > Contas de anúncios > a conta > Informações.
- Google: Admin > Configurações da conta.
Comparar com o fuso e a moeda de cada loja (Shopify > Configurações > Geral). Se diferirem, anotar: no Google não muda depois de criada.

4) Meta: no Gerenciador de Negócios, confirmar que o usuário do sistema usado no CAPI tem acesso às contas de anúncio com permissão de ver desempenho, e que o token tem ads_read. Se não tiver, gerar um token novo com ads_read e colar no xcart, você mesmo.

5) Google (caminho do script), em cada uma das 3 contas:
- Google Ads > Ferramentas > Ações em massa > Scripts > + Novo script.
- Colar o script que o xcart vai fornecer, com o segredo dessa conta, que aparece na tela de vínculo do xcart.
- Clicar em Autorizar e depois Visualizar para testar.
- Salvar, em Frequência escolher "A cada hora", e confirmar.

6) Google (alternativa pela API, só se preferir em vez do script):
- No Google Cloud Console, criar o projeto e ativar a "Google Ads API".
- Em Ads API, pedir o nível Explorer.
- Configurar a tela de consentimento OAuth e PUBLICAR em produção, para o token não expirar em 7 dias.
- Criar o client OAuth e autorizar com o login que administra as 3 contas.

7) Custos:
- Mandar uma planilha por loja com as colunas sku, custo_unitario (produto + frete do fornecedor), moeda e vale_desde (AAAA-MM-DD). Ou dizer uma margem padrão por loja para começar.
- Dizer qual gateway cada loja usa: se não for Shopify Payments, informar a taxa % e a taxa fixa por transação.

8) Dizer se alguma loja cobra imposto (VAT/IVA) do cliente, para tirar da receita.

9) Escolher os limites das cores. Proposta: vermelho com lucro abaixo de zero; amarelo com ROAS real abaixo de 1,2× o ROAS de equilíbrio; verde acima disso.

---

## Mapa do código atual do xcart

**Resumo.** Mapeamento somente leitura do xcart (Next 16.3.4, React 19.2.4, Supabase, Tailwind v4 com shadcn sobre @base-ui/react). Hoje o painel e todo pensado para o roteamento vitrine -> checkout, que nao e o jeito que o Arthur opera.

O que achei:
(1) O menu e uma constante fixa em sidebar.tsx. O topo (top-nav.tsx) so mostra o titulo da pagina. NAO existe seletor de loja global: cada tela tem o filtro dela, guardado em useState.
(2) A Visao geral nao tem dado financeiro nenhum. Ela le so a PRIMEIRA rota do usuario; sem rota, mostra "Nada acontecendo ainda".
(3) Vendas e a unica tela financeira do usuario. Ela pergunta a Shopify na hora, loja por loja, e so conta lojas que sao destino de rota. Pelo codigo, as lojas de trafego direto (Lash Bestie e Softnook) nao entram; nao conferi isso no banco.
(4) Vendas tem tres problemas que pesam para a parte financeira:
   - soma centavos de moedas diferentes e formata cada linha com a moeda global;
   - o filtro financial_status:paid joga fora pedido parcialmente reembolsado;
   - a janela e "agora menos N dias" em UTC, sem o fuso da loja.
(5) Nao existe tabela de pedidos, custo, gasto de anuncio, cambio ou fuso. O webhook orders/create so vira linhas em tracking_events (uma por destino, e so quando algum destino aceita a compra).
(6) Os padroes que valem copiar ja existem:
   - page.tsx no servidor + componente *-screen.tsx no cliente;
   - lib/*/queries.ts com server-only + types.ts separado para o cliente;
   - logica pura num arquivo proprio, testada com vitest;
   - segredo em tabela propria, com RLS ligada e nenhuma policy;
   - RPC agregadora SECURITY INVOKER lida pelo cliente do usuario;
   - cron com CRON_SECRET.
(7) A versao da Shopify fixada no codigo (2024-10) ja foi aposentada. A Shopify atende com a versao acessivel mais antiga (fonte: https://shopify.dev/docs/api/usage/versioning).

**Navegação atual.** MENU LATERAL (src/components/layout/sidebar.tsx, NAV fixo, rotulos em textos('nav')):
- Grupo sem cabecalho:
  - Configuracao (/setup)
  - Visao geral (/overview)
- Grupo 'Operacoes':
  - Lojas conectadas (/stores, contador de lojas)
  - Vendas (/sales)
  - Rastreamento (/tracking)
  - Roteamento (/clone/routed-checkout)
  - Importar produtos (/clone/shopify)
- Grupo sem cabecalho:
  - Atividade (/activity)
  - Assinatura e creditos (/billing, contador de creditos)
  - Claude (MCP) (/claude)
- Cabecalho da sidebar: logo que leva a /overview e o texto 'N lojas conectadas'.
- Rodape: medidor de progresso que leva a /setup (some em 100%), dropdown do usuario (email, Sair via POST /api/auth/logout) e ThemeToggle.
- Item ativo: pathname === href ou startsWith(href + '/').
- Menu mobile (barra de baixo): Roteamento, Lojas, Importar, Visao geral. Nao tem Vendas nem Rastreamento.
- Chaves de nav em pt.json: setup, overview, theme, operations, importProducts, routing, shopify, connectedStores, sales, tracking, activity, account, billing, myAccount, logout, claude. shopify, account e myAccount nao sao usadas.

TOPO (top-nav.tsx): header fixo de 52px, a partir de md:left-[216px], fundo var(--header-bg) com blur. So mostra o titulo da pagina, tirado da TRILHA, que e uma lista paralela ao NAV e precisa ser atualizada junto. Nao tem breadcrumb, acoes, busca nem seletor. Sem titulo em /activity, /bulk e /multi-site.

SELETOR DE LOJA GLOBAL: NAO EXISTE. Cada tela resolve sozinha:
- Vendas: chips 'Todas as lojas' + uma por loja, em useState (nao vai para a URL); o periodo vai na URL (?periodo=).
- Rastreamento: chips ate 6 lojas e Select (@base-ui) acima disso, em useState('todas').
- Importacao (clone, bulk, multi-site): seletor proprio alimentado por getPickerStores() no servidor.

ROTAS FORA DO MENU:
- /bulk e /multi-site: nada no codigo aponta para elas.
- /clone/shopify/{bulk,individual,configuracao}: reexportam a mesma CloneScreen; o modo sai do pathname.
- /clone/routed-checkout/{active-routes,create-destination,create-route,map,neutralize,script}: so redirect() para /clone/routed-checkout, mantidos para link antigo.
- src/app/[locale]/**: pastas vazias (0 arquivos), sobra da era i18n.

HOME: APP_HOME='/overview' (src/lib/app-home.ts), usado pelo middleware depois do login e pela saida do paywall.

ADMIN: o host adm.* tem o proprio layout e menu (src/app/admin/admin-nav.tsx: Visao geral, Usuarios, Faturamento, Uso & Custos). /admin no host user.* redireciona para APP_HOME.

LAYOUT: sidebar de 216px fixa, conteudo max-w-[1240px] com px-4/sm:px-6, pt-[22px] e pb-[72px].

**Telas existentes.** OVERVIEW (/overview, server, force-dynamic)
- Fonte: getOverview(), que e 100% roteamento e so le a PRIMEIRA rota (routed_checkout_configs ordenada por created_at, [0]).
- Sem rota: tela vazia 'Nada acontecendo ainda' com CTA para /setup.
- Com rota, mostra:
  - faixa de alerta;
  - 4 numeros: Lojas (vitrine/checkout), Lojas cobrando, Produtos ligados por SKU, Problemas;
  - 'Sua operacao': vitrine -> XCART -> destinos, com estado e barra de % do rodizio;
  - 'Requer atencao': destino sem mapa, ultimo heal com falha, ninguem cobrando, falhas de rotear;
  - 'Atividade recente': 8 eventos de routed_checkout_fallbacks.
- ZERO dado financeiro.
- Na operacao direta do Arthur (sem vitrine) ela nao representa Lash Bestie nem Softnook (inferido do codigo, nao conferi no banco).

VENDAS (/sales)
- page.tsx (server) faz await de searchParams, valida o periodo 7/30/60 (padrao 30) e usa Suspense com key=periodo. SalesScreen (client).
- Dados: getSales(). So lojas de checkout que sao DESTINO de alguma rota (getRouteGraph), uma linha por LOJA (nao por rota).
- Para cada loja pergunta a Shopify na hora (getOrdersSummary): pedidos pagos (financial_status:paid) desde agora-N dias, sem test/cancelled, soma de currentTotalPriceSet.shopMoney. Teto de 5000 pedidos por loja e de 60 dias (read_orders).
- Mostra:
  - chips de periodo;
  - aviso de loja 'denied' (conectada antes do read_orders; o conserto e reconectar);
  - chips de loja;
  - 4 paineis: Faturamento total (abreviado em 'mil'/'mi'), Pedidos, Ticket medio, Loja lider (ou a versao por loja);
  - tabela 'Por loja de checkout': Loja/dominio/vitrines, Conexao (Ativo/Pausado/Atencao), Pedidos, Receita, '% do trafego' (barra = receita relativa a maior; numero = peso do rodizio por repartirCem);
  - linha Total com 100%;
  - nota dos 60 dias.
- A 'reparticao de 100%' (src/lib/sales/share.ts, maior resto) vale para a fatia de receita (sharePercent) e de trafego (trafficPercent). Testada.
- Problemas:
  - soma centavos de moedas diferentes;
  - currency = a moeda da primeira linha com receita, e todas as linhas sao formatadas com ela (row.currency e ignorada);
  - pedido partially_refunded e refunded fica de fora inteiro. A doc lista esses status como valores separados de 'paid' (https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), mas a nota da tela diz 'ja com reembolso descontado';
  - janela movel em UTC, sem fuso da loja e sem serie diaria;
  - sem custo, gasto, lucro ou ROAS;
  - sem rota a tela mostra 'Nenhuma venda registrada ainda'.

FATURAMENTO ADMIN (/admin/faturamento, host adm.)
- Mesma fonte por loja, todos os usuarios, service role.
- Converte para BRL pela tabela fixa de cambio.ts (env FX_BRL_RATES).
- Separa conta 'cega' (nenhuma loja respondeu) de venda zerada.

RASTREAMENTO (/tracking)
- h1 fora do Suspense. Dentro: getPainelTracking() (fila em tracking_events, ultimos 7 dias, pela RPC tracking_painel) + diagnosticar() (Shopify: pedidos de 7 dias com a mesma regra do webhook, webhook orders/create, snippet no tema, tag de remarketing).
- KPIs: Lojas rastreando, Pedidos (7d), Vendas enviadas (o MAIOR valor entre os destinos, nao a soma), Precisam de voce.
- Filtro de loja e CardLoja por loja:
  - saude parado/atencao/ok/desligado, com motivos;
  - 'Compras chegando' por destino (chegaram/esperados, pedido a pedido);
  - Atribuicao (compras sem gclid/fbc);
  - checklist: webhook, snippet, pixel do checkout;
  - configuracao de destinos (destinos-ui.tsx, PainelPlataforma).
- Ja cobre boa parte do que a proposta chama de 'Diagnostico de pixels' e 'Atribuicao'.

LOJAS (/stores)
- Server com try/catch: falha de banco aparece como erro, nunca como 'nenhuma loja'.
- StoresScreen (client): secoes 'Vitrines' e 'Lojas de checkout' (loja sem papel cai aqui), conectar, editar perfil, materiais.

ATIVIDADE (/activity)
- Server. Lista eventos de stores, routed_checkout_configs, clone_runs, targets e fallbacks, com 'Detalhes tecnicos'.

CONFIGURACAO (/setup)
- 7 passos derivados do banco, todos de roteamento (vitrine, checkout, produtos, ligados, rota, teste, ativo).

ASSINATURA (/billing)
- Pagina inteira 'use client' que busca /api/billing/*. Usa Card e Badge no estilo antigo e textos('billing').
- E a assinatura do xcart, NAO financas da loja.

CLAUDE (/claude)
- Client. Gerencia tokens MCP. Ferramentas MCP: list_stores, store_overview, search_products, get_product, update_product, verify_page, shopify_query.

ROTEAMENTO (/clone/routed-checkout)
- Server com getRouteGraph, entregue a RoutedCheckoutScreen.

IMPORTAR (/clone/shopify)
- CloneScreen + import-wizard.

O QUE JA E FINANCEIRO HOJE
- So Vendas (faturamento, pedidos, ticket, lider, fatia de receita x fatia do rodizio) e, no admin, Faturamento e 'Uso & Custos' (ai_usage_log.cost_usd, que e custo do proprio xcart).
- Nao ha lucro, CMV, gasto em anuncio, ROAS nem serie temporal.

**Dados existentes.** MIGRATIONS
- Existem de 001 a 051; a proxima livre e 052.
- O CLAUDE.md diz 001-031 e o ARCHITECTURE.md §5 lista so ate 018 (nao tem as tabelas de rastreamento). Os dois estao desatualizados.

TABELAS RELEVANTES

stores
- id, user_id, shop_domain (unico por usuario), name.
- O nome no banco e velho (memoria do Arthur): identificar loja pelo dominio myshopify.
- client_id, client_secret, access_token.
- currency_code (DEFAULT 'USD'): ajuste de preco da importacao, junto com auto_convert_prices, currency_rate e price_markup_percent (migration 006). Nao e a moeda real da loja na Shopify.
- target_language, perfil (niche etc.), product_count, variant_count, catalog_synced_at (026), uninstalled_at (033).
- NAO tem fuso horario nem moeda da loja vinda da Shopify.

Roteamento
- routed_checkout_configs: rota, rotation, enabled, source_store_id, target_store_id (legado).
- routed_checkout_targets: weight, enabled, sku_map, variant_map, last_healed_at, healing_since.
- routed_checkout_fallbacks: telemetria do loader, com retencao (028).

Rastreamento
- tracking_configs: store_id PK, user_id, enabled, web_pixel_visto_em, web_pixel_com_id_em, teto_atingido_em, mais colunas legadas do Google e do Meta.
- tracking_destinations: id, store_id, user_id, plataforma google|meta, nome, conta (AW- ou id do pixel), labels jsonb, test_event_code, id_template, ativo. Unico por (store, plataforma, conta). Leitura pelo dono; escrita revogada do authenticated (048).
- tracking_destination_secrets: destination_id, access_token. RLS sem policy e tudo revogado.
- tracking_secrets: legado.
- tracking_identities: so service role, 90 dias. Click ids, fbp/fbc, hashes de e-mail e telefone, IP e UA, visitor_id, shopify_client_id, auid, referrer.
- tracking_checkouts: so service role. Ponte checkout_token -> clientId.
- tracking_events: a fila. store_id, destination, destination_id, event_name, event_id, order_id, payload jsonb (value e currency do pedido em moeda DA LOJA, content_ids, gclid/gbraid/wbraid ou user_data.fbc), status pendente|enviado|falhou, attempts, last_error, response, sent_at, created_at.
  - O dono so le (RLS). Unica em (store_id, destination_id, event_id).
  - Retencao: enviado 90 dias; falhou e pendente 30 dias.
  - Uma linha POR DESTINO, e so existe se algum destino aceitou o evento. Por isso NAO serve como tabela de pedidos.
- RPC tracking_painel(p_store_ids uuid[], p_desde timestamptz): SECURITY INVOKER, devolve (store, destination_id, evento, status) com n, n_sem_atribuicao, ultimo_envio, ultimo_erro e order_ids.
- shopify_webhook_events: idempotencia.

Outras
- profiles: plan, is_admin, ai_credits, assinatura.
- ai_usage_log (cost_usd, credits_used), credit_purchases, payment_events, mcp_tokens, background_jobs, clone_runs.
- products: espelho da importacao (price, status). Nao e o catalogo da Shopify.
- app_secrets: chave/valor global, so service role.

O QUE NAO EXISTE
- Tabela de pedidos ou itens de pedido.
- Custo por SKU ou CMV.
- Conta de anuncio, gasto de anuncio, cambio guardado, fuso por loja ou conta.
- Alertas e Telegram.

WEBHOOKS
- Inscritos so ORDERS_CREATE (na instalacao, api/shopify/auth) e APP_UNINSTALLED. Nao ha orders/updated, refunds/create nem orders/cancelled.
- O payload de orders/create e processado e descartado.

MOEDA
- Purchase e conversao Google mandam value=total_price e currency=pedido.currency. Na API REST os dois sao da moeda da loja (https://shopify.dev/docs/api/admin-rest/latest/resources/order).
- Na GraphQL, Order.currencyCode e a moeda da loja; presentmentCurrencyCode e a do cliente; currentTotalPriceSet vem nas duas moedas, ja descontadas devolucoes; existe totalRefundedSet (https://shopify.dev/docs/api/admin-graphql/latest/objects/Order).
- Na Lash Bestie (loja em USD, cliente pagando EUR), Vendas e conversoes saem em USD (inferido).

CAMBIO
- src/lib/sales/cambio.ts: tabela fixa para BRL (USD 5.4, EUR 5.85...), sobrescrita por FX_BRL_RATES. So o admin usa.

FONTES VIVAS NA SHOPIFY
- read_orders cobre os ultimos 60 dias; read_all_orders exige aprovacao da Shopify (https://shopify.dev/docs/api/usage/access-scopes). O app NAO pede read_all_orders.
- InventoryItem.unitCost e o custo unitario, na moeda da loja. Exige read_inventory ou read_products, e com permissao granular ligada o usuario precisa de 'View product costs' (https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryItem). O app pede read_products.
- Leitura de unitCost por este app: nao verificado.

CONSEQUENCIA PARA O FINANCEIRO
- Historico acima de 60 dias, 'custo congelado no pedido' e reprocessamento exigem persistir pedidos.
- Isso contraria uma decisao escrita no codigo ('copiar o pedido criaria uma segunda verdade', em sales/queries.ts e sales/admin.ts). E uma decisao a tomar explicitamente.

**Padrões.** AUTH E QUERIES
- Pagina e lib: getCurrentUser() (React cache) + createClient() do usuario, com RLS. Mesmo assim filtra user_id quando faz sentido.
- createAdminClient() (service role) so no servidor, para:
  - segredos;
  - leituras de todos os usuarios no admin;
  - webhooks e cron;
  - escritas que o authenticated nao pode fazer (tracking_destinations).
- Regra escrita em tracking/queries.ts: agregado da fila e lido pelo cliente do USUARIO, porque a RPC e SECURITY INVOKER e a RLS vale la dentro. NUNCA pelo admin com ids vindos do usuario.
- Dono da loja: src/lib/stores/authorize.ts (userId da sessao, nunca do body; 401 ou 404).
- O proxy NAO autentica /api: cada route handler faz o proprio getUser e devolve 401.
- Admin: profiles.is_admin, lido pelo admin client.

SEGREDOS
- Tabela separada (tracking_destination_secrets) com RLS ligada, ZERO policy e 'revoke all ... from public, anon, authenticated'.
- Leitura so com comToken no servidor; o navegador recebe so 'temToken'.
- Erro ao ler segredo lanca, nunca vira 'sem token'.
- Credencial nova (token de API de anuncio, refresh token do Google) deve seguir esse padrao. Tambem existe app_secrets para segredo global.

MIGRATIONS
- Cabecalho em portugues explicando o porque.
- user_id denormalizado; policy 'using ((select auth.uid()) = user_id) with check (... and exists(stores do dono))'; gatilho de dono tracking_config_dono().
- Funcao SECURITY DEFINER: revoke de public, anon e authenticated, grant a service_role, conferir com has_function_privilege (027).
- Indices para FK (030).
- RPC de painel: SECURITY INVOKER, stable, grant authenticated, revoke anon (049/051), lida com .order() total e paginada de 1000 em 1000.

ESTRUTURA DE TELA NOVA (modelo de sales e tracking)
- src/app/(dashboard)/<rota>/page.tsx: server, 'export const dynamic = "force-dynamic"'.
  - searchParams e Promise e precisa de await; validar contra lista branca, como periodoValido().
  - Cabecalho fora do Suspense; chamada lenta (Shopify) dentro de <Suspense key={param} fallback={Esqueleto}> com blocos parados.
  - Passa dados serializaveis para <rota>-screen.tsx ('use client').
- src/lib/<area>/queries.ts: 'import "server-only"', React cache.
- src/lib/<area>/types.ts: tipos e constantes, sem server-only, para o cliente importar.
- Regra pura em arquivo separado (como share.ts e saude.ts), importada so com 'import type' dos modulos de servidor.
- Erro de banco aparece na tela, nunca vira lista vazia (stores/page.tsx).
- Filtros na URL com router.push e o servidor refaz a busca. Mutacoes NAO usam Server Actions (nenhum 'use server' no repo): o cliente chama fetch em /api/*, mostra toast (sonner) e faz router.refresh().
- Item novo de menu exige mexer em tres lugares: NAV (sidebar.tsx), TRILHA (top-nav.tsx) e a chave em messages/pt.json nav. E conferir o MOBILE (indices).

DOC DO NEXT 16 (node_modules/next/dist/docs)
- params e searchParams so assincronos; o acesso sincrono foi removido (01-app/02-guides/upgrading/version-16.md).
- Layout nao rerenderiza e nao acessa searchParams. Para ler query no layout, usar useSearchParams num componente de cliente (01-app/03-api-reference/03-file-conventions/layout.md), recomendado dentro de Suspense (use-search-params.md).
- cookies() so grava em Server Function ou Route Handler, nunca durante a renderizacao (04-functions/cookies.md). Seletor de loja global por cookie exige route handler ou server action.
- dynamic, revalidate e fetchCache so somem com cacheComponents, que nao esta ligado: force-dynamic continua valendo (02-route-segment-config/index.md; 02-guides/caching-without-cache-components.md).
- Server Actions sao despachadas em sequencia e cada uma precisa autenticar e validar dentro (02-guides/server-actions.md).
- middleware virou proxy (proxy.md).
- Runtime edge esta deprecated (runtime.md). /api/c/[token] ainda usa runtime='edge'.

CRON E JOBS
- Entradas em vercel.json (crons + functions.maxDuration).
- Route handler com runtime='nodejs', maxDuration, GET e POST chamando executar().
- cronAutorizado(): 'authorization: Bearer ${CRON_SECRET}' ou x-cron-secret, com fallback para BULK_IMPORT_CRON_SECRET. A funcao esta copiada em cada arquivo, sem helper comum.
- Fora do cron: sessao + is_admin (drain) ou escopo do proprio usuario (heal).
- Lote limitado por ?limit com teto. Claim atomico em heal (healing_since, 034) e na fila de importacao (claimJob). O drain NAO tem claim.
- after() de next/server para trabalho em segundo plano depois da resposta.
- Vercel Pro: 100 crons, intervalo minimo de 1 minuto (https://vercel.com/docs/cron-jobs/usage-and-pricing). Manda Authorization Bearer CRON_SECRET, a entrega e best effort, pode duplicar ou pular e nao ha retry: o job precisa ser idempotente e ter trava (https://vercel.com/docs/cron-jobs/manage-cron-jobs).

DESIGN
- Tokens em src/app/globals.css, em :root e .dark (next-themes por classe, padrao claro, enableSystem=false):
  - fundos e bordas: --bg --surface --surface-2 --hover --track --nav-active --border (#e6e5e3) --border-subtle --border-strong --control-border;
  - texto: --ink e --t1 a --t5;
  - acao: --solid --solid-hover --on-solid;
  - marca: --brand (terracota #b04a2f, so marca e foco);
  - estado: --ok, --warn, --err, cada um com -bg e -border;
  - outros: --header-bg --scrim --shadow --vitrine --checkout --chart-1 a --chart-5.
- Usados como classes Tailwind (text-ink, text-t3, bg-surface, border-border) ou var(--x).
- Fontes: Public Sans (--font-sans); IBM Plex Mono (--font-mono) para numero, id e dominio, com tabular-nums.
- Escala:
  - h1: text-[26px] font-semibold tracking-[-0.02em];
  - secao: text-[12.5px] ou [13px] semibold;
  - rotulo: 11.5px em text-t3;
  - KPI: font-mono text-[22px] (overview e tracking) ou text-[21px] semibold (sales).
- Caixas: rounded-xl border border-border bg-surface; linhas com border-[var(--border-subtle)] e 44px; vazio com borda tracejada e CTA solid.
- Regras do HANDOFF.md: nenhum hex; estado sempre ponto + palavra; raio 6-8px; sem sombra fora de overlay.
- Componentes que existem:
  - Selo, Ponto, TagPlataforma, Aviso e TOM em tracking/selo.tsx: os melhores para reaproveitar.
  - KPI 'Numero' copiado em overview/page.tsx e tracking-screen.tsx; os 'paineis' de sales-screen.
  - Chip copiado em sales-screen e tracking-screen.
  - quando() copiado em tres lugares; dinheiro/dinheiroCurto em sales-screen; plural() em saude.ts.
  - Nao ha componente compartilhado de KPI ou card.
- shadcn sobre @base-ui/react, NAO Radix:
  - SelectValue precisa de children-funcao, senao mostra o uuid;
  - DropdownMenuLabel lanca erro fora de DropdownMenuGroup.
- Card, Badge e PageHeader sao do estilo antigo (billing, claude, admin); as telas novas usam div com tokens.
- Nao ha biblioteca de grafico no package.json (sem recharts).

TEXTOS
- textos(ns) com messages/pt.json; so nav, billing, stores, clone e login usam. Overview, sales, tracking, activity e setup escrevem o portugues direto no JSX.

TESTES
- vitest em ambiente node, tests/**/*.test.ts, alias @, fast-check para propriedade.
- Modulo de servidor: vi.mock('server-only', () => ({})) e mock do query builder do Supabase (tracking-painel.test.ts, store-ownership.test.ts).
- Testes de paridade leem arquivo do disco (rotation-parity, tracking-eventos, tracking-ponte-advertorial).
- Comandos: npm test, npm run typecheck, npm run typecheck:scripts. Scripts de operacao rodam com npm run op.

**Restrições.** RASTREAMENTO EM PRODUCAO (nao mexer sem teste e sem cuidado)
- /api/shopify/webhooks: ordem HMAC -> janela -> marcador de idempotencia. O marcador e apagado quando a resposta e 5xx; responde 200 quando repetir nao adianta.
- /api/tracking/collect: publico e NAO aceita valor monetario (CLAUDE.md).
- /api/jobs/tracking/drain (*/10, que tambem faz o expurgo de hora em hora).
- public/xcart-pixel.js, xcart-click.js e xcart-bridge.js; snippet-tema.ts; pixel-checkout.ts.
- Catalogo eventos.ts, travado por tests/tracking-eventos.test.ts e tracking-ponte-advertorial.test.ts.
- Indice unico (store_id, destination_id, event_id) e purge_tracking().
- RPC tracking_painel: mudar a assinatura quebra queries.ts e tracking-painel.test.ts.
- Nao ler tracking_events pelo admin com ids vindos do cliente.
- Nao mexer em tracking_destination_secrets nem expor token.
- Um 'Eventos em tempo real' novo deve LER, sem tocar no caminho de envio.

ROTEAMENTO, SKU E ROTA
- public/routed-checkout-loader.js e /api/checkout-routes/{resolve,track-fallback,[id]/embed-config,[id]/update-theme}.
- /api/c/[token] (ainda com runtime edge, que esta deprecated).
- rotation.ts com a paridade loader x servidor (tests/rotation-parity.test.ts).
- sku_map e variant_map; nunca mexer em variante ou SKU da loja de checkout.
- Mudar peso exige reenviar a config do tema.

NAVEGACAO
- APP_HOME='/overview' esta fixo (middleware depois do login, paywall, logo).
- Ha links fixos para /setup, /stores e /clone/routed-checkout em overview (issues), setup steps, empty states e tracking. Se mover rota, manter redirect() como ja e feito nas rotas legadas.
- NAV, TRILHA e MOBILE sao tres listas separadas e MOBILE usa indice de NAV.
- O layout NAO pode ganhar consulta lenta: sidebar-data.tsx explica que isso travava a tela inteira a cada navegacao. Um seletor de loja global nao pode chamar a Shopify no layout.
- Pelo Next 16, o layout nao recebe searchParams: seletor por URL fica num componente de cliente com useSearchParams; seletor por cookie exige route handler ou server action para gravar.

SHOPIFY E DADOS
- SHOPIFY_API_VERSION='2024-10' (client.ts:5) ja foi aposentada. A Shopify atende com a versao acessivel mais antiga e informa no header X-Shopify-API-Version (https://shopify.dev/docs/api/usage/versioning). Query nova (unitCost, presentmentMoney) deve ser validada contra a versao que de fato responde; qual e hoje nao foi verificado.
- read_orders = 60 dias; read_all_orders exige aprovacao (https://shopify.dev/docs/api/usage/access-scopes). Periodo maior que 60 dias so com dados guardados por nos.
- Loja conectada antes do read_orders volta 'denied' e precisa reconectar.
- getOrdersSummary e compartilhada por Vendas (usuario) e Faturamento (admin): mudar a semantica (pedido parcialmente reembolsado, moeda) afeta os dois.
- Vendas so considera lojas que sao destino de rota. Para incluir loja de trafego direto e preciso mudar getSales, que hoje sai vazio sem rota.
- O nome da loja no banco e velho: mostrar ou resolver pelo dominio.
- stores.currency_code NAO e a moeda real da loja (padrao USD, ajuste da importacao).
- Nao existe fuso em lugar nenhum.

BANCO
- Proxima migration: 052.
- Toda policy de INSERT/UPDATE precisa de WITH CHECK conferindo o dono da loja (030).
- SECURITY DEFINER: revogar os dois caminhos (027).
- Tabela de segredo: zero policy.
- Escrita em tabela de rastreamento so via API com service role (048 revogou do authenticated).

CRON
- CRON_SECRET e compartilhado.
- A Vercel pode duplicar ou pular execucao e nao refaz. Job de sincronizacao precisa de claim atomico (padrao healing_since ou claimJob) e de reprocessamento idempotente.
- maxDuration por funcao tem que ir em vercel.json.

DOCUMENTACAO E REPO
- ARCHITECTURE.md esta em parte velho: fala em i18n pt/en/ja, zustand, tema escuro forcado, modelo de dados 001-018 e diz que write_themes nao e pedido, mas scopes.ts pede. Nao confiar sem conferir no codigo.
- Commit que so toca scripts/ nao gera deploy (vercel ignoreCommand), e scripts ficam fora do typecheck do app.
- Ha um arquivo sem commit na raiz (pecas-seora-ap.json) que nao e desta tarefa.
- Pastas vazias em src/app/[locale] (0 arquivos): inofensivas, mas confundem.

**Arquivos-chave**

- `C:/Onedrive/shopify-creator/src/components/layout/sidebar.tsx` — Menu lateral (client). A constante NAV define itens, grupos e contadores. MOBILE pega itens pelo indice (NAV[1].items[1]...): reordenar NAV quebra o menu mobile sem aviso.
- `C:/Onedrive/shopify-creator/src/components/layout/sidebar-data.tsx` — Componente de servidor que busca nome, email, lojas, creditos e progresso (getCurrentUser + getSetupStatus). Roda dentro de Suspense no layout de proposito, para nao travar a tela inteira. Tambem tem SidebarSkeleton.
- `C:/Onedrive/shopify-creator/src/components/layout/top-nav.tsx` — Barra do topo (client, 52px). So mostra o titulo da rota atual, pela lista TRILHA (vence o prefixo mais longo). Sem breadcrumb, sem acoes, sem seletor de loja. TRILHA nao tem /activity, /bulk nem /multi-site.
- `C:/Onedrive/shopify-creator/src/components/layout/page-header.tsx` — PageHeader no estilo antigo (text-2xl font-heading). As telas novas nao usam.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/layout.tsx` — Layout do painel: force-dynamic, trava de acesso userHasAccess -> /no-access, TopNav + Sidebar em Suspense, main com pt-[52px] md:pl-[216px] e container max-w-[1240px], Toaster.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/loading.tsx` — Esqueleto generico de navegacao do painel.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/overview/page.tsx` — Visao geral (server). KPIs de lojas e rota, topologia vitrine -> XCART -> checkouts, requer atencao, atividade. Sem financeiro. Tem o KPI Numero local.
- `C:/Onedrive/shopify-creator/src/lib/overview/queries.ts` — getOverview (React cache, cliente do usuario). Le so routed_checkout_configs[0] e os destinos e fallbacks dela.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/sales/page.tsx` — Vendas (server). Faz await de searchParams.periodo (7/30/60), usa Suspense com key=periodo e esqueleto proprio, e entrega a SalesScreen. E o modelo de tela com filtro na URL.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/sales/sales-screen.tsx` — Vendas (client). Chips de periodo (router.push) e de loja (useState), 4 paineis KPI, tabela por loja de checkout com linha de total 100%. Bug de moeda: usa dados.currency em todas as linhas.
- `C:/Onedrive/shopify-creator/src/lib/sales/queries.ts` — getSales: so lojas que sao destino de rota (getRouteGraph). Le credenciais pelo cliente do usuario, chama getOrdersSummary de todas as lojas ao mesmo tempo (sem teto) e soma centavos sem converter moeda.
- `C:/Onedrive/shopify-creator/src/lib/sales/types.ts` — Tipos e SALES_PERIODS, separados do server-only para a tela de cliente poder importar.
- `C:/Onedrive/shopify-creator/src/lib/sales/share.ts` — repartirCem: reparte 100% pelo maior resto, coberto por tests/sales-share.test.ts.
- `C:/Onedrive/shopify-creator/src/lib/sales/cambio.ts` — Tabela de cambio FIXA para BRL, sobrescrita pela env FX_BRL_RATES. Hoje so o admin usa. Moeda sem taxa devolve null em vez de zero.
- `C:/Onedrive/shopify-creator/src/lib/sales/admin.ts` — Faturamento de todos os usuarios no painel admin (service role, 6 lojas em paralelo, converte para BRL).
- `C:/Onedrive/shopify-creator/src/lib/shopify/orders.ts` — getOrdersSummary: GraphQL orders com created_at>= AND financial_status:paid, pula test e cancelled, soma currentTotalPriceSet.shopMoney, ate 20 paginas de 250. MAX_ORDER_DAYS=60. Separa denied de failed.
- `C:/Onedrive/shopify-creator/src/lib/shopify/client.ts` — shopifyGraphQL com retry em 429/THROTTLED. SHOPIFY_API_VERSION='2024-10' na linha 5. Inscricao de webhooks (ensureWebhook).
- `C:/Onedrive/shopify-creator/src/lib/shopify/scopes.ts` — Escopos pedidos: read_orders (60 dias), read_products, write_inventory, write_pixels, read_customer_events e outros. Nao pede read_all_orders.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/tracking/page.tsx` — Rastreamento (server). h1 fora do Suspense; dentro, getPainelTracking + diagnosticar (Shopify), entregues a TrackingScreen.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/tracking/tracking-screen.tsx` — Tela de rastreamento (client, 1621 linhas). KPIs, filtro de loja (chips ate 6 lojas, Select acima disso), CardLoja com saude, 'Compras chegando' por destino, Atribuicao e checklist. Tem copias locais de Numero e Chip.
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/tracking/selo.tsx` — Pecas reutilizaveis: TOM (ok/warn/err/neutro com cor, fundo e borda por token), Selo (ponto + palavra), Ponto, TagPlataforma (Google/Meta neutro), Aviso (faixa com acao por href ou onClick).
- `C:/Onedrive/shopify-creator/src/app/(dashboard)/tracking/saude.ts` — Regra pura de saude da loja, so com imports de TIPO. Tem quando() e plural(). Testada em tests/tracking-saude.test.ts. E o modelo de 'regra fora do React'.
- `C:/Onedrive/shopify-creator/src/lib/tracking/queries.ts` — getPainelTracking: le lojas e configs pelo cliente do usuario, a RPC tracking_painel pelo cliente do USUARIO (INVOKER + RLS, paginada com ordem total) e os destinos pelo admin (so temToken). Se a leitura falha, marca contagemIndisponivel.
- `C:/Onedrive/shopify-creator/src/lib/tracking/destinos.ts` — Padrao de segredo: tracking_destinations le pelo admin; o token mora em tracking_destination_secrets e so e lido com comToken. Para a tela sai so o booleano temToken. Erro de banco lanca, nunca vira lista vazia.
- `C:/Onedrive/shopify-creator/src/app/api/shopify/webhooks/route.ts` — Webhook unico da Shopify: HMAC, janela de replay, idempotencia por shopify_webhook_events (o marcador e apagado quando a resposta e 5xx), orders/create vira Purchase na fila. O pedido NAO e gravado.
- `C:/Onedrive/shopify-creator/src/lib/tracking/purchase.ts` — Monta o Purchase (Meta) e a conversao Google a partir do payload REST: value = total_price, currency = pedido.currency (moeda da loja).
- `C:/Onedrive/shopify-creator/src/lib/tracking/filtro-pedido.ts` — Regra unica de pedido que nao conta: teste, PDV, draft order e valor zero. Webhook e tela usam a mesma; uma tela financeira deveria reaproveitar.
- `C:/Onedrive/shopify-creator/src/app/api/jobs/tracking/drain/route.ts` — Modelo de cron: runtime nodejs, maxDuration, GET e POST, cronAutorizado (Bearer CRON_SECRET ou x-cron-secret); fora do cron exige sessao + is_admin; limite por ?limit; expurgo uma vez por hora.
- `C:/Onedrive/shopify-creator/src/app/api/jobs/routes/heal/route.ts` — Cron horario do auto-conserto. Fora do cron, o escopo e o usuario da sessao. Claim atomico por healing_since (migration 034).
- `C:/Onedrive/shopify-creator/vercel.json` — Crons: bulk-import 0 * * * *, routes/heal 30 * * * *, tracking/drain */10 * * * *. maxDuration por funcao. ignoreCommand que pula deploy quando o commit so toca scripts/.
- `C:/Onedrive/shopify-creator/src/lib/supabase/server.ts` — createClient() do usuario (chave anon + cookies; vale a RLS).
- `C:/Onedrive/shopify-creator/src/lib/supabase/admin.ts` — createAdminClient() com service role (passa por cima da RLS). So no servidor.
- `C:/Onedrive/shopify-creator/src/lib/supabase/current-user.ts` — getCurrentUser com React cache: uma ida a rede por requisicao.
- `C:/Onedrive/shopify-creator/src/lib/stores/authorize.ts` — Invariante de dono: o userId vem da sessao, nunca do body. NaoAutorizado devolve 401 ou 404.
- `C:/Onedrive/shopify-creator/src/lib/stores/picker.ts` — getPickerStores: lojas para os seletores das telas de importacao, buscadas no servidor. Hoje e o mais perto de uma fonte de seletor de loja.
- `C:/Onedrive/shopify-creator/src/lib/supabase/middleware.ts` — Roteamento por host (adm./user./marketing) e auth das paginas. Rotas de API NAO sao barradas aqui. Redireciona para APP_HOME depois do login.
- `C:/Onedrive/shopify-creator/src/proxy.ts` — Arquivo de proxy (o antigo middleware, renomeado no Next 16).
- `C:/Onedrive/shopify-creator/src/lib/app-home.ts` — APP_HOME = '/overview'.
- `C:/Onedrive/shopify-creator/src/lib/textos.ts` — textos(namespace) le de messages/pt.json; chave que nao existe volta como a propria chave.
- `C:/Onedrive/shopify-creator/messages/pt.json` — Dicionario. O namespace nav guarda os rotulos do menu e da trilha do topo.
- `C:/Onedrive/shopify-creator/src/app/globals.css` — Tokens de cor em :root e .dark (next-themes por classe), mapeados para o Tailwind em @theme inline (text-ink, text-t2, bg-surface, chart-1..5).
- `C:/Onedrive/shopify-creator/design novo/Arquitetura e design system/HANDOFF.md` — Convencoes visuais do redesign: so tokens, nada de hex; estado sempre com ponto + rotulo; raio 6-8px; linhas de 44px; Public Sans + IBM Plex Mono; Vendas agregada sem lista pedido a pedido.
- `C:/Onedrive/shopify-creator/supabase/migrations/035_tracking_server_side.sql` — tracking_configs, secrets, identities, events e purge_tracking. Mostra o padrao de RLS com WITH CHECK e tabela sem policy.
- `C:/Onedrive/shopify-creator/supabase/migrations/043_tracking_destinos.sql` — tracking_destinations, tracking_destination_secrets e destination_id na chave de deduplicacao.
- `C:/Onedrive/shopify-creator/supabase/migrations/048_tracking_checkout_e_dono.sql` — Gatilho de dono em destinations e revoke de INSERT/UPDATE/DELETE do authenticated (a escrita so passa pela API com service role). Retencao do expurgo.
- `C:/Onedrive/shopify-creator/supabase/migrations/051_tracking_painel_sem_clique_pelo_payload.sql` — RPC agregadora tracking_painel (SECURITY INVOKER, grant a authenticated). Modelo para RPC de painel.
- `C:/Onedrive/shopify-creator/tests/tracking-painel.test.ts` — Modelo de teste com vi.mock('server-only') e mock do query builder do Supabase, conferindo QUAL cliente le.
- `C:/Onedrive/shopify-creator/tests/sales-share.test.ts` — Teste de propriedade (fast-check) da reparticao de 100%.
- `C:/Onedrive/shopify-creator/vitest.config.ts` — Ambiente node, inclui tests/**/*.test.ts, alias @ -> src.
- `C:/Onedrive/shopify-creator/src/app/admin/admin-nav.tsx` — Menu do admin (host adm.): Visao geral, Usuarios, Faturamento, Uso & Custos.

---

## Atribuição, diagnóstico e alertas com o que já existe

**Resumo.** Avaliação feita só lendo o repo (nenhum arquivo foi alterado) e as docs oficiais. Nenhuma query foi rodada em produção: os SQL abaixo são propostas.

1) JORNADA DO PEDIDO. Dá para montar hoje, em parte, sem mudar código. A linha de compra (`tracking_events`, event_name='Purchase', order_id = id numérico do pedido) não tem visitor_id, checkout_token nem referrer. Isso porque o webhook chama `enfileirar` sem esses campos (`src/app/api/shopify/webhooks/route.ts`, por volta da linha 323). Mesmo assim, o payload já traz três chaves que ligam a compra ao visitante:
- Meta: `user_data.external_id`, que é o sha256 do `_xc_vid` e do clientId da Shopify (`normalizar.ts`, `hashOuNulo`).
- Meta: `user_data.fbp`, em texto claro.
- Google: `gclid`/`gbraid`/`wbraid`, iguais aos dos eventos do funil.
Com isso dá para achar o visitante em `tracking_identities` e depois o funil em `tracking_events` pelo visitor_id. No tema, o visitor_id é o `_xc_vid`; no pixel, é o clientId.

O que falta e custa pouco:
- a) Gravar o `checkout_token` do pedido. A coluna já existe e `enfileirar` já aceita o campo. Com ele, a junção vira a mesma cascata que o webhook já usa: `tracking_checkouts` → clientId → identities.
- b) Gravar de onde veio a identidade ("visitante", "checkout" ou "nenhuma"). Hoje isso só aparece na resposta HTTP do webhook e se perde.

2) TELA /tracking. Ela já é a tela de "Diagnóstico de pixels". Para cada loja mostra:
- veredito de saúde;
- pedido a pedido: pedidos da Shopify contra compras enviadas, por destino;
- vendas sem clique (gclid/fbc), lido do payload (migration 051);
- falhas com o último erro e pendentes;
- funil de 7 dias por destino (produto, carrinho, checkout, pagamento, compra);
- webhook inscrito, snippet e remarketing no tema, pixel do checkout ativo ou desatualizado, teto atingido, modo teste, destino incompleto.

O que não mostra:
- lista de eventos (feed);
- latência (sent_at − created_at, e o atraso do webhook);
- última atividade separada por fonte (tema, pixel, webhook);
- idade do pendente mais antigo (fila travada);
- confirmação do lado da plataforma.

Duplicados não ficam gravados em lugar nenhum: o índice único descarta em silêncio. Não vale construir contador para isso. A duplicação que importa fica fora do xcart (por exemplo, outro pixel mandando Purchase com outro event_id) e só aparece no comparativo.

3) ALERTAS. O motor quase existe. `src/app/(dashboard)/tracking/saude.ts` é puro e já tem teste (`tests/tracking-saude.test.ts`): `saudeDaLoja` produz exatamente os motivos de alerta. Falta:
- uma variante admin do carregador do painel;
- uma tabela de alertas abertos (para dedupe, cooldown e histerese);
- um cron `/api/jobs/alertas` a cada 10 min, separado do drain;
- o envio pelo Telegram (`sendMessage`).
Todas as regras de rastreamento usam dados que já existem. As regras de gasto (gastou sem vender, ROAS abaixo do break-even, sync atrasado) dependem do sync de gasto, que ainda não existe.

4) COMPARATIVO xcart x Meta x Google. Precisa de quatro coisas novas: o mapa conta de anúncio → loja; o sync de insights com conversões atribuídas por dia; câmbio; e fuso. O lado xcart já existe: pedidos da Shopify e compras enviadas por destino.

NOVIDADE QUE MUDA UMA PREMISSA. O Google aposentou o developer token em 09/09/2026. O acesso à Google Ads API agora segue o projeto do Google Cloud. O nível Explorer dá 2.880 operações por dia em contas reais e não exige verificação de marca. Conta de administrador (MCC) não é mais necessária. A decisão "sem developer token/MCC" precisa ser revista com isso em mente.

**Recomendação.** MVP em fases, reaproveitando o que já existe. As estimativas de esforço são minhas, não medidas.

FASE 0 — um PR pequeno, sem tela nova (cerca de meio dia)
No webhook orders/create (`tratarPedidoCriado`), gravar uma linha por pedido numa tabela nova `tracking_pedidos`, ANTES dos retornos antecipados ("rastreamento desligado" e "nenhum destino"). Mesmo princípio que `tracking_checkouts` já segue no coletor.
- Campos: store_id, order_id, nome do pedido, created_at, checkout_token, visitor_id do atributo do carrinho, client_id resolvido, identidade_origem (visitante/checkout/nenhuma), landing_site, referring_site, source_name, total e moeda da loja, total e moeda do cliente (total_price_set), e utm_source/medium/campaign extraídos do landing_site.
- Sem e-mail, telefone ou endereço.
- Leitura: RLS por dono. Escrita: só service_role.
- Por que essa tabela: vira a fonte única de "pedido observado". Serve à jornada (junção pelo checkout_token, sem hash), ao alerta "gastou sem vender", ao ROAS, ao comparativo e depois a "Lucro & Financeiro", sem chamar a Shopify a cada tela.
- Alternativa mínima, se preferir não criar tabela: passar `checkoutToken: pedido.checkout_token` no `enfileirar` da compra e criar uma coluna `identidade_origem` em `tracking_events`.
- Visitor_id NÃO deve ir na linha da compra: os tetos do coletor contam `visitor_id is not null`.

FASE 1 — Rastreamento (2 a 3 dias)
Nada de telas separadas de "Diagnóstico de pixels" e "Atribuição": a /tracking já é isso.
- a) Aba ou seção "Eventos" na /tracking. Lista dos últimos 100 eventos da loja selecionada: hora, evento, fonte (tema/pixel/webhook), destino, status, latência, com ou sem clique, host da origem, utm_source/utm_campaign e um link "ver jornada" nas compras.
  - Dados por uma RPC `tracking_feed`, SECURITY INVOKER, igual ao padrão da `tracking_painel`. O índice (store_id, created_at desc) já existe.
  - Atualização por polling a cada 15 s ou botão de recarregar. Não usar Supabase Realtime: postgres_changes autoriza cada evento contra cada assinante e processa tudo numa thread só.
  - A RPC não devolve o payload: ele tem IP e user agent em texto claro.
- b) Gaveta "Jornada do pedido", aberta a partir de uma compra.
  - Usa a query da seção de detalhes técnicos, rodada no servidor com admin, depois de conferir que a loja é do usuário (`tracking_identities` não tem policy).
  - Opcionalmente, uma chamada GraphQL `order.customerJourneySummary`: dá a primeira e a última visita, com UTM e referrer, na visão da Shopify, e completa o que o snippet não viu (pouso na home, por exemplo).
- c) Quatro números novos no card da loja: último evento do tema, último do pixel, último orders/create (`shopify_webhook_events`), p95 da latência de envio e pendente mais antigo.

FASE 2 — Alertas com Telegram (2 a 3 dias)
- Tabela `alertas`, com índice único parcial para alerta aberto, e canal Telegram.
  - O token do bot fica numa variável de ambiente da Vercel, nunca no banco.
  - O chat_id fica numa tabela `alerta_canais` (ou, no MVP só para o Arthur, numa variável de ambiente).
- Cron novo `/api/jobs/alertas` a cada 10 min no vercel.json. O plano Pro permite execução por minuto e até 100 crons por projeto. Fica separado do drain para uma falha não derrubar a outra.
- A cada 10 min, regras só em SQL: app desinstalado, token do Meta inválido (erro 190), envios falhando, fila travada, checkouts sem pedido, pixel parou, tema parou, teto atingido.
- Uma vez por hora (mesmo truque do purge, `getUTCMinutes() < 10`): `diagnosticar()` mais `saudeDaLoja()`, que trazem webhook não inscrito, pedidos sem compra e vendas sem clique. É a mesma regra da tela, então o alerta nunca discorda dela.
- Anti-spam:
  - abre uma vez;
  - crítico renotifica a cada 6 h; aviso, uma vez só, mais um resumo diário;
  - fecha só depois de duas avaliações seguidas sem o problema;
  - uma mensagem por execução e por chat, juntando os alertas.

FASE 3 — Depois que existir o sync de gasto
- Regras novas: gastou X sem vender, ROAS abaixo do break-even (1 ÷ margem), sync de gasto atrasado, conta do Meta bloqueada.
- Comparativo por loja e por dia, lado a lado:
  - pedidos (`tracking_pedidos`);
  - compras enviadas por destino;
  - Purchase recebidos pelo Meta (`/{pixel}/stats`, com event_source=SERVER_ONLY);
  - compras atribuídas pelo Meta (insights `actions`, offsite_conversion.fb_pixel_purchase);
  - conversões atribuídas pelo Google (`metrics.conversions_by_conversion_date` da conversion action de compra).
- O número do Google é o único jeito de confirmar que ele CONTOU. O /pagead responde 200 mesmo quando ignora, e o próprio rodapé da tela já admite isso.

Por que essa ordem: as fases 0 a 2 não dependem de token novo nem de decisão sobre Google Ads, e cobrem o risco que mais custa dinheiro hoje: venda que não chega na plataforma sem ninguém perceber. A fase 3 depende de o Arthur escolher como puxar o gasto do Google. Com o fim do developer token, a API pelo projeto Google Cloud (nível Explorer) passou a ser viável. O Google Ads Script continua sendo a opção sem OAuth e sem Cloud.

### Opções avaliadas

#### Jornada pelo banco atual, sem mudar código (junção por hash, fbp e gclid)

- **Como funciona:** Parte das linhas de compra do pedido (`tracking_events`, lower(event_name)='purchase' e order_id). Tira as chaves do payload: no Meta, external_id (sha256 do `_xc_vid` e do clientId) e fbp; no Google, gclid/gbraid/wbraid. Acha as identidades em `tracking_identities` comparando `encode(sha256(convert_to(btrim(visitor_id),'UTF8')),'hex')` com o external_id. Depois lista os eventos do funil por visitor_id (`_xc_vid` no tema, clientId no pixel), deduplicando por event_id. A origem sai da coluna `referrer` e das UTM extraídas por regex da pageUrl/event_source_url.
- **Requisitos:** Nenhuma migration. Server action ou rota com admin, depois de conferir que a loja é do usuário. Esforço estimado: cerca de meio dia, mais a tela.
- **Limites:** Retenção: identidades 90 dias a partir da criação; eventos enviados 90 dias; falhos e pendentes 30 dias. Teto de 120 linhas por visitante por dia. Identidade é o estado mais recente, porque o upsert sobrescreve os click ids (created_at é preservado).
- **Prós:** Pronto para usar já, inclusive para pedidos antigos (até 90 dias, que é o prazo das identidades).
- **Contras:** Sem destino Meta, só junta compra que teve clique do Google. A origem da identidade não fica registrada. O sha256 roda em todas as identidades da loja, aceitável só sob demanda, por pedido. Pouso em página que não é de produto não gera linha, porque não existe evento page_view. Só existe linha de funil se algum destino aceitar o evento: o Meta aceita todos; o Google só os que têm rótulo.
- **Fontes:** https://www.postgresql.org/docs/current/functions-binarystring.html · C:/Onedrive/shopify-creator/src/lib/tracking/normalizar.ts · C:/Onedrive/shopify-creator/src/app/api/shopify/webhooks/route.ts · C:/Onedrive/shopify-creator/supabase/migrations/048_tracking_checkout_e_dono.sql

#### Jornada com a ponte gravada (tabela tracking_pedidos ou checkout_token na linha da compra)

- **Como funciona:** O webhook orders/create passa a gravar checkout_token, visitor_id do atributo do carrinho, client_id resolvido, identidade_origem, landing_site, referring_site, source_name, totais e UTM extraídas. A jornada vira uma junção exata: pedido → `tracking_checkouts`, ou `tracking_events.checkout_token` → clientId → `tracking_identities` → visitor_id → funil. É a mesma cascata de `identidade-do-pedido.ts`.
- **Requisitos:** Uma migration e algumas linhas no webhook. Esforço estimado: cerca de meio dia.
- **Limites:** O `checkout_token` está marcado como deprecated no recurso REST Order da Shopify. Se a Shopify parar de mandá-lo no webhook, esta junção e o passo 2 da cascata atual quebram juntos. `tracking_checkouts` é expurgada em 30 dias.
- **Prós:** Junção exata, para Google e Meta. Deixa registrado POR QUE a venda saiu com ou sem clique. A mesma tabela serve depois a alertas, ROAS, comparativo e Lucro.
- **Contras:** Só vale para pedidos daqui para frente. Se a tabela vier antes do retorno 'rastreamento desligado', grava pedido de loja com rastreamento desligado; isso é desejável para Lucro, mas é uma escrita a mais por pedido.
- **Fontes:** https://shopify.dev/docs/api/admin-rest/latest/resources/order · C:/Onedrive/shopify-creator/src/lib/tracking/identidade-do-pedido.ts

#### Jornada pela própria Shopify (Order.customerJourneySummary)

- **Como funciona:** Uma consulta GraphQL por pedido aberto na tela: customerJourneySummary { ready daysToConversion customerOrderIndex firstVisit { occurredAt landingPage referrerUrl source sourceType utmParameters { ... } } lastVisit { ... } }.
- **Requisitos:** Escopo read_orders, que o app já usa no diagnóstico. Esforço estimado: algumas horas.
- **Limites:** Os campos de UTMParameters não foram listados no trecho lido da doc (não verificado). O app pede 2024-10, versão já aposentada: a Shopify responde pela versão estável mais antiga ainda acessível.
- **Prós:** Mostra pouso na home, sessões sem evento de produto e UTM, sem depender do snippet. Dá uma segunda opinião ao lado do que o xcart viu.
- **Contras:** Uma chamada à Shopify por pedido. `ready` pode vir falso logo depois do pedido, e `momentsCount` vem nulo enquanto a atribuição está sendo processada. Não traz gclid/fbc nem o que foi enviado às plataformas.
- **Fontes:** https://shopify.dev/docs/api/admin-graphql/2024-10/objects/CustomerJourneySummary · https://shopify.dev/docs/api/admin-graphql/2024-10/objects/CustomerVisit · https://shopify.dev/docs/api/usage/versioning

#### Feed 'Eventos em tempo real' por RPC com polling

- **Como funciona:** RPC `tracking_feed(p_store_id, p_antes, p_limite)`, SECURITY INVOKER, igual ao padrão da `tracking_painel`: a RLS 'Owners read their tracking events' vale lá dentro. Devolve só colunas tratadas: hora, evento, fonte, destino, status, tentativas, erro, latência, com clique, host do referrer e UTM. Sem payload. A tela atualiza a cada 15 s ou num botão.
- **Requisitos:** Uma migration (função mais revoke/grant, regra da migration 027) e um componente. Índice `tracking_events_loja_idx` (store_id, created_at desc) já existe. Esforço estimado: cerca de 1 dia.
- **Limites:** Supabase Realtime (postgres_changes) foi descartado de propósito: autoriza cada mudança contra cada assinante e processa numa thread só, e `tracking_events` é a tabela que mais recebe escrita.
- **Prós:** Sem infraestrutura nova. Não expõe IP nem user agent do payload. Paginação por cursor de tempo.
- **Contras:** Não é push. Atraso de até 15 s.
- **Fontes:** https://supabase.com/docs/guides/realtime/postgres-changes · C:/Onedrive/shopify-creator/supabase/migrations/051_tracking_painel_sem_clique_pelo_payload.sql

#### Diagnóstico ampliado só com SQL (última atividade por fonte, latência, fila)

- **Como funciona:** Uma agregação por loja nas últimas 24 h de `tracking_events`: último evento do tema (visitor_id não nulo e checkout_token nulo), último do pixel (checkout_token não nulo), p50/p95 de sent_at − created_at, pendente mais antigo (min next_attempt_at). Mais max(received_at) de `shopify_webhook_events` com topic 'orders/create'. Atraso do webhook na compra do Meta: created_at − to_timestamp(payload->>'event_time').
- **Requisitos:** Somar à `tracking_painel` ou criar uma RPC irmã. Índice opcional (store_id, topic, received_at desc) em `shopify_webhook_events`. Esforço estimado: meio dia.
- **Limites:** `web_pixel_visto_em` é carimbado no máximo de hora em hora, então a resolução de 'pixel parou' é de 1 h. `shopify_webhook_events` não tem expurgo.
- **Prós:** Responde 'parou?' sem depender de pedido entrar. Vira a base das regras de alerta.
- **Contras:** Separar tema e pixel pelo checkout_token é aproximado. Só existe linha quando algum destino aceita o evento.
- **Fontes:** C:/Onedrive/shopify-creator/supabase/migrations/033_shopify_webhooks.sql · C:/Onedrive/shopify-creator/supabase/migrations/042_web_pixel_visto_em.sql

#### Diagnóstico do lado do Meta (pixel stats e last_fired_time)

- **Como funciona:** GET /{pixel-id}/stats?aggregation=event&event_source=SERVER_ONLY&start_time=… devolve disparos por evento, hora a hora, até 7 dias. O campo `last_fired_time` do AdsPixel diz a última vez que o pixel disparou. Compara 'Purchase recebidos pelo Meta' com as compras enviadas por destino. Com event_source=WEB_ONLY dá para ver se o pixel do navegador (por exemplo, o app nativo da Shopify) também está mandando Purchase.
- **Requisitos:** Token com acesso ao pixel. Se o token do CAPI que já está em `tracking_destination_secrets` tem essa permissão, NÃO está verificado. Esforço estimado: cerca de 1 dia.
- **Limites:** Dados de no máximo 7 dias. Permissões exatas não estão listadas na página da edge (não verificado).
- **Prós:** Confirma o recebimento pelo Meta, não só o 'enviado'. Pode revelar Purchase em dobro vindo do navegador.
- **Contras:** Recebido não é atribuído. Mais uma chamada externa por loja e por hora.
- **Fontes:** https://developers.facebook.com/docs/marketing-api/reference/ads-pixel/stats/ · https://developers.facebook.com/docs/marketing-api/reference/ads-pixel/

#### Motor de alertas no cron com Telegram

- **Como funciona:** Cron `/api/jobs/alertas` a cada 10 min, autenticado com CRON_SECRET como o drain. Avalia regras SQL a cada execução e, uma vez por hora, roda `diagnosticar()` e `saudeDaLoja()`. Compara com a tabela `alertas`: abre, renotifica ou resolve. Junta tudo em uma mensagem por chat e manda por POST https://api.telegram.org/bot<TOKEN>/sendMessage com {chat_id, text, disable_notification}.
- **Requisitos:** Bot criado no BotFather; TELEGRAM_BOT_TOKEN na Vercel; chat_id (por getUpdates no MVP, ou deep link t.me/<bot>?start=<código> no futuro SaaS, que exige webhook do bot); tabela alertas e canais; entrada nova no vercel.json. Esforço estimado: 2 a 3 dias.
- **Limites:** Telegram: texto de 1 a 4.096 caracteres; cerca de 1 mensagem por segundo por chat; 20 por minuto em grupo; acima disso, erro 429 com parameters.retry_after. getUpdates não funciona com webhook configurado, e os updates ficam guardados até 24 h. Vercel Pro: execução por minuto, com precisão de minuto.
- **Prós:** Reaproveita a regra da tela, já testada, sem lógica duplicada. Telegram é só HTTPS, sem SDK. O cron Pro permite até 1 execução por minuto e 100 crons por projeto.
- **Contras:** Loja de pouco volume gera falso positivo se não houver piso mínimo e histerese. O cron por hora faz 4 ou mais chamadas à Shopify por loja ligada.
- **Fontes:** https://core.telegram.org/bots/api · https://core.telegram.org/bots/faq · https://core.telegram.org/bots/tutorial · https://core.telegram.org/bots/features#botfather · https://core.telegram.org/bots/features#deep-linking · https://vercel.com/docs/cron-jobs/usage-and-pricing

#### Comparativo e gasto do Meta pela Insights API

- **Como funciona:** GET /act_<id>/insights?level=account&time_increment=1&time_range={since,until}&fields=spend,actions,action_values,account_currency&action_report_time=conversion&use_unified_attribution_setting=true. Lê actions[action_type=offsite_conversion.fb_pixel_purchase] ou omni_purchase. Upsert diário e reprocessamento dos últimos dias. AdAccount fields=currency,timezone_name,account_status para fuso, moeda e alerta de conta bloqueada.
- **Requisitos:** Token com ads_read ou ads_management nas contas, de preferência de usuário do sistema (passo a passo não verificado aqui). Tabelas: contas de anúncio (conta → loja, moeda, fuso, último sync) e gasto diário. Esforço estimado: 2 a 3 dias.
- **Limites:** Desde 12/01/2026 as janelas 7d_view e 28d_view não retornam mais. Seguem 1d_click, 7d_click, 28d_click, 1d_ev e 1d_view. Totais ficam disponíveis por 37 meses. Desde 06/08/2026 os breakdowns horários podem vir vazios em algumas contas: o admin precisa ativar no Ads Manager, ou usar job assíncrono. Limite por hora no acesso standard: 600 + 400 × anúncios ativos (erro 80000/2446079).
- **Prós:** Mesma API para gasto e para compras atribuídas. Com use_unified_attribution_setting=true os números batem com o Gerenciador de Anúncios.
- **Contras:** A atribuição do Meta difere da contagem de pedidos: visualização de 1 dia, e a mesma venda pode ser creditada também ao Google.
- **Fontes:** https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/ · https://developers.facebook.com/docs/marketing-api/insights/ · https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/ · https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/ · https://developers.facebook.com/docs/marketing-api/insights/breakdowns/ · https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ · https://developers.facebook.com/docs/marketing-api/reference/ad-account/

#### Gasto e conversões do Google por Google Ads Script (sem developer token, sem OAuth no xcart)

- **Como funciona:** Script colado em cada conta (Ferramentas > Scripts) e agendado de hora em hora. Roda GAQL com AdsApp.search: segments.date, metrics.cost_micros, segments.conversion_action_name, metrics.conversions_by_conversion_date e metrics.conversions_value_by_conversion_date, nos últimos dias. Manda o resultado com UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', payload, headers}) para um endpoint do xcart autenticado por segredo próprio de cada conta.
- **Requisitos:** O Arthur cola o script e autoriza em cada uma das 3 contas (sem MCC, é um script por conta). Endpoint de ingestão no xcart. Esforço estimado: cerca de 1 dia.
- **Limites:** 30 min de execução por script; 250 scripts autorizados por conta; frequências de agendamento (hourly vem de fonte não oficial, nilsrooijmans.com; a ajuda do Google cita 'once, daily, weekly or monthly'). cost_micros divide por 1.000.000. Cotas do UrlFetchApp no Ads Scripts: não verificado.
- **Prós:** Custo zero. Nada de projeto Cloud, OAuth ou aprovação de acesso. Confirma o que o Google contou, que hoje a tela não consegue afirmar.
- **Contras:** De hora em hora, no máximo: o pedido de 15 a 30 min não é atendido. Cada conta é configurada à mão. Se o script parar, o xcart só descobre por ausência, daí a regra 'sync atrasado'.
- **Fontes:** https://developers.google.com/google-ads/scripts/docs/limits · https://developers.google.com/google-ads/scripts/docs/features/reports · https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app · https://support.google.com/google-ads/answer/188712?hl=en · https://developers.google.com/google-ads/api/docs/conversions/reporting · https://nilsrooijmans.com/google-ads-scripts-faq/can-you-run-a-google-ads-script-multiple-times-per-hour/

#### Gasto e conversões do Google pela Google Ads API depois do fim do developer token

- **Como funciona:** Desde 09/09/2026 o nível de acesso segue o projeto Google Cloud que emitiu o OAuth. O header developer-token é opcional e ignorado. Pede-se o nível Explorer na página Google Ads API Overview do Cloud Console. O xcart roda GoogleAdsService.Search por conta a cada 15 a 30 min, com refresh token OAuth do usuário dono das contas.
- **Requisitos:** Projeto Google Cloud, tela de consentimento OAuth, refresh token por usuário, pedido do nível Explorer. O nível Basic exigiria verificação de marca. MCC não é exigida. Esforço estimado: 2 a 3 dias, mais a espera da aprovação.
- **Limites:** Explorer: 2.880 operações por dia em contas reais; cada Search conta como 1 operação, seja qual for o número de linhas. Restringe criação de conta, gestão de usuários, planejamento e faturamento; relatório parece permitido (inferido, não explícito). 3 contas × 96 execuções por dia = 288 operações por dia.
- **Prós:** Intervalo livre (15 a 30 min, como na proposta). Escala para venda como serviço, com cada cliente autorizando pelo OAuth.
- **Contras:** OAuth e consentimento para manter. Depende de aprovação, que pode demorar.
- **Fontes:** https://developers.google.com/google-ads/api/docs/get-started/dev-token · https://developers.google.com/google-ads/api/docs/api-policy/access-levels · https://developers.google.com/google-ads/api/docs/best-practices/quotas · https://ppc.land/google-drops-developer-tokens-from-ads-api-access-decisions/

### Detalhes técnicos

A. O QUE JÁ EXISTE NO BANCO (para jornada, feed e alertas)

- `tracking_events` (035 a 051): store_id, destination ('google'|'meta'), destination_id, event_name ('Purchase' na compra; minúsculo no funil), event_id, order_id, visitor_id, referrer, checkout_token, payload (jsonb), status (pendente/enviado/falhou), attempts, next_attempt_at, last_error, response (jsonb), created_at, sent_at.
  - No funil, order_id = event_id: filtre a compra por event_name.
  - Uma linha por destino: deduplique por event_id.
  - Na compra (webhook): visitor_id, checkout_token e referrer ficam nulos.
  - Payload do Meta: event_time (em segundos; na compra é o created_at do pedido), event_source_url (na compra, origem pública + landing_site), user_data {em, ph, …, external_id[], fbp, fbc, client_ip_address, client_user_agent}, custom_data. IP e user agent estão em texto claro e o dono da loja lê pela RLS.
  - Payload do Google: {gclid, gbraid, wbraid, auid, pageUrl, orderId, value, currency}. Value e currency só na compra.
  - response: no Meta, o JSON completo (events_received, fbtrace_id ou error.code). No Google, só {url, status}.
- `tracking_identities`: visitor_id (`_xc_vid`), shopify_client_id, gclid, gbraid, wbraid, auid, fbp, fbc, fbclid, created_at (primeira vez), updated_at e expires_at (90 dias a partir da criação). Só service_role.
- `tracking_checkouts`: (store_id, checkout_token) → shopify_client_id, gravada pelo pixel. Expurgo em 30 dias.
- `tracking_configs`: enabled, web_pixel_visto_em, web_pixel_com_id_em (carimbos de hora em hora), teto_atingido_em.
- `tracking_destinations`: plataforma, conta, labels, test_event_code, ativo, created_at.
- `shopify_webhook_events`: webhook_id (PK), topic, shop_domain, store_id, received_at. Sem expurgo. O marcador é apagado quando o processamento devolve 503.
- RPC `tracking_painel(store_ids, desde)`: INVOKER; agrupa por (loja, destino, evento, status), com n_sem_atribuicao lido do payload e order_ids.
- Pixel (`public/xcart-pixel.js`): visitorId = clientId, ou o checkout.token se não houver clientId. Manda checkoutToken e referrer do documento.
- Tema (`public/xcart-click.js`): visitorId = `_xc_vid`. O referrer é o da primeira página da sessão (sessionStorage). pageUrl = location.href completa, com as utm_*. Não existe evento page_view.

B. QUERY DA JORNADA HOJE, SEM MUDANÇA DE CÓDIGO
Não foi executada. Rodar com service_role depois de conferir o dono da loja. :loja = stores.id; :pedido = id numérico da Shopify.

```sql
with compra as (
  select e.destination, e.destination_id, e.status, e.created_at as registrada_em, e.sent_at, e.last_error,
         case when e.destination = 'meta' then to_timestamp((e.payload->>'event_time')::bigint) end as pedido_em,
         coalesce(e.payload->>'event_source_url', e.payload->>'pageUrl') as landing,
         nullif(e.payload->'user_data'->>'fbp','') as fbp,
         nullif(e.payload->'user_data'->>'fbc','') as fbc,
         e.payload->'user_data'->'external_id' as ext_ids,
         coalesce(nullif(e.payload->>'gclid',''), nullif(e.payload->>'gbraid',''), nullif(e.payload->>'wbraid','')) as clique_google
    from tracking_events e
   where e.store_id = :loja and lower(e.event_name) = 'purchase' and e.order_id = :pedido
),
hashes as (
  select jsonb_array_elements_text(ext_ids) as h from compra where jsonb_typeof(ext_ids) = 'array'
),
pessoa as (
  select i.visitor_id, i.shopify_client_id, i.created_at as vista_em, i.gclid, i.fbc, i.fbclid
    from tracking_identities i
   where i.store_id = :loja
     and (   encode(sha256(convert_to(btrim(i.visitor_id),'UTF8')),'hex') in (select h from hashes)
          or encode(sha256(convert_to(btrim(coalesce(i.shopify_client_id,'')),'UTF8')),'hex') in (select h from hashes)
          or i.fbp in (select fbp from compra where fbp is not null)
          or coalesce(i.gclid, i.gbraid, i.wbraid) in (select clique_google from compra where clique_google is not null))
),
ids as (
  select visitor_id as v from pessoa
  union select shopify_client_id from pessoa where shopify_client_id is not null
),
funil as (
  select distinct on (f.event_id)
         f.created_at, lower(f.event_name) as evento,
         case when f.checkout_token is not null then 'pixel' else 'tema' end as fonte,
         f.referrer,
         coalesce(f.payload->>'event_source_url', f.payload->>'pageUrl') as pagina,
         coalesce(nullif(f.payload->>'gclid',''), nullif(f.payload->'user_data'->>'fbc','')) as clique
    from tracking_events f
   where f.store_id = :loja and lower(f.event_name) <> 'purchase'
     and f.visitor_id in (select v from ids)
     and f.created_at between (select max(registrada_em) from compra) - interval '30 days'
                          and (select max(registrada_em) from compra)
   order by f.event_id, f.created_at
)
select created_at as quando, 'funil' as tipo, evento, fonte, referrer, pagina, clique,
       substring(pagina from '[?&]utm_source=([^&#]*)')   as utm_source,
       substring(pagina from '[?&]utm_campaign=([^&#]*)') as utm_campaign
  from funil
union all
select registrada_em, 'compra', destination || ' ' || status, 'webhook', null, landing,
       coalesce(clique_google, fbc),
       substring(landing from '[?&]utm_source=([^&#]*)'),
       substring(landing from '[?&]utm_campaign=([^&#]*)')
  from compra
order by quando;
```

Como ler o resultado: a "primeira visita/origem" é a primeira linha do funil (referrer + UTM) e o menor `pessoa.vista_em`. O "clique" é o gclid/fbc da linha. A "compra enviada" são as linhas 'compra', com status e atraso (registrada_em − pedido_em no Meta; sent_at − registrada_em).

C. JORNADA DEPOIS DA FASE 0 (junção exata pela ponte que o webhook já usa)

```sql
with ck as (
  select checkout_token from tracking_pedidos where store_id = :loja and order_id = :pedido
),
cli as (
  select shopify_client_id as c from tracking_checkouts
   where store_id = :loja and checkout_token in (select checkout_token from ck)
  union
  select visitor_id from tracking_events
   where store_id = :loja and checkout_token in (select checkout_token from ck) and visitor_id is not null
),
vis as (
  select visitor_id from tracking_identities
   where store_id = :loja and shopify_client_id in (select c from cli)
)
select distinct on (f.event_id) f.*
  from tracking_events f
 where f.store_id = :loja
   and (f.visitor_id in (select c from cli) or f.visitor_id in (select visitor_id from vis))
 order by f.event_id, f.created_at;
```

D. RPC DO FEED (proposta)

```sql
create or replace function public.tracking_feed(p_store_id uuid, p_antes timestamptz default now(), p_limite int default 100)
returns table (criado_em timestamptz, enviado_em timestamptz, latencia_s numeric, evento text, fonte text,
               destino_id uuid, plataforma text, status text, tentativas int, erro text, com_clique boolean,
               origem_host text, utm_source text, utm_campaign text, pedido text, event_id text)
language sql stable security invoker set search_path = public, pg_temp as $$
  select e.created_at, e.sent_at, extract(epoch from (e.sent_at - e.created_at)), lower(e.event_name),
         case when lower(e.event_name) = 'purchase' then 'webhook'
              when e.checkout_token is not null then 'pixel' else 'tema' end,
         e.destination_id, e.destination, e.status, e.attempts, e.last_error,
         case e.destination
           when 'meta' then nullif(e.payload->'user_data'->>'fbc','') is not null
           else coalesce(nullif(e.payload->>'gclid',''), nullif(e.payload->>'gbraid',''), nullif(e.payload->>'wbraid','')) is not null
         end,
         substring(e.referrer from '^https?://([^/:?#]+)'),
         substring(coalesce(e.payload->>'event_source_url', e.payload->>'pageUrl') from '[?&]utm_source=([^&#]*)'),
         substring(coalesce(e.payload->>'event_source_url', e.payload->>'pageUrl') from '[?&]utm_campaign=([^&#]*)'),
         case when lower(e.event_name) = 'purchase' then e.order_id end,
         e.event_id
    from tracking_events e
   where e.store_id = p_store_id and e.created_at < p_antes
   order by e.created_at desc
   limit least(greatest(p_limite, 1), 200);
$$;
revoke all on function public.tracking_feed(uuid, timestamptz, int) from public, anon;
grant execute on function public.tracking_feed(uuid, timestamptz, int) to authenticated, service_role;
```

Conferir depois com has_function_privilege, como manda a migration 027.

E. DIAGNÓSTICO EXTRA (o que falta na /tracking)

```sql
select store_id,
  max(created_at) filter (where visitor_id is not null and checkout_token is null) as ultimo_tema,
  max(created_at) filter (where checkout_token is not null)                         as ultimo_pixel,
  min(next_attempt_at) filter (where status = 'pendente')                           as pendente_mais_antigo,
  percentile_cont(0.95) within group (order by extract(epoch from sent_at - created_at))
    filter (where status = 'enviado')                                               as latencia_p95_s,
  count(*) filter (where status = 'falhou' and destination = 'meta' and response->'error'->>'code' = '190') as meta_token_invalido
from tracking_events
where store_id = any(:ids) and created_at > now() - interval '24 hours'
group by store_id;

select store_id, max(received_at) as ultimo_pedido_webhook
  from shopify_webhook_events
 where topic = 'orders/create' and store_id = any(:ids)
 group by store_id;
```

F. REGRAS DE ALERTA (padrões sugeridos; os números são palpite meu, ajustar com o Arthur)

A cada 10 min, só SQL:
- R1 app_desinstalado: stores.uninstalled_at não nulo e rastreamento ligado. Crítico.
- R2 meta_token_invalido: linha 'falhou' do Meta com response->'error'->>'code' = '190' na última hora. Crítico; a chave é destination_id.
- R3 envios_falhando: 3 ou mais 'falhou' por destino na última hora, ou qualquer 'falhou' de compra. Crítico na compra, aviso no funil.
- R4 fila_travada: min(next_attempt_at) dos pendentes mais de 30 min atrás, sinal de que o cron do drain parou. Crítico; regra global.
- R5 checkouts_sem_pedido: 3 ou mais payment_info (pixel) nas últimas 6 h e nenhum orders/create no mesmo período. Crítico. É o sinal mais forte de webhook parado, porque não confunde com "ninguém comprou".
- R6 sem_pedido_incomum: média de 4 ou mais pedidos/dia nos últimos 7 dias e nenhum orders/create nas últimas 12 h. Aviso.
- R7 pixel_checkout_parou: web_pixel_visto_em entre 7 dias e 6 h atrás, com 5 ou mais add_to_cart do tema nas últimas 6 h. Aviso.
- R8 tema_parou: zero linhas do tema nas últimas 6 h, mas com linhas do pixel ou orders/create no período. Aviso. Vale só onde algum destino aceita view_item/add_to_cart.
- R9 teto_atingido: teto_atingido_em na última hora. Aviso.

De hora em hora (`getUTCMinutes() < 10`), reaproveitando o código da tela:
- R10 a R13: `diagnosticar(ligadas)` mais `saudeDaLoja()` dão webhook não inscrito, N pedidos sem compra no destino X, nenhuma venda creditada a anúncio no Meta ou no Google, e modo teste.
- Precisa de uma variante de `getPainelTrackingAdmin(storeIds)`. Com service_role a RLS é ignorada, então o próprio cron monta a lista de lojas.

Fase 3 (com o sync de gasto):
- R14 gastou_sem_vender: gasto de hoje no fuso da conta ≥ X, e nenhum pedido desde 00:00 desse fuso. Só avalia se o último sync tiver até 45 min. Crítico.
- R15 roas_abaixo_be: receita (convertida para a moeda da conta) ÷ gasto < 1 ÷ margem, com gasto ≥ mínimo. Aviso; 3 dias seguidos vira crítico.
- R16 sync_atrasado: agora − ultimo_sync_ok_em > 3 × o intervalo, ou erro de token. Crítico.
- R17 conta_bloqueada: account_status do Meta diferente de 1. Crítico.

G. TABELA DE ALERTAS E ANTI-SPAM

```sql
create table public.alertas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  store_id uuid references public.stores on delete cascade,
  regra text not null,
  chave text not null default '',
  severidade text not null check (severidade in ('critico','aviso')),
  titulo text not null,
  detalhe text,
  aberto_em timestamptz not null default now(),
  confirmado_em timestamptz not null default now(),
  falsos_seguidos int not null default 0,
  notificado_em timestamptz,
  n_notificacoes int not null default 0,
  silenciado_ate timestamptz,
  resolvido_em timestamptz
);
create unique index alertas_aberto_key on public.alertas (store_id, regra, chave)
  nulls not distinct where resolvido_em is null;  -- PG15+; ou coalesce(store_id, '0000...')
```

RLS: o dono lê; escrita só por service_role.

Fluxo por execução:
1. Condição verdadeira e nenhum alerta aberto: o insert abre o alerta. O índice único torna isso idempotente mesmo com duas execuções concorrentes. Notifica.
2. Condição verdadeira e alerta já aberto: atualiza confirmado_em e zera falsos_seguidos. Renotifica só se for crítico e agora − notificado_em > 6 h. Respeita silenciado_ate.
3. Condição falsa: falsos_seguidos + 1. Quando chega a 2, resolve e manda "voltou ao normal" com disable_notification=true.
4. Avisos: uma notificação ao abrir; depois só entram num resumo diário (por exemplo, às 09:00 de America/Sao_Paulo).
5. Uma mensagem por execução e por chat, juntando os alertas, com até 4.096 caracteres. Tratar o 429 esperando parameters.retry_after.

H. ENVIO PELO TELEGRAM (texto puro, sem parse_mode, para não depender de escapar HTML; a regra de escape do modo HTML não foi verificada no trecho lido)

```ts
const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: texto.slice(0, 4096),
    disable_notification: silencioso,
    link_preview_options: { is_disabled: true },
  }),
});
const j = await r.json(); // { ok, result } ou { ok:false, error_code, description, parameters?: { retry_after } }
```

O campo link_preview_options.is_disabled não foi confirmado no trecho lido. NUNCA logar a URL: ela contém o token.

I. COMPARATIVO (o que cada coluna exige)

- Pedidos: `tracking_pedidos` (fase 0), ou a lista de pedidos de 7 dias que `diagnosticar` já busca na Shopify.
- Compras enviadas: já existe, pela `tracking_painel` (order_ids por destino).
- Recebidas pelo Meta: /{pixel}/stats?aggregation=event&event_source=SERVER_ONLY.
- Atribuídas pelo Meta: insights com time_increment=1, action_report_time=conversion (alinha com a data do pedido) e use_unified_attribution_setting=true, lendo actions offsite_conversion.fb_pixel_purchase. Que esse tipo inclua os eventos do CAPI não está verificado.
- Atribuídas pelo Google: GAQL com segments.date, segments.conversion_action_name e metrics.conversions_by_conversion_date, filtrando a conversion action de compra.
- Apoio: tabela conta → loja; moeda da conta (account_currency; customer.currency_code no Google, não verificado); fuso da conta (timezone_name; customer.time_zone, não verificado); câmbio do dia.

Como ler as diferenças:
- Meta mais Google acima dos pedidos é normal (atribuição dupla e visualização de 1 dia).
- Meta atribuído acima de Meta recebido, ou recebido acima dos enviados: suspeita de Purchase em dobro pelo navegador.
- Google atribuído bem abaixo das compras enviadas COM gclid: o Google está descartando, ou o rótulo está errado.

J. ARMADILHAS DO REPO
- Vendas sem clique: ler do payload, não do texto do last_error (lição da migration 051).
- A compra usa total_price e currency da LOJA (USD na Lash Bestie), não o que o cliente pagou (EUR). Para ROAS, usar total_price_set de forma consistente.
- A /tracking roda o `diagnosticar` a cada carregamento (force-dynamic). Não repetir isso no feed com polling: o feed lê só o banco.
- Scripts de operação rodam com `npm run op` e passam por `npm run typecheck:scripts`. O cron de alertas é código do app e passa pelo typecheck normal.
- Docs locais do Next 16.3.4 consultadas: route segment config `maxDuration` em node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md. O cron novo segue o padrão do drain (export const maxDuration e uma entrada em functions no vercel.json).

### Riscos

1. CAPI preso numa versão antiga do Meta. `src/lib/tracking/meta-capi.ts` usa a Graph API v21.0. A tabela de versões da Marketing API diz que a v21.0 expirou em 09/09/2025. A tabela da Graph API diz que ela vai até 21/01/2027. Depois de expirada, a chamada só é promovida automaticamente se o endpoint não tiver mudado; se tiver, ela FALHA. Os envios estão saindo hoje, mas é um risco silencioso. Qualquer código novo de insights deve usar a versão vigente (v25 ou v26), e vale atualizar o CAPI.
   Fontes: https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/versions, https://developers.facebook.com/docs/graph-api/changelog/versions, https://developers.facebook.com/docs/marketing-api/overview/versioning

2. Shopify Admin API aposentada. `SHOPIFY_API_VERSION = "2024-10"` (`src/lib/shopify/client.ts:5`). A 2024-10 não está mais acessível, e a Shopify responde pela estável mais antiga ainda acessível (hoje 2026-01, acessível até 16/01/2027). O comportamento pode mudar sem aviso.
   Fonte: https://shopify.dev/docs/api/usage/versioning

3. checkout_token deprecated. O campo está marcado como deprecated no recurso REST Order. A cascata de identidade da compra e a jornada exata dependem dele.
   Fonte: https://shopify.dev/docs/api/admin-rest/latest/resources/order

4. Jornada incompleta por desenho:
   - só existe linha de funil se algum destino aceitar o evento;
   - não existe page_view;
   - a junção por hash só funciona onde há destino Meta;
   - as identidades guardam o estado mais recente (os click ids são sobrescritos no upsert);
   - retenção: 90 dias para identidades e eventos enviados, 30 dias para falhos e checkouts;
   - teto de 120 linhas por visitante por dia.

5. Origem da identidade da compra não fica gravada. Hoje não dá para medir quantas compras vieram por "visitante", "checkout" ou "nenhuma"; esse dado só aparece na resposta HTTP do webhook.

6. Alerta falso em loja de pouco volume. Sem piso mínimo, histerese e cooldown, o Arthur aprende a ignorar o Telegram. O alerta por hora também custa 4 ou mais chamadas à Shopify por loja ligada.

7. Token do Telegram. Fica numa variável de ambiente da Vercel e nunca no banco nem em log, porque a URL da chamada contém o token. Se vazar, gerar outro com /token no BotFather. getUpdates para de funcionar se um webhook do bot for configurado.
   Fontes: https://core.telegram.org/bots/features#botfather, https://core.telegram.org/bots/api

8. PII no feed. O payload de `tracking_events` tem IP e user agent em texto claro e hashes de PII, e o dono da loja lê pela RLS. O feed deve devolver só colunas tratadas, nunca o payload.

9. Realtime do Supabase. postgres_changes numa tabela que recebe escrita a cada pageview autoriza cada evento contra cada assinante e processa numa thread só. Usar polling.
   Fonte: https://supabase.com/docs/guides/realtime/postgres-changes

10. Números das plataformas mudaram:
   - o Meta removeu 7d_view e 28d_view em 12/01/2026: chamada com essas janelas volta vazia, sem erro;
   - desde 06/08/2026 os breakdowns horários podem vir vazios em algumas contas;
   - a atribuição das plataformas nunca vai bater 1:1 com os pedidos.
   Fontes: https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/, https://developers.facebook.com/docs/marketing-api/insights/breakdowns/

11. Google aceita sem contar. O /pagead/conversion responde 200 mesmo quando ignora a conversão. Sem o comparativo, "enviado" continua sem prova de que foi contado (o próprio rodapé da /tracking reconhece isso).

12. Webhook removido pela Shopify. Ela tenta de novo até 8 vezes em 4 horas; se as falhas persistem, remove a inscrição, e a resposta precisa sair em até 5 s. A regra "webhook não inscrito" de hora em hora cobre esse caso.
   Fonte: https://shopify.dev/docs/apps/build/webhooks/troubleshooting-webhooks

13. Moeda e fuso. A compra sai na moeda da loja (USD na Lash Bestie), enquanto o cliente paga em EUR. O gasto vem na moeda e no fuso da conta de anúncio. ROAS e "gastou hoje" sem câmbio e sem fuso por conta dão números errados.

14. Hipótese não verificada: Purchase em dobro no Meta. Se o app nativo da Shopify para Facebook/Instagram também manda Purchase com outro event_id, o Meta conta em dobro. Isso só aparece comparando "recebido" pelo /stats (WEB_ONLY e SERVER_ONLY) com os pedidos.

15. Permissões não verificadas: se o token do CAPI já gravado consegue ler /{pixel}/stats e /insights, e o passo a passo exato do token de usuário do sistema com ads_read.

### O que só o Arthur pode fazer

Coisas que só o Arthur pode fazer (nenhum token deve ser colado no chat).

1. Criar o bot do Telegram (fase 2)
   - a) No Telegram, abrir @BotFather e mandar /newbot.
   - b) Dar um nome e um username de 5 a 32 caracteres, só letras, números e _, terminando em "bot" (por exemplo, xcart_alertas_bot).
   - c) O BotFather devolve o token, no formato 110201543:AAH…. Guardar como senha.
   - d) Abrir a conversa com o bot novo e mandar /start. Se quiser os alertas num grupo, adicionar o bot ao grupo e mandar qualquer mensagem lá.
   - e) No navegador, abrir https://api.telegram.org/bot<TOKEN>/getUpdates e copiar o número em "chat":{"id": …}. Grupo tem id negativo. Isso só funciona enquanto não houver webhook configurado no bot, e as mensagens ficam guardadas até 24 h.
   - f) Na Vercel (Project > Settings > Environment Variables, ambiente Production), criar TELEGRAM_BOT_TOKEN e, no MVP, TELEGRAM_CHAT_ID. Depois, um redeploy.
   - Fontes: https://core.telegram.org/bots/tutorial, https://core.telegram.org/bots/features#botfather, https://core.telegram.org/bots/api

2. Definir os parâmetros das regras
   - Margem de contribuição por loja, antes do ads: define o ROAS de break-even = 1 ÷ margem.
   - Valor de "gastou X sem vender" por conta, na moeda da conta.
   - Piso de volume para "sem pedido há N horas".
   - Horário do resumo diário.
   - Se quer receber os avisos ou só os críticos.

3. Mapear conta de anúncio → loja
   - Listar as contas do Meta e do Google e a loja de cada uma.
   - Atenção: AW-18463833677, AW-18463882690 e AW-18419000686 são IDs de conversão (tag). O script e a API usam o ID de CLIENTE da conta, no formato 123-456-7890, que aparece no canto do Google Ads. Que os dois são números diferentes é conhecimento comum, não foi verificado nesta pesquisa.

4. Gasto do Meta (fase 3)
   - No Business Manager, criar um usuário do sistema com acesso às contas de anúncio e gerar um token com ads_read.
   - Colar o token no campo de segredo do app, não no chat.
   - Exigência de ads_read ou ads_management: https://developers.facebook.com/docs/marketing-api/reference/ad-account/insights/ (o passo a passo do usuário do sistema não foi verificado aqui).

5. Gasto do Google (fase 3): escolher um dos dois caminhos
   - (A) Google Ads Script. Em cada uma das 3 contas: Ferramentas > Ações em massa > Scripts > novo script > colar o script que o xcart fornecer > Autorizar > agendar de hora em hora. Custo zero, sem Cloud.
   - (B) Google Ads API. O developer token foi aposentado em 09/09/2026 e MCC não é mais exigida. Criar um projeto no Google Cloud, configurar o consentimento OAuth e, em console.cloud.google.com/google/ads-apis/overview, pedir o nível Explorer (2.880 operações por dia em produção, sem verificação de marca).
   - Fontes: https://developers.google.com/google-ads/api/docs/get-started/dev-token, https://developers.google.com/google-ads/api/docs/api-policy/access-levels, https://support.google.com/google-ads/answer/188712?hl=en

6. Conferência rápida para o comparativo
   - No Events Manager, abrir o dataset/pixel da Lash Bestie e ver se o evento Purchase chega também pelo navegador (por exemplo, pelo app da Shopify para Facebook) além do servidor.
   - Se chegar com outro event_id, o Meta pode estar contando a venda em dobro.

7. Aprovar a fase 0 antes de qualquer tela: gravar no webhook o checkout_token e a origem da identidade (tabela `tracking_pedidos`). Só vale para pedidos daqui para frente, então quanto antes entrar, mais histórico a jornada e o ROAS terão.
