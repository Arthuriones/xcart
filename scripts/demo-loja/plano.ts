/**
 * O plano da loja de demonstracao: deterministico e puro (sem banco).
 *
 * Cada dia nasce de um sorteio semeado pela loja e pela data: rodar de novo
 * gera o MESMO dia, pedido por pedido. O de hoje e o dia inteiro planejado,
 * e so entra o que ja aconteceu (instante <= agora).
 *
 * A conta fecha pelo lucro: cada dia tem uma meta de lucro (tendencia, dia da
 * semana, ruido e datas de pico); os pedidos saem da meta, a receita, o custo
 * e a taxa sao os do proprio app (calcularFinanceiro) com o estado FINAL de
 * cada pedido, e o gasto de anuncio e o que sobra: receita - custo - taxas -
 * meta, preso num ROAS crivel. Como o estado final ja conta os reembolsos que
 * ainda vao acontecer, o gasto de um dia passado nunca muda entre execucoes.
 *
 * Usado so por scripts/demo-loja.ts. Nada aqui e importado pelo app.
 */
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// A loja
// ---------------------------------------------------------------------------

/** O dono: a conta do Arthur (arthur.geferreira@gmail.com). */
export const ARTHUR = "55c773d6-873a-456a-8695-296ff1433a53";

/**
 * A marca. Inventada: conferida em 19/10/2026 que nao e marca conhecida do
 * nicho (a parecida "Hush" e de cobertor pesado no Canada -- por isso nao
 * "Hush..."). Trocar a marca troca a semente, os ids e o dominio: rode o
 * `limpar` da antiga antes.
 */
export const MARCA = "Quillmere";
export const SEMENTE = "xcart-demo-quillmere-1";
export const FUSO = "America/New_York";
export const MOEDA = "USD";
/** Primeiro dia de venda. 90 dias ate 19/10/2026. */
export const LANCAMENTO = "2026-07-22";
/** A loja foi conectada uma semana antes da primeira venda. */
export const LOJA_CONECTADA_EM = "2026-07-15T14:12:31.000Z";
/** Pixel e conta de anuncio cadastrados antes da primeira venda. */
export const RASTREAMENTO_DESDE = "2026-07-16T16:40:09.000Z";
export const CONTAS_DESDE = "2026-07-18T13:05:44.000Z";
/** Taxa de pagamento da loja (Shopify Payments + PayPal, media). */
export const TAXA_PCT = 3.1;
export const TAXA_FIXA = 0.3;
/** Dias de funil (ver produto, carrinho, checkout) na fila: o resto e so a compra. */
export const DIAS_DE_FUNIL = 8;

// ---------------------------------------------------------------------------
// Ids, sorteio, tempo
// ---------------------------------------------------------------------------

const NAMESPACE = Buffer.from("6f1c2a9e4b7d4e3a9c1f2d8b7a6e5f40", "hex");

