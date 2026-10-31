# Plano 2 — Rastreamento no nível da Ratoeira Ads, com as redes native

> Pedido em 30/10/2026: o rastreamento do Panda Track bom e com as mesmas plataformas da Ratoeira Ads (ratoeiraads.com.br), mais Taboola e outras native. Fica de fora o "Ratoeira Pages" (construtor e hospedagem de páginas).
>
> Fontes: o site e a central de ajuda pública da Ratoeira (139 páginas), o código público do painel deles, a documentação oficial de cada rede (conferida por um segundo agente tentando refutar) e o código do Panda Track.

## 1. O que a Ratoeira é por dentro

- **Núcleo: Google Ads para afiliado com presell.** O script ("TAG Ratoeira", um por produto ou campanha) vai no `<head>` da presell. A plataforma de afiliado devolve a venda por postback, e a Ratoeira **sobe a conversão no Google pela API** (conversão offline com GCLID, GBRAID e WBRAID). Meta, TikTok e as native entraram em 2026.
- **"Modo Ratoeira" (só Google):** o mesmo IP com clique pago repetido acima do limite vira "rato", e o IP entra nas exclusões de IP das campanhas escolhidas. BOT/VPN/proxy são só etiquetas.
- **Redes no código deles: exatamente sete.** Google, Meta, TikTok, Taboola, NewsBreak, MGID e RevContent.
  - Custo pela API: só Google, Meta, Taboola e NewsBreak. TikTok, MGID e RevContent aparecem como "Em breve".
  - **Kwai, Outbrain e Microsoft não existem lá.**
- **Como mandam a conversão em cada rede:**

  | Rede | Como a conversão vai |
  |---|---|
  | Meta | pixel no navegador + CAPI |
  | TikTok | pixel + Events API |
  | Google | só o servidor (upload offline) |
  | Taboola | pixel deles no navegador |
  | NewsBreak | postback S2S |
  | MGID | postback S2S |
  | RevContent | pelo `rc_clickid` |

- **Postback universal ("Link de Notificação"):** uma URL por plataforma, e a lista passa de 100 (Hotmart, Kiwify, Eduzz, Monetizze, Cakto, Hubla, Yampi, Shopify, Cartpanda, ClickBank, Digistore24, BuyGoods, Logzz, Coinzz e dezenas de redes CPA e nutra).
  - O script põe o id da visita (`vst_...`) nos botões, e a plataforma o devolve no postback.
  - O limite "Integrações/Webhooks 7/15/ilimitado" é o número desses links.
- **Também têm:**
  - app iOS/Android com aviso de venda;
  - Telegram;
  - MCP com 5 ferramentas, só de leitura e quase tudo Google;
  - domínio próprio por CNAME para o script;
  - dashboard por país, hora e dia da semana;
  - impostos e taxas por plataforma;
  - integração com a VTurb;
  - "Criar campanha com IA", só para pesquisa no Google.
- **Não têm:**
  - regras automáticas (o Panda Track terá, ver o Plano 3);
  - rastreamento de carrinho no tema da loja: e-commerce, COD e drop são só mais uma plataforma de postback;
  - roteamento de checkout.
- **Preço:** à vista, R$ 1.897 / R$ 2.597 / R$ 4.997, ou 12× de R$ 158 / R$ 216 / R$ 416. Teto de 1.000 / 2.500 / 5.000 vendas aprovadas por mês, e R$ 0,12 / 0,10 / 0,07 por venda extra.

## 2. Onde o Panda Track está hoje (o que o código mostra)

