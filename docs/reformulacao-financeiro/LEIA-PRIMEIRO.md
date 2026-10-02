# Reformulação financeira do xcart — leia primeiro

Feito na madrugada de 02/10/2026, com agentes, enquanto você dormia.

- **Branch:** `reformulacao-financeiro`. **Nada foi para o main nem para a produção.** O rastreamento das lojas continua exatamente como estava.
- **Prévia:** a Vercel montou uma prévia do branch (veja o link mais novo de "Preview" em `vercel ls` ou no painel da Vercel → Deployments). Ela pede o login da Vercel e depois o login normal do xcart.
- **Banco:** a migration `052_financeiro.sql` **já foi aplicada** em produção. Ela só cria tabelas e funções novas e não mexe em nada que existia. As 4 checagens de permissão do fim do arquivo deram `false`, que é o esperado.

## Como foi feito

1. **Pesquisa:** 6 agentes, com fontes, sobre gasto do Google Ads, gasto do Meta, receita/taxas/custo na Shopify, o que TrueProfit/BeProfit/Triple Whale/WeTracked fazem, o código atual e o que dá para montar de atribuição e alertas. Está tudo em [pesquisa.md](pesquisa.md).
2. **Plano:** um arquiteto montou o plano a partir da pesquisa, e um crítico apontou 8 correções obrigatórias, que foram aplicadas. Está em [plano.md](plano.md).
3. **Implementação:** 7 engenheiros em paralelo, cada um num pedaço, cada um com typecheck e testes.
4. **Revisão adversarial:** 4 revisores (segurança, cálculo, regressão, tela vazia) e um cético por achado. O resultado está em "Revisão", abaixo.

## O que tem no branch

| Tela | Rota | O que faz |
|---|---|---|
| **Lucro** (nova home) | `/financeiro` | Faturamento, gasto Meta + Google, lucro estimado e ROAS real, por loja e por dia, com comparação ao período anterior e avisos do que falta configurar |
| **Custos e taxas** | `/financeiro/custos` | Custo por SKU com data de vigência (congela o custo dos pedidos antigos), taxa do gateway, custo padrão em %, importação por CSV |
| **Contas de anúncio** | `/financeiro/anuncios` | Meta: cola o token e liga cada conta a uma loja. Google: gera o script para colar na conta |
| **Eventos ao vivo** | `/tracking/eventos` | Feed dos eventos de rastreamento, atualizado sozinho |
| **Alertas** | `/alertas` | 7 regras (ex.: gastou e não vendeu, pixel parou, envio falhando), aviso no Telegram, silenciar 24 h |

Também:
- **Menu novo** em 5 grupos: Financeiro, Rastreamento, Operações, Roteamento e Sistema. Todas as telas antigas continuam no menu.
- **Seletor global** de loja, período e moeda no topo.
- **Sincronização:**
  - pedidos da Shopify a cada 15 min, guardando uma "foto financeira" sem dado pessoal;
  - câmbio 4x por dia (Frankfurter, e BRL pela PTAX do Banco Central);
  - gasto do Meta a cada 15 min, reprocessando 28 dias uma vez por dia;
  - gasto do Google pelo script que você cola na conta.
  
  Os crons só rodam em produção, depois do merge. Na prévia, use os botões "Atualizar agora" e "Sincronizar".

## Decisões que vieram da pesquisa (e não de cabeça)

- **Google Ads:** segundo a pesquisa, o Google **aposentou o developer token em 09/09/2026**. O acesso agora é pelo projeto do Google Cloud, e existe o nível **Explorer**, com até 2.880 operações por dia em contas reais. As fontes estão em pesquisa.md: a doc oficial e o blog do Google Ads de 10/09/2026. **Isso é posterior ao que eu sei de memória: confira as fontes antes de decidir.**
  - Nesta rodada o gasto do Google entra por um **Google Ads Script**, que você cola em cada conta e que funciona hoje sem aprovação nenhuma.
  - A API com conta de serviço fica como próximo passo, para não precisar colar nada.
