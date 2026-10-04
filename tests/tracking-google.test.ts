import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { apenasNumeroDaConversao } from "../src/lib/tracking/normalizar";
import {
  acaoDoEvento,
  cliqueParaGoogle,
  consentimentoParaGoogle,
  decidirCliqueDeOutraConta,
  ehEventoDeTeste,
  estadoDataManager,
  lerDiagnostico,
  montarCorpoDataManager,
  montarUrlDeConversao,
  proximaConferenciaEm,
  transactionIdDoEvento,
  usaDataManager,
  validarConfigDataManager,
} from "../src/lib/tracking/google-url";
import { montarConversaoGoogle, type PedidoShopify } from "../src/lib/tracking/purchase";

// ---------------------------------------------------------------------------
// Rede e banco falsos, para exercitar a fila de verdade (fila.ts, destinos.ts,
// google-dm.ts) sem sair da maquina. Um ponto so de rede: safeFetch, que e por
// onde passam Data Manager, token do Google, ping antigo e Meta.
// ---------------------------------------------------------------------------
type Filtro = [string, string, unknown];
interface Consulta {
  tabela: string;
  op: "select" | "update";
  valores: Record<string, unknown> | null;
  filtros: Filtro[];
}

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  rede: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: (url: string, init?: RequestInit) => mundo.rede(url, init),
}));

/** Banco falso: grava toda consulta; `responder` decide o que o SELECT devolve. */
function bancoFalso(responder: (c: Consulta) => unknown[] = () => []) {
  const consultas: Consulta[] = [];
  const admin = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: "select", valores: null, filtros: [] };
      const b: Record<string, unknown> = {};
      const anota = (op: string) => (col: string, v: unknown) => {
        c.filtros.push([op, col, v]);
        return b;
      };
      Object.assign(b, {
        select: () => b,
        update: (v: Record<string, unknown>) => {
          c.op = "update";
          c.valores = v;
          return b;
        },
        eq: anota("eq"),
        neq: anota("neq"),
        lte: anota("lte"),
        order: () => b,
        limit: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
          consultas.push(c);
          const data = c.op === "select" ? responder(c) : null;
          return Promise.resolve({ data, error: null }).then(ok, erro);
        },
      });
      return b;
    },
  };
  mundo.admin = admin;
  return {
    admin: admin as never,
    updates: () => consultas.filter((c) => c.op === "update"),
  };
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const chamadas: { url: string; init?: RequestInit }[] = [];
let diagnostico: unknown = null;
let respostaIngest: () => Response = () => json({ requestId: "req-1" });

function redePadrao() {
  chamadas.length = 0;
  mundo.rede = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return json({ access_token: "tok-google", expires_in: 3600 });
    }
    if (url === "https://datamanager.googleapis.com/v1/events:ingest") return respostaIngest();
    if (url.startsWith("https://datamanager.googleapis.com/v1/requestStatus:retrieve")) {
      return json(diagnostico);
    }
    if (url.startsWith("https://www.googleadservices.com/")) return new Response("", { status: 200 });
    if (url.startsWith("https://graph.facebook.com/")) return json({ events_received: 1 });
    throw new Error(`rede inesperada: ${url}`);
  };
}

interface CorpoIngest {
  destinations: Record<string, unknown>[];
  events: Record<string, unknown>[];
  validateOnly?: boolean;
}

const ingests = () =>
  chamadas
    .filter((c) => c.url.endsWith("/v1/events:ingest"))
    .map((c) => JSON.parse(String(c.init?.body)) as CorpoIngest);

let chavePublica = "";
function ligarCredencial(email = "xcart@projeto.iam.gserviceaccount.com") {
  const par = generateKeyPairSync("rsa", { modulusLength: 2048 });
  chavePublica = par.publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.GOOGLE_DM_SA_EMAIL = email;
  // Como a Vercel guarda a chave colada numa linha so: "\n" literal.
  process.env.GOOGLE_DM_SA_KEY = par.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString()
    .replace(/\n/g, "\\n");
}
function desligarCredencial() {
  delete process.env.GOOGLE_DM_SA_EMAIL;
  delete process.env.GOOGLE_DM_SA_KEY;
}

const PEDIDO: PedidoShopify = {
  id: 5544332211,
  currency: "jpy",
  total_price: "12800",
  created_at: "2026-09-25T12:00:00Z",
  note_attributes: [
    { name: "gclid", value: "Cj0KCQ-TESTE" },
    { name: "_xc_vid", value: "abc.123" },
  ],
  line_items: [{ product_id: 1, variant_id: 11, quantity: 2, price: "6400" }],
};