| | Panda Track hoje | Ratoeira |
|---|---|---|
| Meta | CAPI pelo servidor + gasto pela API + detalhe por anúncio | igual (pixel + CAPI, gasto) |
| TikTok | Events API pelo servidor; **sem gasto** | Events API; sem gasto |
| Google | conversão pelo **gtag no navegador**; gasto por **script** colado na conta, sem detalhe por anúncio | **upload offline pela API**, gasto e gestão pela API, bloqueio de IP |
| Taboola, NewsBreak, MGID, RevContent | **nada**: o clique dessas redes vira "outra" | conversão nas quatro; gasto em Taboola e NewsBreak |
| Kwai, Outbrain, Microsoft | nada | nada |
| Plataformas de venda | Shopify (carrinho no tema, Web Pixel, webhook), Releasit (COD), Sphere, Cakto, Hubla, Eve | 100+ por postback |
| Evento de Lead | **não existe** | existe |
| Domínio próprio do script | não existe | CNAME |
| MCP | só loja e produto da Shopify | 5 ferramentas de leitura de vendas e Google |
| Relatório por país, hora, dia da semana | não existe | existe |
| Regras automáticas | **Plano 3** (no ar em 30/10) | não existe |

**Por que pôr uma rede nova hoje dá trabalho:**
- **Lista de plataformas fixa em cerca de 40 lugares**, com "meta | google | tiktok" escrito à mão. Alguns exemplos:
  - os CHECKs de `tracking_destinations`, `tracking_events`, `ad_accounts`, `ad_insights_granular` e `fin_order_origem`;
  - os tipos TypeScript;
  - o envio, o coletor e o webhook da compra;
  - as telas, os alertas e os testes.
- **Ids de campanha:** a regra aceita só dígitos (`^[0-9]{5,25}$`), e o Outbrain usa id em hexadecimal.
- **Click ids capturados:** o snippet, a ponte e o pixel só pegam `gclid`, `gbraid`, `wbraid`, `fbclid` e `ttclid`.

## 3. Plano

### Fase 0 — Base de redes (eu, ~3 dias). Pré-requisito de tudo.

Um **catálogo único de redes** (`src/lib/tracking/redes.ts`). Cada rede declara:
- id e nome;
- os parâmetros de click id e o cookie, se tiver;
- as macros do modelo de URL (o "Parâmetros de URL" de cada rede);
- o formato do id de campanha (só dígitos ou alfanumérico);
- o tipo de envio da conversão: CAPI com hash, ou postback por click id;
- o nome de cada evento na rede;
- se lê gasto pela API.

O resto do código passa a perguntar ao catálogo em vez de listar plataformas. Acrescentar uma rede vira: catálogo + adaptador de envio + adaptador de gasto.

O que muda junto:
- **Migration:** os CHECKs de plataforma aceitam a lista do catálogo, e o id de campanha aceita alfanumérico onde a rede usa.
- **`tracking_identities` ganha `cliques jsonb`** (um click id por rede), em vez de uma coluna por rede.
- **Snippet do tema, ponte e Web Pixel** leem a lista de click ids do catálogo (o teste que trava as listas continua).
- **Plataforma do pedido:** `plataformaDe` e `niveisDoAnuncio` reconhecem as redes novas pelo click id e pela `utm_source`. O clique da Taboola deixa de ser "outra".

### Fase H — Hotmart pelo servidor (~2 a 3 dias). Não depende da Fase 0, pode entrar antes de tudo.

> **Feita em 31/10/2026** (código na main, migration 088 aplicada). O que mudou em relação ao plano abaixo:
> - **A situação sai só do evento:** a Hotmart não manda a data de cada status, e o status de agora num aviso atrasado poria a data errada no reembolso.
> - **O pedido herda a campanha do clique:** o webhook não traz UTM. Quando o `sck` traz o visitante da ponte, a venda pega a UTM que a identidade dele guardou (7 dias antes do pedido). Isso vale para qualquer checkout de venda sem UTM no webhook.
> - **Tudo que não é erro de verdade responde 200**, porque a Hotmart desativa o webhook cuja URL dá erro. Entra aqui a transação de mais de 400 dias.
> - **O teste é o payload de exemplo da doc**, com o hottok real (changelog de 2022 e 2023).
> - **O IP é `purchase.buyer_ip`** (changelog de 11/2022).
> - **Venda em outra moeda** vai na moeda do `currency_conversion` do produtor.
> - **Fica só o `pay.hotmart.com`** como host da ponte: o `go.hotmart.com` leva à página de vendas, que é onde a ponte fica.
> - **A conferir na 1ª venda real**, que fica guardada em `ultimo_formato`: o evento do Pix gerado, a unidade do `order_date` e se o `xc.` passa no `sck`.

