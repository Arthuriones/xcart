import { quandoFoi } from "@/lib/leitura/lojas-estado";

// ============================================================================
// Guia de configuracao (/setup): os passos dos dois caminhos e o que conta
// como feito. Puro -- sem React e sem banco -- para o vitest travar e para a
// casca (menu lateral, topo do Lucro) poder usar a mesma regra.
//
// Dois caminhos, porque sao duas operacoes diferentes:
//   - "direto": o anuncio leva o comprador a loja que cobra. E o caso do
//     Arthur. Conectar loja -> rastreamento -> contas de anuncio -> custos ->
//     primeira venda rastreada.
//   - "vitrine": o anuncio leva a vitrine e o carrinho vai, pelo SKU, para uma
//     loja de checkout. Os passos da rota vem antes dos mesmos quatro do fim.
//
// Nada aqui e marcado a mao: cada passo e uma pergunta ao que existe no banco
// (ver guia-configuracao.ts) -- e, no rastreamento, ao tema publicado da loja
// (o script, conferido na Shopify e guardado por alguns minutos). O
// rastreamento so fica feito com destino pronto, script no tema e pixel do
// checkout visto. Leitura que falhou NAO vira "falta": o passo fica
// "nao conferido" e nao entra na conta de feitos -- erro nunca vira zero.
//
// O menu lateral le daqui tambem (sidebar-data.tsx, via lerGuiaDaConta): o
// cartao do guia mostra o mesmo numero da tela, no caminho escolhido.
// ============================================================================

export type CaminhoGuia = "direto" | "vitrine";

/** Preferencias de tela (cookie, sem HttpOnly): quem grava e o navegador. */
export const COOKIE_GUIA_CAMINHO = "xc_guia_caminho";
export const COOKIE_GUIA_DISPENSADO = "xc_guia_dispensado";

export const ROTULO_CAMINHO: Record<CaminhoGuia, string> = {
  direto: "Anúncio direto na loja",
  vitrine: "Com vitrine",
};

/**
 * O caminho que a tela mostra: o da URL (link compartilhado), senao o que o
 * lojista escolheu da ultima vez, senao o que a conta indica -- quem tem rota
 * opera com vitrine.
 */
export function caminhoDoGuia(
  daUrl: string | null | undefined,
  doCookie: string | null | undefined,
  temRota: boolean
): CaminhoGuia {
  if (daUrl === "direto" || daUrl === "vitrine") return daUrl;
  if (doCookie === "direto" || doCookie === "vitrine") return doCookie;
  return temRota ? "vitrine" : "direto";
}

// ---------------------------------------------------------------------------
// A foto do que existe (vem de guia-configuracao.ts). null = leitura falhou.
// ---------------------------------------------------------------------------

export interface LojaGuia {
  id: string;
  nome: string;
  /** Desinstalada, sem permissao, pausada ou token velho (estadoConexao). */
  semAcesso: boolean;
}

export interface DestinoGuia {
  storeId: string;
  plataforma: "meta" | "google" | "tiktok";
  ativo: boolean;
  /** Meta e TikTok com token gravado; Google com rotulo da compra. */
  recebeCompra: boolean;
  /** Meta ou TikTok com codigo de teste: a compra cai na aba de teste, nao conta. */
  modoTeste: boolean;
}

export interface ContaGuia {
  plataforma: "meta" | "google";
  storeId: string | null;
  /** Conta ligada a um checkout externo (069): o gasto entra nele. */
  checkoutId?: string | null;
  ativo: boolean;
  comErro: boolean;
}

export interface RotaGuia {
  id: string;
  ligada: boolean;
  vitrineId: string;
  destinos: { lojaId: string; ativo: boolean; peso: number }[];
}