describe("conversao do Google Ads a partir do pedido", () => {
  it("aceita o AW- como o lojista copia e como so numero", () => {
    // O painel do Google mostra "AW-123456789"; o caminho do endpoint leva so
    // o numero. Exigir um formato so renderia o erro mais bobo possivel.
    expect(apenasNumeroDaConversao("AW-123456789")).toBe("123456789");
    expect(apenasNumeroDaConversao("123456789")).toBe("123456789");
    expect(apenasNumeroDaConversao("  AW-987654321 ")).toBe("987654321");
    expect(apenasNumeroDaConversao("AW-")).toBeNull();
    expect(apenasNumeroDaConversao("")).toBeNull();
  });

  it("le o gclid do cart attribute", () => {
    // Cookie nao chega ao checkout da Shopify -- e outro dominio. O cart
    // attribute e a unica ponte entre o clique no anuncio e o pedido.
    expect(montarConversaoGoogle(PEDIDO).gclid).toBe("Cj0KCQ-TESTE");
  });

  it("cai para a identidade guardada quando o atributo nao veio", () => {
    const semAtributo = { ...PEDIDO, note_attributes: [] };
    expect(
      montarConversaoGoogle(semAtributo, { identidade: { gclid: "DO-BANCO" } }).gclid
    ).toBe("DO-BANCO");
  });

  it("sem gclid em lugar nenhum devolve null, nao string vazia", () => {
    // null e o sinal de "conversao sem atribuicao"; "" passaria pelo if e
    // iria para a URL como gclaw vazio.
    const seco = { ...PEDIDO, note_attributes: [] };
    expect(montarConversaoGoogle(seco).gclid).toBeNull();
  });

  it("o oid e o numero do pedido -- e o que deduplica no Google", () => {
    // Mesma conversion action com o mesmo oid: o Google descarta a segunda.
    // Protege contra reentrega de webhook e contra o canal nativo.
    expect(montarConversaoGoogle(PEDIDO).orderId).toBe("5544332211");
  });

  it("valor e moeda saem prontos para a URL", () => {
    const c = montarConversaoGoogle(PEDIDO);
    expect(c.value).toBe(12800);
    expect(c.currency).toBe("JPY");
  });

  it("gbraid e wbraid tambem sao capturados", () => {
    // iOS quebrou o gclid em parte do trafego; o Google manda um destes no
    // lugar. Ignorar os dois perderia a atribuicao desse trafego inteiro.
    const ios = {
      ...PEDIDO,
      note_attributes: [{ name: "gbraid", value: "GB-123" }],
    };
    const c = montarConversaoGoogle(ios);
    expect(c.gbraid).toBe("GB-123");
    expect(c.gclid).toBeNull();
  });
});

/**
 * iOS: o Google manda gbraid OU wbraid no lugar do gclid, nunca os tres.
 * Capturar e nao enviar deixava esse trafego inteiro sem atribuicao.
 */
describe("click id de iOS chega ao envio", () => {
  it("gbraid vira parametro proprio quando nao ha gclid", async () => {
    const { montarConversaoGoogle } = await import("../src/lib/tracking/purchase");
    const c = montarConversaoGoogle({
      id: 1,
      currency: "JPY",
      total_price: "100",
      note_attributes: [{ name: "wbraid", value: "WB-999" }],
    });
    expect(c.gclid).toBeNull();
    expect(c.wbraid).toBe("WB-999");
  });
});

/**
 * A requisicao do nosso servidor foi espelhada numa requisicao REAL do gtag,
 * capturada na conta do lojista. O que estes testes travam e o que fazia a
 * nossa parecer outra coisa.
 */
