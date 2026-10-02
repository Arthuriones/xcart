# Brief: redesign completo do xcart

Você vai refazer o design e a UX do xcart inteiro: design system, navegação e todas as telas. Também vai desenhar funções novas. O produto funciona, mas parece amador perto de Triple Whale, TrueProfit, Shopify e Stripe.

Este brief explica o produto, mostra o que está errado com exemplos reais do código, diz o que copiar de cada referência, o que entregar, em que ordem e o que você não pode mexer. Tudo saiu de um levantamento do repositório feito em 02/10/2026. Os caminhos são relativos à raiz do repo.

---

## 0. Antes de começar

**Leia, nesta ordem:**
1. `CLAUDE.md`, `AGENTS.md` e `ARCHITECTURE.md`. Eles explicam o produto, o roteamento por SKU e as armadilhas conhecidas.
2. `docs/reformulacao-financeiro/LEIA-PRIMEIRO.md` e `docs/reformulacao-financeiro/plano.md`. As telas Lucro, Custos e taxas, Contas de anúncio, Eventos ao vivo e Alertas acabaram de ser feitas (02/10/2026). O plano lista o que vem "Depois" (taxa real do Shopify Payments, custos fixos, IOF), e o seu desenho precisa estar alinhado a essa lista.
3. `design novo/Arquitetura e design system/`, com `HANDOFF.md`, `XCART.dc.html` e `XCART - Centro de Controle.html`. É um protótipo de 13/09/2026, anterior ao financeiro. Tem tokens claro e escuro, Public Sans + IBM Plex Mono, acento terracota `#b04a2f`, linhas de 44px, ⌘K, página de detalhe da loja, configurações/conta e tela de erro. Só uma parte virou código: assistente de importação, console de roteamento, setup, atividade, login e landing.
   - Reaproveite os tokens, os componentes e os padrões dele.
   - **Não herde o modelo mental nem a navegação.** O protótipo põe vitrine → xcart → checkout no centro e usa "Visão Geral" como home. Este brief substitui as duas coisas.
4. `node_modules/next/dist/docs/`, antes de escrever qualquer código. O Next.js 16 é diferente do que você conhece.

**Como trabalhar:**
- O `main` vai direto para produção (user.xcart.app, pela Vercel). Trabalhe num branch próprio (por exemplo, `redesign`), com os commits separados por fase, e mostre o resultado pela prévia da Vercel. Nada entra no `main` sem a aprovação do Arthur.
- Pare no fim da Fase 0 (seção 10) e espere a aprovação antes de escrever código de tela.
- Os mockups da Fase 0 podem estar no formato que você preferir, desde que abram no navegador nos dois temas e em 375px. O padrão do repo é HTML estático, como os protótipos de `design novo/`.
- O trabalho se divide em três tipos, e as seções 8 e 9 dizem qual é qual:
  - **só no front:** faça;
  - **leitura nova de um dado que já existe:** liste e espere aprovação;
  - **backend novo:** desenhe com o estado "Em breve".

---

## 1. Contexto do produto

**O que é.** O xcart é um app web todo em português para quem opera várias lojas Shopify em dropshipping. Roda em três hosts:
- `user.*`: o app, em produção em user.xcart.app;
- `adm.*`: o painel do dono do xcart;
- o domínio público: a landing.

**Quem usa.** Hoje é o Arthur, dropshipper brasileiro que vende para EUA e Europa. A conta dele tem cerca de 10 lojas Shopify conectadas, mas só algumas estão ativas. Na primeira sincronização do financeiro apareceram 7 lojas antigas: pausadas, com o app desinstalado ou com token velho. No futuro ele pode vender o xcart como serviço. Por isso, desenhe:
- para contas de 1 a 20 lojas, com lojas ativas e inativas misturadas;
- para um lojista que nunca viu o código. Nenhum comando de terminal, nome de tabela, variável de ambiente, nome de fornecedor interno ("A Pagou não devolveu…") ou "me avise" pode aparecer na tela.

**O que ele quer resolver ao abrir o app, nesta ordem:**
1. **Quanto lucrei?** Por loja e no total, hoje, ontem e no mês, já descontados produto, frete do fornecedor, taxa de pagamento e anúncio (Meta e Google). E o ROAS real comparado com o ROAS de equilíbrio. O lucro é **estimado**, não contábil.
2. **O rastreamento está funcionando?** As compras estão chegando ao Meta e ao Google pelo servidor? Se não estão, o que ele precisa consertar?
3. **Quebrou alguma coisa?** Os alertas (hoje só pelo Telegram) e onde resolver cada um.
4. **Operar.** Conectar lojas; importar ou clonar produtos (Shopify e Shoplazza, AliExpress, WooCommerce, Nuvemshop, sites genéricos) com tradução e neutralização por IA; comprar créditos.
5. **Roteamento, um módulo opcional.** Uma loja "vitrine" recebe o tráfego. No checkout, o carrinho é redirecionado por SKU para uma das "lojas de checkout", com rodízio entre várias. O catálogo da loja de checkout é neutralizado: texto e imagens genéricos, gerados por IA. O SKU é a única ligação entre as duas lojas.

**O ponto mais importante para a arquitetura:** o Arthur hoje NÃO usa vitrine. Ele anuncia direto na loja de checkout. O menu já coloca Lucro e Rastreamento primeiro, mas o login, a landing, o /setup, o /stores e o paywall só explicam o modelo com vitrine. No redesign, dinheiro e rastreamento ficam no centro, e o roteamento vira um módulo que só aparece para quem usa.

**Mapa atual (menu lateral):**

| Grupo | Telas |
|---|---|
| Financeiro | Lucro (`/financeiro`, a home), Custos e taxas, Contas de anúncio |
| Rastreamento | Saúde dos pixels (`/tracking`), Eventos ao vivo, Alertas |
| Operação | Lojas conectadas, Importar produtos (`/clone/shopify`), Atividade |
| Roteamento | Visão da rota (`/overview`), Roteamento (`/clone/routed-checkout`), Vendas por rota (`/sales`) |
| Sistema | Configuração (`/setup`), Assinatura (`/billing`), Claude (`/claude`) |

**Fora do menu:**
- `/clone`, `/bulk` e `/multi-site`, que só abrem digitando a URL;
- login, cadastro e definir senha;
- o paywall (`/no-access`);
- o admin (`adm.*`): visão geral, usuários, detalhe do usuário, faturamento, uso e custos;
- a landing e as páginas legais.

As URLs antigas `/clone/routed-checkout/active-routes`, `/create-destination`, `/create-route`, `/map`, `/neutralize` e `/script` só redirecionam para o console de roteamento, e precisam continuar redirecionando.

**O que o dado permite e o que não permite.** O design não pode prometer número que o sistema não tem.
- **Histórico de pedidos.** Com a permissão `read_orders`, a Shopify só entrega os últimos 60 dias. O financeiro guarda os pedidos a partir da primeira sincronização, então não existe dado anterior a uns 60 dias antes da conexão de cada loja. "Este ano", "mesmo período do ano passado" e intervalos longos mostram "sem dado antes de DD/MM", nunca zero. Vendas por rota lê a Shopify ao vivo e tem o mesmo teto.
- **Pedido.** A foto financeira do pedido (`fin_orders`) tem valores, frete cobrado, descontos, reembolso, gateways, origem e as linhas (SKU, quantidade e preço). Não tem dado pessoal, país, nome do produto nem foto.
- **Anúncio.** O gasto é gravado por dia, por conta **e por campanha** (`ad_spend_daily`), junto com impressões, cliques e as compras e o valor de compra que a própria plataforma reporta. Hoje nenhuma tela lê o nível de campanha.
- **Eventos.** O feed devolve só colunas tratadas: evento, fonte, destino, status, erro, tentativas, latência, clique (sim/não), origem, UTM e pedido. O payload bruto fica fora da tela de propósito, porque traz IP e user agent em claro.
- **Faturamento.** Inclui o frete cobrado. Para bater com a Shopify, a comparação é com "Vendas totais menos impostos", não com "Vendas líquidas". Os pedidos sincronizam a cada 15 minutos.

---

## 2. Diagnóstico: por que parece amador

O problema não é a paleta. O app não parece um produto só, esconde o que importa, não tem nenhum gráfico e deixa o lojista sem saber o que fazer.

### 2.1 Dois design systems e nenhum componente compartilhado
- **Duas gerações convivem.**
  - A do shadcn: Card com sombra, Button de 40px, Label de 15px em negrito e h1 text-3xl. Aparece em bulk, multi-site, claude, admin e no assistente de rota.
  - O "design novo": denso, com 13px, controles de 26 a 34px e tokens t1–t5. Aparece em financeiro, tracking, alertas, overview, sales e stores.
  - A tela /billing mistura as duas.
- **Componentes repetidos.** Há 6 implementações de KPI, 4 de badge de status e 3 estilos de cabeçalho de tabela. Botão tem pelo menos 4 jeitos: o `Button`, as constantes `BOTAO_PRIMARIO`/`BOTAO_LINHA` redefinidas em cada arquivo, o `VAZIO_CTA` copiado três vezes e o `bg-action`. Os controles aparecem com alturas de 26, 27, 28, 30, 34, 36 e 40px.
- **Valores soltos.** São 22 tamanhos de fonte arbitrários, cerca de 635 ocorrências em 55 arquivos; só a sidebar usa 7 tamanhos. Há 273 classes `[var(--x)]`, porque metade dos tokens não está exposta no `@theme`, e mais uns 100 `style={{}}`.
- **Peças fora do lugar.** Partes do design system moram dentro de pastas de tela: `tracking/selo.tsx` é importado pelo financeiro e pelos alertas. Há componentes copiados com comentários como "Cópia do Numero de overview" e "Cópia do Chip de sales".
- **Primitivos faltando.** `src/components/ui` tem só 14 primitivos. Não existem Table, Chart, Tooltip, Popover, Switch, Checkbox, Skeleton, AlertDialog, DatePicker, Command nem EmptyState.

### 2.2 Hierarquia fraca
- O título aparece duas vezes: o topo mostra "Lucro" e a página repete um H1 de 26px logo abaixo (a mesma string está copiada em 11 páginas). Já Visão da rota, Vendas, Lojas e Importar não têm título nenhum.
- No Lucro, até 12 tipos de aviso ficam empilhados ANTES dos KPIs, todos no mesmo amarelo, sem prioridade e sem como dispensar. "O lucro está inflado", por exemplo, sai em amarelo.
- As métricas centrais do dropshipper (Pedidos, Ticket, CPA, Margem) aparecem em texto cinza de 12px embaixo dos cards.
- Muito texto útil está em 9.5 a 11.5px e nos cinzas t3/t4, que reprovam no contraste.

### 2.3 Nenhum gráfico
- O `package.json` não tem biblioteca de gráfico. A evolução do lucro é uma tabela com uma mini barra de 6px. O único SVG do app é o mapa de rotas, e ele está órfão. Os tokens `--chart-1..5` existem e ninguém usa.
- As tabelas são `div` com grid, sem `table`/`th`. São largas (980 a 1100px) e não têm ordenação, filtro, exportação nem versão para celular. Só Eventos ao vivo vira cartões no celular.

### 2.4 Contexto e filtro inconsistentes
- Existem três modelos de filtro:
  - o seletor global por cookie, presente em só 4 telas (Lucro, Custos, Eventos, Alertas);
  - o período na URL, com chips 7/30/60, em Vendas;
  - o filtro local de loja, em Vendas e em Saúde dos pixels.
  O lojista acha que trocou de loja e continua vendo a outra.
- O seletor global usa `<select>` nativo e só tem presets: não há intervalo personalizado nem escolha de comparação. Ele aparece e some sem aviso, e o seletor de moeda some abaixo de `sm`.
- Há duas "verdades" de faturamento. Vendas lê a Shopify ao vivo e Lucro lê o banco sincronizado. Os números podem não bater, e a tela não explica por quê.
- As horas saem em fusos diferentes: Contas de anúncio usa o fuso do navegador, Lucro usa o do relatório.

### 2.5 Ações que não fecham o ciclo
- O alerta não tem botão de "resolver", só "Silenciar 24 h".
- O resultado das ações não aparece:
  - "Instalar snippet" só mostra um toast, e o texto manda "Recarregue a página"; os KPIs não atualizam;
  - a rota recém-criada só aparece no console depois de recarregar;
  - remover uma loja não tira a linha da lista.
- O passo sem o qual a rota não funciona ("Instalar na vitrine") fica escondido no menu "⋯".
- Nenhuma tela leva ao porquê do prejuízo: não existe lucro por produto, por campanha nem por país.

### 2.6 Configuração técnica demais
- **Meta:** criar um usuário do sistema no Business Manager e colar um token.
- **Google:** colar um script em cada conta e agendar de hora em hora.
- **Shopify:** 6 passos em dev.shopify.com, num modal de 12px.
- **Telegram:** falar com o BotFather e abrir a URL `getUpdates` para achar o `chat.id`.
- A mesma plataforma é configurada em dois lugares. O Meta pede um token em Contas de anúncio (ads_read) e outro no Rastreamento (CAPI). O Google pede "ID de cliente" num lugar e "AW-" no outro.
- Há texto de desenvolvedor na tela: `npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar`, "me avise para subir o limite", "Defina em FX_BRL_RATES", "O backend importa e publica com histórico em jobs" e nomes de tabela em "Detalhes técnicos".

