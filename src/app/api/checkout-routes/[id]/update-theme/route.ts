import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicarConfigNoTema, TemaError } from "@/lib/checkout-routes/tema-vitrine";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Botao "Instalar na vitrine" / "Reenviar ao tema": poe o script desta rota no
 * theme.liquid do tema publicado e grava o xcart-config.json.
 *
 * A escrita mora em src/lib/checkout-routes/tema-vitrine.ts porque o conserto,
 * o liga/desliga e a divisao reenviam o mesmo config sozinhos -- antes so
 * este botao reenviava, e o tema ficava semanas atras do banco.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { embed, troca } = await publicarConfigNoTema(createAdminClient(), id, {
      instalar: true,
      forcar: true,
      userId: user.id,
    });

    // Os numeros do resumo somam TODOS os destinos: com rodizio, contar so o
    // primeiro faria o lojista achar que enviou menos mapa do que enviou.
    const totalSkus = embed.targets.reduce(
      (sum, item) => sum + Object.keys(item.skuMap).length,
      0
    );
    const totalVariants = embed.targets.reduce(
      (sum, item) => sum + Object.keys(item.variantMap).length,
      0
    );
    const lojas =
      embed.targets.length === 1
        ? "1 loja de checkout"
        : `${embed.targets.length} lojas de checkout`;

    return NextResponse.json({
      ok: true,
      updated: true,
      message: `${
        troca === "inserido" ? "Script inserido" : "Script atualizado"
      } + xcart-config.json enviado (${lojas}, ${totalSkus} SKUs, ${totalVariants} variantes).`,
      targetCount: embed.targets.length,
      skuCount: totalSkus,
      variantCount: totalVariants,
      // Mantidos para quem le o retorno esperando o destino principal.
      primarySkuCount: Object.keys(embed.skuMap).length,
      primaryVariantCount: Object.keys(embed.variantMap).length,
    });
  } catch (error) {
    if (error instanceof TemaError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 502 ? 500 : error.status });
    }
    const message = error instanceof Error ? error.message : "Falha ao atualizar tema.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
