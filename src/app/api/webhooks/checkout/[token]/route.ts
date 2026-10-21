import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import { comoReenviar, marcaFalhaSemSegurar, receberEvento, type ResultadoRecebimento } from "@/lib/checkouts-externos/receber";
import { checkoutDoToken, repositorioSupabase, segredoDaPlataforma } from "@/lib/checkouts-externos/repo-supabase";
import { notificarPedidoExterno } from "@/lib/checkouts-externos/notificar";
import { entregarEnvios, rastreioSupabase } from "@/lib/checkouts-externos/rastreio";

export const runtime = "nodejs";
// Sem cache: cada entrega e um evento.
export const dynamic = "force-dynamic";
// A falha nossa na Cakto segura a resposta ~9 s (ver SEGURAR_MS).
export const maxDuration = 30;

// ============================================================================
// Webhook de checkout externo (Sphere Affiliates, Cakto e Hubla).
//
// ROTA PUBLICA: quem chama e o servidor da plataforma, sem sessao. O token de
// 43 caracteres no caminho acha o checkout, um por checkout; so o hash serve
// de busca e "Trocar URL" na tela mata o antigo na hora. A Sphere nao assina
// o corpo nem manda header proprio: o token e a senha. A Cakto assina
// (X-Cakto-Signature, HMAC do corpo CRU com o secret que o lojista colou), e
// a Hubla manda o token fixo da conta dela (x-hubla-token): o adaptador
// confere antes de ler.
//
// O corpo traz VALOR MONETARIO que vai para o lucro. Por isso: teto de
// tamanho (64 KB; 256 KB na plataforma de varios pedidos por entrega, a V2
// da Cakto), validacao dura no adaptador (numero, moeda ISO, data na
// janela), afiliado de outro checkout do usuario recusado, e o evento de
// teste nunca vira pedido.
//
// Na plataforma que confere a origem (Cakto, Hubla), o erro so vai para a
// tela com a origem conferida: quem tem so a URL nao escreve no checkout --
// menos o proprio 401, que e o aviso de secret/token errado.
//
// -------------------------------- codigos ---------------------------------
//
// 404  token desconhecido (generico: nao diz se o formato estava certo)
// 413  corpo grande demais -> na Cakto (que nao reenvia) e na Hubla (que
//      reenvia 5 vezes e para), o erro fica no checkout
// 400  corpo invalido -> o erro fica no checkout, a tela mostra
// 401  Cakto sem secret salvo ou com assinatura errada, Hubla sem token ou
//      com ele errado -> idem
// 409  afiliado que ja e de outro checkout do usuario (contaria em dobro)
// 503  falha nossa. A Sphere tenta de novo (1 retentativa); a Hubla, 5 vezes
//      em ~75 s, e o erro fica no checkout com o Reprocessar. A Cakto NAO
//      reenvia resposta nao-2xx, so timeout e erro de rede: para ela a rota
//      SEGURA a resposta ate passar dos 8 s dela, que conta como timeout e
//      reenvia (5 s, 1 min, 2 min 30 s, 6 min, 30 min). A trava ja foi solta.
// 200  o resto, inclusive duplicado, teste, abandono e pedido novo com o
//      checkout pausado (pedido que ja existe segue atualizando mesmo pausado)
//
// A Sphere espera 10 s e a Cakto 8 s: a notificacao no celular sai DEPOIS da
// resposta. A compra ao Meta e ao TikTok (073, so no modelo venda) entra na
// fila ANTES da resposta e sai em after(); o que falhar o cron do drain manda.
// ============================================================================

const MAX_CORPO = 64 * 1024;
/** V2 da Cakto: principal, order bump e upsell (com os blocos do Pix) numa entrega. A Hubla (uma fatura, mas com o lerTodos que diz o que foi ignorado) tambem cai aqui. */
const MAX_CORPO_VARIOS = 256 * 1024;

/** Passa do timeout de 8 s da Cakto: para ela, a entrega "nao respondeu" e volta. */
const SEGURAR_MS = 9_000;

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

const NAO_ENCONTRADO = () => resposta(404, { ok: false, erro: "nao encontrado" });

/** Antes de saber o checkout: a entrega e da Cakto? (ela assina e se identifica). */
function pareceCakto(request: Request): boolean {
  const h = request.headers;
  return Boolean(h.get("x-cakto-signature") || h.get("x-cakto-timestamp")) || /^CaktoBot\//i.test(h.get("user-agent") || "");
}

