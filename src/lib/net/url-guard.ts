/**
 * A validacao e normalizacao de URL do xcart, num lugar so.
 *
 * ========================= POR QUE PARSER, NAO REGEX =========================
 *
 * O validador antigo (`normalizeShopDomain`) tentava decidir com duas regexes.
 * O pentest do sistema de redirect passou por cima delas -- cada linha abaixo
 * e um caso confirmado, nao hipotese:
 *
 *   "ftp://evil.com/x"          -> aprovado como "evil.com"  (esquema sumia)
 *   "//evil.com"                -> aprovado como "evil.com"
 *   "/\\evil.com"               -> aprovado como "evil.com"
 *   "evil.com#@loja.myshopify"  -> aprovado como "evil.com"
 *   "evil.com."                 -> aprovado como "evil.com"
 *   "169.254.169.254.nip.io"    -> aprovado (resolve para link-local)
 *   "metadata.google.internal"  -> aprovado
 *
 * E pior que aprovar demais: o LOADER, que roda no navegador do comprador,
 * nao chamava validador nenhum -- montava `new URL("https://" + dominio + ...)`
 * na mao. Os dois lados discordavam:
 *
 *   "google.com@evil.com"       servidor: recusa   loader: vai para evil.com
 *   "loja.myshopify.com:8080"   servidor: recusa   loader: aceita a porta
 *   "аррӏе.com" (cirilico)      servidor: recusa   loader: xn--80ak6aa92e.com
 *
 * Quando dois validadores discordam, quem manda e o mais fraco -- e aqui o
 * mais fraco e justamente o que decide para onde o comprador vai.
 *
 * ============================== A REGRA AGORA ===============================
 *
 * Parse com o WHATWG URL (o mesmo parser do navegador), e so depois olhar as
 * PARTES ja separadas. Regex nao enxerga userinfo, porta, barra invertida nem
 * normalizacao unicode; o parser enxerga, porque e ele quem faz isso.
 */

/** Esquemas que podem chegar perto de um redirect. Todo o resto e recusa. */
const ESQUEMAS_OK = new Set(["http:", "https:"]);

export type MotivoRecusa =
  | "vazio"
  | "esquema"
  | "userinfo"
  | "porta"
  | "caminho"
  | "ip_literal"
  | "nao_ascii"
  | "punycode"
  | "ponto_final"
  | "rotulo"
  | "tld"
  | "malformada";

export interface DominioOk {
  ok: true;
  /** Hostname em minusculas, sem porta, sem ponto final. */
  host: string;
  /** Origem pronta para concatenar: "https://host". */
  origem: string;
}
export interface DominioRuim {
  ok: false;
  motivo: MotivoRecusa;
}
export type ResultadoDominio = DominioOk | DominioRuim;

/**
 * Rotulos de host: letras/digitos/hifen, sem comecar nem terminar em hifen.
 *
 * A regex existe, mas so DEPOIS do parser e so sobre um rotulo isolado -- ela
 * nao decide o que e host, nem separa userinfo, nem trata barra invertida.
 * Essa parte e do parser; aqui e so o formato de um pedaco ja delimitado.
 */
const ROTULO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,63}$/;

/** Sufixos de rede interna. Mesma lista de src/lib/net/safe-url.ts. */
const SUFIXOS_INTERNOS = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".home.arpa",
  ".cluster.local",
];

/**
 * Normaliza o dominio de um DESTINO DE CHECKOUT (ou de uma loja conectada).
 *
 * Estrito de proposito: este valor decide para onde o comprador e mandado
 * depois de clicar em finalizar. Recusa qualquer coisa que nao seja
 * exatamente um hostname.
 *
 * O que e recusado, e por que:
 *   esquema != http/https  javascript:, data:, file:, ftp:, blob:
 *   userinfo               "google.com@evil.com" vai para evil.com
 *   porta                  destino de checkout nao usa porta; ":22" e sonda
 *   caminho/query/fragmento "evil.com#@loja.myshopify.com" mascara o host
 *   IP literal             checkout nao mora em IP; e o vetor de SSRF
 *   nao-ASCII / xn--       homografo: "аррӏе.com" nao e "apple.com"
 *   ponto final            "evil.com." e outro host para o navegador
 */
export function normalizarDominioDeDestino(entrada: unknown): ResultadoDominio {
  return analisarDominio(entrada, { permitirCaminho: false });
}

