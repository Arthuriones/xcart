import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Termos de Uso | xcart",
  description:
    "Termos de uso do xcart para importação de produtos, IA, Shopify e checkout roteado.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Termos de Uso"
      description="Estes termos definem as condições de uso do xcart e de seus recursos de importação, automação, IA, Shopify e checkout roteado."
      updatedAt="8 de maio de 2026"
      sections={[
        {
          title: "1. Aceitação dos termos",
          body: [
            "Ao acessar ou usar o xcart, o usuário concorda com estes termos e com a Política de Privacidade.",
            "Se o usuário não concordar com estes termos, deve interromper o uso da plataforma.",
          ],
        },
        {
          title: "2. Uso permitido",
          body: [
            "O usuário deve usar a plataforma apenas com lojas, contas, produtos, imagens, marcas e canais que possui ou está autorizado a administrar.",
            "É responsabilidade do usuário cumprir leis aplicáveis, políticas da Shopify, direitos autorais, marcas registradas, regras de publicidade e obrigações de comércio eletrônico.",
          ],
        },
        {
          title: "3. Recursos de IA",
          body: [
            "A plataforma pode gerar textos, imagens, reviews sintéticos, traduções, descrições, legendas e otimizações com IA.",
            "Conteúdo gerado por IA deve ser revisado pelo usuário antes de publicação. O usuário é responsável por garantir que o conteúdo seja verdadeiro, permitido, identificado quando necessário e adequado ao seu negócio.",
            "Reviews gerados por IA são conteúdo sintético para mockups, demonstrações ou materiais que devem indicar sua origem quando publicados. Não devem ser apresentados como avaliações reais de clientes sem disclosure apropriado.",
          ],
        },
        {
          title: "4. Integrações externas",
          body: [
            "A plataforma se integra a serviços como Shopify, Supabase e provedores de IA. O funcionamento dessas integrações depende de permissões, APIs, limites e disponibilidade desses terceiros.",
            "Podemos alterar ou interromper recursos caso APIs externas mudem, deixem de oferecer suporte ou exijam ajustes técnicos.",
          ],
        },
        {
          title: "5. Publicações e alterações em lojas",
          body: [
            "Ao usar recursos de importação, clone, checkout roteado, setup de loja ou publicação, o usuário autoriza a plataforma a criar, atualizar ou configurar recursos na loja ou canal selecionado.",
            "O usuário deve revisar preços, estoque, descrições, políticas, variantes, mapeamentos e rotas antes de usar em produção.",
          ],
        },
        {
          title: "6. Condutas proibidas",
          body: [
            "É proibido usar a plataforma para fraude, spam, violação de propriedade intelectual, scraping não autorizado, publicação enganosa, violação de políticas de plataformas externas ou qualquer atividade ilegal.",
            "Também é proibido tentar acessar dados de outros usuários, contornar controles de segurança ou explorar falhas do sistema.",
          ],
        },
        {
          title: "7. Limitação de responsabilidade",
          body: [
            "A plataforma é fornecida conforme disponível. Não garantimos resultados comerciais, aprovação por plataformas externas, disponibilidade contínua ou ausência total de erros.",
            "O usuário é responsável por validar conteúdo, produtos, lojas, campanhas e publicações antes de disponibilizá-los a clientes finais.",
          ],
        },
        {
          title: "8. Encerramento e exclusão",
          body: [
            "Podemos suspender ou encerrar acesso em caso de abuso, risco de segurança, violação destes termos ou uso incompatível com políticas de terceiros.",
            "O usuário pode solicitar exclusão de dados seguindo as instruções em /data-deletion.",
          ],
        },
      ]}
    />
  );
}
