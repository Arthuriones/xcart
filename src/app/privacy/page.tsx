import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { RETENCAO } from "@/lib/tracking/retencao";

export const metadata: Metadata = {
  title: "Política de Privacidade | Panda Track",
  description:
    "Política de privacidade do Panda Track: conta, lojas e integrações conectadas, rastreamento de conversões, cobrança e o app de celular.",
};

// Os prazos da fila e do historico saem do arquivo que o expurgo segue: a
// politica nao promete um numero e o banco apaga em outro.
const { funilDias, compraDias, resumoDaCompraDias, naoSaiuDias, historicoMeses } = RETENCAO;

export default function PrivacyPage() {
  return (
    <LegalPage
      atual="privacy"
      title="Política de Privacidade"
      description="Esta política explica quais dados o Panda Track coleta, como usa, com quem compartilha, por quanto tempo guarda e quais controles o usuário tem, no site, no painel e no app de celular."
      updatedAt="29 de outubro de 2026"
      sections={[
        {
          title: "1. Quem somos",
          body: [
            "Panda Track é uma plataforma para lojistas: mede lucro, vendas e campanhas, envia conversões às plataformas de anúncio pelo servidor, conecta lojas Shopify e checkouts externos, importa e otimiza produtos com IA e roteia o checkout entre lojas.",
            "Esta política se aplica ao site, ao painel (user.xcart.app), ao app de celular do Panda Track para iPhone e Android e às integrações oferecidas pela plataforma.",
          ],
        },
        {
          title: "2. Dados que coletamos",
          body: [
            "Conta: e-mail, nome, sobrenome, telefone e CPF ou CNPJ informados no cadastro, o identificador do usuário e registros de sessão. A senha fica com o serviço de autenticação, guardada só como hash, nunca em texto legível.",
            "Cobrança: plano, situação da assinatura, saldo e compras de fotos com IA. O CPF ou CNPJ e o telefone são usados na cobrança, porque o processador de pagamento os exige para emitir o Pix, e no atendimento da conta.",
            "Lojas Shopify conectadas: domínio, nome, credenciais do app informadas pelo usuário, configurações (nicho, idioma, moeda, preço), produtos importados, imagens, rotas de checkout e mapas de SKU.",
            "Pedidos: das lojas conectadas guardamos a parte financeira (valores, moeda, taxas, situação, SKUs e quantidades) e a origem da venda (campanha, conjunto e anúncio), sem nome, e-mail, telefone ou endereço do comprador.",
            "Checkouts externos (como Sphere, Cakto e Hubla): pedidos, valores, comissões e situação. Os dados do comprador que essas plataformas enviam (nome, e-mail, telefone, endereço) são lidos só durante o processamento e não ficam guardados em texto legível; o CPF não é lido.",
            "Contas de anúncio: ao conectar o perfil do Meta ou do Google, guardamos nome, e-mail, foto e identificador do perfil, o token de acesso, as contas de anúncio e os números delas (gasto, campanhas, conjuntos, anúncios e métricas). No TikTok e nos pixels de envio de conversões, guardamos o identificador do pixel e o token que o usuário informa.",
            "Notificações: o identificador do chat e o token do bot do Telegram e os endereços de \"Venda no celular\" que o usuário cadastra, além dos alertas gerados para a conta.",
            "Também guardamos descrições, reviews sintéticos, legendas, histórico de jobs, logs de execução e preferências de idioma e configuração.",
          ],
        },
        {
          title: "3. Rastreamento de conversões",
          body: [
            "Quando o lojista instala o rastreamento do Panda Track na loja, no checkout ou numa página de venda, o Panda Track recebe dados da navegação dos visitantes: páginas, produtos, carrinho e início de checkout, um identificador do visitante (cookie da própria loja), endereço IP, navegador (user agent), identificadores de clique de anúncio (como fbclid, gclid e ttclid), cookies das plataformas de anúncio (_fbp, _fbc, _ttp) e parâmetros UTM.",
            "Esses dados servem para enviar as conversões às contas de anúncio do próprio lojista (Meta, Google Ads e TikTok) e para mostrar no painel a origem de cada venda. Os dados do comprador que acompanham a compra, como e-mail e telefone, só são enviados em hash (SHA-256), nunca em texto legível; IP e navegador vão no formato que as plataformas exigem.",
            `A fila de envio é curta: a maior parte dos eventos de navegação sai em ${funilDias} dias, o que não foi entregue em ${naoSaiuDias}, e as compras e os eventos de checkout ficam ${compraDias} dias (o da compra com o conteúdo reduzido ao mínimo depois de ${resumoDaCompraDias} dias). Os dados de identificação do visitante expiram em 90 dias (30 nas páginas de venda ligadas a checkouts externos).`,
            `Para relatórios, guardamos por ${historicoMeses} meses um histórico sem dado pessoal: tipo de evento, data, campanha, valor da compra e os identificadores do evento e do visitante transformados em hash.`,
            "Nesses casos o Panda Track trata os dados em nome do lojista, que decide instalar o rastreamento e deve informá-lo na política de privacidade da própria loja.",
          ],
        },
        {
          title: "4. App de celular",
          body: [
            "O app do Panda Track para iPhone e Android mostra os números da conta, como lucro, vendas e campanhas, e avisa cada venda por notificação. O login é o mesmo do site: mesma conta, mesmos dados e as mesmas regras desta política.",
            "Para mandar o aviso de venda, guardamos o token de notificação do aparelho, o sistema (iOS ou Android) e a data e o resultado do último envio. Esse token é apagado quando o usuário sai da conta no app ou exclui a conta. Para parar os avisos sem sair, basta desligar as notificações do Panda Track nos ajustes do celular.",
            "O aviso passa pelo serviço de notificações da Expo e pelos serviços da Apple e do Google, que o entregam ao aparelho.",
            "O app não tem rastreamento de terceiros nem anúncios, e os dados dele não são usados para publicidade.",
          ],
        },
        {
          title: "5. Como usamos os dados",
          body: [
            "Usamos os dados para autenticar usuários, conectar serviços autorizados, calcular lucro e resultados de campanhas, enviar conversões, mandar alertas e avisos de venda, cobrar o plano, importar e criar produtos na Shopify, gerar conteúdo com IA, rotear o checkout entre lojas conectadas, dar suporte e prevenir abuso.",
            "Os dados de produtos e lojas podem ser enviados a provedores de IA apenas quando o usuário aciona recursos como otimização, tradução, geração de reviews, neutralização de produtos ou preparação de posts.",
            "Não vendemos dados pessoais e não os usamos para publicidade própria. Não publicamos conteúdo em lojas ou redes sociais sem ação ou configuração do usuário.",
          ],
        },
        {
          title: "6. Compartilhamento com terceiros",
          body: [
            "Compartilhamos dados apenas quando necessário para operar o serviço: Supabase (banco de dados, autenticação e armazenamento) e Vercel (hospedagem do site e do painel); Shopify, para ler pedidos e gerenciar lojas e produtos; Meta, Google e TikTok, para enviar conversões às contas de anúncio do próprio lojista e, no Meta e no Google, ler gasto e campanhas; Sphere, Cakto e Hubla, quando o usuário conecta esses checkouts; Google Gemini, para os recursos de IA quando acionados.",
            "Cobrança: AbacatePay e, em assinaturas mais antigas, Pagou ou Stripe. O número do cartão é digitado na página ou no formulário do processador de pagamento e não chega ao Panda Track.",
            "Avisos: Expo, Apple e Google, para entregar as notificações do app; o Telegram e os endereços de notificação que o próprio usuário cadastra, para alertas e avisos de venda; e assistentes de IA que o próprio usuário conecta à conta (como o Claude, pelo token de acesso criado no Panda Track).",
            "Cada serviço de terceiro processa dados de acordo com seus próprios termos e políticas.",
          ],
        },
        {
          title: "7. Tokens e credenciais",
          body: [
            "Tokens, chaves e credenciais conectadas são usados para executar ações autorizadas pelo usuário. Esses dados são armazenados para manter integrações funcionando até que o usuário remova a conexão ou exclua a conta, e ficam protegidos por regras de acesso do banco: só o servidor do Panda Track e a própria conta do usuário conseguem lê-los, nunca outras contas.",
            "Recomendamos que o usuário conecte apenas contas e lojas que possui ou está autorizado a administrar.",
          ],
        },
        {
          title: "8. Retenção e exclusão",
          body: [
            "Mantemos os dados da conta enquanto ela estiver ativa ou enquanto forem necessários para fornecer o serviço, cumprir obrigações técnicas, prevenir abuso ou manter histórico operacional solicitado pelo usuário. Os prazos do rastreamento estão na seção 3.",
            "Remover uma loja apaga a loja e os dados dela no Panda Track. A conta pode ser excluída pelo próprio usuário, no app (Conta > Excluir conta) ou no site (Configurações, seção Conta).",
            "O que é apagado, o que pode ficar e como revogar o acesso nas integrações estão na página de exclusão de dados, em /data-deletion.",
          ],
        },
        {
          title: "9. Segurança",
          body: [
            "Aplicamos controles de acesso, autenticação, políticas de banco de dados e separação por usuário para proteger dados armazenados.",
            "Nenhum sistema é completamente imune a riscos. Caso identifiquemos incidente relevante, tomaremos medidas de contenção e comunicação conforme aplicável.",
          ],
        },
        {
          title: "10. Contato",
          body: [
            "Para dúvidas sobre privacidade, exclusão ou uso de dados, entre em contato pelo canal informado no painel do Panda Track ou pelo e-mail de suporte configurado no aplicativo da Meta.",
          ],
        },
      ]}
    />
  );
}
