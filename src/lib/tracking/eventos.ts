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

export type ChaveEvento =
  | "view_item"
  | "add_to_cart"
  | "begin_checkout"
  | "payment_info"
  | "purchase";

/**
 * As plataformas de destino. Um tipo so: a tela, a fila, o coletor e a rota de
 * cadastro precisam concordar, e a uniao repetida em cada arquivo deixava o
 * TikTok virar "Meta" em silencio onde alguem escreveu `=== "google" ? : `.
 */
export type PlataformaDestino = "google" | "meta" | "tiktok";

/**
 * As que saem PELO SERVIDOR, pela fila (Conversions API do Meta, Events API
 * do TikTok). O Google vai pelo navegador, pela tag do Google.
 */
export const PLATAFORMAS_SERVIDOR = ["meta", "tiktok"] as const;
export type PlataformaServidor = (typeof PLATAFORMAS_SERVIDOR)[number];

export function vaiPeloServidor(p: unknown): p is PlataformaServidor {
  return PLATAFORMAS_SERVIDOR.includes(p as PlataformaServidor);
}

export interface DefinicaoEvento {
  chave: ChaveEvento;
  /** Como aparece na tela, e o nome sugerido para a action no Google Ads. */
  nome: string;
  descricao: string;
  /**
   * 'webhook' = a Shopify avisa o servidor sozinha.
   * 'navegador' = o snippet do tema avisa o nosso coletor.
   */
  /**
   * 'webhook'   = a Shopify avisa o servidor sozinha.
   * 'navegador' = o snippet do tema avisa o nosso coletor.
   * 'pixel'     = o Web Pixel avisa. E o unico que entra no checkout da
   *               Shopify, que nao e tema e por isso o snippet nao alcanca.
   */
  origem: "webhook" | "navegador" | "pixel";
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
  nomeNoMeta:
    | "ViewContent"
    | "AddToCart"
    | "InitiateCheckout"
    | "AddPaymentInfo"
    | "Purchase";
  /**
   * Nome do evento na Events API do TikTok. Mesma regra do Meta: nome fora da
   * lista padrao vira evento custom, que chega e nao otimiza nada (e a caixa
   * conta).
   *
   * A compra e "Purchase", e nao "CompletePayment": o TikTok renomeou em
   * 01/05/2025. O nome velho ainda e aceito e convertido, mas configuracao nova
   * usa o novo. "PlaceAnOrder" sai em 2027 -- nao usar.
   */
  nomeNoTiktok:
    | "ViewContent"
    | "AddToCart"
    | "InitiateCheckout"
    | "AddPaymentInfo"
    | "Purchase";
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
    descricao: "O visitante abriu uma página de produto.",
    origem: "navegador",
    nomeNoMeta: "ViewContent",
    nomeNoTiktok: "ViewContent",
    temValor: false,
  },
  {
    chave: "add_to_cart",
    nome: "Adicionar ao carrinho",
    descricao: "O visitante colocou um produto no carrinho.",
    origem: "navegador",
    nomeNoMeta: "AddToCart",
    nomeNoTiktok: "AddToCart",
    temValor: false,
  },
  {
    chave: "begin_checkout",
    nome: "Iniciar checkout",
    descricao: "O visitante saiu do carrinho para o checkout.",
    origem: "navegador",
    nomeNoMeta: "InitiateCheckout",
    nomeNoTiktok: "InitiateCheckout",
    temValor: false,
  },
  {
    chave: "payment_info",
    nome: "Dados de pagamento",
    descricao:
      "O comprador preencheu o pagamento. Só o Web Pixel vê: o checkout da Shopify não é tema.",
    // So o Web Pixel alcanca o checkout. O snippet do tema nunca dispara este.
    origem: "pixel",
    nomeNoMeta: "AddPaymentInfo",
    nomeNoTiktok: "AddPaymentInfo",
    temValor: false,
  },
  {
    chave: "purchase",
    nome: "Compra",
    descricao: "O pedido entrou. Vem do webhook, não do navegador.",
    origem: "webhook",
    nomeNoMeta: "Purchase",
    nomeNoTiktok: "Purchase",
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
 * Um rotulo como o lojista cola. O Google Ads mostra a conversao como
 * "AW-123456789/AbC-dEf": o rotulo e o que vem depois da barra, e a frente diz
 * a conta. null = nao da para ler (espaco ou barra no meio) -- quem chama
 * mostra o erro, nunca grava pela metade.
 */
export function separarRotulo(valor: string): { rotulo: string; conta: string | null } | null {
  const limpo = (valor || "").trim();
  const m = limpo.match(/^(?:AW-?)?\s*(\d{6,})\s*\/\s*([A-Za-z0-9_-]+)$/i);
  if (m) return { conta: m[1], rotulo: m[2] };
  if (/[\s/]/.test(limpo)) return null;
  return { rotulo: limpo, conta: null };
}

/**
 * Le os rotulos do formulario junto com o ID de conversao.
 *
 * Rotulo colado inteiro ("AW-123/AbC") vira so "AbC"; o AW da frente preenche
 * a conta vazia, e se for de OUTRA conta e erro -- gravar o rotulo na conta
 * errada faria a conversao sumir sem aviso. `conta` volta como AW-<digitos>,
 * ou "" quando nem o campo nem os rotulos dizem qual e.
 */
export function lerRotulos(
  bruto: unknown,
  conta: string
): { labels: MapaDeRotulos; conta: string } | { erro: string; evento: ChaveEvento } {
  let numero = (conta || "").match(/(\d{6,})/)?.[1] ?? null;
  const labels: MapaDeRotulos = {};
  if (bruto && typeof bruto === "object") {
    for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
      if (!eventoValido(chave) || typeof valor !== "string") continue;
      const nome = EVENTOS.find((e) => e.chave === chave)?.nome ?? chave;
      const s = separarRotulo(valor);
      if (!s) {
        return { erro: `Rótulo de ${nome} inválido. Cole só a parte depois da barra.`, evento: chave };
      }
      if (!s.rotulo) continue;
      if (s.conta) {
        if (!numero) numero = s.conta;
        else if (s.conta !== numero) {
          return { erro: `O rótulo de ${nome} é de outra conta (AW-${s.conta}).`, evento: chave };
        }
      }
      labels[chave] = s.rotulo;
    }
  }
  return { labels, conta: numero ? `AW-${numero}` : "" };
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

/**
 * O begin_checkout do clique num botao de checkout EXPRESSO (Shop Pay, Apple
 * Pay, Google Pay...). O Meta e o TikTok recebem (pelo servidor); o Google nao.
 *
 * Existe porque esses botoes pulam a pagina do checkout: o Shop Pay roda em
 * shop.app e a carteira abre a janela do sistema, e o Web Pixel nao roda em
 * nenhum dos dois. Medido na Softnook (04-05/10/2026): de 8 compras, as 5 pagas
 * por carteira expressa nao tiveram InitiateCheckout nenhum.
 *
 * O PIXEL VENCE, o clique e so reserva. O tema nao distingue a carteira do
 * "Comprar agora" quando o shadow DOM e fechado, e o "Comprar agora" leva ao
 * checkout normal, onde o pixel manda o IC dele -- mais rico, com e-mail e
 * endereco quando o checkout ja tem. Por isso o coletor grava o expresso
 * PENDENTE por ATRASO_CHECKOUT_EXPRESSO_MS, e o begin_checkout do pixel do
 * mesmo comprador cancela a linha antes de ela sair. O Meta aceita o
 * event_time de minutos atras.
 *
 * O id e por BALDE de tempo, nao por instante: trava extra, para o indice
 * unico juntar reenvio do mesmo clique. A regra de verdade e a janela
 * deslizante do coletor (JANELA_CHECKOUT_EXPRESSO_MS) -- balde fixo deixava
 * 12:29:50 e 12:30:05 virarem dois. O coletor refaz o id com o proprio
 * relogio; o snippet monta no mesmo formato.
 */
export const BALDE_CHECKOUT_EXPRESSO_MS = 30 * 60 * 1000;

/** Quanto o expresso espera na fila: o tempo de o pixel chegar e cancelar. */
export const ATRASO_CHECKOUT_EXPRESSO_MS = 5 * 60 * 1000;

/**
 * Um begin_checkout do mesmo comprador nesta janela barra o expresso; e o do
 * pixel cancela o expresso pendente criado nela.
 */
export const JANELA_CHECKOUT_EXPRESSO_MS = 30 * 60 * 1000;

/** Como o coletor reconhece a linha do expresso na fila. */
export const PREFIXO_CHECKOUT_EXPRESSO = "begin_checkout_xp_";

export function idDoCheckoutExpresso(visitorId: string, quandoMs: number): string {
  return `${PREFIXO_CHECKOUT_EXPRESSO}${visitorId}_${Math.floor(quandoMs / BALDE_CHECKOUT_EXPRESSO_MS)}`;
}

/**
 * De onde veio o begin_checkout do tema. Lista fechada: o campo vem do
 * navegador, e so o valor conhecido muda o tratamento no coletor.
 */
export const ORIGENS_DO_CHECKOUT = ["expresso"] as const;
export type OrigemDoCheckout = (typeof ORIGENS_DO_CHECKOUT)[number];

export function origemDoCheckout(valor: unknown): OrigemDoCheckout | null {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return ORIGENS_DO_CHECKOUT.find((o) => o === texto) ?? null;
}
