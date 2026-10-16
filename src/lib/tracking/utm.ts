// ============================================================================
// UTM e click id -> de qual anuncio veio o pedido.
//
// Puro (sem "server-only", sem I/O): o webhook, o sync de pedidos, o coletor e
// a tela Pedidos usam, e o vitest trava em tests/tracking-utm.test.ts.
//
// DOIS FORMATOS DE ANUNCIO DO META CONVIVEM, e o utm_medium decide qual e:
//
//   - o AUTOMATICO do proprio Meta (campo "Parametros de URL" vazio), medido
//     em todas as URLs do funil das lojas do Arthur em 10/2026:
//       utm_source=fb|ig  utm_medium=paid  utm_id e utm_campaign = campanha
//       utm_term = CONJUNTO  utm_content = anuncio
//   - o da Utmify (e o nosso modelo, PARAMETROS_URL): utm_medium = conjunto,
//     utm_content = anuncio, utm_term = posicionamento. O valor pode vir
//     "nome|id" (o id e o que vem depois da ULTIMA barra) ou so com o id.
//
// utm_medium com id (ou "nome|id") = formato Utmify. Sem id, no Meta, o
// conjunto vem do utm_term. Google e TikTok seguem o modelo (meio = grupo).
//
// O PEDIDO GUARDA OS IDS: renomear o anuncio nao divide o relatorio. Os
// nomes vem depois, do sync de gasto; valor so com nome fica como veio.
//
// NUNCA DADO PESSOAL. Valor com "@" e descartado (UTM de campanha de e-mail
// ja levou o e-mail do cliente). Dos atributos do pedido so se le uma lista
// FECHADA de chaves: a nota do pedido do Releasit traz nome, telefone,
// endereco e IP do comprador.
// ============================================================================

/** Ate onde vai cada valor guardado. */
export const MAX_VALOR_UTM = 200;

/**
 * A janela do clique ate o pedido: 7 dias, a mesma da atribuicao por clique
 * do Meta. O cookie e a identidade duram mais (90 dias), e sem a janela a
 * compra organica na volta herdaria o anuncio de meses atras.
 */
export const JANELA_ORIGEM_MS = 7 * 864e5;

/** As UTMs, sem o prefixo "utm_". `gad` e o gad_campaignid do Google. */
export interface Utm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  /** utm_id: o Meta poe o id da campanha aqui. */
  id?: string | null;
  /** gad_campaignid: o Google acrescenta sozinho, com o id da campanha. */
  gad?: string | null;
  /**
   * A plataforma do click id que chegou NESTE clique (gclid, fbclid, ttclid),
   * guardada pelo snippet e pela ponte com a hora dele. E o que deixa o clique
   * sem UTM (Google so com auto-tagging, TikTok sem o modelo) valer na janela
   * e substituir a UTM de um clique anterior. O click id solto, sem hora, nao
   * define plataforma (origem-pedido.ts).
   */
  clique?: PlataformaAnuncio | null;
}

export const CHAVES_UTM = ["source", "medium", "campaign", "content", "term", "id"] as const;
export type ChaveUtm = (typeof CHAVES_UTM)[number];

export interface Cliques {
  fbclid?: string | null;
  /** O cookie _fbc: fb.1.<instante do clique em ms>.<fbclid>. */
  fbc?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ttclid?: string | null;
}

export type PlataformaAnuncio = "meta" | "google" | "tiktok";
export type PlataformaOrigem = PlataformaAnuncio | "outra";

export interface NiveisAnuncio {
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
  /** utm_term quando nao e o conjunto: posicionamento (Meta, TikTok) ou palavra-chave (Google). */
  posicionamento: string | null;
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

/** {{campaign.id}}, {campaignid}, __CAMPAIGN_ID__: o modelo colado sem a plataforma trocar. */
const MACRO = /^(\{\{[^}]*\}\}|\{[a-z_]+\}|__[A-Z0-9_]+__)$/i;
const SO_ID = /^\d{5,25}$/;

