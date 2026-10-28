import { PRO_INCLUDED_CREDITS, type LimitesPlano } from "@/lib/billing/plans";

/**
 * O que cada plano inclui: UMA regra, para a Assinatura e o paywall. O cartao
 * de preco da landing (/lp) mostra uma versao curta, que sai dos mesmos
 * limites em src/app/lp/plano.ts (especificacoesDoPlano, recursosDoCartao).
 *
 * So o que o xcart tem hoje (decisao do Arthur, 24/10/2026: "So o que
 * existe"), e so o que vale para AQUELE plano -- a lista sai dos limites, nao
 * de um texto por plano. A trava por plano e de quantidade e do rastreamento:
 *  - todo plano tem o roteamento; rodizio e teto de pedidos por dia so
 *    aparecem com mais de uma loja de checkout (com uma so, nao ha o que
 *    sortear nem para onde desviar);
 *  - o rastreamento (e o que vive dele) so no plano com rastreamento.
 * Nada aqui promete teste gratis nem preco: o preco sai de
 * src/lib/billing/plans.ts.
 *
 * TEXTO PARA O ARTHUR REVISAR.
 */

const ROTEAMENTO_BASE = [
  "Roteamento da vitrine para a loja de checkout pelo SKU",
  "País e moeda do checkout escolhidos em cada loja de checkout",
  "Cupom do carrinho da vitrine levado ao checkout",
  "Conserto automático do mapa de produtos entre as lojas",
  "Diagnóstico da rota",
] as const;

const ROTEAMENTO_COM_RODIZIO = [
  "Rodízio entre lojas de checkout: o mesmo checkout para cada comprador ou sorteio a cada checkout",
  "Teto de pedidos por dia em cada loja de checkout",
] as const;

const RASTREAMENTO = [
  "Rastreamento: as compras chegam ao Meta e ao TikTok pelo servidor, e ao Google pela tag",
  "Lucro por loja, já descontados produto, frete, taxas e anúncio",
  "Aba Campanhas: venda e lucro por campanha, conjunto e anúncio do Meta",
  "Checkouts externos (Cakto, Hubla e Sphere) no mesmo painel",
] as const;

const CREDITOS = `${PRO_INCLUDED_CREDITS} fotos com IA por mês (tira a marca das fotos dos produtos)`;

/** A lista do plano, na ordem: roteamento, rastreamento (se tem), fotos com IA. */
export function recursosDoPlano(l: Pick<LimitesPlano, "rastreamento" | "checkouts">): string[] {
  const rodizio = l.checkouts === null || l.checkouts > 1;
  return [
    ROTEAMENTO_BASE[0],
    ...(rodizio ? ROTEAMENTO_COM_RODIZIO : []),
    ...ROTEAMENTO_BASE.slice(1),
    ...(l.rastreamento !== 0 ? RASTREAMENTO : []),
    CREDITOS,
  ];
}
