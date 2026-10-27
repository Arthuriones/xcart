# Migração da Pagou para a AbacatePay — estudo

Feito em 27/10/2026, lendo a documentação inteira da AbacatePay (`docs.abacatepay.com/llms-full.txt`, versão de 27/10/2026) e a cobrança atual do xcart.

**Status (27/10/2026): implementado e na main, desligado.** Migration 081 aplicada em produção. Liga com `NEXT_PUBLIC_BILLING_PROVIDER=abacatepay` depois que a conta existir (ver o fim de ARCHITECTURE.md §11 e o gotcha no CLAUDE.md).

## Resumo

- **Dá para trocar de provedor sem migrar ninguém.** Na Pagou não existe nenhuma assinatura (nem cartão, nem Pix automático): só 6 recargas de crédito por Pix, R$ 450 no total, a última em 10/09/2026. Os 3 Pro pagantes ainda são do Stripe antigo e não mudam.
- **Desenho recomendado:**
  - assinatura mensal pelo **checkout de assinatura da AbacatePay** (página dela, cartão e, se liberado, Pix Automático);
  - Pix avulso (créditos e "30 dias por Pix") pelo **Pix do checkout transparente**, na mesma janela de QR que já existe.
- **O que muda para o assinante:** o cartão deixa de ser digitado no nosso formulário. Ele vai à página da AbacatePay e volta. O 3DS fica por conta dela.
- **O que ganhamos:**
  - Pix recorrente (Pix Automático), que a Pagou não tinha;
  - CPF opcional no Pix;
  - troca de plano pela API;
  - taxa de Pix fixa (R$ 0,80).
- **O que perdemos e precisamos cobrir no nosso lado:**
  - o cancelamento da AbacatePay é na hora;
  - a assinatura não informa o fim do período;
  - não há status "em atraso";
  - não há idempotência na criação de cobrança.
- **Antes de tudo (do Arthur):** conta com CNPJ, com análise de até 3 dias úteis. O site precisa mostrar CNPJ e contato (e-mail e WhatsApp) no rodapé, e hoje não mostra.

---

## 1. Como está hoje (Pagou)

| Peça | Arquivo | O que faz |
| - | - | - |
| Cliente da API | `src/lib/billing/pagou.ts` | Bearer `PAGOU_SECRET_KEY`, `Idempotency-Key`, clientes, transação Pix, assinatura de cartão, cancelamento no fim do período |
| Assinar no cartão | `src/app/api/billing/subscribe/route.ts` + `src/components/billing/pagou-card-form.tsx` | Payment Element da Pagou gera `pgct_`; o servidor cria a assinatura; o 3DS volta pelo SDK |
| Pix avulso | `src/app/api/billing/credits/route.ts` + `src/components/billing/pix-dialog.tsx` | Pacote de créditos ou "30 dias de plano"; nasce `pending` em `credit_purchases`; o PATCH confere na API enquanto o QR está aberto |
| Estado da assinatura | `src/app/api/billing/subscription/route.ts` | GET sincroniza com a API; DELETE agenda o cancelamento no fim do período |
| Webhook | `src/app/api/billing/pagou/webhook/route.ts` | HMAC com timestamp (painel) ou `?t=` (notify_url); deduplica em `payment_events`; **relê na API** antes de aplicar |
| Banco | `021`, `023`, `064`, `078` | `profiles.pagou_customer_id/pagou_subscription_id/payment_provider/cancel_at_period_end`, `credit_purchases.pagou_transaction_id` (único), `apply_paid_purchase()` (atômica), `expire_pix_pro()` |
| Quem lê a Pagou | `access.ts`, `limites.ts`, `leitura/assinatura.ts`, `sidebar-data.tsx`, `evento-assinatura.ts`, `regras.ts`, `assinar-pro.tsx`, `secao-plano.tsx`, `assinar-paywall.tsx`, `comprar-creditos.tsx` | Acesso, limites do plano, tela de assinatura, paywall |
| Testes | 10 arquivos `tests/billing-*` e mais 5 que citam a Pagou | Webhook, HMAC, Pix, cartão, regras |

