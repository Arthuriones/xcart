import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Exclusão de Dados | Panda Track",
  description:
    "Como excluir a conta do Panda Track e os dados dela pelo app ou pelo site, e como revogar o acesso do Panda Track na Meta, no Google e na Shopify.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      atual="data-deletion"
      title="Instruções de Exclusão de Dados"
      description="Esta página explica como excluir a sua conta do Panda Track e os dados associados a ela, direto no app de celular ou no site, e como remover o acesso do Panda Track nas integrações conectadas."
      updatedAt="29 de outubro de 2026"
      sections={[
        {
          title: "1. Como solicitar exclusão",
          body: [
            "No app do Panda Track (iPhone ou Android): abra Conta, toque em Excluir conta e confirme.",
            "No site: entre em user.xcart.app, abra Configurações e, na seção Conta, clique em Excluir conta e confirme.",
            "Se não conseguir entrar na conta, envie uma solicitação pelo canal de suporte informado no painel do Panda Track ou pelo e-mail de suporte cadastrado no aplicativo da Meta. Informe o e-mail da conta usada no Panda Track e a loja Shopify conectada. Não envie senhas.",
            "Se você tem assinatura ativa, a exclusão a cancela antes de apagar a conta. Se o cancelamento não der certo, a conta não é excluída e você pode tentar de novo. Assinatura do sistema de pagamento anterior (Stripe) precisa ser cancelada pelo suporte antes.",
          ],
        },
        {
          title: "2. O que será removido",
          body: [
            "A exclusão da conta remove o perfil e os dados do cadastro (nome, telefone, CPF ou CNPJ), as lojas conectadas, os checkouts externos, os perfis e contas de anúncio conectados, as credenciais e tokens armazenados, os produtos importados, as imagens geradas, as rotas de checkout, os pedidos e custos, os eventos e o histórico do rastreamento, os alertas, os jobs e o histórico operacional associado ao usuário.",
            "Também são removidos os aparelhos cadastrados no app de celular, com o token de notificação de cada um: depois da exclusão, nenhum aviso de venda é enviado.",
            "Dá para remover só uma parte: remover uma loja em Lojas apaga a loja e os dados dela no Panda Track, e sair da conta no app apaga o token de notificação daquele aparelho.",
          ],
        },
        {
          title: "3. O que pode ficar",
          body: [
            "Os registros de cobrança ficam com os processadores de pagamento (AbacatePay e, em assinaturas mais antigas, Pagou ou Stripe), que os mantêm conforme as próprias políticas e obrigações legais. No Panda Track podem ficar os avisos de pagamento recebidos desses processadores, usados para não processar a mesma cobrança duas vezes.",
            "O Panda Track não apaga nada nos serviços conectados: conversões já enviadas ficam nas contas de anúncio (Meta, Google e TikTok), e produtos, pedidos e scripts colocados no tema ficam nas lojas Shopify. Para tirar o acesso do Panda Track nesses serviços, siga as seções abaixo.",
            "Algumas informações podem permanecer temporariamente em backups, logs de segurança ou registros necessários para prevenção de abuso e obrigações legais.",
          ],
        },
        {
          title: "4. Revogar acesso na Meta",
          body: [
            "Para remover o acesso do Panda Track na Meta, acesse as configurações de Apps e Sites da sua conta Facebook/Meta e remova o aplicativo Panda Track. Se ele também aparecer em Integrações comerciais, remova por lá.",
            "Excluir a conta no Panda Track apaga os tokens do Meta guardados no Panda Track; remover o aplicativo na Meta encerra a autorização do lado dela.",
          ],
        },
        {
          title: "5. Revogar acesso no Google",
          body: [
            "Para remover o acesso do Panda Track à sua conta Google (Google Ads), abra myaccount.google.com/permissions e remova o Panda Track da lista de apps com acesso à conta.",
          ],
        },
        {
          title: "6. Revogar acesso na Shopify",
          body: [
            "Para revogar credenciais da Shopify, remova ou rotacione o app/credenciais usados na loja Shopify conectada.",
            "Produtos já criados na Shopify não são excluídos automaticamente por uma solicitação de exclusão de dados no Panda Track, a menos que isso seja solicitado explicitamente e seja tecnicamente possível com as permissões disponíveis. Scripts do Panda Track colocados no tema (rastreamento, ponte ou roteamento) ficam lá até serem tirados do tema.",
          ],
        },
        {
          title: "7. Outras integrações",
          body: [
            "Tokens e segredos informados no Panda Track (TikTok, Cakto, Hubla, Hotmart, bot do Telegram) são apagados junto com a conta. Para invalidá-los também na origem, gere um novo no painel de cada plataforma.",
          ],
        },
        {
          title: "8. Prazo",
          body: [
            "Pelo app ou pelo site, a exclusão é feita pelo próprio sistema quando você confirma, sem depender de atendimento. Solicitações pelo suporte serão processadas em prazo razoável.",
          ],
        },
        {
          title: "9. Confirmação",
          body: [
            "Nas solicitações pelo suporte, enviaremos uma confirmação pelo canal usado na solicitação, quando houver meio de contato disponível.",
          ],
        },
      ]}
    />
  );
}
