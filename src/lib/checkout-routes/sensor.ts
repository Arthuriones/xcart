import { createHash } from "node:crypto";

// ============================================================================
// Sensor do roteamento: saber COM NUMERO quando um carrinho escapa e quando o
// carrinho levado vira pedido. Puro, sem banco e sem rede: o servidor
// (sensores.ts, o webhook, a tela e o cron de alertas) usa as mesmas regras.
//
// Dois avisos da Shopify, um em cada ponta da rota:
//
//   - orders/create na LOJA DE CHECKOUT: grava routed_checkout_orders (o
//     handler ja existia). Sem ele a tela dizia "0 pedidos" -- e era mentira:
//     a NORAH OUTLET tinha ~225 carrinhos levados e nenhum pedido registrado
//     porque o webhook nunca foi inscrito (a loja nao deu read_orders ao app).
//   - checkouts/create na VITRINE: a vitrine nao deveria ter checkout nenhum.
//     Todo checkout que nasce nela e um comprador que escapou da rota e caiu
//     num checkout que nao cobra. Grava em routed_checkout_fallbacks com
//     reason "checkout_na_vitrine", so com SKU/variante/quantidade.
//
// O QUE A DOC DA SHOPIFY DIZ (WebhookSubscriptionTopic, Admin GraphQL 2024-10)
//
//   CHECKOUTS_CREATE: "Occurs whenever a checkout is created. Requires the
//   `read_orders` scope." O payload traz email, telefone, enderecos e cliente
//   (dado protegido) -- daqui so sai line_items[].sku/variant_id/quantity.
//   A doc NAO diz em que passo do checkout o objeto nasce, e o abandoned
//   checkout (mesmo recurso) so conta "after the customer has added contact
//   information". Relatos na comunidade divergem (ha quem receba sem e-mail,
//   ha quem perca entregas). Por isso o numero de escapes e um PISO: se a
//   Shopify so criar o checkout depois do contato, quem desistiu antes de
//   digitar o e-mail nao entra na conta. Nunca inventa escape, pode deixar de
//   contar algum.
// ============================================================================

const HORA = 3_600_000;
const DIA = 24 * HORA;

export const TOPICO_PEDIDOS = "ORDERS_CREATE";
export const TOPICO_CHECKOUT = "CHECKOUTS_CREATE";
/** Os dois topicos pedem read_orders (doc da Shopify, 2024-10). */
export const ESCOPO_DOS_TOPICOS = "read_orders";
export const CAMINHO_DOS_WEBHOOKS = "/api/shopify/webhooks";

/** Onde a inscricao fica: settings da linha de destino e da rota. */
export const CHAVE_PEDIDOS = "webhook_pedidos";
export const CHAVE_VITRINE = "webhook_vitrine";

/** O motivo do evento de escape em routed_checkout_fallbacks. */
export const MOTIVO_ESCAPE = "checkout_na_vitrine";

/** Uma conferencia por loja por dia, de qualquer jeito que tenha dado. */
export const RECONFERIR_MS = DIA;

/**
 * inscrito       -- o aviso esta ligado; `desde` diz desde quando conta.
 * sem_permissao  -- a loja nao deu read_orders (ou a Shopify negou o dado de
 *                   pedido ao app): so o lojista resolve.
 * loja_fora      -- loja pausada, app removido, credencial recusada.
 * falhou         -- a Shopify nao respondeu; tenta na proxima conferencia.
 */
export type EstadoInscricao = "inscrito" | "sem_permissao" | "loja_fora" | "falhou";

export interface InscricaoWebhook {
  /** Quando foi conferido (ISO). */
  em: string;
  estado: EstadoInscricao;
  /** Frase curta para a tela quando nao esta inscrito. */
  motivo?: string;
  /** createdAt da inscricao na Shopify: antes disso nada podia ser contado. */
  desde?: string | null;
}