Uso real em produção (27/10/2026, contagem no banco):
- 57 perfis, sendo 13 admin ou com acesso liberado;
- 0 assinaturas na Pagou;
- 6 recargas Pix pagas pela Pagou (R$ 450, a última em 10/09);
- 22 eventos de webhook, todos de transação (o último em 05/10);
- 3 perfis Pro do Stripe (2 ativos e 1 em atraso).

## 2. O que a AbacatePay oferece (o que importa para nós)

**API.**
- Base `https://api.abacatepay.com/v2`, autenticação `Authorization: Bearer <chave>`.
- O ambiente vem da chave: `abc_dev_...` (Dev mode, tudo simulado) ou `abc_prod_...`. A URL é a mesma.
- Toda resposta vem como `{ data, success, error }`: conferir `success`, não só o HTTP.
- Valores em centavos e sempre BRL.
- Erros: 401 (chave errada ou revogada), 403 `Insufficient permissions` (a chave não tem a permissão da rota), 422 (validação, dizendo o campo), 429, 5xx.
- **As permissões da chave não se editam depois de criada:** para mudar, cria-se outra chave.
- Não há `Idempotency-Key` documentado em nenhuma rota de criação.

**Produtos.** `POST /products/create` com `externalId`, `name`, `price`, `currency: "BRL"` e `cycle` (`MONTHLY` para os nossos planos). Busca por `externalId` em `GET /products/get`. Não existe rota para atualizar: preço novo é um produto novo, com outro `externalId`.

**Clientes.** `POST /customers/create`: só o `email` é obrigatório. É **único por CPF/CNPJ**: criar com um taxId que já existe devolve o cadastro existente.

**Assinatura (checkout hospedado).**
- `POST /subscriptions/create` com `items` (exatamente 1 produto com ciclo), `customerId`, `externalId`, `completionUrl`, `returnUrl`, `methods` (`CARD` por padrão; `PIX` = Pix Automático), `retryPolicy` (`maxRetry` 1–10, padrão 3; `retryEvery` 1–30 dias, padrão 1) e `metadata`.
- Devolve um checkout `bill_...` com a `url`. **A assinatura `subs_...` só passa a existir depois que o cliente paga.**
- Status da assinatura: só `ACTIVE` ou `CANCELLED`. O checkout de assinatura tem `PENDING`, `PAID`, `EXPIRED`, `CANCELLED` e `REFUNDED`.
- `POST /subscriptions/cancel`: **cancela na hora** (`cancelPolicy: NOW`), irreversível.
- `POST /subscriptions/change-plan`: troca o produto. Vale no próximo ciclo, o produto novo precisa ter o mesmo ciclo, e só pode haver uma troca pendente por vez.
- O objeto da assinatura **não traz início nem fim de período**.
- Reembolso de cobrança de assinatura **não sai pela API v2**: só pelo painel ou pelo portal.
- Pix Automático: só em loja com o recurso **liberado pelo suporte**. O QR de autorização vale 1 h e não aceita cupom.

**Pix e cartão no nosso site (checkout transparente).**
- **Pix:** `POST /transparents/create` com `method: "PIX"`.
  - Só `data.amount` é obrigatório (mínimo 100 centavos). `customer`, `expiresIn` (padrão 24 h), `metadata` (valores só texto), `utm` e `ensureSameTaxId` são opcionais.
  - Devolve `brCode` (copia-e-cola), `brCodeBase64` (imagem do QR), `expiresAt` e `platformFee`.
  - Status em `GET /transparents/check?id=` (`PENDING`, `PAID`, `EXPIRED`, `CANCELLED`).
  - Em Dev mode, `POST /transparents/simulate-payment` paga a cobrança.
  - O reembolso (`POST /transparents/refund`) é sempre do valor total.
- **Cartão:** `abacatepay.js` com a chave pública `pk_...` gera um `ctok_` (vale 60 s, uso único). Na resposta vem um `cardToken`, que cobra o mesmo cartão de novo sem o cliente presente. Precisa de liberação ("CARD_TRANSPARENTS is not available for this store"). **No desenho recomendado não usamos.**