describe("a requisicao imita o gtag de verdade", () => {
  const base = { conversionId: "AW-18419000686", label: "RotuloX" };

  function urlDe(extra: Record<string, unknown> = {}) {
    // O modulo puro, nao google-ads.ts: aquele tem "server-only" e o vitest
    // nao consegue importar. Foi por isso que a montagem da URL saiu de la.
    const u = montarUrlDeConversao({ ...base, ...extra });
    return new URL(u!);
  }

  it("declara o evento com en=conversion", () => {
    // Antes mandavamos `script=0`, que e o caminho do <noscript> -- pixel de
    // imagem sem JavaScript. E uma afirmacao diferente da que queremos fazer.
    const u = urlDe();
    expect(u.searchParams.get("en")).toBe("conversion");
    expect(u.searchParams.get("script")).toBeNull();
  });

  it("leva o auid, que atribui mesmo sem click id", () => {
    const u = urlDe({ auid: "1502556589.1790803952" });
    expect(u.searchParams.get("auid")).toBe("1502556589.1790803952");
  });

  it("omite o auid quando nao ha, em vez de mandar vazio", () => {
    const u = urlDe();
    expect(u.searchParams.has("auid")).toBe(false);
  });

  it("NAO inventa consentimento nem dados do navegador", () => {
    // gcd, tag_exp e os uaa..uapv descrevem coisas que so o navegador sabe.
    // Preencher do servidor seria afirmar o que nao foi observado.
    const u = urlDe({ auid: "1.2" });
    for (const proibido of ["gcd", "tag_exp", "uaa", "uap", "uapv", "em", "emd"]) {
      expect(u.searchParams.has(proibido), proibido).toBe(false);
    }
  });

  it("continua deduplicando por oid e levando o click id", () => {
    const u = urlDe({ gclid: "G123", orderId: "pedido-7" });
    expect(u.searchParams.get("gclaw")).toBe("G123");
    expect(u.searchParams.get("oid")).toBe("pedido-7");
  });
});

// ===========================================================================
// Data Manager API: as regras puras
// ===========================================================================

describe("Data Manager: o que vai no evento", () => {
  it("um click id so, na ordem gclid > wbraid > gbraid", () => {
    // wbraid e o de conversao WEB; o ping antigo preferia o gbraid (de app).
    expect(cliqueParaGoogle({ gclid: "G", gbraid: "GB", wbraid: "WB" })).toEqual({ gclid: "G" });
    expect(cliqueParaGoogle({ gbraid: "GB", wbraid: "WB" })).toEqual({ wbraid: "WB" });
    expect(cliqueParaGoogle({ gbraid: "GB" })).toEqual({ gbraid: "GB" });
    expect(cliqueParaGoogle({ gclid: "  ", gbraid: null, wbraid: "" })).toBeNull();
  });

  it("teste nao vai: marcado pelo coletor ou click id TESTE-*", () => {
    expect(ehEventoDeTeste({ teste: true, gclid: "Cj0real" })).toBe(true);
    expect(ehEventoDeTeste({ gclid: "TESTE-123" })).toBe(true);
    expect(ehEventoDeTeste({ wbraid: "Cj0KCQ-TESTE" })).toBe(true);
    expect(ehEventoDeTeste({ gclid: "Cj0KCQjwtest" })).toBe(false);
    expect(ehEventoDeTeste({ teste: "true", gclid: "Cj0real" })).toBe(false);
  });

  it("transactionId: pedido na compra, token no checkout, id do evento no carrinho", () => {
    expect(
      transactionIdDoEvento({ event_name: "Purchase", event_id: "x", payload: { orderId: "5544332211" } })
    ).toBe("5544332211");
    // Tema e pixel do mesmo checkout ficam com a mesma chave.
    expect(
      transactionIdDoEvento({
        event_name: "begin_checkout",
        event_id: "begin_checkout_v_1790",
        checkout_token: "abc123",
        payload: { orderId: "begin_checkout_v_1790" },
      })
    ).toBe("begin_checkout_ck_abc123");
    expect(
      transactionIdDoEvento({
        event_name: "add_to_cart",
        event_id: "add_to_cart_v_1",
        payload: { orderId: "add_to_cart_v_1" },
      })
    ).toBe("add_to_cart_v_1");
    expect(transactionIdDoEvento({ event_name: "add_to_cart", event_id: "e-9", payload: {} })).toBe("e-9");
  });

  it("consentimento so o que o visitante disse; sem valor nao informa", () => {
    expect(consentimentoParaGoogle("concedido")).toEqual({
      adUserData: "CONSENT_GRANTED",
      adPersonalization: "CONSENT_GRANTED",
    });
    expect(consentimentoParaGoogle("negado")).toEqual({
      adUserData: "CONSENT_DENIED",
      adPersonalization: "CONSENT_DENIED",
    });
    for (const nada of [null, undefined, "", "sim", true]) {
      expect(consentimentoParaGoogle(nada)).toBeNull();
    }
  });

  const base = {
    customerId: "1234567890",
    acao: "987654321",
    clique: { gclid: "Cj0real" } as const,
    transactionId: "5544332211",
    quando: new Date("2026-10-03T12:00:00Z"),
  };

  it("monta o corpo do events:ingest como a doc do modo offline", () => {
    const corpo = montarCorpoDataManager({ ...base, valor: 129.9, moeda: "usd", consentimento: "concedido" });
    expect(corpo).toEqual({
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          productDestinationId: "987654321",
        },
      ],
      events: [
        {
          adIdentifiers: { gclid: "Cj0real" },
          eventTimestamp: "2026-10-03T12:00:00.000Z",
          eventSource: "WEB",
          transactionId: "5544332211",
          conversionValue: 129.9,
          currency: "USD",
          consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
        },
      ],
    });
  });

  it("sem valor, sem consentimento e sem validateOnly quando nao ha", () => {
    const corpo = montarCorpoDataManager(base) as { events: Record<string, unknown>[] };
    const evento = corpo.events[0];
    expect(evento).not.toHaveProperty("conversionValue");
    expect(evento).not.toHaveProperty("currency");
    expect(evento).not.toHaveProperty("consent");
    expect(corpo).not.toHaveProperty("validateOnly");
    // Valor sem moeda nao vai: o Google recusaria ou converteria errado.
    const semMoeda = montarCorpoDataManager({ ...base, valor: 10 }) as { events: Record<string, unknown>[] };
    expect(semMoeda.events[0]).not.toHaveProperty("conversionValue");
  });

  it("MCC so entra quando e outra conta", () => {
    const comMcc = montarCorpoDataManager({ ...base, loginCustomerId: "1112223334" }) as {
      destinations: Record<string, unknown>[];
    };
    expect(comMcc.destinations[0].loginAccount).toEqual({ accountType: "GOOGLE_ADS", accountId: "1112223334" });
    const mesma = montarCorpoDataManager({ ...base, loginCustomerId: "1234567890" }) as {
      destinations: Record<string, unknown>[];
    };
    expect(mesma.destinations[0]).not.toHaveProperty("loginAccount");
    const teste = montarCorpoDataManager({ ...base, validateOnly: true });
    expect(teste.validateOnly).toBe(true);
  });
});