const ESTADOS: readonly EstadoInscricao[] = ["inscrito", "sem_permissao", "loja_fora", "falhou"];

export const MOTIVO_SEM_ESCOPO = "falta a permissão de pedidos (read_orders) no app da loja";

/** Le a inscricao gravada em settings[chave]; qualquer coisa torta = null. */
export function lerInscricao(settings: unknown, chave: string): InscricaoWebhook | null {
  if (!settings || typeof settings !== "object") return null;
  const v = (settings as Record<string, unknown>)[chave];
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.em !== "string" || !ESTADOS.includes(o.estado as EstadoInscricao)) return null;
  return {
    em: o.em,
    estado: o.estado as EstadoInscricao,
    ...(typeof o.motivo === "string" && o.motivo ? { motivo: o.motivo } : {}),
    ...(typeof o.desde === "string" && o.desde ? { desde: o.desde } : {}),
  };
}

/** Nunca conferido, data ilegivel ou conferido ha mais de um dia. */
export function precisaConferir(i: InscricaoWebhook | null, agora: number): boolean {
  if (!i) return true;
  const em = Date.parse(i.em);
  if (!Number.isFinite(em)) return true;
  return agora - em >= RECONFERIR_MS;
}

export interface InscricaoNaShopify {
  topico: string;
  url: string | null;
  criadoEm: string | null;
}

/** A inscricao e nossa? So o caminho conta: o host ja mudou (vercel.app -> user.xcart.app). */
export function ehNossoEndpoint(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === CAMINHO_DOS_WEBHOOKS;
  } catch {
    return false;
  }
}

/**
 * O que fazer com um topico, a partir do que a loja respondeu.
 *
 * Inscricao existente em qualquer host nosso vale: a lista do
 * webhookSubscriptions so traz as do proprio app, e criar outra para o host
 * novo faria cada pedido chegar duas vezes. Sem read_orders nem tenta: a
 * Shopify recusa a inscricao, e o motivo para a tela e o mesmo.
 */
export function decidirTopico(p: {
  topico: string;
  escopos: readonly string[];
  inscricoes: readonly InscricaoNaShopify[];
}): { acao: "ja_inscrito"; desde: string | null } | { acao: "sem_escopo" } | { acao: "inscrever" } {
  const minha = p.inscricoes.find((i) => i.topico === p.topico && ehNossoEndpoint(i.url));
  if (minha) return { acao: "ja_inscrito", desde: minha.criadoEm };
  if (!p.escopos.includes(ESCOPO_DOS_TOPICOS)) return { acao: "sem_escopo" };
  return { acao: "inscrever" };
}

/** Erro da Shopify ao ler ou inscrever, em estado e frase curta. */
export function classificarFalha(mensagem: string | null | undefined): {
  estado: Exclude<EstadoInscricao, "inscrito">;
  motivo: string;
} {
  const m = String(mensagem || "");
  if (/protected customer data|not approved|dados protegidos/i.test(m)) {
    return { estado: "sem_permissao", motivo: "a Shopify não liberou dados de pedido para o app desta loja" };
  }
  if (/read_orders|ACCESS_DENIED|access denied/i.test(m)) {
    return { estado: "sem_permissao", motivo: MOTIVO_SEM_ESCOPO };
  }
  if (/402|payment required|pausada|congelada|sem plano/i.test(m)) {
    return { estado: "loja_fora", motivo: "loja pausada ou sem plano na Shopify" };
  }
  if (/application_cannot_be_found|not installed|nao esta instalado|não está instalado/i.test(m)) {
    return { estado: "loja_fora", motivo: "app removido da loja" };
  }
  if (/401|403|unauthorized|forbidden|invalid api key|access token/i.test(m)) {
    return { estado: "loja_fora", motivo: "credencial do app recusada; reconecte a loja" };
  }
  return { estado: "falhou", motivo: "a Shopify não respondeu; confiro de novo amanhã" };
}

