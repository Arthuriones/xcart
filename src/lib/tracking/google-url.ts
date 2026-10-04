// ============================================================================
// O que vai para o Google, montado sem rede.
//
// Dois caminhos, escolhidos por DESTINO:
//
//   - Data Manager API (embaixo): o destino tem `customer_id` + `acoes`. E o
//     caminho oficial, devolve requestId e diagnostico.
//   - Ping /pagead/conversion (logo abaixo): o destino so tem AW- + rotulos.
//     Continua como estava ate o lojista configurar o outro. Nao confirma nada:
//     os 26 cliques reais que passaram por ele tiveram 200 e zero conversao.
//
// Modulo proprio, sem "server-only", para poder ser TESTADO. google-ads.ts e
// google-dm.ts ficam atras do `server-only`, e nenhum teste conseguiria olhar.
// ============================================================================

import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";
import { chaveDoEvento } from "@/lib/tracking/eventos";

export interface DadosDaConversao {
  /** AW-XXXXXXXXX, como o lojista copia do Google Ads. */
  conversionId: string;
  label: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  auid?: string | null;
  pageUrl?: string | null;
  orderId?: string | null;
  value?: number | null;
  currency?: string | null;
}

/** Null quando falta id ou rotulo -- sem os dois nao ha conversao nenhuma. */
export function montarUrlDeConversao(
  conv: DadosDaConversao,
  agora: number = Date.now()
): string | null {
  const numero = apenasNumeroDaConversao(conv.conversionId);
  const label = (conv.label || "").trim();
  if (!numero || !label) return null;

const url = new URL(`https://www.googleadservices.com/pagead/conversion/${numero}/`);

// ------------------------------------------------------------------------
// O conjunto abaixo foi COPIADO de uma requisicao real do gtag, capturada na
// conta do lojista -- nao inventado.
//
// Antes mandavamos `script=0`, que e o caminho do <noscript> (pixel em
// imagem, sem JavaScript). O gtag de verdade nao manda isso: ele manda
// `en=conversion` com `fmt=7&async=1`. Pedir para ser tratado como pixel
// sem script e uma afirmacao diferente da que queremos fazer.
//
// O que NAO foi copiado, e por que: `gcd`/`tag_exp`/`uaa..uapv` descrevem
// consentimento, experimentos e o navegador -- valores que so o navegador
// sabe e que inventados seriam mentira; `em`/`emd`/`ept` sao os campos de
// enhanced conversions, que a gente nao preenche (ver o cabecalho).
// ------------------------------------------------------------------------

url.searchParams.set("random", String(agora));
url.searchParams.set("cv", "11");
url.searchParams.set("fst", String(agora));
url.searchParams.set("fmt", "7");
url.searchParams.set("bg", "ffffff");
url.searchParams.set("guid", "ON");
url.searchParams.set("async", "1");
url.searchParams.set("en", "conversion");
url.searchParams.set("frm", "0");
url.searchParams.set("npa", "0");
url.searchParams.set("hn", "www.googleadservices.com");
url.searchParams.set("label", label);

// Um dos tres, nesta ordem de preferencia. O Google nunca manda mais de um
// para o mesmo clique, e mandar dois faria a requisicao ser descartada.
if (conv.gclid) url.searchParams.set("gclaw", conv.gclid);
else if (conv.gbraid) url.searchParams.set("gbraid", conv.gbraid);
else if (conv.wbraid) url.searchParams.set("wbraid", conv.wbraid);
// `oid` e o transaction id: mesma conversion action + mesmo oid = o Google
// descarta a segunda. E a rede de seguranca contra reentrega de webhook e
// contra o canal nativo mandando a mesma venda.
if (conv.orderId) url.searchParams.set("oid", String(conv.orderId));

// `auid` liga a conversao ao visitante mesmo sem click id. O gtag manda
// sempre; e o que mais aproxima a nossa requisicao da dele.
if (conv.auid) url.searchParams.set("auid", conv.auid);
if (conv.pageUrl) url.searchParams.set("url", conv.pageUrl);
if (typeof conv.value === "number" && Number.isFinite(conv.value)) {
  url.searchParams.set("value", String(conv.value));
}
if (conv.currency) url.searchParams.set("currency_code", conv.currency.toUpperCase());

  return url.toString();
}