export interface FotoGuia {
  lojas: LojaGuia[] | null;
  /** Lojas com o interruptor do rastreamento ligado. */
  rastreamentoLigado: string[] | null;
  /**
   * Lojas ligadas cujo pixel do checkout ja mandou evento alguma vez
   * (web_pixel_visto_em). Sem ele o checkout nao e rastreado e a compra do
   * Google nao sai.
   */
  pixelCheckoutVisto: string[] | null;
  /**
   * O script do xcart no tema publicado, por loja ligada (a mesma regra do
   * temSnippet da tela de Rastreamento). true/false = conferido; null ou loja
   * ausente = nao deu para conferir. null inteiro = a leitura falhou.
   */
  scriptNoTema: Record<string, boolean | null> | null;
  destinos: DestinoGuia[] | null;
  contas: ContaGuia[] | null;
  /** Lojas com taxa de pagamento gravada e lojas com custo (por SKU ou padrao). */
  custos: { comTaxa: string[]; comCusto: string[] } | null;
  /**
   * Ultima compra entregue ao Meta ou ao TikTok. O Google vai pela tag do
   * navegador e nao deixa rastro no servidor. `em: null` = nenhuma.
   */
  ultimaVenda: { em: string | null; plataforma: "meta" | "tiktok" | null } | null;
  rotas: RotaGuia[] | null;
  /** Destinos de rota com produtos ligados por SKU (mapa nao vazio). */
  destinosComSku: number | null;
  /** Ultima vez que a vitrine carregou o script (guardado por 30 dias). */
  scriptVisto: { em: string | null } | null;
  /** Ultimo carrinho que o script levou a uma loja de checkout. */
  carrinhoRoteado: { em: string | null } | null;
}

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------

export type IdPasso =
  | "loja"
  | "lojas"
  | "rota"
  | "skus"
  | "divisao"
  | "script"
  | "teste"
  | "rastreamento"
  | "contas"
  | "custos"
  | "venda";

/**
 * - feito: conferido e pronto.
 * - falta: conferido e ainda nao foi feito.
 * - atencao: comecou e ficou pela metade (ligado sem destino, conta sem loja).
 * - aguardando: tudo pronto, so falta acontecer (a primeira venda).
 * - naoConferido: a leitura falhou; nao conta como feito nem como falta.
 */
export type EstadoPasso = "feito" | "falta" | "atencao" | "aguardando" | "naoConferido";

export interface PassoGuia {
  id: IdPasso;
  titulo: string;
  /** O que e e por que importa, em uma ou duas frases. */
  texto: string;
  /** O estado real, em palavras: "Lash Bestie e Softnook conectadas". */
  detalhe: string | null;
  /** Passo a passo curto, quando o "como" nao e obvio (o teste da rota). */
  como?: string[];
  estado: EstadoPasso;
  href: string;
  cta: string;
}

export interface Guia {
  caminho: CaminhoGuia;
  passos: PassoGuia[];
  feitos: number;
  total: number;
  /** Passos cuja leitura falhou. */
  naoConferidos: number;
  /** Primeiro passo ainda aberto (nao feito e conferido). null = nada aberto. */
  proximo: PassoGuia | null;
  /** Todos os passos feitos. Com leitura falhando, nunca e "completo". */
  completo: boolean;
}

export const ROTA_CONECTAR_LOJA = "/stores?conectar=1";
const ROTA_ROTEAMENTO = "/clone/routed-checkout";

/** O detalhe da loja na tela de Rastreamento, nao a lista. */
export function rotaRastreamentoDaLoja(storeId: string): string {
  return `/tracking?loja=${encodeURIComponent(storeId)}`;
}

/**
 * Os proximos passos no aviso de loja conectada (stores/aviso-retorno.tsx),
 * na ordem do guia: o rastreamento primeiro, porque e o foco do produto.
 */
export const PROXIMOS_DEPOIS_DA_LOJA: { href: string; rotulo: string }[] = [
  { href: "/tracking", rotulo: "Ligar rastreamento" },
  { href: "/financeiro/anuncios", rotulo: "Ligar contas de anúncio" },
  { href: "/financeiro/custos", rotulo: "Cadastrar custos" },
];

/** "A", "A e B", "A, B e C", "A, B e mais 3". */
export function listarNomes(nomes: string[], max = 3): string {
  const unicos = [...new Set(nomes.filter(Boolean))];
  if (unicos.length === 0) return "";
  if (unicos.length === 1) return unicos[0];
  if (unicos.length <= max) {
    return `${unicos.slice(0, -1).join(", ")} e ${unicos[unicos.length - 1]}`;
  }
  const resto = unicos.length - (max - 1);
  return `${unicos.slice(0, max - 1).join(", ")} e mais ${resto}`;
}