/** uuid v5 a partir de um nome: o mesmo nome, o mesmo id, em toda execucao. */
export function uuid(nome: string): string {
  const h = createHash("sha1").update(NAMESPACE).update(`${SEMENTE}:${nome}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** `n` digitos estaveis para um nome, com o prefixo na frente. */
export function digitos(nome: string, n: number, prefixo = ""): string {
  let saida = prefixo;
  let i = 0;
  while (saida.length < n) {
    const h = createHash("sha256").update(`${SEMENTE}:${nome}:${i++}`).digest("hex");
    saida += BigInt(`0x${h}`).toString().slice(1);
  }
  return saida.slice(0, n);
}

/** sha256 hex (o formato dos campos hasheados do Meta). */
export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sorteio deterministico (mulberry32). */
export class Sorteio {
  private estado: number;
  constructor(semente: string) {
    this.estado = hash32(`${SEMENTE}|${semente}`) || 1;
  }
  u(): number {
    this.estado = (this.estado + 0x6d2b79f5) | 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  entre(a: number, b: number): number {
    return a + (b - a) * this.u();
  }
  inteiro(a: number, b: number): number {
    return Math.min(b, Math.floor(this.entre(a, b + 1)));
  }
  chance(p: number): boolean {
    return this.u() < p;
  }
  normal(): number {
    const a = Math.max(this.u(), 1e-12);
    const b = this.u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  }
  /** Um item pelo peso. */
  peso<T>(itens: readonly (readonly [T, number])[]): T {
    const total = itens.reduce((s, [, p]) => s + p, 0);
    let x = this.u() * total;
    for (const [v, p] of itens) {
      x -= p;
      if (x <= 0) return v;
    }
    return itens[itens.length - 1][0];
  }
  texto(n: number, alfabeto = "abcdefghijklmnopqrstuvwxyz0123456789"): string {
    let s = "";
    for (let i = 0; i < n; i += 1) s += alfabeto[Math.floor(this.u() * alfabeto.length)];
    return s;
  }
}

export function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

export function somarDia(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(desde: string, ate: string): string[] {
  const saida: string[] = [];
  for (let d = desde; d <= ate; d = somarDia(d, 1)) saida.push(d);
  return saida;
}

/** 0 = domingo. */
export function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

const FORMATOS = new Map<string, Intl.DateTimeFormat>();
function formato(fuso: string): Intl.DateTimeFormat {
  let f = FORMATOS.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuso,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATOS.set(fuso, f);
  }
  return f;
}

/** Quanto o relogio do fuso esta a frente do UTC, em ms, no instante. */
function deslocamento(ms: number, fuso: string): number {
  const partes = formato(fuso).formatToParts(new Date(ms));
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

/** O instante (ms) de `segundos` depois da meia-noite do `dia` no fuso. */
export function instanteLocal(dia: string, segundos: number, fuso = FUSO): number {
  const [y, m, d] = dia.split("-").map(Number);
  const ingenuo = Date.UTC(y, m - 1, d) + Math.round(segundos * 1000);
  const primeira = ingenuo - deslocamento(ingenuo, fuso);
  return ingenuo - deslocamento(primeira, fuso);
}

/** "AAAA-MM-DD" do instante no fuso. */
export function diaLocal(ms: number, fuso = FUSO): string {
  return new Date(ms + deslocamento(ms, fuso)).toISOString().slice(0, 10);
}

/** Segundos desde a meia-noite local. */
export function segundosLocais(ms: number, fuso = FUSO): number {
  const local = ms + deslocamento(ms, fuso);
  return ((local % 86_400_000) + 86_400_000) % 86_400_000 / 1000;
}

/**
 * Pedidos por hora no fuso da loja (EUA principal): vale de madrugada, pico
 * no almoco e das 19 as 21 h.
 */
const CURVA_HORA = [
  3.2, 2.2, 1.5, 1.1, 1.0, 1.2, 1.9, 2.8, 3.6, 4.2, 4.6, 5.0, 5.5, 5.2, 4.9, 4.8, 4.9, 5.2, 5.8, 6.6, 6.9, 6.6,
  5.4, 4.2,
];
const TOTAL_CURVA = CURVA_HORA.reduce((s, v) => s + v, 0);

/** Um instante do dia (segundos locais) sorteado pela curva de horas. */
export function segundoDoDia(r: Sorteio): number {
  const hora = r.peso(CURVA_HORA.map((p, h) => [h, p] as const));
  return hora * 3600 + r.entre(0, 3600);
}

/** Fracao (0..1) do volume do dia que ja passou as `segundos` locais. */
export function fracaoDoDia(segundos: number): number {
  const h = Math.min(23, Math.floor(segundos / 3600));
  let acumulado = 0;
  for (let i = 0; i < h; i += 1) acumulado += CURVA_HORA[i];
  acumulado += CURVA_HORA[h] * ((segundos - h * 3600) / 3600);
  return Math.max(0, Math.min(1, acumulado / TOTAL_CURVA));
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

export interface ItemCatalogo {
  sku: string;
  produto: string;
  variante: string | null;
  handle: string;
  preco: number;
  /** Custo do fornecedor e frete do fornecedor, por unidade (USD). */
  custo: number;
  frete: number;
  /** Fornecedor renegociado a partir de CUSTO_V2_DESDE. */
  v2?: { custo: number; frete: number };
  /** Peso como item principal do pedido e como item a mais. */
  principal: number;
  extra: number;
  productId: string;
  variantId: string;
}

/** O dia em que o fornecedor dos travesseiros baixou o preco (volume). */
export const CUSTO_V2_DESDE = "2026-09-14";

function item(
  sku: string,
  produto: string,
  variante: string | null,
  handle: string,
  preco: number,
  custo: number,
  frete: number,
  principal: number,
  extra: number,
  v2?: { custo: number; frete: number }
): ItemCatalogo {
  return {
    sku,
    produto,
    variante,
    handle,
    preco,
    custo,
    frete,
    v2,
    principal,
    extra,
    productId: digitos(`produto:${handle}`, 13, "9"),
    variantId: digitos(`variante:${sku}`, 14, "4"),
  };
}

export const CATALOGO: ItemCatalogo[] = [
  item("QM-CTR-STD", "Quillmere Contour Memory Foam Pillow", "Standard", "contour-memory-foam-pillow", 59.95, 9.4, 4.1, 30, 15, { custo: 8.6, frete: 3.9 }),
  item("QM-CTR-KNG", "Quillmere Contour Memory Foam Pillow", "King", "contour-memory-foam-pillow", 69.95, 11.2, 4.6, 12, 5, { custo: 10.3, frete: 4.4 }),
  item("QM-CTR-2PK", "Quillmere Contour Pillow 2-Pack", null, "contour-pillow-2-pack", 109.95, 18.8, 6.2, 11, 0, { custo: 17.2, frete: 5.9 }),
  item("QM-WB-15", "Quillmere Cooling Weighted Blanket", "15 lb", "cooling-weighted-blanket", 129.0, 21.5, 9.8, 9, 0),
  item("QM-WB-20", "Quillmere Cooling Weighted Blanket", "20 lb", "cooling-weighted-blanket", 149.0, 25.9, 11.4, 4, 0),
  item("QM-BMB-Q", "Quillmere Bamboo Sheet Set", "Queen", "bamboo-sheet-set", 89.95, 14.8, 4.9, 9, 5),
  item("QM-BMB-K", "Quillmere Bamboo Sheet Set", "King", "bamboo-sheet-set", 99.95, 16.6, 5.3, 5, 0),
  item("QM-KNEE-01", "Quillmere Knee Alignment Pillow", null, "knee-alignment-pillow", 39.95, 5.9, 2.8, 9, 20),
  item("QM-MASK-SLK", "Quillmere Mulberry Silk Sleep Mask", null, "mulberry-silk-sleep-mask", 24.95, 2.35, 1.15, 6, 35),
  item("QM-PC-COOL", "Quillmere Cooling Pillowcase Set", null, "cooling-pillowcase-set", 34.95, 4.1, 1.6, 5, 20),
];

export const POR_SKU = new Map(CATALOGO.map((i) => [i.sku, i]));

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export interface Anuncio {
  id: string;
  nome: string;
  peso: number;
}

export interface Conjunto {
  id: string;
  nome: string;
  peso: number;
  /** Orcamento diario no conjunto (ABO). */
  orcamento?: number;
  anuncios: Anuncio[];
  /** Google Search: as palavras-chave do grupo. */
  palavras?: string[];
  /** No ar so entre estes dias (conjunto de teste que foi pausado). */
  inicio?: string;
  fim?: string;
}

/** O conjunto esta no ar no dia? */
export function conjuntoNoAr(s: Conjunto, dia: string): boolean {
  return (!s.inicio || dia >= s.inicio) && (!s.fim || dia <= s.fim);
}

/** Os conjuntos no ar no dia (ao menos um: a campanha no ar tem onde gastar). */
export function conjuntosDoDia(c: Campanha, dia: string): Conjunto[] {
  const noAr = c.conjuntos.filter((s) => conjuntoNoAr(s, dia));
  return noAr.length ? noAr : c.conjuntos.slice(0, 1);
}

export interface Campanha {
  id: string;
  nome: string;
  plataforma: "meta" | "google";
  tipo: "CBO" | "ABO" | "ASC" | "PMAX" | "SEARCH" | "SHOPPING";
  inicio: string;
  fim?: string;
  /** Peso no orcamento da conta (relativo). */
  peso: number;
  /** Desempenho relativo: pedidos por dolar contra a media da conta. */
  rendimento: number;
  /** Orcamento diario na campanha (CBO, ASC, Google). */
  orcamento?: number;
  /** CPM medio (Meta) ou CPC medio (Google), USD. */
  custoMidia: number;
  conjuntos: Conjunto[];
  /** Crescimento do peso ao longo do tempo (ASC escalando). */
  escala?: { ate: string; fator: number };
}

function anuncios(chave: string, nomes: [string, number][]): Anuncio[] {
  return nomes.map(([nome, peso]) => ({ id: digitos(`anuncio:${chave}:${nome}`, 18, "1202"), nome, peso }));
}

function conjunto(chave: string, nome: string, peso: number, ads: [string, number][], extra: Partial<Conjunto> = {}): Conjunto {
  return {
    id: digitos(`conjunto:${chave}:${nome}`, 18, "1202"),
    nome,
    peso,
    anuncios: anuncios(`${chave}:${nome}`, ads),
    ...extra,
  };
}

function campanhaMeta(c: Omit<Campanha, "id" | "plataforma">): Campanha {
  return { ...c, plataforma: "meta", id: digitos(`campanha:${c.nome}`, 18, "1202") };
}

function campanhaGoogle(c: Omit<Campanha, "id" | "plataforma">): Campanha {
  return { ...c, plataforma: "google", id: digitos(`campanha:${c.nome}`, 11, "2") };
}

function grupoGoogle(chave: string, nome: string, peso: number, palavras: string[], criativos: number): Conjunto {
  return {
    id: digitos(`grupo:${chave}:${nome}`, 12, "1"),
    nome,
    peso,
    palavras,
    anuncios: Array.from({ length: criativos }, (_, i) => ({
      id: digitos(`criativo:${chave}:${nome}:${i}`, 12, "7"),
      nome: `RSA ${i + 1} | ${nome}`,
      peso: i === 0 ? 1.4 : 1,
    })),
  };
}

export const CAMPANHAS: Campanha[] = [
  campanhaMeta({
    nome: "CBO | Contour Pillow | Broad | US",
    tipo: "CBO",
    inicio: "2026-07-22",
    peso: 1.0,
    rendimento: 1.0,
    orcamento: 2600,
    custoMidia: 21.5,
    conjuntos: [
      conjunto("m1", "Broad | US | 25-65+ | Advantage+ Audience", 1.3, [
        ["VID 07 | UGC Neck Pain Hook | 9x16", 1.6],
        ["VID 11 | Side Sleeper Demo | 9x16", 1.1],
        ["IMG 03 | Before After Static | 1x1", 0.6],
      ]),
      conjunto("m1", "Broad | US | Women 35-65+", 0.8, [
        ["VID 07 | UGC Neck Pain Hook | 9x16", 1.2],
        ["VID 14 | Chiropractor Review | 4x5", 1.0],
      ]),
      conjunto(
        "m1",
        "Interests | Sleep & Wellness | US",
        0.5,
        [
          ["VID 11 | Side Sleeper Demo | 9x16", 1.0],
          ["CAR 02 | 5 Reasons Carousel", 0.7],
        ],
        { fim: "2026-09-01" }
      ),
    ],
  }),
  campanhaMeta({
    nome: "ABO | Testing | Creatives",
    tipo: "ABO",
    inicio: "2026-07-22",
    peso: 0.16,
    rendimento: 0.72,
    custoMidia: 23,
    conjuntos: [
      conjunto("m2", "Test W30 | Hooks | Broad US", 1, [["VID 01 | Hook Wake Up No Pain", 1], ["VID 02 | Hook Pillow Graveyard", 1]], {
        orcamento: 80,
        fim: "2026-08-20",
      }),
      conjunto("m2", "Test W34 | UGC Batch | Broad US", 1, [["VID 08 | UGC Mom of 3", 1], ["VID 09 | UGC Nurse Night Shift", 1]], {
        orcamento: 80,
        inicio: "2026-08-17",
        fim: "2026-09-16",
      }),
      conjunto("m2", "Test W38 | Statics | Broad US", 1, [["IMG 05 | Review Screenshot", 1], ["IMG 06 | Price Anchor", 1]], {
        orcamento: 80,
        inicio: "2026-09-14",
      }),
      conjunto("m2", "Test W41 | Founder Story | Broad US", 1, [["VID 15 | Founder Story 45s", 1], ["VID 16 | Founder Story 15s", 1]], {
        orcamento: 80,
        inicio: "2026-10-06",
      }),
    ],
  }),
  campanhaMeta({
    nome: "RT | Retargeting | ATC + IC 14d",
    tipo: "CBO",
    inicio: "2026-07-29",
    peso: 0.11,
    rendimento: 1.65,
    orcamento: 350,
    custoMidia: 29,
    conjuntos: [
      conjunto("m5", "RT | ATC 14d | Exclude Purchasers 30d", 1, [
        ["DPA | Catalog Carousel", 1.2],
        ["IMG 09 | Free Shipping Reminder", 0.8],
      ]),
      conjunto("m5", "RT | IC 7d | Exclude Purchasers 30d", 0.7, [["VID 18 | 30-Night Trial", 1]]),
    ],
  }),
  campanhaMeta({
    nome: "CBO | Bamboo Sheets | Interests | US",
    tipo: "CBO",
    inicio: "2026-08-01",
    fim: "2026-09-20",
    peso: 0.24,
    rendimento: 0.82,
    orcamento: 600,
    custoMidia: 20,
    conjuntos: [
      conjunto("m4", "Interests | Home Decor + Bedding | US", 1, [
        ["VID 05 | Bamboo vs Cotton | 9x16", 1],
        ["IMG 04 | Cooling Sheets Static", 0.7],
      ]),
      conjunto("m4", "Broad | US | 30-65+", 0.8, [["VID 05 | Bamboo vs Cotton | 9x16", 1]]),
    ],
  }),
  campanhaMeta({
    nome: "CBO | Weighted Blanket | Broad | US+CA",
    tipo: "CBO",
    inicio: "2026-08-05",
    peso: 0.42,
    rendimento: 0.96,
    orcamento: 1100,
    custoMidia: 19.5,
    conjuntos: [
      conjunto("m3", "Broad | US+CA | 25-65+", 1.2, [
        ["VID 10 | Anxiety Relief UGC | 9x16", 1.4],
        ["VID 12 | Hot Sleeper Cooling | 9x16", 1.0],
      ]),
      conjunto("m3", "LAL 2% Purchasers | US", 0.7, [["VID 10 | Anxiety Relief UGC | 9x16", 1]]),
    ],
  }),
  campanhaMeta({
    nome: "ASC+ | Advantage+ Shopping | Full Catalog",
    tipo: "ASC",
    inicio: "2026-08-18",
    peso: 0.3,
    escala: { ate: "2026-09-22", fator: 3.4 },
    rendimento: 1.08,
    orcamento: 3200,
    custoMidia: 18,
    conjuntos: [
      conjunto("m6", "ASC+ | All Products | Worldwide", 1, [
        ["VID 07 | UGC Neck Pain Hook | 9x16", 1.3],
        ["VID 10 | Anxiety Relief UGC | 9x16", 1.0],
        ["DPA | Catalog Carousel", 0.9],
        ["VID 14 | Chiropractor Review | 4x5", 0.7],
      ]),
    ],
  }),
  campanhaMeta({
    nome: "CBO | Labor Day Sale | Broad | US",
    tipo: "CBO",
    inicio: "2026-09-01",
    fim: "2026-09-08",
    peso: 0.55,
    rendimento: 1.15,
    orcamento: 1800,
    custoMidia: 22,
    conjuntos: [
      conjunto("m7", "Broad | US | 25-65+ | Sale", 1, [
        ["VID 17 | Labor Day 25% Off", 1.3],
        ["IMG 08 | Sale Banner Static", 0.7],
      ]),
    ],
  }),
  campanhaMeta({
    nome: "CBO | Contour Pillow | Broad | UK+AU",
    tipo: "CBO",
    inicio: "2026-09-10",
    peso: 0.32,
    rendimento: 0.9,
    orcamento: 800,
    custoMidia: 15.5,
    conjuntos: [
      conjunto("m8", "Broad | UK+AU | 25-65+", 1, [
        ["VID 07 | UGC Neck Pain Hook | 9x16", 1.2],
        ["VID 11 | Side Sleeper Demo | 9x16", 0.9],
      ]),
    ],
  }),
  campanhaMeta({
    nome: "CBO | Fall Sleep Sale | Broad | US",
    tipo: "CBO",
    inicio: "2026-10-09",
    peso: 0.22,
    rendimento: 1.02,
    orcamento: 700,
    custoMidia: 22.5,
    conjuntos: [
      conjunto("m9", "Broad | US | 25-65+ | Fall", 1, [
        ["VID 19 | Fall Reset Your Sleep", 1.1],
        ["IMG 10 | Bundle & Save", 0.8],
      ]),
    ],
  }),
  campanhaGoogle({
    nome: "PMax | All Products | US",
    tipo: "PMAX",
    inicio: "2026-07-22",
    peso: 1.0,
    rendimento: 1.0,
    orcamento: 450,
    custoMidia: 1.05,
    conjuntos: [],
  }),
  campanhaGoogle({
    nome: "Search | Brand | Quillmere",
    tipo: "SEARCH",
    inicio: "2026-07-25",
    peso: 0.12,
    rendimento: 2.6,
    orcamento: 60,
    custoMidia: 0.42,
    conjuntos: [grupoGoogle("g1", "Brand - Exact", 1, ["quillmere", "quillmere pillow", "quillmere reviews"], 2)],
  }),
  campanhaGoogle({
    nome: "Search | Contour Pillow | Exact",
    tipo: "SEARCH",
    inicio: "2026-08-01",
    peso: 0.42,
    rendimento: 0.85,
    orcamento: 220,
    custoMidia: 1.55,
    conjuntos: [
      grupoGoogle("g3", "Contour Pillow", 1.2, ["contour pillow", "memory foam contour pillow", "cervical pillow"], 3),
      grupoGoogle("g3", "Neck Pain Pillow", 1, ["pillow for neck pain", "best pillow for side sleepers", "orthopedic pillow"], 2),
    ],
  }),
  campanhaGoogle({
    nome: "Shopping | Weighted Blankets",
    tipo: "SHOPPING",
    inicio: "2026-08-12",
    peso: 0.3,
    rendimento: 0.92,
    orcamento: 150,
    custoMidia: 0.95,
    conjuntos: [],
  }),
];

/** O peso de uma campanha num dia (0 = fora do ar). */
export function pesoNoDia(c: Campanha, dia: string): number {
  if (dia < c.inicio || (c.fim && dia > c.fim)) return 0;
  // Os primeiros dias saem com orcamento menor (fase de aprendizado).
  const idade = Math.round((Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${c.inicio}T00:00:00Z`)) / 864e5);
  const aprendizado = idade < 5 ? 0.45 + 0.11 * idade : 1;
  let escala = 1;
  if (c.escala) {
    const total = (Date.parse(`${c.escala.ate}T00:00:00Z`) - Date.parse(`${c.inicio}T00:00:00Z`)) / 864e5;
    escala = 1 + (c.escala.fator - 1) * Math.min(1, idade / Math.max(1, total));
  }
  return c.peso * aprendizado * escala;
}