**Webhooks.**
- Formato: `{ id, event, apiVersion: 2, devMode, data }`. O CPF/CNPJ chega mascarado.
- **A origem se prova pelo secret na URL** (`?webhookSecret=...`, o valor definido ao criar o webhook). O `X-Webhook-Signature` (HMAC-SHA256 em base64 do corpo cru) usa uma **chave pública que está na documentação**: garante só que o corpo não foi alterado, não que veio da AbacatePay.
- Não há timestamp na assinatura.
- Entregue = qualquer 2xx em até 30 s.
- Retentativa em timeout, 5xx, 408 e 429: em 5 s, 5 min, 30 min, 2 h, 5 h e 10 h (até 7 tentativas, cerca de 18 h), sempre com o **mesmo `id`**.
- Outros 4xx não têm retentativa, e 410 desliga o webhook.
- Reenvio manual pelo painel gera `id` novo.
- O webhook de Dev mode e o de produção são criados separados.
- Eventos que usamos:
  - `subscription.completed` e `subscription.renewed`: trazem `payment.createdAt`, `checkout.externalId` e `customer.id`;
  - `subscription.payment_failed`: traz `retryNumber`;
  - `subscription.cancelled`: traz `cancelledDueTo`, que vale `max_payment_retries_exceeded` quando acabaram as tentativas;
  - `transparent.completed`, `transparent.refunded` e `transparent.disputed`.

**Portal do cliente.**
- `POST /customer-portal/create` gera um link por cliente e por checkout. O cliente entra com um código enviado ao e-mail.
- Lá ele vê os pagamentos, troca o cartão, cancela no fim do ciclo e **pede reembolso automático, sem aprovação nossa**. O reembolso de uma cobrança de assinatura cancela a assinatura na hora.

**Taxas** (página de preços em 27/10/2026, sem mensalidade):

| | Taxa |
| - | - |
| Pix | R$ 0,80 por pagamento |
| Cartão à vista | 3,5% + R$ 0,60 |
| Cartão 2x–6x | 4% + R$ 0,60 |
| Cartão 7x–12x | 4,5% + R$ 0,60 |
| Boleto pago | R$ 2,50 |
| Saque por Pix | R$ 0,80 até o 20º do mês, depois R$ 2,50 |
| Liquidação do cartão | D+30 (configurável até D+1, mais caro) |

Limite inicial de pagamentos e saques: R$ 5.000 de dia e R$ 1.000 à noite. Assinatura tem as mesmas taxas. A do Pix Automático não está na página.

**Conta.**
- Só pessoa jurídica: CNPJ, e MEI e ME são aceitos. A análise leva até 3 dias úteis.
- O site precisa ter contato (e-mail e WhatsApp), termos, privacidade e **CNPJ no rodapé**.
- Dados do sócio administrador: nome, celular, data de nascimento e nome da mãe.

**Ferramentas.**
- SDK oficial `@abacatepay/sdk` (Node, v2) e `@abacatepay/rest`.
- CLI com listener de webhook para Dev mode.
- Servidor MCP.
- Cartões de teste: `4242 4242 4242 4242` aprova; `4000000000000002`, `...0069` e `...0127` simulam recusas.

## 3. Pagou x AbacatePay

