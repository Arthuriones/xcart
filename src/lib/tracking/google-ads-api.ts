import "server-only";
// O tipo mora em purchase.ts, que e puro: e de la que os identificadores sao
// montados a partir do pedido, e este arquivo so os transporta.
import type { IdentificadorGoogle } from "@/lib/tracking/purchase";
// dataDeAjuste mora na camada pura para poder ser testada: o formato e exato
// e `server-only` impede o vitest de importar este arquivo.
export { dataDeAjuste } from "@/lib/tracking/normalizar";

// ============================================================================
// Google Ads API -- enhanced conversions para web.
//
// POR QUE ESTA API, E NAO O PING QUE JA EXISTE
//
// O ping de /pagead/conversion so aceita o dado hasheado no parametro `em`, que
// o gtag monta a partir de configuracao que o Google entrega por acao de
// conversao. Medido em bancada: com allow_enhanced_conversions ligado e
// user_data preenchido, o gtag manda `gtm_ee=1` e NAO manda `em` enquanto o
// Google nao reconhece a acao. O encoding nao e observavel, e chutar falha
// calado -- aquele endpoint responde 200 de qualquer jeito.
//
// Aqui e o contrario, e essa e a vantagem principal: esta API responde erro
// nomeado. CONVERSION_NOT_FOUND, ACTION_NOT_PERMITTED, INVALID_USER_IDENTIFIER
// aparecem no corpo. Da para consertar o que esta errado em vez de descobrir
// semanas depois pela ausencia de conversao.
//
// A PEGADINHA DO partial_failure
//
// A requisicao exige partial_failure = true, e ai o erro de uma linha volta
// dentro de um HTTP 200, no campo partialFailureError. Ler so o status daria o
// mesmo problema que o ping: "deu 200, entao foi". Por isso o corpo e sempre
// inspecionado antes de declarar sucesso.
//
// CREDENCIAL DE QUEM
//
// developer token e o client OAuth sao do xcart e vem do ambiente. Por loja o
// que existe e o refresh token da conta Google DO LOJISTA -- ele da escrita na
// conta de anuncios, entao mora em tracking_secrets (so service_role).
// ============================================================================

const VERSAO = "v25";
const BASE = `https://googleads.googleapis.com/${VERSAO}`;

export interface CredenciaisLoja {
  /** So digitos: 1234567890, nunca 123-456-7890. */
  customerId: string;
  /** Customer id da MCC, quando a conta e gerenciada. Nulo em conta avulsa. */
  loginCustomerId?: string | null;
  refreshToken: string;
}

export interface Resultado<T> {
  ok: boolean;
  dados?: T;
  erro?: string;
  /** Falso para erro de configuracao: insistir so queima chamada. */
  podeTentarDeNovo: boolean;
}

/** So digitos. O lojista copia "123-456-7890" do painel e a API recusa. */
export function apenasDigitos(valor: string | null | undefined): string | null {
  const d = (valor || "").replace(/\D/g, "");
  return d || null;
}

function credenciaisDoApp():
  | { developerToken: string; clientId: string; clientSecret: string }
  | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (!developerToken || !clientId || !clientSecret) return null;
  return { developerToken, clientId, clientSecret };
}

/**
 * O app esta configurado para usar a API?
 *
 * A tela usa isto para nao oferecer o que nao funciona: sem developer token,
 * enhanced conversions nao tem como sair, e um campo pedindo credencial do
 * lojista seria pedir trabalho por nada.
 */
