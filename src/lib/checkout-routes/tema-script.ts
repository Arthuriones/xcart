import { createHash } from "node:crypto";
import type { EmbedConfig } from "@/lib/checkout-routes/embed-config";

// ============================================================================
// O script do xcart dentro do theme.liquid da vitrine, e o xcart-config.json
// que ele le. Sem rede aqui: so texto, para ficar testado
// (tests/roteamento-tema-vitrine.test.ts). Quem escreve no tema e
// tema-vitrine.ts.
// ============================================================================

export const ASSET_DO_CONFIG = "assets/xcart-config.json";

/**
 * A URL do config sai do proprio Liquid, nao de uma URL fixa.
 *
 * Antes ia a public_url da Shopify, com o tema e a versao dentro
 * (".../t/4/assets/xcart-config.json?v=1788812460"). Dois problemas: cada
 * regravacao do asset exigia regravar o theme.liquid para trocar o ?v= (a CDN
 * guarda a versao velha), e o lojista que trocava de tema continuava lendo o
 * asset do tema ANTIGO -- na NORAH o tema publicado era o t/7 e o script lia
 * o t/4, de dois meses antes. `asset_url` resolve para o tema que esta sendo
 * servido, com a versao do arquivo atual.
 */
export const URL_DO_CONFIG_LIQUID = "{{ 'xcart-config.json' | asset_url }}";

export function scriptDoLoader(appOrigin: string, token: string): string {
  return `<script\n  src="${appOrigin}/routed-checkout-loader.js"\n  data-token="${token}"\n  data-config-url="${URL_DO_CONFIG_LIQUID}"\n  async>\n</script>`;
}

const SCRIPT_DO_XCART = /<script\b[^>]*data-token=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/g;

interface ScriptNoTema {
  tag: string;
  token: string;
  /** O tema le o mapa embutido (data-config ou data-config-url). */
  temConfigInline: boolean;
  /** Ja usa a URL do Liquid: regravar o asset basta. */
  urlDoLiquid: boolean;
}

export function scriptsNoTema(conteudo: string): ScriptNoTema[] {
  const achados: ScriptNoTema[] = [];
  for (const tag of conteudo.match(SCRIPT_DO_XCART) || []) {
    const token = /data-token=["']([^"']*)["']/.exec(tag)?.[1] || "";
    achados.push({
      tag,
      token,
      temConfigInline: /\bdata-config(-url)?=/.test(tag),
      urlDoLiquid: tag.includes("asset_url"),
    });
  }
  return achados;
}

/**
 * Rede de seguranca do referrer, no proprio tema da vitrine.
 *
 * O loader marca o link de saida com rel="noreferrer", e essa e a protecao
 * que vale no dia a dia. Mas ela depende do JS do app chegar ao navegador --
 * se um bloqueador barrar o script, ou se algum botao de carteira navegar por
 * fora do nosso codigo, a politica do documento e a unica coisa que resta.
 *
 * `same-origin` e nao `no-referrer` de proposito: o objetivo e a loja de
 * checkout nao saber de onde veio o comprador, e ela e cross-origin -- o
 * cabecalho ja e cortado. `no-referrer` cortaria tambem a navegacao interna
 * da vitrine, que e o que a analytics da Shopify usa para montar o caminho da
 * sessao. Protege o mesmo e cobra menos.
 *
 * Se o tema ja declara uma politica, respeitamos: o lojista pode ter motivo, e
 * sobrescrever silenciosamente o ajuste dele seria pior que o problema.
 */
export function comMetaReferrer(conteudo: string): string {
  if (/<meta\b[^>]*name=["']referrer["']/i.test(conteudo)) return conteudo;
  // `<head>` cru nao basta: tema costuma abrir com `<head class="...">` ou
  // quebrar a tag em varias linhas. Casar so a forma simples deixaria a meta
  // de fora sem ninguem perceber.
  const abertura = /<head\b[^>]*>/i.exec(conteudo);
  if (!abertura) return conteudo;
  const meta = '<meta name="referrer" content="same-origin">';
  return conteudo.replace(abertura[0], `${abertura[0]}\n  ${meta}`);
}

export type TrocaNoTema =
  /** Instalacao: o script desta rota entrou no lugar dos que havia. */
  | "trocado"
  /** Instalacao: nao havia script, entrou antes do </head>. */
  | "inserido"
  /** O script desta rota ja le o config pelo Liquid: so o asset muda. */
  | "igual"
  /** Automatico: o tema nao tem o script do xcart. Nada a fazer. */
  | "sem_script"
  /** Automatico: o script do tema e de OUTRA rota -- o asset e dela. */
  | "script_de_outra_rota"
  /** Automatico: script colado a mao, sem config embutido -- le a API, que ja esta viva. */
  | "sem_config_url";

/**
 * O theme.liquid depois de apontar o script desta rota para o config novo.
 *
 * `instalar` e o botao "Instalar na vitrine": poe o script desta rota no
 * lugar de qualquer script do xcart (o comportamento de sempre). Sem ele --
 * o reenvio automatico depois do conserto, do liga/desliga e da divisao --
 * so mexe no script DESTA rota e so se ele ja le o config embutido. Nunca
 * instala sozinho e nunca troca o script de outra rota.
 */
export function trocarScriptNoTema(
  conteudo: string,
  opcoes: { token: string; appOrigin: string; instalar: boolean }
): { conteudo: string; troca: TrocaNoTema } {
  const novo = scriptDoLoader(opcoes.appOrigin, opcoes.token);
  const scripts = scriptsNoTema(conteudo);

  if (opcoes.instalar) {
    if (scripts.length === 0) {
      // Sem </head> nao ha onde por: devolve "sem_script" para a instalacao
      // dizer que falhou, em vez de responder "inserido" sem ter inserido.
      if (!conteudo.includes("</head>")) return { conteudo, troca: "sem_script" };
      const inserido = conteudo.replace("</head>", () => `${novo}\n</head>`);
      return { conteudo: comMetaReferrer(inserido), troca: "inserido" };
    }
    return {
      conteudo: comMetaReferrer(conteudo.replace(SCRIPT_DO_XCART, () => novo)),
      troca: "trocado",
    };
  }

  if (scripts.length === 0) return { conteudo, troca: "sem_script" };
  const deste = scripts.find((s) => s.token === opcoes.token);
  if (!deste) return { conteudo, troca: "script_de_outra_rota" };
  if (!deste.temConfigInline) return { conteudo, troca: "sem_config_url" };
  if (deste.urlDoLiquid && !/\bdata-config=/.test(deste.tag)) {
    return { conteudo, troca: "igual" };
  }
  return { conteudo: conteudo.replace(deste.tag, () => novo), troca: "trocado" };
}

/**
 * O que vai para o asset. Rota pausada sai sem destino: o loader nao acha
 * config inline e pergunta a API, que recusa rota pausada. Antes o tema
 * continuava roteando por conta propria a rota que o lojista tinha pausado.
 */
export function configParaOTema(embed: EmbedConfig, rotaLigada: boolean): EmbedConfig {
  if (rotaLigada) return embed;
  return {
    rotation: embed.rotation,
    targets: [],
    domain: "",
    skuMap: {},
    variantMap: {},
    country: "",
    locale: "",
  };
}

/** Impressao digital do config: igual = o tema ja tem este, nao reenvia. */
export function hashDoConfig(config: EmbedConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}
