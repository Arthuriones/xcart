import { formatarDinheiro } from "@/lib/financeiro/tipos";
import { avisoDeMoeda, lerCarrinhoLevado } from "@/lib/checkout-routes/carrinho-levado";

// ============================================================================
// Regras puras da tela Atividade: o que cada linha do banco vira na linha do
// tempo, como as fontes se juntam numa pagina e o cursor da proxima.
//
// Sem "server-only" e sem I/O: o servidor (atividade.ts) le e chama daqui, e
// o vitest testa sem banco.
//
// Nao existe tabela de log. Cada evento sai de algo que ja ficou registrado:
// loja criada, rota e destino criados, carrinho que o script da vitrine
// avisou, importacao, alerta aberto ou resolvido, envio de conversao ligado e
// compra de creditos. E menos do que um log dedicado daria, mas e verdade.
// ============================================================================

export type TipoAtividade =
  | "loja"
  | "importacao"
  | "alerta"
  | "rastreamento"
  | "creditos"
  | "rota"
  | "carrinho";

export type TomAtividade = "ok" | "warn" | "err" | "info" | "neutral" | "run";

export interface SeloAtividade {
  tom: TomAtividade;
  texto: string;
}

export interface EventoAtividade {
  id: string;
  tipo: TipoAtividade;
  /** Cor do icone. Nunca sozinha: o titulo e o selo dizem o mesmo em palavra. */
  tom: TomAtividade;
  /** Estado que nao e "deu certo" (Falhou, Na fila, Crítico...). Sucesso nao leva selo. */
  selo: SeloAtividade | null;
  titulo: string;
  descricao: string;
  /** Loja ligada ao evento; null = evento da conta (créditos, alerta geral). */
  loja: string | null;
  /** Instante cru do banco: ordena e serve de cursor. */
  at: string;
  /** Para onde a linha leva. */
  href: string;
  /** O destino em palavras, para o leitor de tela. */
  destino: string;
}

export interface OpcaoTipo {
  id: TipoAtividade;
  /** Palavra do tipo na linha. */
  rotulo: string;
  /** Nome no filtro. */
  filtro: string;
  /** Lista vazia com este filtro: "Nenhum alerta". */
  nenhum: string;
  /** So aparece para quem tem rota (roteamento e modulo). */
  soComRota?: boolean;
  /** Evento da conta, sem loja: some com o filtro de loja. */
  daConta?: boolean;
}

export const TIPOS: readonly OpcaoTipo[] = [
  { id: "loja", rotulo: "Loja", filtro: "Lojas", nenhum: "Nenhuma loja conectada" },
  { id: "importacao", rotulo: "Importação", filtro: "Importações", nenhum: "Nenhuma importação" },
  { id: "alerta", rotulo: "Alerta", filtro: "Alertas", nenhum: "Nenhum alerta" },
  { id: "rastreamento", rotulo: "Rastreamento", filtro: "Rastreamento", nenhum: "Nenhum envio de compras ligado" },
  { id: "creditos", rotulo: "Créditos e plano", filtro: "Créditos e plano", nenhum: "Nenhuma compra de créditos", daConta: true },
  { id: "rota", rotulo: "Rota", filtro: "Rotas", nenhum: "Nenhuma rota criada", soComRota: true },
  { id: "carrinho", rotulo: "Carrinho", filtro: "Carrinhos", nenhum: "Nenhum carrinho registrado", soComRota: true },
];

const TIPO_POR_ID = new Map(TIPOS.map((t) => [t.id, t]));

export function opcaoTipo(tipo: TipoAtividade): OpcaoTipo {
  return TIPO_POR_ID.get(tipo)!;
}

/** ?tipo= da URL: so um dos tipos conhecidos; o resto vira "todos" (null). */
export function tipoDe(valor: string | null | undefined): TipoAtividade | null {
  return valor && TIPO_POR_ID.has(valor as TipoAtividade) ? (valor as TipoAtividade) : null;
}

/** Tipos que o filtro oferece: sem rota, Rotas e Carrinhos nao aparecem. */
export function tiposVisiveis(temRota: boolean): OpcaoTipo[] {
  return TIPOS.filter((t) => temRota || !t.soComRota);
}

/** Itens por pagina. */
export const LIMITE_PAGINA = 50;

/** O registro do script da vitrine apaga carrinho com mais de 180 dias. */
export const DIAS_CARRINHO = 180;

