import "server-only";
import { enviarParaMeta, type EventoCapi } from "@/lib/tracking/meta-capi";
import { enviarParaTiktok } from "@/lib/tracking/tiktok-api";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";
import type { PlataformaServidor } from "@/lib/tracking/eventos";

// ============================================================================
// O envio de UM evento ja montado a UM destino (Meta ou TikTok), e o aviso
// que acompanha o sucesso.
//
// Saiu de `entregar` (fila.ts) sem mudar nada: a fila das lojas e a fila do
// checkout externo (src/lib/checkouts-externos/rastreio.ts) mandam pelo mesmo
// caminho. Quem chama grava o desfecho na SUA tabela -- aqui nao ha banco.
// ============================================================================

export interface DestinoDoEnvio {
  plataforma: PlataformaServidor;
  /** Id do pixel no Meta, Pixel Code no TikTok. */
  conta: string;
  token: string;
  testEventCode?: string | null;
}

export interface ResultadoDoEnvio {
  ok: boolean;
  erro?: string;
  podeTentarDeNovo: boolean;
  /** A resposta da plataforma, para a coluna `response`. */
  corpo: Record<string, unknown> | null;
  /** So no sucesso: o que falta para a conversao ligar ao anuncio. */
  aviso: string | null;
}

/**
 * Manda o payload (no formato da plataforma: EventoCapi no Meta, EventoTiktok
 * no TikTok). O despacho e pela plataforma do destino; quem chama ja conferiu
 * que a linha e da mesma plataforma.
 */
export async function enviarAoDestino(destino: DestinoDoEnvio, payload: unknown): Promise<ResultadoDoEnvio> {
  // ---- TikTok -------------------------------------------------------------
  if (destino.plataforma === "tiktok") {
    const r = await enviarParaTiktok(destino.conta, destino.token, [payload as EventoTiktok], {
      testEventCode: destino.testEventCode,
    });
    // Mesmo aviso do Meta, com o clique do TikTok. A tela conta o "de
    // anuncio" pelo payload (migration 059), nao por esta frase.
    const semTtclid = !(payload as EventoTiktok)?.user?.ttclid;
    return {
      ok: r.ok,
      erro: r.ok ? undefined : r.erro,
      podeTentarDeNovo: r.podeTentarDeNovo,
      corpo: (r.corpo ?? null) as Record<string, unknown> | null,
      aviso: r.ok && semTtclid ? "sem ttclid: nao veio de clique em anuncio do TikTok" : null,
    };
  }

  // ---- Meta ---------------------------------------------------------------
  const r = await enviarParaMeta(destino.conta, destino.token, [payload as EventoCapi], {
    testEventCode: destino.testEventCode,
  });
  // Aviso para quem le a linha. A TELA nao depende dele: a RPC conta o sem
  // clique pelo payload (migration 051), entao reescrever esta frase nao
  // muda contagem nenhuma. Sem fbc o Meta ainda casa por _fbp, IP, user
  // agent e e-mail: o que falta e so o clique no anuncio dele.
  const semClique = !(payload as EventoCapi)?.user_data?.fbc;
  return {
    ok: r.ok,
    erro: r.ok ? undefined : r.erro,
    podeTentarDeNovo: r.podeTentarDeNovo,
    corpo: (r.corpo ?? null) as Record<string, unknown> | null,
    aviso: r.ok && semClique ? "sem fbc: nao veio de clique em anuncio do Meta" : null,
  };
}
