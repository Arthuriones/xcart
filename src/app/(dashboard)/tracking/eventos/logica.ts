import type { EventoFeed } from "@/lib/financeiro/tipos";
import { EVENTOS, chaveDoEvento, definicaoDoEvento } from "@/lib/tracking/eventos";

// ============================================================================
// Eventos ao vivo: a logica pura da tela (rotulos, filtros, visoes, URL, CSV).
//
// Sem React e sem "server-only": a pagina (servidor) le o filtro da URL com
// as mesmas funcoes que a tela (navegador) usa para filtrar, e os testes
// cobrem tudo daqui.
//
// O FILTRO VALE SO NAS LINHAS CARREGADAS. A RPC do feed recebe lojas, data e
// limite; filtrar no servidor e contar o periodo pedem migration (#33). Por
// isso a tela sempre diz "nas N linhas carregadas".
// ============================================================================

/** Quantos eventos a tela guarda no maximo (o resto sai pelo fim). */
export const TETO = 500;
/** Tamanho da pagina da RPC: resposta menor que isto = nao ha mais antigos. */
export const PAGINA = 100;
/** Fuso quando a loja nao tem um gravado (o mesmo do Lucro). */
export const FUSO_PADRAO = "America/Sao_Paulo";

// ---------------------------------------------------------------------------
// Rotulos
// ---------------------------------------------------------------------------

export type TomEvento = "ok" | "run" | "err";

export const STATUS_TELA: Record<
  EventoFeed["status"],
  { tom: TomEvento; rotulo: string; um: string; varios: string }
> = {
  enviado: { tom: "ok", rotulo: "Enviado", um: "enviado", varios: "enviados" },
  pendente: { tom: "run", rotulo: "Na fila", um: "na fila", varios: "na fila" },
  falhou: { tom: "err", rotulo: "Falhou", um: "falha", varios: "falhas" },
};
export const ORDEM_STATUS: EventoFeed["status"][] = ["enviado", "pendente", "falhou"];

export const FONTE_TELA: Record<EventoFeed["fonte"], string> = {
  tema: "Tema",
  pixel: "Pixel do checkout",
  webhook: "Webhook de pedido",
};
export const ORDEM_FONTE: EventoFeed["fonte"][] = ["tema", "pixel", "webhook"];

export function nomePlataforma(p: string): string {
  if (p === "meta") return "Meta";
  if (p === "google") return "Google";
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : "—";
}

/** "purchase" -> "Compra". Nome fora do catalogo aparece cru. */
export function nomeDoEvento(cru: string): string {
  const chave = chaveDoEvento(cru);
  return chave ? definicaoDoEvento(chave).nome : cru || "—";
}

export function ehCompra(e: Pick<EventoFeed, "evento">): boolean {
  return chaveDoEvento(e.evento) === "purchase";
}

// ---------------------------------------------------------------------------
// Ordem e juncao (polling e "carregar mais antigos")
// ---------------------------------------------------------------------------

/** Mais novo primeiro; empate no instante desempata pelo id, como a RPC. */
export function ordenarEventos(a: EventoFeed, b: EventoFeed): number {
  if (a.criado_em !== b.criado_em) return a.criado_em < b.criado_em ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Junta o que chegou com o que ja estava, sem repetir id. A versao NOVA de um
 * id vence: o polling rele os ultimos 100, e um "na fila" de 15 s atras pode
 * ter virado "enviado".
 */
export function juntarEventos(
  atuais: EventoFeed[],
  chegaram: EventoFeed[],
  teto = TETO
): EventoFeed[] {
  const porId = new Map<string, EventoFeed>();
  for (const e of atuais) porId.set(e.id, e);
  for (const e of chegaram) porId.set(e.id, e);
  return [...porId.values()].sort(ordenarEventos).slice(0, teto);
}

/** Ids que nao estavam na lista: as linhas que piscam ao chegar. */
export function idsNovos(atuais: EventoFeed[], chegaram: EventoFeed[]): string[] {
  const conhecidos = new Set(atuais.map((e) => e.id));
  return chegaram.filter((e) => !conhecidos.has(e.id)).map((e) => e.id);
}

// ---------------------------------------------------------------------------
// Data e hora, sempre no fuso da tela (o mesmo da barra do topo)
// ---------------------------------------------------------------------------

const formatadores = new Map<string, Intl.DateTimeFormat>();

/** Formatador em cache; fuso invalido cai no padrao em vez de lancar. */
function formatador(
  chave: string,
  fuso: string,
  opcoes: Intl.DateTimeFormatOptions,
  locale = "pt-BR"
): Intl.DateTimeFormat {
  const id = `${locale}|${chave}|${fuso}`;
  let f = formatadores.get(id);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...opcoes, timeZone: fuso });
    } catch {
      f = new Intl.DateTimeFormat(locale, { ...opcoes, timeZone: FUSO_PADRAO });
    }
    formatadores.set(id, f);
  }
  return f;
}

