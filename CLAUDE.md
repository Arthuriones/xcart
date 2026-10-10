@AGENTS.md

# xcart

> **Full technical reference: [`ARCHITECTURE.md`](./ARCHITECTURE.md)** — read it for the complete picture. This file is the quick orientation.

## The core idea (most important thing to understand)

xcart is a dropshipping tool built around a **two-store "routed checkout"** model:

- **Vitrine (showcase / source store)** — gets the ad traffic. Carries **branded/replica** products (real brand names, replica models, logos). Customer browses and adds to cart here.
- **Loja checkout (dark store / target store)** — where payment actually happens. Same catalog but **neutralized**: brand/replica names removed from title/description/tags (generic wording) and product photos **replaced by AI-generated de-branded images**.

At checkout, the cart is **routed vitrine → checkout store, matched by SKU**, and the customer is redirected (Shopify cart permalink) to the checkout store's checkout in the right currency. The two stores never appear linked (`no-referrer`).

A vitrine can point at **several checkout stores at once** and the traffic is split between them (rotation — see ARCHITECTURE.md §10.2), so one payment account going down doesn't take the vitrine with it. Each checkout store carries its own `sku_map` (`routed_checkout_targets`), because variant ids differ per store. The draw only ever happens between targets that cover the cart equally well — **rotation never costs a cart line**.

**Everything hinges on SKU.** Neutralization rewrites titles/images, so SKU is the only stable join key between the two stores. No SKUs on the vitrine → routing can't work. When editing the checkout store, you may freely change title/description/tags/images but **never change or delete variants/SKUs** — that breaks the route.

Also does: multi-source import/clone (AliExpress, Shopify, WooCommerce, Shoplazza, generic sites), AI optimize/translate/neutralize, AI store setup (policies/menus/pages/reviews/Instagram), Stripe billing + credits.

## Stack (current)
- **Next.js 16** (App Router, standalone) + TypeScript + Tailwind v4 + shadcn/ui. React 19. Interface so em portugues (`src/lib/textos.ts` + `messages/pt.json`).
- **Supabase** — Auth (password + magic link), Postgres (RLS), Storage. Service-role admin client bypasses RLS.
- **Gemini** — `gemini-2.5-flash` (text), `gemini-2.5-flash-image` (images). Needs `GEMINI_API_KEY`.
- **Shopify** — Admin GraphQL `2024-10`, **Client Credentials Grant** (creds per-store in Supabase `stores`). `write_themes` NOT available this way.
- **Stripe** — subscriptions + credit packs. **Background jobs = Supabase-table queue + Vercel cron** (NOT Inngest/BullMQ).
- **Scraping** — cheerio + Playwright/`@sparticuz/chromium` + Bright Data proxy. `sharp` for images.
- Deploy: **Vercel** (primary, hourly cron) + Docker.

## Trabalho de loja x trabalho de projeto

O repo carrega duas coisas: o **app** (`src/`) e os **scripts de operacao**
(`scripts/`) -- reprecificar catalogo, importar produto, consertar rota. Sao
rodados a mao com `npx tsx`, nunca importados pela aplicacao.

Eles ficam FORA do type-check do build e fora do deploy:

- `npm run op -- scripts/<arquivo>.ts <args>` -- **e assim que se roda script**,
  nao com `npx tsx` direto. E `npx tsx --conditions=react-server`: sem essa
  condicao, todo `import "server-only"` lanca no arranque e o script nem comeca.
  Metade de `src/lib/tracking/` tem esse import (ele impede que credencial de
  anunciante vaze para o bundle do cliente), e o caminho do Meta em
  `configurar-tracking.ts` ficou quebrado por isso sem ninguem notar -- o
  caminho do Google retornava antes de chegar no import.
- `npm run typecheck` -- o app. E o que o build da Vercel roda.
- `npm run typecheck:scripts` -- os scripts. **Rode antes de commitar script.**
- `npm test` -- vitest. Cobre a paridade do sorteio do rodizio (loader x
  servidor) e a repartição de 100% da tela de Vendas.
- `vercel.json` tem `ignoreCommand`: commit que so toca `scripts/` nao gera
  deploy.

O motivo e concreto: um campo inventado em `scripts/consertar-rota.ts` derrubou
tres deploys seguidos do app, num arquivo que a aplicacao nem le.

## Multi-host
`adm.*` = admin, `user.*` = app/dashboard, other host = marketing landing only. Logic in `src/proxy.ts` → `src/lib/supabase/middleware.ts`.