| Tema | Pagou (hoje) | AbacatePay | O que fazer |
| - | - | - | - |
| Cartão da assinatura | Formulário nosso (Payment Element), 3DS pelo SDK | Página da AbacatePay; o 3DS é dela | Redirecionar e voltar pelo `completionUrl` |
| Pix recorrente | Não tinha (`pix_automatic` UNSUPPORTED) | Pix Automático, com liberação | Pedir a liberação; até lá segue o "30 dias por Pix" |
| Pix avulso | Exige CPF | CPF opcional | Deixar de exigir o CPF no Pix |
| Cancelar | Agenda para o fim do período | Na hora | Manter o Pro até o `current_period_end` gravado por nós |
| Fim do período | `currentPeriodEnd` na API | Não existe | Calcular: `payment.createdAt` + 1 mês (+ folga das retentativas) |
| Em atraso | `past_due` | Não há status; vem `payment_failed` com `retryNumber` | Gravar `past_due` no perfil e manter o acesso até o cancelamento |
| Trocar de plano | Pelo suporte (o valor é imutável) | `change-plan`, no próximo ciclo | Dá para virar autoatendimento (fase 2) |
| Idempotência | `Idempotency-Key` | Não há | Reaproveitar o checkout `PENDING` da conta; trava de clique duplo no cliente |
| Autenticidade do webhook | HMAC com timestamp e segredo nosso | Segredo na URL + HMAC com chave pública | Validar o segredo em tempo constante; manter o "aviso + releitura na API" |
| Reembolso de assinatura | Pela API | Só no painel ou no portal | Fica pelo painel |
| Atualizar cliente | Não tinha | Criar com o mesmo CPF devolve o existente | Simplifica o `getOrCreateCustomer` |

## 4. Desenho recomendado

### 4.1 Assinatura (cartão e Pix Automático)

1. **Produtos:** um por plano à venda, `cycle: "MONTHLY"`, com `externalId` = id do plano (`roteamento`, `completo`, `ilimitado_v2`) e `price` = `precoCentavos` de `plans.ts`.
   - Um script em `scripts/` cria e confere os produtos.
   - O servidor acha o produto por `GET /products/get?externalId=` e **recusa assinar se o preço lá não bater com o `plans.ts`**.
2. **`POST /api/billing/subscribe`** passa a devolver `{ url }` em vez do estado da assinatura:
   - garante o cliente (`customers/create`, com e-mail, nome, celular e CPF do cadastro da 077);
   - cria `subscriptions/create` com `externalId = sub_<user>_<plano>_<n>`, `metadata { user_id, plano }`, `completionUrl = /billing?assinatura=ok`, `returnUrl = /billing`, `methods` (`["CARD"]`, mais `"PIX"` quando o Pix Automático estiver liberado) e `retryPolicy { maxRetry: 3, retryEvery: 2 }`;
   - **sem idempotência na API**: se a conta já tem um checkout `PENDING` do mesmo plano criado há menos de 1 h, devolve a mesma `url`;
   - a trava de "já é assinante" continua.
3. **Webhook `subscription.completed`:**
   - acha o usuário por `checkout.externalId` ou `metadata`, senão por `customer.id`;
   - relê `GET /subscriptions/get?id=`;
   - grava `payment_provider = 'abacatepay'`, `abacatepay_subscription_id`, `plan = 'pro'`, `plano` pelo produto/valor, `subscription_status = 'active'` e `current_period_end = payment.createdAt + 1 mês + 2 × retryEvery dias`;
   - repõe os créditos de IA, como hoje.
4. **`subscription.renewed`:** avança o `current_period_end` a partir do `payment.createdAt` e repõe os créditos (só quando o período avança, como hoje).
5. **`subscription.payment_failed`:** `subscription_status = 'past_due'`, e o acesso segue (igual ao `past_due` de hoje).
6. **`subscription.cancelled`:** `subscription_status = 'canceled'` e `cancel_at_period_end = true`. **O Pro fica até o `current_period_end`**, e o job que expira o Pix passa a expirar esse caso também. Quando o cancelamento é por falta de pagamento (`max_payment_retries_exceeded`), o acesso já vai estar perto do fim por causa da folga.
7. **Cancelar pela tela (DELETE):** chama `subscriptions/cancel`, que é imediato do lado deles, e a tela diz "acesso até DD/MM", como hoje.
8. **Portal do cliente: não mandar** no início. Ele deixa o cliente se reembolsar sozinho, e o reembolso de assinatura cancela tudo na hora. A consequência é que, sem o portal, quem quer **trocar de cartão** cancela e assina de novo (decisão do Arthur, ver §7).

### 4.2 Pix avulso (créditos e 30 dias de plano)