### 2.7 Estados mal tratados
- Oito ações destrutivas usam `window.confirm()` nativo, entre elas remover loja, apagar versão de custo, cancelar assinatura e apagar rota. Revogar acesso no admin e revogar token não pedem confirmação nenhuma.
- O `.skeleton` é um gradiente branco e fica invisível no tema claro, que é o padrão. A tela de carregamento aparece em branco.
- O erro é tratado de 4 jeitos, e várias telas não tratam: Rastreamento, Visão da rota e Vendas. Não há `error.tsx` em `(dashboard)`. O /billing engole a falha e mostra 0 créditos e plano Free. Os erros chegam crus e em inglês: "Failed to save store", "Unauthorized", erro do Supabase.
- Não há `not-found.tsx`, então o 404 é o padrão do Next, em inglês. A importação longa roda no navegador e não avisa quando o usuário sai da página.

### 2.8 Celular quebrado
- A barra inferior tem 4 itens e nenhum "Mais". Ficam sem caminho 11 destinos: Custos, Contas de anúncio, Eventos, Importar, Atividade, Visão da rota, Roteamento, Vendas, Setup, Assinatura e Claude. Também não dá para sair da conta nem trocar o tema. O componente Sheet existe e ninguém usa.
- Tabelas de 1060px rolam de lado. O admin não tem navegação no celular, e a landing não tem menu no celular.

### 2.9 Texto
- **Sem acento** em bulk, multi-site, claude, rotation-panel, add-store-panel e partes de stores ("Importacao", "Configuracao", "Nao consegui").
- **Inglês na tela:** "Select destination store...", "Inventory not tracked", os status "completed/failed" e "Close" no botão de fechar. O admin está metade em inglês.
- **Forma:** plurais com "(s)", mistura de "tu" e "você" e Title Case ("Conectar Loja Shopify", "Criar Conta").
- **Nomes trocados:** a mesma coisa recebe nomes diferentes. "Saúde dos pixels" no menu e "Rastreamento" no H1; "Traduzir modelos" numa tela e "Traduzir cores/tamanhos" na outra.
- **Jargão sem explicação:** gclid, fbc, CAPI, snippet, webhook, rótulo, `{variant_id}`, "SKU map", "dark store", "handle", "Neutralizar (stock)".
- **Rótulo que promete outra coisa:** "Recriar imagens com IA", em /multi-site, aciona "retirar referências externas".

### 2.10 Acessibilidade
- **Contraste no tema claro:**
  - t3 `#8a8a8a`: 3.45:1, em 174 usos de 10.5 a 12px;
  - t4: 2.52:1;
  - warn sobre warn-bg: 3.72:1;
  - ok sobre ok-bg: 4.45:1;
  - borda de campo: 2.09:1.
- **Foco:** 5 arquivos trocam o outline bom (5.43:1) por um anel de 1.83:1. Gatilhos de menu e linhas clicáveis não têm foco visível.
- **Semântica:** as tabelas não têm semântica, e uma linha inteira vira `<button>` com 10 células. Há 54 tooltips `title=`, que não funcionam no toque nem no teclado. Não há nenhum `aria-current` nem nenhum `aria-invalid`/`aria-describedby`. Os cartões de escolha não têm `role=radio/checkbox`.
- **Movimento:** as animações ignoram `prefers-reduced-motion`.

### 2.11 Dois modelos de negócio misturados, lojas antigas e telas órfãs
- O /setup só conhece o modelo com vitrine. Quem anuncia direto no checkout nunca chega a 100%, e o cartão de progresso fica na sidebar para sempre.
- A Visão da rota diz "Nada acontecendo ainda" com lojas vendendo.
- A tela de Lojas mostra "Sem rota", produtos "—" e sync "—" em todas as lojas do Arthur.
- As lojas antigas (pausadas, com o app desinstalado ou com token velho) aparecem misturadas com as ativas no seletor, em Lojas e nos avisos.
- /bulk (a única entrada do AliExpress), /multi-site (cópia quase linha a linha do /bulk) e /clone ficam fora do menu.
- Há componentes prontos sem entrada na UI: `route-map.tsx`, `route-inspector.tsx`, `swap-images-dialog.tsx`, `checkout-settings-dialog.tsx` e `store-role-badge.tsx`.

---

## 3. Referências: o que copiar de quem

| Referência | Copie isto | Onde aplicar no xcart |
|---|---|---|
| **Triple Whale** | Tiles com rótulo, valor e minilinha de tendência; clicar abre gráfico comparado ao período anterior. Seção "Pinned" (alfinete no hover). Multi Shop View: uma linha por loja, "Blended" somando no topo, busca para pular de loja e seletor de data único. Alertas por limite ou anomalia (Moby). | KPIs do Lucro, tabela por loja, Alertas |
| **TrueProfit** | Tudo gira em torno de uma métrica: lucro líquido. Gráfico de linha em que o usuário escolhe as métricas (dia, semana, mês). Alternância entre todas as lojas e uma loja. P&L, lucro por produto, custos fixos recorrentes. Avisa abertamente que os dados mais recentes têm atraso. | Lucro, Custos |
| **BeProfit** | P&L ao vivo mostrando quanto cada custo tira do lucro. Lucro por produto, variante, país e loja. | Cascata do Lucro, abas de detalhe |
| **Polar** | "Key Indicators" mais tabelas e gráficos alternáveis. Comparação no canto superior direito (período anterior ou ano anterior). Ordenação múltipla com Shift, heatmap nas células, top/bottom N. Começar com uma métrica e uma dimensão. | DataTable, barra de contexto |
| **Northbeam** | Barra global de controles (período, comparação, granularidade), padrões recomendados documentados e views salvas com nome. | Barra de contexto, visões salvas |
| **Lifetimely** | Metas por KPI com barra de progresso. E-mail em horário fixo. P&L com COGS, frete, taxas e reembolso em linhas separadas. | Metas, resumo diário |
| **WeTracked** | Promessa de "setup em 5 minutos", feed ao vivo ("há 21 s") e indicador de precisão do tracking. | Saúde dos pixels, Eventos ao vivo |
| **Shopify Admin / Polaris** | Home com tarefas pendentes agrupadas por tipo e com contagem, guia de setup "X de N" e metric cards clicáveis. Index table com busca, filtros, ordenação por popover, seleção com estado indeterminado, ações em massa só quando há seleção, números à direita, Badge com tom e paginação. Empty state que diz por que está vazio e o que fazer. Um banner por vez. Uma ação primária por card. Grade de 4px. | Tudo, principalmente Lucro, listas e estados |
| **Stripe** | Pendências no topo da home. Gráfico com três controles: período, unidade e comparação. Valor em cima e gráfico embaixo, alturas fixas (180 e 320px), mesma altura em loading, erro e vazio. Filtros em chip ("+ Status" vira "Status: Falhou ×"). Busca com operadores e consulta na URL; a tecla "?" lista os atalhos. Empty state com menos de 14 palavras. Spinner só depois de 200 a 300 ms. Botão em estado "pending". Aviso de que o número é estimado. | Lucro, Eventos, estados, busca |
| **Linear** | ⌘K para navegar e agir. Atalhos "g + letra", mostrados dentro dos menus. Display options (agrupar, ordenar, colunas). Custom views. Seleção múltipla com barra de ações. Inbox com lido e adiar. Tema claro e escuro gerado a partir de poucas variáveis. | ⌘K, visões salvas, notificações, tokens |
| **Vercel / Geist** | Sidebar recolhível. "Projeto como filtro": a mesma página alterna entre visão geral e um item (aqui, a loja). Barra inferior no celular. Escala tipográfica nomeada. Status Dot animado enquanto está em andamento e estático no estado final. Empty State em 4 variantes, com 1 CTA e nunca "Começar" ou "OK". | Barra de contexto, mobile, status, estados |

**O que evitar:**
1. **Filtro que só vale em algumas telas.** Toda tela com número diz qual loja, período, moeda e fuso está mostrando, e todas obedecem ao mesmo contexto.
2. **Número sem contexto e gráfico decorativo.** Nada de:
   - KPI sem comparação;
   - moedas somadas sem conversão declarada;
   - fonte proporcional desalinhando colunas;
   - verde e vermelho sem regra (custo que sobe é ruim);
   - pizza e gauge de enfeite.
   Número estimado diz que é estimado.
3. **Feedback do navegador.** Nada de:
   - `confirm()`/`alert()`;
   - erro que exige ação aparecendo só em toast;
   - vários banners empilhados;
   - botão sem estado pending;
   - ação perigosa com o mesmo peso visual de uma normal.
4. **Dashboard-cemitério.** Nada de:
   - dezenas de cards iguais sem hierarquia;
   - densidade variando dentro da mesma página;
   - cor de marca, gradiente e sombra competindo com as cores de status;
   - dashboard em branco para o usuário montar.
   Primeiro vem um padrão opinativo, depois a personalização.
5. **Estados mal tratados.** Nada de:
   - tela inteira esperando a consulta mais lenta;
   - layout pulando;
   - "Nenhum dado" com botão "Começar";
   - "crie o primeiro" quando a lista só está filtrada;
   - erro confundido com vazio;
   - tour que abre sozinho.

---

## 4. Princípios (todos verificáveis)

1. **Um padrão, um componente.** Botão, campo, KPI, selo, tabela, estado vazio, confirmação e cabeçalho de página existem uma vez só, em `src/components/ui` ou `src/components/layout`. Nenhuma tela monta o seu. Para verificar: zero `text-[Npx]`, zero `[var(--x)]` e zero `<select>` ou checkbox nativo nas telas.
2. **Todo número diz de onde vem.** Toda tela com número mostra o contexto que se aplica a ela: loja, período, moeda, comparação e "Atualizado às HH:MM". Tela com período fixo diz isso na barra (por exemplo, "Últimos 7 dias · período fixo desta tela"). O que é estimado aparece como estimado.
3. **O dado é honesto.**
   - Mostre "—" quando não se sabe, e "sem dado antes de DD/MM" quando o período passa do histórico.
   - Erro nunca vira zero.
   - Erro, vazio e "filtrado sem resultado" são três estados diferentes.
   - O dia em curso aparece como "hoje · parcial".
   - A interface nunca mostra número inventado.
4. **Todo problema tem saída.** Cada aviso, alerta ou selo de erro diz o que fazer e tem um botão que resolve ou leva à tela certa, já filtrada.
5. **A ação aparece na tela sem recarregar.** Nenhum texto pede "recarregue a página". Depois de salvar, instalar ou ligar algo, a tela e os KPIs se atualizam.
6. **Dinheiro primeiro, rota é módulo.** Quem não usa vitrine não vê tela vazia, checklist eterno nem "Sem rota" como estado padrão. Loja inativa não polui as listas: fica agrupada à parte.
7. **Uma ação primária por bloco.** Toda ação destrutiva é confirmada num AlertDialog que diz o que se perde.
8. **AA medido nos dois temas.**
   - Texto com contraste de pelo menos 4.5:1; contorno de controle e foco com pelo menos 3:1.
   - Estado nunca é mostrado só por cor, e informação nunca fica só em `title`.
   - Tudo funciona com teclado e leitor de tela.
9. **375px sem rolagem lateral da página.** Toda tabela tem versão em lista ou cartão. No celular, o alvo de toque tem pelo menos 44px.

---

## 5. Design system a entregar

**O que manter, porque está bom:**
- A arquitetura de tokens em duas camadas (`src/app/globals.css`): uma paleta semântica própria, para a qual os nomes do shadcn apontam. O tema escuro é 100% feito por token.
- A direção sóbria:
  - base neutra quente (`#f7f6f5` / `#fff`);
  - botão primário preto sólido;
  - um único acento terracota, reservado a link e foco;
  - estados em trios cor/fundo/borda;
  - superfície chapada com bordas finas.
- Public Sans + IBM Plex Mono.
- O Selo com ponto e palavra (`tracking/selo.tsx`).
- O Aviso acionável agrupado por tipo, um aviso por tipo com as lojas listadas, nunca um por loja (Lucro).
- O KPI do Lucro, com variação e definição de "bom" por métrica.
- "—", "hoje · parcial" e "Como calculamos".
- O seletor por cookie com Suspense por filtro.
- A ordem do menu pelo trabalho do lojista.
- O `app/error.tsx` humano.
- A lista em cartões do Eventos ao vivo no celular.
- O mapa SVG com `prefers-reduced-motion`.
- Os primitivos Base UI.

O que falta é escala, hierarquia e acabamento.

### 5.1 Tokens, claro e escuro
- **Um nome por cor.**
  - Hoje convivem `text-ink` e `text-foreground`, `text-t2` e `text-muted-foreground`, `bg-primary` e `bg-[var(--solid)]`. O erro tem três apelidos (destructive, danger, err), e `--info` aponta para a terracota.
  - Escolha um vocabulário e mapeie o shadcn para ele.
  - Exponha TODOS os tokens no `@theme inline`: solid, on-solid, solid-hover, border-strong, border-subtle, control-border, track, t4, os `*-bg` e os `*-border`.
- **Contraste.** Todo cinza usado em texto útil precisa de pelo menos 4.5:1, e o texto de estado sobre o fundo do estado também. `control-border` precisa de pelo menos 3:1. Entregue uma tabela de contraste com cada par, nos dois temas.
- **Limpeza.** Remova os tokens e utilitários mortos:
  - `--t5`, `--scrim`, `--vitrine-soft`, `--checkout-soft`, `--warning`, `--primary-cyan`;
  - `.bg-brand-gradient`, `.glass-panel`, `.glow-border`, `.stagger-children`, `.animate-scale-in`;
  - `.ambient-bg` e a div dele em `app/layout.tsx`;
  - o `::selection` azul duplicado.
  `--shadow`, `--shadow-panel` e `--chart-1..5` ficam: passam a ser usados (5.3 e 5.5).