describe("Data Manager: configuracao do destino", () => {
  it("tudo vazio desliga (volta ao caminho antigo)", () => {
    expect(validarConfigDataManager({})).toEqual({ customerId: null, loginCustomerId: null, acoes: {} });
    expect(validarConfigDataManager({ customerId: " ", acoes: { purchase: "" } })).toEqual({
      customerId: null,
      loginCustomerId: null,
      acoes: {},
    });
  });

  it("aceita o ID com traco e guarda so digitos", () => {
    expect(
      validarConfigDataManager({
        customerId: "123-456-7890",
        loginCustomerId: "",
        acoes: { purchase: " 111 ", add_to_cart: "222", view_item: "999" },
      })
    ).toEqual({ customerId: "1234567890", loginCustomerId: null, acoes: { purchase: "111", add_to_cart: "222" } });
  });

  it("recusa meio preenchido e formato errado", () => {
    expect(validarConfigDataManager({ customerId: "AW-18419000686", acoes: { purchase: "1" } })).toHaveProperty("erro");
    expect(validarConfigDataManager({ customerId: "1234567890" })).toHaveProperty("erro");
    expect(validarConfigDataManager({ acoes: { purchase: "1" } })).toHaveProperty("erro");
    expect(validarConfigDataManager({ customerId: "1234567890", acoes: { purchase: "abc" } })).toHaveProperty("erro");
    expect(
      validarConfigDataManager({ customerId: "1234567890", loginCustomerId: "12", acoes: { purchase: "1" } })
    ).toHaveProperty("erro");
  });

  it("usa a Data Manager so com conta e acao; acao por evento, com a caixa da compra", () => {
    expect(usaDataManager({ customerId: "1234567890", acoes: { purchase: "1" } })).toBe(true);
    expect(usaDataManager({ customerId: "1234567890", acoes: {} })).toBe(false);
    expect(usaDataManager({ customerId: null, acoes: { purchase: "1" } })).toBe(false);
    // O webhook grava "Purchase", nome do Meta.
    expect(acaoDoEvento({ purchase: "111" }, "Purchase")).toBe("111");
    expect(acaoDoEvento({ purchase: "111" }, "view_item")).toBeNull();
    expect(estadoDataManager({ customerId: "1234567890", acoes: { purchase: "1" } }, false)).toBe("falta_credencial");
    expect(estadoDataManager({ customerId: "1234567890", acoes: { purchase: "1" } }, true)).toBe("pronto");
    expect(estadoDataManager({ customerId: null, acoes: {} }, true)).toBe("nao_configurado");
  });
});