function instante(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** "14:32:05" no fuso. */
export function horaDoEvento(iso: string, fuso: string): string {
  const ms = instante(iso);
  if (ms === null) return "—";
  return formatador("hms", fuso, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

/** "2026-10-02": o dia do instante no fuso. */
export function diaNoFuso(ms: number, fuso: string): string {
  return formatador("dia", fuso, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA").format(ms);
}

function diaAnterior(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A data que vai embaixo da hora quando o evento nao e de hoje:
 * "" (hoje), "01/10 · ontem" ou "28/09".
 */
export function rotuloDia(iso: string, hoje: string, fuso: string): string {
  const ms = instante(iso);
  if (ms === null) return "";
  const dia = diaNoFuso(ms, fuso);
  if (dia === hoje) return "";
  const curto = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  return dia === diaAnterior(hoje) ? `${curto} · ontem` : curto;
}

/** "02/10/2026 às 14:32:05". */
export function dataHoraCompleta(iso: string, fuso: string): string {
  const ms = instante(iso);
  if (ms === null) return "—";
  const dia = diaNoFuso(ms, fuso);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)} às ${horaDoEvento(iso, fuso)}`;
}

// ---------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------

function decimal(n: number, casas: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/**
 * Tempo entre o evento entrar na fila e sair para a plataforma. So existe no
 * enviado; a RPC arredonda a 0,1 s, entao "ms" seria precisao inventada.
 */
export function formatarLatencia(e: Pick<EventoFeed, "status" | "latencia_s">): string {
  const s = e.latencia_s;
  if (e.status !== "enviado" || s === null || !Number.isFinite(s) || s < 0) return "—";
  if (s < 10) return `${decimal(s, 1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

/**
 * O evento e TESTE do dono (link ?xcart_teste=1, click id com TEST)?
 *
 * Aqui o teste NAO some: e nesta tela que o dono confere o proprio teste, entao
 * ele aparece com selo. Fora das contagens ele fica so no Rastreamento.
 *
 * O campo vem de tracking_feed_v2 (migration 055). Enquanto o feed nao o
 * repassar, a linha simplesmente nao tem selo -- nunca um "nao" afirmado.
 */
export function ehTeste(e: EventoFeed): boolean {
  return (e as EventoFeed & { teste?: boolean | null }).teste === true;
}

/** Coluna "Clique": o evento leva o identificador do clique do anuncio? */
export function textoClique(e: Pick<EventoFeed, "com_clique">): string {
  if (e.com_clique === null) return "—";
  return e.com_clique ? "Sim" : "Não";
}

/** O mesmo, por extenso, para o detalhe. */
export function detalheClique(e: Pick<EventoFeed, "com_clique" | "plataforma" | "evento">): string {
  if (e.com_clique === null) return "—";
  if (e.com_clique) {
    if (e.plataforma === "meta") return "Sim: leva o identificador do clique do Meta (fbc)";
    if (e.plataforma === "google") return "Sim: leva o identificador do clique do Google (gclid, gbraid ou wbraid)";
    return "Sim";
  }
  return ehCompra(e) ? "Não: a compra chega sem ligação com um anúncio" : "Não";
}

/** UTM vem cru da URL do visitante ("luminarias+abo", "%C3%A9"). */
export function decodificarUtm(v: string | null): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v.replace(/\+/g, " ")).trim() || null;
  } catch {
    return v;
  }
}

/** "instagram.com · facebook · luminarias-abo", inteira, sem cortar. */
export function textoOrigem(
  e: Pick<EventoFeed, "origem_host" | "utm_source" | "utm_campaign">
): string {
  const partes = [e.origem_host, decodificarUtm(e.utm_source), decodificarUtm(e.utm_campaign)].filter(
    (p): p is string => !!p
  );
  return partes.length ? partes.join(" · ") : "—";
}

/** O pedido no admin da propria Shopify da loja (mesmo link do Ctrl K). */
export function urlDoPedido(dominio: string, pedidoId: string): string | null {
  if (!dominio || !/^\d+$/.test(pedidoId)) return null;
  return `https://${dominio}/admin/orders/${encodeURIComponent(pedidoId)}`;
}

export function chavePedido(storeId: string, pedidoId: string): string {
  return `${storeId}:${pedidoId}`;
}

/**
 * O que o erro gravado quer dizer, em palavras do lojista. No enviado o campo
 * so traz o aviso de "sem clique", que a coluna Clique ja mostra.
 */
export function explicarErro(
  e: Pick<EventoFeed, "status" | "erro" | "plataforma" | "tentativas">
): { resumo: string; mensagem: string | null } | null {
  if (e.status === "enviado") return null;
  const erro = (e.erro || "").trim();
  if (!erro) {
    return e.status === "falhou"
      ? { resumo: `${nomePlataforma(e.plataforma)} não aceitou o evento e o xcart parou de tentar.`, mensagem: null }
      : null;
  }
  const baixo = erro.toLowerCase();
  if (baixo === "destino removido") {
    return { resumo: "O destino deste evento foi removido antes do envio.", mensagem: null };
  }
  if (baixo === "rastreamento desligado para esta loja") {
    return {
      resumo: "O rastreamento desta loja estava desligado quando chegou a vez de enviar.",
      mensagem: null,
    };
  }
  if (baixo.startsWith("linha sem destino")) {
    return {
      resumo:
        "Evento antigo, de antes de cada conta ter o próprio destino. Não dá para saber para qual conta ele ia.",
      mensagem: null,
    };
  }
  const vezes = e.tentativas === 1 ? "1 tentativa" : `${e.tentativas} tentativas`;
  return e.status === "falhou"
    ? { resumo: `${nomePlataforma(e.plataforma)} recusou o evento depois de ${vezes}.`, mensagem: erro }
    : { resumo: "A última tentativa não deu certo. O xcart tenta de novo sozinho.", mensagem: erro };
}

// ---------------------------------------------------------------------------
// Filtros em chip
// ---------------------------------------------------------------------------

export type Dimensao =
  | "status"
  | "evento"
  | "plataforma"
  | "fonte"
  | "destino"
  | "clique"
  | "campanha";
export type Filtro = Record<Dimensao, string[]>;

export const DIMENSOES: { id: Dimensao; rotulo: string }[] = [
  { id: "status", rotulo: "Status" },
  { id: "evento", rotulo: "Evento" },
  { id: "plataforma", rotulo: "Plataforma" },
  { id: "fonte", rotulo: "Veio de" },
  { id: "destino", rotulo: "Destino" },
  { id: "clique", rotulo: "Clique" },
  { id: "campanha", rotulo: "Campanha (UTM)" },
];
const IDS_DIMENSAO = DIMENSOES.map((d) => d.id);

/** Valor das linhas sem campanha / sem destino (tambem vai assim na URL). */
export const NENHUM = "-";

/** Clique: com, sem, ou nao se aplica (destino que nao e Meta nem Google). */
export const ORDEM_CLIQUE = ["sim", "nao"];
const VALORES_CLIQUE = [...ORDEM_CLIQUE, NENHUM];

export function filtroVazio(): Filtro {
  return {
    status: [],
    evento: [],
    plataforma: [],
    fonte: [],
    destino: [],
    clique: [],
    campanha: [],
  };
}

/** O valor da linha naquela dimensao (o que o filtro compara). */
export function valorDe(e: EventoFeed, dim: Dimensao): string {
  switch (dim) {
    case "status":
      return e.status;
    case "evento":
      return chaveDoEvento(e.evento) ?? e.evento;
    case "plataforma":
      return e.plataforma;
    case "fonte":
      return e.fonte;
    case "destino":
      return e.destino_id ?? NENHUM;
    case "clique":
      return e.com_clique === null ? NENHUM : e.com_clique ? "sim" : "nao";
    case "campanha":
      return decodificarUtm(e.utm_campaign) ?? NENHUM;
  }
}

/**
 * A linha passa no filtro? Entre dimensoes vale E; dentro de uma, OU.
 * `ignorar` deixa uma dimensao de fora: e assim que o chip conta quantas
 * linhas cada opcao traria, dado o resto do filtro.
 */
export function passa(e: EventoFeed, f: Filtro, ignorar?: Dimensao): boolean {
  for (const dim of IDS_DIMENSAO) {
    if (dim === ignorar) continue;
    const vals = f[dim];
    if (vals.length && !vals.includes(valorDe(e, dim))) return false;
  }
  return true;
}

export function temFiltro(f: Filtro): boolean {
  return IDS_DIMENSAO.some((d) => f[d].length > 0);
}

export function filtrosIguais(a: Filtro, b: Filtro): boolean {
  return IDS_DIMENSAO.every((d) => {
    const x = [...a[d]].sort();
    const y = [...b[d]].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

export function alternarValor(f: Filtro, dim: Dimensao, valor: string): Filtro {
  const atual = f[dim];
  return {
    ...f,
    [dim]: atual.includes(valor) ? atual.filter((v) => v !== valor) : [...atual, valor],
  };
}

export function contarStatus(eventos: EventoFeed[]): Record<EventoFeed["status"], number> {
  const c = { enviado: 0, pendente: 0, falhou: 0 };
  for (const e of eventos) c[e.status] += 1;
  return c;
}

export interface OpcaoFiltro {
  valor: string;
  rotulo: string;
  /** Quantas linhas carregadas a opcao traria, dado o resto do filtro. */
  n: number;
  marcada: boolean;
}

const MAX_OPCOES = 30;

/** Nome legivel de cada valor que aparece nas linhas (destino precisa delas). */
export function rotuloDoValor(dim: Dimensao, valor: string, eventos: EventoFeed[]): string {
  switch (dim) {
    case "status":
      return STATUS_TELA[valor as EventoFeed["status"]]?.rotulo ?? valor;
    case "evento":
      return nomeDoEvento(valor);
    case "plataforma":
      return nomePlataforma(valor);
    case "fonte":
      return FONTE_TELA[valor as EventoFeed["fonte"]] ?? valor;
    case "destino": {
      if (valor === NENHUM) return "Sem destino";
      const e = eventos.find((x) => x.destino_id === valor);
      if (!e) return "Destino fora das linhas carregadas";
      return `${nomePlataforma(e.plataforma)} · ${e.destino_nome || "sem nome"}`;
    }
    case "clique":
      return valor === "sim" ? "Com clique" : valor === "nao" ? "Sem clique" : "Não se aplica";
    case "campanha":
      return valor === NENHUM ? "Sem campanha" : valor;
  }
}

/**
 * As opcoes de um chip. Status e "veio de" mostram sempre as tres; o resto
 * mostra o que aparece nas linhas carregadas, mais o que ja esta marcado (um
 * filtro vindo da URL nao pode sumir da lista sem poder ser desmarcado).
 */
export function opcoesDe(dim: Dimensao, eventos: EventoFeed[], f: Filtro): OpcaoFiltro[] {
  const contagem = new Map<string, number>();
  const presentes = new Set<string>();
  for (const e of eventos) {
    const v = valorDe(e, dim);
    presentes.add(v);
    if (passa(e, f, dim)) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }

  let valores: string[];
  if (dim === "status") valores = [...ORDEM_STATUS];
  else if (dim === "fonte") valores = [...ORDEM_FONTE];
  else if (dim === "clique") valores = [...ORDEM_CLIQUE, ...(presentes.has(NENHUM) ? [NENHUM] : [])];
  else {
    const vistos = [...presentes];
    if (dim === "evento") {
      const ordem = EVENTOS.map((d) => d.chave as string);
      vistos.sort((a, b) => {
        const ia = ordem.indexOf(a);
        const ib = ordem.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      });
    } else if (dim === "plataforma") {
      const ordem = ["meta", "google"];
      vistos.sort((a, b) => {
        const ia = ordem.indexOf(a);
        const ib = ordem.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      });
    } else {
      // destino e campanha: os que mais aparecem primeiro; "sem ..." no fim
      vistos.sort((a, b) => {
        if (a === NENHUM) return 1;
        if (b === NENHUM) return -1;
        return (contagem.get(b) ?? 0) - (contagem.get(a) ?? 0) || a.localeCompare(b);
      });
    }
    valores = vistos.slice(0, MAX_OPCOES);
  }
  for (const v of f[dim]) if (!valores.includes(v)) valores.push(v);

  return valores.map((valor) => ({
    valor,
    rotulo: rotuloDoValor(dim, valor, eventos),
    n: contagem.get(valor) ?? 0,
    marcada: f[dim].includes(valor),
  }));
}

/** "Status: Falhou, Na fila" ou "+ Status". */
export function rotuloChip(dim: Dimensao, f: Filtro, eventos: EventoFeed[]): string {
  const base = DIMENSOES.find((d) => d.id === dim)?.rotulo ?? dim;
  const vals = f[dim];
  if (!vals.length) return `+ ${base}`;
  const nomes = vals.map((v) => rotuloDoValor(dim, v, eventos));
  return nomes.length > 2
    ? `${base}: ${nomes.slice(0, 2).join(", ")} +${nomes.length - 2}`
    : `${base}: ${nomes.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Filtro na URL: link de outra tela abre ja filtrado (Alertas -> falhas)
// ---------------------------------------------------------------------------

type ParamsUrl = Record<string, string | string[] | undefined> | URLSearchParams;

const MAX_VALORES = 20;
const MAX_TEXTO = 120;

function valoresDoParam(p: ParamsUrl, chave: string): string[] {
  const crus =
    p instanceof URLSearchParams
      ? p.getAll(chave)
      : ([] as string[]).concat(p[chave] ?? []);
  const limpos = crus.map((v) => String(v).trim()).filter((v) => v && v.length <= MAX_TEXTO);
  return [...new Set(limpos)].slice(0, MAX_VALORES);
}

/** Le o filtro da URL. Valor fora do conjunto conhecido e ignorado, nunca erro. */
export function filtroDaUrl(p: ParamsUrl): Filtro {
  const f = filtroVazio();
  f.status = valoresDoParam(p, "status").filter((v) => (ORDEM_STATUS as string[]).includes(v));
  f.fonte = valoresDoParam(p, "fonte").filter((v) => (ORDEM_FONTE as string[]).includes(v));
  f.evento = valoresDoParam(p, "evento").map((v) => chaveDoEvento(v) ?? v);
  f.plataforma = valoresDoParam(p, "plataforma").map((v) => v.toLowerCase());
  f.destino = valoresDoParam(p, "destino");
  f.clique = valoresDoParam(p, "clique").filter((v) => VALORES_CLIQUE.includes(v));
  f.campanha = valoresDoParam(p, "campanha");
  return f;
}

/** O filtro como query string ("status=falhou&evento=purchase"), sem "?". */
export function filtroParaQuery(f: Filtro): string {
  const p = new URLSearchParams();
  for (const dim of IDS_DIMENSAO) for (const v of f[dim]) p.append(dim, v);
  return p.toString();
}

// ---------------------------------------------------------------------------
// Visoes salvas (no navegador)
// ---------------------------------------------------------------------------

export interface Visao {
  id: string;
  nome: string;
  filtro: Filtro;
}

export const CHAVE_VISOES = "xcart:eventos:visoes";
export const MAX_VISOES = 8;
export const MAX_NOME_VISAO = 40;
/** Quando o filtro da tela nao bate com nenhuma visao. */
export const VISAO_ATUAL = "atual";

export const VISOES_FIXAS: Visao[] = [
  { id: "todos", nome: "Todos", filtro: filtroVazio() },
  { id: "falhas", nome: "Só falhas", filtro: { ...filtroVazio(), status: ["falhou"] } },
  { id: "compras", nome: "Só compras", filtro: { ...filtroVazio(), evento: ["purchase"] } },
];

/** Qual visao o filtro atual e. Nenhuma = VISAO_ATUAL ("Filtro atual, não salvo"). */
export function visaoAtiva(f: Filtro, salvas: Visao[]): string {
  const achada = [...VISOES_FIXAS, ...salvas].find((v) => filtrosIguais(v.filtro, f));
  return achada ? achada.id : VISAO_ATUAL;
}

function filtroDeObjeto(bruto: unknown): Filtro | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const p: Record<string, string[]> = {};
  for (const dim of IDS_DIMENSAO) {
    const v = o[dim];
    p[dim] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  }
  return filtroDaUrl(p);
}

/** localStorage cru -> visoes validas. Lixo vira lista vazia, nunca erro. */
export function lerVisoesSalvas(texto: string | null): Visao[] {
  if (!texto) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(bruto)) return [];
  const saida: Visao[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const { id, nome, filtro } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof nome !== "string" || !nome.trim()) continue;
    if (VISOES_FIXAS.some((v) => v.id === id) || id === VISAO_ATUAL) continue;
    if (saida.some((v) => v.id === id)) continue;
    const f = filtroDeObjeto(filtro);
    if (!f || !temFiltro(f)) continue;
    saida.push({ id, nome: nome.trim().slice(0, MAX_NOME_VISAO), filtro: f });
    if (saida.length >= MAX_VISOES) break;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// CSV (so as colunas da tabela: nada de IP, navegador ou payload)
// ---------------------------------------------------------------------------

/**
 * Um campo do CSV. Aspas quando precisa, e apostrofo na frente do que o Excel
 * leria como formula: UTM e origem vem da URL do VISITANTE, e "=HYPERLINK(...)"
 * numa campanha viraria formula na planilha do lojista.
 */
export function campoCsv(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function montarCsv(
  eventos: EventoFeed[],
  ctx: {
    fuso: string;
    nomeLoja: (storeId: string) => string;
    nomePedido: (e: EventoFeed) => string;
  }
): string {
  const cabecalho = [
    "Data e hora",
    "Loja",
    "Evento",
    "Veio de",
    "Plataforma",
    "Destino",
    "Status",
    "Latência (s)",
    "Clique",
    "Teste",
    "Origem",
    "Pedido",
  ];
  const linhas = [cabecalho.join(";")];
  for (const e of eventos) {
    const latencia =
      e.status === "enviado" && e.latencia_s !== null ? decimal(e.latencia_s, 1) : "";
    linhas.push(
      [
        dataHoraCompleta(e.criado_em, ctx.fuso).replace(" às ", " "),
        ctx.nomeLoja(e.store_id),
        nomeDoEvento(e.evento),
        FONTE_TELA[e.fonte],
        nomePlataforma(e.plataforma),
        e.destino_nome ?? "",
        STATUS_TELA[e.status].rotulo,
        latencia,
        textoClique(e) === "—" ? "" : textoClique(e),
        ehTeste(e) ? "Sim" : "",
        textoOrigem(e) === "—" ? "" : textoOrigem(e),
        e.pedido ? ctx.nomePedido(e) : "",
      ]
        .map(campoCsv)
        .join(";")
    );
  }
  // CRLF e BOM (quem baixa poe o BOM): o Excel em portugues abre direto.
  return linhas.join("\r\n") + "\r\n";
}
