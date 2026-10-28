import {
  CREDIT_PACKS,
  GARANTIA as GARANTIA_DO_PLANO,
  PLANOS as PLANOS_COBRADOS,
  PRO_INCLUDED_CREDITS,
  formatBRL,
  quantas,
  textoLimiteRastreamento,
  textoLimiteRoteamento,
  type LimitesPlano,
  type Plano,
  type PlanoId,
} from "@/lib/billing/plans";

// ============================================================================
// Os planos como a landing mostra. Preco, limites, creditos e pacotes saem de
// src/lib/billing/plans.ts (o mesmo arquivo que cobra): nada de numero escrito
// a mao aqui, e todo valor passa pelo mesmo formatador (Intl, pt-BR, centavos
// inclusos).
//
// O cartao da landing e curto (redesign de 24/10/2026): quatro
// especificacoes e tres recursos, so o que DIFERE entre os planos -- a parede
// de checks repetidos escondia a diferenca. As duas listas saem dos LIMITES do
// plano, nunca de um texto por plano. A lista completa do que cada plano
// inclui continua em src/components/billing/beneficios.ts (recursosDoPlano),
// para /billing e o paywall.
// ============================================================================

export const CREDITOS_INCLUSOS = PRO_INCLUDED_CREDITS;

/**
 * "R$ 79,90" em duas partes, para o cartao por "R$" pequeno ao lado do valor
 * grande. Se o formato mudar e o corte falhar, o valor inteiro vai no lugar e
 * a moeda some -- nunca um numero diferente do cobrado.
 */
export function precoEmPartes(centavos: number): { moeda: string; valor: string } {
  const texto = formatBRL(centavos);
  const m = texto.match(/^(\D*?)\s*([\d.,]+)$/);
  return m ? { moeda: m[1], valor: m[2] } : { moeda: "", valor: texto };
}

/**
 * "1.997,00" em "1.997" (o numero grande) e ",00" (os centavos menores). Sem
 * centavos no fim, tudo vai no inteiro: nunca um valor diferente do cobrado.
 */
export function valorEmPartes(valor: string): { inteiro: string; centavos: string } {
  const m = valor.match(/^(.+)(,\d{2})$/);
  return m ? { inteiro: m[1], centavos: m[2] } : { inteiro: valor, centavos: "" };
}

export interface EspecificacaoDoPlano {
  rotulo: string;
  valor: string;
  /** false so no rastreamento ausente: o cartao pinta o "Não incluso" apagado. */
  incluso: boolean;
}

/** "Não incluso", "1 operação", "Até 5 operações", "Sem limite". */
function rastreamentoNoCartao(n: number | null): string {
  if (n === null) return "Sem limite";
  if (n === 0) return "Não incluso";
  return n === 1 ? "1 operação" : `Até ${n} operações`;
}

/** "1", "Até 5", "Sem limite". */
function quantidadeNoCartao(n: number | null): string {
  if (n === null) return "Sem limite";
  return n === 1 ? "1" : `Até ${n}`;
}

/**
 * As quatro linhas de especificacao do cartao. Com uma loja de checkout so nao
 * ha o que sortear: o rodizio vira "Checkout fixo".
 */
export function especificacoesDoPlano(l: LimitesPlano): EspecificacaoDoPlano[] {
  return [
    { rotulo: "Rastreamento", valor: rastreamentoNoCartao(l.rastreamento), incluso: l.rastreamento !== 0 },
    { rotulo: "Vitrines", valor: quantidadeNoCartao(l.vitrines), incluso: true },
    { rotulo: "Lojas de checkout", valor: quantidadeNoCartao(l.checkouts), incluso: true },
    {
      rotulo: "Rodízio",
      valor: l.checkouts === 1 ? "Checkout fixo" : "Com teto por dia",
      incluso: true,
    },
  ];
}

const RECURSOS_SEM_RASTREAMENTO = [
  "Roteamento pelo SKU",
  "Conserto automático do mapa de produtos",
  "Diagnóstico da rota",
] as const;

const RECURSOS_COM_RASTREAMENTO = [
  "Compras no Meta, TikTok e Google",
  "Lucro por loja e aba Campanhas",
  "Checkouts externos (Cakto, Hubla e Sphere)",
] as const;