/** Cortado, sem controle, sem macro e sem "@". Vazio e null. */
export function limparValor(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const texto = String(v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_VALOR_UTM).trim();
  if (!texto || texto.includes("@") || MACRO.test(texto)) return null;
  return texto;
}

/** O id: o que vem depois da ultima barra ("nome|id") ou o proprio valor, se for so digitos. */
export function idDe(v: unknown): string | null {
  const t = limparValor(v);
  if (!t) return null;
  const i = t.lastIndexOf("|");
  const fim = (i >= 0 ? t.slice(i + 1) : t).trim();
  return SO_ID.test(fim) ? fim : null;
}

/** O nome: antes da ultima barra ("nome|id"), ou o valor so com nome. Id puro nao tem nome. */
export function nomeDe(v: unknown): string | null {
  const t = limparValor(v);
  if (!t) return null;
  const i = t.lastIndexOf("|");
  if (i >= 0 && SO_ID.test(t.slice(i + 1).trim())) return t.slice(0, i).trim() || null;
  return SO_ID.test(t) ? null : t;
}

/** Tem campanha ou, pelo menos, o clique datado (`clique`). */
export function temUtm(u: Utm | null | undefined): boolean {
  return Boolean(u && (CHAVES_UTM.some((k) => u[k]) || u.gad || u.clique));
}

const PLATAFORMAS_ANUNCIO = new Set<string>(["meta", "google", "tiktok"]);

/** "meta" | "google" | "tiktok", ou null para qualquer outra coisa. */
export function plataformaValida(v: unknown): PlataformaAnuncio | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return PLATAFORMAS_ANUNCIO.has(t) ? (t as PlataformaAnuncio) : null;
}

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/**
 * O fbclid atual termina em `_aem_` + 22 caracteres; cortado, o sufixo nao
 * fecha. Ver cliquesDaLanding em purchase.ts.
 */
const FBCLID_COMPLETO = /_aem_[A-Za-z0-9_-]{22}$/;

/** O landing_site do pedido: a Shopify corta em 255 caracteres. */
export const CORTE_LANDING = 255;
/** A URL da pagina que o snippet e a ponte mandam ao coletor: cortada em 500. */
export const CORTE_PAGINA = 500;

/**
 * Os parametros de uma URL, so os INTEIROS.
 *
 * `cortadaEm`: o tamanho em que a URL foi cortada (CORTE_LANDING,
 * CORTE_PAGINA). Perto do limite o ultimo parametro pode estar pela metade --
 * um id cortado e pior que nenhum, e `utm_source=i` (o "ig" cortado) apareceu
 * de verdade -- entao ele sai, exceto o fbclid que prova estar inteiro.
 * URL torta nao lanca.
 */
export function parametrosDaUrl(url: string | null | undefined, cortadaEm?: number): URLSearchParams {
  const bruto = (url || "").trim();
  if (!bruto || !bruto.includes("?")) return new URLSearchParams();
  let p: URLSearchParams;
  try {
    p = new URL(bruto, "https://x.invalid").searchParams;
  } catch {
    return new URLSearchParams();
  }
  if (cortadaEm && bruto.length >= cortadaEm - 5) {
    const chaves = [...p.keys()];
    const ultima = chaves[chaves.length - 1];
    const fbclidInteiro = ultima === "fbclid" && FBCLID_COMPLETO.test(p.get("fbclid") || "");
    if (ultima && !fbclidInteiro) p.delete(ultima);
  }
  return p;
}

/** utm_* (a primeira ocorrencia: o modelo colado vem antes do automatico do Meta) e o gad_campaignid. */
export function utmDeParametros(p: URLSearchParams): Utm {
  const u: Utm = {};
  for (const k of CHAVES_UTM) {
    const v = limparValor(p.get(`utm_${k}`));
    if (v) u[k] = v;
  }
  const gad = (p.get("gad_campaignid") || "").trim();
  if (SO_ID.test(gad)) u.gad = gad;
  return u;
}

function cortar(v: string | null | undefined, max = 300): string | null {
  const t = (v || "").trim();
  return t ? t.slice(0, max) : null;
}