Pedida em 31/10/2026. O molde é o da Cakto e da Hubla, que já existem: a venda chega por webhook e o Panda Track manda a Purchase ao Meta e ao TikTok pelo servidor. Fonte: documentação oficial da Hotmart (developers.hotmart.com e a central de ajuda), conferida por um segundo agente.

**Produtor: rastreamento completo.**
- **Webhook 2.0:**
  - eventos: compra aprovada, boleto gerado ("aguardando pagamento"), cancelada, reembolso pedido, reembolsada, chargeback, expirada e assinatura atrasada;
  - autenticação: header `X-HOTMART-HOTTOK`, um token fixo por conta (não é HMAC). O lojista copia em Ferramentas › Webhook › Autenticação, como já faz com o token da Hubla;
  - a Hotmart reenvia até 5 vezes quando dá erro; tem "Reenviar" manual e histórico de 60 dias.
- **O que vem no pedido:**
  - transação (`HP...`), valor da oferta (`price`) e total pago (`full_price`), moeda;
  - comissão de cada papel (produtor, coprodutor, afiliado), com a conversão de moeda quando há;
  - forma de pagamento;
  - order bump (cada bump é uma transação, ligada à principal);
  - recorrência;
  - comprador: e-mail, telefone, nome, documento, cidade, CEP, estado e país;
  - origem: `sck`, `src` e `xcod` (desde 25/04/2024).
- **O que NÃO vem:** user agent, fbp, fbc, fbclid, ttclid e UTMs (a própria Hotmart diz que UTM não vai no webhook). O IP do comprador (`buyer_ip`) entrou em 2022, mas não aparece mais na documentação atual: conferir na primeira venda.
- **Como completar o que falta:** a ponte já sabe pôr o visitante no `sck` (`data-xcart-param-vid="sck"`). Na VSL ou presell, ela leva `sck=xc.<visitante>` ao link do `pay.hotmart.com`. O webhook devolve o `sck`, e o Panda Track completa a compra com o IP, o user agent, o `_fbp`, o `_fbc` e o clique do anúncio desse visitante. Isso liga a venda à campanha.
- **Lucro:** receita = comissão do produtor; Pix e boleto ficam em "A receber" até pagar. Igual à Cakto.
- **Purchase:** uma por cobrança (a principal soma os bumps); renovação de assinatura não manda.

**Coprodutor:** recebe o comprador (sem endereço e sem a origem). A Purchase sai com e-mail e telefone, mas sem ligação com a campanha.

**Afiliado: parcial.**
- O webhook do afiliado chega sem a origem, sem o valor pago e sem o comprador. O comprador só vem se o produtor liberar.
- O caminho seria a API de vendas da Hotmart com a credencial do próprio afiliado, que traz o rastreio (`source`, `source_sck`, `external_code`). A documentação não confirma que ele vem preenchido para afiliado: testar numa conta de afiliado antes de prometer.

**O que fazer no código:**
1. **Migration:** `hotmart` no CHECK de plataforma de `checkouts_externos` (como a 072, a 075 e a 076).
2. **Adaptador:** `src/lib/checkouts-externos/plataformas/hotmart.ts`, no molde do da Hubla, com:
   - o token no header (aceitando também no corpo, que a documentação antiga cita);
   - dedupe pelo `id` do evento;
   - o grupo da cobrança pela transação principal;
   - o "Enviar teste" da Hotmart reconhecido como teste: ele chega com o token real e com o payload de exemplo.
3. **Ponte e coletor:**
   - `pay.hotmart.com` e `go.hotmart.com` em `HOST_DO_CHECKOUT`;
   - a tag gerada para a Hotmart já sai com `data-xcart-param-vid="sck"`.
