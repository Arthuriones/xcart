import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Política de Privacidade | xcart",
  description:
    "Política de privacidade do xcart para usuários, lojas conectadas e integrações com Shopify e Meta.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Política de Privacidade"
      description="Esta política explica quais dados o xcart coleta, como usa esses dados e quais controles o usuário possui ao conectar lojas Shopify e ferramentas de IA."
      updatedAt="8 de maio de 2026"
      sections={[
        {
          title: "1. Quem somos",
          body: [
            "xcart é uma plataforma para importar, otimizar, clonar e publicar produtos em lojas Shopify, e rotear o checkout entre elas.",
            "Esta política se aplica ao uso do site, painel, integrações de Shopify e recursos de IA oferecidos pela plataforma.",
          ],
        },
        {
          title: "2. Dados que coletamos",
          body: [
            "Coletamos dados de conta necessários para autenticação, como identificador do usuário, e-mail quando disponível e registros de sessão.",
            "Quando o usuário conecta uma loja Shopify, armazenamos dados da loja, domínio, nome, credenciais informadas pelo usuário e configurações necessárias para executar importações, publicações, checkout roteado e setup da loja.",
            "Também podemos armazenar produtos, imagens, descrições, reviews sintéticos, legendas, histórico de jobs, logs de execução e preferências de idioma/configuração.",
          ],
        },
        {
          title: "3. Como usamos os dados",
          body: [
            "Usamos os dados para autenticar usuários, conectar serviços autorizados, importar produtos, criar produtos na Shopify, gerar conteúdo com IA e rotear o checkout entre lojas conectadas.",
            "Os dados de produtos e lojas podem ser enviados a provedores de IA apenas quando o usuário aciona recursos como otimização, tradução, geração de reviews, neutralização de produtos ou preparação de posts.",
            "Não vendemos dados pessoais. Não publicamos conteúdo em lojas ou redes sociais sem ação ou configuração do usuário.",
          ],
        },
        {
          title: "4. Compartilhamento com terceiros",
          body: [
            "Compartilhamos dados apenas quando necessário para operar o serviço: Shopify para gerenciar lojas e produtos para autenticação e publicação, Supabase para banco de dados/autenticação/armazenamento e provedores de IA para geração de conteúdo quando acionada.",
            "Cada serviço de terceiro processa dados de acordo com seus próprios termos e políticas.",
          ],
        },
        {
          title: "5. Tokens e credenciais",
          body: [
            "Tokens, chaves e credenciais conectadas são usados para executar ações autorizadas pelo usuário. Esses dados são armazenados para manter integrações funcionando até que o usuário remova a conexão ou solicite exclusão.",
            "Recomendamos que o usuário conecte apenas contas e lojas que possui ou está autorizado a administrar.",
          ],
        },
        {
          title: "6. Retenção e exclusão",
          body: [
            "Mantemos dados enquanto a conta estiver ativa ou enquanto forem necessários para fornecer o serviço, cumprir obrigações técnicas, prevenir abuso ou manter histórico operacional solicitado pelo usuário.",
            "O usuário pode solicitar a exclusão de dados acessando a página de exclusão de dados em /data-deletion.",
          ],
        },
        {
          title: "7. Segurança",
          body: [
            "Aplicamos controles de acesso, autenticação, políticas de banco de dados e separação por usuário para proteger dados armazenados.",
            "Nenhum sistema é completamente imune a riscos. Caso identifiquemos incidente relevante, tomaremos medidas de contenção e comunicação conforme aplicável.",
          ],
        },
        {
          title: "8. Contato",
          body: [
            "Para dúvidas sobre privacidade, exclusão ou uso de dados, entre em contato pelo canal informado no painel do xcart ou pelo e-mail de suporte configurado no aplicativo da Meta.",
          ],
        },
      ]}
    />
  );
}