export function apiDisponivel(): boolean {
  return credenciaisDoApp() !== null;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

// O access token vale ~1h. Guardar em memoria evita uma ida ao OAuth por
// pedido; em serverless o processo as vezes e reaproveitado e as vezes nao, e
// os dois casos funcionam.
const cache = new Map<string, { token: string; expiraEm: number }>();

export async function tokenDeAcesso(
  refreshToken: string
): Promise<Resultado<string>> {
  const app = credenciaisDoApp();
  if (!app) {
    return {
      ok: false,
      erro:
        "GOOGLE_ADS_DEVELOPER_TOKEN / GOOGLE_ADS_OAUTH_CLIENT_ID / GOOGLE_ADS_OAUTH_CLIENT_SECRET ausentes no ambiente",
      podeTentarDeNovo: false,
    };
  }

  const guardado = cache.get(refreshToken);
  // Margem de 60s: token que vence no meio da requisicao volta como 401 e
  // vira retentativa a toa.
  if (guardado && guardado.expiraEm > Date.now() + 60_000) {
    return { ok: true, dados: guardado.token, podeTentarDeNovo: false };
  }

  let resposta: Response;
  try {
    resposta = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (e) {
    return {
      ok: false,
      erro: `rede ao renovar token: ${e instanceof Error ? e.message : String(e)}`,
      podeTentarDeNovo: true,
    };
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!resposta.ok || !corpo?.access_token) {
    const detalhe =
      corpo?.error_description || corpo?.error || `HTTP ${resposta.status}`;
    // invalid_grant = refresh token revogado ou expirado. Repetir nao resolve:
    // o lojista precisa autorizar de novo.
    const revogado = corpo?.error === "invalid_grant";
    return {
      ok: false,
      erro: revogado
        ? `autorizacao do Google revogada (${detalhe}). O lojista precisa conectar a conta de novo.`
        : `falha ao renovar token: ${detalhe}`,
      podeTentarDeNovo: !revogado && resposta.status >= 500,
    };
  }

  cache.set(refreshToken, {
    token: corpo.access_token,
    expiraEm: Date.now() + (corpo.expires_in ?? 3600) * 1000,
  });
  return { ok: true, dados: corpo.access_token, podeTentarDeNovo: false };
}

// ---------------------------------------------------------------------------
// Chamada autenticada
// ---------------------------------------------------------------------------

async function chamar<T>(
  caminho: string,
  corpo: unknown,
  creds: CredenciaisLoja
): Promise<Resultado<T>> {
  const app = credenciaisDoApp();
  if (!app) {
    return {
      ok: false,
      erro: "credenciais do app ausentes",
      podeTentarDeNovo: false,
    };
  }

  const token = await tokenDeAcesso(creds.refreshToken);
  if (!token.ok || !token.dados) {
    return {
      ok: false,
      erro: token.erro,
      podeTentarDeNovo: token.podeTentarDeNovo,
    };
  }

  const cabecalhos: Record<string, string> = {
    Authorization: `Bearer ${token.dados}`,
    "developer-token": app.developerToken,
    "Content-Type": "application/json",
  };
  // Sem este header, conta gerenciada por MCC responde USER_PERMISSION_DENIED
  // mesmo com o token certo.
  const mcc = apenasDigitos(creds.loginCustomerId);
  if (mcc) cabecalhos["login-customer-id"] = mcc;

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}/${caminho}`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    return {
      ok: false,
      erro: `rede: ${e instanceof Error ? e.message : String(e)}`,
      podeTentarDeNovo: true,
    };
  }

  const texto = await resposta.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* resposta nao-JSON: o texto cru vai no erro abaixo */
  }

  if (!resposta.ok) {
    return {
      ok: false,
      erro: `HTTP ${resposta.status}: ${resumirErro(json) || texto.slice(0, 400)}`,
      // 429/5xx passam; 400/403 sao configuracao e nao mudam com retentativa.
      podeTentarDeNovo: resposta.status === 429 || resposta.status >= 500,
    };
  }

  return { ok: true, dados: json as T, podeTentarDeNovo: false };
}

/**
 * Puxa a mensagem util de dentro do envelope de erro do Google.
 *
 * Os codigos nomeados (CONVERSION_NOT_FOUND, ACTION_NOT_PERMITTED) ficam
 * enterrados em `details`, e sao eles que dizem o que consertar -- a mensagem
 * de topo costuma ser generica.
 */
function resumirErro(json: unknown): string | null {
  const e = json as {
    error?: { message?: string; details?: unknown[] };
    message?: string;
    details?: unknown[];
  } | null;
  const base = e?.error?.message || e?.message || null;
  const detalhes = e?.error?.details || e?.details || [];

  const codigos: string[] = [];
  const cacar = (v: unknown, profundidade: number) => {
    if (!v || typeof v !== "object" || profundidade > 8) return;
    for (const valor of Object.values(v as Record<string, unknown>)) {
      if (typeof valor === "string" && /^[A-Z][A-Z0-9_]{3,}$/.test(valor)) {
        codigos.push(valor);
      } else if (typeof valor === "object") {
        cacar(valor, profundidade + 1);
      }
    }
  };
  for (const d of detalhes) cacar(d, 0);

  const unicos = [...new Set(codigos)].slice(0, 4);
  if (base && unicos.length) return `${base} [${unicos.join(", ")}]`;
  return base || (unicos.length ? unicos.join(", ") : null);
}

// ---------------------------------------------------------------------------
// Descobrir a conversion action
// ---------------------------------------------------------------------------

export interface ConversionActionEncontrada {
  id: string;
  resourceName: string;
  nome: string;
}

/**
 * Do rotulo para o id numerico.
 *
 * O lojista tem em maos o ID de conversao e o ROTULO -- e o que o painel
 * mostra e o que a tag usa. A API nao aceita rotulo: ela quer
 * customers/X/conversionActions/<id numerico>, que e um terceiro numero que o
 * painel nao exibe. O jeito de ligar os dois e ler o snippet da tag de cada
 * acao, que contem o rotulo.
 *
 * O resultado e guardado em tracking_configs para nao pagar esta busca a cada
 * pedido.
 */
export async function descobrirConversionAction(
  creds: CredenciaisLoja,
  label: string
): Promise<Resultado<ConversionActionEncontrada>> {
  const alvo = label.trim();
  if (!alvo) {
    return { ok: false, erro: "rotulo vazio", podeTentarDeNovo: false };
  }

  const r = await chamar<{
    results?: {
      conversionAction?: {
        resourceName?: string;
        id?: string;
        name?: string;
        type?: string;
        tagSnippets?: { eventSnippet?: string; globalSiteTag?: string }[];
      };
    }[];
  }>(
    `customers/${creds.customerId}/googleAds:search`,
    {
      query: `
        SELECT conversion_action.id,
               conversion_action.name,
               conversion_action.type,
               conversion_action.tag_snippets
        FROM conversion_action
        WHERE conversion_action.status = 'ENABLED'
      `,
      pageSize: 1000,
    },
    creds
  );

  if (!r.ok) {
    return { ok: false, erro: r.erro, podeTentarDeNovo: r.podeTentarDeNovo };
  }

  const acoes = r.dados?.results || [];
  for (const linha of acoes) {
    const a = linha.conversionAction;
    if (!a?.id) continue;
    const snippets = (a.tagSnippets || [])
      .map((s) => `${s.eventSnippet || ""}${s.globalSiteTag || ""}`)
      .join("\n");
    if (!snippets.includes(alvo)) continue;

    // WEBPAGE e a exigencia do enhancement: acao de outro tipo aceita o upload
    // e devolve ACTION_NOT_PERMITTED.
    if (a.type && a.type !== "WEBPAGE") {
      return {
        ok: false,
        erro: `a acao "${a.name}" e do tipo ${a.type}; enhanced conversions exige WEBPAGE`,
        podeTentarDeNovo: false,
      };
    }

    return {
      ok: true,
      dados: {
        id: String(a.id),
        resourceName:
          a.resourceName ||
          `customers/${creds.customerId}/conversionActions/${a.id}`,
        nome: a.name || "",
      },
      podeTentarDeNovo: false,
    };
  }

  return {
    ok: false,
    erro:
      acoes.length === 0
        ? "a conta nao tem nenhuma conversion action ativa"
        : `nenhuma das ${acoes.length} acoes ativas usa o rotulo "${alvo}". Confira se o rotulo e da MESMA conta informada.`,
    podeTentarDeNovo: false,
  };
}

// ---------------------------------------------------------------------------
// Enviar o enhancement
// ---------------------------------------------------------------------------

export interface Enhancement {
  conversionActionResourceName: string;
  /** O MESMO oid que a conversao base levou: e por ele que o Google liga os dois. */
  orderId: string;
  /** yyyy-mm-dd HH:mm:ss+HH:mm. Sem fuso a API recusa. */
  adjustmentDateTime: string;
  identificadores: IdentificadorGoogle[];
  userAgent?: string | null;
  /**
   * Ensaio: o Google valida tudo -- credencial, action, formato dos hashes --
   * e nao aplica nada. E o unico jeito de provar que a cadeia inteira funciona
   * sem inventar um ajuste em pedido de verdade.
   */
  apenasValidar?: boolean;
}


export async function enviarEnhancement(
  creds: CredenciaisLoja,
  dados: Enhancement
): Promise<Resultado<{ aceitos: number }>> {
  if (!dados.identificadores.length) {
    return {
      ok: false,
      erro: "nenhum identificador: o enhancement nao teria o que acrescentar",
      podeTentarDeNovo: false,
    };
  }

  const ajuste: Record<string, unknown> = {
    conversionAction: dados.conversionActionResourceName,
    adjustmentType: "ENHANCEMENT",
    // Enhancement e chaveado por order id, nao pelo par gclid+data. E o motivo
    // de o ping base ter que mandar `oid`.
    orderId: dados.orderId,
    adjustmentDateTime: dados.adjustmentDateTime,
    // No maximo 5 identificadores por ajuste; acima disso a API recusa o lote.
    userIdentifiers: dados.identificadores.slice(0, 5),
  };
  if (dados.userAgent) ajuste.userAgent = dados.userAgent;

  const r = await chamar<{
    results?: unknown[];
    partialFailureError?: { message?: string; details?: unknown[] };
  }>(
    `customers/${creds.customerId}:uploadConversionAdjustments`,
    // partial_failure e obrigatorio. Ele e o motivo de a checagem abaixo
    // existir: com ele ligado, o erro da linha volta DENTRO de um HTTP 200.
    {
      conversionAdjustments: [ajuste],
      partialFailure: true,
      ...(dados.apenasValidar ? { validateOnly: true } : {}),
    },
    creds
  );

  if (!r.ok) {
    return { ok: false, erro: r.erro, podeTentarDeNovo: r.podeTentarDeNovo };
  }

  const falha = r.dados?.partialFailureError;
  if (falha) {
    const detalhe =
      resumirErro(falha) || falha.message || "erro parcial sem detalhe";
    // CONVERSION_NOT_FOUND aqui quase sempre e ordem de chegada: o enhancement
    // passou na frente da conversao base. Vale repetir; os outros, nao.
    const aindaNaoChegou = /CONVERSION_NOT_FOUND|NOT_FOUND/i.test(detalhe);
    return {
      ok: false,
      erro: aindaNaoChegou
        ? `a conversao do pedido ${dados.orderId} ainda nao consta no Google (${detalhe})`
        : detalhe,
      podeTentarDeNovo: aindaNaoChegou,
    };
  }

  // Resultado vazio sem erro parcial significa que nada foi aplicado. Chamar
  // isso de sucesso recriaria o problema do ping: numero verde na tela e nada
  // acontecendo no Google.
  const aceitos = (r.dados?.results || []).length;
  if (dados.apenasValidar) {
    // validateOnly nao devolve results: passou na validacao e nada foi aplicado,
    // que e exatamente o objetivo.
    return { ok: true, dados: { aceitos: 0 }, podeTentarDeNovo: false };
  }
  if (aceitos === 0) {
    return {
      ok: false,
      erro: "o Google aceitou a requisicao mas nao aplicou nenhum ajuste",
      podeTentarDeNovo: false,
    };
  }

  return { ok: true, dados: { aceitos }, podeTentarDeNovo: false };
}