// ---------------------------------------------------------------------------
// Escape: o checkout que nasceu na vitrine
// ---------------------------------------------------------------------------

export interface ItemDoEscape {
  sku: string | null;
  varianteId: string | null;
  quantidade: number;
}

const MAX_ITENS = 50;

/**
 * So os itens: SKU, variante e quantidade. O payload do checkouts/create traz
 * e-mail, telefone, enderecos e o cliente inteiro -- nada disso sai daqui.
 * Lista branca de proposito: um campo novo que a Shopify passe a mandar
 * dentro de line_items nao entra sem alguem escolher.
 */
export function itensDoCheckout(payload: unknown): ItemDoEscape[] {
  const linhas = (payload as { line_items?: unknown } | null)?.line_items;
  if (!Array.isArray(linhas)) return [];
  const saida: ItemDoEscape[] = [];
  for (const l of linhas.slice(0, MAX_ITENS)) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const sku = typeof o.sku === "string" && o.sku.trim() ? o.sku.trim().slice(0, 80) : null;
    const v = o.variant_id;
    const varianteId =
      (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^\d{1,20}$/.test(v))
        ? String(v)
        : null;
    const q = Number(o.quantity);
    const quantidade = Number.isFinite(q) && q > 0 ? Math.min(Math.floor(q), 9999) : 1;
    if (!sku && !varianteId) continue;
    saida.push({ sku, varianteId, quantidade });
  }
  return saida;
}

/** "2 itens: SKU-A x1 · v123 x2". Cabe na coluna e se le na tela. */
export function detalheDoEscape(itens: readonly ItemDoEscape[]): string {
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  const cabeca = `${total} ${total === 1 ? "item" : "itens"}: `;
  const partes: string[] = [];
  let tamanho = cabeca.length;
  for (let i = 0; i < itens.length; i += 1) {
    const it = itens[i];
    const parte = `${it.sku ?? `v${it.varianteId}`} x${it.quantidade}`;
    const resto = itens.length - i - 1;
    // Reserva para o " · +N".
    if (tamanho + parte.length + 3 + (resto > 0 ? 8 : 0) > 480) {
      partes.push(`+${itens.length - i}`);
      break;
    }
    partes.push(parte);
    tamanho += parte.length + 3;
  }
  return cabeca + partes.join(" · ");
}

/**
 * Trava de uso unico por checkout: vai como webhook_id em
 * shopify_webhook_events (PK), entao duas entregas do mesmo checkout -- ou
 * duas inscricoes em hosts diferentes -- contam uma vez. O token vira hash:
 * nao precisa estar legivel no banco.
 */
export function chaveDoEscape(storeId: string, token: string): string {
  const h = createHash("sha256").update(token).digest("hex").slice(0, 32);
  return `checkout:${storeId}:${h}`;
}

// ---------------------------------------------------------------------------
// Funil da rota
// ---------------------------------------------------------------------------

export const DIAS_DO_FUNIL = 7;

/**
 * Desde quando da para contar: o comeco da janela, ou o momento da inscricao
 * se ela e mais nova. Sem isso a conversao da primeira semana sairia baixa so
 * porque o aviso de pedidos ainda nao existia nos primeiros dias.
 * null = alguma loja nao tem o aviso ligado (nao ha o que contar).
 */
export function inicioDaContagem(
  inscricoes: readonly (InscricaoWebhook | null)[],
  agora: number,
  dias: number = DIAS_DO_FUNIL
): number | null {
  if (inscricoes.length === 0) return null;
  let inicio = agora - dias * DIA;
  for (const i of inscricoes) {
    if (!i || i.estado !== "inscrito") return null;
    const desde = Date.parse(i.desde || i.em);
    if (Number.isFinite(desde) && desde > inicio) inicio = desde;
  }
  return Math.min(inicio, agora);
}

/**
 * Os motivos de erro que o loader grava (track-fallback). Os bypass_* ficam de
 * fora: sao o loader SEGURANDO um desvio do tema e levando o carrinho mesmo
 * assim -- contar como erro faria rota boa parecer quebrada.
 */