4. **Tela:**
   - Hotmart em Checkouts, com o passo a passo (URL do webhook, token, eventos a marcar);
   - o aviso "um emissor por pixel".
5. **Testes:** `tests/checkout-externo-hotmart*.test.ts`.

**Cuidados:**
- **Compra dobrada no Meta:** a Hotmart tem pixel próprio com API de Conversões, por produto. O produtor precisa desmarcar "Vendas realizadas" no pixel da Hotmart, senão a compra conta duas vezes.
- **Utmify:** ela também reescreve o `sck`. Quem usa as duas ao mesmo tempo tem conflito; a tela avisa.
- **Formato do `sck`:** até 30 caracteres e sem `_` (o nosso tem cerca de 20 e não usa `_`).
- **Desativação:** a Hotmart pode desativar o webhook se a URL der erro. A documentação não diz se é só no cadastro ou depois de falhas. Responder rápido e com 2xx sempre que a venda for gravada.
- **A conferir na primeira venda real:**
  - qual evento o Pix gerado dispara (o status dele é `WAITING_PAYMENT`, diferente do boleto);
  - se ainda vem o `buyer_ip`;
  - se o ponto do `xc.` passa no `sck`.

### Fase 1 — Taboola (~1 semana). Paridade com a Ratoeira na maior native.

- **Clique:** a Taboola põe `tblci={click_id}` sozinha em toda URL. O Panda Track lê o `tblci`, e o modelo de URL acrescenta `utm_campaign={campaign_id}`, `utm_content={campaign_item_id}` e o site (`{site}`).
- **Conversão pelo servidor:** postback GET em `trc.taboola.com/actions-handler/log/3/s2s-action`, com:
  - `click-id`, com hífen;
  - `name`, o **Event Name** criado no Realize;
  - `revenue`, `currency` e `orderid`.
  - Não tem autenticação. BRL e USD são aceitos. Um evento por etapa do funil (ver produto, carrinho, checkout e compra), com os nomes que o lojista cria no Realize.
- **Gasto e gestão:** Backstage API.
  - Login por client credentials, com token de 12 h.
  - Gasto por dia, campanha e anúncio.
  - Escrita: pausar (`is_active`), orçamento e CPC.
  - Bloquear site ruim na conta (`block-publisher`) é um extra que a Ratoeira não tem.
  - **A credencial vem da página "API Keys" da Taboola ou do gerente de conta.** A Ratoeira manda pedir no chat do suporte da Taboola.
- **Na tela:** a Taboola aparece em Integrações, na aba Campanhas e nas regras do Plano 3 (pausar e mudar orçamento).

### Fase 2 — Kwai (~1 semana). Diferencial no Brasil: a Ratoeira não tem.

- **Clique:** o Kwai põe sozinho `click_id`, `pixel_id`, `CampaignID`, `adSETID` e `CreativeID` na URL da primeira página. Não existe campo de parâmetros para colar.
  - O `click_id` é um nome genérico. O Panda Track reconhece o clique do Kwai pela presença de `pixel_id` + `CampaignID` juntos.
- **Conversão:** Event API, `POST https://www.adsnebula.com/log/common/api` em JSON, com:
  - o `access_token` e o `pixelId` no corpo;
  - `clickid`, `event_name` (EVENT_CONTENT_VIEW, EVENT_ADD_TO_CART, EVENT_INITIATED_CHECKOUT, EVENT_PURCHASE...), `value` e `currency`.
  - Moedas: só BRL, IDR e USD.
  - O próprio Kwai recomenda o Event API para Pix e boleto pagos depois: o pixel não pega essa compra.
  - O Kwai exige um **evento de teste aprovado** antes de criar campanha. O Panda Track faz um botão "Mandar evento de teste" com `trackFlag: true`.
  - Sucesso = `result: 1`. Erros: 10005, click id inválido; 10006, token inválido.
