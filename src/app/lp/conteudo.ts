import { CREDITOS_INCLUSOS, POLITICA_TESTE } from "./plano";

// ============================================================================
// O texto da landing, separado do layout para o Arthur revisar num lugar so.
// A base e o design "Landing xcart v2" (Claude Design), com os fatos
// corrigidos onde ele estava desatualizado:
//   - o Meta e o TikTok recebem a compra pelo SERVIDOR (Conversions API /
//     Events API); o Google Ads, pela TAG do Google no navegador e no pixel do
//     checkout (src/lib/tracking/google-tag.ts). "Tudo pelo servidor" e falso;
//   - os Eventos ao vivo e o alerta de compra perdida so enxergam o servidor
//     (Meta e TikTok): o Google nao deixa rastro no banco;
//   - o gasto de anuncio vem so do Meta e do Google (nao ha TikTok de gasto).
//
// Regra: so o que o produto faz hoje, sem numero, cliente, depoimento ou
// garantia inventados. Os prazos citados vem do sistema: pedidos a cada
// 15 minutos (cron do financeiro) e 60 dias de historico (limite da Shopify
// para ler pedidos). Preco, teste e creditos saem de plano.ts.
// ============================================================================

/** As plataformas da faixa "Conecta com", logo abaixo do hero. */
export const CONECTA_COM: readonly string[] = [
  "Shopify",
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "Telegram",
  "Claude",
];

export interface Problema {
  origem: string;
  titulo: string;
  texto: string;
}

/** "Por que o xcart existe": o pedaco da conta que cada painel mostra. */
export const PROBLEMAS: Problema[] = [
  {
    origem: "Shopify",
    titulo: "Mostra quanto entrou",
    texto: "Não desconta produto, frete do fornecedor, taxa de pagamento nem anúncio.",
  },
  {
    origem: "Meta e Google",
    titulo: "Mostram o ROAS da plataforma",
    texto: "Sem o custo do produto ao lado, não dá para saber se a campanha se paga.",
  },
  {
    origem: "Navegador",
    titulo: "Perde compras no caminho",
    texto:
      "Quando o pixel depende do navegador do comprador, nem toda compra chega à plataforma que otimiza seus anúncios.",
  },
];

export const PROBLEMA_FECHO =
  "O xcart junta as três pontas numa tela e entrega cada compra: pelo servidor no Meta e no TikTok, pela tag no Google.";

export interface RecursoPrincipal {
  id: "lucro" | "rastreamento" | "alertas";
  /** Nome da tela no app, como aparece no menu. */
  tela: string;
  titulo: string;
  resumo: string;
  pontos: string[];
}

/** Os tres recursos que a landing vende primeiro, na ordem da decisao 2. */
export const RECURSOS_PRINCIPAIS: RecursoPrincipal[] = [
  {
    id: "lucro",
    tela: "Lucro",
    titulo: "Lucro por loja, todo dia",
    resumo:
      "O xcart lê os pedidos da Shopify, cruza com o gasto do Meta e do Google e mostra quanto cada loja lucrou hoje, ontem e no mês.",
    pontos: [
      "Já descontados produto, frete do fornecedor, taxa de pagamento e anúncio.",
      "ROAS real ao lado do ROAS de equilíbrio, para saber se a campanha se paga.",
      "Lucro estimado, não contábil: a tela diz de onde vem cada número.",
      "Pedidos atualizados a cada 15 minutos.",
    ],
  },
  {
    id: "rastreamento",
    tela: "Rastreamento",
    titulo: "Cada compra chega ao Meta, ao TikTok e ao Google",
    resumo:
      "No Meta e no TikTok, a compra sai do nosso servidor assim que a Shopify cria o pedido, sem depender do navegador do comprador. No Google, vai pela tag do Google, no navegador e no pixel do checkout.",
    pontos: [
      "Ver produto, carrinho e checkout também vão para as três plataformas.",
      "A tela Rastreamento mostra, loja por loja, o que está chegando e o que consertar.",
      "Os Eventos ao vivo listam cada envio do servidor, com o motivo quando algo falha.",
    ],
  },
  {
    id: "alertas",
    tela: "Alertas",
    titulo: "O aviso chega antes do prejuízo",
    resumo:
      "Quando algo quebra, o Telegram avisa com a loja e o problema. Na tela Alertas, cada aviso leva direto à tela que resolve.",
    pontos: [
      "Gastou com anúncio e não vendeu hoje.",
      "Compra que não chegou ao Meta ou ao TikTok.",
      "Pedidos ou gasto de anúncio sem atualizar.",
      "App desinstalado com o rastreamento ligado.",
    ],
  },
];

export interface RecursoSecundario {
  id: "custos" | "integracoes" | "importar" | "lojas" | "venda-no-celular" | "roteamento";
  titulo: string;
  texto: string;
}

export const OUTROS_RECURSOS: RecursoSecundario[] = [
  {
    id: "custos",
    titulo: "Custos e taxas",
    texto:
      "Custo de produto e frete por SKU, taxa de cada forma de pagamento e importação por planilha.",
  },
  {
    id: "integracoes",
    titulo: "Contas de anúncio",
    texto: "O gasto do Meta e do Google entra por dia, por conta e por campanha.",
  },
  {
    id: "importar",
    titulo: "Importar com IA",
    texto:
      "Produtos de Shopify, Shoplazza, WooCommerce, AliExpress e outros sites, traduzidos para o idioma da loja.",
  },
  {
    id: "lojas",
    titulo: "Todas as lojas num lugar",
    texto:
      "A saúde da conexão de cada loja Shopify, com as lojas paradas separadas das ativas.",
  },
  {
    id: "venda-no-celular",
    titulo: "Venda no celular",
    texto: "Uma notificação a cada venda, por webhook: Pushcut, ntfy ou Discord.",
  },
  {
    id: "roteamento",
    titulo: "Roteamento",
    texto:
      "Para quem usa vitrine: o carrinho vai para a loja que cobra, com rodízio entre várias.",
  },
];