export const POSICIONAMENTOS: [string, number][] = [
  ["Instagram_Reels", 34],
  ["Facebook_Mobile_Feed", 24],
  ["Instagram_Feed", 14],
  ["Instagram_Stories", 11],
  ["Facebook_Mobile_Reels", 9],
  ["Facebook_Stories", 5],
  ["Instagram_Explore", 3],
];

export const FLUXOS_EMAIL = ["Welcome Series", "Abandoned Checkout", "Browse Abandonment", "Fall Sale Campaign"];

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export interface LinhaPlano {
  sku: string;
  qtd: number;
  preco: number;
}

export type OrigemPlano =
  | {
      tipo: "meta";
      campanha: Campanha;
      conjunto: Conjunto;
      anuncio: Anuncio;
      posicionamento: string;
      cliqueMs: number;
      /** O clique e da sessao que virou o pedido (senao, de uma visita anterior). */
      sessao: boolean;
      fbclid: string;
    }
  | {
      tipo: "google";
      campanha: Campanha;
      grupo: Conjunto | null;
      criativo: Anuncio | null;
      palavra: string | null;
      cliqueMs: number;
      sessao: boolean;
      gclid: string;
    }
  | { tipo: "email"; fluxo: string; cliqueMs: number }
  | { tipo: "pinterest"; cliqueMs: number }
  | { tipo: "direto"; visitaMs: number }
  | { tipo: "sem_jornada" };

