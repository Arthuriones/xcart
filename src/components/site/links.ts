/**
 * Enderecos do site publico (landing e paginas legais).
 *
 * O app mora em outro host (user.*): entrar e criar conta saem daqui com o
 * endereco completo. As paginas legais e a landing sao do mesmo host, entao
 * os links entre elas sao relativos.
 *
 * As paginas legais e a landing so abrem sem login no host publico (no host
 * do app o proxy manda para o login), e la a landing e a raiz: por isso a logo
 * e as secoes apontam para "/" e "/#secao".
 */
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://user.xcart.app";

export const URL_ENTRAR = `${appUrl}/login`;
/** O login le ?mode=signup e abre direto no cadastro. */
export const URL_CRIAR_CONTA = `${URL_ENTRAR}?mode=signup`;

export interface LinkSecao {
  id: string;
  rotulo: string;
}

/** As secoes da landing que aparecem no menu do topo, na ordem da pagina. */
export const SECOES_LANDING: LinkSecao[] = [
  { id: "recursos", rotulo: "Recursos" },
  { id: "como-comecar", rotulo: "Como começar" },
  { id: "preco", rotulo: "Preço" },
  { id: "perguntas", rotulo: "Perguntas" },
];

export type DocumentoLegal = "privacy" | "terms" | "data-deletion";

export const DOCUMENTOS_LEGAIS: { id: DocumentoLegal; href: string; rotulo: string }[] = [
  { id: "privacy", href: "/privacy", rotulo: "Privacidade" },
  { id: "terms", href: "/terms", rotulo: "Termos de uso" },
  { id: "data-deletion", href: "/data-deletion", rotulo: "Exclusão de dados" },
];