- **Tema.** O tema escuro continua 100% por token. Por padrão, ele segue o sistema operacional (hoje `enableSystem={false}`), com troca manual também no celular. Tudo o que hoje escapa do tema passa a usar token:
  - o iframe do cartão (Pagou), fixo em "night" com hex;
  - as faixas do rodízio em oklch fixo;
  - a sombra rgba do Card;
  - o overlay black/10 do Dialog, que some no escuro;
  - o `.skeleton`.
- **Opcional:** gerar a paleta a partir de poucas variáveis em OKLCH, como faz o Linear.

### 5.2 Tipografia
- Mantenha Public Sans no texto e IBM Plex Mono, a não ser que haja um motivo forte para trocar.
- **Escala fechada e nomeada,** com no máximo 7 tamanhos, como tokens `--text-*` no `@theme`. Por exemplo: KPI, título de página, título de seção, corpo, corpo pequeno, rótulo e legenda.
  - Nenhum texto útil fica abaixo de 12px.
  - A base densa de 13px pode continuar nas tabelas, desde que com contraste AA.
- **Números.** Número é sempre tabular e, em tabela, alinhado à direita. Escolha uma regra só, mono em todo número ou sans com `tabular-nums`, e aplique em tudo. Hoje a mesma linha mistura mono de 12px com sans de 12.5px.
- **Formatação única** de moeda, número, %, data e hora, via `Intl` em pt-BR.
  - O formato compacto ("R$ 1,2 mil") fica só no KPI; a tabela mostra o valor completo.
  - A data relativa ("há 3 min") vem acompanhada da data absoluta acessível, não só no `title`.

### 5.3 Espaçamento, layout, raio e elevação
- **Grade de 4px,** com tokens de espaço. O espaço vertical entre blocos de página é um só (hoje varia entre 16, 18, 20, 22 e 24px).
- **Container.** Proponha uma largura máxima e centralize. Hoje o conteúdo cola à esquerda e deixa uns 460px vazios numa tela de 1920px. Critério: em 1440 e em 1920px o conteúdo fica centralizado, sem faixa vazia de um lado só. Tabelas largas podem ocupar a largura toda do container.
- **Raios:** no máximo 3 (controle, card e overlay). Hoje convivem rounded-lg, rounded-xl e raios arbitrários de 3, 5, 7 e 11px.
- **Elevação:** superfície chapada, com borda fina. Sombra só em overlay (popover, menu, dialog, toast), usando `--shadow` e `--shadow-panel`.
- **Densidade** constante dentro de cada página.

### 5.4 Cores de status
- Use seis tons: sucesso, atenção, crítico, informação, neutro e "em andamento" (ponto animado, que fica estático no estado final). Cada tom é um trio cor/fundo/borda, todos AA.
- Status é sempre cor + ponto ou ícone + palavra, em caixa de frase ("Erro", "Sem loja", "Pausada"). Hoje uns aparecem em minúscula e outros com inicial maiúscula.
- Crie um mapa único de estados. Hoje cada tela tem o seu (SEMAFORO, STATUS, ESTADO, COR_ESTADO, COR), e "Pausado" aparece com cores diferentes. O mapa cobre:
  - **loja:** conectada, sem permissão, token inválido, app desinstalado, pausada;
  - **rota:** ativa, pausada, atenção, sem rota;
  - **destino de rastreamento:** enviando, incompleto, desativado, modo teste;
  - **conta de anúncio:** atualizada, aguardando, erro, sem loja, pausada;
  - **job:** na fila, rodando, concluído, falhou;
  - **alerta:** crítico, aviso, resolvido;
  - **semáforo de lucro:** lucro, no limite, prejuízo, sem gasto.
- A terracota fica só em link, foco e acento, e nunca disputa atenção com status.

### 5.5 Gráficos
- Escolha e integre uma biblioteca compatível com React 19 que leia os tokens. Hoje não há nenhuma, e os `--chart-1..5` já estão prontos. Justifique a escolha.
- Siga estas regras, inspiradas no Stripe:
  - valor em cima, gráfico embaixo;
  - linha para tendência, com o período de comparação tracejado;
  - barra para totais por loja, produto ou campanha;
  - cascata ou barra empilhada para a composição do lucro;
  - sparkline dentro do KPI;
  - alturas fixas, cerca de 180px em card e 320px em destaque, e no máximo 3 gráficos por linha;
  - tooltip com o valor exato, acessível por teclado;
  - loading, erro e vazio com a mesma altura do gráfico;
  - trecho sem histórico aparece como lacuna rotulada, não como linha em zero.
- Nada de pizza ou gauge decorativo. Teste a paleta categórica nos dois temas e para daltonismo.

### 5.6 Componentes
Cada componente com todos os estados (padrão, hover, foco, ativo, desabilitado, carregando, erro), nos temas claro e escuro, no desktop e em 375px.

| Componente | Requisitos |
|---|---|
| **Button** | Variantes primária (sólida), secundária, ghost, destrutiva e link. No máximo 3 alturas. Estado pending que impede duplo envio. Botão só de ícone sempre com `aria-label`. |
| **Campos** | Input, Textarea, Select, Combobox com busca, Checkbox (com indeterminado), Switch, RadioGroup e SegmentedControl. Label sempre visível. Ajuda e erro ligados por `aria-describedby`/`aria-invalid`. O erro aparece no campo, não só no toast, e todos os erros aparecem de uma vez. Campo de dinheiro e de % aceita vírgula (hoje um aceita vírgula e o outro só ponto, com placeholder "0,00"). Campo de segredo com mostrar/ocultar. CopyField. |
| **KPI card** | Rótulo, valor tabular, palavra de estado e delta em % com seta e definição de "bom" por métrica. Sparkline, valor do período anterior acessível e tooltip com a definição. O card todo é clicável e leva ao detalhe. Alfinete para fixar. Meta opcional com barra. "Sem base no período anterior" aparece uma vez, não nos 4 cards. |
| **DataTable** | `<table>` semântica, ordenação (múltipla com Shift), colunas que se escondem e reordenam, números à direita, cabeçalho e primeira coluna fixos, linha de total sempre no mesmo lugar, busca, filtros em chip, seleção com indeterminado e barra de ações em massa, ações de linha em menu, paginação ou virtualização, densidade compacta ou confortável, exportar CSV e heatmap opcional. No celular vira lista de cartões, com coluna primária e secundária. |
| **Filtros** | Chips "+ Status" que viram "Status: Falhou ×". "Limpar filtros" só aparece com filtro ativo. O estado fica na URL. |
| **Barra de contexto global** | Loja: combobox com busca, "Todas as lojas", ativas primeiro e inativas num grupo "Sem acesso". Período: presets Hoje, Ontem, 7 dias, 30 dias, Este mês, Mês passado e Este ano, mais calendário de intervalo com dois meses; datas sem histórico ficam desabilitadas com a explicação. "Comparar com": período anterior, mesmo período do ano passado ou personalizado. Moeda (BRL/USD/EUR), fuso explícito e "Atualizado às" com o botão de atualizar. No celular, abre num Sheet. Deixa claro que a escolha vale para todas as telas. |
| **Status** | Badge e StatusDot (ver 5.4). TagPlataforma para Meta, Google e Shopify. |
| **Callout e Central de pendências** | Aviso com ícone, título, detalhe e uma ação. A central agrupa por severidade com contagem, mostra um banner por vez e deixa dispensar o que é informativo, lembrando o que foi dispensado. |
| **EmptyState** | Quatro variantes: primeiro uso, informativo, educativo e guia. O título diz o que falta; a descrição, em menos de 14 palavras, diz quando o dado vai aparecer; um único CTA espelha o título. Mais duas variantes: "Filtrado sem resultado", com "Limpar filtros", e "Em breve", para função sem backend. |
| **Skeleton** | Um por tela, com a geometria do conteúdo e visível nos dois temas. Spinner só depois de uns 300 ms. As seções carregam de forma independente. |
| **ErrorState** | Mensagem em pt-BR que diz o que aconteceu e o que fazer, sem código HTTP, stack, nome de tabela ou nome de fornecedor. Detalhe técnico recolhido e "Tentar de novo". Também vira `error.tsx` por grupo de rotas e `not-found.tsx`. |
| **Toast** | Sucesso, erro, aviso e informação. Multilinha legível: hoje o "\n" cola tudo numa linha. "Desfazer" quando fizer sentido. Nunca é o único lugar de um erro que exige ação. |
| **Overlays** | Dialog; AlertDialog (diz o que se perde, e o botão nomeia a ação); Sheet/Drawer para menu mobile, filtros e detalhe; Popover; Tooltip acessível por toque e teclado. Corrija o bug do `DialogContent`, cujo `sm:max-w-sm` deixa um `max-w-lg` com 384px, e o "Close" em inglês. |
| **Navegação** | Sidebar recolhível, barra inferior no celular, PageHeader (título, descrição, breadcrumb e ação primária), Tabs, Breadcrumb, Pagination e Accordion, que substitui os 7 `<details>` nativos. |
| **Busca** | Command palette (⌘K / Ctrl+K) e Kbd. |
| **Progresso** | Progress (`role=progressbar`) e Stepper de assistente: passos futuros não parecem clicáveis, e o número de passos não muda. Setup guide com "3 de 7", passos expansíveis, check automático e opção de dispensar. |
| **Outros** | Bloco de código copiável (snippet do tema, pixel do checkout, script do Google, comandos MCP), Inbox de notificações e indicador de sincronização. |

### 5.7 Iconografia e movimento
- **Ícones:**
  - só lucide, nos tamanhos 14, 16 e 20 por token, com um strokeWidth só (hoje é 1.75 na sidebar, 2 no resto e 3 no setup) e a sintaxe `size-*`;
  - ícone decorativo leva `aria-hidden`;
  - a logo acompanha o tema (a landing hoje usa um PNG fixo para fundo claro).
- **Movimento:**
  - transições de no máximo 200 ms, só em opacidade e posição;
  - todas respeitam `prefers-reduced-motion` (hoje só a aresta do mapa respeita);
  - linha nova num feed ao vivo ganha um destaque de fundo que some em até 2 s.

---

## 6. Arquitetura de informação

**Hoje:** 5 grupos com 15 itens, 3 telas órfãs, seletor global em 4 telas, nenhuma busca e barra mobile com 4 itens.

**Proposta.** Valide contra os fluxos da seção 7 e ajuste o que for preciso. As mudanças grandes vão para aprovação do Arthur.

| Grupo | Itens | O que muda |
|---|---|---|
| **Lucro** (home) | Lucro · Pedidos (novo, depende da decisão 3) · Custos e taxas | Contas de anúncio vai para Integrações. O Lucro ganha abas "Detalhar por" (seção 7). |
| **Rastreamento** | Saúde dos pixels · Eventos ao vivo | Um nome só no menu e no título. |
| **Alertas** | Alertas, mais um sino no topo | Sai de dentro de Rastreamento, porque o alerta cobre vendas, gasto e rastreamento. |
| **Operação** | Lojas · Importar · Atividade | Importar junta /clone, /clone/shopify, /bulk e /multi-site num lugar, com escolha de origem e uma fila/histórico. Lojas ganha página de detalhe e separa ativas de inativas. |
| **Roteamento** (módulo) | Rotas | Visão da rota, console e Vendas por rota viram uma área só: lista de rotas e o detalhe com abas. Sem rota, o grupo fica recolhido com "Ativar roteamento", sem checklist eterno. |
| **Configurações** | Integrações · Assinatura e créditos · Conta (nova) · Guia de configuração | Integrações junta, por plataforma, o gasto (hoje em Contas de anúncio) e a conversão (hoje na configuração Meta/Google do card de Saúde dos pixels), além dos canais de notificação. Claude/MCP fica em "Avançado". |

**Seletor global.**
- Aparece no topo de toda tela que mostra número e é o mesmo componente, com o mesmo estado, em todas.
- Mantenha o cookie como memória e reflita o contexto na URL, para dar para compartilhar.
- Nenhuma tela pode ter filtro local paralelo de loja ou período. Exceção, até aprovação: **o período** de Saúde dos pixels (janela fixa de 7 dias) e de Vendas por rota (7/30/60, teto da Shopify). Mudar esse período mexe em consulta travada (seção 9). Até lá, a loja vem da barra global e o período fixo aparece escrito na barra.
- Quando uma tela só usa a loja (como Custos), mostre só a loja e deixe isso explícito.
- Clicar numa loja em qualquer tabela entra no contexto dela, com um chip visível "Loja: X ×".

**URLs.**
- Mantenha as URLs atuais e crie rotas novas à vontade (por exemplo, detalhe da loja, Integrações, Conta, Pedidos).
- Rota existente que mudar de nome ganha redirect.
- `/stores` não muda: o retorno do OAuth da Shopify cai em `/stores?installed=1`, e isso vem de `src/app/api/`.

**Busca e atalhos.**
- ⌘K / Ctrl+K leva a qualquer tela, loja, rota, pedido ou produto, e executa ações: trocar de loja, criar rota, importar produto, atualizar agora.
- Busca com operadores: `sku:`, `loja:`, `pedido:`, `status:`, `valor:>100`.
- Atalhos "g + letra", mostrados dentro dos menus, e "?" para listar todos.
- Na sidebar, um bloco "Atalhos" com visões salvas e páginas fixadas.