function contar(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** "hoje, 14:28", "ontem, 09:12", "em 12/09, 14:28" ou null (sem data). */
export function quandoNaFrase(iso: string | null | undefined, agora: Date): string | null {
  const q = quandoFoi(iso, agora);
  if (!q) return null;
  return q.startsWith("hoje") || q.startsWith("ontem") ? q : `em ${q}`;
}

const NOME_PLATAFORMA = { meta: "Meta", google: "Google", tiktok: "TikTok" } as const;

function plataformas(lista: (keyof typeof NOME_PLATAFORMA)[]): string {
  const set = new Set(lista);
  return listarNomes(
    (["meta", "google", "tiktok"] as const).filter((p) => set.has(p)).map((p) => NOME_PLATAFORMA[p])
  );
}

/** Contexto que varios passos usam: lojas ativas e o nome de cada id. */
interface Base {
  ativas: LojaGuia[] | null;
  nomeDe: (id: string) => string;
  agora: Date;
}

function base(foto: FotoGuia, agora: Date): Base {
  const nomes = new Map((foto.lojas ?? []).map((l) => [l.id, l.nome]));
  return {
    ativas: foto.lojas ? foto.lojas.filter((l) => !l.semAcesso) : null,
    nomeDe: (id) => nomes.get(id) ?? "loja removida",
    agora,
  };
}

// --- Passos do caminho direto (e o fim do caminho com vitrine) -------------

function passoLoja(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "loja" as const,
    titulo: "Conecte sua loja Shopify",
    texto:
      "O xcart lê os pedidos da loja a cada 15 minutos e calcula o lucro de cada venda.",
    href: ROTA_CONECTAR_LOJA,
    cta: "Conectar loja",
  };
  if (!foto.lojas || !b.ativas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir suas lojas agora." };
  }
  if (b.ativas.length > 0) {
    const nomes = listarNomes(b.ativas.map((l) => l.nome));
    return {
      ...passo,
      estado: "feito",
      detalhe: b.ativas.length === 1 ? `${nomes} conectada.` : `${nomes} conectadas.`,
      href: "/stores",
      cta: "Ver lojas",
    };
  }
  if (foto.lojas.length > 0) {
    return {
      ...passo,
      estado: "atencao",
      detalhe:
        foto.lojas.length === 1
          ? "Sua loja está sem acesso. Reconecte para os pedidos voltarem a chegar."
          : `Suas ${foto.lojas.length} lojas estão sem acesso. Reconecte uma para os pedidos voltarem a chegar.`,
      href: "/stores",
      cta: "Reconectar loja",
    };
  }
  return { ...passo, estado: "falta", detalhe: null };
}

/**
 * Uma loja ligada e as tres pecas que fazem a compra sair: um destino pronto
 * (Meta/TikTok com token, Google com rotulo, fora do modo teste), o script no
 * tema e o pixel do checkout. Sem o script o clique do anuncio nao vira
 * atribuicao; sem o pixel o checkout nao e rastreado e o Google nao recebe.
 */
interface SituacaoLoja {
  storeId: string;
  prontos: DestinoGuia[];
  emTeste: DestinoGuia[];
  /** null = nao deu para conferir. */
  script: boolean | null;
  pixel: boolean | null;
}

type Peca = "destino" | "teste" | "script" | "pixel";

function situacaoDaLoja(foto: FotoGuia, storeId: string): SituacaoLoja {
  const recebem = (foto.destinos ?? []).filter((d) => d.storeId === storeId && d.ativo && d.recebeCompra);
  return {
    storeId,
    prontos: recebem.filter((d) => !d.modoTeste),
    emTeste: recebem.filter((d) => d.modoTeste),
    script: foto.scriptNoTema ? (foto.scriptNoTema[storeId] ?? null) : null,
    pixel: foto.pixelCheckoutVisto ? foto.pixelCheckoutVisto.includes(storeId) : null,
  };
}

