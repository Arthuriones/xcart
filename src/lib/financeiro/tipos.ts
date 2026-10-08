// ============================================================================
// Contratos da reformulacao financeira (migration 052).
//
// Importado pelo SERVIDOR e pelo CLIENTE: nada de "server-only", I/O ou
// process.env aqui. So tipos, constantes e funcoes puras.
//
// Os pacotes da reformulacao foram escritos em paralelo contra este texto.
// Acrescente; nao renomeie nem mude assinatura sem conferir quem usa.
// ============================================================================

export type Plataforma = "meta" | "google";

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export const ROTAS = {
  lucro: "/financeiro",
  custos: "/financeiro/custos",
  anuncios: "/financeiro/anuncios",
  eventos: "/tracking/eventos",
  alertas: "/alertas",
  apiSyncPedidos: "/api/jobs/financeiro/pedidos",
  apiSyncCambio: "/api/jobs/financeiro/cambio",
  apiSyncMeta: "/api/jobs/ads/meta",
  apiJobAlertas: "/api/jobs/alertas",
  apiMetaConectar: "/api/ads/meta/conectar",
  apiGoogleContas: "/api/ads/google/contas",
  apiGoogleIngest: "/api/ads/google/ingest",
  apiContas: "/api/ads/contas",
  apiCustos: "/api/financeiro/custos",
  apiConfigFinanceira: "/api/financeiro/config",
  apiEventos: "/api/tracking/eventos",
  apiAlertasCanal: "/api/alertas/canal",
  apiAlertas: "/api/alertas",
} as const;

/**
 * Versao da Graph/Marketing API usada para LER gasto (Insights).
 * O CAPI (src/lib/tracking/meta-capi.ts) ainda usa a dele; unificar e outro passo.
 */
export const META_GRAPH_VERSAO = "v25.0";

// ---------------------------------------------------------------------------
// Filtro global: loja, periodo e moeda, guardados em cookie
// ---------------------------------------------------------------------------

export const COOKIE_LOJA = "xc_loja";
export const COOKIE_PERIODO = "xc_periodo";
export const COOKIE_MOEDA = "xc_moeda";

export const TODAS = "todas";

export type PeriodoId = "hoje" | "ontem" | "7d" | "30d" | "mes" | "mes_passado";

export const PERIODOS: { id: PeriodoId; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "ontem", rotulo: "Ontem" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
];

export const PERIODO_PADRAO: PeriodoId = "7d";

export type MoedaRelatorio = "BRL" | "USD" | "EUR";
export const MOEDAS_RELATORIO: MoedaRelatorio[] = ["BRL", "USD", "EUR"];
export const MOEDA_PADRAO: MoedaRelatorio = "BRL";

/** Fuso do "hoje" quando o filtro e "todas as lojas". */
export const FUSO_RELATORIO_PADRAO = "America/Sao_Paulo";

export interface FiltroGlobal {
  /** TODAS ou o uuid de uma loja. NAO conferido: quem usa filtra pelas lojas do usuario. */
  lojaId: string;
  periodo: PeriodoId;
  moeda: MoedaRelatorio;
}