## Where things live
- Routing: `src/app/api/checkout-routes/*`, `public/routed-checkout-loader.js`, `src/lib/shopify/cart-routing.ts`, `src/lib/checkout-routes/*` (rotation, targets, embed config, heal), `src/components/routed-checkout/*`
- Shopify + AI: `src/lib/shopify/client.ts`, `src/lib/gemini/client.ts`, `src/lib/ai/product-neutralizer.ts`, `src/lib/store-context.ts`
- Import/jobs: `src/lib/import/*`, `src/lib/aliexpress/*`, `src/lib/jobs/*`, `src/app/api/jobs/*`
- Data: `supabase/migrations/001-031_*.sql` (see ARCHITECTURE.md §5 for every table)

## StoreContext drives all AI
Every AI call receives `StoreContext` (name, niche, target_audience, brand_voice, store_description, **target_language**) from `getStoreContext(storeId, userId)`. API routes fetch it server-side by `storeId`; if `niche` is empty the AI route 400s. `target_language` forces the output language.

## Key gotchas (see ARCHITECTURE.md §13)
- Routing needs SKUs on both stores; generic-site imports often have none.
- `create-destination` neutralizes before dedup and runs one-shot → times out on big catalogs. Use the wizard **"Só conectar"** mode when the catalog already exists.
- Bulk-import queue has no atomic claim / stale recovery (image queue does).
- `write_themes` needs Shopify CLI + Theme Access password, not this app.
- Some prompts/strings still hardcode BR (CDC/LGPD, "R$89") — verify against `target_language`.
- **O tema da vitrine guarda uma copia do mapa** (`xcart-config.json`), e o loader roteia por ela ANTES da API. `src/lib/checkout-routes/tema-vitrine.ts` reenvia sozinho depois do conserto, do Corrigir, do liga/desliga, de peso/pausa/teto/tirar loja e de loja nova (compara por hash em `settings.theme_sync`; so escreve se mudou; falha espera 6 h, tema em dia revalida 1x/dia). So mexe no script DESTA rota e so se ele ja le o config embutido -- nunca instala sozinho. O script aponta para `{{ 'xcart-config.json' | asset_url }}` (segue o tema publicado), nao para uma URL fixa com `/t/N/` e `?v=`. Rota pausada vai sem destino (o loader pergunta a API, que recusa) -- e por isso o botao Instalar RECUSA rota pausada (409 `rota_pausada`): instalar assim trava o checkout da vitrine. **Legado so com ZERO linhas de destino**: todas pausadas = rota nao roteia (`destinosParaRotear`). Erro do banco ao ler os destinos NAO e "zero linhas": `loadRouteTargets` lanca `RouteTargetsLoadError`, o resolve responde 503, o conserto para, e nada vai ao tema.
- **O conserto mapeia sempre e cria so com o par de lojas aprovado** (`decidirCriacao` em `conserto-regras.ts`): rota e destino ligados, peso > 0, >= 70% da vitrine com par e no maximo 20 produtos novos por passada. Fora disso grava `last_heal` ok=false ("N produtos faltam ... confirme em Diagnostico") e so cria com `criarFaltantes` -- que vale para UMA loja de checkout (`targetId` no repair; sem ele, so em rota de uma loja). O Diagnostico mostra a pendencia e o botao de cada loja. Antes de criar ele adota o par do `variant_map` antigo quando o SKU da vitrine mudou (`parPeloMapaAntigo`), e em SKU repetido fica com ele a variante ja mapeada, senao a de menor id (`normalizarSkus({ mapeadas })`). **O mapa gravado e podado, nao so acrescido** (`podarMapas`): par com alvo apagado no checkout sai (so com o indice do checkout completo -- a consulta traz 50 variantes por produto), e variante da vitrine que ficou sem par perde o par antigo que e de outra variante -- o loader le o variant_map ANTES do sku_map. **Produto do checkout que mistura produtos da vitrine** (a "Arque" da NORAH OUTLET) nao ganha variante nem par novo: vira aviso ate o lojista separar. "Adicionar loja" exige >= 50% de cobertura e recusa vitrine de outra rota; toda rota nasce com a linha do destino (`garantirDestinoPrimario`).
- The rotation draw is mirrored in the loader and on the server — the two hashes must stay identical or a buyer switches checkout store mid-purchase. **Travado por `tests/rotation-parity.test.ts`**, que le o loader do disco e compara com o servidor. A fila ordena por `id || domain` nos dois lados: `embed-config` manda `id: null` de proposito em rota legada, e ordenar so por id divergia. **Teto de pedidos/dia por destino** (`daily_limit`, migration 062): conta `routed_checkout_orders` nas ultimas 24 h (gravada pelo webhook orders/create de cada loja de checkout, ANTES da trava do rastreamento); destino cheio sai do sorteio DEPOIS da cobertura, e o teto e macio (todos cheios, o carrinho vai assim mesmo). Rota com teto nao sorteia inline: o loader cai na API, que e quem conhece a contagem. Ver `pedidos-24h.ts` e `tests/rotation-limite-diario.test.ts`.
- **Pais/moeda do checkout e POR LOJA DE CHECKOUT** (`routed_checkout_targets.settings`, regra unica em `src/lib/checkout-routes/mercado.ts` para o resolve e o config do tema): nada gravado = pais do `target_language` (o comportamento antigo, `en-US` vira `country=US` para o mundo todo), `checkout_country = "auto"` = sem country (a Shopify geolocaliza), `"CL"` = fixo. O `settings` da ROTA so vale para rota legada sem linha de destino. Cupom do carrinho da vitrine vai como `?discount=` (so o codigo, mesma validacao no loader e no servidor; o cupom precisa existir na loja de checkout). Casar de novo uma loja que ja esta na rota mantem settings e peso (`destino-conectado.ts`).
- **Sensor do roteamento** (`src/lib/checkout-routes/sensor.ts` regras, `sensores.ts` banco/rede): `orders/create` em cada loja de checkout ligada e `checkouts/create` na vitrine de cada rota ligada -- os DOIS exigem `read_orders` (`write_orders` tambem serve; NORAH, NORAH OUTLET, Stepz e Stepz Club nao tinham escopo de pedido nenhum em 08/10: 0 pedidos contra centenas de carrinhos). Inscreve no fim do cron do conserto (1x/dia por loja, estado em `settings.webhook_pedidos` do destino e `settings.webhook_vitrine` da rota, sem migration), ao criar rota/adicionar loja e no "Testar agora" (so o pendente). Callback sempre `NEXT_PUBLIC_APP_URL`, nunca a origem do cron; inscricao em host antigo nosso (`shopify-creator-chi.vercel.app`) vale, para nao entregar cada pedido duas vezes. Checkout na vitrine vira `routed_checkout_fallbacks` reason `checkout_na_vitrine` SO com SKU/variante/quantidade; dedupe pelo token pela PK de `shopify_webhook_events` (`checkout:<loja>:<sha256>`); loja que tambem e checkout de rota ligada nao conta. O escape e um PISO: a doc nao diz em que passo o checkout nasce. Funil de 7 dias na Visao da rota (`leitura/funil-rota.ts`, so contagem head -- linha corta em 1000): loja sem o aviso mostra o motivo, nunca "0 pedidos". `routed_checkout_orders` guarda 8 dias. Alertas `roteamento_*` em `avaliar.ts` (regras em `alertas/roteamento.ts`). **`last_heal.falhas` conta passadas seguidas POR LOJA DE CHECKOUT** (`routed_checkout_targets.settings.last_heal`; o da rota e so a ultima passada, para o card): com rodizio, o contador da rota ia 0,1,0,1 e o "3 seguidas" nunca abria. O formato do `last_heal` (rota e destino) e um so, `UltimoConserto` em `ultimo-conserto.ts`: motivo/lado/proximaTentativa da loja fora do ar + `falhas` (+ `conferencia` no destino). **Loja fora do ar nao entra no contador**: `roteamento_loja_fora_do_ar` (critico: sem app/credencial revogada, pausada pela Shopify, fechada) e `roteamento_vitrine_com_senha` (aviso, avisa uma vez) abrem na PRIMEIRA passada, um por rota; o "Conserto falhando" e so falha comum. Toda loja fora do ar lanca `HealRouteError` com `registrado: true` -- o cron gravar de novo contaria a passada duas vezes e apagaria a `proximaTentativa`. "Script sumiu" compara com as mesmas 6 h de ontem e anteontem (>= 5 sinais em cada), nao com as 72 h: vitrine pequena fica 6 h sem visita de madrugada. So vitrine fora (`lado: "vitrine"`) suprime o script sumido. **O `track-fallback` so grava os motivos do loader** (`motivoDoLoader`): o token esta no HTML da vitrine, e `checkout_na_vitrine` forjado abriria o alerta critico.
- **Policy de UPDATE/INSERT precisa de `WITH CHECK`, nao so `USING`.** `USING` prende a linha ANTIGA; sem `WITH CHECK` a linha NOVA nao e validada e o usuario reatribui o dono -- ou, em `profiles`, se promove a `is_admin`. Ver migration 030.
- **URL vinda do usuario NUNCA vai direto para `fetch`.** Use `safeFetch`/`assertUrlPublica` de `src/lib/net/safe-url.ts`: resolve o DNS e recusa rede privada, link-local e loopback, revalidando cada redirect. `normalizeShopDomain` so valida FORMATO -- `metadata.google.internal` e `169.254.169.254.nip.io` passavam por ela.
- **Rastreamento: um rotulo por evento, e dois caminhos de entrada.** No Google
  Ads cada evento e uma conversion action propria com rotulo proprio -- o `AW-`
  e da conta, o rotulo muda por evento. O mapa esta em
  `tracking_configs.google_labels`; `google_conversion_label` e legado, so
  fallback de leitura da compra, e quem grava espelha as duas (valor velho na
  coluna faz a compra continuar saindo depois de o rotulo sair do mapa). A
  compra vem do webhook `orders/create`; ver produto, carrinho e checkout nao
  tem webhook na Shopify, entao vem do snippet do tema para
  `/api/tracking/collect`. Catalogo em `src/lib/tracking/eventos.ts`, travado
  contra o snippet por `tests/tracking-eventos.test.ts`.