- `POST /api/billing/credits` chama `transparents/create` com `method: "PIX"`, `amount`, `expiresIn: 3600`, `metadata { compra: <id da credit_purchases>, user_id, kind }` e o `customer` quando houver CPF.
  - A janela mostra o `brCodeBase64` (imagem pronta: o `qrcode` local pode sair) e o `brCode`.
- `PATCH` (a janela consultando): `GET /transparents/check?id=` e, com `PAID`, `apply_paid_purchase`. É a mesma trava atômica de hoje.
- Webhook `transparent.completed`: relê o `check` e aplica. `transparent.refunded` e `transparent.disputed` só registram, como hoje: compra paga não volta atrás sozinha.

### 4.3 Webhook novo

- Rota `src/app/api/billing/abacatepay/webhook/route.ts`, cadastrada como `https://user.xcart.app/api/billing/abacatepay/webhook` com um secret longo e aleatório (`ABACATEPAY_WEBHOOK_SECRET`).
  - O secret chega em `?webhookSecret=` e é conferido em tempo constante.
  - O HMAC do corpo cru também é conferido (barato).
  - Sem os dois, responde 401 (sem retentativa, que é o certo).
- Deduplica pelo `id` do corpo em `payment_events` (`provider = 'abacatepay'`), com o mesmo reprocessamento do evento que falhou.
- O corpo é só um aviso: o estado sai de GET autenticado. Isso cobre a falta de timestamp, porque um evento repetido de fora não muda nada que a API não confirme.
- Falha ao processar responde 500, e a AbacatePay tenta de novo por cerca de 18 h.
- Atenção: o secret vai na URL e pode aparecer em log de requisição. Use um valor longo, só para isso, e troque se vazar.

### 4.4 Banco (migration 081)

- `profiles`: `abacatepay_customer_id`, `abacatepay_subscription_id` e o índice dos dois. `payment_provider` ganha o valor `'abacatepay'` (é texto, sem CHECK).
- `credit_purchases`: `abacatepay_charge_id` com índice único parcial, como o da Pagou.
- `apply_paid_purchase`: versão que acha a compra pela coluna da Pagou **ou** pela da AbacatePay. Mesma trava `for update` e mesmo `revoke ... from public, anon, authenticated` + `grant ... to service_role`, conferido com `has_function_privilege`.
- `expire_pix_pro()` passa a expirar:
  - quem é `abacatepay` e não tem assinatura viva;
  - a assinatura `canceled` cujo `current_period_end` passou.
- Os `pagou_*` ficam (histórico das 6 recargas). Saem numa limpeza depois.

### 4.5 Código

- **Novo:**
  - `src/lib/billing/abacatepay.ts`: `fetch` puro, sem SDK, no molde do `pagou.ts`, com o envelope `success/error` e 401/403 nossos virando 502;
  - a rota do webhook;
  - `scripts/abacatepay-produtos.ts`.
- **Muda:**
  - as rotas `subscribe`, `credits` e `subscription`;
  - `assinar-pro.tsx`: o cartão vira um botão que leva à AbacatePay, e o Pix continua;
  - `pix-dialog.tsx`: imagem e status novos;
  - `regras.ts`: mensagens;
  - a leitura do provedor em `access.ts`, `limites.ts`, `leitura/assinatura.ts` e `sidebar-data.tsx`;
  - `evento-assinatura.ts`: `ACTIVE`/`CANCELLED` + eventos;
  - a tela de assinatura e o paywall.
- **Sai:** `pagou-card-form.tsx` e o script `js.pagou.ai`.
- **Testes:** reescrever `billing-webhook-pagou`, `billing-webhook-hmac`, `billing-subscribe-cartao`, `billing-pix-*` e `billing-credits-patch` para a AbacatePay; ajustar os que só citam a Pagou.
- **Variáveis:**
  - entram `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET` (e `NEXT_PUBLIC_ABACATEPAY_PUBLIC_KEY` só se um dia usarmos o cartão transparente);
  - os `PAGOU_*` saem na limpeza.

### 4.6 Por que não o cartão embutido com recorrência nossa