export interface PedidoPlano {
  dia: string;
  /** Preenchidos na numeracao (gerarPlano). */
  id: string;
  numero: number;
  criadoMs: number;
  tipo: "venda" | "reenvio";
  pais: string;
  moedaCliente: string;
  gateway: string | null;
  linhas: LinhaPlano[];
  subtotal: number;
  desconto: number;
  frete: number;
  imposto: number;
  impostoIncluso: boolean;
  total: number;
  cancelado: null | { emMs: number; como: "VOIDED" | "REFUNDED" };
  enviaEmMs: number;
  entregaEmMs: number;
  reembolso: null | { emMs: number; valor: number; total: boolean; devolvido: boolean };
  origem: OrigemPlano;
  visitante: string;
  token: string;
  fbp: string;
}

interface Pais {
  codigo: string;
  moeda: string;
  peso: number;
  /** Imposto: exclusivo (somado) ou incluso no preco. */
  imposto: (r: Sorteio) => { taxa: number; incluso: boolean };
}

const PAISES: Pais[] = [
  { codigo: "US", moeda: "USD", peso: 74, imposto: (r) => (r.chance(0.32) ? { taxa: arred(r.entre(0.04, 0.0875), 4), incluso: false } : { taxa: 0, incluso: false }) },
  { codigo: "CA", moeda: "CAD", peso: 9, imposto: (r) => ({ taxa: r.peso([[0.05, 40], [0.13, 45], [0.15, 15]] as const), incluso: false }) },
  { codigo: "GB", moeda: "GBP", peso: 7, imposto: () => ({ taxa: 0.2, incluso: true }) },
  { codigo: "AU", moeda: "AUD", peso: 6, imposto: () => ({ taxa: 0.1, incluso: true }) },
  { codigo: "DE", moeda: "EUR", peso: 1.4, imposto: () => ({ taxa: 0.19, incluso: true }) },
  { codigo: "FR", moeda: "EUR", peso: 1.0, imposto: () => ({ taxa: 0.2, incluso: true }) },
  { codigo: "NL", moeda: "EUR", peso: 0.8, imposto: () => ({ taxa: 0.21, incluso: true }) },
  { codigo: "IE", moeda: "EUR", peso: 0.8, imposto: () => ({ taxa: 0.23, incluso: true }) },
];

