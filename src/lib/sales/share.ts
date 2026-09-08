/**
 * Reparte 100% entre valores, sem perder nem sobrar ponto no arredondamento.
 *
 * Arredondar cada fatia sozinha faz a coluna somar 99% ou 101%, e numa tabela
 * com um "Total 100%" no rodape isso salta aos olhos. Aqui cada uma leva o piso
 * e os pontos que sobram vao para os maiores restos (metodo do maior resto).
 *
 * Vive fora de queries.ts porque aquele modulo e "server-only" e fala com o
 * banco -- isto e aritmetica pura, e da para provar com teste.
 */
export function repartirCem(valores: number[]): number[] {
  const soma = valores.reduce((a, b) => a + b, 0);
  if (soma <= 0) return valores.map(() => 0);

  const cru = valores.map((v) => (v / soma) * 100);
  const piso = cru.map(Math.floor);
  let sobra = 100 - piso.reduce((a, b) => a + b, 0);

  const ordem = cru
    .map((v, i) => [v - piso[i], i] as const)
    .sort((a, b) => b[0] - a[0]);

  const fatias = piso.slice();
  for (let i = 0; i < ordem.length && sobra > 0; i += 1, sobra -= 1) {
    fatias[ordem[i][1]] += 1;
  }
  return fatias;
}