- **Meta:** usa um token de **system user só com `ads_read`**, separado do token do CAPI. A conta de anúncio é atribuída ao system user com "Ver desempenho".
- **Lucro:** o cálculo é **lucro estimado**, não contábil. Ainda faltam a taxa real do Shopify Payments, os custos fixos e o IOF do cartão (ver plano.md → "Depois").
- **Faturamento** inclui o frete cobrado. Para conferir com a Shopify, compare com **Vendas totais menos Impostos**, não com "Vendas líquidas".

## O que só você pode fazer

O passo a passo completo está em [passo-a-passo-arthur.md](passo-a-passo-arthur.md). Em resumo:

1. **Olhar a prévia** e decidir se vai para o main.
2. **Meta:**
   - no Business Manager, criar ou usar um system user;
   - atribuir as contas de anúncio com "Ver desempenho";
   - gerar um token com só `ads_read`;
   - colar o token em **Contas de anúncio** e ligar cada conta à sua loja.
3. **Google:**
   - pegar o **ID de cliente** de cada conta (formato 123-456-7890, não o AW-);
   - cadastrar em **Contas de anúncio**;
   - colar o script gerado em Google Ads → Ferramentas → Scripts, com frequência **de hora em hora**.
4. **Custos:** em **Custos e taxas**, preencher a taxa do gateway de cada loja e o custo dos SKUs. Dá para usar o CSV.
5. **Telegram (opcional):** criar o bot no @BotFather e colar o token e o chat id em **Alertas**.

Nenhum token vai para o chat: ele vai direto na tela.

## O que NÃO foi verificado

- **Nenhuma tela foi aberta no navegador logado.** Eu não digito a sua senha. Foram validadas por typecheck, 777+ testes, o build da Vercel e a revisão de código. A primeira coisa a fazer de manhã é abrir cada tela na prévia.
- **O custo real da consulta de pedidos na Shopify** só se confirma na primeira sincronização.
- **Meta:** se `me/adaccounts` funciona com token de system user. Existe um fallback.

## Revisão

Foram 4 revisores e um cético por achado. **Segurança e regressão saíram limpas**:
- toda rota nova confere o dono;
- os tokens não voltam ao navegador;
- as telas antigas continuam funcionando;
- nenhum componente do navegador importa código de servidor.

**6 problemas confirmados, todos corrigidos** (commit `f5791f8`, migration `053` já aplicada):
1. O sync de pedidos travava para sempre se 200+ pedidos mudassem em menos de 2 minutos (ação em massa). Agora a paginação é retomada entre rodadas.
2. Um erro no detalhe por campanha do Meta descartava o total da conta. Agora o total entra mesmo assim.
3. O gasto tinha só 28 a 30 dias contra 60 de pedidos, o que inflava o lucro de "mês passado". Agora a primeira carga traz 62 dias.
4. Pedido pendente (PIX ou boleto não pago) lançava custo sem receita.
5. O alerta "gastou sem vender" disparava durante a carga inicial de pedidos.
6. O aviso "puxando pedidos" ficava para sempre quando o sync de uma loja falhava.

**Menores, anotados para a próxima rodada** (nenhum quebra nada):
- taxa do gateway zerada em pedido 100% reembolsado;
- custo "4.990" no CSV vira 4,99 (escreva sem separador de milhar);
- dois envios simultâneos do script do Google;
- "Hoje" comparado com ontem inteiro;
- seletor de moeda some no celular;
- alerta de "Meta sem atualizar" logo ao ligar a conta;
- aviso do script do Google para conta recém-criada;
- "Atualizar agora" ignorando o filtro de loja;
- bot do Telegram de instalação (só se `TELEGRAM_BOT_TOKEN` for definida na Vercel; hoje não está).
