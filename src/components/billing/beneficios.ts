import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";

/**
 * O que o Pro inclui: UMA lista, para a Assinatura, o paywall e o cartao de
 * preco da landing (/lp). Antes eram tres listas diferentes
 * e nenhuma citava lucro ou rastreamento.
 *
 * Ordem da decisao 2 do brief: primeiro o dinheiro (lucro), depois o
 * rastreamento e os alertas; a operacao (importar, neutralizar) e o
 * roteamento vem em seguida. Nada aqui promete teste gratis nem preco: o
 * preco sai de src/lib/billing/plans.ts.
 *
 * TEXTO PARA O ARTHUR REVISAR (ver pendencias do redesign).
 */
export const BENEFICIOS_PRO: readonly string[] = [
  "Lucro estimado por loja, já descontados produto, frete, taxas e anúncio",
  "Rastreamento: as compras chegam ao Meta e ao TikTok pelo servidor, e ao Google pela tag",
  "Alertas no Telegram quando o rastreamento falha, o anúncio gasta sem vender ou a loja para de atualizar",
  "Importação de Shopify, WooCommerce, Shoplazza e AliExpress, com tradução",
  "Neutralização de texto sem limite",
  `${PRO_INCLUDED_CREDITS} créditos de IA por mês (1 crédito = 1 imagem neutralizada)`,
  "Roteamento entre vitrine e lojas de checkout, com rodízio",
  "Conexão com o Claude para operar as lojas conversando",
];