export function cliquesDeParametros(p: URLSearchParams): Cliques {
  return {
    fbclid: cortar(p.get("fbclid")),
    gclid: cortar(p.get("gclid")),
    gbraid: cortar(p.get("gbraid")),
    wbraid: cortar(p.get("wbraid")),
    ttclid: cortar(p.get("ttclid")),
  };
}

/**
 * O caminho da pagina de entrada, sem query nem fragmento (podem ter dado do
 * comprador). Checkout, status do pedido, carrinho direto e conta viram so a
 * secao: o resto do caminho e token.
 */
export function caminhoDeEntrada(url: string | null | undefined): string | null {
  const bruto = (url || "").trim();
  if (!bruto) return null;
  let caminho: string;
  try {
    caminho = new URL(bruto, "https://x.invalid").pathname;
  } catch {
    return null;
  }
  if (!caminho || caminho.includes("@")) return null;
  if (/\/checkouts?(\/|$)/i.test(caminho)) return "/checkouts";
  if (/\/orders(\/|$)/i.test(caminho)) return "/orders";
  if (/\/account(\/|$)/i.test(caminho)) return "/account";
  if (/(^|\/)cart\/[^/]/i.test(caminho)) return "/cart";
  return caminho.slice(0, MAX_VALOR_UTM);
}

// ---------------------------------------------------------------------------
// Plataforma e niveis
// ---------------------------------------------------------------------------

export const FONTES_META = new Set([
  "facebook", "fb", "ig", "instagram", "meta", "facebook_ads", "fbads", "an", "msg", "messenger",
]);
export const FONTES_GOOGLE = new Set(["google", "adwords", "googleads", "google_ads", "youtube"]);
export const FONTES_TIKTOK = new Set(["tiktok", "tt", "tiktok_ads", "tiktokads"]);

export function plataformaDaFonte(fonte: string | null | undefined): PlataformaAnuncio | null {
  const f = (fonte || "").trim().toLowerCase();
  if (!f) return null;
  if (FONTES_META.has(f)) return "meta";
  if (FONTES_GOOGLE.has(f)) return "google";
  if (FONTES_TIKTOK.has(f)) return "tiktok";
  return null;
}

/** O Google vence: gclid e fbclid juntos so acontecem com o gclid sendo o clique desta visita. */
export function plataformaDoClique(c: Cliques | null | undefined): PlataformaAnuncio | null {
  if (!c) return null;
  if (c.gclid || c.gbraid || c.wbraid) return "google";
  if (c.fbclid || c.fbc) return "meta";
  if (c.ttclid) return "tiktok";
  return null;
}

/**
 * De qual plataforma e o toque: o click id DELE (mesma regra da tela antes
 * daqui), a fonte conhecida, o gad_campaignid, e por fim "outra" se houver
 * fonte. Nada disso: null.
 */
export function plataformaDe(utm: Utm, cliques?: Cliques | null): PlataformaOrigem | null {
  return (
    plataformaDoClique(cliques) ??
    plataformaValida(utm.clique) ??
    plataformaDaFonte(utm.source) ??
    (utm.gad ? "google" : null) ??
    (utm.source ? "outra" : null)
  );
}

/** Campanha, conjunto, anuncio e posicionamento, pelos dois formatos (ver cabecalho). */
export function niveisDoAnuncio(utm: Utm, plataforma: PlataformaOrigem | null): NiveisAnuncio {
  const campanha = idDe(utm.campaign) ?? idDe(utm.id) ?? (utm.gad && SO_ID.test(utm.gad) ? utm.gad : null);
  let conjunto = idDe(utm.medium);
  let termoEConjunto = false;
  if (!conjunto && plataforma === "meta") {
    conjunto = idDe(utm.term);
    termoEConjunto = Boolean(conjunto);
  }
  return {
    campanha,
    conjunto,
    anuncio: idDe(utm.content),
    posicionamento: termoEConjunto ? null : limparValor(utm.term),
  };
}

/**
 * Os nomes que a propria UTM traz (formato "nome|id" da Utmify, ou so o nome).
 * O utm_medium so com nome e o MEIO ("paid", "cpc"), nao o conjunto: so o
 * formato "nome|id" diz o nome dele.
 */