export interface LojaDoSeletor {
  id: string;
  /** stores.name e velho em algumas lojas: mostre sempre junto do dominio. */
  nome: string;
  dominio: string;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RE_MOEDA = /^[A-Z]{3}$/;
export const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

export function ehUuid(v: unknown): v is string {
  return typeof v === "string" && RE_UUID.test(v);
}

/** Cookies crus -> filtro valido. Lixo vira o padrao, nunca erro. */
export function filtroDeCookies(v: {
  loja?: string | null;
  periodo?: string | null;
  moeda?: string | null;
}): FiltroGlobal {
  const loja = v.loja;
  const periodo = PERIODOS.find((p) => p.id === v.periodo)?.id ?? PERIODO_PADRAO;
  const moeda = MOEDAS_RELATORIO.find((m) => m === v.moeda) ?? MOEDA_PADRAO;
  return { lojaId: ehUuid(loja) ? loja.toLowerCase() : TODAS, periodo, moeda };
}

/**
 * Linha para `document.cookie`. Preferencia de tela, nao segredo: sem HttpOnly
 * de proposito, porque quem grava e o seletor, no navegador.
 */
export function linhaDeCookie(nome: string, valor: string): string {
  return `${nome}=${encodeURIComponent(valor)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Datas (sempre "AAAA-MM-DD", calendario)
// ---------------------------------------------------------------------------

export interface Intervalo {
  /** Inclusive. */
  desde: string;
  /** Inclusive. */
  ate: string;
}

/** "AAAA-MM-DD" do instante no fuso IANA. Fuso vazio ou invalido cai em UTC. */
export function diaNoFuso(instante: Date, fuso?: string | null): string {
  const montar = (tz: string) => {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instante);
    const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
    return `${parte("year")}-${parte("month")}-${parte("day")}`;
  };
  try {
    return montar(fuso || "UTC");
  } catch {
    return montar("UTC");
  }
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Quantos dias de calendario, contando as duas pontas. */
export function diasNoIntervalo(i: Intervalo): number {
  const a = Date.parse(`${i.desde}T00:00:00Z`);
  const b = Date.parse(`${i.ate}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

/** Todos os dias do intervalo, em ordem crescente. */
export function diasDoIntervalo(i: Intervalo): string[] {
  const n = diasNoIntervalo(i);
  const saida: string[] = [];
  for (let k = 0; k < n; k += 1) saida.push(somarDias(i.desde, k));
  return saida;
}

/**
 * Periodo -> intervalo atual e o anterior, de mesmo tamanho, para comparar.
 * `hoje` ja vem no fuso certo (diaNoFuso).
 */
export function intervaloDoPeriodo(
  periodo: PeriodoId,
  hoje: string
): { atual: Intervalo; anterior: Intervalo } {
  const primeiroDoMes = (dia: string) => `${dia.slice(0, 7)}-01`;
  switch (periodo) {
    case "hoje":
      return {
        atual: { desde: hoje, ate: hoje },
        anterior: { desde: somarDias(hoje, -1), ate: somarDias(hoje, -1) },
      };
    case "ontem":
      return {
        atual: { desde: somarDias(hoje, -1), ate: somarDias(hoje, -1) },
        anterior: { desde: somarDias(hoje, -2), ate: somarDias(hoje, -2) },
      };
    case "7d":
      return {
        atual: { desde: somarDias(hoje, -6), ate: hoje },
        anterior: { desde: somarDias(hoje, -13), ate: somarDias(hoje, -7) },
      };
    case "30d":
      return {
        atual: { desde: somarDias(hoje, -29), ate: hoje },
        anterior: { desde: somarDias(hoje, -59), ate: somarDias(hoje, -30) },
      };
    case "mes": {
      const inicio = primeiroDoMes(hoje);
      const fimAnterior = somarDias(inicio, -1);
      const inicioAnterior = primeiroDoMes(fimAnterior);
      const n = diasNoIntervalo({ desde: inicio, ate: hoje });
      const ateAnterior = somarDias(inicioAnterior, n - 1);
      return {
        atual: { desde: inicio, ate: hoje },
        anterior: {
          desde: inicioAnterior,
          ate: ateAnterior < fimAnterior ? ateAnterior : fimAnterior,
        },
      };
    }
    case "mes_passado":
    default: {
      const fim = somarDias(primeiroDoMes(hoje), -1);
      const inicio = primeiroDoMes(fim);
      const fimRetrasado = somarDias(inicio, -1);
      return {
        atual: { desde: inicio, ate: fim },
        anterior: { desde: primeiroDoMes(fimRetrasado), ate: fimRetrasado },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Linhas do banco (migration 052). numeric pode chegar como string:
// passe por paraNumero antes de fazer conta.
// ---------------------------------------------------------------------------

export type TipoPedido = "venda" | "reenvio" | "teste" | "pdv";

export interface LinhaPedido {
  sku: string | null;
  qtd: number;
  qtd_atual: number;
  qtd_nao_enviada: number;
  /** Preco unitario original, moeda da loja. */
  preco: number;
}

export interface FinOrderRow {
  store_id: string;
  user_id: string;
  shopify_order_id: string;
  nome: string | null;
  processado_em: string;
  dia_local: string;
  criado_em: string;
  atualizado_em: string;
  cancelado_em: string | null;
  tipo: TipoPedido;
  status_financeiro: string | null;
  origem: string | null;
  moeda: string;
  moeda_cliente: string | null;
  total_bruto: number;
  total_atual: number;
  imposto_atual: number;
  taxas_alfandega: number;
  gorjeta: number;
  descontos: number;
  frete_cobrado: number;
  recebido: number;
  reembolsado: number;
  liquido_pago: number;
  total_cliente: number | null;
  gateways: string[];
  linhas: LinhaPedido[];
  sincronizado_em?: string;
}

export interface FinSyncStateRow {
  store_id: string;
  user_id: string;
  fuso: string | null;
  moeda: string | null;
  cursor_atualizado: string | null;
  sincronizando_desde: string | null;
  ultimo_sync_em: string | null;
  ultimo_sync_ok_em: string | null;
  ultimo_erro: string | null;
  ultimo_erro_tipo: "negado" | "falhou" | null;
  carga_inicial_ok: boolean;
  pedidos_total: number;
  /**
   * Retomada da paginacao (053): a busca e o endCursor da rodada que parou no
   * meio. Opcionais porque so existem depois da 053 -- ver sincronizarLoja.
   */
  retomar_busca?: string | null;
  retomar_cursor?: string | null;
  updated_at?: string;
}

export interface FinStoreSettingsRow {
  store_id: string;
  user_id: string;
  taxa_pct: number;
  taxa_fixa: number;
  custo_padrao_pct: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface ProductCostRow {
  id: string;
  store_id: string;
  user_id: string;
  sku: string;
  custo_unitario: number;
  frete_unitario: number;
  moeda: string;
  valido_desde: string;
  origem: "manual" | "csv";
  created_at?: string;
}

export interface AdAccountRow {
  id: string;
  user_id: string;
  store_id: string | null;
  plataforma: Plataforma;
  external_id: string;
  nome: string | null;
  moeda: string | null;
  fuso: string | null;
  status_externo: string | null;
  fonte: "api" | "script";
  ativo: boolean;
  sincronizando_desde: string | null;
  ultimo_sync_em: string | null;
  ultimo_sync_ok_em: string | null;
  ultimo_reprocesso_em: string | null;
  ultimo_dado_gerado_em: string | null;
  ultimo_erro: string | null;
  created_at?: string;
  updated_at?: string;
}

export type NivelGasto = "conta" | "campanha";

export interface AdSpendDailyRow {
  ad_account_id: string;
  user_id: string;
  data: string;
  nivel: NivelGasto;
  /** "" no nivel conta. */
  campanha_id: string;
  campanha_nome: string | null;
  moeda: string;
  gasto: number;
  impressoes: number;
  cliques: number;
  compras: number;
  valor_compras: number;
  fonte: "api" | "script";
  sincronizado_em: string;
}

export interface FxRateRow {
  data: string;
  moeda: string;
  /** Unidades da moeda por 1 USD. */
  por_usd: number;
  fonte: "frankfurter" | "ptax";
}

export type SeveridadeAlerta = "critico" | "aviso";

export type RegraAlerta =
  | "ads_sync_atrasado"
  | "gastou_sem_vender"
  | "meta_capi_token"
  | "envio_falhando"
  | "fila_travada"
  | "pedidos_sync_erro"
  | "app_desinstalado"
  | "rastreamento_parado"
  | "roteamento_script_sumiu"
  | "roteamento_escape_vitrine"
  | "roteamento_conserto_falhando";

export const ROTULO_REGRA: Record<RegraAlerta, string> = {
  ads_sync_atrasado: "Gasto de anúncio sem atualizar",
  gastou_sem_vender: "Gastou sem vender hoje",
  meta_capi_token: "Token do Meta (CAPI) recusado",
  envio_falhando: "Compra não chegou na plataforma",
  fila_travada: "Fila de envio parada",
  pedidos_sync_erro: "Pedidos da Shopify sem atualizar",
  app_desinstalado: "App desinstalado com rastreamento ligado",
  rastreamento_parado: "Rastreamento sem eventos",
  roteamento_script_sumiu: "Script do roteamento sumiu",
  roteamento_escape_vitrine: "Carrinhos caindo no checkout da vitrine",
  roteamento_conserto_falhando: "Conserto da rota falhando",
};

export interface AlertaRow {
  id: string;
  user_id: string;
  store_id: string | null;
  regra: RegraAlerta;
  chave: string;
  severidade: SeveridadeAlerta;
  titulo: string;
  detalhe: string | null;
  aberto_em: string;
  confirmado_em: string;
  falsos_seguidos: number;
  notificado_em: string | null;
  n_notificacoes: number;
  silenciado_ate: string | null;
  resolvido_em: string | null;
}

export interface AlertaConfigRow {
  user_id: string;
  telegram_chat_id: string | null;
  ativo: boolean;
  receber_avisos: boolean;
  gasto_sem_venda_min: number;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Corpos e respostas das APIs que um pacote chama e outro implementa
// ---------------------------------------------------------------------------

/** POST ROTAS.apiSyncPedidos / ROTAS.apiSyncMeta (cron ou sessao). */
export interface SyncResposta {
  ok: boolean;
  processadas: number;
  puladas: number;
  erros: string[];
}

/** Conta como a tela ve: NUNCA o segredo, so se ele existe. */
export interface ContaAnuncioResumo {
  id: string;
  plataforma: Plataforma;
  external_id: string;
  nome: string | null;
  moeda: string | null;
  fuso: string | null;
  store_id: string | null;
  ativo: boolean;
  fonte: "api" | "script";
  ultimo_sync_ok_em: string | null;
  ultimo_erro: string | null;
  temSegredo: boolean;
}

/** POST ROTAS.apiMetaConectar */
export interface MetaConectarCorpo {
  token: string;
}
export type MetaConectarResposta =
  | { ok: true; contas: ContaAnuncioResumo[] }
  | { ok: false; erro: string };

/** POST ROTAS.apiGoogleContas */
export interface GoogleContaCorpo {
  /** Com ou sem hifens: 123-456-7890. NAO e o AW-. */
  customer_id: string;
  store_id: string;
  nome?: string | null;
}
export type GoogleContaCriadaResposta =
  | { ok: true; conta: ContaAnuncioResumo; segredo: string; script: string }
  | { ok: false; erro: string };

/** PATCH ROTAS.apiContas + "/" + id (DELETE no mesmo caminho remove). */
export interface ContaPatchCorpo {
  store_id?: string | null;
  ativo?: boolean;
  nome?: string | null;
}

/** POST ROTAS.apiGoogleIngest (o script do Google Ads manda isto). */
export interface GoogleIngestLinha {
  data: string;
  campanha_id: string;
  campanha: string;
  status?: string;
  custo_micros: string | number;
  cliques: number;
  impressoes: number;
  conversoes?: number;
  valor_conversoes?: number;
}
export interface GoogleIngestCorpo {
  v: 1;
  customer_id: string;
  moeda: string;
  fuso: string;
  inicio: string;
  fim: string;
  gerado_em: string;
  linhas: GoogleIngestLinha[];
}

/** POST ROTAS.apiCustos */
export interface CustoItemCorpo {
  sku: string;
  custo_unitario: number;
  frete_unitario?: number;
  moeda: string;
  /** Vazio = hoje no fuso da loja. */
  valido_desde?: string | null;
}
export interface CustosCorpo {
  store_id: string;
  origem?: "manual" | "csv";
  itens: CustoItemCorpo[];
}

/** POST ROTAS.apiConfigFinanceira */
export interface ConfigFinanceiraCorpo {
  store_id: string;
  taxa_pct: number;
  taxa_fixa: number;
  custo_padrao_pct: number | null;
}

/** GET ROTAS.apiEventos?loja=&antes= -> { eventos: EventoFeed[] } */
export interface EventoFeed {
  id: string;
  store_id: string;
  criado_em: string;
  enviado_em: string | null;
  latencia_s: number | null;
  evento: string;
  fonte: "tema" | "pixel" | "webhook";
  plataforma: string;
  destino_id: string | null;
  destino_nome: string | null;
  status: "pendente" | "enviado" | "falhou";
  tentativas: number;
  erro: string | null;
  com_clique: boolean | null;
  origem_host: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  pedido: string | null;
  /** Teste do dono (tracking_feed_v2, 055). Sem a 055, sempre false. */
  teste?: boolean;
}

/** POST ROTAS.apiAlertasCanal (com ?testar=1 manda mensagem de teste). */
export interface AlertaCanalCorpo {
  chat_id: string | null;
  /** Vazio/ausente = manter o gravado. */
  bot_token?: string | null;
  ativo: boolean;
  receber_avisos: boolean;
  gasto_sem_venda_min: number;
}

/** PATCH ROTAS.apiAlertas + "/" + id */
export interface AlertaPatchCorpo {
  silenciar_horas: number;
}

// ---------------------------------------------------------------------------
// Regras de dinheiro compartilhadas (uma formula so para tela, custo e alerta)
// ---------------------------------------------------------------------------

export function paraNumero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function arredondar(v: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
}

/** SKU como chave: so trim. A Shopify nao normaliza caixa. */
export function chaveSku(sku: string | null | undefined): string {
  return (sku ?? "").trim();
}

/**
 * Receita do pedido, moeda da loja: o que entrou de fato (pago menos
 * reembolsado) menos imposto, taxa alfandegaria e gorjeta -- nada disso e do
 * lojista. So "venda" tem receita. Nunca negativa.
 */
export function receitaDoPedido(
  p: Pick<FinOrderRow, "tipo" | "liquido_pago" | "imposto_atual" | "taxas_alfandega" | "gorjeta">
): number {
  if (p.tipo !== "venda") return 0;
  const v =
    paraNumero(p.liquido_pago) -
    paraNumero(p.imposto_atual) -
    paraNumero(p.taxas_alfandega) -
    paraNumero(p.gorjeta);
  return v > 0 ? arredondar(v) : 0;
}

/** Conta como pedido (CPA, ticket, "vendeu hoje")? Venda com receita. */
export function pedidoConta(
  p: Pick<FinOrderRow, "tipo" | "liquido_pago" | "imposto_atual" | "taxas_alfandega" | "gorjeta">
): boolean {
  return receitaDoPedido(p) > 0;
}

/** Gera custo de produto? Venda e reenvio sim; teste e PDV nao. */
export function pedidoTemCusto(p: Pick<FinOrderRow, "tipo">): boolean {
  return p.tipo === "venda" || p.tipo === "reenvio";
}

/**
 * Unidades que custam: as que continuam no pedido OU as ja enviadas
 * (reembolso depois de enviar nao devolve o custo do fornecedor). Pedido
 * cancelado so custa o que ja tinha sido enviado. Venda sem nada recebido
 * (PIX/boleto pendente, expirado) tambem so custa o que ja foi enviado: o
 * abandonado nao gera custo, e o COD enviado antes de pagar gera.
 */
export function qtdParaCusto(l: LinhaPedido, cancelado = false, semPagamento = false): number {
  const enviadas = Math.max(0, paraNumero(l.qtd) - paraNumero(l.qtd_nao_enviada));
  if (cancelado || semPagamento) return enviadas;
  return Math.max(0, paraNumero(l.qtd_atual), enviadas);
}

/**
 * Custo de um SKU num dia. Vale a versao mais recente com valido_desde <= dia;
 * antes da primeira versao, vale a primeira (custo cadastrado hoje cobre os
 * pedidos antigos -- sem isso, todo historico nasceria "sem custo").
 * `versoes` = linhas de UM sku de UMA loja, em qualquer ordem.
 */
export function custoVigente(versoes: ProductCostRow[], dia: string): ProductCostRow | null {
  if (versoes.length === 0) return null;
  const ordenadas = [...versoes].sort((a, b) =>
    a.valido_desde < b.valido_desde ? -1 : a.valido_desde > b.valido_desde ? 1 : 0
  );
  let escolhida = ordenadas[0];
  for (const v of ordenadas) {
    if (v.valido_desde <= dia) escolhida = v;
    else break;
  }
  return escolhida;
}

/** Variacao percentual; null quando o anterior e zero (sem base). */
export function variacaoPct(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function formatarDinheiro(valor: number, moeda: string, casas = 2): string {
  try {
    return valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: moeda,
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  } catch {
    return `${moeda} ${valor.toFixed(casas)}`;
  }
}