- **Advertorial no meio do caminho perde o click id, e o conserto e no
  advertorial.** O `?gclid=` chega na URL do ADVERTORIAL; o cookie que ele
  gravaria fica no dominio dele, e a loja nao pode ler cookie de outro dominio.
  Se o CTA nao levar o parametro adiante, a venda vira "direto" -- a conversao
  sai, sem ligacao com o anuncio. `public/xcart-bridge.js` reescreve os links do
  CTA; a loja nao muda nada, porque o snippet de la ja le da URL.
  `data-xcart-destinos` e obrigatorio e sem curinga: reescrever "todo link
  externo" entregaria o gclid para o Instagram e o WhatsApp da pagina. A lista de
  parametros dos dois arquivos e travada por
  `tests/tracking-ponte-advertorial.test.ts`. **VSL com link DIRETO para o checkout** (permalink `/cart/VARIANTE:QTD`): nenhuma pagina do tema roda, entao ninguem leria o `?fbclid=`; a ponte grava os mesmos valores como `attributes[...]` no permalink (e os cookies `_fbp`/`_fbc`/`_ttp` dos pixels da propria VSL), o `xcart-pixel.js` le `checkout.attributes` (`DO_CARRINHO`) e manda ao coletor, e o pedido nasce com eles em note_attributes. So em `/cart/ALGO`; pagina do tema continua lendo o parametro solto. Com `data-xcart-store` + `data-xcart-shop` a ponte tambem avisa o coletor (`fonte: "ponte"`): `page_view` (catalogo, origem `ponte`, Meta `PageView`/TikTok `Pageview`, sem rotulo no Google) ao abrir e `view_item` da variante do primeiro botao `/cart/ID:`; gera `_fbp` quando falta, nunca `_fbc`, e leva `_xcb_vid` ao permalink como `attributes[_xc_vid]`. A pagina NAO deve ter o pixel do Meta no navegador (dobraria).