- **Gasto (Marketing API):** relatório por conta, campanha, grupo e criativo; ligar e pausar; orçamento e lance.
  - O acesso de anunciante direto é por autoserviço no Business Center.
  - Conta aberta por agência pede o acesso por e-mail ao Kwai, com a agência e o vendedor em cópia. Até o acesso sair, o Kwai fica só com a conversão.

### Fase 3 — NewsBreak, MGID e RevContent (~1 semana as três). Fecha a lista da Ratoeira.

| | NewsBreak | MGID | RevContent |
|---|---|---|---|
| Clique | parâmetro nosso com a macro `__CALLBACK_PARAM__` (vale 7 dias) | parâmetro nosso com a macro `{click_id}` | `rc_uuid`, que a rede acrescenta sozinha |
| Conversão | GET `business.newsbreak.com/tracking/attribute`, sem autenticação; valor só em USD | GET `a.mgid.com/postback/<cliente>`, sem autenticação; até 3 objetivos | `trends.revcontent.com/api/v1/conversion.php` com `api_key`; valor em USD |
| Gasto e gestão | sim: token do anunciante + Organization ID | sim: token do painel (API v2) | sim, mas o acesso precisa ser liberado pelo representante |
| Observação | só anúncio nos EUA | depósito mínimo de US$ 100 | — |

- **A Ratoeira não lê o gasto da MGID nem da RevContent.** Ler já é vantagem nossa.
- A NewsBreak exige um postback por produto na Ratoeira. Aqui é um por loja: o click id leva a compra, e não há cadastro por produto.

### Fase 4 — Google pelo servidor e bloqueio de IP (~1,5 semana + aprovação do Google). O núcleo da Ratoeira.

- **Conversão offline pela Google Ads API** (`ConversionUploadService`):
  - sobe a compra com GCLID, GBRAID ou WBRAID e com o e-mail e o telefone em hash (conversão otimizada);
  - pega a venda que o gtag perde: iOS, outro aparelho, Shop Pay, checkout externo.
  - Cuidado com a contagem dobrada: a ação de conversão "offline" é outra, e o gtag continua só na sua. A ação certa fica escolhida por loja.
- **Gasto do Google pela API**, no lugar do script colado: detalhe por campanha, grupo e anúncio, igual ao Meta. Isso abre as regras do Plano 3 para o Google.
- **Bloqueio de IP ("Modo Ratoeira"):**
  - o snippet e o coletor já veem o IP e o click id de cada visita;
  - mesmo IP com N cliques pagos (GCLID novo a cada vez) no período = IP nas exclusões da campanha, que aceita até 500 IPs por campanha;
  - relatório dos IPs bloqueados, com o botão de tirar.
- **O que trava:**
  - o **developer token** da Google Ads API precisa do acesso "Basic" aprovado pelo Google (pedido na conta MCC; leva de dias a semanas);
  - a listagem de contas pelo login do Google hoje usa uma versão da API que saiu do ar e precisa ser atualizada junto.

### Fase 5 — Postback universal e evento de Lead (~1 semana). As "100+ plataformas".

- **Postback genérico:** uma URL por integração (GET ou POST) e um modelo por plataforma, que diz onde vêm o id do pedido, o valor, a moeda, o status (aprovada, reembolso, chargeback) e o id da visita.
  - **Modelos prontos primeiro para** (a Hotmart tem adaptador próprio na Fase H): Kiwify, Eduzz, Monetizze, Braip, Perfect Pay, Ticto, Appmax, Yampi, Cartpanda, Logzz, Coinzz, ClickBank, Digistore24, BuyGoods, MaxWeb, DrCash.
  - **Modelo "Outra":** o lojista mapeia os campos.
  - Entra no Dashboard como os checkouts externos de hoje: comissão ou venda, conforme a plataforma.