/** O que falta, entre o que foi conferido. O que nao deu para conferir fica de fora. */
function pecasFaltando(s: SituacaoLoja): Peca[] {
  const f: Peca[] = [];
  if (s.prontos.length === 0) f.push(s.emTeste.length > 0 ? "teste" : "destino");
  if (s.script === false) f.push("script");
  if (s.pixel === false) f.push("pixel");
  return f;
}

const lojaPronta = (s: SituacaoLoja) => s.prontos.length > 0 && s.script === true && s.pixel === true;

/** As lojas ligadas (e com acesso), cada uma com o que tem. null = leitura falhou. */
function situacoesLigadas(foto: FotoGuia, b: Base): SituacaoLoja[] | null {
  if (!foto.rastreamentoLigado || !foto.destinos || !b.ativas) return null;
  const ativas = new Set(b.ativas.map((l) => l.id));
  return [...new Set(foto.rastreamentoLigado)].filter((id) => ativas.has(id)).map((id) => situacaoDaLoja(foto, id));
}

function passoRastreamento(foto: FotoGuia, b: Base, caminho: CaminhoGuia): PassoGuia {
  const passo = {
    id: "rastreamento" as const,
    titulo: "Ligue o rastreamento",
    texto:
      caminho === "vitrine"
        ? "Envia cada compra ao Meta e ao TikTok pelo servidor e ao Google pela tag. Precisa do script no tema e do pixel do checkout. Ligue na loja de checkout: é nela que o pedido nasce."
        : "Envia cada compra ao Meta e ao TikTok pelo servidor e ao Google pela tag. Precisa do script no tema e do pixel do checkout.",
    href: "/tracking",
    cta: "Configurar rastreamento",
  };
  const situacoes = situacoesLigadas(foto, b);
  if (!situacoes || !foto.destinos || !b.ativas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir o rastreamento agora." };
  }

  const prontas = situacoes.filter(lojaPronta);
  if (prontas.length > 0) {
    return {
      ...passo,
      estado: "feito",
      detalhe: `Ligado em ${listarNomes(prontas.map((s) => b.nomeDe(s.storeId)))}: ${plataformas(prontas.flatMap((s) => s.prontos.map((d) => d.plataforma)))}.`,
      cta: "Ver rastreamento",
    };
  }

  if (situacoes.length > 0) {
    // A loja mais perto de pronta: a com menos pecas faltando. O link vai
    // direto para ela, nao para a lista.
    const s = situacoes.reduce((a, c) => (pecasFaltando(c).length < pecasFaltando(a).length ? c : a));
    const faltam = pecasFaltando(s);
    const nome = b.nomeDe(s.storeId);
    const href = rotaRastreamentoDaLoja(s.storeId);

    if (faltam.length === 0) {
      // Tudo o que deu para conferir esta certo; o resto nao respondeu.
      const semResposta = [
        s.script === null ? "o script no tema" : null,
        s.pixel === null ? "o pixel do checkout" : null,
      ].filter((x): x is string => x !== null);
      return {
        ...passo,
        estado: "naoConferido",
        detalhe: `Não deu para conferir ${listarNomes(semResposta)} de ${nome} agora.`,
        href,
        cta: "Ver rastreamento",
      };
    }

    const emTeste = plataformas(s.emTeste.map((d) => d.plataforma));
    if (faltam.length === 1 && faltam[0] === "teste") {
      const varias = new Set(s.emTeste.map((d) => d.plataforma)).size > 1;
      return {
        ...passo,
        estado: "atencao",
        detalhe: `O ${emTeste} ${varias ? "estão" : "está"} em modo teste: a compra cai na aba de teste e não conta como conversão.`,
        href,
        cta: "Tirar do modo teste",
      };
    }

    const PECA: Record<Peca, string> = {
      destino: "um pixel do Meta/TikTok ou a conversão do Google",
      teste: `tirar o ${emTeste} do modo teste`,
      script: "o script no tema",
      pixel: "o pixel do checkout",
    };
    const CTA: Record<Peca, string> = {
      destino: "Configurar rastreamento",
      teste: "Tirar do modo teste",
      script: "Instalar o script",
      pixel: "Instalar o pixel",
    };
    return {
      ...passo,
      estado: "atencao",
      detalhe: `${nome}: falta ${listarNomes(faltam.map((p) => PECA[p]))}.`,
      href,
      cta: CTA[faltam[0]],
    };
  }

  const ativas = new Set(b.ativas.map((l) => l.id));
  const cadastrado = foto.destinos.find((d) => d.ativo && ativas.has(d.storeId));
  if (cadastrado) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: `Um pixel já está cadastrado em ${b.nomeDe(cadastrado.storeId)}, mas o rastreamento está desligado.`,
      href: rotaRastreamentoDaLoja(cadastrado.storeId),
      cta: "Ligar o rastreamento",
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe: b.ativas.length === 0 ? "Depois de conectar a loja." : null,
    href: b.ativas.length === 1 ? rotaRastreamentoDaLoja(b.ativas[0].id) : passo.href,
  };
}