const PRINCIPAIS = CATALOGO.filter((i) => i.principal > 0).map((i) => [i, i.principal] as const);
const EXTRAS = CATALOGO.filter((i) => i.extra > 0).map((i) => [i, i.extra] as const);

function montarLinhas(r: Sorteio): LinhaPlano[] {
  const linhas: LinhaPlano[] = [];
  const principal = r.peso(PRINCIPAIS);
  const qtd = principal.sku === "QM-CTR-2PK" ? 1 : r.peso([[1, 90], [2, 9], [3, 1]] as const);
  linhas.push({ sku: principal.sku, qtd, preco: principal.preco });
  const extras = r.peso([[0, 70], [1, 24], [2, 6]] as const);
  for (let i = 0; i < extras; i += 1) {
    const e = r.peso(EXTRAS);
    const ja = linhas.find((l) => l.sku === e.sku);
    if (ja) ja.qtd += 1;
    else linhas.push({ sku: e.sku, qtd: 1, preco: e.preco });
  }
  return linhas;
}

/** Os valores do pedido (moeda da loja), do jeito que a Shopify somaria. */
function valores(r: Sorteio, linhas: LinhaPlano[], pais: Pais) {
  const subtotal = arred(linhas.reduce((s, l) => s + l.preco * l.qtd, 0));
  let pct = 0;
  if (r.chance(0.35)) {
    pct = r.peso([[0.1, 55], [0.15, 30], [linhas.length > 1 ? 0.2 : 0.1, 15]] as const);
  }
  const desconto = arred(subtotal * pct);
  const base = subtotal - desconto;
  const expresso = r.chance(0.05);
  const frete = expresso ? 12.95 : base >= 75 ? 0 : pais.codigo === "US" ? 5.95 : 7.95;
  const { taxa, incluso } = pais.imposto(r);
  const tributavel = pais.codigo === "US" ? base : base + frete;
  const imposto = taxa <= 0 ? 0 : incluso ? arred((tributavel * taxa) / (1 + taxa)) : arred(tributavel * taxa);
  const total = arred(base + frete + (incluso ? 0 : imposto));
  return { subtotal, desconto, frete, imposto, impostoIncluso: incluso, total };
}