**Celular.**
- A barra inferior tem Lucro · Rastreamento · Alertas · Lojas · **Mais**. O "Mais" abre um Sheet com o menu completo, a conta, o tema e Sair.
- O topo tem logo, título, botão de contexto (abre o seletor num Sheet), sino e busca.

**Admin (`adm.*`).** Navegação própria, que também funciona no celular, e um link de volta para o app.

---

## 7. Tela a tela

Cada tela tem quatro partes: **Objetivo**, **Mostrar**, **Resolver** (problemas atuais) e **Novo**. Os números entre # remetem à tabela da seção 8.

### 7.1 Casca: layout, sidebar, topo, celular, carregando, erro e 404
`src/app/(dashboard)/layout.tsx`, `src/components/layout/*`, `src/app/error.tsx`, `src/app/global-error.tsx`
- **Objetivo:** saber onde estou e em que contexto (loja, período, moeda), e chegar a qualquer lugar em 1 ou 2 toques.
- **Mostrar:**
  - sidebar recolhível com os grupos da seção 6 e o item ativo marcado com `aria-current`;
  - contadores de lojas e créditos;
  - guia de configuração, só enquanto estiver incompleto;
  - no topo: PageHeader (um título por tela), barra de contexto, busca/⌘K, sino, conta e tema.
- **Resolver:**
  - título duplicado (span de 13px no topo + H1 de 26px) e telas sem título; o PageHeader existe e está morto;
  - nenhum "Mais" no celular (`sidebar.tsx:107` e `:148`);
  - /bulk e /multi-site sem título no topo;
  - rótulos de grupo em 9.5px t4;
  - gatilhos sem foco visível (`sidebar.tsx:236`) e `<nav>` sem `aria-label`;
  - conteúdo sem centralização;
  - `loading.tsx` genérico e invisível no tema claro;
  - nenhum `error.tsx` em `(dashboard)` e nenhum `not-found.tsx`;
  - nenhuma página de conta e nenhum skip link;
  - `global-error.tsx` usa hex inline, o que é aceitável ali; confira só o texto.
- **Novo:** menu "Mais", ⌘K, sino, Conta, 404 e erro em pt-BR, skeleton por tela, skip link e sidebar recolhível.