/** Uma loja pronta com Meta ou TikTok: so eles deixam a compra em Eventos ao vivo. */
function servidorPronto(foto: FotoGuia, b: Base): boolean {
  return (situacoesLigadas(foto, b) ?? []).some(
    (s) => lojaPronta(s) && s.prontos.some((d) => d.plataforma !== "google")
  );
}

function passoContas(foto: FotoGuia): PassoGuia {
  const passo = {
    id: "contas" as const,
    titulo: "Ligue as contas de anúncio",
    texto:
      "Com o gasto do Meta e do Google ligado a cada loja, o lucro já sai descontado do anúncio.",
    href: "/financeiro/anuncios",
    cta: "Conectar contas",
  };
  if (!foto.contas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir as contas de anúncio agora." };
  }
  const ativas = foto.contas.filter((c) => c.ativo);
  const ligadas = ativas.filter((c) => c.storeId || c.checkoutId);
  const semLoja = ativas.length - ligadas.length;

  if (ligadas.length > 0) {
    const resumo = `${contar(ligadas.length, "conta ligada", "contas ligadas")} (${plataformas(ligadas.map((c) => c.plataforma))})`;
    if (ligadas.every((c) => c.comErro)) {
      return {
        ...passo,
        estado: "atencao",
        detalhe: `${resumo}, mas a leitura do gasto está falhando.`,
        cta: "Ver contas",
      };
    }
    return {
      ...passo,
      estado: "feito",
      detalhe: semLoja > 0 ? `${resumo}. ${contar(semLoja, "conta está", "contas estão")} sem loja.` : `${resumo}.`,
      cta: "Ver contas",
    };
  }
  if (semLoja > 0) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: `${contar(semLoja, "conta conectada", "contas conectadas")} sem loja: o gasto não entra em nenhuma loja.`,
      cta: "Ligar à loja",
    };
  }
  return { ...passo, estado: "falta", detalhe: null };
}

function passoCustos(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "custos" as const,
    titulo: "Cadastre custos e taxas",
    texto:
      "Custo do produto, frete do fornecedor e taxa do gateway. Sem eles o lucro aparece maior do que é.",
    href: "/financeiro/custos",
    cta: "Cadastrar custos",
  };
  if (!foto.custos || !b.ativas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir os custos agora." };
  }
  if (b.ativas.length === 0) {
    return { ...passo, estado: "falta", detalhe: "Depois de conectar a loja." };
  }
  const taxa = new Set(foto.custos.comTaxa);
  const custo = new Set(foto.custos.comCusto);
  const completas = b.ativas.filter((l) => taxa.has(l.id) && custo.has(l.id));
  const total = b.ativas.length;

  if (completas.length > 0) {
    const faltam = b.ativas.filter((l) => !(taxa.has(l.id) && custo.has(l.id)));
    return {
      ...passo,
      estado: "feito",
      detalhe:
        faltam.length === 0
          ? total === 1
            ? "Custo e taxa cadastrados."
            : `Custo e taxa cadastrados nas ${total} lojas.`
          : `Completo em ${completas.length} de ${total} lojas. Falta em ${listarNomes(faltam.map((l) => l.nome))}.`,
      cta: "Ver custos",
    };
  }
  const comTaxa = b.ativas.filter((l) => taxa.has(l.id));
  const comCusto = b.ativas.filter((l) => custo.has(l.id));
  if (comTaxa.length > 0) {
    return { ...passo, estado: "atencao", detalhe: "A taxa está cadastrada; falta o custo dos produtos." };
  }
  if (comCusto.length > 0) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: "O custo dos produtos está cadastrado; falta a taxa de pagamento.",
      cta: "Configurar taxa",
    };
  }
  return { ...passo, estado: "falta", detalhe: null };
}