describe("Data Manager: leitura do diagnostico", () => {
  const com = (requestStatus: string, ...reasons: string[]) => ({
    requestStatusPerDestination: [
      {
        requestStatus,
        errorInfo: { errorCounts: reasons.map((reason) => ({ reason, recordCount: "1" })) },
      },
    ],
  });

  it("SUCCESS conta; PROCESSING e resposta vazia esperam", () => {
    expect(lerDiagnostico(com("SUCCESS"))).toEqual({ tipo: "ok" });
    expect(lerDiagnostico(com("PROCESSING"))).toEqual({ tipo: "esperar" });
    expect(lerDiagnostico({})).toEqual({ tipo: "esperar" });
    expect(lerDiagnostico(null)).toEqual({ tipo: "esperar" });
  });

  it("clique recente volta para a fila, nao e falha", () => {
    expect(lerDiagnostico(com("FAILED", "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK")).tipo).toBe("reenviar");
  });

  it("clique de outra conta e transactionId repetido nao sao erro", () => {
    expect(lerDiagnostico(com("FAILED", "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND")).tipo).toBe(
      "clique_de_outra_conta"
    );
    expect(
      lerDiagnostico(com("FAILED", "PROCESSING_ERROR_OPERATING_ACCOUNT_MISMATCH_FOR_AD_IDENTIFIER")).tipo
    ).toBe("clique_de_outra_conta");
    expect(lerDiagnostico(com("FAILED", "PROCESSING_ERROR_REASON_DUPLICATE_TRANSACTION_ID")).tipo).toBe("ok");
    expect(lerDiagnostico(com("FAILURE", "PROCESSING_ERROR_REASON_DENIED_CONSENT")).tipo).toBe(
      "sem_consentimento"
    );
  });

  it("recusa de verdade vira falha com o motivo legivel", () => {
    const d = lerDiagnostico(com("FAILED", "PROCESSING_ERROR_REASON_INVALID_GCLID"));
    expect(d).toEqual({ tipo: "falhou", motivo: "Google recusou: gclid inválido (INVALID_GCLID)" });
    // Conta sem os termos de consentimento: o lojista resolve, entao e erro.
    expect(lerDiagnostico(com("FAILED", "PROCESSING_ERROR_REASON_NO_CONSENT")).tipo).toBe("falhou");
    // Motivo misto nao se esconde atras do "outra conta".
    expect(
      lerDiagnostico(
        com("FAILED", "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND", "PROCESSING_ERROR_REASON_EVENT_TOO_OLD")
      ).tipo
    ).toBe("falhou");
  });

  it("varias contas: so e erro quando nenhuma irma aceitou", () => {
    expect(decidirCliqueDeOutraConta([{ status: "enviado", situacao: "ok" }], false)).toBe("nao_e_desta_conta");
    expect(decidirCliqueDeOutraConta([{ status: "enviado", situacao: "processando" }], false)).toBe("esperar");
    expect(decidirCliqueDeOutraConta([{ status: "pendente", situacao: null }], false)).toBe("esperar");
    // A irma que tambem nao achou nao e "esperando": as duas nao travam.
    expect(decidirCliqueDeOutraConta([{ status: "enviado", situacao: "clique_nao_achado" }], false)).toBe(
      "falhou"
    );
    expect(decidirCliqueDeOutraConta([{ status: "enviado", situacao: "processando" }], true)).toBe("falhou");
    expect(decidirCliqueDeOutraConta([], false)).toBe("falhou");
  });

  it("espera crescente: 30 min, 1 h, 2 h, 4 h, 8 h e para em 8 h", () => {
    const min = (n: number) => (proximaConferenciaEm(n, 0).getTime() / 60000);
    expect([0, 1, 2, 3, 4, 5].map(min)).toEqual([30, 60, 120, 240, 480, 480]);
  });
});

// ===========================================================================
// Data Manager: a fila de verdade, com rede e banco falsos
// ===========================================================================

const DESTINO_DM = {
  id: "dest-dm",
  storeId: "loja-1",
  plataforma: "google" as const,
  nome: null,
  conta: "AW-18463882690",
  labels: { add_to_cart: "rotulo-antigo" },
  testEventCode: null,
  idTemplate: null,
  ativo: true,
  customerId: "1234567890",
  loginCustomerId: null,
  acoes: { purchase: "111", add_to_cart: "222", begin_checkout: "333" },
};

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "ev-1",
  store_id: "loja-1",
  destination: "google",
  destination_id: "dest-dm",
  event_name: "add_to_cart",
  payload: { gclid: "Cj0real", orderId: "add_to_cart_v_1" } as Record<string, unknown>,
  attempts: 0,
  ...extra,
});

