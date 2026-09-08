import Image from "next/image";

/**
 * A logo do xcart.
 *
 * Nenhum arquivo serve para os dois temas: logo-cropped tem o texto escuro
 * (some no fundo escuro) e a versao de texto branco some no claro. Em vez de
 * escolher em JavaScript -- que precisaria saber o tema antes de pintar e
 * piscaria na primeira renderizacao --, as duas vao para o HTML e o CSS
 * esconde a errada. Sem estado, sem efeito, sem pisca.
 *
 * logo-dark.png e o logo.png original com a borda transparente cortada. Sem
 * esse corte os dois arquivos tinham proporcoes diferentes (5,03 contra 2,60)
 * e a logo aparecia visivelmente menor no tema escuro, com a mesma altura.
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
    priority: prioridade,
    style: { height: altura, width: "auto" as const },
  };

  return (
    <span className={className}>
      <Image
        {...comum}
        src="/logo-cropped.png"
        width={891}
        height={177}
        className="block dark:hidden"
      />
      <Image
        {...comum}
        src="/logo-dark.png"
        width={731}
        height={145}
        className="hidden dark:block"
      />
    </span>
  );
}