/**
 * A prova e o que aparece em Eventos ao vivo: so Meta e TikTok, que saem pelo
 * servidor. O Google vai pela tag do navegador e nao aparece la -- por isso
 * nem e citado aqui.
 */
function passoVenda(
  foto: FotoGuia,
  b: Base,
  caminho: CaminhoGuia,
  rastreamento: { feito: boolean; servidor: boolean }
): PassoGuia {
  const passo = {
    id: "venda" as const,
    titulo: "Primeira venda rastreada",
    texto:
      caminho === "vitrine"
        ? "Marca sozinho quando a primeira compra chegar ao Meta ou ao TikTok. Com vitrine, a compra chega sem a origem do anúncio: o pedido nasce na loja de checkout."
        : "Marca sozinho quando a primeira compra chegar ao Meta ou ao TikTok.",
    href: "/tracking/eventos",
    cta: "Ver eventos ao vivo",
  };
  if (!foto.ultimaVenda) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir as compras enviadas agora." };
  }
  if (foto.ultimaVenda.em) {
    const quando = quandoNaFrase(foto.ultimaVenda.em, b.agora);
    const onde = foto.ultimaVenda.plataforma ? ` ao ${NOME_PLATAFORMA[foto.ultimaVenda.plataforma]}` : "";
    return {
      ...passo,
      estado: "feito",
      detalhe: quando ? `Última compra enviada${onde} ${quando}.` : `Compra enviada${onde}.`,
    };
  }
  if (rastreamento.servidor) {
    return {
      ...passo,
      estado: "aguardando",
      detalhe: "Tudo pronto. A próxima venda aparece em Eventos ao vivo em segundos.",
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe: rastreamento.feito
      ? "Depois de ligar o Meta ou o TikTok no rastreamento."
      : "Depois de ligar o rastreamento.",
  };
}

// --- Passos da rota (so no caminho com vitrine) -----------------------------

function passoLojas(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "lojas" as const,
    titulo: "Conecte a vitrine e a loja de checkout",
    texto:
      "São duas lojas Shopify diferentes: a vitrine recebe o anúncio e a loja de checkout cobra.",
    href: ROTA_CONECTAR_LOJA,
    cta: "Conectar loja",
  };
  if (!foto.lojas || !b.ativas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir suas lojas agora." };
  }
  const n = b.ativas.length;
  if (n >= 2) {
    return {
      ...passo,
      estado: "feito",
      detalhe: `${contar(n, "loja conectada", "lojas conectadas")}: ${listarNomes(b.ativas.map((l) => l.nome))}.`,
      href: "/stores",
      cta: "Ver lojas",
    };
  }
  if (n === 1) {
    return { ...passo, estado: "falta", detalhe: `${b.ativas[0].nome} conectada; falta a outra loja.` };
  }
  if (foto.lojas.length > 0) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: "Suas lojas estão sem acesso. Reconecte para continuar.",
      href: "/stores",
      cta: "Reconectar loja",
    };
  }
  return { ...passo, estado: "falta", detalhe: null };
}

/** Rotas com pelo menos uma loja de checkout diferente da vitrine. */
function rotasMontadas(rotas: RotaGuia[]): RotaGuia[] {
  return rotas.filter((r) => r.destinos.some((d) => d.lojaId && d.lojaId !== r.vitrineId));
}

