// ============================================================================
// Checkout externo (migration 069): contratos, constantes e regras puras.
//
// Importado pelo SERVIDOR e pelo CLIENTE: nada de "server-only", I/O ou
// process.env aqui.
//
// "Checkout" na tela; checkouts_externos no banco. O nome foge de "loja de
// checkout" (roteamento, src/lib/checkout-routes) e de tracking_checkouts.
//
// Dois modelos (072): comissao (Sphere, afiliado) e venda (Cakto, o lojista
// e o produtor). Ver MODELO_PLATAFORMA e src/lib/checkouts-externos/venda.ts.
// ============================================================================

export type IdPlataformaCheckout = "sphere" | "cakto";

/**
 * comissao = afiliado (Sphere): a receita e a comissao, com Previsto pela taxa
 * de aprovacao. venda = o lojista e o produtor (Cakto): faturamento, taxa e
 * liquido, como uma loja online (src/lib/checkouts-externos/venda.ts).
 */
export type ModeloCheckout = "comissao" | "venda";

/** O que a tela oferece em "Conectar checkout". Cakto e Sphere recebem hoje. */
export const PLATAFORMAS_CHECKOUT: {
  id: IdPlataformaCheckout | "yampi" | "cartpanda" | "kiwify";
  nome: string;
  descricao: string;
  ativa: boolean;
}[] = [
  { id: "cakto", nome: "Cakto", descricao: "Venda própria: faturamento, taxa e líquido.", ativa: true },
  { id: "sphere", nome: "Sphere Affiliates", descricao: "Afiliado COD na Europa: comissão por pedido.", ativa: true },
  { id: "yampi", nome: "Yampi", descricao: "Em breve", ativa: false },
  { id: "cartpanda", nome: "CartPanda", descricao: "Em breve", ativa: false },
  { id: "kiwify", nome: "Kiwify", descricao: "Em breve", ativa: false },
];

/**
 * `?novo=` na URL de Integracoes > Checkouts abre o "Conectar checkout" ao
 * chegar (vem de /conectar): plataforma ativa vai direto ao nome e moeda;
 * "1", plataforma em breve ou desconhecida abre na escolha da plataforma.
 * Sem o parametro, nada abre.
 */
export function passoDoNovo(novo: string | string[] | null | undefined): "plataforma" | "dados" | null {
  if (typeof novo !== "string" || !novo) return null;
  return PLATAFORMAS_CHECKOUT.some((p) => p.ativa && p.id === novo) ? "dados" : "plataforma";
}

/** A plataforma ativa pedida em `?novo=`, ou null (a tela abre na escolha). */
export function plataformaDoNovo(novo: string | string[] | null | undefined): IdPlataformaCheckout | null {
  if (typeof novo !== "string" || !novo) return null;
  const p = PLATAFORMAS_CHECKOUT.find((x) => x.ativa && x.id === novo);
  return p ? (p.id as IdPlataformaCheckout) : null;
}

export const NOME_PLATAFORMA: Record<IdPlataformaCheckout, string> = {
  sphere: "Sphere Affiliates",
  cakto: "Cakto",
};

export function nomeDaPlataforma(id: string | null | undefined): string {
  return (id && NOME_PLATAFORMA[id as IdPlataformaCheckout]) || "Checkout";
}

export const MODELO_PLATAFORMA: Record<IdPlataformaCheckout, ModeloCheckout> = {
  sphere: "comissao",
  cakto: "venda",
};

/** Plataforma desconhecida fica no modelo da 069 (comissao): nada muda para ela. */
export function modeloDaPlataforma(id: string | null | undefined): ModeloCheckout {
  return (id && MODELO_PLATAFORMA[id as IdPlataformaCheckout]) || "comissao";
}

/** A moeda que o cadastro sugere: a Sphere fala em euro, a Cakto em real. */
export const MOEDA_PADRAO: Record<IdPlataformaCheckout, string> = {
  sphere: "EUR",
  cakto: "BRL",
};

export function moedaPadraoDe(id: string | null | undefined): string {
  return (id && MOEDA_PADRAO[id as IdPlataformaCheckout]) || "EUR";
}

/** "comissão em EUR" (Sphere), "vendas em BRL" (Cakto): a linha do checkout nas listas. */
export function textoDaMoeda(plataforma: string | null | undefined, moeda: string): string {
  return modeloDaPlataforma(plataforma) === "venda" ? `vendas em ${moeda}` : `comissão em ${moeda}`;
}