export function nomesDaUtm(utm: Utm): { campanha: string | null; conjunto: string | null; anuncio: string | null } {
  return {
    campanha: nomeDe(utm.campaign),
    conjunto: (utm.medium || "").includes("|") ? nomeDe(utm.medium) : null,
    anuncio: nomeDe(utm.content),
  };
}

// ---------------------------------------------------------------------------
// Atributos do pedido (note_attributes do webhook, customAttributes do sync)
// ---------------------------------------------------------------------------

/** Os nossos (_xc_utm_*) e os de app de COD/checkout ("utm_source", "UTM Source"). */
const CHAVE_UTM_ATRIBUTO = /^_?(xc_)?utm[ _-]?(source|medium|campaign|content|term|id)$/i;
const CHAVE_UTM_EM = /^_xc_utm_em$/i;
/** Do mesmo conjunto do snippet: o gad_campaignid e a plataforma do click id do clique. */
const CHAVE_UTM_GAD = /^_xc_utm_gad$/i;
const CHAVE_UTM_CLIQUE = /^_xc_utm_clique$/i;
/** Os click ids que o snippet e a ponte poem no carrinho. */
const CHAVE_CLIQUE_ATRIBUTO: Record<string, keyof Cliques> = {
  fbclid: "fbclid",
  _fbc: "fbc",
  fbc: "fbc",
  gclid: "gclid",
  gbraid: "gbraid",
  wbraid: "wbraid",
  ttclid: "ttclid",
};

export interface AtributoDoPedido {
  /** note_attributes do webhook. */
  name?: string | null;
  /** customAttributes do GraphQL. */
  key?: string | null;
  value?: string | null;
}

/** Instante em ms (o que o snippet grava) ou ISO. Fora de 2020..2100: null. */
export function instanteDe(v: unknown): string | null {
  const texto = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!texto) return null;
  const ms = /^\d{10,15}$/.test(texto) ? Number(texto) : Date.parse(texto);
  if (!Number.isFinite(ms) || ms < 1577836800000 || ms > 4102444800000) return null;
  return new Date(ms).toISOString();
}

/**
 * As UTMs dos atributos, so pela lista fechada de chaves.
 *
 * - `nosso`: _xc_utm_* que o snippet do tema e a ponte gravam, com a hora do
 *   clique em _xc_utm_em. Sem a hora nao serve: nao da para saber se e de 7
 *   ou de 70 dias atras.
 * - `externo`: utm_* de app (o "UTM Tracking" do Releasit), que sao da sessao
 *   do proprio pedido.
 */
export function utmDosAtributos(lista: readonly AtributoDoPedido[] | null | undefined): {
  nosso: { utm: Utm; em: string } | null;
  externo: Utm | null;
} {
  const nosso: Utm = {};
  const externo: Utm = {};
  let em: string | null = null;
  for (const a of Array.isArray(lista) ? lista : []) {
    const chave = String(a?.name ?? a?.key ?? "").trim();
    if (CHAVE_UTM_EM.test(chave)) {
      em = instanteDe(a?.value);
      continue;
    }
    if (CHAVE_UTM_GAD.test(chave)) {
      const gad = String(a?.value ?? "").trim();
      if (SO_ID.test(gad)) nosso.gad = gad;
      continue;
    }
    if (CHAVE_UTM_CLIQUE.test(chave)) {
      const clique = plataformaValida(a?.value);
      if (clique) nosso.clique = clique;
      continue;
    }
    const m = CHAVE_UTM_ATRIBUTO.exec(chave);
    if (!m) continue;
    const valor = limparValor(a?.value);
    if (!valor) continue;
    const alvo = m[1] ? nosso : externo;
    const k = m[2].toLowerCase() as ChaveUtm;
    if (!alvo[k]) alvo[k] = valor;
  }
  return {
    nosso: temUtm(nosso) && em ? { utm: nosso, em } : null,
    externo: temUtm(externo) ? externo : null,
  };
}