/**
 * Os tres recursos curtos do cartao, so o que o plano traz a mais que o
 * cartao anterior:
 *  - sem rastreamento: o que o roteamento entrega;
 *  - o primeiro com rastreamento (primeiro da lista, ou o anterior sem ele):
 *    o que o rastreamento traz;
 *  - os seguintes: "Tudo do <plano anterior da lista>", o rastreamento deste
 *    e o roteamento deste. O rodizio aparece no plano que o traz (o anterior
 *    tinha uma loja de checkout so); vitrines e checkouts so viram "sem teto"
 *    se forem mesmo sem limite; senao vai o limite real do roteamento.
 * `lista` e a ordem dos cartoes (padrao: os planos a venda).
 */
export function recursosDoCartao(
  plano: Pick<Plano, "id" | "limites">,
  lista: readonly Pick<Plano, "id" | "nome" | "limites">[] = PLANOS_COBRADOS
): string[] {
  const l = plano.limites;
  if (l.rastreamento === 0) return [...RECURSOS_SEM_RASTREAMENTO];
  const i = lista.findIndex((p) => p.id === plano.id);
  const anterior = i > 0 ? lista[i - 1] : undefined;
  if (!anterior || anterior.limites.rastreamento === 0) return [...RECURSOS_COM_RASTREAMENTO];
  const rastreamento =
    l.rastreamento === null
      ? textoLimiteRastreamento(null)
      : `Rastreamento em ${quantas(l.rastreamento, "operação", "operações")}`;
  const roteamento =
    l.vitrines === null && l.checkouts === null
      ? "Vitrines e checkouts sem teto"
      : anterior.limites.checkouts === 1 && l.checkouts !== 1
        ? `Rodízio entre ${l.checkouts === null ? "lojas de checkout sem limite" : quantas(l.checkouts, "loja de checkout", "lojas de checkout")}`
        : textoLimiteRoteamento(l);
  return [`Tudo do ${anterior.nome}`, rastreamento, roteamento];
}

export interface PlanoNaTela {
  id: PlanoId;
  nome: string;
  subtitulo: string;
  /** "197,00" -- o "R$" vai separado, pequeno. */
  valor: string;
  /** "197": o numero grande do cartao. */
  inteiro: string;
  /** ",00": ao lado, menor. */
  centavos: string;
  selo?: string;
  destaque?: boolean;
  especificacoes: readonly EspecificacaoDoPlano[];
  recursos: readonly string[];
}

export const PLANOS: readonly PlanoNaTela[] = PLANOS_COBRADOS.map((p) => {
  const valor = precoEmPartes(p.precoCentavos).valor;
  return {
    id: p.id,
    nome: p.nome,
    subtitulo: p.subtitulo,
    valor,
    ...valorEmPartes(valor),
    ...(p.selo ? { selo: p.selo } : {}),
    ...(p.destaque ? { destaque: true } : {}),
    especificacoes: especificacoesDoPlano(p.limites),
    recursos: recursosDoCartao(p),
  };
});

/** "R$ 197,00": o plano mais barato a venda. */
export const PRECO_A_PARTIR = formatBRL(
  Math.min(...PLANOS_COBRADOS.map((p) => p.precoCentavos))
);

export const GARANTIA = GARANTIA_DO_PLANO;

export interface PacoteNaTela {
  id: string;
  rotulo: string;
  /** "R$ 25,00" */
  preco: string;
}

export const PACOTES: readonly PacoteNaTela[] = CREDIT_PACKS.map((p) => ({
  id: p.id,
  rotulo: p.label,
  preco: formatBRL(p.amountCents),
}));

/** "a", "a ou b", "a, b ou c". */
function listaComOu(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} ou ${itens.at(-1)}`;
}

/** "50 por R$ 25,00, 200 por R$ 75,00 ou 500 por R$ 150,00". */
export const PACOTES_EM_TEXTO = listaComOu(
  CREDIT_PACKS.map((p) => `${p.credits} por ${formatBRL(p.amountCents)}`)
);

/**
 * A politica de teste, num lugar so (hero, cartao do plano e perguntas).
 * O brief diz que hoje nao existe teste gratis e que a landing precisa dizer
 * isso com clareza. A frase final e do Arthur.
 */
export const POLITICA_TESTE = {
  curta: "Sem teste grátis",
  longa:
    "Não há período de teste grátis. A assinatura é mensal e você cancela quando quiser, na tela de assinatura do app.",
} as const;

/**
 * A nota unica abaixo dos cartoes: teste, formas de pagamento e os pacotes de
 * fotos com IA (a caixa "Créditos extras" separada saiu no redesign).
 */
export const NOTA_DO_PRECO = `${POLITICA_TESTE.longa} Cartão de crédito, que renova sozinho todo mês, ou Pix, que libera 30 dias e não renova. Fotos com IA extras por Pix: ${PACOTES_EM_TEXTO}.`;