export interface LinhaComparacao {
  item: string;
  /** O que um painel de lucro comum tambem faz. */
  painel: boolean;
}

/** #comparar: um painel de lucro comum x o xcart (que faz todas). */
export const COMPARACAO: LinhaComparacao[] = [
  { item: "Lucro por loja, com anúncio descontado", painel: true },
  { item: "Compras enviadas ao Meta, ao TikTok e ao Google", painel: false },
  { item: "Cada envio do servidor listado, com o motivo quando falha", painel: false },
  { item: "Alerta no Telegram quando o anúncio gasta sem vender", painel: false },
  { item: "Importação de produtos com IA e tradução", painel: false },
  { item: "Roteamento entre vitrine e lojas de checkout", painel: false },
];

export interface Passo {
  titulo: string;
  texto: string;
}

export const PASSOS: Passo[] = [
  {
    titulo: "Conecte suas lojas Shopify",
    texto:
      "Os pedidos dos últimos 60 dias entram na primeira sincronização. Daí em diante, a cada 15 minutos.",
  },
  {
    titulo: "Ligue o Meta e o Google",
    texto:
      "As contas de anúncio trazem o gasto. O rastreamento entrega as compras ao Meta, ao TikTok e ao Google.",
  },
  {
    titulo: "Informe custos e taxas",
    texto:
      "Custo do produto, frete e taxa de pagamento. Sem custo cadastrado, a tela avisa que o lucro está inflado.",
  },
  {
    titulo: "Acompanhe lucro e alertas",
    texto: "Abra o Lucro para ver o dia e ligue o Telegram para receber os alertas.",
  },
];

/** Os itens do modulo de roteamento (#roteamento). */
export const ROTEAMENTO: readonly string[] = [
  "A vitrine recebe o tráfego do anúncio. No checkout, o carrinho vai para a loja que cobra, casado pelo SKU.",
  "Rodízio entre várias lojas de checkout: se uma conta de pagamento cair, as outras continuam vendendo.",
  "O sorteio só acontece entre lojas que cobrem o carrinho inteiro. Nenhum item fica para trás.",
  "A loja de checkout recebe o catálogo com texto e fotos sem marca, refeitos por IA.",
  "O xcart confere as rotas sozinho e conserta o SKU que ficou sem par.",
];

export interface Pergunta {
  pergunta: string;
  resposta: string;
}

export const PERGUNTAS: Pergunta[] = [
  {
    pergunta: "Preciso usar vitrine?",
    resposta:
      "Não. Você pode anunciar direto na loja que cobra e usar lucro, rastreamento e alertas. O roteamento é um módulo para quem usa vitrine.",
  },
  {
    pergunta: "O lucro mostrado é exato?",
    resposta:
      "É uma estimativa, não um número contábil. Ele desconta custo do produto, frete do fornecedor, taxa de pagamento e gasto em anúncio. Os pedidos entram a cada 15 minutos.",
  },
  {
    pergunta: "Desde quando aparecem os pedidos?",
    resposta:
      "A Shopify libera os pedidos dos últimos 60 dias. O histórico de cada loja começa aí, e o período sem dado aparece marcado, nunca como zero.",
  },
  {
    pergunta: "Como as compras chegam ao Meta, ao TikTok e ao Google?",
    resposta:
      "No Meta e no TikTok, a compra sai do nosso servidor quando a Shopify cria o pedido. No Google, vai pela tag do Google, no pixel do checkout. Ver produto, carrinho e checkout vêm de um código que o xcart instala no tema da loja.",
  },
  {
    pergunta: "O rastreamento funciona com roteamento?",
    resposta:
      "Ver produto, carrinho e checkout, sim. A compra nasce na loja de checkout e chega à plataforma sem a ligação com o anúncio. Para medir o anúncio, anuncie direto na loja que cobra.",
  },
  {
    pergunta: "Tem teste grátis?",
    resposta: POLITICA_TESTE.longa,
  },
  {
    pergunta: "Como eu pago?",
    resposta:
      "Cartão de crédito, que renova sozinho todo mês, ou Pix, que libera 30 dias e não renova. Os créditos extras são pagos por Pix.",
  },
  {
    pergunta: "O que é um crédito de IA?",
    resposta:
      `Cada crédito refaz com IA a foto de um produto, sem a marca. Tradução e texto não gastam crédito. Os créditos comprados à parte somam ao saldo; na renovação do cartão, o saldo volta para ${CREDITOS_INCLUSOS}.`,
  },
  {
    pergunta: "Posso cancelar?",
    resposta:
      "Sim, na tela de assinatura do app. O acesso continua até o fim do período já pago.",
  },
];

/**
 * Prova social: so material real (depoimento com autorizacao, loja que topou
 * aparecer). Vazio, a secao nao aparece. Quem preenche e o Arthur.
 */
export interface Prova {
  texto: string;
  autor: string;
  /** Loja ou operacao do autor, se ele autorizar. */
  detalhe?: string;
}

export const PROVAS: Prova[] = [];
