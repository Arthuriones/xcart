import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import { receberEvento, type ResultadoRecebimento } from "@/lib/checkouts-externos/receber";
import { checkoutDoToken, repositorioSupabase, segredoDaPlataforma } from "@/lib/checkouts-externos/repo-supabase";
import { notificarPedidoExterno } from "@/lib/checkouts-externos/notificar";

export const runtime = "nodejs";
// Sem cache: cada entrega e um evento.
export const dynamic = "force-dynamic";
// A falha nossa na Cakto segura a resposta ~9 s (ver SEGURAR_MS).
export const maxDuration = 30;

// ============================================================================
// Webhook de checkout externo (Sphere Affiliates e Cakto).
//
// ROTA PUBLICA: quem chama e o servidor da plataforma, sem sessao. O token de
// 43 caracteres no caminho acha o checkout, um por checkout; so o hash serve
// de busca e "Trocar URL" na tela mata o antigo na hora. A Sphere nao assina
// o corpo nem manda header proprio: o token e a senha. A Cakto assina
// (X-Cakto-Signature, HMAC do corpo CRU com o secret que o lojista colou):
// o adaptador confere antes de ler.
//
// O corpo traz VALOR MONETARIO que vai para o lucro. Por isso: teto de
// 64 KB, validacao dura no adaptador (numero, moeda ISO, data na janela),
// afiliado de outro checkout do usuario recusado, e o evento de teste nunca
// vira pedido.
//
// -------------------------------- codigos ---------------------------------
//
// 404  token desconhecido (generico: nao diz se o formato estava certo)
// 413  corpo grande demais
// 400  corpo invalido -> o erro fica no checkout, a tela mostra
// 401  Cakto sem secret salvo ou com assinatura errada -> idem
// 409  afiliado que ja e de outro checkout do usuario (contaria em dobro)
// 503  falha nossa. A Sphere tenta de novo (1 retentativa). A Cakto NAO
//      reenvia resposta nao-2xx, so timeout e erro de rede: para ela a rota
//      SEGURA a resposta ate passar dos 8 s dela, que conta como timeout e
//      reenvia (5 s, 1 min, 2 min 30 s, 6 min, 30 min). A trava ja foi solta.
// 200  o resto, inclusive duplicado, teste, abandono e pedido novo com o
//      checkout pausado (pedido que ja existe segue atualizando mesmo pausado)
//
// A Sphere espera 10 s e a Cakto 8 s: a notificacao no celular sai DEPOIS da
// resposta.
// ============================================================================

const MAX_CORPO = 64 * 1024;

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
  if (declarado > MAX_CORPO) return resposta(413, { ok: false, erro: "corpo grande demais" });

  const admin = createAdminClient();
  let checkout: Awaited<ReturnType<typeof checkoutDoToken>>;
  try {
    checkout = await checkoutDoToken(admin, token);
  } catch (e) {
    console.error("[checkout/webhook]", e instanceof Error ? e.message : e);
    return tenteDeNovo(pareceCakto(request));
  }
  if (!checkout) return NAO_ENCONTRADO();

  const plataforma = plataformaDe(checkout.plataforma);
  if (!plataforma) return NAO_ENCONTRADO();
  const segurar = plataforma.reenvio === "timeout";

  const repo = repositorioSupabase(admin);
  const agora = new Date();

  // Os bytes como chegaram: o HMAC da Cakto e do corpo CRU.
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_CORPO) return resposta(413, { ok: false, erro: "corpo grande demais" });
  const raw = bytes.toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    await repo.marcarCheckout(checkout.id, {
      ultimo_erro: "Evento recusado: o corpo não é JSON.",
      ultimo_erro_em: agora.toISOString(),
    });
    return resposta(400, { ok: false, erro: "corpo nao e JSON" });
  }

  let r: ResultadoRecebimento;
  try {
    const segredo = plataforma.autenticar ? await segredoDaPlataforma(admin, checkout.id) : null;
    r = await receberEvento(repo, checkout, plataforma, json, agora, { raw: bytes, headers: request.headers, segredo });
  } catch (e) {
    // A trava ja foi solta onde dava; aqui so a falha de banco antes dela.
    console.error("[checkout/webhook] falha ao receber", e instanceof Error ? e.message : e);
    if (segurar) {
      await repo.marcarCheckout(checkout.id, {
        ultimo_erro: `Falha nossa ao receber um evento. A ${plataforma.nome} manda de novo em alguns minutos; se o erro ficar, use Reenviar no painel dela.`,
        ultimo_erro_em: agora.toISOString(),
      });
    }
    return tenteDeNovo(segurar);
  }

  if (r.notificar) {
    const n = r.notificar;
    const userId = checkout.user_id;
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
