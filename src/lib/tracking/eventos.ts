// ============================================================================
// Catalogo de eventos rastreados.
//
// POR QUE UM ROTULO POR EVENTO, E NAO UM SO
//
// No Google Ads cada evento e uma CONVERSION ACTION propria, e cada action tem
// o seu rotulo. O `AW-XXXXXXXXX` e da conta e nao muda; o rotulo muda por
// evento. Entao "adicionar ao carrinho" e "compra" sao dois rotulos diferentes
// da mesma conta -- nao ha como mandar os dois com o mesmo rotulo, o Google
// contaria tudo como a mesma conversao.
//
// Consequencia pratica para o lojista: para cada evento que ele quiser, ele cria
// uma conversion action no Google Ads e cola o rotulo aqui. As secundarias
// devem ficar como "secundaria" (observacao) no painel, senao o Google otimiza
// campanha para carrinho em vez de venda.
//
// DE ONDE CADA UM NASCE
//
// `purchase` vem do webhook orders/create: nasce no servidor, nao depende do
// navegador do comprador. Os outros tres nao tem webhook na Shopify -- carrinho
// e checkout sao acoes de navegador -- entao o snippet do tema avisa o nosso
// coletor, e e o NOSSO servidor que fala com o Google. O ping de conversao
// continua saindo do servidor em todos os casos.
//
// Este arquivo e puro de proposito: a tela, o coletor, a fila e o snippet
// precisam concordar sobre o conjunto de eventos, e uma lista duplicada em
// quatro lugares ia divergir.
// ============================================================================

export type ChaveEvento = "view_item" | "add_to_cart" | "begin_checkout" | "purchase";

export interface DefinicaoEvento {
  chave: ChaveEvento;
  /** Como aparece na tela, e o nome sugerido para a action no Google Ads. */
  nome: string;
  descricao: string;
  /**
   * 'webhook' = a Shopify avisa o servidor sozinha.
   * 'navegador' = o snippet do tema avisa o nosso coletor.
   */
  origem: "webhook" | "navegador";
  /**
   * Nome do evento no Meta.
   *
   * O Meta tem nomes proprios e reconhece SO os dele para evento padrao
   * ("AddToCart", nao "add_to_cart"). Nome fora da lista dele vira evento
   * personalizado: chega, aparece no Events Manager e NAO serve para otimizacao
   * de campanha nem para publico. Falha silenciosa classica.
   *
   * O Google nao precisa de nome nenhum -- la o evento e identificado pelo
   * rotulo da conversion action.
   */
  nomeNoMeta: "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";
  /**
   * Manda valor e moeda junto?
   *
   * So a compra. Os eventos de navegador chegam por endpoint publico, e valor
   * vindo dali seria numero que qualquer um pode inflar na conta de anuncios do
   * lojista. Conversion action de observacao nao precisa de valor.
   */
  temValor: boolean;
}

export const EVENTOS: DefinicaoEvento[] = [
  {
    chave: "view_item",
    nome: "Ver produto",
    descricao: "O visitante abriu uma pagina de produto.",
    origem: "navegador",
    nomeNoMeta: "ViewContent",
    temValor: false,
  },
  {
    chave: "add_to_cart",
    nome: "Adicionar ao carrinho",
    descricao: "O visitante colocou um produto no carrinho.",
    origem: "navegador",
    nomeNoMeta: "AddToCart",
    temValor: false,
  },
  {
    chave: "begin_checkout",
    nome: "Iniciar checkout",
    descricao: "O visitante saiu do carrinho para o checkout.",
    origem: "navegador",
    nomeNoMeta: "InitiateCheckout",
    temValor: false,
  },
  {
    chave: "purchase",
    nome: "Compra",
    descricao: "O pedido entrou. Vem do webhook, nao do navegador.",
    origem: "webhook",
    nomeNoMeta: "Purchase",
    temValor: true,
  },
];

const PORCHAVE = new Map(EVENTOS.map((e) => [e.chave, e]));

export function eventoValido(chave: string): chave is ChaveEvento {
  return PORCHAVE.has(chave as ChaveEvento);
}

export function definicaoDoEvento(chave: ChaveEvento): DefinicaoEvento {
  const d = PORCHAVE.get(chave);
  // Impossivel pelo tipo, mas o coletor recebe string da rede: se um evento for
  // removido do catalogo sem tirar do snippet, melhor estourar aqui do que
  // mandar conversao sem rotulo.
  if (!d) throw new Error(`evento desconhecido: ${chave}`);
  return d;
}

/** Os que o snippet do tema dispara. */
export const EVENTOS_DO_NAVEGADOR = EVENTOS.filter(
  (e) => e.origem === "navegador"
).map((e) => e.chave);

/**
 * Rotulos por evento, como ficam guardados em tracking_configs.google_labels.
 *
 * Evento sem rotulo simplesmente nao e rastreado -- e o jeito de o lojista
 * escolher o que quer sem precisar de uma chave "ligado" para cada um.
 */
export type MapaDeRotulos = Partial<Record<ChaveEvento, string>>;

/**
 * Le o rotulo de um evento.
 *
 * `legado` existe porque a compra morava em `google_conversion_label` antes de o
 * mapa existir. Durante o deploy as duas versoes do codigo rodam ao mesmo tempo,
 * e cair para a coluna antiga evita o unico estrago possivel aqui: parar de
 * mandar a conversao de venda por alguns minutos.
 */
export function rotuloDoEvento(
  mapa: MapaDeRotulos | null | undefined,
  nomeDoEvento: string,
  legado?: string | null
): string | null {
  const evento = chaveDoEvento(nomeDoEvento);
  if (!evento) return null;

  const doMapa = (mapa?.[evento] || "").trim();
  if (doMapa) return doMapa;
  if (evento === "purchase") {
    const antigo = (legado || "").trim();
    if (antigo) return antigo;
  }
  return null;
}

/**
 * Nome gravado na fila -> chave do catalogo.
 *
 * O evento da compra nasce com `event_name: "Purchase"`, que e o nome que o Meta
 * usa, e foi gravado assim nas linhas que ja estao na fila. Normalizar a caixa
 * aqui -- em vez de mudar o que o webhook grava -- mantem essas linhas
 * entregaveis: uma retentativa de linha antiga continua achando o rotulo.
 */
export function chaveDoEvento(nome: string): ChaveEvento | null {
  const limpo = (nome || "").trim().toLowerCase();
  return eventoValido(limpo) ? limpo : null;
}

/** Descarta chave desconhecida e valor vazio antes de gravar. */
export function limparMapaDeRotulos(bruto: unknown): MapaDeRotulos {
  if (!bruto || typeof bruto !== "object") return {};
  const saida: MapaDeRotulos = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!eventoValido(chave)) continue;
    const limpo = typeof valor === "string" ? valor.trim() : "";
    if (limpo) saida[chave] = limpo;
  }
  return saida;
}

/**
 * Chave de deduplicacao de um evento de navegador.
 *
 * Diferente da compra, que usa o numero do pedido: aqui nao existe id estavel,
 * e o mesmo visitante PODE legitimamente adicionar ao carrinho duas vezes. Entao
 * a chave carrega o instante -- ela protege contra reenvio da mesma acao (o
 * snippet repetindo o POST, a nossa retentativa), nao contra a acao repetida.
 */
export function idDoEventoDeNavegador(
  evento: ChaveEvento,
  visitorId: string,
  quandoMs: number
): string {
  return `${evento}_${visitorId}_${quandoMs}`;
}