// ============================================================================
// Data Manager API (modo offline, acoes UPLOAD_CLICKS)
//
// Doc: developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events
//
// O que este bloco decide, e por que cada regra existe:
//
//   - UM click id por evento, na ordem gclid > wbraid > gbraid. wbraid e o de
//     conversao WEB; gbraid e de app. O ping antigo fazia o contrario.
//   - Evento sem click id nao vai: a acao de importacao so credita por clique.
//   - Evento de teste nao vai: o "gclid" TESTE-* sairia como erro de verdade.
//   - Consentimento so o que o visitante disse. Sem valor = nao informar.
//     Mandar CONSENT_GRANTED fixo seria afirmar o que ninguem observou.
//   - 6 h de espera depois do evento: clique mais novo que isso o Google
//     recusa (TOO_RECENT_CLICK), e carrinho acontece minutos depois do clique.
// ============================================================================

/** Os eventos que viram acao de importacao no Google. */
export const EVENTOS_DATA_MANAGER = ["purchase", "add_to_cart", "begin_checkout"] as const;
export type EventoDataManager = (typeof EVENTOS_DATA_MANAGER)[number];

/** ID numerico da acao UPLOAD_CLICKS, por evento. */
export type AcoesDataManager = Partial<Record<EventoDataManager, string>>;

export interface ConfigDataManager {
  /** operatingAccount: 10 digitos, sem traco. Nao e o AW-. */
  customerId: string | null;
  /** loginAccount: a MCC, so quando a service account entrou por ela. */
  loginCustomerId: string | null;
  acoes: AcoesDataManager;
}

/** Espera minima entre o evento e o envio. Ver o cabecalho. */
export const ESPERA_DO_CLIQUE_MS = 6 * 60 * 60 * 1000;

/** O diagnostico existe de 30 min a 24 h depois do envio. */
export const PRIMEIRA_CONFERENCIA_MS = 30 * 60 * 1000;
export const PRAZO_DO_DIAGNOSTICO_MS = 24 * 60 * 60 * 1000;

const SO_DIGITOS = /^\d+$/;

/** "123-456-7890" ou "1234567890" -> "1234567890". Outro tamanho = null. */
export function idDeCliente(bruto: unknown): string | null {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  return digitos.length === 10 ? digitos : null;
}

/** So os eventos da lista, so valor numerico. O resto fica de fora. */
export function limparAcoes(bruto: unknown): AcoesDataManager {
  if (!bruto || typeof bruto !== "object") return {};
  const saida: AcoesDataManager = {};
  for (const chave of EVENTOS_DATA_MANAGER) {
    const valor = String((bruto as Record<string, unknown>)[chave] ?? "").trim();
    if (valor && SO_DIGITOS.test(valor) && valor.length <= 20) saida[chave] = valor;
  }
  return saida;
}

/** O destino Google vai pela Data Manager? So com conta e ao menos uma acao. */
export function usaDataManager(d: {
  customerId?: string | null;
  acoes?: AcoesDataManager | null;
}): boolean {
  return Boolean(d.customerId) && Object.keys(d.acoes ?? {}).length > 0;
}

/** A acao do evento, ou null quando o destino nao quer este evento. */
export function acaoDoEvento(
  acoes: AcoesDataManager | null | undefined,
  nomeDoEvento: string
): string | null {
  const chave = chaveDoEvento(nomeDoEvento);
  if (!chave) return null;
  const valor = (acoes as Record<string, string | undefined> | null | undefined)?.[chave];
  return valor && SO_DIGITOS.test(valor) ? valor : null;
}

/**
 * Le e confere o que a tela mandou.
 *
 * Tudo vazio e valido: e "desligar a Data Manager", e o destino volta ao
 * caminho antigo. Meio preenchido nao: conta sem acao (ou o contrario) ficaria
 * na tela como configurado e nao mandaria nada.
 */
