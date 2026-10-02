/**
 * Para onde vai quem entra no app sem pedir uma tela especifica: raiz do
 * dominio, pos-login, saida do paywall, logo do menu.
 *
 * E o Lucro: quem abre o app quer saber se a operacao esta dando dinheiro.
 * A visao geral antiga (/overview) so tem dado de roteamento e fica vazia para
 * quem anuncia direto na loja de checkout, sem vitrine -- que e a operacao de
 * hoje. Ela continua no menu como "Visao da rota".
 *
 * Existe como constante porque estava escrito a mao em tres lugares. Quando a
 * tela de visao geral saiu, dois deles continuaram apontando para /dashboard e
 * o app passou a receber o usuario com "This page could not be found".
 */
export const APP_HOME = "/financeiro";