O `cardToken` permitiria manter o formulário no nosso site e cobrar todo mês por um cron nosso. Não vale agora:
- teríamos que construir cobrança, retentativa, aviso de falha e trava contra cobrança dupla, e sem idempotência na API um timeout pode cobrar duas vezes;
- o cartão transparente depende de liberação;
- guardar o `cardToken` exige consentimento do cliente.

O checkout da AbacatePay faz tudo isso pronto. Se um dia o redirecionamento atrapalhar a conversão, dá para trocar.

## 5. Passo a passo da troca

1. **Arthur — conta:**
   - criar a conta com o CNPJ e enviar a verificação (até 3 dias úteis);
   - criar a **chave de Dev mode** com as permissões `SUBSCRIPTION:CREATE`, `SUBSCRIPTION:READ`, `SUBSCRIPTION:DELETE`, `TRANSPARENT:CREATE`, `TRANSPARENT:READ`, `CUSTOMER:CREATE`, `CUSTOMER:READ`, `PRODUCT:CREATE`, `PRODUCT:READ`, `WEBHOOK:CREATE`, `WEBHOOK:READ` e `REFUND:CREATE`;
   - pedir ao suporte o **Pix Automático**, se for usar.
2. **Código — site:** CNPJ, e-mail e WhatsApp no rodapé (`rodape-site.tsx`), que é exigência da análise. Precisa dos dados do Arthur.
3. **Código — integração em Dev mode:** migration 081, cliente, rotas, webhook, telas e testes.
   - Os produtos são criados pelo script.
   - O webhook de Dev aponta para uma prévia da Vercel, ou para o listener da CLI.
4. **Testes em Dev mode:**
   - assinar com 4242 e confirmar `subscription.completed`, perfil Pro e créditos;
   - cartão recusado (`...0002`): fica sem plano e mostra a mensagem;
   - Pix de créditos com `simulate-payment`: o webhook e o PATCH aplicam uma vez só;
   - evento repetido: deduplicado;
   - webhook sem o secret: 401;
   - cancelar: Pro até a data e expiração pelo job.
5. **Produção:** chave de produção (as mesmas permissões), webhook de produção (criado de novo), deploy e uma compra real pequena (o menor pacote de créditos) para conferir de ponta a ponta.
6. **Limpeza (depois de 2 a 4 semanas):** tirar o código e os `PAGOU_*` e desligar os webhooks no painel da Pagou. A rota do webhook da Pagou pode ficar no ar até lá: não há nada pendente nela.

Estimativa: 1 a 2 dias de código, mais a espera da verificação da conta.

## 6. Riscos

- **Redirecionamento no cartão:** um passo a mais para o assinante (sai e volta). Mitigação: `customerId` pré-preenche os dados no checkout.
- **Período calculado por nós:** se um `renewed` se perder, o perfil expira antes da hora. Mitigação: a retentativa de cerca de 18 h da AbacatePay, a folga no fim do período, e a tela de assinatura relendo `GET /subscriptions/get` (ainda `ACTIVE` = estende).
- **Duas assinaturas para a mesma conta** (dois checkouts pagos): mitigação no `subscribe` (reaproveitar o pendente e recusar quem já é assinante). Se acontecer mesmo assim, cancelamos a segunda pela API e o reembolso é pelo painel.
- **Liquidação do cartão em D+30:** dinheiro do cartão demora a cair. O Pix é na hora.
- **Limite inicial:** R$ 1.000 à noite por pagamento ou saque. Hoje cabe (o plano maior é R$ 997).

## 7. Decisões do Arthur

1. **Pix Automático:** pedir a liberação e oferecer Pix recorrente? Recomendo sim. Até liberar, segue o "30 dias por Pix".
2. **Portal do cliente** (troca de cartão e cancelamento pelo próprio cliente): recomendo **não**, por causa do reembolso automático. A troca de cartão vira "cancele e assine de novo" ou suporte.
3. **CNPJ, e-mail e WhatsApp** do rodapé: quais?
4. **CPF no Pix:** deixar de exigir? Recomendo deixar de exigir no pacote de créditos e manter pedindo nos 30 dias de plano, para a cobrança ficar no nome de quem assina.