/**
 * Versao tolerante a URL COLADA, para o campo onde o lojista informa o
 * endereco da propria loja.
 *
 * Colar "https://minha-loja.myshopify.com/admin" e o que as pessoas fazem, e
 * recusar isso seria rigor sem ganho: o parser ja separou o host do caminho,
 * entao o que voltamos e o hostname de verdade. "evil.com/loja.myshopify.com"
 * devolve "evil.com" -- o caminho nao consegue mascarar nada porque nao e ele
 * que decide o destino.
 *
 * Todas as outras regras continuam: sem userinfo, sem porta, sem esquema
 * estranho, sem IP, sem punycode, sem sufixo interno.
 *
 * NAO usar para destino de checkout -- la o caminho e sinal de mascara, e a
 * recusa e o comportamento certo.
 */
export function normalizarDominioColado(entrada: unknown): ResultadoDominio {
  return analisarDominio(entrada, { permitirCaminho: true });
}

function analisarDominio(
  entrada: unknown,
  opcoes: { permitirCaminho: boolean }
): ResultadoDominio {
  if (typeof entrada !== "string") return { ok: false, motivo: "vazio" };
  const bruto = entrada.trim();
  if (!bruto) return { ok: false, motivo: "vazio" };

  // Barra invertida e o classico: o navegador trata "\" como "/" na autoridade,
  // entao "/\evil.com" e "https:\\evil.com" viram destino externo. Recusa antes
  // de parsear, para nao depender de como o parser normaliza.
  if (bruto.includes("\\")) return { ok: false, motivo: "caminho" };

  // Espaco, tab, CR e LF nao existem em hostname. Recusar aqui fecha injecao
  // de cabecalho e o truque do "\t" no meio de "java\tscript:".
  if (/[\s\x00-\x1f\x7f]/.test(bruto)) return { ok: false, motivo: "malformada" };

  // "//evil.com" (relativo a protocolo) nao e hostname; e caminho.
  if (bruto.startsWith("//")) return { ok: false, motivo: "esquema" };

  // Esquema declarado. So contar como esquema quando vier seguido de "//":
  // sem isso, "evil.com:22" casa como esquema "evil.com:" e a recusa sai com
  // o motivo errado -- e um motivo errado manda o proximo leitor para o lado
  // errado do problema.
  const comEsquema = /^([a-z][a-z0-9+.-]*):\/\//i.exec(bruto);
  const doisPontosSolto = /^([a-z][a-z0-9+.-]*):(?!\/\/)/i.exec(bruto);

  if (doisPontosSolto) {
    // "evil.com:22" -> host com porta. "javascript:alert(1)" -> esquema.
    const antes = doisPontosSolto[1];
    const depois = bruto.slice(doisPontosSolto[0].length);
    return { ok: false, motivo: antes.includes(".") && /^\d*$/.test(depois) ? "porta" : "esquema" };
  }

  let url: URL;
  try {
    url = new URL(comEsquema ? bruto : `https://${bruto}`);
  } catch {
    return { ok: false, motivo: "malformada" };
  }

  if (!ESQUEMAS_OK.has(url.protocol)) return { ok: false, motivo: "esquema" };
  if (url.username || url.password) return { ok: false, motivo: "userinfo" };
  if (url.port) return { ok: false, motivo: "porta" };

  // Hostname puro: nada de caminho, query ou fragmento. O parser ja separou,
  // entao "evil.com#@loja.myshopify.com" chega aqui com host=evil.com e
  // hash="#@loja.myshopify.com" -- e e por isso que da para recusar.
  if (
    !opcoes.permitirCaminho &&
    ((url.pathname && url.pathname !== "/") || url.search || url.hash)
  ) {
    return { ok: false, motivo: "caminho" };
  }

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, motivo: "vazio" };

  // IPv6 chega entre colchetes; IPv4 e so digitos e pontos.
  if (host.startsWith("[")) return { ok: false, motivo: "ip_literal" };
  if (/^\d+(\.\d+)*$/.test(host)) return { ok: false, motivo: "ip_literal" };

  if (host.endsWith(".")) return { ok: false, motivo: "ponto_final" };

  // O parser ja converteu unicode para punycode. Recusar xn-- e o que impede
  // homografo: "аррӏе.com" chegaria aqui como "xn--80ak6aa92e.com" e passaria
  // em qualquer checagem ASCII.
  //
  // Custo real hoje: zero -- as 57 lojas cadastradas sao todas .myshopify.com.
  // Se algum dia um lojista tiver dominio IDN de verdade, a saida e usar o
  // .myshopify.com dele, e esta regra vira uma allowlist explicita.
  if (/[^\x00-\x7f]/.test(bruto)) return { ok: false, motivo: "nao_ascii" };
  if (host.split(".").some((r) => r.startsWith("xn--"))) {
    return { ok: false, motivo: "punycode" };
  }

  const rotulos = host.split(".");
  if (rotulos.length < 2) return { ok: false, motivo: "tld" };

  // Sufixos que so existem dentro de rede privada. Passavam no formato porque
  // ".internal" e ".local" sao rotulos ASCII validos.
  if (SUFIXOS_INTERNOS.some((sufixo) => host === sufixo.slice(1) || host.endsWith(sufixo))) {
    return { ok: false, motivo: "ip_literal" };
  }

  // nip.io e sslip.io resolvem "<ip>.nip.io" para o proprio <ip>. Sao nomes
  // publicos, com TLD valido, e passam em qualquer checagem de formato -- foi
  // assim que "169.254.169.254.nip.io" e "10.0.0.1.sslip.io" entraram.
  //
  // A marca e um IPv4 completo embutido nos rotulos. Isto e sintatico e nao
  // substitui a checagem de DNS (safe-url.ts) para quem o servidor busca; e a
  // barreira para o destino de checkout, que o servidor nunca resolve porque
  // quem navega ate la e o navegador do comprador.
  for (let i = 0; i + 3 < rotulos.length; i += 1) {
    if (rotulos.slice(i, i + 4).every((r) => /^\d{1,3}$/.test(r))) {
      return { ok: false, motivo: "ip_literal" };
    }
  }
  if (!rotulos.every((r) => ROTULO.test(r))) return { ok: false, motivo: "rotulo" };
  if (!TLD.test(rotulos[rotulos.length - 1])) return { ok: false, motivo: "tld" };

  return { ok: true, host, origem: `https://${host}` };
}

