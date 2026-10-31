# Plano 1 — App do celular (iPhone e Android)

> Plano passado em 29/10/2026, quando o produto ainda se chamava xcart. Atualizado em 31/10/2026 com o que já foi feito.

| Fase | Situação em 31/10/2026 |
|---|---|
| 0. Contas e aprovações | **Falta** (com você) |
| 1. Backend do app | **Feita** em 29/10 (commit f8348fa, migration 084 aplicada) |
| 2. Edição dos anúncios na web | **Feita** em 30/10 (Plano 3: commits 400153e, b6da458, cd478af) |
| 3. App em Expo | **Código feito** em 31/10 (pasta `mobile/`); falta gerar o build e testar no celular |
| 4. Publicação | Falta |

### Fase 3 em 31/10/2026

- **Código:** pasta `mobile/` (Expo SDK 58, Expo Router), fora do build e do typecheck do site. Como rodar e gerar: [`mobile/LEIA-ME.md`](../mobile/LEIA-ME.md).
- **Telas:**
  - **Login:** a mesma conta do site.
  - **Dashboard:** destaque do lucro, gráfico por dia, cartões, pendências e lucro por loja, com o seletor de loja, período, moeda e comparação.
  - **Campanhas:** campanha, conjunto e anúncio, com ligar/pausar e Editar (orçamento, lance, ROAS mínimo) do Meta.
  - **Ajustes:** aviso de venda, este celular, sair e excluir conta.
  - **Plano vencido:** tela neutra, sem preço, onde ainda dá para desligar o aviso e excluir a conta.
- **Push:**
  - registra o celular a cada abertura e tira ao sair;
  - também tira quando a sessão cai sozinha;
  - tocar no aviso abre o Dashboard.
- **Conferido:**
  - typecheck limpo e `expo-doctor` com 20/20;
  - as três abas e o login vistos no navegador, tema claro e escuro, com dados de exemplo;
  - uma revisão adversarial achou 12 problemas, já corrigidos.
- **Não conferido:** num celular de verdade, nem o push. Isso pede o build do EAS (abaixo).

**Para testar no celular (você, ~30 min):**
1. Criar uma conta grátis em expo.dev e rodar, dentro de `mobile/`: `eas login`, depois `eas init`.
2. Cadastrar as duas variáveis públicas do Supabase com `eas env:create` (os comandos estão no LEIA-ME).
3. `eas build --profile development --platform android` e instalar o APK no seu Android.
4. Para o push no Android: a chave do Firebase (FCM V1) com `eas credentials`.
5. iPhone: só depois da conta da Apple (Fase 0).

O Expo gera iPhone e Android com o mesmo código. O app tem três funções:
- ver o dashboard;
- ver as campanhas;
- mexer nos anúncios: orçamento, lance, ativar e pausar.

**O que manda no prazo:** a Meta só libera editar campanha de **cliente** depois de duas aprovações:
- **Verificação da Empresa:** relatos falam em até ~14 dias úteis no Brasil.
- **App Review da permissão `ads_management`:** a Meta diz "em até uma semana", e pode negar.

Nas **suas** contas a edição funciona sem aprovação nenhuma, porque o seu perfil tem papel no app da Meta. A Utmify já está na App Store com essa mesma função (escalar, pausar, editar lance), sem vender nada dentro do app. Então o caminho é possível.

## Fase 0 — Contas e aprovações (você, começar já, em paralelo)

1. **CNPJ:** confira se é MEI. MEI não entra como organização na Apple, e aí o vendedor aparece com o seu nome pessoal.
2. **D-U-N-S:** é grátis. Leva até 5 dias úteis para sair, mais 2 até a Apple enxergar.
3. **Apple Developer como organização:** US$ 99 por ano. Pede e-mail no domínio da empresa (Gmail não serve) e site no ar.
4. **Google Play como organização:** US$ 25 uma vez. Conta de organização não tem a regra dos 12 testadores por 14 dias.
5. **Meta, no painel do app:**
   - em App Review > Permissões, veja se o `ads_read` está em "Acesso avançado";
   - veja se a empresa já está verificada;
   - se não estiver, comece a Verificação da Empresa com o Cartão CNPJ.
6. **Firebase:** crie um projeto grátis. O push no Android precisa dele.
7. **Nome novo:** com a troca para Panda Track, o nome do app da Meta, a tela de consentimento do Google e o remetente de e-mail do Supabase também mudam. Isso fica no painel de cada um.

## Fase 1 — Backend do app ✅ feita em 29/10/2026

