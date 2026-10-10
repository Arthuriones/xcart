import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import { receberEvento } from "@/lib/checkouts-externos/receber";
import { checkoutDoToken, repositorioSupabase } from "@/lib/checkouts-externos/repo-supabase";
import { notificarPedidoExterno } from "@/lib/checkouts-externos/notificar";

export const runtime = "nodejs";
// Sem cache: cada entrega e um evento.
export const dynamic = "force-dynamic";

// ============================================================================
// Webhook de checkout externo (Sphere Affiliates primeiro).
//
// ROTA PUBLICA: quem chama e o servidor da plataforma, sem sessao. A Sphere
// nao assina o corpo nem manda header proprio, entao a URL e a senha: o token
// de 43 caracteres no caminho e o unico segredo, um por checkout. So o hash
// serve de busca; "Trocar URL" na tela mata o antigo na hora.
//
// O corpo traz VALOR MONETARIO que vai para o lucro (a comissao). Por isso:
// teto de 64 KB, validacao dura no adaptador (numero, moeda ISO, data na
// janela), afiliado de outro checkout do usuario recusado, e o evento de
// teste nunca vira pedido.
//
// -------------------------------- codigos ---------------------------------
//
// 404  token desconhecido (generico: nao diz se o formato estava certo)
// 413  corpo grande demais
// 400  corpo invalido -> o erro fica no checkout, a tela mostra
// 409  afiliado que ja e de outro checkout do usuario (contaria em dobro)
// 503  falha nossa -> a plataforma tenta de novo (1 retentativa na Sphere)
// 200  o resto, inclusive duplicado, teste e pedido novo com o checkout
//      pausado (pedido que ja existe segue atualizando mesmo pausado)
//
// A Sphere espera 10 s: a notificacao no celular sai DEPOIS da resposta.
// ============================================================================

const MAX_CORPO = 64 * 1024;

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

const NAO_ENCONTRADO = () => resposta(404, { ok: false, erro: "nao encontrado" });

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
    return resposta(503, { ok: false, erro: "tente de novo" });
  }
  if (!checkout) return NAO_ENCONTRADO();

  const plataforma = plataformaDe(checkout.plataforma);
  if (!plataforma) return NAO_ENCONTRADO();

  const repo = repositorioSupabase(admin);
  const agora = new Date();

  const raw = await request.text();
  if (raw.length > MAX_CORPO) return resposta(413, { ok: false, erro: "corpo grande demais" });
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

  let r: Awaited<ReturnType<typeof receberEvento>>;
  try {
    r = await receberEvento(repo, checkout, plataforma, json, agora);
  } catch (e) {
    // A trava ja foi solta onde dava; aqui so a falha de banco antes dela.
    console.error("[checkout/webhook] falha ao receber", e instanceof Error ? e.message : e);
    return resposta(503, { ok: false, erro: "tente de novo" });
  }

  if (r.notificar) {
    const n = r.notificar;
    const userId = checkout.user_id;
    after(() => notificarPedidoExterno(admin, userId, n));
  }
  return resposta(r.status, r.corpo);
}

/** Abrir a URL no navegador: diz o que ela e, sem consultar o banco. */
export function GET() {
  return new NextResponse("Webhook do xcart: use POST com JSON.", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