const SETE_HORAS_ATRAS = () => new Date(Date.now() - 7 * 3600e3).toISOString();

describe("Data Manager: entrega pela fila", () => {
  beforeAll(() => ligarCredencial());
  beforeEach(() => {
    redePadrao();
    respostaIngest = () => json({ requestId: "req-1" });
  });

  it("na hora (coletor/webhook) so agenda para 6 h depois, sem rede", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso();
    const r = await entregar(banco.admin, linha(), { destino: DESTINO_DM, lojaLigada: true });
    expect(r).toMatchObject({ ok: false, agendado: true });
    expect(chamadas).toHaveLength(0);
    const [u] = banco.updates();
    expect(Object.keys(u.valores!)).toEqual(["next_attempt_at"]);
    const espera = Date.parse(String(u.valores!.next_attempt_at)) - Date.now();
    expect(espera).toBeGreaterThan(6 * 3600e3 - 60e3);
    expect(espera).toBeLessThanOrEqual(6 * 3600e3);
  });

  it("depois de 6 h envia com JWT da service account e guarda o requestId", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    // E-mail proprio: o token fica em cache por e-mail, e este teste quer ver
    // o pedido de token sair.
    ligarCredencial("jwt@projeto.iam.gserviceaccount.com");
    const banco = bancoFalso();
    const criado = SETE_HORAS_ATRAS();
    const r = await entregar(
      banco.admin,
      linha({
        event_name: "begin_checkout",
        event_id: "begin_checkout_ck_tok9",
        checkout_token: "tok9",
        created_at: criado,
        payload: { gbraid: "GB", wbraid: "WB", orderId: "begin_checkout_ck_tok9", consentimento: "negado" },
      }),
      { destino: DESTINO_DM, lojaLigada: true }
    );
    expect(r.ok).toBe(true);

    // O token: JWT RS256 assinado com a chave do ambiente, escopo da Data Manager.
    const token = chamadas.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    expect(token).toBeDefined();
    const form = new URLSearchParams(String(token.init?.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [cab, claimsB64, assinatura] = form.get("assertion")!.split(".");
    const assinado = createVerify("RSA-SHA256")
      .update(`${cab}.${claimsB64}`)
      .verify(chavePublica, Buffer.from(assinatura, "base64url"));
    expect(assinado).toBe(true);
    expect(JSON.parse(Buffer.from(cab, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claimsB64, "base64url").toString())).toMatchObject({
      iss: "jwt@projeto.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/datamanager",
      aud: "https://oauth2.googleapis.com/token",
    });

    const ingest = chamadas.find((c) => c.url.endsWith("/v1/events:ingest"))!;
    expect((ingest.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-google");
    const [corpo] = ingests();
    expect(corpo.destinations[0]).toEqual({
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
      productDestinationId: "333",
    });
    expect(corpo.events[0]).toEqual({
      adIdentifiers: { wbraid: "WB" },
      eventTimestamp: criado,
      eventSource: "WEB",
      transactionId: "begin_checkout_ck_tok9",
      consent: { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" },
    });
    expect(corpo).not.toHaveProperty("validateOnly");

    const [u] = banco.updates();
    expect(u.valores).toMatchObject({
      status: "enviado",
      attempts: 1,
      last_error: null,
      response: { dm: { requestId: "req-1", situacao: "processando", conferencias: 0 } },
    });
    const conferir = Date.parse(String(u.valores!.conferir_em)) - Date.now();
    expect(conferir).toBeGreaterThan(29 * 60e3);
    expect(conferir).toBeLessThanOrEqual(30 * 60e3);
  });

  it("compra leva valor, moeda e o numero do pedido", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    bancoFalso();
    await entregar(
      mundo.admin as never,
      linha({
        event_name: "Purchase",
        created_at: SETE_HORAS_ATRAS(),
        payload: { gclid: "Cj0real", orderId: "5544332211", value: 99.9, currency: "USD" },
      }),
      { destino: DESTINO_DM, lojaLigada: true }
    );
    const [corpo] = ingests();
    expect(corpo.destinations[0].productDestinationId).toBe("111");
    expect(corpo.events[0]).toMatchObject({
      transactionId: "5544332211",
      conversionValue: 99.9,
      currency: "USD",
    });
    // Sem consentimento no payload: nao informa.
    expect(corpo.events[0]).not.toHaveProperty("consent");
  });

  it("sem click id e teste fecham sem rede e sem falha", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    for (const [payload, situacao] of [
      [{ orderId: "x" }, "sem_clique"],
      [{ gclid: "TESTE-1", orderId: "x" }, "teste"],
    ] as const) {
      const banco = bancoFalso();
      const r = await entregar(banco.admin, linha({ created_at: SETE_HORAS_ATRAS(), payload }), {
        destino: DESTINO_DM,
        lojaLigada: true,
      });
      expect(r.ok).toBe(true);
      const [u] = banco.updates();
      expect(u.valores).toMatchObject({ status: "enviado", response: { dm: { situacao } } });
      // Nao saiu: sem sent_at.
      expect(u.valores).not.toHaveProperty("sent_at");
    }
    expect(chamadas).toHaveLength(0);
  });

  it("recusa do Google: 400 falha na hora, 503 volta para a fila", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    respostaIngest = () => json({ error: { message: "Invalid productDestinationId" } }, 400);
    let banco = bancoFalso();
    await entregar(banco.admin, linha({ created_at: SETE_HORAS_ATRAS() }), {
      destino: DESTINO_DM,
      lojaLigada: true,
    });
    expect(banco.updates()[0].valores).toMatchObject({
      status: "falhou",
      last_error: "Invalid productDestinationId",
    });

    respostaIngest = () => json({ error: { message: "backend" } }, 503);
    banco = bancoFalso();
    await entregar(banco.admin, linha({ created_at: SETE_HORAS_ATRAS() }), {
      destino: DESTINO_DM,
      lojaLigada: true,
    });
    expect(banco.updates()[0].valores).toMatchObject({ status: "pendente" });
  });

  it("destino sem customer_id continua no ping antigo; Meta continua igual", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const antigo = { ...DESTINO_DM, customerId: null, acoes: {} };
    let banco = bancoFalso();
    const r = await entregar(banco.admin, linha(), { destino: antigo, lojaLigada: true });
    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => new URL(c.url).host)).toEqual(["www.googleadservices.com"]);
    expect(banco.updates()[0].valores).toMatchObject({ status: "enviado" });

    chamadas.length = 0;
    banco = bancoFalso();
    const meta = {
      ...DESTINO_DM,
      id: "dest-meta",
      plataforma: "meta" as const,
      conta: "123456",
      token: "EAAB",
      customerId: null,
      acoes: {},
    };
    const evento = {
      event_name: "AddToCart",
      event_time: Math.floor(Date.now() / 1000),
      event_id: "e1",
      action_source: "website",
      user_data: { fbc: "fb.1.1.x" },
    };
    const rm = await entregar(
      banco.admin,
      linha({ destination: "meta", destination_id: "dest-meta", event_name: "add_to_cart", payload: evento }),
      { destino: meta, lojaLigada: true }
    );
    expect(rm.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("graph.facebook.com");
    expect(JSON.parse(String(chamadas[0].init?.body)).data[0]).toEqual(evento);
  });
});