- **Login sem cookie:** o servidor aceita o login que o app manda no cabeçalho (`Authorization: Bearer`). Os números do app saem das mesmas funções do site, iguais aos de lá.
- **Filtro:** loja, período, moeda e comparação vão pelo cabeçalho (`x-xc-*`).
- **Cartões do Dashboard:** a montagem saiu da tela para `src/lib/financeiro/painel.ts`, que a tela e o app usam juntos.
- **Rotas prontas em `/api/app/v1`:**

  | Rota | Para quê |
  |---|---|
  | eu | dados da conta |
  | dashboard | os cartões |
  | dashboard/serie | o gráfico |
  | campanhas | a lista, já filtrada no servidor |
  | aparelhos | registrar o celular para o push (e tirar ao sair) |
  | notificacoes | ligar e desligar avisos |
  | conta | excluir a conta (a Apple e o Google exigem) |

- **Excluir conta:** existe no app e no site (Configurações e paywall). Cancela a assinatura antes e recusa admin.
- **Push de venda:** entra junto dos webhooks de "Venda no celular". Celular que não abre o app há 30 dias para de receber.
- **Páginas legais:** privacidade e exclusão de dados já citam o app.

**Não entrou na Fase 1:**
- a rota "sincronizar";
- preferências de aviso por loja;
- aviso de venda **aprovada**: pede o webhook `orders/paid`, e hoje só existe o `orders/create`;
- e-mail de contato, razão social e CNPJ nas páginas legais (você preenche).

## Fase 2 — Edição dos anúncios, primeiro na web e nas suas contas (eu, ~1 semana)

- **Escopo do MVP:**
  - pausar e ativar campanha, conjunto e anúncio;
  - trocar o orçamento diário ou total, onde ele estiver (na campanha ou no conjunto);
  - lance: só mudar o valor (`bid_amount` ou piso de ROAS) dentro da estratégia que já existe.
- **Fica de fora:** criar campanha, trocar a estratégia de lance e ligar ou desligar o orçamento de campanha. Com mais de 70 conjuntos a Meta nem deixa trocar a estratégia.
- **Leitura a mais no sync:** o status próprio de cada objeto, a estratégia, o lance e o orçamento total de verdade. Hoje o Panda Track não lê o lance.
- **Antes de gravar, o Panda Track confere:**
  - que a conta é sua e está ativa;
  - o valor atual direto no Meta (se mudou desde que a tela abriu, ele mostra o valor novo em vez de sobrescrever);
  - o limite da Meta de 4 trocas de orçamento por hora por conjunto.
- **Histórico de alterações:** quem mudou, de quanto para quanto e quando.
- **Por que na web primeiro:** você testa nas suas contas no mesmo dia, e a gravação de tela que a Meta exige no App Review sai daqui.
- **Envio do App Review do `ads_management`:** a Meta pede gravação de tela, uma descrição por permissão e uma conta de teste.

## Fase 3 — App em Expo (eu, ~1 a 2 semanas)

- **Repositório separado:** fora do repositório do site, para não pesar no build da Vercel.
- **Telas nativas, nada de site dentro do app (a Apple recusa):**
  - Login;
  - Dashboard, com cartões e gráfico;
  - Campanhas, com a edição;
  - Notificações;
  - Conta: sair e excluir.
- **Sem preço e sem botão de assinar.** Plano vencido mostra uma tela neutra, sem link de pagamento.
- **Build:** o iPhone sai pelo EAS, sem precisar de Mac. Testes no TestFlight e no teste interno do Google.

## Fase 4 — Publicação (os dois)

- **Conta de revisor:**
  - para o painel, a loja de demonstração (o gerador dela hoje está preso à sua conta e precisa de ajuste);
  - para a edição, uma conta de anúncio sua com campanha pausada e orçamento mínimo. A Apple não aceita esconder a edição do revisor.
- **Formulários de privacidade:** os rótulos da Apple e o Data safety do Google.
- **Revisão:** a Apple decide 90% em até 48 h; o Google leva até 7 dias.
- **Depois da aprovação da Meta:** os clientes reconectam o perfil do Facebook para ganhar a edição. Até lá, aparece "só leitura".
- **Quem usa token colado:** gera um token novo com `ads_management` no app da própria empresa, e aí edita sem depender da revisão do Panda Track.

## Prazo e custo

| | Prazo estimado |
|---|---|
| Contas da Apple e do Google | 1 a 3 semanas, em paralelo |
| Código das Fases 2 e 3 | 2 a 3 semanas |
| Editar campanha de cliente | depende da Meta: ~2 a 4 semanas se aprovar de primeira |
| **App na loja, com edição nas suas contas** | **~3 a 4 semanas a partir de agora** |

Custo fixo: US$ 99 por ano da Apple e US$ 25 uma vez do Google. Expo, push e Firebase saem de graça no começo.

## Achados no caminho

- **Token do Facebook guardado:** já estava protegido em produção, e a migration 084 passou a ligar a proteção no arquivo também (`ad_connection_secrets`).
- **Contas do Google Ads:** a listagem pelo login do Google está quebrada, porque usa uma versão da API que saiu do ar em 08/2025. Hoje não pesa, porque o gasto vem pelo script. Editar Google Ads fica para depois do Meta.