/**
 * Cursor ?antes= aceito: so um instante ISO bem formado. Vai para o filtro do
 * banco, entao nada de texto livre.
 */
export function cursorDe(valor: string | null | undefined): string | null {
  if (!valor || valor.length > 40) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(valor)) {
    return null;
  }
  return Number.isFinite(Date.parse(valor)) ? valor : null;
}

// ---------------------------------------------------------------------------
// Linhas cruas do banco (so as colunas lidas)
// ---------------------------------------------------------------------------

export interface LinhaLoja {
  id: string;
  name: string | null;
  shop_domain: string | null;
  created_at: string;
}

export interface LinhaRota {
  id: string;
  source_store_id: string | null;
  target_store_id: string | null;
  created_at: string;
}

export interface LinhaDestino {
  id: string;
  route_id: string;
  target_store_id: string | null;
  created_at: string;
}

export interface LinhaCarrinho {
  id: string;
  route_config_id: string | null;
  target_id: string | null;
  reason: string;
  detail: string | null;
  created_at: string;
}

export interface LinhaClone {
  id: string;
  source_domain: string | null;
  target_store_id: string | null;
  action: string;
  status: string;
  product_count: number | null;
  created_at: string;
}

export interface LinhaJob {
  id: string;
  store_id: string | null;
  status: string;
  origem: string | null;
  created_at: string;
}

export interface LinhaAlerta {
  id: string;
  store_id: string | null;
  severidade: string;
  titulo: string | null;
  aberto_em: string;
  resolvido_em: string | null;
}

export interface LinhaRastreamento {
  id: string;
  store_id: string | null;
  plataforma: string;
  nome: string | null;
  ativo: boolean | null;
  created_at: string;
}

export interface LinhaCompra {
  id: string;
  kind: string | null;
  status: string | null;
  method: string | null;
  credits: number | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
}

/** O que a pagina leu. Fonte que nao entrou na leitura fica vazia. */
export interface Fontes {
  lojas: LinhaLoja[];
  rotas: LinhaRota[];
  destinos: LinhaDestino[];
  carrinhos: LinhaCarrinho[];
  clones: LinhaClone[];
  jobs: LinhaJob[];
  alertasAbertos: LinhaAlerta[];
  alertasResolvidos: LinhaAlerta[];
  rastreamento: LinhaRastreamento[];
  compras: LinhaCompra[];
}

export function fontesVazias(): Fontes {
  return {
    lojas: [],
    rotas: [],
    destinos: [],
    carrinhos: [],
    clones: [],
    jobs: [],
    alertasAbertos: [],
    alertasResolvidos: [],
    rastreamento: [],
    compras: [],
  };
}

/** Nomes e ligacoes que os eventos precisam, lidos de TODAS as rotas e lojas. */
export interface Contexto {
  /** id da loja -> nome. */
  nomes: Map<string, string>;
  /** id da rota -> loja vitrine. */
  vitrineDaRota: Map<string, string | null>;
  /** id do destino (routed_checkout_targets) -> loja de checkout. */
  lojaDoDestino: Map<string, string | null>;
  /** dominio .myshopify.com (minusculo) -> nome da loja. */
  nomePorDominio: Map<string, string>;
}

export function montarContexto(
  lojas: { id: string; nome: string; dominio?: string }[],
  rotas: LinhaRota[],
  destinos: LinhaDestino[]
): Contexto {
  return {
    nomes: new Map(lojas.map((l) => [l.id, l.nome])),
    vitrineDaRota: new Map(rotas.map((r) => [r.id, r.source_store_id])),
    lojaDoDestino: new Map(destinos.map((d) => [d.id, d.target_store_id])),
    nomePorDominio: new Map(
      lojas.filter((l) => l.dominio).map((l) => [String(l.dominio).toLowerCase(), l.nome])
    ),
  };
}

// ---------------------------------------------------------------------------
// Filtro de loja nas rotas
// ---------------------------------------------------------------------------

/**
 * Rotas que tocam a loja: ela e a vitrine, a loja de checkout principal ou
 * um dos destinos do rodizio. Os carrinhos da loja sao os dessas rotas.
 */