function passoRota(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "rota" as const,
    titulo: "Crie a rota e leve os produtos",
    texto:
      "Escolha a vitrine e as lojas de checkout. O assistente leva os produtos para a loja de checkout com texto e imagens neutros.",
    href: ROTA_ROTEAMENTO,
    cta: "Criar rota",
  };
  if (!foto.rotas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir suas rotas agora." };
  }
  const montadas = rotasMontadas(foto.rotas);
  if (montadas.length > 0) {
    const vitrines = listarNomes(montadas.map((r) => b.nomeDe(r.vitrineId)));
    const checkouts = listarNomes(
      montadas.flatMap((r) => r.destinos.filter((d) => d.lojaId !== r.vitrineId).map((d) => b.nomeDe(d.lojaId)))
    );
    return {
      ...passo,
      estado: "feito",
      detalhe: `Vitrine ${vitrines}, checkout em ${checkouts}.`,
      cta: "Ver rotas",
    };
  }
  return { ...passo, estado: "falta", detalhe: null };
}

function passoSkus(foto: FotoGuia): PassoGuia {
  const passo = {
    id: "skus" as const,
    titulo: "Confira os produtos ligados por SKU",
    texto:
      "Cada produto e variante da vitrine precisa ter par com o mesmo SKU na loja de checkout. É o SKU que leva o carrinho certo.",
    href: ROTA_ROTEAMENTO,
    cta: "Conferir SKUs",
  };
  if (!foto.rotas || foto.destinosComSku === null) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir os produtos ligados agora." };
  }
  if (foto.destinosComSku > 0) {
    return {
      ...passo,
      estado: "feito",
      detalhe: `Produtos ligados em ${contar(foto.destinosComSku, "loja de checkout", "lojas de checkout")}.`,
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe: rotasMontadas(foto.rotas).length === 0 ? "Depois de criar a rota." : null,
  };
}

function passoDivisao(foto: FotoGuia): PassoGuia {
  const passo = {
    id: "divisao" as const,
    titulo: "Divida o tráfego e ligue a rota",
    texto:
      "Escolha quanto dos compradores vai para cada loja de checkout e ligue a rota. Desligada, o carrinho fica no checkout da vitrine.",
    href: ROTA_ROTEAMENTO,
    cta: "Ajustar divisão",
  };
  if (!foto.rotas) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir suas rotas agora." };
  }
  const recebe = (r: RotaGuia) =>
    r.destinos.some((d) => d.ativo && d.peso > 0 && d.lojaId !== r.vitrineId);
  const noAr = foto.rotas.filter((r) => r.ligada && recebe(r));
  if (noAr.length > 0) {
    return {
      ...passo,
      estado: "feito",
      detalhe: noAr.length === 1 ? "A rota está ligada e dividindo o tráfego." : `${noAr.length} rotas ligadas e dividindo o tráfego.`,
      cta: "Ver divisão",
    };
  }
  if (foto.rotas.some((r) => recebe(r))) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: "A divisão está pronta, mas a rota está desligada.",
      cta: "Ligar a rota",
    };
  }
  if (foto.rotas.some((r) => r.ligada)) {
    return {
      ...passo,
      estado: "atencao",
      detalhe: "A rota está ligada, mas nenhuma loja de checkout recebe tráfego.",
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe: rotasMontadas(foto.rotas).length === 0 ? "Depois de criar a rota." : null,
  };
}

function passoScript(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "script" as const,
    titulo: "Instale o script na vitrine",
    texto:
      "É o script que leva o carrinho para a loja de checkout; sem ele a rota não funciona. No Roteamento, abra a rota e use Instalar na vitrine.",
    href: ROTA_ROTEAMENTO,
    cta: "Instalar na vitrine",
  };
  if (!foto.rotas || !foto.scriptVisto) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir o script agora." };
  }
  if (foto.scriptVisto.em) {
    const quando = quandoNaFrase(foto.scriptVisto.em, b.agora);
    return {
      ...passo,
      estado: "feito",
      detalhe: quando
        ? `A vitrine carregou o script pela última vez ${quando}.`
        : "A vitrine carregou o script.",
      cta: "Ver instalação",
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe:
      foto.rotas.length === 0
        ? "Depois de criar a rota."
        : "A vitrine não carregou o script nos últimos 30 dias.",
  };
}

