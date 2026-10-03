/**
 * Para onde vai quem entra no app sem pedir uma tela especifica: raiz do
 * dominio, pos-login (login, callback do link de acesso e definir senha),
 * saida do paywall, logo do menu e "Ir para o Lucro" das telas de erro e 404.
 *
 * E o Lucro: quem abre o app quer saber se a operacao esta dando dinheiro.
 * A visao geral antiga (/overview) so tem dado de roteamento e fica vazia para
 * quem anuncia direto na loja de checkout, sem vitrine -- que e a operacao de
 * hoje. Ela vive dentro do modulo Roteamento.
 *
 * Existe como constante porque estava escrito a mao em varios lugares. Quando
 * a tela de visao geral saiu, dois deles continuaram apontando para /dashboard
 * e o app passou a receber o usuario com "This page could not be found".
 */
export const APP_HOME = "/financeiro";
