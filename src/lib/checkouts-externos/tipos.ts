// ============================================================================
// Checkout externo (migration 069): contratos, constantes e regras puras.
//
// Importado pelo SERVIDOR e pelo CLIENTE: nada de "server-only", I/O ou
// process.env aqui.
//
// "Checkout" na tela; checkouts_externos no banco. O nome foge de "loja de
// checkout" (roteamento, src/lib/checkout-routes) e de tracking_checkouts.
// ============================================================================

export type IdPlataformaCheckout = "sphere";

/** O que a tela oferece em "Adicionar checkout". So a Sphere recebe hoje. */
export const PLATAFORMAS_CHECKOUT: {
  id: IdPlataformaCheckout | "yampi" | "cartpanda" | "kiwify";
  nome: string;
  descricao: string;
  ativa: boolean;
}[] = [
  { id: "sphere", nome: "Sphere Affiliates", descricao: "Afiliado COD na Europa: comissão por pedido.", ativa: true },
  { id: "yampi", nome: "Yampi", descricao: "Em breve", ativa: false },
  { id: "cartpanda", nome: "CartPanda", descricao: "Em breve", ativa: false },
  { id: "kiwify", nome: "Kiwify", descricao: "Em breve", ativa: false },
];

/**
 * `?novo=` na URL de Integracoes > Checkouts abre o "Adicionar checkout" ao
 * chegar (vem de /conectar): plataforma ativa vai direto ao nome e moeda;
 * "1", plataforma em breve ou desconhecida abre na escolha da plataforma.
 * Sem o parametro, nada abre.
 */
export function passoDoNovo(novo: string | string[] | null | undefined): "plataforma" | "dados" | null {
  if (typeof novo !== "string" || !novo) return null;
  return PLATAFORMAS_CHECKOUT.some((p) => p.ativa && p.id === novo) ? "dados" : "plataforma";
}

export const NOME_PLATAFORMA: Record<IdPlataformaCheckout, string> = {
  sphere: "Sphere Affiliates",
};

export function nomeDaPlataforma(id: string | null | undefined): string {
  return (id && NOME_PLATAFORMA[id as IdPlataformaCheckout]) || "Checkout";
}

/** Teto contra abuso. Checkout NAO conta no limite do plano (limites.ts). */
export const MAX_CHECKOUTS = 20;

/** O caminho publico do webhook. O token e a senha: a Sphere nao assina. */
export const CAMINHO_WEBHOOK = "/api/webhooks/checkout";

/** O formato de gerarSegredo (32 bytes em base64url). */
export const RE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function urlDoWebhook(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${CAMINHO_WEBHOOK}/${token}`;
}

/** Moedas da comissao oferecidas no cadastro (a Sphere nao manda a dela). */
export const MOEDAS_COMISSAO = ["EUR", "USD", "BRL", "GBP", "PLN", "CZK", "HUF", "RON"] as const;

/** "pedido.criado" etc.: o que a Sphere manda. A tela pede os quatro. */
export const GATILHOS_SPHERE = ["pedido.criado", "pedido.expirado", "comissao.aprovada", "comissao.paga"] as const;

export const ROTULO_EVENTO: Record<string, string> = {
  "pedido.criado": "Pedido criado",
  "pedido.expirado": "Pedido expirado",
  "comissao.aprovada": "Comissão aprovada",
  "comissao.paga": "Comissão paga",
};

export function rotuloDoEvento(evento: string | null | undefined): string {
  const e = String(evento || "");
  return ROTULO_EVENTO[e] || e || "—";
}

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
  ultimo_evento_em: string | null;
  ultimo_evento: string | null;
  ultimo_evento_teste: boolean;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  created_at?: string;
  updated_at?: string;
}

/** O checkout como a tela ve: NUNCA o token. */
export interface CheckoutResumo {
  id: string;
  plataforma: IdPlataformaCheckout;
  nome: string;
  ativo: boolean;
  moeda_receita: string;
  fuso: string;
  taxa_aprovacao_padrao: number;
  notificar_aprovada: boolean;
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

export const COLUNAS_CHECKOUT =
  "id, user_id, plataforma, nome, ativo, moeda_receita, fuso, taxa_aprovacao_padrao, notificar_aprovada, ultimo_evento_em, ultimo_evento, ultimo_evento_teste, ultimo_erro, ultimo_erro_em, created_at, updated_at";

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