export function validarConfigDataManager(corpo: {
  customerId?: unknown;
  loginCustomerId?: unknown;
  acoes?: unknown;
}): { erro: string } | ConfigDataManager {
  const customerBruto = String(corpo.customerId ?? "").trim();
  const loginBruto = String(corpo.loginCustomerId ?? "").trim();
  const acoesBrutas =
    corpo.acoes && typeof corpo.acoes === "object"
      ? Object.values(corpo.acoes as Record<string, unknown>)
          .map((v) => String(v ?? "").trim())
          .filter(Boolean)
      : [];

  if (!customerBruto && !loginBruto && acoesBrutas.length === 0) {
    return { customerId: null, loginCustomerId: null, acoes: {} };
  }

  const customerId = idDeCliente(customerBruto);
  if (!customerId) {
    return { erro: "ID do cliente inválido: são 10 dígitos, como 123-456-7890. Não é o AW-." };
  }
  const loginCustomerId = loginBruto ? idDeCliente(loginBruto) : null;
  if (loginBruto && !loginCustomerId) {
    return { erro: "ID da MCC inválido: são 10 dígitos, como 123-456-7890." };
  }
  if (acoesBrutas.some((v) => !SO_DIGITOS.test(v))) {
    return { erro: "O ID da ação tem só dígitos. Ele aparece na URL da ação, depois de ctId=." };
  }
  const acoes = limparAcoes(corpo.acoes);
  if (Object.keys(acoes).length === 0) {
    return { erro: "Preencha o ID de ao menos uma ação (Compra, Carrinho ou Checkout)." };
  }
  return { customerId, loginCustomerId, acoes };
}

/** Em que pe esta o envio pela Data Manager deste destino. */
export function estadoDataManager(
  cfg: { customerId?: string | null; acoes?: AcoesDataManager | null },
  temCredencial: boolean
): "nao_configurado" | "falta_credencial" | "pronto" {
  if (!usaDataManager(cfg)) return "nao_configurado";
  return temCredencial ? "pronto" : "falta_credencial";
}

export type CliqueGoogle = { gclid: string } | { wbraid: string } | { gbraid: string };

/** Um click id so, na ordem gclid > wbraid > gbraid. Nenhum = null. */
export function cliqueParaGoogle(p: {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
}): CliqueGoogle | null {
  const limpo = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const gclid = limpo(p.gclid);
  if (gclid) return { gclid };
  const wbraid = limpo(p.wbraid);
  if (wbraid) return { wbraid };
  const gbraid = limpo(p.gbraid);
  if (gbraid) return { gbraid };
  return null;
}

/**
 * Evento de teste: marcado pelo coletor (`teste: true`) ou com click id
 * inventado (TESTE-*, que e como se testa na mao). Maiusculo de proposito: um
 * gclid real tem "test" minusculo por acaso com frequencia bem maior.
 */
export function ehEventoDeTeste(p: {
  teste?: unknown;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
}): boolean {
  if (p.teste === true) return true;
  return [p.gclid, p.gbraid, p.wbraid].some((v) => typeof v === "string" && v.includes("TEST"));
}

/**
 * A chave que o Google usa para nao contar duas vezes.
 *
 *   compra     o numero do pedido (o webhook grava em `orderId`);
 *   checkout   o token do checkout, no MESMO formato que o coletor da ao evento
 *              do Web Pixel -- recarregar o checkout nao vira outra conversao;
 *   carrinho   o id do evento.
 */
export function transactionIdDoEvento(linha: {
  event_name: string;
  event_id?: string | null;
  checkout_token?: string | null;
  payload?: { orderId?: unknown } | null;
}): string | null {
  const chave = chaveDoEvento(linha.event_name);
  if (chave === "begin_checkout" && linha.checkout_token) {
    return `begin_checkout_ck_${linha.checkout_token}`.slice(0, 200);
  }
  const doPayload = String(linha.payload?.orderId ?? "").trim();
  return doPayload || (linha.event_id ? String(linha.event_id) : null);
}

export type Consentimento = {
  adUserData: "CONSENT_GRANTED" | "CONSENT_DENIED";
  adPersonalization: "CONSENT_GRANTED" | "CONSENT_DENIED";
};

