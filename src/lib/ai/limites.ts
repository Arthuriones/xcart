/**
 * Tetos de custo e de tempo para toda chamada de IA.
 *
 * ============================ POR QUE ISTO EXISTE ============================
 *
 * Nenhuma chamada ao Gemini tinha teto de token nem prazo. Na pratica:
 *
 *   - Sem `maxOutputTokens`, uma resposta que entra em repeticao roda ate o
 *     limite do modelo. Numa importacao de 250 produtos, isso multiplica por
 *     250 -- e o gatilho pode vir do proprio conteudo de origem, que o lojista
 *     nao controla.
 *   - Sem prazo, uma chamada pendurada segura o slot da funcao serverless ate
 *     o maxDuration (300s) e trava a fila de importacao atras dela.
 *
 * Os numeros abaixo sao tetos de seguranca, nao medicao. Foram escolhidos com
 * folga sobre o tamanho esperado da saida: se algum comecar a cortar resposta
 * legitima, o sintoma aparece como campo truncado -- e ai vale medir e subir,
 * em vez de tirar o teto.
 */

/** Saida de texto de produto: titulo, descricao, tags, SEO. */
export const MAX_TOKENS_TEXTO = 2048;

/**
 * Saida longa: politicas, paginas institucionais e setup de loja, que o
 * gemini/client.ts gera. Teto mais alto que o de produto porque esses textos
 * sao naturalmente longos -- ainda assim e teto, nao cheque em branco.
 */
export const MAX_TOKENS_TEXTO_LONGO = 8192;

/** Prazo de uma geracao de texto. */
export const TIMEOUT_TEXTO_MS = 45_000;

/** Geracao de imagem demora mais que texto. */
export const TIMEOUT_IMAGEM_MS = 90_000;

/**
 * Schema da saida de texto, para `responseSchema` do Gemini.
 *
 * Com isto o modelo devolve JSON que CASA com a forma -- em vez de prosa que
 * um parser com fallback de regex tenta interpretar. Formato de saida sob
 * influencia do conteudo de entrada e uma porta que nao precisa ficar aberta.
 *
 * O formato e o do `@google/genai` (Type do SDK em string), nao JSON Schema
 * completo: `additionalProperties` e `$ref` nao sao suportados.
 */
export const ESQUEMA_TEXTO = {
  type: "object",
  properties: {
    title: { type: "string" },
    descriptionHtml: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    seo: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["title", "description"],
    },
  },
  required: ["title", "descriptionHtml", "tags", "seo"],
} as const;

export class TempoLimiteIa extends Error {
  constructor(operacao: string, ms: number) {
    super(`A IA nao respondeu em ${Math.round(ms / 1000)}s (${operacao}).`);
    this.name = "TempoLimiteIa";
  }
}

/**
 * Prazo para uma promessa de IA.
 *
 * O SDK do Gemini nao aceita AbortSignal em todos os caminhos, entao a corrida
 * aqui e o que garante o prazo. A chamada continua rodando no fundo -- o que
 * importa e nao segurar a funcao serverless esperando por ela.
 */
export async function comTempoLimite<T>(
  promessa: Promise<T>,
  ms: number,
  operacao: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeita) => {
        timer = setTimeout(() => rejeita(new TempoLimiteIa(operacao, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
