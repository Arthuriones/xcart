// ============================================================================
// O codigo do Custom Pixel, gerado por loja.
//
// POR QUE ISTO EXISTE
//
// O snippet do tema nao entra no checkout da Shopify -- o checkout nao e tema.
// Por isso `begin_checkout` hoje e o CLIQUE no botao e `payment_info` nao
// existe. O Web Pixel entra.
//
// POR QUE NAO E INSTALADO PELA API
//
// Medido: `webPixelCreate` responde "No extension found". A mutation so
// funciona para app que declara uma Web Pixel Extension e faz deploy pelo
// Shopify CLI -- mudanca no app, nao chamada de API. O Custom Pixel colado no
// admin roda no MESMO sandbox e alcanca as mesmas superficies.
//
// O QUE ELE E, E O QUE ELE NAO E
//
// Para o Meta ele NAO manda nada direto: avisa o NOSSO coletor, e o nosso
// servidor e que envia -- igual ao snippet do tema. Para o Google ele carrega a
// tag do Google (gtag.js) e dispara begin_checkout e purchase no navegador,
// com as contas de /api/tracking/google-config.
//
// LIMITE QUE DECIDE O DESENHO
//
// O sandbox NAO le os cookies da loja: `_xc_gclid` e invisivel daqui. O que o
// evento traz e o `clientId` da Shopify, que o snippet do tema tambem conhece
// (ShopifyAnalytics.lib.user().traits().uniqToken). E por ele que o servidor
// recupera o click id.
//
// Em compensacao, o evento de checkout traz e-mail, telefone e endereco --
// sinais que os nossos eventos de funil nunca tiveram. Isso foi verificado no
// codigo de implementacoes publicas de Web Pixel, nao suposto.
//
// A COMPRA DO META NAO SAI DAQUI
//
// A compra do Meta vem do webhook `orders/create`, que e servidor-a-servidor:
// nao depende de o navegador do comprador continuar vivo na pagina de
// obrigado. `checkout_completed` so dispara a compra do GOOGLE, pela tag --
// nunca vai para o coletor.
// ============================================================================

export interface DadosDoPixel {
  /** Origem do coletor, normalmente https://user.xcart.app. */
  origemDoApp: string;
  /**
   * O id da LINHA da loja no xcart.
   *
   * Sem ele o coletor so tem o dominio, e qualquer conta do xcart consegue
   * cadastrar uma linha em `stores` com o dominio de outra loja -- os eventos
   * do checkout, com e-mail e telefone, iriam para a linha do intruso. Com o
   * id, o evento so casa com a linha que gerou o trecho.
   */
  storeId: string;
}

/**
 * O trecho que o lojista cola em Configuracoes -> Eventos de cliente.
 *
 * UMA LINHA, e a logica mora em /xcart-pixel.js: mudar o pixel nao exige
 * recolar. Foi assim que o WeTracked faz.
 *
 * A linha carrega o id da loja (`store=`). A primeira versao era identica para
 * toda loja, e a revisao de seguranca mostrou o preco: identificada so pelo
 * dominio, a loja podia ter os eventos do checkout desviados por qualquer conta
 * que cadastrasse o mesmo dominio. O id e publico -- ja esta no
 * `data-xcart-store` da tag do tema -- e nao precisa ser segredo: o que
 * protege e o coletor exigir id E dominio juntos.
 *
 * Duas coisas fazem isso funcionar:
 *
 *   - `self.ctx = this` guarda o contexto do sandbox num global. Sem ele o
 *     arquivo carregado nao alcanca `analytics`, que e o objeto que assina os
 *     eventos -- ele so existe no `this` do Custom Pixel, nao no escopo global.
 *
 *   - `init.data.shop.myshopifyDomain` vem da propria Shopify, entao a loja se
 *     identifica sozinha e nao ha nada para gerar.
 *
 * O `?shop=` na URL nao e lido pelo servidor: ele existe para o arquivo nao ser
 * servido do cache compartilhado entre lojas diferentes, e para o lojista
 * reconhecer o que colou.
 */
export function gerarCodigoDoPixel(dados: DadosDoPixel): string {
  const base = dados.origemDoApp.replace(/\/+$/, "");
  // So o formato de uuid: o valor vai para dentro de uma string JS que o
  // lojista cola no admin da Shopify.
  const id = /^[0-9a-f-]{36}$/i.test(dados.storeId) ? dados.storeId : "";
  return (
    `document.head.appendChild(document.createElement("script")).src=` +
    `"${base}/xcart-pixel.js?store=${id}&shop="+(self.ctx=this).init.data.shop.myshopifyDomain;`
  );
}

/** Os eventos que este pixel cobre. A tela usa para explicar ao lojista. */
export const EVENTOS_COBERTOS_PELO_PIXEL = ["begin_checkout", "payment_info"];
