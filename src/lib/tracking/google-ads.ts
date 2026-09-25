import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
// O helper de formato vive em normalizar.ts porque e funcao pura: aqui
// dentro, atras do "server-only", nao daria para testar sem subir o Next.
import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";

export { apenasNumeroDaConversao };

// ============================================================================
// Conversao do Google Ads enviada pelo servidor.
//
// ------------------------------- LEIA ISTO --------------------------------
//
// O Google NAO publica um endpoint servidor-a-servidor para conversao com
// apenas id + rotulo. A documentacao oficial manda usar um container
// server-side do GTM, e o caminho com API (importacao offline) exige developer
// token aprovado.
//
// O que este arquivo faz e montar a MESMA requisicao que o tag do sGTM monta
// por baixo: /pagead/conversion/{id}/ com o rotulo, o click id em `gclaw` e o
// numero do pedido em `oid`. Funciona, e e o que os rastreadores de mercado
// fazem -- mas nao e contrato publico. Se o Google mudar, a conversao para de
// chegar SEM erro nenhum, porque o endpoint responde 200 de qualquer jeito.
//
// Duas consequencias praticas, e nenhuma delas tem conserto no codigo:
//
//   1. "enviado" aqui significa "o Google aceitou a requisicao", nao "a
//      conversao foi contada". A unica confirmacao real e a tela do Google
//      Ads. Por isso o painel precisa comparar pedidos com conversoes.
//   2. O alarme tem que ser por AUSENCIA: se o numero de conversoes cair a
//      zero enquanto continuam entrando pedidos, quebrou.
//
// Decisao tomada pelo Arthur em 2026-09-25, depois de eu apresentar as tres
// opcoes (Web Pixel no navegador, container sGTM, este caminho).
// ============================================================================

export interface ConversaoGoogle {
  /** AW-XXXXXXXXX, como o lojista copia do Google Ads. */
  conversionId: string;
  /** Rotulo da conversion action. */
  label: string;
  /** Click id capturado na chegada. Sem ele nao ha atribuicao a anuncio. */
  gclid?: string | null;
  /** Numero do pedido. E o que o Google usa para nao contar duas vezes. */
  orderId?: string | null;
  value?: number | null;
  currency?: string | null;
}

export interface ResultadoGoogle {
  ok: boolean;
  status: number;
  erro?: string;
  podeTentarDeNovo: boolean;
  /** A URL chamada, sem segredo nenhum -- ajuda a depurar na mao. */
  url?: string;
}

export async function enviarParaGoogleAds(
  conv: ConversaoGoogle
): Promise<ResultadoGoogle> {
  const numero = apenasNumeroDaConversao(conv.conversionId);
  const label = (conv.label || "").trim();

  if (!numero || !label) {
    // Configuracao incompleta nao melhora com retentativa.
    return {
      ok: false,
      status: 0,
      erro: "conversion id ou label ausente",
      podeTentarDeNovo: false,
    };
  }

  const url = new URL(`https://www.googleadservices.com/pagead/conversion/${numero}/`);
  url.searchParams.set("label", label);
  // script=0 e o que identifica origem sem JavaScript -- o mesmo que o
  // <noscript> do snippet classico usa.
  url.searchParams.set("script", "0");

  if (conv.gclid) url.searchParams.set("gclaw", conv.gclid);
  // `oid` e o transaction id: mesma conversion action + mesmo oid = o Google
  // descarta a segunda. E a rede de seguranca contra reentrega de webhook e
  // contra o canal nativo mandando a mesma venda.
  if (conv.orderId) url.searchParams.set("oid", String(conv.orderId));
  if (typeof conv.value === "number" && Number.isFinite(conv.value)) {
    url.searchParams.set("value", String(conv.value));
  }
  if (conv.currency) url.searchParams.set("currency_code", conv.currency.toUpperCase());

  try {
    const resposta = await safeFetch(url.toString(), {
      method: "GET",
      headers: {
        // Sem user agent de navegador o Google costuma descartar em silencio.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,*/*",
      },
    });

    // O endpoint devolve 200 com um pixel mesmo quando ignora o conteudo.
    // Status so pega erro de transporte -- nunca "conversao recusada".
    if (!resposta.ok) {
      return {
        ok: false,
        status: resposta.status,
        erro: `HTTP ${resposta.status}`,
        // 4xx aqui e id/rotulo errado: repetir nao conserta.
        podeTentarDeNovo: resposta.status >= 500 || resposta.status === 429,
        url: url.toString(),
      };
    }

    return { ok: true, status: resposta.status, podeTentarDeNovo: false, url: url.toString() };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      erro: e instanceof Error ? e.message.slice(0, 300) : "falha de rede",
      podeTentarDeNovo: true,
      url: url.toString(),
    };
  }
}