function passoTeste(foto: FotoGuia, b: Base): PassoGuia {
  const passo = {
    id: "teste" as const,
    titulo: "Teste com um carrinho de verdade",
    texto: "Marca sozinho quando um carrinho da vitrine chegar a uma loja de checkout.",
    como: [
      "Abra a vitrine numa janela anônima.",
      "Ponha um produto no carrinho e clique em finalizar a compra.",
      "O pagamento precisa abrir no endereço da loja de checkout. Não precisa pagar.",
    ],
    href: ROTA_ROTEAMENTO,
    cta: "Abrir o Roteamento",
  };
  if (!foto.rotas || !foto.carrinhoRoteado) {
    return { ...passo, estado: "naoConferido", detalhe: "Não deu para conferir os carrinhos roteados agora." };
  }
  if (foto.carrinhoRoteado.em) {
    const quando = quandoNaFrase(foto.carrinhoRoteado.em, b.agora);
    return {
      ...passo,
      estado: "feito",
      detalhe: quando ? `Último carrinho roteado ${quando}.` : "Carrinho roteado.",
    };
  }
  return {
    ...passo,
    estado: "falta",
    detalhe: foto.rotas.length === 0 ? "Depois de criar a rota." : null,
  };
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** Os passos de um caminho, na ordem, com o estado de cada um. */
export function montarGuia(foto: FotoGuia, caminho: CaminhoGuia, agora: Date): Guia {
  const b = base(foto, agora);
  const rastreamento = passoRastreamento(foto, b, caminho);
  const comuns = [
    rastreamento,
    passoContas(foto),
    passoCustos(foto, b),
    passoVenda(foto, b, caminho, {
      feito: rastreamento.estado === "feito",
      servidor: rastreamento.estado === "feito" && servidorPronto(foto, b),
    }),
  ];
  const passos: PassoGuia[] =
    caminho === "vitrine"
      ? [
          passoLojas(foto, b),
          passoRota(foto, b),
          passoSkus(foto),
          passoDivisao(foto),
          passoScript(foto, b),
          passoTeste(foto, b),
          ...comuns,
        ]
      : [passoLoja(foto, b), ...comuns];

  const feitos = passos.filter((p) => p.estado === "feito").length;
  const naoConferidos = passos.filter((p) => p.estado === "naoConferido").length;
  // O primeiro passo ABERTO, nao o primeiro depois do ultimo feito: se alguem
  // desfaz um passo do meio, e ele que falta.
  const proximo = passos.find((p) => p.estado !== "feito" && p.estado !== "naoConferido") ?? null;

  return {
    caminho,
    passos,
    feitos,
    total: passos.length,
    naoConferidos,
    proximo,
    completo: feitos === passos.length,
  };
}

/**
 * Os nomes para o desenho do fluxo ao lado dos passos. Vitrine e checkout
 * saem das ROTAS (o papel nao e campo da loja), so de lojas que existem.
 * null = a leitura daquela parte falhou.
 */
export interface ResumoFluxo {
  lojas: string[] | null;
  vitrines: string[] | null;
  checkouts: string[] | null;
  rotaNoAr: boolean;
}

export function resumoDoFluxo(foto: FotoGuia): ResumoFluxo {
  const nomes = new Map((foto.lojas ?? []).map((l) => [l.id, l.nome]));
  const ativas = foto.lojas ? foto.lojas.filter((l) => !l.semAcesso).map((l) => l.nome) : null;
  if (!foto.rotas || !foto.lojas) {
    return { lojas: ativas, vitrines: null, checkouts: null, rotaNoAr: false };
  }
  const vitrines = new Set<string>();
  const checkouts = new Set<string>();
  let rotaNoAr = false;
  for (const r of foto.rotas) {
    const v = nomes.get(r.vitrineId);
    if (v) vitrines.add(v);
    for (const d of r.destinos) {
      if (d.lojaId === r.vitrineId) continue;
      const c = nomes.get(d.lojaId);
      if (c) checkouts.add(c);
      if (r.ligada && d.ativo && d.peso > 0) rotaNoAr = true;
    }
  }
  return { lojas: ativas, vitrines: [...vitrines], checkouts: [...checkouts], rotaNoAr };
}

/** Porcentagem inteira para a barra; 0 quando nao ha passo. */
export function porcentagem(g: Pick<Guia, "feitos" | "total">): number {
  return g.total > 0 ? Math.round((g.feitos / g.total) * 100) : 0;
}