/** O 503 que a plataforma reenvia: na Cakto, so depois do timeout dela. */
async function tenteDeNovo(segurar: boolean) {
  if (segurar) await new Promise((r) => setTimeout(r, SEGURAR_MS));
  return resposta(503, { ok: false, erro: "tente de novo" });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const declarado = Number(request.headers.get("content-length") || 0);
  if (declarado > MAX_CORPO_VARIOS) return resposta(413, { ok: false, erro: "corpo grande demais" });

  const admin = createAdminClient();
  let checkout: Awaited<ReturnType<typeof checkoutDoToken>>;
  try {
    checkout = await checkoutDoToken(admin, token);
  } catch (e) {
    console.error("[checkout/webhook]", e instanceof Error ? e.message : e);
    return tenteDeNovo(pareceCakto(request));
  }
  if (!checkout) return NAO_ENCONTRADO();
  const ck = checkout;

  const plataforma = plataformaDe(ck.plataforma);
  if (!plataforma) return NAO_ENCONTRADO();
  const segurar = plataforma.reenvio === "timeout";
  const limite = plataforma.lerTodos ? MAX_CORPO_VARIOS : MAX_CORPO;

  const repo = repositorioSupabase(admin);
  const agora = new Date();

  // O secret da plataforma, lido uma vez (so a que assina tem).
  let segredoLido: Promise<string | null> | null = null;
  const segredo = () =>
    (segredoLido ??= plataforma.autenticar ? segredoDaPlataforma(admin, ck.id) : Promise.resolve(null));
  /** Recusa que vai para a tela: na plataforma que assina, so com a origem conferida. */
  const recusar = async (status: 400 | 413, erro: string, ultimoErro: string, corpo: Uint8Array) => {
    if (plataforma.autenticar) {
      let origem = false;
      try {
        origem = plataforma.autenticar(corpo, request.headers, await segredo(), agora).ok;
      } catch {
        // Sem o secret nao da para conferir: nao escreve na tela.
      }
      if (!origem) return resposta(401, { ok: false, erro: "nao autorizado" });
    }
    await repo.marcarCheckout(ck.id, { ultimo_erro: ultimoErro, ultimo_erro_em: agora.toISOString() });
    return resposta(status, { ok: false, erro });
  };

  if (declarado > limite) return resposta(413, { ok: false, erro: "corpo grande demais" });
  // Os bytes como chegaram: o HMAC da Cakto e do corpo CRU.
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > limite) {
    // A Sphere segue como sempre (sem marca). A Cakto nao reenvia o 413, e a
    // Hubla desiste depois de 5: sem o erro na tela, a venda sumiria sem sinal.
    if (!segurar && !plataforma.autenticar) return resposta(413, { ok: false, erro: "corpo grande demais" });
    return recusar(
      413,
      "corpo grande demais",
      `Evento recusado: a entrega passou de ${limite / 1024} KB. Fale com o suporte do xcart antes de usar ${plataforma.autenticacao === "token_no_header" ? "Reprocessar" : "Reenviar"} na ${plataforma.nome}.`,
      bytes
    );
  }
  const raw = bytes.toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return recusar(400, "corpo nao e JSON", "Evento recusado: o corpo não é JSON.", bytes);
  }

  let r: ResultadoRecebimento;
  try {
    r = await receberEvento(
      repo,
      ck,
      plataforma,
      json,
      agora,
      { raw: bytes, headers: request.headers, segredo: await segredo() },
      rastreioSupabase(admin)
    );
  } catch (e) {
    // Falha de banco fora da gravacao do pedido. Trava que ficou sem pedido,
    // a retentativa refaz (receber.ts).
    console.error("[checkout/webhook] falha ao receber", e instanceof Error ? e.message : e);
    if (segurar || marcaFalhaSemSegurar(plataforma)) {
      const quando = segurar ? "manda de novo em alguns minutos" : "tenta de novo por cerca de 1 minuto";
      await repo.marcarCheckout(ck.id, {
        ultimo_erro: `Falha nossa ao receber um evento. A ${plataforma.nome} ${quando}; se o erro ficar, ${comoReenviar(plataforma)}.`,
        ultimo_erro_em: agora.toISOString(),
      });
    }
    return tenteDeNovo(segurar);
  }

  if (r.entregar && r.entregar.length > 0) {
    const lista = r.entregar;
    after(() => entregarEnvios(admin, lista));
  }
  if (r.notificar) {
    const n = r.notificar;
    const userId = ck.user_id;
    after(() => notificarPedidoExterno(admin, userId, n));
  }
  if (r.segurar) return tenteDeNovo(true);
  return resposta(r.status, r.corpo);
}

/** Abrir a URL no navegador: diz o que ela e, sem consultar o banco. */
export function GET() {
  return new NextResponse("Webhook do xcart: use POST com JSON.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
