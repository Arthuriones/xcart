import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Remover uma loja.
//
// O DELETE aqui e mais destrutivo do que parece, porque 12 tabelas apontam para
// `stores` com ON DELETE CASCADE -- produtos, avaliacoes geradas, materiais da
// marca, rastreamento inteiro e, o pior, `routed_checkout_configs` nas DUAS
// pontas (source e target).
//
// Essa ultima e a que machuca: apagar uma loja de CHECKOUT derruba a rota da
// vitrine que aponta para ela. A vitrine continua no ar recebendo trafego pago e
// o carrinho deixa de ter para onde ir -- sem erro em lugar nenhum, porque a
// linha de configuracao simplesmente nao existe mais.
//
// Por isso a remocao e em dois passos: a primeira chamada NAO apaga, devolve o
// inventario do que sumiria (409). So apaga com `confirmar: true`. Assim a tela
// mostra numeros reais em vez de "tem certeza?", que e a pergunta que todo mundo
// responde sim sem ler.
// ============================================================================

interface Inventario {
  produtos: number;
  rotasComoVitrine: number;
  rotasComoCheckout: number;
  rastreamentoLigado: boolean;
  materiais: number;
}

/** O que a remocao levaria junto. */
async function inventariar(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string
): Promise<Inventario> {
  const contar = async (tabela: string, coluna: string) => {
    const { count } = await admin
      .from(tabela)
      .select("id", { count: "exact", head: true })
      .eq(coluna, storeId);
    return count ?? 0;
  };

  const [produtos, comoVitrine, comoCheckout, materiais, { data: cfg }] =
    await Promise.all([
      contar("products", "store_id"),
      contar("routed_checkout_configs", "source_store_id"),
      // Um alvo de rota vive em routed_checkout_targets, e a config que o
      // aponta some por cascade quando a loja alvo e removida.
      contar("routed_checkout_targets", "target_store_id"),
      contar("store_assets", "store_id"),
      admin
        .from("tracking_configs")
        .select("enabled")
        .eq("store_id", storeId)
        .maybeSingle(),
    ]);

  return {
    produtos,
    rotasComoVitrine: comoVitrine,
    rotasComoCheckout: comoCheckout,
    rastreamentoLigado: Boolean(cfg?.enabled),
    materiais,
  };
}

/** Vale parar e perguntar, ou e uma loja vazia que da para remover direto? */
function exigeConfirmacao(inv: Inventario): boolean {
  return (
    inv.produtos > 0 ||
    inv.rotasComoVitrine > 0 ||
    inv.rotasComoCheckout > 0 ||
    inv.rastreamentoLigado
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!storeId) {
    return NextResponse.json(
      { error: "storeId e obrigatorio." },
      { status: 400 }
    );
  }

  // Cliente do usuario, e `.eq("user_id")` por cima: a loja tem que ser dele.
  // Sem isso um storeId qualquer na URL removeria loja de outro.
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, user_id, name, shop_domain")
    .eq("id", storeId)
    .eq("user_id", user.id)
    .single();

  if (storeError || !store) {
    return NextResponse.json(
      { error: "Loja nao encontrada." },
      { status: 404 }
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    confirmar?: boolean;
  };

  const admin = createAdminClient();
  const inventario = await inventariar(admin, store.id);

  if (!corpo.confirmar && exigeConfirmacao(inventario)) {
    return NextResponse.json(
      {
        precisaConfirmar: true,
        loja: { nome: store.name, dominio: store.shop_domain },
        inventario,
      },
      { status: 409 }
    );
  }

  try {
    // background_jobs tambem tem cascade, mas e apagada antes de proposito: job
    // em andamento escreve na loja, e deixar o cascade cuidar disso abre uma
    // janela em que o worker grava numa loja que esta sendo removida.
    const { error: jobsError } = await admin
      .from("background_jobs")
      .delete()
      .eq("store_id", store.id)
      .eq("user_id", user.id);

    if (jobsError) {
      return NextResponse.json(
        { error: `Erro ao remover jobs da loja: ${jobsError.message}` },
        { status: 500 }
      );
    }

    const { error: storeDeleteError } = await admin
      .from("stores")
      .delete()
      .eq("id", store.id)
      .eq("user_id", user.id);

    if (storeDeleteError) {
      return NextResponse.json(
        { error: `Erro ao remover loja: ${storeDeleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, removido: inventario });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao remover loja.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Atualiza os campos editaveis da loja (nome, logo, idioma, preco).
 *
 * Aqui em vez de no navegador para a tela de lojas parar de importar o
 * cliente Supabase -- eram 59 KB comprimidos so por causa dessas gravacoes.
 * A allowlist abaixo importa: sem ela, um PATCH poderia mexer em client_id,
 * client_secret ou user_id.
 */
const CAMPOS_EDITAVEIS = [
  "name",
  "logo_path",
  "target_language",
  "currency_code",
  "auto_convert_prices",
  "currency_rate",
  "price_markup_percent",
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (campo in body) patch[campo] = body[campo];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { error } = await supabase
    .from("stores")
    .update(patch)
    .eq("id", storeId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "Falha ao salvar a loja." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