- **`/api/tracking/collect` e publico e NAO aceita valor monetario.** Quem
  dispara e o visitante: nao ha sessao. Valor vindo dali seria numero que
  qualquer um infla na conta de anuncios do lojista, e valor de conversao
  inflado distorce o lance automatico. Nao "conferimos o Origin" -- e escolhido
  pelo cliente. O que limita e teto por visitante/loja e o indice unico da fila.
- **Checkout expresso (Shop Pay, Apple/Google Pay) nao passa pelo Web Pixel**: o InitiateCheckout dele e o clique no tema (`origem: "expresso"`, so Meta), que fura a supressao do pixel -- nao mande ao Google nem tire a excecao. **O pixel vence, o clique e reserva**: o tema nao separa a carteira do "Comprar agora" no shadow fechado, e o "Comprar agora" cai no checkout normal. Entao o coletor grava o expresso `pendente` com `next_attempt_at` +5 min (sem `entregar` na hora), recusa se o mesmo comprador (visitor_id do tema ou clientId -- sem clientId no corpo, o da `tracking_identities` do visitante) ja teve begin_checkout em 30 min, e o begin_checkout do pixel -- ou o clique comum, sem pixel -- cancela o pendente (`enviado` sem `sent_at`). Sem clientId (consentimento negado zera), o pixel le o cookie `_xc_vid` por `browser.cookie` e manda `vidDoTema`, e o coletor cancela por ele. **Escreve primeiro, confere depois**: quem cancela so cancela depois de gravar a propria linha (e nao se der `duplicado`); o expresso grava e reconfere, e se fecha se ja houver begin_checkout comum. O drain rele o status do `begin_checkout_xp_*` antes de mandar, e todo desfecho de `entregar` so grava sobre `pendente`. O snippet usa `repetido("begin_checkout_xp")`, chave propria. A dedupe de 10 min do pixel ignora `begin_checkout_xp_*`. clientId na linha: migration 057; o painel nao conta o cancelado: 058. Travado por `tests/tracking-checkout-expresso.test.ts`. O expresso vale igual para o TikTok.
- **TikTok Ads sai pelo servidor no molde do Meta** (Events API, `POST /open_api/v1.3/event/track/`, `src/lib/tracking/tiktok-api.ts`): destino `plataforma='tiktok'` com `conta` = Pixel Code ALFANUMERICO (nao arranque as letras como no id do Meta), token em `tracking_destination_secrets` mandado no header `Access-Token`. **Sucesso e `code === 0`, nao o HTTP 200** -- o TikTok responde 200 com erro. A fila despacha por `linha.destination`; o payload da linha e o evento do TikTok (`event`, `user`, `page`, `properties`), com o MESMO `event_id` do Meta e `event_name` da fila igual (`Purchase` na compra). Compra = `Purchase` (nao `CompletePayment`/`PlaceAnOrder`); valor e moeda so do webhook. Telefone em E.164 COM '+' antes do hash (hash diferente do Meta). Migration 059 (CHECKs, `tracking_identities.ttp`, painel/feed lendo `payload.user.ttclid`) antes do deploy. Travado por `tests/tracking-tiktok*.test.ts`.
- **Em rota vitrine -> checkout, o gclid NAO chega ao pedido.**
  `buildCartPermalink` nao leva `attributes` de proposito (a loja de checkout
  nao deve saber a origem), e o pedido nasce na loja de checkout. Logo a compra
  sai sem atribuicao em loja roteada. Carrinho e checkout funcionam, porque
  acontecem na vitrine.
  **Nao va consertar isso por conta propria.** A operacao do Arthur decidiu
  (2026-09-26) rodar o anuncio DIRETO na loja de checkout, sem vitrine -- e ai
  quem recebe o clique e quem cria o pedido sao a mesma loja, o cart attribute
  sobrevive e nao existe buraco nenhum. O conserto para quem usa roteamento
  seria um token opaco no permalink, resolvido so no nosso servidor (nao o id da
  rota, que era o que existia antes e foi removido de proposito). Fica anotado,
  nao feito.