/** Linha do tempo do pedido (envio, entrega, reembolso, cancelamento) a partir da criacao. */
function linhaDoTempo(r: Sorteio, criadoMs: number, total: number) {
  const H = 3_600_000;
  // Fim de semana atrasa o envio do fornecedor.
  const envio = criadoMs + r.entre(18, 72) * H + (new Date(criadoMs).getUTCDay() % 6 === 0 ? 24 * H : 0);
  const entrega = envio + r.entre(6, 12) * 24 * H;
  let cancelado: PedidoPlano["cancelado"] = null;
  let reembolso: PedidoPlano["reembolso"] = null;
  const x = r.u();
  if (x < 0.012) {
    cancelado = { emMs: criadoMs + r.entre(1, 8) * H, como: r.chance(0.5) ? "VOIDED" : "REFUNDED" };
  } else if (x < 0.012 + 0.031) {
    const totalReembolso = r.chance(0.6);
    reembolso = {
      emMs: criadoMs + r.entre(4, 18) * 24 * H,
      valor: totalReembolso ? total : arred(total * r.entre(0.2, 0.5)),
      total: totalReembolso,
      devolvido: totalReembolso && r.chance(0.3),
    };
  }
  return { enviaEmMs: envio, entregaEmMs: entrega, cancelado, reembolso };
}

function idVisitante(r: Sorteio): string {
  return `${r.texto(8)}.${r.texto(10)}`;
}

// ---------------------------------------------------------------------------
// O dia
// ---------------------------------------------------------------------------

/** Multiplicador por dia da semana (0 = domingo): o EUA compra mais no domingo e na segunda. */
const DIA_DA_SEMANA = [1.06, 1.04, 1.0, 0.98, 0.96, 0.92, 0.95];

/** Datas que fogem da curva: picos de venda e dias ruins de entrega do Meta. */
const EVENTOS: Record<string, number> = {
  "2026-08-12": 0.8, // instabilidade do Meta: CPM alto o dia todo
  "2026-08-26": 0.86,
  "2026-08-27": 0.82, // criativo principal cansou
  "2026-08-28": 0.9,
  "2026-09-05": 1.3, // fim de semana do Labor Day
  "2026-09-06": 1.4,
  "2026-09-07": 1.24,
  "2026-10-03": 1.12, // criativo novo escalando
  "2026-10-04": 1.16,
  "2026-10-05": 1.1,
};

export interface MetaDoDia {
  lucro: number;
  roas: number;
  /** Fatia do Meta no gasto (o resto e Google). */
  fatiaMeta: number;
}

export function metaDoDia(dia: string, idx: number): MetaDoDia {
  const r = new Sorteio(`meta:${dia}`);
  const tendencia = 6350 * (1 + (0.27 * idx) / 89);
  const rampa = idx < 10 ? 0.38 + 0.062 * idx : 1;
  const semana = DIA_DA_SEMANA[diaDaSemana(dia)];
  const ruido = Math.exp(0.11 * r.normal());
  const evento = EVENTOS[dia] ?? 1;
  const lucro = tendencia * rampa * semana * ruido * evento;
  // ROAS: melhor no fim de semana e no pico, pior nos dias ruins.
  const roasBase = idx < 10 ? 2.3 + 0.035 * idx : 2.66;
  const roas = Math.max(2.2, Math.min(3.15, roasBase + 0.14 * r.normal() + (semana - 1) * 1.6 + (evento - 1) * 0.9));
  const fatiaMeta = Math.max(0.83, Math.min(0.9, 0.87 + 0.012 * r.normal()));
  return { lucro, roas, fatiaMeta };
}

