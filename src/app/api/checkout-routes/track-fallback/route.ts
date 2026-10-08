import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sufixoDaMoeda } from "@/lib/checkout-routes/carrinho-levado";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Evita um preflight por evento no caminho de fallback (fetch keepalive).
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Registra quando o loader da vitrine cai pro checkout nativo em vez de
// rotear pra loja checkout. Best-effort: nunca deve afetar o fluxo de compra do
// cliente, entao qualquer falha aqui so retorna ok:false em silencio.
// O loader manda o corpo como text/plain de proposito: e um dos Content-Type
// da lista segura do CORS, e so assim o sendBeacon sobrevive a navegacao
// (application/json obriga um preflight OPTIONS que o browser descarta quando
// a pagina esta saindo). Por isso o parse e feito na mao a partir do texto —
// request.json() rejeitaria pelo cabecalho.
async function lerCorpo(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const texto = await request.text();
    if (!texto) return {};
    const dados = JSON.parse(texto);
    return dados && typeof dados === "object" ? dados : {};
  } catch {
    return {};
  }
}

// O targetId vem do navegador do comprador: so entra no banco se tiver cara
// de uuid (a coluna e FK, um valor torto derrubaria o insert inteiro).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = await lerCorpo(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const reason =
    typeof body.reason === "string" ? body.reason.slice(0, 200) : "desconhecido";
  const detalheBruto =
    typeof body.detail === "string" ? body.detail.slice(0, 500) : null;
  // Carrinho levado: a moeda da vitrine e o pais do permalink vao no fim do
  // detalhe, escritos AQUI a partir de campos validados (o texto do navegador
  // nunca vira chave=valor). Formato e leitura em carrinho-levado.ts.
  const detail =
    reason === "routed_ok" && detalheBruto !== null
      ? detalheBruto.replace(/\s+[a-z]+=\S*/gi, "") + sufixoDaMoeda(body.moeda, body.paisCheckout)
      : detalheBruto;
  const pageUrl =
    typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 500) : null;
  // Com rodizio, saber que "a rota falhou" nao basta: o que interessa e qual
  // das lojas de checkout falhou.
  const targetId =
    typeof body.targetId === "string" && UUID_RE.test(body.targetId)
      ? body.targetId
      : null;

  if (!token) {
    return NextResponse.json({ ok: false }, { headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();
    const { data: config } = await supabase
      .from("routed_checkout_configs")
      .select("id")
      .eq("public_token", token)
      .single();

    if (config?.id) {
      await supabase.from("routed_checkout_fallbacks").insert({
        route_config_id: config.id,
        target_id: targetId,
        reason,
        detail,
        page_url: pageUrl,
      });
    }
  } catch {
    // best-effort: nao deixa o log quebrar nada pro cliente
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
