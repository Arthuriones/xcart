import Image from "next/image";

/**
 * A logo do Panda Track (cabeca do panda + "PandaTrack").
 *
 * Duas versoes, porque nenhum arquivo serve aos dois fundos: a original
 * ("design novo/logo.png") tem o texto creme e some no claro; a clara tem o
 * texto escuro e um contorno no rosto, que e creme e sumia no fundo claro.
 * As duas vao para o HTML e o CSS esconde a errada: sem estado, sem efeito,
 * sem pisca. `dark:` tambem vale dentro de um bloco escuro (o menu lateral
 * tem a classe `dark` no tema claro), entao a versao certa aparece la.
 *
 * Os arquivos tem o mesmo tamanho (510x96, gerados com o sharp; a escura tem
 * a folga do contorno para a proporcao bater) -- trocar o tema nao mexe na
 * largura. width/height sao o tamanho EXIBIDO, para o srcset sair pequeno.
 *
 * Sem preload nem loading eager: com eles as DUAS imagens baixavam,
 * inclusive a que o CSS esconde. `prioridade` vira fetchPriority="high".
 */
const PROPORCAO = 510 / 96;

export function LogoPanda({
  altura = 26,
  prioridade,
  className,
}: {
  /** Altura em px (a cabeca do panda). A largura sai da proporcao (~5,3x). */
  altura?: number;
  /** Liga quando a logo aparece na primeira dobra. */
  prioridade?: boolean;
  className?: string;
}) {
  const comum = {
    alt: "Panda Track",
    fetchPriority: prioridade ? ("high" as const) : undefined,
    width: Math.round(altura * PROPORCAO),
    height: altura,
    style: { height: altura, width: "auto" as const },
  };

  return (
    <span className={className}>
      <Image {...comum} src="/logo-panda-claro.png" className="block dark:hidden" />
      <Image {...comum} src="/logo-panda-escuro.png" className="hidden dark:block" />
    </span>
  );
}