export function rotasDaLoja(rotas: LinhaRota[], destinos: LinhaDestino[], lojaId: string): Set<string> {
  const ids = new Set<string>();
  for (const r of rotas) {
    if (r.source_store_id === lojaId || r.target_store_id === lojaId) ids.add(r.id);
  }
  for (const d of destinos) {
    if (d.target_store_id === lojaId) ids.add(d.route_id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Linha do banco -> evento
// ---------------------------------------------------------------------------

/** Endereco de uma rota no console (o console abre a rota e a aba pela URL). */
export function hrefRota(rotaId: string, aba?: "diagnostico"): string {
  const p = new URLSearchParams({ rota: rotaId });
  if (aba) p.set("aba", aba);
  return `/clone/routed-checkout?${p.toString()}`;
}

/** "loja.myshopify.com" -> "loja"; outro dominio fica como esta. */
export function dominioCurto(dominio: string | null | undefined): string {
  return String(dominio || "").replace(/\.myshopify\.com$/i, "");
}

/** Link de origem de uma importacao em lote, curto: "aliexpress.com/item/100…". */
export function origemCurta(origem: string | null | undefined, max = 48): string {
  const bruto = String(origem || "").trim();
  if (!bruto) return "um link";
  let texto = bruto;
  try {
    const u = new URL(bruto);
    texto = u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    // Texto que nao e URL (ex.: id de produto): fica como veio.
  }
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

function produtos(n: number | null | undefined): string {
  const v = Math.max(0, Number(n) || 0);
  return v === 1 ? "1 produto" : `${v} produtos`;
}

function nomeOuNull(ctx: Contexto, id: string | null | undefined): string | null {
  return id ? (ctx.nomes.get(id) ?? null) : null;
}

/**
 * "3 itens -> loja.myshopify.com [moeda=EUR pais=US]" -> partes. O formato
 * (e o sufixo de moeda) mora em lib/checkout-routes/carrinho-levado.ts.
 */
export { lerCarrinhoLevado };

function itensTexto(n: number): string {
  return n === 1 ? "1 item" : `${n} itens`;
}

const SELO = {
  falhou: { tom: "err", texto: "Falhou" },
  atencao: { tom: "warn", texto: "Atenção" },
  naFila: { tom: "neutral", texto: "Na fila" },
  rodando: { tom: "run", texto: "Rodando" },
  critico: { tom: "err", texto: "Crítico" },
  aviso: { tom: "warn", texto: "Aviso" },
  desativado: { tom: "neutral", texto: "Desativado" },
  semConfirmacao: { tom: "neutral", texto: "Sem confirmação" },
  naoPago: { tom: "warn", texto: "Não pago" },
  devolvido: { tom: "warn", texto: "Devolvido" },
} as const satisfies Record<string, SeloAtividade>;

function eventoLoja(l: LinhaLoja, ctx: Contexto): EventoAtividade {
  const nome = ctx.nomes.get(l.id) ?? (l.name || dominioCurto(l.shop_domain) || "Loja");
  return {
    id: `loja-${l.id}`,
    tipo: "loja",
    tom: "ok",
    selo: null,
    titulo: "Loja conectada",
    descricao: `${dominioCurto(l.shop_domain) || nome} entrou no xcart.`,
    loja: nome,
    at: l.created_at,
    href: `/stores/${l.id}`,
    destino: `Abrir a loja ${nome}`,
  };
}

function eventoRota(r: LinhaRota, ctx: Contexto): EventoAtividade {
  const vitrine = nomeOuNull(ctx, r.source_store_id);
  return {
    id: `rota-${r.id}`,
    tipo: "rota",
    tom: "ok",
    selo: null,
    titulo: "Rota criada",
    descricao: vitrine
      ? `A vitrine ${vitrine} passou a levar o carrinho para a loja de checkout.`
      : "Uma vitrine passou a levar o carrinho para a loja de checkout.",
    loja: vitrine,
    at: r.created_at,
    href: hrefRota(r.id),
    destino: "Abrir a rota",
  };
}

function eventoDestino(d: LinhaDestino, ctx: Contexto): EventoAtividade {
  const alvo = nomeOuNull(ctx, d.target_store_id);
  const vitrine = nomeOuNull(ctx, ctx.vitrineDaRota.get(d.route_id) ?? null);
  return {
    id: `destino-${d.id}`,
    tipo: "rota",
    tom: "ok",
    selo: null,
    titulo: "Loja de checkout entrou no rodízio",
    descricao: `${alvo ?? "Uma loja"} passou a receber compradores${vitrine ? ` da vitrine ${vitrine}` : ""}.`,
    loja: alvo,
    at: d.created_at,
    href: hrefRota(d.route_id),
    destino: "Abrir a rota",
  };
}

/** Os avisos do script da vitrine que viram linha. O resto (presença) e ruido. */
export const MOTIVOS_CARRINHO = [
  "routed_ok",
  "cart_checkout_error",
  "bypass_form_submit",
  "bypass_link",
] as const;

function eventoCarrinho(c: LinhaCarrinho, ctx: Contexto): EventoAtividade | null {
  const rotaId = c.route_config_id;
  if (!rotaId) return null;
  const vitrine = nomeOuNull(ctx, ctx.vitrineDaRota.get(rotaId) ?? null);
  const naVitrine = vitrine ? ` na vitrine ${vitrine}` : " na vitrine";
  const base = {
    id: `carrinho-${c.id}`,
    tipo: "carrinho" as const,
    loja: vitrine,
    at: c.created_at,
  };

  switch (c.reason) {
    case "routed_ok": {
      const lido = lerCarrinhoLevado(c.detail);
      // Script antigo nao grava o destino: o dominio do aviso acha a loja.
      const alvo =
        nomeOuNull(ctx, c.target_id ? (ctx.lojaDoDestino.get(c.target_id) ?? null) : null) ??
        (lido.dominio
          ? (ctx.nomePorDominio.get(lido.dominio.toLowerCase()) ?? dominioCurto(lido.dominio))
          : null);
      const deOnde = vitrine ? ` da vitrine ${vitrine}` : "";
      const para = alvo ?? "a loja de checkout";
      const n = lido.itens && lido.itens > 0 ? lido.itens : null;
      return {
        ...base,
        tom: "ok",
        selo: null,
        titulo: "Carrinho levado ao checkout",
        descricao:
          (n
            ? `${itensTexto(n)}${deOnde} ${n === 1 ? "foi" : "foram"} para ${para}.`
            : `O carrinho${deOnde} foi para ${para}.`) + avisoDeMoeda(c.detail),
        href: hrefRota(rotaId),
        destino: "Abrir a rota",
      };
    }
    case "cart_checkout_error":
      return {
        ...base,
        tom: "err",
        selo: SELO.falhou,
        titulo: "Carrinho não chegou ao checkout",
        descricao: `O comprador clicou em finalizar${naVitrine} e não foi levado à loja de checkout.`,
        href: hrefRota(rotaId, "diagnostico"),
        destino: "Abrir o diagnóstico da rota",
      };
    case "bypass_form_submit":
      return {
        ...base,
        tom: "warn",
        selo: SELO.atencao,
        titulo: "Checkout escapou da rota",
        descricao: `O comprador foi ao checkout da própria vitrine${vitrine ? ` ${vitrine}` : ""}, que não cobra.`,
        href: hrefRota(rotaId, "diagnostico"),
        destino: "Abrir o diagnóstico da rota",
      };
    case "bypass_link":
      return {
        ...base,
        tom: "warn",
        selo: SELO.atencao,
        titulo: "Checkout escapou por um link",
        descricao: `Um link${naVitrine} levou direto ao checkout dela, que não cobra.`,
        href: hrefRota(rotaId, "diagnostico"),
        destino: "Abrir o diagnóstico da rota",
      };
    default:
      return null;
  }
}

function eventoClone(c: LinhaClone, ctx: Contexto): EventoAtividade {
  const origem = c.source_domain || "outra loja";
  const loja = nomeOuNull(ctx, c.target_store_id);
  const comum = {
    id: `clone-${c.id}`,
    tipo: "importacao" as const,
    loja,
    at: c.created_at,
    href: "/clone",
    destino: "Abrir o Importar",
  };
  if (c.status === "failed") {
    return {
      ...comum,
      tom: "err",
      selo: SELO.falhou,
      titulo: "Importação falhou",
      descricao: `A importação de ${origem} não terminou.`,
    };
  }
  switch (c.action) {
    case "apply":
      return {
        ...comum,
        tom: "ok",
        selo: null,
        titulo: "Importação concluída",
        descricao: `${produtos(c.product_count)} de ${origem}${loja ? ` para ${loja}` : ""}.`,
      };
    case "preview":
      return {
        ...comum,
        tom: "info",
        selo: null,
        titulo: "Catálogo lido para importar",
        descricao: `${produtos(c.product_count)} encontrados em ${origem}.`,
      };
    case "export-json":
    case "export-csv":
      return {
        ...comum,
        tom: "info",
        selo: null,
        titulo: `Catálogo exportado em ${c.action === "export-csv" ? "CSV" : "JSON"}`,
        descricao: `${produtos(c.product_count)} de ${origem}.`,
      };
    default:
      return { ...comum, tom: "info", selo: null, titulo: "Importação", descricao: `Produtos de ${origem}.` };
  }
}

function eventoJob(j: LinhaJob, ctx: Contexto): EventoAtividade {
  const loja = nomeOuNull(ctx, j.store_id);
  const descricao = `${origemCurta(j.origem)}${loja ? ` para ${loja}` : ""}.`;
  const comum = {
    id: `lote-${j.id}`,
    tipo: "importacao" as const,
    loja,
    at: j.created_at,
    descricao,
    href: "/bulk",
    destino: "Abrir a fila de importação",
  };
  switch (j.status) {
    case "completed":
      return { ...comum, tom: "ok", selo: null, titulo: "Importação em lote concluída" };
    case "failed":
      return { ...comum, tom: "err", selo: SELO.falhou, titulo: "Importação em lote falhou" };
    case "processing":
      return { ...comum, tom: "run", selo: SELO.rodando, titulo: "Importação em lote rodando" };
    default:
      return { ...comum, tom: "neutral", selo: SELO.naFila, titulo: "Importação em lote na fila" };
  }
}

function eventoAlertaAberto(a: LinhaAlerta, ctx: Contexto): EventoAtividade {
  const critico = a.severidade === "critico";
  const loja = nomeOuNull(ctx, a.store_id);
  return {
    id: `alerta-${a.id}`,
    tipo: "alerta",
    tom: critico ? "err" : "warn",
    selo: critico ? SELO.critico : SELO.aviso,
    titulo: "Alerta aberto",
    descricao: a.titulo || "Um alerta abriu.",
    loja,
    at: a.aberto_em,
    href: a.resolvido_em ? "/alertas?aba=resolvidos" : "/alertas",
    destino: a.resolvido_em ? "Abrir os alertas resolvidos" : "Abrir os alertas",
  };
}

function eventoAlertaResolvido(a: LinhaAlerta, ctx: Contexto): EventoAtividade | null {
  if (!a.resolvido_em) return null;
  return {
    id: `alerta-fim-${a.id}`,
    tipo: "alerta",
    tom: "ok",
    selo: null,
    titulo: "Alerta resolvido",
    descricao: a.titulo || "Um alerta fechou.",
    loja: nomeOuNull(ctx, a.store_id),
    at: a.resolvido_em,
    href: "/alertas?aba=resolvidos",
    destino: "Abrir os alertas resolvidos",
  };
}

function eventoRastreamento(r: LinhaRastreamento, ctx: Contexto): EventoAtividade {
  const loja = nomeOuNull(ctx, r.store_id);
  const plataforma = r.plataforma === "google" ? "Google Ads" : r.plataforma === "tiktok" ? "TikTok" : "Meta";
  const apelido = r.nome?.trim() ? ` (${r.nome.trim()})` : "";
  return {
    id: `rastreamento-${r.id}`,
    tipo: "rastreamento",
    tom: r.ativo === false ? "neutral" : "ok",
    selo: r.ativo === false ? SELO.desativado : null,
    titulo: `Envio de compras para o ${plataforma} ligado`,
    descricao: `As compras ${loja ? `de ${loja}` : "da loja"} passaram a ir para o ${plataforma}${apelido}.`,
    loja,
    at: r.created_at,
    href: r.store_id ? `/stores/${r.store_id}?aba=rastreamento` : "/tracking",
    destino: "Abrir o rastreamento da loja",
  };
}

function eventoCompra(c: LinhaCompra): EventoAtividade {
  const valor =
    c.amount_cents == null
      ? null
      : formatarDinheiro(c.amount_cents / 100, String(c.currency || "brl").toUpperCase());
  const pix = c.method === "pix";
  const plano = c.kind === "pro_month";
  const creditos = Math.max(0, Number(c.credits) || 0);
  const oque = plano ? "Plano Pro" : creditos === 1 ? "1 crédito" : `${creditos} créditos`;
  const preco = valor ? ` por ${valor}` : "";
  const comum = {
    id: `compra-${c.id}`,
    tipo: "creditos" as const,
    loja: null,
    at: c.created_at,
    href: "/billing",
    destino: "Abrir Assinatura e créditos",
  };
  switch (c.status) {
    case "paid":
      return {
        ...comum,
        tom: "ok",
        selo: null,
        titulo: plano ? "Plano Pro pago" : "Créditos comprados",
        descricao: `${oque}${preco}${pix ? ", pago por Pix" : ""}.`,
      };
    case "refused":
      return {
        ...comum,
        tom: "warn",
        selo: SELO.naoPago,
        titulo: "Pagamento recusado",
        descricao: `${oque}${preco}.`,
      };
    case "canceled":
    case "expired":
      return {
        ...comum,
        tom: "warn",
        selo: SELO.naoPago,
        titulo: pix ? "Pix não pago" : "Pagamento não concluído",
        descricao: `${oque}${preco}.`,
      };
    case "refunded":
    case "chargedback":
      return {
        ...comum,
        tom: "warn",
        selo: SELO.devolvido,
        titulo: "Pagamento devolvido",
        descricao: `${oque}${preco}.`,
      };
    default:
      return {
        ...comum,
        tom: "neutral",
        selo: SELO.semConfirmacao,
        titulo: pix ? "Pix gerado" : "Compra iniciada",
        descricao: `${oque}${preco}. O pagamento não foi confirmado.`,
      };
  }
}

/** Todas as linhas lidas viram eventos (ainda sem ordem nem corte). */
export function montarEventos(f: Fontes, ctx: Contexto): EventoAtividade[] {
  const saida: EventoAtividade[] = [];
  for (const l of f.lojas) saida.push(eventoLoja(l, ctx));
  for (const r of f.rotas) saida.push(eventoRota(r, ctx));
  for (const d of f.destinos) saida.push(eventoDestino(d, ctx));
  for (const c of f.carrinhos) {
    const e = eventoCarrinho(c, ctx);
    if (e) saida.push(e);
  }
  for (const c of f.clones) saida.push(eventoClone(c, ctx));
  for (const j of f.jobs) saida.push(eventoJob(j, ctx));
  for (const a of f.alertasAbertos) saida.push(eventoAlertaAberto(a, ctx));
  for (const a of f.alertasResolvidos) {
    const e = eventoAlertaResolvido(a, ctx);
    if (e) saida.push(e);
  }
  for (const r of f.rastreamento) saida.push(eventoRastreamento(r, ctx));
  for (const c of f.compras) saida.push(eventoCompra(c));
  return saida;
}

// ---------------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------------

function instante(at: string): number {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

/** Mais recente primeiro; empate decidido pelo id, para a ordem nao variar. */
export function ordenar(eventos: EventoAtividade[]): EventoAtividade[] {
  return [...eventos].sort((a, b) => instante(b.at) - instante(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Junta as fontes numa pagina. Cada fonte do banco veio com no maximo
 * `limite` linhas ate o cursor; o topo da juncao e o topo de verdade, porque
 * qualquer evento entre os `limite` mais recentes esta entre os `limite` mais
 * recentes da propria fonte.
 *
 * Proxima pagina: o instante do ultimo evento mostrado. O banco le "ate este
 * instante, inclusive" (lote de importacao grava varias linhas no mesmo
 * instante), e quem junta as paginas tira o repetido pelo id.
 */
export function paginar(
  eventos: EventoAtividade[],
  limite: number,
  algumaFonteCheia: boolean
): { itens: EventoAtividade[]; proximo: string | null } {
  const ordem = ordenar(eventos);
  const itens = ordem.slice(0, limite);
  const temMais = ordem.length > limite || algumaFonteCheia;
  return { itens, proximo: temMais && itens.length > 0 ? itens[itens.length - 1].at : null };
}

/** Acrescenta a pagina nova sem repetir o que ja esta na tela. */
export function juntarPaginas(atuais: EventoAtividade[], novos: EventoAtividade[]): EventoAtividade[] {
  const vistos = new Set(atuais.map((e) => e.id));
  return [...atuais, ...novos.filter((e) => !vistos.has(e.id))];
}

/** Dentro do cursor? (as fontes lidas inteiras, como rotas, filtram aqui). */
export function ateOCursor(at: string, antes: string | null): boolean {
  return !antes || instante(at) <= instante(antes);
}
