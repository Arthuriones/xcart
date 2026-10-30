# Plano 3 — Editar campanhas e regras automáticas no Panda Track

> Pedido em 30/10/2026. Ninguém sobe anúncio pelo Panda Track: dá só para **otimizar** o que já existe. Começa pelo Meta. Google e TikTok vêm depois, no mesmo molde.

## Situação em 30/10/2026 (madrugada)

| Parte | Situação |
|---|---|
| Backend da edição (status, orçamento, lance) | **Feito** (commit 400153e) |
| Backend das regras + cron de 15 em 15 min | **Feito** (commit 400153e) |
| Banco (migration 087: regras e histórico) | **Aplicada** em produção |
| Tela: editar na aba Campanhas | Em andamento nesta noite |
| Tela: página Regras + histórico | Em andamento nesta noite |
| Permissão de edição no Meta (`ads_management`) | **Falta você** reconectar o Facebook com "Permitir editar campanhas" |
| Liberar para clientes (App Review do Meta) | Falta (ver Fase 4) |

## O que entra (só o básico)

**Na aba Campanhas, em cada campanha, conjunto e anúncio do Meta:**
- **Ligar e pausar:** um interruptor na linha.
- **Orçamento:** diário ou total, só em quem o tem. Na campanha em CBO o orçamento é da campanha; em ABO, de cada conjunto. O Panda Track avisa onde mudar quando o orçamento está no outro nível.
- **Lance:** só o valor, dentro da estratégia que já existe:
  - "limite de lance" (bid cap) e "limite de custo" (cost cap): muda o lance;
  - "ROAS mínimo": muda o ROAS mínimo;
  - "menor custo" sem limite: não tem lance para mudar.

**Fica de fora:**
- criar campanha, conjunto ou anúncio;
- trocar a estratégia de lance;
- ligar ou desligar o CBO;
- mexer em público, criativo ou posicionamento.

## Como a edição funciona (a parte de segurança)

1. **Lê o valor de agora no Meta**, não o do Panda Track (que atualiza de 15 em 15 min).
2. **Confere que o objeto é da conta escolhida:** o token do Facebook enxerga outras contas, e o Panda Track não deixa editar uma conta que você não ligou aqui.
3. **Confere se alguém mudou no Meta depois que a tela abriu.** Se mudou, mostra o valor novo e não sobrescreve.
4. **Trava de dígito:** valor mais de 10 vezes o atual é recusado (50 → 5000 por engano).
5. **Mudança de orçamento acima de 20%:** pede confirmação, porque pode reiniciar o aprendizado do Meta.
6. **Histórico:** grava toda mudança, com o que mudou, de quanto para quanto, quando, e se foi à mão ou por regra. Erro também fica gravado.

## Regras automáticas

Exemplo do pedido: *"nesta operação, se o custo por IC do anúncio passar de US$ 20, pausar o anúncio"*. A regra é checada no intervalo que você escolher.

**Cada regra tem:**

| Campo | Opções |
|---|---|
| Onde vale | uma operação (loja ou checkout: todas as contas do Meta ligadas a ela) ou uma conta de anúncio |
| Nível | campanha, conjunto ou anúncio |
| Filtro (opcional) | só os que têm um pedaço de texto no nome |
| Métrica | custo por IC, custo por compra, gasto, CPC, CTR, CPM |
| Condição | passar de / ficar abaixo de um valor |
| Período | hoje, últimos 3 dias, últimos 7 dias (no fuso da conta) |
| Gasto mínimo | abaixo dele o objeto não é julgado (evita pausar com R$ 2 gastos) |
| Ação | pausar; diminuir o orçamento em X% (com piso); aumentar em X% (com teto); só avisar |
| Checar a cada | 30 min, 1 h, 2 h, 3 h, 6 h, 12 h ou 24 h |

**De onde vêm os números:**
- **Gasto, cliques, impressões e IC:** do Meta, pelo sync de 15 em 15 min. O IC do Meta já soma o pixel com o que o nosso servidor manda (CAPI).
- **Compras:** do Panda Track (o pedido com o id da campanha, do conjunto ou do anúncio). Isso é o diferencial: o custo por compra é o real, não o que o Meta acha que vendeu.
  - Conta sem loja (checkout externo ou conta solta): o custo por compra não é contado, e a regra não age.
- **Antes de agir,** o objeto é relido no Meta na hora.

**Sem resultado:** se o anúncio gastou US$ 25 e não teve nenhum IC, o custo por IC já passou de US$ 20, e a regra age. Para "ficar abaixo de", sem resultado nunca conta.