/** O que o visitante escolheu. Sem escolha registrada = null (nao informar). */
export function consentimentoParaGoogle(valor: unknown): Consentimento | null {
  if (valor === "concedido") {
    return { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" };
  }
  if (valor === "negado") {
    return { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" };
  }
  return null;
}

export interface EventoParaDataManager {
  customerId: string;
  loginCustomerId?: string | null;
  acao: string;
  clique: CliqueGoogle;
  transactionId: string | null;
  /** Quando o evento aconteceu. */
  quando: Date;
  valor?: number | null;
  moeda?: string | null;
  /** `payload.consentimento`: 'concedido' | 'negado' | ausente. */
  consentimento?: unknown;
  /** So no script de teste: o Google confere o formato e nao grava nada. */
  validateOnly?: boolean;
}

/** O corpo do POST events:ingest. Um evento por requisicao: requestId = linha. */
export function montarCorpoDataManager(e: EventoParaDataManager): Record<string, unknown> {
  const destino: Record<string, unknown> = {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: e.customerId },
    productDestinationId: e.acao,
  };
  if (e.loginCustomerId && e.loginCustomerId !== e.customerId) {
    destino.loginAccount = { accountType: "GOOGLE_ADS", accountId: e.loginCustomerId };
  }

  const evento: Record<string, unknown> = {
    adIdentifiers: e.clique,
    eventTimestamp: e.quando.toISOString(),
    eventSource: "WEB",
  };
  if (e.transactionId) evento.transactionId = e.transactionId;
  const moeda = (e.moeda || "").trim().toUpperCase();
  if (typeof e.valor === "number" && Number.isFinite(e.valor) && e.valor > 0 && moeda) {
    evento.conversionValue = e.valor;
    evento.currency = moeda;
  }
  const consent = consentimentoParaGoogle(e.consentimento);
  if (consent) evento.consent = consent;

  const corpo: Record<string, unknown> = { destinations: [destino], events: [evento] };
  if (e.validateOnly) corpo.validateOnly = true;
  return corpo;
}

// ---------------------------------------------------------------------------
// Diagnostico (requestStatus:retrieve)
// ---------------------------------------------------------------------------

/** O que fazer com a linha depois de ler o diagnostico. */
export type Desfecho =
  | { tipo: "ok"; aviso?: string }
  | { tipo: "esperar" }
  | { tipo: "reenviar"; motivo: string }
  | { tipo: "clique_de_outra_conta"; motivo: string }
  | { tipo: "sem_consentimento"; motivo: string }
  | { tipo: "falhou"; motivo: string };

const PREFIXO = /^PROCESSING_ERROR(_REASON)?_/;

/** Os motivos que o lojista resolve, em portugues. O resto vai com o nome cru. */
const MOTIVOS: Record<string, string> = {
  INVALID_GCLID: "gclid inválido",
  INVALID_GBRAID: "gbraid inválido",
  INVALID_WBRAID: "wbraid inválido",
  INVALID_AD_IDENTIFIERS: "click id inválido",
  EVENT_TOO_OLD: "evento mais velho que a janela da ação",
  CONVERSION_PRECEDES_CLICK: "evento anterior ao clique",
  NO_CONSENT: "a conta não aceitou os termos de consentimento do Google Ads",
  CLICK_NOT_FOUND: "o Google não achou o clique nesta conta",
  INVALID_CLICK: "clique que não pode ser atribuído",
  INVALID_OPERATING_ACCOUNT_FOR_CLICK: "o clique é de outra conta",
  OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER: "o clique é de outra conta",
  ONE_PER_CLICK_CONVERSION_ACTION_NOT_PERMITTED_WITH_BRAID:
    "ação 'uma por clique' não aceita wbraid/gbraid: mude a contagem para 'todas'",
  INTERNAL_ERROR: "erro interno do Google",
};

/** Click id que nao e desta conta. Com varias contas na loja, e o esperado. */
const DE_OUTRA_CONTA = new Set([
  "CLICK_NOT_FOUND",
  "INVALID_CLICK",
  "INVALID_OPERATING_ACCOUNT_FOR_CLICK",
  "OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER",
]);
/** Ja estava la: a conversao conta uma vez, que e o que se queria. */
const JA_CONTADA = new Set(["DUPLICATE_TRANSACTION_ID", "DUPLICATE_GCLID"]);
/** O visitante disse nao (ou nao disse). Descartar e o certo, nao um erro. */
const SEM_CONSENTIMENTO = new Set(["DENIED_CONSENT", "UNKNOWN_CONSENT"]);

export function motivoLegivel(reason: string): string {
  const curto = reason.replace(PREFIXO, "");
  return MOTIVOS[curto] ? `${MOTIVOS[curto]} (${curto})` : curto;
}

/**
 * Le a resposta do requestStatus:retrieve de UM envio (um destino, um evento).
 *
 * Formato (reference/rest/v1/requestStatus/retrieve):
 *   { requestStatusPerDestination: [{ requestStatus, errorInfo: { errorCounts:
 *     [{ reason, recordCount }] } }] }
 * O enum da REST e FAILED; o guia fala em FAILURE. Os dois valem.
 */
export function lerDiagnostico(resposta: unknown): Desfecho {
  const destinos = (resposta as { requestStatusPerDestination?: unknown[] } | null)
    ?.requestStatusPerDestination;
  const primeiro = (Array.isArray(destinos) ? destinos[0] : null) as {
    requestStatus?: string;
    errorInfo?: { errorCounts?: { reason?: string }[] };
  } | null;
  const status = String(primeiro?.requestStatus ?? "");

  if (status === "SUCCESS") return { tipo: "ok" };
  if (status !== "FAILED" && status !== "FAILURE" && status !== "PARTIAL_SUCCESS") {
    // PROCESSING, REQUEST_STATUS_UNKNOWN ou resposta sem destino: ainda nao.
    return { tipo: "esperar" };
  }

  const motivos = (primeiro?.errorInfo?.errorCounts ?? [])
    .map((c) => String(c?.reason ?? "").replace(PREFIXO, ""))
    .filter(Boolean);

  // PARTIAL_SUCCESS sem motivo, com um evento so, e o evento que passou.
  if (motivos.length === 0) {
    return status === "PARTIAL_SUCCESS"
      ? { tipo: "ok" }
      : { tipo: "falhou", motivo: "Google recusou sem dizer o motivo" };
  }

  if (motivos.every((m) => JA_CONTADA.has(m))) return { tipo: "ok", aviso: "já estava no Google" };
  if (motivos.includes("TOO_RECENT_CLICK")) {
    return { tipo: "reenviar", motivo: "clique recente demais: reenvio em 6 h" };
  }
  // Falha do lado do Google: nao entrou, entao reenviar (mesmo transactionId,
  // limitado por MAX_TENTATIVAS) nao duplica.
  if (motivos.includes("INTERNAL_ERROR")) {
    return { tipo: "reenviar", motivo: "erro interno do Google: reenvio em 6 h" };
  }
  if (motivos.every((m) => SEM_CONSENTIMENTO.has(m))) {
    return { tipo: "sem_consentimento", motivo: "sem consentimento do visitante: o Google descartou" };
  }
  const texto = motivos.map((m) => motivoLegivel(m)).join("; ");
  if (motivos.every((m) => DE_OUTRA_CONTA.has(m))) {
    return { tipo: "clique_de_outra_conta", motivo: `Google recusou: ${texto}` };
  }
  return { tipo: "falhou", motivo: `Google recusou: ${texto}` };
}

/**
 * Clique que esta conta nao achou: e de outra conta da MESMA loja, ou erro?
 *
 * A loja com duas contas manda todo evento para as duas, e so a dona do clique
 * aceita. Entao "nao achei" so e erro quando NENHUMA irma aceitou. Irma ainda
 * sem diagnostico = esperar; passado o prazo, decide com o que tem. Irma que
 * tambem nao achou NAO conta como "esperando" -- senao as duas esperariam uma
 * pela outra para sempre.
 *
 * Irma 'enviado' sem situacao e a conta que ficou no ping antigo (a Data
 * Manager sempre grava response.dm.situacao). O ping nao diz de quem e o
 * clique, entao conta como possivel dona: nao e esta conta que tem o que
 * consertar.
 */
export function decidirCliqueDeOutraConta(
  irmas: { status: string; situacao: string | null }[],
  prazoEsgotado: boolean
): "nao_e_desta_conta" | "esperar" | "falhou" {
  if (irmas.some((i) => i.situacao === "ok" || (i.status === "enviado" && i.situacao === null))) {
    return "nao_e_desta_conta";
  }
  if (
    !prazoEsgotado &&
    irmas.some((i) => i.status === "pendente" || i.situacao === "processando")
  ) {
    return "esperar";
  }
  return "falhou";
}

/** Espera crescente entre conferencias: 30 min, 1 h, 2 h, 4 h, 8 h, 8 h... */
export function proximaConferenciaEm(conferenciasFeitas: number, agora = Date.now()): Date {
  const passos = Math.min(Math.max(0, conferenciasFeitas), 4);
  return new Date(agora + PRIMEIRA_CONFERENCIA_MS * Math.pow(2, passos));
}