/** As campanhas no ar no dia, com o peso no orcamento. */
export function campanhasDoDia(dia: string, plataforma: "meta" | "google"): { c: Campanha; peso: number }[] {
  return CAMPANHAS.filter((c) => c.plataforma === plataforma)
    .map((c) => ({ c, peso: pesoNoDia(c, dia) }))
    .filter((x) => x.peso > 0);
}

function origemDoPedido(r: Sorteio, dia: string, criadoMs: number): OrigemPlano {
  const H = 3_600_000;
  const tipo = r.peso([
    ["meta", 72],
    ["google", 12],
    ["direto", 10.5],
    ["email", 3],
    ["sem_jornada", 1.5],
    ["pinterest", 1],
  ] as const);
  const antes = (sessao: boolean) => criadoMs - (sessao ? r.entre(4, 50) * 60_000 : r.entre(3, 5 * 24) * H);
  /**
   * O clique: na sessao do pedido ou numa visita de ate 5 dias antes. Nunca
   * antes de a campanha (e a loja) entrar no ar: ai o clique e da sessao.
   */
  const clique = (querSessao: boolean, inicioDaCampanha: string) => {
    const piso = instanteLocal(inicioDaCampanha > LANCAMENTO ? inicioDaCampanha : LANCAMENTO, 0) + 2 * 60_000;
    let sessao = querSessao;
    let cliqueMs = antes(sessao);
    if (cliqueMs < piso) {
      sessao = true;
      cliqueMs = Math.max(piso, criadoMs - r.entre(4, 50) * 60_000);
    }
    if (cliqueMs >= criadoMs) cliqueMs = criadoMs - r.entre(60_000, 180_000);
    return { sessao, cliqueMs };
  };
  if (tipo === "meta") {
    const ativas = campanhasDoDia(dia, "meta");
    const { c } = r.peso(ativas.map((x) => [x, x.peso * x.c.rendimento] as const));
    const conj = r.peso(conjuntosDoDia(c, dia).map((s) => [s, s.peso] as const));
    const ad = r.peso(conj.anuncios.map((a) => [a, a.peso] as const));
    const { sessao, cliqueMs } = clique(r.chance(0.75), conj.inicio && conj.inicio > c.inicio ? conj.inicio : c.inicio);
    return {
      tipo,
      campanha: c,
      conjunto: conj,
      anuncio: ad,
      posicionamento: r.peso(POSICIONAMENTOS),
      cliqueMs,
      sessao,
      fbclid: `IwZXh0bgNhZW0BMABhZGlkAa${r.texto(46, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")}`,
    };
  }
  if (tipo === "google") {
    const ativas = campanhasDoDia(dia, "google");
    const { c } = r.peso(ativas.map((x) => [x, x.peso * x.c.rendimento] as const));
    const grupo = c.conjuntos.length ? r.peso(c.conjuntos.map((s) => [s, s.peso] as const)) : null;
    const criativo = grupo ? r.peso(grupo.anuncios.map((a) => [a, a.peso] as const)) : null;
    const palavra = grupo?.palavras?.length ? grupo.palavras[r.inteiro(0, grupo.palavras.length - 1)] : null;
    const { sessao, cliqueMs } = clique(r.chance(0.8), c.inicio);
    return {
      tipo,
      campanha: c,
      grupo,
      criativo,
      palavra,
      cliqueMs,
      sessao,
      gclid: `Cj0KCQjw${r.texto(80, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")}`,
    };
  }
  if (tipo === "email") return { tipo, fluxo: FLUXOS_EMAIL[r.inteiro(0, FLUXOS_EMAIL.length - 1)], cliqueMs: antes(true) };
  if (tipo === "pinterest") return { tipo, cliqueMs: antes(true) };
  if (tipo === "direto") return { tipo, visitaMs: criadoMs - r.entre(3, 40) * 60_000 };
  return { tipo: "sem_jornada" };
}

/** Um pedido de venda nascido no instante `criadoMs`. */
function pedidoDeVenda(r: Sorteio, dia: string, criadoMs: number): PedidoPlano {
  const pais = r.peso(PAISES.map((p) => [p, p.peso] as const));
  const linhas = montarLinhas(r);
  const v = valores(r, linhas, pais);
  const tempo = linhaDoTempo(r, criadoMs, v.total);
  return {
    dia,
    id: "",
    numero: 0,
    criadoMs,
    tipo: "venda",
    pais: pais.codigo,
    moedaCliente: pais.moeda,
    gateway: r.chance(0.79) ? "shopify_payments" : "paypal",
    linhas,
    ...v,
    ...tempo,
    origem: origemDoPedido(r, dia, criadoMs),
    visitante: idVisitante(r),
    token: r.texto(32, "0123456789abcdef"),
    fbp: `fb.1.${criadoMs - Math.floor(r.entre(1, 40) * 864e5)}.${r.inteiro(100000000, 2147483647)}`,
  };
}

/** Reenvio: draft de valor zero, o produto sai de novo pelo custo. */
function pedidoDeReenvio(r: Sorteio, dia: string, criadoMs: number): PedidoPlano {
  const item = r.peso(PRINCIPAIS);
  const linhas = [{ sku: item.sku, qtd: 1, preco: item.preco }];
  const tempo = linhaDoTempo(r, criadoMs, 0);
  return {
    dia,
    id: "",
    numero: 0,
    criadoMs,
    tipo: "reenvio",
    pais: "US",
    moedaCliente: "USD",
    gateway: null,
    linhas,
    subtotal: item.preco,
    desconto: item.preco,
    frete: 0,
    imposto: 0,
    impostoIncluso: false,
    total: 0,
    ...tempo,
    cancelado: null,
    reembolso: null,
    origem: { tipo: "sem_jornada" },
    visitante: idVisitante(r),
    token: r.texto(32, "0123456789abcdef"),
    fbp: "",
  };
}