### 7.2 Lucro: `/financeiro` (home)
- **Objetivo:** em 5 segundos, saber quanto cada loja deixou de lucro no período e se dá para confiar no número.
- **Mostrar:**
  - **Barra de contexto** com "Atualizado às" e UM botão "Atualizar agora". Hoje ele aparece duas vezes, e o resultado sai num toast com as linhas coladas.
  - **Guia de configuração**, enquanto estiver incompleto.
  - **Central de pendências**, agrupada por severidade. Hoje são uns 12 tipos de aviso:
    - carga inicial de pedidos;
    - Shopify negando acesso (um aviso só, com as lojas listadas);
    - falha de sync;
    - conta de anúncio faltando, sem loja ou com erro;
    - script do Google mudo há 3 h;
    - receita sem custo;
    - loja sem taxa;
    - moeda sem cotação;
    - câmbio aproximado;
    - fuso diferente.
    O crítico fica em vermelho ("o lucro está inflado" hoje sai amarelo). A central mostra contagem, deixa dispensar o que é informativo e dá a cada item um botão para Lojas, Integrações ou Custos.
  - **KPIs, todos com o mesmo tamanho de card e de valor:** Faturamento, Gasto em anúncios (Meta/Google), Lucro estimado (cor + palavra), ROAS real (com o ROAS de equilíbrio), Pedidos (+ reenvios), Ticket médio, CPA e Margem. Todos têm delta contra a comparação e sparkline. Hoje os quatro últimos estão em 12px cinza.
  - **Gráfico principal:** receita × gasto × lucro, com a comparação tracejada e granularidade dia, semana ou mês. A linha do período atual sai dos dados do Dia a dia; a tracejada e as sparklines dependem do #1.
  - **Composição do lucro em cascata**, ao lado do gráfico: receita → produtos + frete → taxas → Meta → Google → lucro.
  - **Por loja**, quando há "Todas as lojas" e 2 ou mais lojas. É uma DataTable com:
    - semáforo Lucro / No limite / Prejuízo / Sem gasto, com a legenda junto ao selo e não num rodapé de 11.5px;
    - pedidos, faturamento, gasto, ROAS real, ROAS de equilíbrio, lucro, margem, lucro por pedido e linha Total/Blended;
    - sparkline por loja (#1);
    - lojas sem acesso marcadas como "Sem acesso", fora do total, e não escondidas.
    Clicar na linha entra no contexto da loja, com um chip visível. Hoje o clique troca o cookie global sem aviso, e a linha é um `<button>` com 10 células.
  - **Dia a dia:** DataTable com dia, dia da semana ("hoje · parcial"), pedidos, faturamento, produtos + frete, taxas, Meta, Google, lucro e ROAS, com ordenação e exportação.
  - **Como calculamos**, como Accordion. Inclui que o lucro é estimado, que o faturamento inclui o frete cobrado (na Shopify, compare com "Vendas totais menos impostos") e que os pedidos sincronizam a cada 15 minutos.
- **Resolver:**
  - tabelas de div, sem semântica, com 1060 e 980px, sem versão para celular, sem ordenação, sem CSV e sem coluna fixa;
  - erro de banco cru (`page.tsx:23-24`);
  - "sem base no período anterior" repetido nos 4 KPIs;
  - título duplicado;
  - período só por preset.
- **Novo:**
  - abas "Detalhar por: Loja · Dia · Produto · Campanha · País":
    - Produto mostra o lucro **antes do anúncio**, porque o gasto não é por produto (#3);
    - Campanha usa o dado de campanha que já é gravado (#6);
    - País depende de backend novo (#7);
  - intervalo personalizado e comparação escolhida (#2);
  - metas e projeção do mês (#21);
  - KPI fixado;
  - exportar CSV.

### 7.3 Custos e taxas: `/financeiro/custos`
- **Objetivo:** deixar o lucro real cadastrando, por loja, custo do produto, frete por SKU e taxa do gateway, com o mínimo de digitação.
- **Mostrar:**
  - Com "Todas as lojas": a escolha da loja, com o progresso de cada uma (quantos SKUs têm custo; taxa configurada ou não).
  - Com uma loja:
    1. taxa %, taxa fixa por pedido e custo padrão %, com o selo de configurada;
    2. tabela dos SKUs vendidos em 60 dias, com **foto, nome do produto e variante ao lado do SKU** (#34: hoje as linhas do pedido não guardam nome nem foto), unidades, custo, frete por unidade, moeda (USD/BRL/EUR/CNY), "Vale desde" e situação (com custo, sem custo, editado);
    3. importação por CSV: baixar o modelo já preenchido, escolher ou colar, prévia com erros por linha, SKUs sem venda e "Importar N custos". O aviso para não usar o CSV de produtos da Shopify vira um Callout de atenção acima do campo de importação, e não fica mais no rodapé.
- **Resolver:**
  - SKU sozinho ("CIL-001" não diz nada);
  - tabela sem busca, sem filtro "só sem custo", sem ordenação e sem paginação;
  - botão Salvar no fim da tabela: troque por uma barra fixa "N alterações · Salvar · Descartar";
  - a taxa aceita vírgula e o custo só aceita ponto, com placeholder "0,00";
  - validação só em toast, parando no primeiro erro;
  - "Vale desde" vem com a data de hoje em toda linha, então qualquer edição cria uma versão nova. A regra de versão não muda, porque é ela que congela o custo dos pedidos antigos; muda a apresentação. Hoje o conceito está num parágrafo com "PRIMEIRO" em caixa alta: mostre o histórico como linha do tempo e explique a regra em uma frase junto ao campo;
  - apagar versão usa `confirm()`;
  - "Trocar loja" e sair da página descartam as edições sem avisar;
  - rótulos em 10.5px, plurais com "(s)" e botões montados à mão.
- **Novo** (#23; depende de backend e muda o cálculo, que só pode mudar com aprovação; desenhe como "Em breve" e alinhe com o "Depois" do `plano.md`):
  - "Aplicar a todas as lojas";
  - importar o custo por item da Shopify e o preço do AliExpress;
  - taxa por gateway ou país;
  - taxas da Shopify (plano e transação);
  - custos fixos mensais (apps, assinaturas, equipe);
  - chargeback e margem para devolução.

### 7.4 Contas de anúncio: `/financeiro/anuncios` (vira Integrações → Meta e Google)
- **Objetivo:** ligar as contas Meta e Google a cada loja, para o gasto entrar no lucro, e conferir que o gasto bate com o gerenciador de anúncios.
- **Mostrar:**
  - por plataforma: estado da conexão e a lista de contas (nome, ID, moeda e fuso, loja ligada, ativa, última atualização e selo);
  - **gasto de hoje e do período por conta** (#12: o gasto por conta e dia já é gravado; falta a consulta);
  - busca e filtro, porque há dezenas de contas Meta;
  - na mesma tela da plataforma, lado a lado, "para ler o gasto" (token ads_read ou ID de cliente) e "para enviar conversões" (CAPI ou AW-). Hoje esses dados ficam em telas separadas, e o texto precisa avisar que não são a mesma coisa.
- **Resolver:**
  - Meta exige criar usuário do sistema e colar token; Google exige um script por conta. Enquanto não houver OAuth, desenhe um assistente com passos, progresso e verificação automática;
  - nenhum valor de gasto na tela;
  - Meta e Google com ações diferentes: o Google tem Remover e não tem Sincronizar, o Meta tem o contrário. Iguale as duas;
  - erro mostrado duas vezes;
  - `confirm()` nativo;
  - o checkbox "Ativa" de 14px e o select de loja salvam na hora, sem desfazer. Use Switch com toast e "Desfazer";
  - fuso do navegador diferente do fuso do relatório;
  - selos em minúscula;
  - CTA de vazio com `bg-action`, esqueleto de 2 caixas vazias e nenhum seletor global;
  - o script do Google aparece uma vez só, e isso precisa ficar claro antes de gerar.
- **Novo:** "Conectar com Facebook" e "Conectar com Google" por OAuth (#11, backend novo) como caminho principal, com token e script como "modo manual".

### 7.5 Saúde dos pixels: `/tracking`
- **Objetivo:** saber, por loja, se as compras estão chegando ao Google Ads e ao Meta, e consertar com um clique.
- **Mostrar:**
  - KPIs na janela da tela (hoje fixa em 7 dias, escrita na barra; período escolhível só com aprovação, seção 9): lojas rastreando (de N), pedidos, vendas enviadas e "precisam de você";
  - lista de lojas ordenada por saúde. Cada loja é um cartão ou linha compacta com:
    - o estado (Tudo certo, Precisa de atenção, Parado, Desligado);
    - "Compras chegando" por destino (chegaram/esperados, faltam N, compras sem gclid/fbc);
    - **um** problema principal com **um** botão;
  - o detalhe da loja, em Sheet ou página, com:
    - "O que fazer";
    - pré-requisitos: webhook de pedidos, snippet no tema com instalar/reinstalar, remarketing do Google opcional, e o pixel do checkout com o código e o passo a passo;
    - destinos Meta/Google com contagem por evento (Produto, Carrinho, Checkout, Pagamento, Compra), selo (Enviando, Incompleto, Desativado, Modo teste) e menu com ativar/desativar, editar e remover (avisando que o histórico some junto);
    - diálogo de destino com apelido, ID, rótulo por evento ou token CAPI e código de teste, e formato do ID de produto com sugestões;
  - "Lojas sem rastreamento", "enviada ≠ contada" e "Como funciona".
- **Resolver:**
  - um card empilha tudo e diz o mesmo problema 3 vezes: no aviso, em "O que fazer" e na sub-linha do destino;
  - as ações não atualizam a tela ("Recarregue a página", KPIs parados);
  - `npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar` e "me avise para subir o limite" na tela;
  - webhook faltando só tem "Abrir admin da Shopify";
  - filtro local de loja e nenhum seletor global (a loja passa a vir da barra global);
  - o menu diz "Saúde dos pixels" e o H1 diz "Rastreamento";
  - o diagnóstico sem tratamento de erro derruba a página inteira; a falha de uma loja tem de virar aviso só naquela loja;
  - motivos importantes só em `title`: erro do destino, botão Ligar desabilitado, remarketing desabilitado;
  - jargão sem glossário (gclid, fbc, CAPI, snippet, webhook, rótulo, `{variant_id}`), "teu" misturado com "você", e "Tag de remarketing" num lugar e "Remarketing do Google" no outro;
  - grade por evento com colunas de 60px e rótulo de 10px no celular;
  - componentes copiados;
  - nenhum link para os eventos daquela loja ou daquele destino.
- **Novo:**
  - "Ver eventos", que abre Eventos ao vivo com a loja no contexto (filtro por destino depende do #33);
  - seletor de período e gráfico de eventos/conversões (#24, só com aprovação);
  - "Reinscrever webhook" (#24, backend novo);
  - qualidade de correspondência (EMQ) do Meta (#9, backend novo);
  - comparativo pedidos × enviadas × contadas pela plataforma (#8).

### 7.6 Eventos ao vivo: `/tracking/eventos`
- **Objetivo:** depurar o rastreamento evento por evento, quase em tempo real.
- **Mostrar:**
  - controle "Ao vivo / Pausado" que pareça clicável;
  - "atualizado há N s";
  - contadores de enviados, pendentes e falhas. Hoje contam só as linhas carregadas; contar o período depende do #33. Até lá, o rótulo diz "nas N linhas carregadas";
  - tabela com Hora (com data quando não for hoje), Loja, Evento, Fonte (Tema/Pixel/Webhook), Destino, Status, Latência, Clique, Origem completa (host · utm) e Pedido #, com link para o pedido no admin da Shopify;
  - cartões no celular (mantém);
  - linha nova com destaque breve, e paginação.
- **Resolver:**
  - nenhum filtro: hoje se rola até 500 linhas;
  - os contadores mudam ao clicar em "Carregar mais antigos";
  - erro só no tooltip, e nenhuma linha abre detalhe;
  - hora sem data;
  - cabeçalho em mono 9.5px, caixa alta, t4;
  - "Ao vivo" é um selo dentro de botão;
  - pedido sem link e origem truncada;
  - tabela de div com 980 a 1100px.
- **Novo:**
  - filtros em chip: status, evento, plataforma, destino, loja e UTM/campanha (#33);
  - visões salvas ("Só falhas", "Só compras");
  - Drawer de detalhe (#25) com erro, tentativas, latência, origem, UTM e pedido, que já vêm no feed. Resposta da plataforma e "Reenviar" são backend novo. O payload bruto não aparece, porque traz IP e user agent;
  - exportar CSV.

### 7.7 Alertas: `/alertas`
- **Objetivo:** ver o que está quebrado agora (vendas, rastreamento, gasto), ir direto ao conserto e escolher como ser avisado.
- **Mostrar:**
  - **Abertos**, ordenados por severidade (Crítico, Aviso), com regra, título, loja, detalhe, "aberto há X" e "notificado N vezes". O botão principal é **"Resolver"**, que leva à tela certa já filtrada: Saúde dos pixels, Integrações, Lojas ou Eventos com falhas. Ao lado, um menu "Silenciar";
  - **Resolvidos (7 dias)**, com severidade, duração e detalhe;
  - estado vazio com "última verificação às HH:MM";
  - canais e regras ficam em Configurações → Integrações → Notificações (ou numa aba), e não entre Abertos e Resolvidos.
- **Resolver:**
  - nenhum CTA de conserto;
  - Telegram configurado em 6 passos (BotFather, `/newbot`, `getUpdates` para achar o `chat.id`);
  - só existe Telegram;
  - as 7 regras ficam escondidas num `<details>`, com limites fixos (90 min, 3 h, 30 min, 2 h, reenvio a cada 6 h) e um único "gasto mínimo" global;
  - silenciar é sempre 24 h;
  - checkboxes nativos que só valem depois de Salvar, sem indicar alteração pendente;
  - erro genérico com mensagem crua.
- **Novo** (desenhe completo e marque como "Em breve" o que depende de backend):
  - "Conectar Telegram" em 1 clique, com link `t.me/bot?start=código` (#14);
  - e-mail, push e sino com inbox: não lido, marcar tudo, adiar (#13, #14);
  - regras por loja, com liga/desliga e limites (#15);
  - alertas por limite ou anomalia em métrica, como "lucro de hoje < X" e "ROAS < 1,5" (#15);
  - silenciar por 1 h, até amanhã, 24 h ou até resolver (#15).

### 7.8 Lojas: `/stores`
- **Objetivo:** ver todas as lojas e a saúde de cada conexão, separar as que estão em uso das antigas e entrar numa loja.
- **Mostrar:**
  - PageHeader com "Conectar loja" no topo;
  - DataTable com busca, filtro e ordenação, separando **Ativas** e **Sem acesso** (pausada, app desinstalado, token vencido, sem permissão). Colunas:
    - loja: nome, domínio, link para a loja e para o admin da Shopify;
    - papel (vitrine/checkout), só com roteamento ativo;
    - **saúde da conexão**: token válido e escopos faltando, como read_orders. O sync do financeiro já grava o último erro por loja;
    - moeda e idioma;
    - faturamento e lucro do período, vindos do cálculo do Lucro;
    - estado do rastreamento, vindo do diagnóstico;
    - última sincronização;
    - país, só se o backend passar a fornecer;
  - ações por linha: abrir, Reconectar/Reautorizar, Sincronizar e Remover. Para loja sem acesso, a ação sugerida é "Reconectar" ou "Remover do xcart".
- **Resolver:**
  - a coluna "Conexão" mostra o estado da rota, não o da conexão, e a coluna "Rota" fica sempre vazia;
  - remover não tira a linha;
  - para quem anuncia direto no checkout, toda loja aparece com "Sem rota", produtos "—" e sync "—" (`catalog_synced_at` só é gravado pelo conserto de rota);
  - lojas antigas misturadas com as ativas;
  - colunas fixas que cortam no celular;
  - skeleton de 3 cartões para um conteúdo que é tabela;
  - tela sem título, com "Conectar Loja" escondido no cabeçalho da seção de checkout;
  - card de vitrine feito com `<div onClick>`, e um "⋯" que só abre o editor;
  - nenhum "Reconectar" (a tela de Vendas manda reconectar, e o botão não existe);
  - erro de banco cru;
  - o toast de retorno do OAuth (`?installed=1` / `?error=`) precisa de mensagem humana.
- **Novo:** página de detalhe da loja (7.10, #26) e saúde de todas as lojas numa olhada.

### 7.9 Conectar loja: modal em `/stores` e painel no Roteamento
- **Objetivo:** ligar uma loja Shopify ao xcart com o app customizado: domínio, Client ID, Client Secret e, se o app ainda não estiver instalado, o OAuth da Shopify.
- **Mostrar:**
  - **um único fluxo**, usado nos dois lugares: assistente em passos (criar o app em dev.shopify.com, colar os escopos com o aviso dos escopos protegidos, URL de redirecionamento, URL do app, fluxo legado, lançar a versão, copiar as credenciais);
  - CopyField em cada valor, checklist que dá para marcar e espaço para captura de tela em cada passo (as imagens serão fornecidas depois);
  - validação do domínio e das credenciais antes de seguir;
  - estado "Redirecionando para a Shopify";
  - na volta, sucesso com o próximo passo sugerido: papel da loja, contas de anúncio, rastreamento e custos.
- **Resolver:**
  - os dois formulários ensinam caminhos diferentes na Shopify;
  - o painel do roteamento ignora o `needsInstall` e diz "conectada" quando a loja ficou sem token;
  - 6 passos em texto de 12px num modal com rolagem de 90vh;
  - texto sem acento e com "tu";
  - erros crus em inglês ("Failed to save store", "Unauthorized");
  - Title Case;
  - nenhum próximo passo depois de conectar.
- **Novo:** "Reconectar" reaproveita o mesmo fluxo.

### 7.10 Editor de loja: hoje é o modal "Perfil da Loja", passa a ser a página de detalhe da loja (prevista no handoff)
- **Objetivo:** reunir tudo de uma loja num lugar, organizado em abas.
- **Mostrar:**
  - cabeçalho com nome, domínio, moeda, estado da conexão e escopos;
  - abas:
    - **Visão geral**: lucro e pedidos do período, rastreamento e alertas abertos;
    - **Perfil**: nome e idioma principal da IA;
    - **Marca**: logo principal (até 2 MB), logos adicionais (até 5) e materiais de marca (até 12 imagens de 6 MB), com pré-visualização e a opção de remover antes de subir;
    - **Custos** e **Rastreamento**: atalhos já filtrados para a loja;
    - **Zona de perigo**: "Remover do xcart", num AlertDialog com o inventário do que será apagado (produtos, materiais, rastreamento, rotas).
- **Resolver:**
  - `confirm()` nativo com uma lista de 6 linhas;
  - o botão de remover material só aparece no hover, invisível no toque e no teclado;
  - a lista de idiomas difere da do assistente de rota: aqui tem fr/de/it, lá tem es-CL, es-MX e ja. Use uma lista só;
  - Salvar e Remover ficam juntos num modal pequeno;
  - botão com cor inline;
  - arquivos pendentes aparecem só como chip com o nome;
  - faltam moeda, país, domínio principal, escopos, conexão, rastreamento e custos.
- **Novo:** com o roteamento ativo, dar entrada a dois componentes órfãos como ações da loja: "Refazer imagens com IA" (`swap-images-dialog.tsx`) e "Forçar país/moeda do checkout" (`checkout-settings-dialog.tsx`).

### 7.11 Central de importação: `/clone` (órfã, entra em "Importar")
- **Objetivo:** escolher de onde importar.
- **Mostrar:** o primeiro passo do novo "Importar", com todas as origens:
  - loja Shopify pública (produto, coleção ou loja inteira; o mesmo motor aceita Shoplazza);
  - AliExpress, domínios Shopify e links soltos (hoje em /bulk);
  - Nuvemshop, WooCommerce e sites genéricos (hoje em /multi-site).
  O roteamento sai daqui.
- **Resolver:**
  - nenhum link para esta tela em menu nenhum;
  - grade de 3 colunas para 2 cartões;
  - jargão: "SKU map", "Variant map", "Script no tema", "/products.json", "dark store";
  - não oferece AliExpress, Woo nem sites genéricos;
  - sem título.

### 7.12 Assistente de importação Shopify: `/clone/shopify` (e `/individual`, `/bulk`, `/configuracao`)
- **Objetivo:** copiar um produto, uma coleção ou a loja inteira de uma Shopify pública para uma loja conectada, com tradução e neutralização opcionais.
- **Mostrar:**
  - passos Destino → Escopo → Origem → Seleção (só em massa) → Opções → Revisão;
  - a Seleção com **miniatura**, preço com moeda, busca por título, handle ou SKU, ordenação, categorias e "Selecionar visíveis";
  - as opções agrupadas (Publicação, Tradução, IA de texto, IA de imagem, Estoque, Duplicados, Rota), com os mesmos nomes de /bulk;
  - a Revisão com a **estimativa de créditos contra o saldo** e a prévia de 1 produto antes/depois;
  - progresso com cancelar e a lista de falhas;
  - no fim, um resumo com link para os produtos na Shopify e o próximo passo.
- **Resolver:**
  - a importação é um loop no navegador sem aviso ao sair: avise antes de sair enquanto ela roda;
  - nenhum custo em créditos antes de iniciar;
  - lista sem miniatura e preço "0.00" sem moeda;
  - linhas e cartões sem `role=checkbox/radio`/`aria-checked`;
  - dá para avançar a Seleção sem ter lido o catálogo;
  - passos futuros parecem clicáveis, e o número de passos muda conforme o escopo;
  - até 5 toasts seguidos no fim;
  - "Preparar rota" usa a primeira loja como vitrine sem avisar: peça a vitrine explicitamente;
  - `<select>` nativo misturado com Select do shadcn, e inputs com `outline-none`;
  - jargão ("Neutralizar (stock)", "handle", "Retirar referências externas") e textos sem acento em `clone-shared.tsx` e `CustomPromptDialog.tsx`;
  - o exemplo "criar oferta em 12x", que só faz sentido no Brasil;
  - "Limpar", no prompt personalizado, apaga tudo sem confirmar;
  - coluna fixa de 760px e nenhum h1.

### 7.13 Importação em lote: `/bulk` (órfã, entra em "Importar")
- **Objetivo:** colar até 20 links (produto, domínio Shopify, AliExpress, outros sites) e importar em fila para uma loja.
- **Mostrar:**
  - loja de destino com rótulo, produtos por origem (1 a 250) e estoque;
  - opções com os nomes únicos do Importar;
  - estimativa de créditos;
  - "Iniciar importação" como ação primária destacada;
  - a fila com status em pt-BR, progresso, link para o produto criado, "Tentar de novo" e cancelar (#27).
- **Resolver:**
  - fora do menu, apesar de ser a única entrada do AliExpress;
  - o botão "Atualizar" nasce girando e travado: `jobsLoading` começa `true`, e o `finally` nunca roda sem loja escolhida;
  - inglês na tela ("Select destination store...", "1 product/source", "Inventory not tracked", status "completed/failed/pending" em caixa alta);
  - sem acento, embora `messages/pt.json` tenha as versões certas;
  - jargão de dev ("backend", "jobs enfileirados", "Processar pendentes");
  - "Iniciar lote" perdido na mesma linha dos 7 checkboxes;
  - selects sem rótulo;
  - h1 em text-3xl;
  - "Nenhum job ainda" quando o motivo é não ter escolhido a loja.

### 7.14 Diversos sites: `/multi-site` (órfã, entra em "Importar")
- **Objetivo:** importar de Nuvemshop, WooCommerce, lojas próprias e páginas genéricas, até 20 URLs por vez, em fila.
- **Mostrar:** a mesma experiência de 7.13, só com outra origem escolhida. Não é outra tela.
- **Resolver:**
  - é uma cópia quase linha a linha do /bulk (534 contra 528 linhas) e herda os mesmos problemas;
  - "Recriar imagens com IA" aciona `removeExternalReferences`, ou seja, mantém a marca e limpa referências externas. Renomeie para o que a opção de fato faz;
  - "Traduzir modelos" aqui e "Traduzir cores/tamanhos" lá são a mesma opção;
  - ícone decorativo grande com h1 text-3xl.

### 7.15 Atividade: `/activity`
- **Objetivo:** linha do tempo do que aconteceu na conta.
- **Mostrar:** eventos agrupados por dia, com ícone, cor e palavra de tipo, título, descrição e hora relativa acompanhada da absoluta. Filtro por loja e por tipo, busca e paginação. Cada linha leva ao objeto: loja, rota, importação ou carrinho.
- **Resolver:**
  - limite fixo de 40 eventos;
  - as linhas não levam a lugar nenhum;
  - "Detalhes técnicos" mostra nomes de tabela ao lojista;
  - a cor é o único sinal do tipo;
  - não há agrupamento por dia.
- **Novo:** eventos que hoje faltam (backend novo): jobs de importação, uso de IA, compras de crédito, assinatura, alertas e rastreamento.

### 7.16 Visão da rota: `/overview` (vira a aba "Visão" do detalhe da rota)
- **Objetivo:** ver o estado do roteamento: quem está cobrando, a divisão do rodízio, os problemas e a atividade.
- **Mostrar:**
  - **seletor de rota** (hoje só aparece a primeira, `listaRotas[0]`);
  - números: lojas, lojas cobrando, produtos ligados por SKU e problemas;
  - diagrama vitrine → xcart → lojas de checkout, com estado, % do tráfego e, quando houver dado, carrinhos roteados e receita por destino. Reaproveite `route-map.tsx`, que está órfão;
  - "Requer atenção" no tom certo, com CTA;
  - atividade recente com link e "Ver tudo".
- **Resolver:**
  - quem vende sem vitrine vê "Nada acontecendo ainda". Explique que o roteamento é opcional e aponte para o Lucro;
  - sem H1, sem Suspense e sem tratamento de erro;
  - caixa sólida "XCART", nomes cortados em 120px e barra de 3px;
  - a bolinha é sempre vermelha, mesmo em aviso;
  - atividade em mono 11px truncado e hora em 10.5px t4;
  - "X de Y lojas cobrando" aparece repetido.

### 7.17 Vendas por rota: `/sales` (vira a aba "Vendas" do detalhe da rota)
- **Objetivo:** comparar a receita de cada loja de checkout com a fatia de tráfego que ela recebe no rodízio.
- **Mostrar:**
  - barra de contexto global para a loja; o período continua 7/30/60 dias até aprovação (seção 9), escrito na barra;
  - painéis de Faturamento, Pedidos, Ticket e Loja líder;
  - tabela por loja de checkout (domínio, vitrines de origem, conexão, pedidos, receita), com **% da receita e % do tráfego configurado lado a lado**, mais um gráfico comparando as duas coisas;
  - a fonte do dado e o horário: "Shopify ao vivo", diferente do Lucro (banco sincronizado a cada 15 min), com a explicação;
  - nota sobre o limite de 60 dias da Shopify;
  - aviso de lojas sem permissão, com "Reconectar".
- **Resolver:**
  - na mesma célula, a barra mede a receita relativa e o número mostra o % de tráfego, numa coluna chamada "% do tráfego";
  - terceiro modelo de filtro;
  - duas "verdades" de faturamento sem explicação;
  - sem H1 e sem gráfico, o que deixa a tela redundante com o Lucro;
  - Chip sem foco e sem `aria-pressed`;
  - números alinhados à esquerda;
  - "R$ 1,2 mil" no painel e o valor completo na tabela;
  - só o nome é clicável, mas a linha inteira tem hover;
  - skeleton sem `aria-busy`;
  - erro não tratado.

### 7.18 Console de roteamento: `/clone/routed-checkout`
- **Objetivo:** operar as rotas: estado, divisão do tráfego, teste e conserto do mapa de SKU, instalação do script e pausa.
- **Mostrar:**
  - lista de rotas com filtros (Todas, Ativas, Atenção, Paradas), estado, "x de y lojas", carrinhos em 30 dias e "Nova rota";
  - detalhe com abas: Visão, Lojas e divisão, Vendas, Diagnóstico e Instalação;
  - **"Instalar na vitrine" como passo visível, com estado (instalado ou não)**, e não escondido no "⋯";
  - avisos: última checagem quebrada; mapa velho, com "Conferir agora";
  - lojas de checkout com estado, barra de fatia, %, pausar/retomar e **remover com confirmação**;
  - edição da divisão com % por loja, "Dividir igual", estratégia ("Sempre a mesma loja" ou "Sorteia toda vez"), soma de 100% validada e um botão "Salvar divisão";
  - **aviso de que a nova divisão só chega ao comprador depois de reenviar a configuração ao tema**, com o botão para reenviar;
  - o resultado do "Testar" ao lado do botão: % de cobertura, sem SKU, sem par, variante errada e "Corrigir agora".
- **Resolver:**
  - a rota recém-criada só aparece depois de recarregar;
  - o campo de % grava a cada tecla: digitar "45" grava 4, depois 45, e redistribui as outras lojas a cada passo;
  - "Parar/Voltar" mostra sucesso mesmo quando falha;
  - "Instalar" fica escondido e sem foco;
  - a instrução manda colar antes de `</head>` aqui e antes de `</body>` no assistente. O dev define qual vale (decisão 6); o design mostra uma só;
  - resultado e snippet aparecem longe do botão que os gerou;
  - com a lista escondida, não dá para tirar uma loja da rota, e a lixeira não confirma;
  - "Voltar" e "Parar" são rótulos ambíguos;
  - o RotationPanel usa oklch próprios;
  - `rotaId` inválido mostra a tela em branco (deveria ser not-found);
  - toasts sem acento;
  - a tela inteira assume que existe vitrine.
- **Novo:**
  - dar entrada aos componentes órfãos `route-map`, `route-inspector` e `store-role-badge`;
  - explicar como testar com um carrinho real.

### 7.19 Assistente de nova rota: modal "Conectar vitrine à loja checkout"
- **Objetivo:** montar a loja de checkout a partir da vitrine (modo Gerar, neutralizando texto e imagem), reaproveitar uma existente (Reaproveitar) ou só casar por SKU (Só conectar), e depois ativar a rota.
- **Mostrar:**
  - **página própria (rota nova) ou Sheet com pelo menos 720px de largura**, sem rolagem interna aninhada; com o processo rodando, avisa antes de sair da página;
  - trilha que muda com o modo ("Só conectar" não mostra "Criar destino");
  - seletores de papel que não deixam escolher a mesma loja nos dois e não vêm pré-preenchidos;
  - opções de IA iguais às do Importar;
  - estimativa de créditos contra o saldo, com **o botão bloqueado quando falta saldo** e um link para comprar;
  - progresso em lotes, com cancelar, falhas e a fila de imagens;
  - passo final com o conserto automático, a cobertura e "Ligar mesmo assim". A **instalação automática no tema** é a opção principal, e o snippet manual fica como alternativa.
- **Resolver:**
  - modal `sm:max-w-lg` com rolagem de 60vh e o pedido "mantenha esta janela aberta";
  - "Só conectar" promete "Não cria nada", mas o passo 3 cria produtos e variantes quando sobra item sem par. A lógica não muda; o texto é que precisa dizer a verdade;
  - saldo insuficiente só pinta o aviso de vermelho;
  - os papéis são fáceis de inverter;
  - "Traduzir cores e tamanhos para português" fixo, apesar de haver seletor de idioma;
  - o exemplo "ex.: Northmere" é o nome de uma loja real;
  - custo em US$ quando o crédito é vendido em R$;
  - "loja checkout" escrita de jeitos diferentes;
  - banners e 2 ou 3 toasts por etapa;
  - visual inteiro no shadcn antigo (0 tokens novos, 105 antigos);
  - "Não gerar imagem" manda recriar as imagens "num app da Shopify". Ofereça "Refazer imagens depois", pelo `swap-images-dialog`.

### 7.20 Configuração: `/setup` (vira o guia de configuração)
- **Objetivo:** levar o lojista até a operação no ar.
- **Mostrar:**
  - guia "X de N concluídos" com passos expansíveis, check automático, cada passo revisitável com o seu CTA e opção de dispensar;
  - **dois caminhos**:
    - anúncio direto na loja de checkout: conectar loja → contas de anúncio → custos e taxas → rastreamento → primeira venda rastreada;
    - com vitrine: os mesmos passos, mais vitrine, lojas de checkout, levar produtos, conferir SKUs, dividir tráfego, instalar script e testar;
  - aparece no topo do Lucro e na sidebar enquanto estiver incompleto; em 100%, some com um toast.
  Os dois caminhos mudam o que conta como concluído em `src/lib/setup/status.ts`. Liste essa mudança para aprovação (seção 9).
- **Resolver:**
  - só conhece o modelo com vitrine (`src/lib/setup/status.ts:110-167`), então quem vende direto nunca chega a 100% e o cartão fica na sidebar para sempre;
  - não inclui Lucro, contas de anúncio, rastreamento nem custos;
  - conta "vitrine" com qualquer loja e "checkout" com quaisquer 2, sem olhar o papel;
  - só considera a primeira rota;
  - só o passo atual tem link;
  - "Instalar na vitrine" leva a um console onde a instalação está escondida;
  - o passo "Teste" não explica como testar.

### 7.21 Assinatura e créditos: `/billing`
- **Objetivo:** ver o plano e o saldo, assinar ou cancelar o Pro e comprar créditos.
- **Mostrar:**
  - plano (Free ou Pro), status em pt-BR, renovação ou fim do acesso, e aviso de assinatura legada;
  - saldo e uso do mês, dizendo **o que 1 crédito compra** (1 imagem neutralizada);
  - pacotes (50 por R$ 25, 200 por R$ 75, 500 por R$ 150) com preço por crédito e destaque calculado do mais vantajoso;
  - CPF com label;
  - assinatura com cartão ou Pix de 30 dias;
  - PixDialog com QR, copia-e-cola, **contador dos 12 minutos** e status.
- **Resolver:**
  - se `/api/billing/me` falha, a tela mostra 0 créditos e plano Free sem erro;
  - mostra ao cliente o "custo estimado" interno de IA em US$. Tire isso da visão do cliente;
  - status cru do provedor e "cancelamento agendado" em minúscula;
  - CPF só com placeholder;
  - cancelar usa `confirm()`;
  - os benefícios do Pro diferem dos da landing, e nenhum dos dois cita Lucro ou rastreamento. Deve haver uma lista só, definida pelo Arthur (decisão 2);
  - o iframe do cartão é sempre escuro, com hex fixo. Faça seguir o tema, mudando só as opções visuais do iframe;
  - aparece "NEXT_PUBLIC_PAGOU_PUBLIC_KEY não configurada" na tela;
  - o PixDialog é feito à mão, sem `role=dialog`, `aria-modal` nem foco preso; Esc e clique fora fecham o QR sem perguntar; o nome do provedor aparece no erro;
  - o carregamento é só um spinner.
- **Novo:** histórico de compras e consumo com recibo, alerta de saldo baixo e recarga automática (#29).

### 7.22 Paywall: `/no-access`
- **Objetivo:** quem ainda não tem plano assina ali mesmo.
- **Mostrar:**
  - o que o plano inclui (a mesma lista do /billing e da landing, decisão 2);
  - FAQ, com o texto aprovado pelo Arthur;
  - espaço para prova social, preenchido só com material real;
  - assinar com cartão ou Pix;
  - Sair;
  - estado "Liberando acesso…" depois do pagamento.
- **Resolver:**
  - o cadastro cai direto aqui sem a pessoa ter visto o produto, e a landing não diz que não há teste grátis;
  - só 3 itens de benefício;
  - herda o cartão escuro e o PixDialog do /billing;
  - usa `setTimeout` de 900 ms e `location.replace` sem feedback.

### 7.23 Claude (MCP): `/claude` (vai para Configurações → Integrações → Avançado)
- **Objetivo:** gerar um token e configurar o Claude Code ou o Claude Desktop para operar as lojas conversando.
- **Mostrar:**
  - os 3 passos: gerar o token (mostrado uma única vez, com botão de copiar); o comando `claude mcp add` e o JSON do Desktop; a frase de teste;
  - a lista de tokens com sufixo, uso e expiração (nome e escopo, se o backend permitir);
  - revogar com confirmação.
- **Resolver:**
  - revogar não confirma, e o botão é só ícone, sem `aria-label`;
  - copiar não trata erro;
  - `toLocaleDateString()` sem locale;
  - sem acento;
  - o token é sempre chamado "Claude";
  - CardTitle de 12.5px ao lado de um h1 de 26px, e aviso em amber fixo;
  - é uma tela técnica no menu principal.

### 7.24 Login, cadastro e link de acesso: `/login`
- **Objetivo:** entrar, criar conta ou receber um link por e-mail.
- **Mostrar:**
  - e-mail e senha com `autocomplete` e mostrar/ocultar;
  - **"Entrar com link por e-mail" explícito**, mais "Esqueci a senha";
  - cadastro com nome, regra de senha visível e aceite de Termos e Privacidade;
  - os estados "Confirme seu e-mail" e "Link enviado";
  - mensagem clara para link expirado (`?error=link_invalido`);
  - contagem regressiva no rate limit;
  - painel lateral que vende o produto de hoje (lucro e rastreamento, com o roteamento como módulo), resumido também no celular;
  - depois de entrar, ir para a home oficial `/financeiro`. Isso muda redirect de rota e precisa de aprovação (seção 9): desenhe assim e implemente só depois do ok.
- **Resolver:**
  - link expirado mostra o formulário em branco, sem explicação;
  - depois de entrar, vai para `/stores`;
  - o link mágico existe disfarçado de "Esqueci a senha";
  - sem `autocomplete`;
  - o erro de um modo continua aparecendo no outro;
  - cadastro sem nome, sem regra de senha e sem termos;
  - o painel some no celular e está copiado em set-password;
  - "Criar Conta", "Voltar ao Login", "Email" e "e-mail" misturados;
  - a tagline "Automatize sua loja com IA" não conversa com o produto;
  - o login tira o outline de foco.
- **Novo (opcional, backend):** login social.

### 7.25 Definir senha: `/set-password`
- **Objetivo:** criar ou redefinir a senha depois de entrar por link.
- **Mostrar:** nova senha e repetição, com regra visível desde o início, medidor de força e mostrar/ocultar. Depois de salvar, vai para `/financeiro` (mesma aprovação de 7.24).
- **Resolver:**
  - erro do Supabase cru e em inglês;
  - a dica "Pelo menos 6 caracteres" só aparece depois do erro;
  - sem `autocomplete="new-password"`;
  - vai para `/stores`;
  - painel lateral duplicado do login.

### 7.26 Admin, visão geral: `adm.* /admin`
- **Objetivo:** mostrar ao dono do xcart receita (MRR e créditos), custo de IA, margem, base de usuários, GMV dos clientes e consumo.
- **Mostrar:**
  - KPIs com comparação e tendência onde a API já devolve o período anterior; onde não devolve, sem delta (não invente);
  - receita de crédito em 6 meses, num gráfico com tokens;
  - faturamento dos clientes e base;
  - vendas de crédito recentes, maiores consumidores e cadastros recentes;
  - navegação também no celular, link para o app e a logo real "xcart";
  - a tela "Acesso restrito", com acento.
- **Resolver:**
  - a navegação some no celular;
  - metade da tela em inglês ("Top AI consumers", "Recent signups"…);
  - tabelas sem rolagem dentro de grades de 2 colunas;
  - 11 cards sem comparação;
  - gráfico feito à mão com emerald e amber fixos;
  - o GMV só conta lojas com rota, então quem vende direto fica de fora. Isso é backend: sinalize;
  - o cabeçalho diz "Xcart Admin" só em texto;
  - "Acesso restrito" sem acento.

### 7.27 Admin, usuários: `/admin/users`
- **Objetivo:** liberar ou revogar acesso e ajustar plano e créditos de cada cliente.
- **Mostrar:** DataTable com busca, filtros por plano e acesso, ordenação e paginação. Colunas: e-mail (com selo de admin), acesso, plano e status em pt-BR, créditos, lojas, custo de IA no mês e data de cadastro. Ações de linha.
- **Resolver:**
  - "Revogar" corta o acesso com um clique, sem confirmação;
  - +20 e +100 gravam na hora e fecham o modal, perdendo uma troca de plano ainda não salva;
  - cabeçalhos em inglês ("AI cost (mo)", "Signed up") e data no formato en-US;
  - a engrenagem não tem `aria-label`;
  - status cru do provedor.

### 7.28 Admin, detalhe do usuário: `/admin/users/[id]`
- **Objetivo:** ver tudo de um cliente e gerenciar acesso, plano e créditos.
- **Mostrar:**
  - e-mail com selos e 5 números (plano, créditos, lojas, produtos, rotas);
  - cartão para gerenciar;
  - lojas;
  - rotas com **vários destinos e a divisão de cada um** (o modelo atual);
  - recargas e uso de IA, com as moedas formatadas da mesma forma.
- **Resolver:**
  - `<Button>` dentro de `<a>`;
  - as rotas aparecem como "origem → destino" único;
  - o cartão "Recargas" ocupa meia largura, sozinho;
  - revogar sem confirmação;
  - recargas formatadas à mão em R$ e uso de IA em US$.
- **Novo (backend):** ver como o cliente, notas internas e linha do tempo do cliente (#30).

### 7.29 Admin, faturamento: `/admin/faturamento`
- **Objetivo:** ver o GMV dos clientes por cliente e por loja no período.
- **Mostrar:** período (pela mesma barra de contexto), 3 KPIs, o aviso de total incompleto e uma DataTable com linhas expansíveis acessíveis por teclado (moeda nativa e convertida, "sem read_orders", "não respondeu"). Skeleton da tabela.
- **Resolver:**
  - `<tr onClick>` sem foco e sem teclado, e fragmento sem `key`;
  - sem rolagem horizontal;
  - só mede lojas com rota;
  - "Defina em FX_BRL_RATES" aparece na tela;
  - o carregamento é só um texto.

### 7.30 Admin, uso e custos: `/admin/usage`
- **Objetivo:** ver o custo de IA, a receita mensal e a margem, por dia e por tipo de ação.
- **Mostrar:** 4 KPIs e gráficos com eixo, valores e tooltip acessível, com cada moeda rotulada corretamente.
- **Resolver:**
  - quase tudo em inglês;
  - a margem está em R$, mas aparece com "$";
  - o título diz "(USD)" sobre dados em BRL;
  - a legenda fala em "número verde", mas o número não é verde;
  - gráficos sem eixo, com o dado só em `title`.

### 7.31 Landing: `/` no host público e `/lp`
- **Objetivo:** vender o xcart e levar ao cadastro.
- **Mostrar:**
  - hero e recursos com o produto de hoje: lucro por loja, custos, contas de anúncio, rastreamento Meta/Google pelo servidor, alertas e importação com IA, com o roteamento como um dos recursos;
  - **imagens reais do produto**, usando as telas do redesign;
  - preço formatado com `Intl`;
  - plano e créditos com a mesma lista do app (decisão 2);
  - a política de teste grátis dita com clareza, conforme a decisão 2 (hoje não existe teste grátis);
  - FAQ;
  - espaço para prova social, só com material real (deixe "a definir pelo Arthur");
  - menu no celular;
  - logo que acompanha o tema.
  A copy final é aprovada pelo Arthur.
- **Resolver:**
  - vende só o checkout roteado;
  - nenhuma imagem do produto, prova, FAQ, comparação ou garantia;
  - o menu some no celular;
  - o preço é formatado de 3 jeitos e corta os centavos;
  - não diz que não há período grátis;
  - texto t4 sobre `--solid` sem contraste;
  - logo PNG fixa para fundo claro;
  - benefícios diferentes dos do app.

### 7.32 Páginas legais: `/privacy`, `/terms`, `/data-deletion` (e `/user-data-deletion`)
- **Objetivo:** política de privacidade, termos e instruções de exclusão de dados, exigidos pela Shopify e pelo Meta.
- **Mostrar:** o layout da landing nova com tokens, índice com âncoras de seção e data de atualização.
- **Resolver:**
  - usam o sistema visual antigo (text-3xl, `bg-card/80` com sombra);
  - não têm índice;
  - o texto de privacidade descreve o produto antigo e não cita os dados de rastreamento e de anúncios. **Não escreva texto jurídico**: sinalize ao Arthur.

---

## 8. Funções novas (o "mais funções")

Algumas funções dependem de backend que ainda não existe. Desenhe todas completas. Onde não houver backend, a interface mostra um estado "Em breve" ou um estado vazio honesto, nunca um número fictício.

Na coluna "Backend":
- **Front**: dá para fazer com o que existe;
- **Parcial**: o dado existe e falta consulta ou endpoint de leitura. Siga a regra dos "arquivos novos de leitura" (seção 9): só com aprovação;
- **Novo**: depende de backend que não existe.

| # | Função | O que desenhar | Onde | Backend | Prioridade |
|---|---|---|---|---|---|
| 1 | Gráficos do Lucro | Receita × gasto × lucro, ROAS diário, cascata do lucro, sparklines | Lucro | Front para o período atual (dados do Dia a dia). Parcial para a linha tracejada da comparação e as sparklines (por KPI e por loja): o cálculo devolve só os totais do período anterior e por loja, não a série diária | P1 |
| 2 | Período personalizado e comparação | Calendário de intervalo; comparar com período anterior, ano anterior ou personalizado; datas sem histórico desabilitadas | Barra global | Parcial. O período anterior já é calculado, mas os períodos são presets em `src/lib/financeiro/tipos.ts`, e o intervalo livre muda esse arquivo (aprovação). "Ano anterior" só tem dado quando houver histórico | P1 |
| 3 | Lucro por produto/SKU | Ranking dos mais e menos lucrativos: unidades, receita, custo do produto + frete, **lucro antes do anúncio** e margem; foto e nome via #34 | Lucro → aba Produto | Parcial (as linhas do pedido têm SKU, quantidade e preço; o custo por SKU existe). O gasto em anúncio não é por produto: não chame de "lucro líquido" | P1 |
| 4 | Tela de Pedidos | Lista com loja, valor, custo, lucro estimado, origem, status do envio ao Meta/Google e link para a Shopify | Lucro → Pedidos | Parcial (`fin_orders`, sem dado pessoal). **Depende da decisão 3**: o HANDOFF registrou "sem lista pedido a pedido" | P1, se aprovada |
| 5 | Jornada/atribuição do pedido | Drawer do pedido: origem, UTM, clique, eventos enviados e status por destino, em linha do tempo. Em loja roteada (vitrine → checkout), a compra sai **sem atribuição por decisão do produto**: mostre "Sem atribuição (loja roteada)", sem prometer conserto | Pedidos | Parcial (o feed de eventos já liga pedido, origem, UTM e clique) | P2 |
| 6 | Campanhas | Por campanha: gasto, impressões, cliques, compras e valor de compra reportados pela plataforma e o ROAS da plataforma, com o ROAS real da loja ao lado para comparar | Lucro → aba Campanha | Parcial (já gravado por campanha e dia em `ad_spend_daily`; falta consulta e tela). Lucro por campanha e nível conjunto/anúncio: Novo (exige ligar pedido a campanha) | P1 (parte Parcial); P3 (resto) |
| 7 | Lucro por país | Receita, lucro e margem por país | Lucro → aba País | Novo (o pedido não guarda país) | P3 |
| 8 | Comparativo pedidos × enviadas × contadas | Pedidos na Shopify × compras enviadas pelo xcart × compras contadas pela plataforma, por dia ("enviada ≠ contada") | Saúde dos pixels | Parcial: pedidos e enviadas existem; as compras reportadas pela plataforma existem por conta e campanha, mas não por pixel/AW- | P2 |
| 9 | Qualidade de correspondência (EMQ) | Nota por destino Meta, com tendência | Saúde dos pixels | Novo | P3 |
| 10 | Integrações por plataforma | Meta e Google com gasto e conversão na mesma página | Configurações → Integrações | Front (reorganiza o que existe) | P1 |
| 11 | Conectar Meta/Google por login (OAuth) | "Conectar com Facebook/Google", com modo manual como alternativa | Integrações | Novo | P1 (desenho) |
| 12 | Gasto por conta de anúncio | Hoje e no período, por conta | Integrações | Parcial (gravado por conta e dia; falta consulta) | P1 |
| 13 | Central de notificações | Sino com inbox: não lido, marcar tudo, adiar, link para o conserto | Topo | Parcial (os alertas existem) | P1 |
| 14 | Canais de notificação | Telegram em 1 clique, e-mail, push | Integrações → Notificações | Novo | P2 |
| 15 | Regras de alerta configuráveis | Por loja; liga/desliga; limites; por limite ou anomalia de métrica; silenciar por 1 h, até amanhã, 24 h ou até resolver | Alertas | Novo | P2 |
| 16 | Resumo diário e relatório agendado | E-mail em horário fixo com o lucro de ontem por loja; CSV/PDF agendado | Notificações | Novo | P3 |
| 17 | Onboarding com checklist | Guia com dois caminhos (direto no checkout ou com vitrine), "X de N" e check automático | Lucro + Configurações | Parcial (a maioria dos sinais já existe nos avisos do Lucro; muda `src/lib/setup/status.ts`, aprovação) | P1 |
| 18 | Command palette | ⌘K, atalhos, busca com operadores | Global | Front (navegação e ações); Parcial (busca de objetos) | P1 |
| 19 | Exportar CSV | Em toda DataTable | Global | Front | P1 |
| 20 | Visões salvas | Filtros + colunas + ordenação como abas com nome, favoritas na sidebar, na URL, "Definir como padrão" | DataTables | Front (URL/navegador); Novo (sincronizar entre dispositivos) | P2 |
| 21 | Metas e projeção do mês | Meta por KPI com barra de progresso e projeção | Lucro | Novo | P2 |
| 22 | KPI fixado | Alfinete para levar o KPI ao topo | Lucro | Front | P2 |
| 23 | Custos avançados | Aplicar a todas as lojas, importar da Shopify/AliExpress, taxa por gateway/país, taxas da Shopify, custos fixos, chargeback | Custos | Novo (muda o cálculo; só com aprovação; alinhar com o "Depois" do `plano.md`) | P3 |
| 24 | Rastreamento ativo | Gráfico de eventos com período; "Reinscrever webhook" | Saúde dos pixels | Parcial no gráfico, que mexe em `src/lib/tracking` (aprovação); Novo no webhook | P2 |
| 25 | Detalhe e reenvio de evento | Drawer com erro, tentativas, latência, origem, UTM e pedido; resposta da plataforma e "Reenviar" | Eventos ao vivo | Front para o que já vem no feed; Novo para a resposta e o "Reenviar". O payload bruto nunca aparece (IP e user agent) | P1 (parte Front); P2 (resto) |
| 26 | Página de detalhe da loja | Abas, "Reconectar", "Sincronizar" | Lojas | Front (Reconectar reaproveita o OAuth existente); Parcial (Sincronizar) | P1 |
| 27 | Centro de importações | Fila e histórico persistentes, progresso, tentar de novo, link para o produto | Importar | Parcial (a fila do /bulk existe; a importação Shopify roda no navegador) | P2 |
| 28 | Página de conta | Nome, e-mail, senha | Configurações | Front (Supabase Auth) | P2 |
| 29 | Créditos | Histórico, recibo, alerta de saldo baixo, recarga automática | Assinatura | Parcial (histórico); Novo (resto) | P2 |
| 30 | Admin | Ver como o cliente, notas internas, linha do tempo | Admin | Novo | P3 |
| 31 | "Perguntar ao xcart" (opcional) | Entrada no ⌘K que responde em linguagem natural com o Gemini que o app já usa | ⌘K | Novo | P3 |
| 32 | App instalável com push (opcional) | PWA | Global | Novo | P3 |
| 33 | Filtros e contadores do período em Eventos ao vivo | Chips de status, evento, plataforma, destino, loja e UTM; contadores do período | Eventos ao vivo | Parcial. O RPC `tracking_feed` só recebe lojas, data e limite; filtrar no servidor e contar o período pede migration e mudança em `src/lib/tracking` (aprovação). Antes disso, filtro no front só vale se a tela disser "filtrando as N linhas carregadas" | P1 |
| 34 | Nome e foto por SKU | Nome, variante e miniatura ao lado de cada SKU | Custos, Lucro → Produto, Pedidos | Parcial (nada gravado; buscar na Shopify por SKU com a credencial que a loja já tem) | P1 |

**Fora do escopo sem confirmação:** um catálogo de produtos dentro do app e uma lista pedido a pedido. O HANDOFF registrou a decisão de não ter nenhum dos dois. Agora os dados por pedido existem (`fin_orders`, sem dado pessoal), então a pergunta volta para o Arthur (decisão 3). Desenhe a tela de Pedidos (#4) só como proposta da Fase 0.

---

## 9. Restrições técnicas e o que NÃO pode mudar

**Stack**
- **Next.js 16 App Router.** É diferente do que você conhece: antes de escrever código, leia `node_modules/next/dist/docs/`, como pede o `AGENTS.md`.
- React 19 e TypeScript.
- **Tailwind v4 sem `tailwind.config`**: os tokens ficam em `src/app/globals.css`, via `@theme inline`.
- **shadcn/ui sobre `@base-ui/react`** (não é Radix), cva, **lucide-react**, sonner e next-themes. As fontes vêm via `next/font`, em `src/app/layout.tsx`.
- Hoje não há biblioteca de gráfico; a escolha é sua (5.5) e vai para aprovação (decisão 4).

**Textos**
- Tudo em pt-BR, com acento, "você" e caixa de frase.
- Texto novo vai para `messages/pt.json` / `src/lib/textos.ts`. Hoje `textos()` aparece em só 10 arquivos, e não é obrigatório migrar tudo de uma vez.

**O que NÃO pode ser alterado**
- **Lógica de negócio e cálculos:** `src/lib/financeiro/calculo.ts`, as consultas e as regras de lucro, ROAS e semáforo.
- **APIs e contratos:** as rotas existentes em `src/app/api/*`.
- **Rastreamento:** `src/lib/tracking/*`, `/api/tracking/collect` e `public/xcart-bridge.js`.
- **Roteamento, SKU e rodízio:** `public/routed-checkout-loader.js`, `src/lib/checkout-routes/*` e `src/lib/shopify/cart-routing.ts`. Nunca altere nem apague variantes ou SKUs.
- **Multi-host:** `src/proxy.ts` e `src/lib/supabase/middleware.ts`.
- Migrations do Supabase e `scripts/`.
- **Fluxo de pagamento** (Stripe e Pagou). Pode mudar só as opções visuais do iframe do cartão em `pagou-card-form.tsx` (tema, cores, fonte).
- **O código que o lojista copia sai exatamente como hoje:** snippet do tema, pixel do checkout, script do Google e comandos/JSON do MCP. Mude só a apresentação.

**O que pode ser criado, com aprovação: arquivos novos de leitura**
- São arquivos NOVOS que só leem dado que já existe (uma consulta, uma rota GET), sem migration e sem tocar nos arquivos travados acima.
- Para número de lucro, reaproveite as funções de `src/lib/financeiro/calculo.ts` sem alterá-las.
- Cada arquivo é listado na Fase 0, com o que lê, e só entra depois da aprovação.

**URLs**
- As URLs atuais continuam respondendo; rota renomeada ganha redirect.
- `/stores?installed=1` e os redirects antigos de `/clone/routed-checkout/*` não mudam.

**Testes que travam comportamento**
- `tests/rotation-parity.test.ts`, `tests/tracking-eventos.test.ts` e `tests/tracking-ponte-advertorial.test.ts`.
- `npm test` e `npm run typecheck` (o que o build da Vercel roda) precisam passar.

**Dados**
- Sempre reais. Na interface não há número inventado: "—" quando não se sabe, "sem dado antes de DD/MM" fora do histórico, erro nunca vira zero, estimado aparece como estimado.
- Nos mockups, dado de exemplo é aceitável, mas desenhe também o estado sem dado.
- Estados vazios são honestos, e "Em breve" vale para toda função sem backend.

**Qualidade obrigatória**
- Acessibilidade AA.
- Celular em 375px.
- Modo claro e modo escuro.
- `prefers-reduced-motion`.

**Gotchas que o design precisa mostrar**
- Mudar a divisão do rodízio só chega ao comprador depois de reenviar a configuração ao tema.
- Em loja roteada, a compra sai sem atribuição, por decisão do produto.
- Lucro por produto é antes do anúncio.
- O histórico de pedidos começa uns 60 dias antes da conexão de cada loja.

**Arquivos de tela gigantes** (`tracking-screen.tsx` com 1621 linhas, `import-wizard.tsx` com 1178, `stores-screen.tsx` com 984…): você pode quebrar em componentes, desde que não mude o que eles buscam e gravam.

**Bugs de front que o redesign resolve naturalmente.** Pode corrigir sem mudar API, registrando cada um:
- toast perdendo as quebras de linha;
- `.skeleton` invisível;
- largura do Dialog;
- "Atualizar" travado em /bulk e /multi-site;
- remover loja sem atualizar a lista;
- rota nova sem aparecer;
- "Parar/Voltar" sem conferir a resposta;
- % gravando a cada tecla;
- AddStorePanel ignorando `needsInstall`;
- avançar a Seleção sem catálogo;
- /billing engolindo a falha;
- login sem ler `?error=`;
- +20/+100 do admin fechando o modal;
- `<tr>` sem teclado;
- `<Button>` dentro de `<a>`;
- importação sem aviso ao sair da página;
- falha de diagnóstico de uma loja derrubando /tracking.

**Ajustes que parecem visuais, mas tocam rota, lógica ou backend.** Liste separado e não aplique sem aprovação:
- ir para `/financeiro` depois do login (hoje vai para `/stores`, em `callback/route.ts`, no login e em set-password);
- período escolhível em /tracking (a janela de 7 dias mora em `src/lib/tracking`) e em /sales (consulta da Shopify ao vivo, com teto de 60 dias). A loja vinda da barra global é só front e pode ser feita;
- filtros no servidor e contadores do período em Eventos ao vivo (RPC `tracking_feed`, migration);
- intervalo de datas livre (`src/lib/financeiro/tipos.ts`);
- guia de configuração com dois caminhos (`src/lib/setup/status.ts`);
- GMV do admin incluindo quem vende sem rota;
- instrução `</head>` × `</body>`;
- todo arquivo novo de leitura.

---

## 10. Entregáveis, ordem e critérios de aceite

### Ordem de entrega

**Fase 0: proposta, antes de qualquer código. Pare e espere a aprovação do Arthur.**
1. Mapa de navegação final: o que foi unido, renomeado ou movido, e por quê, com a lista de URLs novas e redirects.
2. Fundação: tokens claro e escuro com **tabela de contraste** de cada par (texto/fundo, estado/fundo, borda de controle, foco), escala tipográfica, espaçamento, raios, elevação e paleta de gráfico.
3. Mockups em alta das telas-âncora, cada uma em claro, escuro e 375px:
   - Lucro (gráfico, pendências, por loja, abas de detalhe);
   - Saúde dos pixels (lista + detalhe da loja);
   - Eventos ao vivo (filtros + detalhe);
   - Alertas;
   - Lojas (ativas e sem acesso) + detalhe da loja;
   - Integrações → Meta;
   - casca com menu mobile, barra de contexto e ⌘K.
4. Lista dos arquivos novos de leitura que você pretende criar, com o que cada um lê e para qual função da seção 8.
5. Lista de decisões para o Arthur (abaixo).

**Fase 1: fundação em código.**
- `globals.css` com o `@theme` completo e os tokens mortos removidos.
- Primitivos da seção 5.6 em `src/components/ui`, com todos os estados.
- Um catálogo navegável dos componentes (página só em desenvolvimento ou arquivo de referência).

**Fase 2: casca.** Sidebar, topo, PageHeader, barra de contexto, "Mais" no celular, ⌘K, sino, `loading`, `error.tsx` e `not-found.tsx`.

**Fase 3: telas, nesta ordem.**
1. Lucro
2. Custos
3. Integrações (Contas de anúncio)
4. Saúde dos pixels
5. Eventos ao vivo
6. Alertas
7. Lojas, detalhe da loja e conectar loja
8. Importar (/clone, /clone/shopify, /bulk, /multi-site)
9. Atividade
10. Roteamento (visão, console, assistente, vendas)
11. Setup
12. Billing e paywall
13. Claude
14. Login e definir senha
15. Admin (5 telas)
16. Landing
17. Páginas legais

**Fase 4: funções novas.**
- As P1 marcadas como Front, funcionando de verdade.
- As P1 marcadas como Parcial, funcionando de verdade depois da aprovação dos arquivos de leitura.
- As que dependem de backend novo, com estado "Em breve" ou vazio honesto, mais uma especificação curta do dado que falta, para o dev.

**Por tela, entregue:**
- antes e depois (captura);
- os estados carregando, vazio, filtrado sem resultado, erro, parcial e sem histórico;
- claro e escuro;
- 375px;
- a lista de bugs corrigidos e o que ficou dependendo de backend ou de aprovação.

### Critérios de aceite (checklist)
- [ ] Nenhuma ocorrência, nas telas, de: `window.confirm`, `text-[Npx]`, `[var(--`, cor em `style={{}}`, `<select>` ou checkbox nativo, `focus-visible:outline-none` sem substituto de pelo menos 3:1, "Close" em inglês, texto sem acento, inglês na interface ou plural com "(s)".
- [ ] No máximo 7 tamanhos de fonte, 3 alturas de botão e 3 raios, todos por token.
- [ ] Tabela de contraste AA aprovada nos dois temas; axe-core sem violações de impacto "serious" ou "critical" nas telas da Fase 0.
- [ ] Toda informação de `title=` também acessível por toque e teclado.
- [ ] Nenhuma página com rolagem horizontal em 375px; toda tabela com versão em cartões.
- [ ] Todas as telas alcançáveis pelo menu, no desktop e no celular; nenhuma tela órfã; Sair e tema disponíveis no celular.
- [ ] Toda tela com número mostra o contexto que se aplica a ela (loja, período, moeda, atualização) e obedece à barra global. Nenhum filtro local paralelo de loja ou período; a única exceção é o período fixo de Saúde dos pixels e de Vendas por rota até a aprovação, escrito na barra.
- [ ] Nenhum período sem histórico aparece como 0.
- [ ] Toda tela com os estados carregando (fiel ao layout), vazio, filtrado sem resultado e erro; `error.tsx` e `not-found.tsx` em pt-BR.
- [ ] Todo aviso, alerta e selo de erro com CTA para a tela certa; nenhum texto pedindo para recarregar.
- [ ] Toda ação destrutiva em AlertDialog; todo botão de envio com estado pending.
- [ ] Teclado: tudo alcançável, foco visível, ⌘K funcionando, Esc fechando overlays, `aria-current` no menu, tabelas semânticas.
- [ ] Um título por tela (PageHeader), sem duplicar o do topo.
- [ ] Nenhum número inventado; "—", estimado, "parcial" e "sem dado antes de" rotulados.
- [ ] `git diff` sem nenhum arquivo da lista "NÃO pode ser alterado"; códigos copiáveis idênticos aos de hoje.
- [ ] URLs atuais respondendo ou redirecionando.
- [ ] `npm run typecheck` e `npm test` passando.
- [ ] Tudo num branch próprio, com prévia da Vercel; nada no `main` sem aprovação.

### Decisões que você precisa trazer para o Arthur
1. A nova arquitetura: Integrações unindo Contas de anúncio com a configuração Meta/Google do Rastreamento; Alertas fora de Rastreamento; Roteamento como módulo recolhido.
2. Uma lista única de benefícios do plano (landing, paywall e /billing) e se haverá teste grátis.
3. Se deve existir catálogo de produtos e lista pedido a pedido no app. O HANDOFF diz não às duas; os dados por pedido agora existem.
4. A biblioteca de gráfico e a regra de número (mono ou sans tabular).
5. A prioridade das funções que dependem de backend novo.
6. O ajuste do pós-login para `/financeiro` e qual instrução do script vale (`</head>` ou `</body>`).
7. Período escolhível em Saúde dos pixels e Vendas, filtros no servidor em Eventos ao vivo, intervalo de datas livre e guia com dois caminhos: tudo isso mexe em consulta ou lógica.
8. A lista de arquivos novos de leitura.
9. O texto da política de privacidade, que é jurídico e não é seu.