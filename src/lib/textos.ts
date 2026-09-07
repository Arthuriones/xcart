import pt from "../../messages/pt.json";

/**
 * Os textos da interface, em portugues.
 *
 * O xcart rodava em tres idiomas com next-intl: locale na URL, dicionario por
 * idioma, middleware reescrevendo rota. Como so o portugues ficou, tudo isso
 * virou custo sem beneficio -- inclusive um prefixo de idioma em toda URL.
 *
 * O que sobrou e isto: um dicionario e uma funcao. A assinatura e a mesma de
 * antes (`const t = textos("stores")`, depois `t("chave")`) de proposito, para
 * a troca nao ter que passar por 238 chamadas.
 */
type Dicionario = Record<string, Record<string, unknown>>;

const TEXTOS = pt as unknown as Dicionario;

export interface Tradutor {
  (chave: string, valores?: Record<string, string | number>): string;
  /** Lista ou objeto cru, para blocos repetidos (cards da landing, passos). */
  raw: (chave: string) => unknown;
}

export function textos(namespace: string): Tradutor {
  return criarTradutor(TEXTOS[namespace] || {});
}

/** O tradutor em si, para quem carrega o proprio grupo (ver a landing). */
export function criarTradutor(grupo: Record<string, unknown>): Tradutor {
  const t = ((chave: string, valores?: Record<string, string | number>) => {
    const bruto = grupo[chave];
    // Chave que nao existe volta como ela mesma: melhor ver "save_profile_btn"
    // na tela do que um espaco em branco sem explicacao.
    if (typeof bruto !== "string") return chave;
    if (!valores) return bruto;
    return bruto.replace(/\{(\w+)\}/g, (inteiro, nome: string) =>
      nome in valores ? String(valores[nome]) : inteiro
    );
  }) as Tradutor;

  t.raw = (chave: string) => grupo[chave];
  return t;
}