export interface EconomiaMedia {
  receita: number;
  cmv: number;
  taxa: number;
}

/**
 * Receita, custo e taxa medios de um pedido, por amostra (2.000 pedidos de um
 * dia ficticio). So para escolher QUANTOS pedidos o dia precisa: a conta de
 * verdade e a do app, depois.
 */
export function economiaMedia(): EconomiaMedia {
  const r = new Sorteio("economia");
  let receita = 0;
  let cmv = 0;
  let taxa = 0;
  const n = 2000;
  for (let i = 0; i < n; i += 1) {
    const p = pedidoDeVenda(r, "2026-08-15", Date.parse("2026-08-15T16:00:00Z"));
    const pago = p.cancelado ? 0 : p.total - (p.reembolso?.valor ?? 0);
    const semImposto = Math.max(0, pago - (p.reembolso?.total ? 0 : p.imposto * (pago / Math.max(p.total, 0.01))));
    receita += semImposto;
    if (!p.cancelado) {
      cmv += p.linhas.reduce((s, l) => {
        const c = POR_SKU.get(l.sku)!;
        return s + (c.custo + c.frete) * l.qtd;
      }, 0);
    }
    if (semImposto > 0) taxa += (pago * TAXA_PCT) / 100 + TAXA_FIXA;
  }
  return { receita: receita / n, cmv: cmv / n, taxa: taxa / n };
}

export interface DiaPlano {
  dia: string;
  idx: number;
  meta: MetaDoDia;
  pedidos: PedidoPlano[];
}

/** O plano de um dia (sem a numeracao, que depende dos dias anteriores). */
export function planejarDia(dia: string, idx: number, economia: EconomiaMedia): DiaPlano {
  const meta = metaDoDia(dia, idx);
  const r = new Sorteio(`dia:${dia}`);
  // Lucro por pedido esperado no ROAS do dia: receita - custo - taxa - anuncio.
  const porPedido = economia.receita - economia.cmv - economia.taxa - economia.receita / meta.roas;
  const n = Math.max(20, Math.round(meta.lucro / Math.max(5, porPedido)));
  const instantes = Array.from({ length: n }, () => instanteLocal(dia, segundoDoDia(r))).sort((a, b) => a - b);
  const pedidos = instantes.map((ms) => pedidoDeVenda(r, dia, ms));
  // ~0,3% de reenvio (troca, extravio), espalhado no dia.
  const esperados = n * 0.003;
  const reenvios = Math.floor(esperados) + (r.chance(esperados - Math.floor(esperados)) ? 1 : 0);
  for (let i = 0; i < reenvios; i += 1) {
    pedidos.push(pedidoDeReenvio(r, dia, instanteLocal(dia, r.entre(9 * 3600, 18 * 3600))));
  }
  pedidos.sort((a, b) => a.criadoMs - b.criadoMs);
  return { dia, idx, meta, pedidos };
}

/** Id da Shopify: 13 digitos, crescendo com o tempo, unico por pedido. */
const BASE_ID = 6_412_384_000_000;
const LANCAMENTO_MS = Date.parse(`${LANCAMENTO}T00:00:00Z`);

/** Todos os dias de LANCAMENTO ate `ate`, numerados (#1001...) na ordem em que nasceram. */
export function gerarPlano(ate: string): DiaPlano[] {
  const economia = economiaMedia();
  const dias = diasEntre(LANCAMENTO, ate).map((dia, idx) => planejarDia(dia, idx, economia));
  let numero = 1001;
  for (const d of dias) {
    for (const p of d.pedidos) {
      p.numero = numero;
      const segundos = Math.max(0, Math.floor((p.criadoMs - LANCAMENTO_MS) / 1000));
      p.id = String(BASE_ID + segundos * 1000 + (numero % 1000));
      numero += 1;
    }
  }
  return dias;
}

// ---------------------------------------------------------------------------
// Ids fixos da loja, das contas e dos destinos
// ---------------------------------------------------------------------------

const ALFANUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const ROTULO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function textoFixo(nome: string, n: number, alfabeto = ALFANUM): string {
  return new Sorteio(`fixo:${nome}`).texto(n, alfabeto);
}

export const LOJA_ID = uuid("loja");
/** O .myshopify.com no formato das lojas de verdade (6 + 2 caracteres). */
export const DOMINIO = `${textoFixo("dominio-a", 6)}-${textoFixo("dominio-b", 2)}.myshopify.com`;
export const NOME_LOJA = MARCA;

export const CONTA_META = {
  id: uuid("conta:meta"),
  external_id: digitos("conta-meta", 16, "10"),
  nome: `${MARCA} | US 01`,
};
export const CONTA_GOOGLE = {
  id: uuid("conta:google"),
  external_id: digitos("conta-google", 10, "4"),
  nome: `${MARCA} Google Ads`,
};

export const DESTINO_META = {
  id: uuid("destino:meta"),
  conta: digitos("pixel-meta", 16, "1"),
  nome: `${MARCA} Pixel`,
};
export const DESTINO_GOOGLE = {
  id: uuid("destino:google"),
  conta: `AW-${digitos("aw", 11, "1")}`,
  nome: "Google Ads",
  labels: {
    purchase: textoFixo("label-purchase", 19, ROTULO),
    add_to_cart: textoFixo("label-atc", 19, ROTULO),
    begin_checkout: textoFixo("label-ic", 19, ROTULO),
  },
};