- **Contra entrega (COD) e POR PEDIDO, pelo gateway** (`src/lib/financeiro/contra-entrega.ts`, migration 068): loja mista funciona. O pedido COD tem situacao (aguardando envio, em transito, entregue a receber, pago, recusado/devolvido, cancelado); Recebido e so o que foi pago (marcar pago e opcional no COD), A receber sao os vivos, Previsto = recebido + entregues a receber + o resto x taxa de entrega (a padrao da loja ate 20 COD finalizados nos 60 dias, sem a ultima semana; COD em aberto ha mais de 21 dias conta como NAO entregue -- recusa que ninguem marca ficava fora e a taxa ia a 100%). Custo, taxa fixa convertida e recusado que voltou ao estoque saem de `contaDoPedido`/`qtdComCusto`, a mesma regra no Dashboard, no Pedidos e no por produto. O SKU sem custo dos que aguardam envio entra no aviso e na `cod.coberturaCusto`. **Salvar so "Como a loja recebe" NAO cria a linha de `fin_store_settings`** (409): a linha existir e o que diz "taxa configurada" em todo lugar. `fin_store_settings.contra_entrega` so troca os cartoes do Dashboard. Valor fixo (taxa fixa, devolucao) vem na moeda da loja e e convertido: o Releasit cria o pedido na moeda do CLIENTE (CZK numa loja USD). Sync e leitura funcionam sem a 068 (gravam/leem sem as colunas novas). Pedido online nao muda: os testes antigos do financeiro passam sem mexer no esperado.
- **Checkout externo (Sphere Affiliates primeiro, migration 069, `src/lib/checkouts-externos/`)**: a "loja" que nao e Shopify -- o pedido acontece la e o lojista ganha COMISSAO. Tabela propria (`checkouts_externos`), nunca linha de `stores`. Recebe por `POST /api/webhooks/checkout/<token>`: a Sphere nao assina nem manda header, entao a URL e a senha (token em `checkout_externo_segredos`, sem policy, so service role; busca pelo sha256). A trava e o insert em `checkout_externo_eventos (checkout, pedido, evento)`; falhou ao gravar, a trava sai e responde 503. `aplicarEvento` (`estado.ts`) nao regride: evento mais velho que `atualizado_em` so completa datas, nunca volta para pendente, pago nunca volta para aprovado. `afiliado.codigo` vai para `checkout_externo_contas` no 1o evento de cada codigo: um checkout pode ter varios (a Sphere nao garante um por conta), mas cada codigo e de UM checkout do usuario (outro checkout = 409, contaria em dobro); "Trocar URL" solta os codigos. Pausado so barra pedido NOVO (e a notificacao): evento de pedido que ja existe segue valendo, porque a Sphere manda cada movimentacao uma vez so. O evento de teste (`afiliado.codigo = "xcart-teste"`) NUNCA vira pedido. No Dashboard: `tipo: "checkout"` em `EntradaFinanceiro.lojas`, pedidos em `externos`; receita = comissao (aprovada + paga = Recebido, pendente = A receber, Previsto pela taxa de aprovacao), sem custo de produto nem taxa, e entra nos cartoes de contra entrega. `filtroResolvido()` continua com `lojas`/`lojaIds` SO Shopify e ganhou `checkouts`/`checkoutIds`/`checkout`: tela so de loja (Custos, Rastreamento, Eventos) mostra `SoLojasShopify`. Conta de anuncio liga a UMA loja OU UM checkout (`ad_accounts.checkout_id`). NAO conta no limite do plano. Tudo le com ou sem a 069 aplicada (`semMigration069`).
- **Planos (08/10/2026): 1 Loja, 3 Lojas, Ilimitado.** Catalogo unico em
  `src/lib/billing/plans.ts` (preco, limites, selo): o checkout cobra dali e a
  landing, o paywall e a Assinatura mostram dali. Os tres sao `plan = 'pro'`;
  o tier mora em `profiles.plano` (migration 064; null = Pro antigo de R$ 89 ou
  sem plano, limites do 1 Loja). **Toda rota que liga rastreamento ou poe loja
  no roteamento passa por `conferirLigarRastreamento`/`conferirRoteamento` de
  `src/lib/billing/limites.ts`** -- rota nova de escrita tambem. So barra
  ativacao NOVA: nada ligado acima do limite e desligado. Admin e
  `access_granted` nao tem limite. A Pagou nao muda o valor de assinatura
  existente: trocar de plano no cartao e pelo suporte. **Loja desinstalada
  conta no limite** (senao desinstalar/ligar outra/reinstalar abria vaga, e
  `stores.uninstalled_at` o usuario grava pela API do Supabase). **Criar rota
  e por loja nela e so pelo service role** (a 064 tira INSERT e o UPDATE de
  `source_store_id`/`target_store_id` da sessao; a tela so grava liga/desliga,
  configuracao, peso, teto e ordem). Webhook e sincronizacao da Pagou so
  aplicam a assinatura do perfil (`src/lib/billing/evento-assinatura.ts`).
  Coluna `plano` ausente: leitura da 42703, escrita da PGRST204 --
  `semColunaPlano` reconhece as duas.
- Funcao nova em `public` vira endpoint em `/rest/v1/rpc/`. Se for SECURITY DEFINER, **revogue de `public, anon, authenticated`** e conceda so a `service_role` — sao DOIS caminhos de privilegio (o grant a PUBLIC e o explicito que o default-privileges do Supabase cria), e tirar um deixa o outro. Confira com `has_function_privilege`: o comando responde sucesso sem ter revogado nada. Ver migration 027.