**Travas:**
- só objeto **ativo** é julgado (anúncio de conjunto pausado não gasta);
- conta com o sync do Meta parado há mais de 50 min fica de fora da passada: dado velho nunca dispara ação;
- no máximo 25 ações por regra em cada passada, começando por quem mais gastou;
- no máximo 30 regras por conta;
- o orçamento novo sai do valor ao vivo, nunca abaixo do piso nem acima do teto que você definiu;
- dono sem plano: a regra não roda, mas também não é apagada;
- a loja de demonstração nunca entra;
- botão **"Simular agora"**: mostra o que a regra faria, sem mexer no Meta.

**Quando roda:** o cron passa a cada 15 min (minutos 10, 25, 40 e 55), 5 min depois do sync do Meta. Cada regra roda quando chega a vez dela, pelo intervalo escolhido. Duas passadas ao mesmo tempo não rodam a mesma regra.

## Fases

### Fase 1 — Backend ✅ feito em 30/10

- Migration 087 aplicada:
  - `ad_regras`: o usuário só lê; criar e mudar é pela rota, que confere que a loja, o checkout ou a conta são dele;
  - `ad_alteracoes`: o histórico, gravado só pelo servidor.
- Rotas:
  - `GET /api/ads/meta/objeto`: estado ao vivo;
  - `POST /api/ads/meta/alterar`: status, orçamento diário ou total, lance, ROAS mínimo;
  - `GET`/`POST /api/ads/regras`, `PATCH`/`DELETE /api/ads/regras/[id]`;
  - `POST /api/ads/regras/[id]/simular`.
- Cron `/api/jobs/ads/regras` no `vercel.json`.
- Login do Meta com `?editar=1` pede também a permissão `ads_management`. O login normal continua só leitura, para não arriscar o login de quem não tem papel no app.
- Testes: `tests/ads-gerenciar-regras.test.ts` (23 casos).

### Fase 2 — Telas (esta noite, ver o fim do arquivo)

- Aba Campanhas: interruptor de status e botão "Editar" (orçamento e lance) nas linhas do Meta.
- Página **Regras** no menu, logo depois de Campanhas: lista, criar/editar, ligar/desligar, simular, apagar e o histórico de alterações.
- Integrações › Meta: botão **"Permitir editar campanhas"**.

### Fase 3 — Você testa nas suas contas (você, ~1 dia)

1. Em Integrações › Meta, clique em **"Permitir editar campanhas"** e aceite a permissão nova no Facebook.
2. Numa campanha de teste (orçamento baixo), na aba Campanhas:
   - pause e ative um anúncio;
   - mude o orçamento de um conjunto.
   Confira no Gerenciador de Anúncios.
3. Crie uma regra **"Só avisar"**, rode o **"Simular agora"** e confira se a lista bate com o Gerenciador.
4. Só depois troque a ação para "Pausar" ou "Diminuir orçamento".

### Fase 4 — Liberar para os clientes (Meta, 2 a 4 semanas)

Hoje só quem tem papel no app da Meta (você) recebe a permissão de edição. Para os clientes:
- **Verificação da Empresa** no Business Manager (Cartão CNPJ).
- **App Review do `ads_management` com Acesso Avançado:** a gravação de tela sai da Fase 3. A Meta pede um vídeo de cada uso e uma conta de teste.
- **Depois de aprovado,** os clientes clicam em "Permitir editar campanhas", e o botão pode virar o padrão do login.
- **Quem usa token de usuário do sistema colado:** gera um token novo com `ads_management` no app da própria empresa e cola de novo.

### Fase 5 — Depois do básico (a decidir)

- **ROAS e lucro por anúncio nas regras:** a receita sai dos pedidos e precisa da conversão de moeda da aba Campanhas. Ex.: "ROAS real abaixo de 1,2 nos últimos 3 dias → diminuir 20%".
- **Aviso no celular e no Telegram** quando uma regra agir. Hoje fica no histórico e no último resultado da regra.
- **Regra com horário** (só checar das 8h às 23h) e "desfazer" (religar à meia-noite o que a regra pausou).
- **Google Ads:** precisa da API (a listagem pelo login do Google usa versão que saiu do ar), então vem depois do Meta.
- **TikTok:** a Marketing API do TikTok tem edição de status e orçamento no mesmo molde.
- **App do celular:** usa as mesmas rotas (ver o Plano 1, Fase 3).

## Arquivos

- `src/lib/ads/gerenciar-regras.ts`: regras puras (validação, avaliação).
- `src/lib/ads/gerenciar.ts`: leitura ao vivo, gravação e histórico.
- `src/lib/ads/regras-banco.ts`: escopo, métricas da janela e execução.
- `src/lib/ads/regras-tipos.ts`: contrato das rotas com a tela.
- `src/app/api/ads/meta/{objeto,alterar}`, `src/app/api/ads/regras/*`, `src/app/api/jobs/ads/regras`.
- `supabase/migrations/087_gerenciar_anuncios.sql`.