export type MotivoErroDoScript = "cart_checkout_error" | "direct_checkout_error";

export const ROTULO_ERRO_DO_SCRIPT: Record<MotivoErroDoScript, string> = {
  cart_checkout_error: "ao levar o carrinho",
  direct_checkout_error: "no comprar agora",
};

export type Contagem =
  | { tipo: "contando"; n: number | null; desde: string | null }
  | { tipo: "sem_aviso"; lojas: { nome: string; motivo: string }[] }
  | { tipo: "conferindo" };

export interface FunilDaRota {
  dias: number;
  /** routed_ok na janela; null = a contagem falhou. */
  roteados: number | null;
  escapes: Contagem;
  /** So os motivos com ocorrencia, do maior para o menor. */
  erros: { motivo: MotivoErroDoScript; rotulo: string; n: number }[];
  /** null = alguma contagem de erro falhou. */
  totalErros: number | null;
  pedidos: Contagem & { conversao?: number | null };
}

export interface EntradaDoFunil {
  agora: number;
  dias?: number;
  roteados: number | null;
  erros: Record<MotivoErroDoScript, number | null>;
  vitrine: { nome: string; inscricao: InscricaoWebhook | null; escapes: number | null; desde: number | null };
  lojas: { nome: string; inscricao: InscricaoWebhook | null }[];
  pedidos: { n: number | null; desde: number | null; roteadosDesde: number | null };
}

function contagem(
  alvos: { nome: string; inscricao: InscricaoWebhook | null }[],
  n: number | null,
  desde: number | null,
  inicioDaJanela: number
): Contagem {
  const fora = alvos
    .filter((a) => a.inscricao && a.inscricao.estado !== "inscrito")
    .map((a) => ({ nome: a.nome, motivo: a.inscricao?.motivo || "o aviso da Shopify não está ligado" }));
  if (fora.length > 0) return { tipo: "sem_aviso", lojas: fora };
  if (alvos.length === 0 || alvos.some((a) => !a.inscricao) || desde === null) return { tipo: "conferindo" };
  return {
    tipo: "contando",
    n,
    // So diz "desde" quando a janela ficou mais curta que os N dias.
    desde: desde > inicioDaJanela + HORA ? new Date(desde).toISOString() : null,
  };
}

/**
 * O funil em estados para a tela. Zero so aparece quando o aviso da Shopify
 * esta ligado: loja sem orders/create mostra "sem aviso", nunca "0 pedidos".
 */
export function montarFunil(e: EntradaDoFunil): FunilDaRota {
  const dias = e.dias ?? DIAS_DO_FUNIL;
  const inicioDaJanela = e.agora - dias * DIA;

  const erros = (Object.keys(ROTULO_ERRO_DO_SCRIPT) as MotivoErroDoScript[])
    .map((motivo) => ({ motivo, rotulo: ROTULO_ERRO_DO_SCRIPT[motivo], n: e.erros[motivo] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const totalErros = Object.values(e.erros).some((n) => n === null)
    ? null
    : Object.values(e.erros).reduce<number>((s, n) => s + (n ?? 0), 0);

  const escapes = contagem(
    [{ nome: e.vitrine.nome, inscricao: e.vitrine.inscricao }],
    e.vitrine.escapes,
    e.vitrine.desde,
    inicioDaJanela
  );

  const base = contagem(e.lojas, e.pedidos.n, e.pedidos.desde, inicioDaJanela);
  const pedidos: FunilDaRota["pedidos"] =
    base.tipo === "contando"
      ? {
          ...base,
          conversao:
            base.n !== null && e.pedidos.roteadosDesde
              ? Math.round((base.n / e.pedidos.roteadosDesde) * 1000) / 10
              : null,
        }
      : base;

  return { dias, roteados: e.roteados, escapes, erros, totalErros, pedidos };
}
