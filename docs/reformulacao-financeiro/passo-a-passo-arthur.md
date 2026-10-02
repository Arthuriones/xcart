# O que só você pode fazer

Nenhum token, chave ou segredo vai para o chat. Credencial é colada na tela do xcart ou nas variáveis da Vercel.

Nenhum token, chave ou segredo vai para o chat. Tudo o que é credencial é colado na própria tela do xcart ou nas variáveis da Vercel.

**ANTES DO DEPLOY**

1) Aplicar a migration supabase/migrations/052_financeiro.sql no Supabase, do mesmo jeito das anteriores (SQL Editor ou `supabase db push`; não verifiquei qual você usa). Depois rodar as 4 consultas has_function_privilege/has_table_privilege do fim do arquivo: todas devem dar false.

2) Aprovar a mudança de arquitetura: o xcart passa a guardar uma "foto financeira" de cada pedido (valores e SKUs, sem nome, e-mail, telefone ou endereço). Isso inverte a decisão registrada em src/lib/sales/queries.ts.

**META (cerca de 15 min)**

3) Descobrir de onde vem o token atual do CAPI. Abrir https://developers.facebook.com/tools/debug/accesstoken/, colar o token e anotar:
- o app;
- o usuário do sistema;
- os escopos.
Se o app for o "Conversions API app" criado pelo Events Manager, talvez seja preciso um app seu, do tipo Business, com o caso de uso "Create & manage ads with Marketing API".

4) No Business Manager, em Configurações > Usuários > Usuários do sistema, escolher o usuário do sistema. O nível Limited só permite 1 comum + 1 admin por portfólio.
- Em "Atribuir ativos" > Contas de anúncio, marcar cada conta das lojas com "Ver desempenho".
- Conta que estiver em OUTRO portfólio: primeiro compartilhar como parceiro, depois atribuir.

5) Ainda no usuário do sistema, clicar em "Gerar novo token":
- escolher o app;
- validade "Nunca";
- marcar SÓ ads_read.
Este token NÃO substitui o do CAPI.

6) Testar no Graph API Explorer:
- me/adaccounts?fields=id,name,currency,timezone_name
- act_<ID>/insights?date_preset=yesterday&fields=spend
Se der erro 200 ou 10, me avisar: aí entra a questão do App Review, que a doc trata de forma contraditória.

7) No xcart, em Contas de anúncio:
- colar o token;
- ligar cada conta à loja: Lash Bestie qkgknv-w3, Softnook kphigm-76;
- clicar em "Sincronizar agora".
Se possível, deixar o fuso de cada conta igual ao da loja.

**GOOGLE (cerca de 5 min por conta: 2 da Softnook + 1 da Lash Bestie)**

8) Pegar o ID de CLIENTE de cada conta, no formato 123-456-7890, que aparece no topo do Google Ads. NÃO é o AW-18463833677, o AW-18463882690 nem o AW-18419000686.

9) No xcart, em Contas de anúncio > Google:
- informar o ID e a loja;
- copiar o script, que só aparece uma vez.

10) No Google Ads, em Ferramentas > Ações em massa > Scripts > + > Novo script:
- colar o script;
- Autorizar;
- Visualizar (deve aparecer "N linhas" no log);
- Salvar;
- na Frequência, escolher "De hora em hora".
Se essa opção não existir, me avisar: a doc oficial não confirma o agendamento por hora.

11) OPCIONAL, mas recomendado, em paralelo (30 a 45 min): pedir o nível Explorer da Google Ads API, para depois trocar os scripts por leitura automática sem colar nada em cada conta. Desde 09/09/2026 não existe mais developer token nem exigência de MCC.
- Em https://console.cloud.google.com, criar o projeto "xcart-ads" sem organização.
- Ativar a "Google Ads API".
- Na página "Google Ads API Overview", concluir a inscrição (os termos são seus) e clicar em "Apply for access" no nível Explorer.
- Me dizer qual nível ficou: Test ou Explorer.
Só depois disso criar a conta de serviço. A chave vai direto para as variáveis da Vercel, marcadas como Sensitive, nunca para o chat.

**CUSTOS E TAXAS**

12) Em cada loja, abrir Shopify > Configurações > Pagamentos e anotar:
- se usa Shopify Payments;
- quais gateways de terceiro estão ligados, com a taxa percentual e a fixa;
- o plano da loja.
Lançar a taxa em Custos e taxas.

13) Em Custos e taxas, preencher o custo de cada SKU vendido, com o custo do produto e o frete do fornecedor por unidade, na moeda do fornecedor. Dá para fazer direto na tabela ou pelo CSV de modelo.
- Para começar rápido, preencher o "custo padrão %" por loja.
- NUNCA lançar custo pelo CSV de produtos da Shopify com "sobrescrever": isso apaga as variantes.

**TELEGRAM (cerca de 5 min)**

14) No Telegram:
- abrir o @BotFather e mandar /newbot;
- dar um nome e um username terminando em "bot";
- copiar o token.
Depois abrir a conversa com o bot novo e mandar /start.

15) No navegador, abrir https://api.telegram.org/bot<TOKEN>/getUpdates e copiar o número que aparece em "chat":{"id": ...}.

16) No xcart, em Alertas:
- colar o token e o chat id;
- Salvar;
- Testar.
Ajustar ali o "gasto mínimo para alertar gastou sem vender" (o padrão é 30, na moeda da conta).

**CONFERÊNCIA (depois de 1 hora no ar)**

17) Comparar o "Faturamento" de ontem da Lash Bestie no Lucro com "Vendas líquidas" do admin da Shopify. Comparar também o gasto de ontem com o Gerenciador de Anúncios e com o Google Ads. Me passar as diferenças.