describe("Data Manager: credencial e aceite do destino", () => {
  afterEach(() => ligarCredencial());

  it("sem credencial no ambiente o destino nao aceita evento (falta configurar)", async () => {
    const { destinoAceita, porQueRecusa } = await import("../src/lib/tracking/destinos");
    ligarCredencial();
    expect(destinoAceita(DESTINO_DM, "add_to_cart")).toBe(true);
    expect(destinoAceita(DESTINO_DM, "view_item")).toBe(false);
    desligarCredencial();
    expect(destinoAceita(DESTINO_DM, "add_to_cart")).toBe(false);
    expect(porQueRecusa(DESTINO_DM, "add_to_cart")).toContain("credencial");
    // O caminho antigo nao depende da service account.
    expect(destinoAceita({ ...DESTINO_DM, customerId: null, acoes: {} }, "add_to_cart")).toBe(true);
  });

  it("aceita o JSON inteiro da service account na variavel", async () => {
    const { credencialDoGoogle } = await import("../src/lib/tracking/google-dm");
    ligarCredencial();
    const pem = process.env.GOOGLE_DM_SA_KEY!;
    desligarCredencial();
    process.env.GOOGLE_DM_SA_KEY = JSON.stringify({
      client_email: "sa@x.iam.gserviceaccount.com",
      private_key: pem.replace(/\\n/g, "\n"),
    });
    const cred = credencialDoGoogle();
    expect(cred?.email).toBe("sa@x.iam.gserviceaccount.com");
    expect(cred?.chave.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
    process.env.GOOGLE_DM_SA_KEY = "lixo";
    expect(credencialDoGoogle()).toBeNull();
  });
});

describe("Data Manager: diagnostico pelo cron", () => {
  beforeAll(() => ligarCredencial());
  beforeEach(() => redePadrao());

  const enviada = (extra: Record<string, unknown> = {}) => ({
    id: "ev-1",
    store_id: "loja-1",
    event_id: "add_to_cart_v_1",
    attempts: 1,
    sent_at: new Date(Date.now() - 40 * 60e3).toISOString(),
    response: {
      dm: {
        requestId: "req-1",
        situacao: "processando",
        enviadoEm: new Date(Date.now() - 40 * 60e3).toISOString(),
        conferencias: 0,
      },
    },
    ...extra,
  });

  const com = (requestStatus: string, ...reasons: string[]) => ({
    requestStatusPerDestination: [
      { requestStatus, errorInfo: { errorCounts: reasons.map((reason) => ({ reason, recordCount: "1" })) } },
    ],
  });

  /** O SELECT da fila de conferencia devolve `linhas`; o das irmas, `irmas`. */
  function cenario(linhas: unknown[], irmas: unknown[] = []) {
    return bancoFalso((c) =>
      c.filtros.some(([op, col]) => op === "lte" && col === "conferir_em") ? linhas : irmas
    );
  }

  it("SUCCESS marca ok e para de conferir", async () => {
    const { conferirDiagnosticos } = await import("../src/lib/tracking/fila");
    diagnostico = com("SUCCESS");
    const banco = cenario([enviada()]);
    const r = await conferirDiagnosticos();
    expect(r.desfechos).toEqual({ ok: 1 });
    expect(chamadas.some((c) => c.url.includes("requestStatus:retrieve?requestId=req-1"))).toBe(true);
    const [u] = banco.updates();
    expect(u.valores).toMatchObject({ conferir_em: null, response: { dm: { situacao: "ok", conferencias: 1 } } });
    expect(u.valores).not.toHaveProperty("status");
  });

  it("PROCESSING espera mais; depois de 24 h desiste sem marcar erro", async () => {
    const { conferirDiagnosticos } = await import("../src/lib/tracking/fila");
    diagnostico = com("PROCESSING");
    let banco = cenario([enviada()]);
    await conferirDiagnosticos();
    const espera = Date.parse(String(banco.updates()[0].valores!.conferir_em)) - Date.now();
    expect(espera).toBeGreaterThan(59 * 60e3);

    const velho = new Date(Date.now() - 25 * 3600e3).toISOString();
    banco = cenario([enviada({ sent_at: velho, response: { dm: { requestId: "req-1", enviadoEm: velho } } })]);
    await conferirDiagnosticos();
    expect(banco.updates()[0].valores).toMatchObject({
      conferir_em: null,
      response: { dm: { situacao: "sem_diagnostico" } },
    });
    expect(banco.updates()[0].valores).not.toHaveProperty("status");
  });

  it("clique nao achado com a irma da mesma loja aceita = nao e desta conta", async () => {
    const { conferirDiagnosticos } = await import("../src/lib/tracking/fila");
    diagnostico = com("FAILED", "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND");
    const banco = cenario([enviada()], [{ status: "enviado", response: { dm: { situacao: "ok" } } }]);
    const r = await conferirDiagnosticos();
    expect(r.desfechos).toEqual({ nao_e_desta_conta: 1 });
    const u = banco.updates()[0].valores!;
    expect(u).not.toHaveProperty("status");
    expect(u.response).toMatchObject({ dm: { situacao: "nao_e_desta_conta" } });
  });

  it("clique nao achado sem irma que aceitou = falhou, com o motivo", async () => {
    const { conferirDiagnosticos } = await import("../src/lib/tracking/fila");
    diagnostico = com("FAILED", "PROCESSING_ERROR_REASON_CLICK_NOT_FOUND");
    const banco = cenario([enviada()], []);
    await conferirDiagnosticos();
    expect(banco.updates()[0].valores).toMatchObject({
      status: "falhou",
      last_error: "Google recusou: o Google não achou o clique nesta conta (CLICK_NOT_FOUND)",
    });
  });

  it("clique recente volta para a fila 6 h depois", async () => {
    const { conferirDiagnosticos } = await import("../src/lib/tracking/fila");
    diagnostico = com("FAILED", "PROCESSING_ERROR_REASON_TOO_RECENT_CLICK");
    const banco = cenario([enviada()]);
    await conferirDiagnosticos();
    const u = banco.updates()[0].valores!;
    expect(u).toMatchObject({ status: "pendente", conferir_em: null });
    expect(Date.parse(String(u.next_attempt_at)) - Date.now()).toBeGreaterThan(6 * 3600e3 - 60e3);
  });
});
