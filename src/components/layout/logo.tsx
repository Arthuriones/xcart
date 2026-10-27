import Image from "next/image";

/**
 * A logo do xcart.
 *
 * Nenhum arquivo serve para os dois temas: logo-claro tem o texto escuro
 * (some no fundo escuro) e a versao de texto branco some no claro. Em vez de
 * escolher em JavaScript -- que precisaria saber o tema antes de pintar e
 * piscaria na primeira renderizacao --, as duas vao para o HTML e o CSS
 * esconde a errada. Sem estado, sem efeito, sem pisca.
 *
 * logo-dark.png e o logo.png original com a borda transparente cortada. Sem
 * esse corte os dois arquivos tinham proporcoes diferentes (5,03 contra 2,60)
 * e a logo aparecia visivelmente menor no tema escuro, com a mesma altura.
 * logo-claro.png e o logo-cropped.png com o fundo branco transparente: o
 * menu fica sobre o fundo quente (--bg), e o branco opaco virava um retangulo.
 *
 * Os arquivos servidos sao os -256 (256px de largura, gerados com o sharp a
 * partir dos dois acima): a logo nunca passa de ~111px na tela, e o 2x do
 * srcset e 256w. width/height sao o tamanho EXIBIDO, para o srcset sair em
 * 96-128w/256w; com a largura do arquivo (891) ele saia em 1080w/1920w.
 *
 * Sem preload nem loading eager: com eles as DUAS imagens baixavam, inclusive
 * a que o CSS esconde (e a do menu lateral no celular, onde ela nem aparece).
 * Lazy, so a visivel baixa; `prioridade` vira fetchPriority="high", como a
 * doc do next/image manda para imagem por tema.
 */
export function LogoXcart({
  altura = 20,
  prioridade,
  className,
}: {
  /** Altura em px. A largura sai da proporcao (~5,03x). */
  altura?: number;
  /** Liga quando a logo aparece na primeira dobra. */
  prioridade?: boolean;
  className?: string;
}) {
  const comum = {
    alt: "xcart",
    fetchPriority: prioridade ? ("high" as const) : undefined,
    width: Math.round(altura * 5.03),
    height: altura,
    style: { height: altura, width: "auto" as const },
  };

  return (
    <span className={className}>
      <Image {...comum} src="/logo-claro-256.png" className="block dark:hidden" />
      <Image {...comum} src="/logo-dark-256.png" className="hidden dark:block" />
    </span>
  );
}