/**
 * Teto contra abuso. Cadastrar checkout NAO conta no limite do plano; ligar o
 * rastreamento nele (destino Meta/TikTok ativo, 073) conta como uma loja com
 * rastreamento (src/lib/billing/limites.ts).
 */
export const MAX_CHECKOUTS = 20;

/** O caminho publico do webhook. O token acha o checkout (e e a senha da Sphere, que nao assina). */
export const CAMINHO_WEBHOOK = "/api/webhooks/checkout";

/** O formato de gerarSegredo (32 bytes em base64url). */
export const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function urlDoWebhook(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${CAMINHO_WEBHOOK}/${token}`;
}

/**
 * Moedas oferecidas no cadastro. Sphere: a da comissao (ela nao manda a dela).
 * Cakto: a das vendas, quando o webhook nao traz `currency`.
 */
export const MOEDAS_COMISSAO = ["EUR", "USD", "BRL", "GBP", "PLN", "CZK", "HUF", "RON"] as const;

/** "pedido.criado" etc.: o que a Sphere manda. A tela pede os quatro. */
export const GATILHOS_SPHERE = ["pedido.criado", "pedido.expirado", "comissao.aprovada", "comissao.paga"] as const;

/**
 * Os eventos a marcar no webhook da Cakto. O abandono e as assinaturas ela
 * tambem manda, e o xcart responde 200 sem gravar (cakto.ts).
 */
export const GATILHOS_CAKTO = [
  "purchase_approved",
  "purchase_refused",
  "pix_gerado",
  "boleto_gerado",
  "picpay_gerado",
  "refund",
  "refund_requested",
  "chargeback",
] as const;

/**
 * A plataforma assina a entrega com um secret que o lojista cola no xcart
 * (o adaptador tem `autenticar`). Aqui para a tela, que nao importa adaptador.
 */
export function usaSegredo(id: string | null | undefined): boolean {
  return id === "cakto";
}

/** O secret do webhook da Cakto: 8 a 200 caracteres visiveis, sem espaco (CHECK da 072). */
export const RE_SEGREDO_PLATAFORMA = /^[!-~]{8,200}$/;

export function segredoValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return RE_SEGREDO_PLATAFORMA.test(s) ? s : null;
}

export const ROTULO_EVENTO: Record<string, string> = {
  "pedido.criado": "Pedido criado",
  "pedido.expirado": "Pedido expirado",
  "comissao.aprovada": "Comissão aprovada",
  "comissao.paga": "Comissão paga",
  purchase_approved: "Compra aprovada",
  purchase_refused: "Compra recusada",
  pix_gerado: "Pix gerado",
  boleto_gerado: "Boleto gerado",
  picpay_gerado: "PicPay gerado",
  openfinance_nubank_gerado: "Open Finance gerado",
  refund: "Reembolso",
  refund_requested: "Reembolso pedido",
  chargeback: "Chargeback",
};

export function rotuloDoEvento(evento: string | null | undefined): string {
  const e = String(evento || "");
  return ROTULO_EVENTO[e] || e || "—";
}

// ---------------------------------------------------------------------------
// Rastreamento pelo servidor (073): o xcart manda a compra ao Meta e ao TikTok
// ---------------------------------------------------------------------------

/**
 * Quando a compra sai. "gerada" (padrao): no PRIMEIRO evento de venda da
 * cobranca -- Pix, boleto ou PicPay gerado, ou o cartao aprovado. "aprovada":
 * so quando o pagamento aprova. Nos dois, uma compra por cobranca: o Pix pago
 * depois do gerado nao manda de novo (src/lib/checkouts-externos/compra.ts).
 */
export type CompraQuando = "gerada" | "aprovada";

export const COMPRA_QUANDO_PADRAO: CompraQuando = "gerada";

export const OPCOES_COMPRA_QUANDO: { id: CompraQuando; rotulo: string; descricao: string }[] = [
  {
    id: "gerada",
    rotulo: "Quando gerar o Pix/boleto ou aprovar (padrão)",
    descricao: "A compra sai quando o Pix ou o boleto é gerado, ou quando o cartão aprova. Não sai de novo quando o Pix é pago.",
  },
  {
    id: "aprovada",
    rotulo: "Só quando aprovar",
    descricao: "A compra sai quando o pagamento é aprovado. Pix e boleto que não forem pagos não contam.",
  },
];

/** Ausente (sem a 073) ou desconhecido: o padrao. */
export function compraQuandoDe(v: unknown): CompraQuando {
  return v === "aprovada" ? "aprovada" : COMPRA_QUANDO_PADRAO;
}

/**
 * O xcart manda a compra deste checkout ao Meta e ao TikTok? So no modelo
 * venda (Cakto): a Sphere nao manda dado do comprador nem click id.
 */
export function rastreiaCompra(plataforma: string | null | undefined): boolean {
  return modeloDaPlataforma(plataforma) === "venda";
}

/** As redes do rastreamento do checkout. O Google fica com a tag nativa da plataforma. */
export type PlataformaRastreio = "meta" | "tiktok";

export const NOME_REDE: Record<PlataformaRastreio, string> = { meta: "Meta", tiktok: "TikTok" };

/** O id do pixel: so digitos no Meta; letras e digitos no TikTok (CHECK da 073). */
export function contaDoPixel(plataforma: PlataformaRastreio, bruto: unknown): string | null {
  const s = String(bruto ?? "");
  if (plataforma === "tiktok") {
    const c = s.replace(/\s+/g, "");
    return /^[A-Za-z0-9]{10,30}$/.test(c) ? c : null;
  }
  const c = s.replace(/\D/g, "");
  return /^[0-9]{5,25}$/.test(c) ? c : null;
}

/** Codigo de teste do Meta/TikTok: vazio = sem (CHECK da 073). undefined = invalido. */
export function codigoDeTeste(bruto: unknown): string | null | undefined {
  if (bruto === undefined || bruto === null) return null;
  const s = String(bruto).trim();
  if (!s) return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : undefined;
}

/** O token colado (CHECK da 073): 10 a 1000 caracteres, sem espaco. */
export function tokenDoPixel(bruto: unknown): string | null {
  const s = String(bruto ?? "").trim();
  return s.length >= 10 && s.length <= 1000 && !/\s/.test(s) ? s : null;
}

/** Um destino como a tela ve: NUNCA o token, so se ha um salvo. */
export interface DestinoNaTela {
  plataforma: PlataformaRastreio;
  conta: string;
  testEventCode: string | null;
  ativo: boolean;
  temToken: boolean;
}

export type StatusDoEnvio = "pendente" | "enviado" | "falhou";

/** Uma linha da fila como a tela ve: o estado, nunca o payload. */
export interface EnvioNaTela {
  id: string;
  plataforma: PlataformaRastreio;
  evento: string;
  /** A cobranca (o refId do principal). */
  grupo: string | null;
  status: StatusDoEnvio;
  tentativas: number;
  /** O motivo da falha, ou o aviso do envio (ex.: "sem fbc"). */
  detalhe: string | null;
  enviadoEm: string | null;
  criadoEm: string;
}

/** GET /api/checkouts/[id]/rastreamento (e a resposta das mudancas). */
export interface RastreamentoDoCheckout {
  compraQuando: CompraQuando;
  destinos: DestinoNaTela[];
  envios: EnvioNaTela[];
  /** O limite de rastreamento do plano (lojas + checkouts). null = nao deu para ler. */
  uso: { emUso: number; limite: number | null; esteConta: boolean } | null;
  /** A 073 ainda nao foi aplicada. */
  semMigration: boolean;
}

export const ROTULO_STATUS_ENVIO: Record<StatusDoEnvio, string> = {
  pendente: "Na fila",
  enviado: "Enviada",
  falhou: "Falhou",
};

// ---------------------------------------------------------------------------
// Situacao do pedido
// ---------------------------------------------------------------------------

export type SituacaoExterna = "pendente" | "aprovado" | "pago" | "expirado" | "revertido";

export const SITUACOES_EXTERNAS: SituacaoExterna[] = ["pendente", "aprovado", "pago", "expirado", "revertido"];

export const ROTULO_SITUACAO_EXTERNA: Record<SituacaoExterna, string> = {
  pendente: "Pendente",
  aprovado: "Aprovada",
  pago: "Paga",
  expirado: "Expirada",
  revertido: "Revertida",
};

/** Comissao que ja e do afiliado: o "Recebido". */
export function situacaoRecebida(s: SituacaoExterna): boolean {
  return s === "aprovado" || s === "pago";
}

/** Comissao perdida: COD nao pago/entregue, ou estornada. */
export function situacaoPerdida(s: SituacaoExterna): boolean {
  return s === "expirado" || s === "revertido";
}

// ---------------------------------------------------------------------------
// Linhas do banco (069). numeric pode chegar como string.
// ---------------------------------------------------------------------------

export interface CheckoutExternoRow {
  id: string;
  user_id: string;
  plataforma: IdPlataformaCheckout;
  nome: string;
  ativo: boolean;
  moeda_receita: string;
  fuso: string;
  taxa_aprovacao_padrao: number | string;
  notificar_aprovada: boolean;
  /** Venda (072): avisar Pix ou boleto gerado. Ausente sem a 072. */
  notificar_pendente?: boolean | null;
  /** Venda (072): avisar reembolso e chargeback. Ausente sem a 072. */
  notificar_estorno?: boolean | null;
  /** Rastreamento (073): quando a compra sai ao Meta e ao TikTok. Ausente sem a 073. */
  compra_quando?: string | null;
  ultimo_evento_em: string | null;
  ultimo_evento: string | null;
  ultimo_evento_teste: boolean;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  created_at?: string;
  updated_at?: string;
}

/** O checkout como a tela ve: NUNCA o token nem o secret da plataforma. */
export interface CheckoutResumo {
  id: string;
  plataforma: IdPlataformaCheckout;
  nome: string;
  ativo: boolean;
  moeda_receita: string;
  fuso: string;
  taxa_aprovacao_padrao: number;
  notificar_aprovada: boolean;
  notificar_pendente: boolean;
  notificar_estorno: boolean;
  compra_quando: CompraQuando;
  ultimo_evento_em: string | null;
  ultimo_evento: string | null;
  ultimo_evento_teste: boolean;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
}

/** A linha do banco como a tela ve: sem o token (que nem esta nela). */
export function resumoDoCheckout(c: CheckoutExternoRow): CheckoutResumo {
  const taxa = Number(c.taxa_aprovacao_padrao);
  return {
    id: String(c.id),
    plataforma: c.plataforma,
    nome: c.nome,
    ativo: Boolean(c.ativo),
    moeda_receita: c.moeda_receita,
    fuso: c.fuso,
    taxa_aprovacao_padrao: Number.isFinite(taxa) ? taxa : 70,
    notificar_aprovada: Boolean(c.notificar_aprovada),
    notificar_pendente: Boolean(c.notificar_pendente),
    notificar_estorno: Boolean(c.notificar_estorno),
    compra_quando: compraQuandoDe(c.compra_quando),
    ultimo_evento_em: c.ultimo_evento_em,
    ultimo_evento: c.ultimo_evento,
    ultimo_evento_teste: Boolean(c.ultimo_evento_teste),
    ultimo_erro: c.ultimo_erro,
    ultimo_erro_em: c.ultimo_erro_em,
  };
}

export interface PedidoExternoRow {
  checkout_id: string;
  user_id: string;
  pedido_id: string;
  situacao: SituacaoExterna;
  status_comissao: string | null;
  status_pedido: string | null;
  metodo_pagamento: string | null;
  produto: string | null;
  pais: string | null;
  programa: string | null;
  moeda: string;
  valor: number | string;
  receita: number | string;
  moeda_receita: string | null;
  criado_em: string;
  dia_local: string;
  aprovado_em: string | null;
  pago_em: string | null;
  perdido_em: string | null;
  atualizado_em: string;
  versao: number;
  recebido_em?: string;
  // --- Venda (072). Ausentes sem a migration; null na Sphere. ---
  referencia?: string | null;
  taxa?: number | string | null;
  comissoes?: number | string | null;
  grupo?: string | null;
  oferta_tipo?: string | null;
  vence_em?: string | null;
  reembolsado_em?: string | null;
  chargeback_em?: string | null;
  reembolso_pedido_em?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  campanha_id?: string | null;
  conjunto_id?: string | null;
  anuncio_id?: string | null;
  /**
   * Custo de produto da venda, na moeda dela. null = 0 (infoproduto). O
   * webhook NAO grava (nao esta em CAMPOS_VENDA): fica para o custo opcional.
   */
  custo?: number | string | null;
}

export interface EventoExternoRow {
  checkout_id: string;
  user_id: string;
  pedido_id: string;
  evento: string;
  data_evento: string | null;
  recebido_em: string;
}

/** Colunas que a tela e o Dashboard leem (sem versao/recebido_em). */
export const COLUNAS_PEDIDO_EXTERNO =
  "checkout_id, user_id, pedido_id, situacao, status_comissao, status_pedido, metodo_pagamento, produto, pais, programa, moeda, valor, receita, moeda_receita, criado_em, dia_local, aprovado_em, pago_em, perdido_em, atualizado_em, versao";

/** As colunas da venda (072). Quem le pedidos_externos tenta com elas e, sem a 072, sem elas. */
export const COLUNAS_VENDA =
  "referencia, taxa, comissoes, grupo, oferta_tipo, vence_em, reembolsado_em, chargeback_em, reembolso_pedido_em, utm_source, utm_medium, utm_campaign, utm_content, utm_term, campanha_id, conjunto_id, anuncio_id";

export const COLUNAS_PEDIDO_EXTERNO_072 = `${COLUNAS_PEDIDO_EXTERNO}, ${COLUNAS_VENDA}`;

export const COLUNAS_CHECKOUT =
  "id, user_id, plataforma, nome, ativo, moeda_receita, fuso, taxa_aprovacao_padrao, notificar_aprovada, ultimo_evento_em, ultimo_evento, ultimo_evento_teste, ultimo_erro, ultimo_erro_em, created_at, updated_at";

/** COLUNAS_CHECKOUT com os avisos opcionais da venda (072). */
export const COLUNAS_CHECKOUT_072 = `${COLUNAS_CHECKOUT}, notificar_pendente, notificar_estorno`;

/** E com o "Mandar a compra" do rastreamento (073). */
export const COLUNAS_CHECKOUT_073 = `${COLUNAS_CHECKOUT_072}, compra_quando`;

/**
 * Tabela (PGRST205/42P01) ou coluna (42703/PGRST204) que o banco nao tem: a
 * 069 ainda nao foi aplicada. Quem le trata como "nenhum checkout".
 */
export function semMigration069(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST205" || code === "42P01" || code === "42703" || code === "PGRST204") return true;
  const msg = String(error.message || "");
  return /checkouts_externos|pedidos_externos|checkout_externo_|checkout_id/.test(msg) && /does not exist|could not find|schema cache/i.test(msg);
}

/**
 * Coluna que o banco nao tem (42703 na leitura, PGRST204 na escrita): a 072
 * ainda nao foi aplicada. Quem le cai nas colunas da 069 -- nunca esconde os
 * checkouts por isso (semMigration069 trataria o 42703 como "sem 069").
 */
export function colunaAusente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42703" || code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(String(error.message || ""));
}

type RespostaDoBanco<T> = { data: T | null; error: { code?: string; message: string } | null };

/**
 * A consulta com as colunas da 072 e, se o banco ainda nao as tem, de novo
 * com as da 069. Qualquer outro erro volta como veio (quem chama decide).
 */
export async function comColunas072<T>(
  novas: string,
  velhas: string,
  consulta: (colunas: string) => PromiseLike<RespostaDoBanco<T>>
): Promise<RespostaDoBanco<T>> {
  const r = await consulta(novas);
  if (!r.error || !colunaAusente(r.error)) return r;
  return consulta(velhas);
}

/**
 * comColunas072 com mais de um degrau: as colunas da migration mais nova
 * primeiro e, enquanto o banco nao as tem (colunaAusente), as da anterior.
 * Ex.: [073, 072, 069] le com e sem a 073 e com e sem a 072.
 */
export async function comColunasEmOrdem<T>(
  listas: readonly string[],
  consulta: (colunas: string) => PromiseLike<RespostaDoBanco<T>>
): Promise<RespostaDoBanco<T>> {
  let r: RespostaDoBanco<T> = { data: null, error: { message: "sem colunas" } };
  for (const colunas of listas) {
    r = await consulta(colunas);
    if (!r.error || !colunaAusente(r.error)) return r;
  }
  return r;
}

/** Tabela que o banco nao tem (PGRST205 no PostgREST, 42P01 no Postgres): a migration ainda nao foi aplicada. */
export function tabelaAusente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  return code === "PGRST205" || code === "42P01";
}

/** Nome valido para checkout: 1 a 80 caracteres sem espaco nas pontas. */
export function nomeValido(nome: unknown): string | null {
  if (typeof nome !== "string") return null;
  const n = nome.replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= 80 ? n : null;
}

/** Fuso IANA que o Intl conhece. */
export function fusoValido(fuso: unknown): string | null {
  if (typeof fuso !== "string" || !fuso || fuso.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return null;
  }
}