/** Versao curta: o host, ou null. */
export function dominioDeDestino(entrada: unknown): string | null {
  const r = normalizarDominioDeDestino(entrada);
  return r.ok ? r.host : null;
}

/** true so para loja da propria Shopify. */
export function ehMyShopify(host: string): boolean {
  return host.endsWith(".myshopify.com") && host.split(".").length === 3;
}

/**
 * Monta a URL de checkout a partir de um dominio ja aprovado.
 *
 * Existe para nao sobrar nenhum lugar concatenando "https://" + dominio na
 * mao -- que era exatamente o que o loader fazia.
 */
export function urlDeCheckout(
  entrada: unknown,
  caminho: string,
  params?: Record<string, string | undefined>
): URL | null {
  const dominio = normalizarDominioDeDestino(entrada);
  if (!dominio.ok) return null;

  const url = new URL(dominio.origem);
  url.pathname = caminho.startsWith("/") ? caminho : `/${caminho}`;
  for (const [k, v] of Object.entries(params || {})) {
    if (v) url.searchParams.set(k, v);
  }
  return url;
}

// ============================================================================
// Caminho interno (parametro ?next=)
// ============================================================================

/**
 * Aprova um caminho para redirect DENTRO do proprio app.
 *
 * A versao antiga era `startsWith("/") && !startsWith("//")`. Passavam, e cada
 * um destes leva o usuario para fora depois do login:
 *
 *   "/\evil.com"    ->  evil.com
 *   "/\/evil.com"   ->  evil.com
 *   "/\t/evil.com"  ->  evil.com   (tab no meio; o navegador remove)
 *
 * Aqui a decisao nao e por prefixo: resolve contra uma base descartavel e
 * confere se a origem sobreviveu. Se o valor conseguiu sair da origem, ele
 * nao era um caminho interno -- nao importa como escreveu.
 */
export function caminhoInternoSeguro(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const bruto = valor.trim();
  if (!bruto || !bruto.startsWith("/")) return null;

  // Caracteres de controle (tab, CR, LF) sao removidos pelo navegador ANTES de
  // resolver a URL, entao "/\t/evil.com" vira "//evil.com". Recusar aqui evita
  // depender de o parser fazer a mesma limpeza.
  if (/[ -\\]/.test(bruto)) return null;

  const BASE = "https://interno.invalid";
  let url: URL;
  try {
    url = new URL(bruto, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
