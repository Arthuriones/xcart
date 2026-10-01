import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { UserData } from "@/lib/tracking/normalizar";

// ============================================================================
// Envio ao Conversions API do Meta.
//
// Este e o caminho que nao depende do navegador do comprador. O pixel perde
// evento por bloqueador e por ITP; o pedido chega por webhook e sempre existe.
// ============================================================================

const VERSAO = "v21.0";

/**
 * Teto de espera por chamada.
 *
 * O envio acontece DENTRO da requisicao do visitante (coletor) e do webhook da
 * Shopify. Sem teto, um destino lento prende a funcao ate o limite da
 * plataforma -- e a concorrencia da Vercel e compartilhada entre todas as
 * lojas, entao o Meta lento viraria indisponibilidade para todo mundo.
 *
 * Estourar o teto nao perde o evento: cai no catch, que ja classifica erro de
 * rede como "vale tentar de novo", e a linha fica pendente para o cron.
 */
const TIMEOUT_MS = 5000;

export interface EventoCapi {
  event_name: string;
  event_time: number;
  /** A MESMA chave do evento do navegador. E o que evita contar duas vezes. */
  event_id: string;
  event_source_url?: string;
  /** "website" mesmo quando nasce no servidor: descreve onde a acao aconteceu. */
  action_source: "website" | "app" | "phone_call" | "chat" | "email" | "other";
  user_data: UserData;
  custom_data?: Record<string, unknown>;
}

export interface ResultadoCapi {
  ok: boolean;
  status: number;
  /** Quantos eventos o Meta aceitou. */
  recebidos?: number;
  /** Aceito pelo Meta como "fbtrace_id", util para abrir chamado com eles. */
  trace?: string;
  erro?: string;
  /**
   * Adianta tentar de novo?
   *
   * Token invalido nao melhora com retentativa -- insistir so queima chamada e
   * enche a fila. Limite de taxa e queda de rede, sim.
   */
  podeTentarDeNovo: boolean;
  corpo?: unknown;
}

/** Erro do Meta que nao adianta repetir: a entrada esta errada, nao a rede. */
function permanente(status: number, codigo?: number): boolean {
  // 190 = token invalido/expirado; 200 = falta permissao; 100 = parametro ruim.
  if (codigo === 190 || codigo === 200 || codigo === 100) return true;
  // 4xx em geral e problema de entrada. 429 e a excecao: e "devagar", nao "errado".
  return status >= 400 && status < 500 && status !== 429;
}

/**
 * Manda um lote de eventos.
 *
 * O token vai no CORPO, nao na querystring: querystring vaza em log de proxy,
 * em Referer e no historico -- e este token compra midia.
 */
