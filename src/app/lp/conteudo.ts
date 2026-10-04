import { CREDITOS_INCLUSOS, POLITICA_TESTE } from "./plano";

// ============================================================================
// O texto da landing, separado do layout para o Arthur revisar num lugar so.
// Tudo aqui e PROPOSTA (decisao 2 do redesign): a copy final e dele.
//
// Regra: so o que o produto faz hoje, sem numero, cliente, depoimento ou
// garantia inventados. Os prazos citados vem do sistema: pedidos a cada
// 15 minutos (cron do financeiro) e 60 dias de historico (limite da Shopify
// para ler pedidos).
// ============================================================================

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
    tela: "Saúde dos pixels",
    titulo: "Compras que chegam ao Meta e ao Google",
    resumo:
      "A compra sai do nosso servidor assim que a Shopify cria o pedido, sem depender do navegador do comprador.",
    pontos: [
      "Ver produto, carrinho e checkout também vão para as duas plataformas.",
      "A Saúde dos pixels mostra, loja por loja, o que está chegando e o que consertar.",
      "Os Eventos ao vivo listam cada envio, com o motivo quando algo falha.",
    ],
  },
  {
    id: "alertas",
    tela: "Alertas",
    titulo: "Alertas antes do prejuízo",
    resumo:
      "Quando algo quebra, o aviso chega no Telegram com a loja e o problema; na tela Alertas, cada um leva direto à tela que resolve.",
    pontos: [
      "Gastou com anúncio e não vendeu hoje.",
      "Compra que não chegou ao Meta ou ao Google.",
      "Pedidos ou gasto de anúncio sem atualizar.",
      "App desinstalado com o rastreamento ligado.",
    ],
  },
];

export interface RecursoSecundario {
  id: "custos" | "integracoes" | "importar" | "lojas" | "roteamento";
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
    id: "roteamento",
    titulo: "Roteamento",
    texto:
      "Para quem usa vitrine: o carrinho vai para a loja que cobra, com rodízio entre várias.",
  },
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
      "As contas de anúncio trazem o gasto. O rastreamento envia as compras pelo servidor.",
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
    pergunta: "Como as compras chegam ao Meta e ao Google?",
    resposta:
      "A compra sai do nosso servidor quando a Shopify cria o pedido. Ver produto, carrinho e checkout vêm de um código que o xcart instala no tema da loja.",
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