- **Id da visita:** a ponte já põe `callback=xc.<vid>` no link da Cakto. Isso passa a valer em qualquer plataforma, com o nome do parâmetro que ela devolve (`sck`, `src`, `aff_sub`, `tid`, `subid`...).
- **Evento Lead (e CompleteRegistration):**
  - entra no catálogo de eventos, nas redes que aceitam;
  - vem de formulário (regra de clique ou submit na ponte) ou do postback de lead da rede CPA.
- **Aviso de venda e de reembolso** no celular e no Telegram: já existe, e passa a cobrir as plataformas novas.

### Fase 6 — Diferenciais baratos (~1 semana no total)

- **Outbrain:**
  - clique pelo parâmetro nosso com a macro `{{ob_click_id}}`;
  - conversão por GET em `tr.outbrain.com/unifiedPixel` com `ob_click_id`, `name`, `orderValue` e `currency` (BRL aceito), sem autenticação;
  - gasto: a Amplify API está em beta fechado, com pedido pelo formulário de parceiro. Até liberarem, só a conversão.
- **Microsoft Ads:**
  - o `msclkid` já vem na URL;
  - conversão pela CAPI da UET (`capi.uet.microsoft.com/v1/{tagId}/events`, token da tag, com hash, valor e moeda por evento e dedupe com a UET);
  - gasto pela Reporting API, aberta com developer token;
  - tem busca e a Audience Network (native) no Brasil.
- **Domínio próprio para o script** (ex.: `t.minhaloja.com`, por CNAME):
  - o snippet e a ponte saem dele;
  - o coletor responde nele;
  - menos bloqueio por adblock e nada de dividir reputação com os outros clientes.
- **MCP de rastreamento e lucro,** com ferramentas de leitura: Dashboard, campanhas com lucro, vendas e pedidos sem atribuição. Mais o "pausar" do Plano 3, com confirmação.
- **Relatórios:** vendas e lucro por país, por hora e por dia da semana. O pedido já tem país e hora.

### Fora do plano

- **Pinterest e Snapchat:** CAPI boas, mas pouco uso no perfil de quem usa o Panda Track, e as duas proíbem emagrecimento. Ficam para depois.
- **X Ads:** pede app aprovado e OAuth 1.0a, e o gasto só sai pelo representante.
- **Redes push** (PropellerAds, Adsterra, MediaGo, ExoClick, Adcash): o postback universal da Fase 5 já cobre a conversão delas, sem integração própria.

## 4. Ordem e prazo

| Fase | O quê | Prazo (código) | Depende de você |
|---|---|---|---|
| H | Hotmart pelo servidor (produtor completo, afiliado parcial) | **feita em 31/10** | o token (hottok) da conta Hotmart e uma venda de teste |
| 0 | Catálogo de redes | ~3 dias | — |
| 1 | Taboola | ~1 semana | credencial da Backstage API (página API Keys ou gerente de conta) |
| 2 | Kwai | ~1 semana | pixel de Event API + token; acesso à Marketing API |
| 3 | NewsBreak, MGID, RevContent | ~1 semana | tokens das três; RevContent pede liberação ao representante |
| 4 | Google pelo servidor + bloqueio de IP | ~1,5 semana | developer token da Google Ads API com acesso Basic |
| 5 | Postback universal + Lead | ~1 semana | — |
| 6 | Outbrain, Microsoft, domínio próprio, MCP, relatórios | ~1 semana | formulário de parceiro do Outbrain; developer token da Microsoft |

**No total:** ~7 a 8 semanas de código. As credenciais podem ser pedidas já, em paralelo.

**Para começar a Fase 1, eu preciso de:** uma conta Taboola sua com a credencial da Backstage API, ou pelo menos o Account ID e um evento criado no Realize para testar o postback.

## 5. O que os termos das redes dizem e pesa na operação

As políticas de Taboola, Outbrain, NewsBreak, MGID e RevContent proíbem réplica e marca de terceiro (conferido na página oficial de cada uma). A vitrine com réplica não roda nelas; loja neutra, COD e afiliado rodam. A NewsBreak só entrega nos EUA.