export async function enviarParaMeta(
  pixelId: string,
  accessToken: string,
  eventos: EventoCapi[],
  opcoes: { testEventCode?: string | null } = {}
): Promise<ResultadoCapi> {
  if (eventos.length === 0) {
    return { ok: true, status: 200, recebidos: 0, podeTentarDeNovo: false };
  }

  const corpo: Record<string, unknown> = {
    data: eventos,
    access_token: accessToken,
  };
  if (opcoes.testEventCode?.trim()) {
    corpo.test_event_code = opcoes.testEventCode.trim();
  }

  try {
    const resposta = await safeFetch(
      `https://graph.facebook.com/${VERSAO}/${encodeURIComponent(pixelId)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        timeoutMs: TIMEOUT_MS,
      }
    );

    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* resposta nao-JSON: fica so no texto do erro */
    }

    const dados = json as {
      events_received?: number;
      fbtrace_id?: string;
      error?: { message?: string; code?: number; error_user_msg?: string };
    } | null;

    if (!resposta.ok || dados?.error) {
      const erro = dados?.error;
      return {
        ok: false,
        status: resposta.status,
        erro: erro?.error_user_msg || erro?.message || texto.slice(0, 300),
        trace: dados?.fbtrace_id,
        podeTentarDeNovo: !permanente(resposta.status, erro?.code),
        corpo: json ?? texto.slice(0, 500),
      };
    }

    return {
      ok: true,
      status: resposta.status,
      recebidos: dados?.events_received ?? eventos.length,
      trace: dados?.fbtrace_id,
      podeTentarDeNovo: false,
      corpo: json,
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
 * O token tem acesso a este pixel?
 *
 * Uma LEITURA, nao um evento. Validar mandando um Purchase de teste custa dado
 * sujo: sem `test_event_code` o Meta conta aquilo como conversao de verdade, e o
 * codigo de teste so existe se alguem foi buscar na aba Test Events. Este
 * caminho confirma a credencial e nao escreve nada.
 *
 * NAO SERVE PARA BARRAR. Medido: um token que posta evento sem problema
 * responde "(#100) Missing Permission" aqui -- token de system user com
 * ads_management costuma escrever e nao ler metadado do pixel. O inverso
 * tambem existe (le e nao escreve). Ou seja, este resultado e informativo nos
 * dois sentidos; quem decide se o token vale e `validarEscritaNoPixel`.
 */
export async function validarAcessoAoPixel(
  pixelId: string,
  accessToken: string
): Promise<{ ok: boolean; nome?: string; erro?: string }> {
  const url = new URL(
    `https://graph.facebook.com/${VERSAO}/${encodeURIComponent(pixelId)}`
  );
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  try {
    const resposta = await safeFetch(url.toString(), {
      method: "GET",
      timeoutMs: TIMEOUT_MS,
    });
    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* resposta nao-JSON cai no erro abaixo */
    }
    const dados = json as {
      id?: string;
      name?: string;
      error?: { message?: string; error_user_msg?: string };
    } | null;

    if (!resposta.ok || dados?.error || !dados?.id) {
      return {
        ok: false,
        erro:
          dados?.error?.error_user_msg ||
          dados?.error?.message ||
          `HTTP ${resposta.status}: ${texto.slice(0, 200)}`,
      };
    }
    return { ok: true, nome: dados.name };
  } catch (e) {
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 200) : "falha de rede",
    };
  }
}

/**
 * O token consegue ESCREVER neste pixel?
 *
 * Manda um evento custom, nao um Purchase. A diferenca importa: sem
 * `test_event_code`, um Purchase de teste conta como conversao de verdade e
 * entra no aprendizado da campanha. Um nome custom que ninguem configurou como
 * conversao aparece no Events Manager e nao e usado para otimizar nada.
 *
 * Nenhum dado de pessoa real vai junto. O IP e da faixa 203.0.113.0/24
 * (TEST-NET-3), reservada para documentacao -- nao pertence a ninguem. Ele esta
 * aqui porque o Meta RECUSA o evento com user_data vazio: "no customer
 * information parameters". IP + user agent e a combinacao minima que ele aceita.
 */
export async function validarEscritaNoPixel(
  pixelId: string,
  accessToken: string
): Promise<ResultadoCapi> {
  return enviarParaMeta(pixelId, accessToken, [
    {
      // Nome fora da lista de eventos padrao do Meta, de proposito: evento
      // custom que ninguem configurou como conversao nao otimiza campanha.
      event_name: "XcartCredentialCheck",
      event_time: Math.floor(Date.now() / 1000),
      event_id: `xcart_check_${Date.now()}`,
      action_source: "website",
      user_data: {
        client_ip_address: "203.0.113.9",
        client_user_agent: "xcart/credential-check",
      },
    },
  ]);
}

/**
 * Espera antes da proxima tentativa.
 *
 * Backoff exponencial com teto de 6 h. O primeiro retry vem rapido porque a
 * maioria das falhas e soluco de rede; as seguintes afastam para nao martelar
 * o Meta durante um incidente longo.
 */
export function proximaTentativaEm(tentativas: number): Date {
  const minutos = Math.min(360, Math.pow(2, Math.max(0, tentativas)));
  return new Date(Date.now() + minutos * 60 * 1000);
}

/** Depois disto o evento e dado como perdido e para de ocupar a fila. */
export const MAX_TENTATIVAS = 8;