/** Os click ids dos atributos (lista fechada, como as UTMs). */
export function cliquesDosAtributos(lista: readonly AtributoDoPedido[] | null | undefined): Cliques {
  const c: Cliques = {};
  for (const a of Array.isArray(lista) ? lista : []) {
    const campo = CHAVE_CLIQUE_ATRIBUTO[String(a?.name ?? a?.key ?? "").trim().toLowerCase()];
    if (!campo || c[campo]) continue;
    const valor = cortar(typeof a?.value === "string" ? a.value : null);
    if (valor) c[campo] = valor;
  }
  return c;
}

/** O instante do clique gravado no _fbc (fb.1.<ms>.<fbclid>), ou null. */
export function instanteDoFbc(fbc: string | null | undefined): number | null {
  const partes = String(fbc || "").split(".");
  const ms = Number(partes[2]);
  return partes.length > 3 && Number.isFinite(ms) && ms > 1e12 ? ms : null;
}

// ---------------------------------------------------------------------------
// Coletor: o que o snippet manda
// ---------------------------------------------------------------------------

/**
 * As UTMs do clique que o snippet e a ponte guardaram (cookie, 7 dias) e
 * mandam em cada evento: `{utm_source, ..., gad_campaignid, clique, em}`. So
 * com o `clique` (gclid sem UTM) tambem vale: e um clique novo, e substitui a
 * UTM do anterior na identidade. A hora vem do navegador; adiantada vira
 * agora, e mais velha que a janela nao vale.
 */
export function utmDoCorpo(v: unknown, agoraMs: number): { utm: Utm; em: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const utm: Utm = {};
  for (const k of CHAVES_UTM) {
    const x = limparValor(o[`utm_${k}`]);
    if (x) utm[k] = x;
  }
  const gad = String(o.gad_campaignid ?? "").trim();
  if (SO_ID.test(gad)) utm.gad = gad;
  const clique = plataformaValida(o.clique);
  if (clique) utm.clique = clique;
  if (!temUtm(utm)) return null;
  const n = Number(o.em);
  // Hora no futuro (relogio do visitante adiantado ou forjada) vira agora: senao
  // ela ganharia de cliques mais novos na escolha do mais recente.
  const ms = !Number.isFinite(n) || n > agoraMs ? agoraMs : n;
  if (ms < agoraMs - JANELA_ORIGEM_MS) return null;
  return { utm, em: new Date(ms).toISOString() };
}

/**
 * As UTMs da URL da pagina (quem nao manda `utm`: snippet antigo, o pixel do
 * checkout): o clique e agora. A URL vem cortada em 500 (CORTE_PAGINA): o
 * ultimo parametro, que pode estar pela metade, sai.
 */
export function utmDaPagina(url: string | null | undefined, agoraMs: number): { utm: Utm; em: string } | null {
  const utm = utmDeParametros(parametrosDaUrl(url, CORTE_PAGINA));
  return temUtm(utm) ? { utm, em: new Date(agoraMs).toISOString() } : null;
}

// ---------------------------------------------------------------------------
// Modelos de "Parametros de URL" para colar no anuncio
// ---------------------------------------------------------------------------

/**
 * So ids: curtos (a Shopify corta o landing_site em 255) e estaveis (renomear
 * o anuncio nao divide o relatorio). A ordem dos niveis e a da Utmify:
 * conjunto em utm_medium, anuncio em utm_content. TikTok: __AID__ e o grupo,
 * __CID__ o criativo (doc "Track offsite web events with UTM parameters").
 * tests/tracking-utm.test.ts confere que o parser le cada um.
 */
export const PARAMETROS_URL = {
  meta: "utm_source=FB&utm_campaign={{campaign.id}}&utm_medium={{adset.id}}&utm_content={{ad.id}}&utm_term={{placement}}",
  google: "utm_source=google&utm_campaign={campaignid}&utm_medium={adgroupid}&utm_content={creative}&utm_term={keyword}",
  tiktok: "utm_source=tiktok&utm_campaign=__CAMPAIGN_ID__&utm_medium=__AID__&utm_content=__CID__&utm_term=__PLACEMENT__",
} as const satisfies Record<PlataformaAnuncio, string>;
