import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";

// ============================================================================
// Envio a Events API do TikTok (Events API 2.0, sobre a Marketing API v1.3).
//
// O mesmo papel do meta-capi.ts: o caminho que nao depende do navegador. O
// endpoint e um so para web, app e offline; o "2.0" e o nome do produto, o
// caminho continua /v1.3/.
//
// O TOKEN VAI NO HEADER `Access-Token`, nunca na URL: querystring vaza em log
// de proxy e em Referer, e este token posta conversao na conta do lojista.
//
// SUCESSO E `code === 0`, E NAO O STATUS HTTP. A propria documentacao do TikTok
// se contradiz (a pagina da Events API fala em 4xx/5xx; o apendice diz que a
// maioria das falhas volta HTTP 200 com `code` diferente de 0). Contar o 200
// como entregue marcaria 'enviado' um evento que o TikTok recusou.
// ============================================================================

const ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

/**
 * Teto de espera por chamada. Mesmo motivo do Meta: o envio roda dentro da
 * requisicao do visitante e do webhook, e a concorrencia da Vercel e de todas
 * as lojas. Estourar cai no catch, que conta como "tenta de novo".
 */
const TIMEOUT_MS = 5000;

/**
 * Codigos do TikTok que significam "a credencial e o problema": um token novo
 * conserta, insistir com o mesmo nao.
 *
 *   40001  sem permissao no pixel (token de outra conta de anuncio, ou
 *          usuario que nao e Admin/Operator)
 *   40102  token expirado
 *   40104  token vazio
 *   40105  token invalido
 *
 * A rota de destinos usa a mesma lista para devolver a fila o que caiu pelo
 * token velho quando o lojista cola um novo.
 */
export const CODIGOS_DE_CREDENCIAL_TIKTOK = [40001, 40102, 40104, 40105] as const;

/** Limite de taxa: e "devagar", nao "errado". */
const LIMITE_DE_TAXA = new Set([40100, 40132, 40133]);

export interface ResultadoTiktok {
  ok: boolean;
  status: number;
  /** O `code` do TikTok. 0 = aceito. */
  codigo?: number;
  /** `request_id`, para abrir chamado com eles. */
  trace?: string;
  erro?: string;
  /** Adianta tentar de novo? Ver `permanente`. */
  podeTentarDeNovo: boolean;
  corpo?: unknown;
}

/**
 * Erro que nao adianta repetir.
 *
 * 4xxxx do TikTok e entrada errada (credencial, payload) -- menos o limite de
 * taxa. 5xxxx (falha deles) e 60001 (manutencao) voltam. Sem `code` legivel,
 * decide o HTTP, como no Meta: 4xx e entrada, 429 e 5xx voltam.
 */
function permanente(status: number, codigo: number | null): boolean {
  if (codigo !== null) {
    if (LIMITE_DE_TAXA.has(codigo)) return false;
    if (codigo >= 40000 && codigo < 50000) return true;
    if (codigo >= 50000) return false;
  }
  return status >= 400 && status < 500 && status !== 429;
}

/** Manda os eventos para um pixel. */
export async function enviarParaTiktok(
  pixelCode: string,
  accessToken: string,
  eventos: EventoTiktok[],
  opcoes: { testEventCode?: string | null } = {}
): Promise<ResultadoTiktok> {
  if (eventos.length === 0) {
    return { ok: true, status: 200, codigo: 0, podeTentarDeNovo: false };
  }

  const corpo: Record<string, unknown> = {
    event_source: "web",
    event_source_id: pixelCode,
    data: eventos,
  };
  // No topo do corpo, ao lado de event_source. O evento cai na aba Test Events
  // do Gerenciador de eventos em vez de contar.
  if (opcoes.testEventCode?.trim()) {
    corpo.test_event_code = opcoes.testEventCode.trim();
  }

  try {
    const resposta = await safeFetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": accessToken },
      body: JSON.stringify(corpo),
      timeoutMs: TIMEOUT_MS,
    });

    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* resposta nao-JSON: fica so no texto do erro */
    }
    const dados = json as { code?: unknown; message?: unknown; request_id?: unknown } | null;
    const codigo = typeof dados?.code === "number" ? dados.code : null;
    const trace = typeof dados?.request_id === "string" ? dados.request_id : undefined;

    if (resposta.ok && codigo === 0) {
      return {
        ok: true,
        status: resposta.status,
        codigo: 0,
        trace,
        podeTentarDeNovo: false,
        corpo: json,
      };
    }

    const mensagem = typeof dados?.message === "string" ? dados.message : "";
    return {
      ok: false,
      status: resposta.status,
      codigo: codigo ?? undefined,
      trace,
      erro:
        (codigo !== null ? `${codigo}: ${mensagem || "sem mensagem"}` : "") ||
        `HTTP ${resposta.status}: ${texto.slice(0, 300)}`,
      podeTentarDeNovo: !permanente(resposta.status, codigo),
      corpo: json ?? texto.slice(0, 500),
    };
  } catch (e) {
    // Rede caiu, DNS falhou, timeout: sempre vale tentar de novo.
    return {
      ok: false,
      status: 0,
      erro: e instanceof Error ? e.message.slice(0, 300) : "falha de rede",
      podeTentarDeNovo: true,
    };
  }
}

/**
 * O token consegue ESCREVER neste pixel?
 *
 * O TikTok nao tem endpoint de checagem de credencial (nao documentado em
 * 06/10/2026): o caminho e mandar um evento e ler o `code` -- 0 vale, 40001 e
 * token de outra conta, 40105 e token invalido.
 *
 * O evento e CUSTOM (`XcartCredentialCheck`), nunca uma compra: evento custom
 * nao otimiza campanha. Com o codigo de teste do lojista ele vai tambem para a
 * aba Test Events. Sem codigo, aparece no Gerenciador de eventos e nao e usado
 * para nada -- o mesmo que o Meta faz.
 *
 * Nenhum dado de pessoa real: IP da faixa TEST-NET-3 (203.0.113.0/24) e URL
 * do dominio reservado example.com, que nao pertencem a ninguem. Estao aqui
 * porque o evento web exige `user` e `page.url`.
 */
export async function validarEscritaNoTiktok(
  pixelCode: string,
  accessToken: string,
  testEventCode?: string | null
): Promise<ResultadoTiktok> {
  return enviarParaTiktok(
    pixelCode,
    accessToken,
    [
      {
        event: "XcartCredentialCheck",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `xcart_check_${Date.now()}`,
        user: { ip: "203.0.113.9", user_agent: "xcart/credential-check" },
        page: { url: "https://example.com/xcart/credential-check" },
      },
    ],
    { testEventCode }
  );
}
