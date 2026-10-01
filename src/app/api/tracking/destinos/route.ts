import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";
import { limparMapaDeRotulos } from "@/lib/tracking/eventos";
import { TEMPLATE_PADRAO, validarTemplate } from "@/lib/tracking/id-produto";

export const runtime = "nodejs";

// ============================================================================
// Os destinos de conversao de uma loja: criar, editar, remover.
//
// POR QUE VARIOS POR LOJA
//
// Pedido do Arthur, e caso real: cinco contas de Google anunciando produtos
// diferentes do mesmo catalogo. Antes da 043 isto era UMA coluna por
// plataforma, e a segunda conta nao tinha onde morar.
//
// Mandar todo evento para TODAS as contas e correto, nao desperdicio: conversao
// cujo gclid nao pertence a conta e DESCARTADA pelo Google -- a conta dona do
// clique conta, as outras ignoram. Entao nao existe roteamento a fazer por
// produto, e tentar adivinhar qual conta e a dona custaria a conversao quando
// adivinhasse errado.
//
// TUDO PASSA PELO SERVICE ROLE
//
// A linha carrega `user_id`, e deixar o cliente escolher esse campo abriria a
// porta para apontar o destino para a loja de outro. O dono e lido do banco a
// partir da sessao, nunca do corpo da requisicao.
// ============================================================================

/**
 * Teto de destinos por loja.
 *
 * Cada evento gera uma linha de fila POR destino: 20 destinos transformam um
 * `view_item` em 20 escritas e 20 chamadas de rede. O teto nao e burocracia, e
 * o que impede o rastreamento de uma loja virar carga de banco para todas.
 */
const MAX_DESTINOS_POR_LOJA = 20;

interface CorpoDestino {
  storeId?: string;
  id?: string;
  plataforma?: string;
  nome?: string | null;
  conta?: string | null;
  /** So Google: {"purchase":"AbC...","add_to_cart":"XyZ..."}. */
  labels?: Record<string, string> | null;
  testEventCode?: string | null;
  /**
   * Formato do id de produto: {variant_id}, {product_id}, {sku}.
   *
   * Vazio = `{variant_id}`, o comportamento de antes de isto existir.
   */
  idTemplate?: string | null;
  ativo?: boolean;
  /**
   * Token do CAPI do Meta. Vazio/ausente na EDICAO = nao mexer no gravado.
   *
   * Nunca volta na leitura: a tela so recebe um booleano dizendo se existe.
   * Vazio nao apaga de proposito -- a tela manda o campo vazio em todo
   * salvamento normal, e apagar ali derrubaria o rastreamento a cada vez que o
   * lojista renomeasse o destino.
   */
  accessToken?: string | null;
}

async function lerCorpo(request: NextRequest): Promise<CorpoDestino | null> {
  try {
    return (await request.json()) as CorpoDestino;
  } catch {
    return null;
  }
}

type Autorizacao =
  | { erro: NextResponse }
  | {
      erro: null;
      admin: ReturnType<typeof createAdminClient>;
      loja: { id: string; user_id: string };
    };

/** A sessao e a loja que ela pode mexer. */
async function autorizar(storeId: string): Promise<Autorizacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", storeId)
    .maybeSingle();

  if (!loja || loja.user_id !== user.id) {
    return { erro: NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 }) };
  }
  return { erro: null, admin, loja };
}

/**
 * Normaliza e valida os campos da plataforma.
 *
 * `exigirToken` so no cadastro: na edicao, campo vazio significa "mantem o que
 * esta gravado".
 */
function validar(
  plataforma: "google" | "meta",
  corpo: CorpoDestino,
  opcoes: { exigirToken: boolean; jaTemToken?: boolean }
):
  | { erro: string }
  | {
      conta: string;
      labels: Record<string, string>;
      testEventCode: string | null;
      idTemplate: string | null;
      token: string | null;
    } {
  const token = (corpo.accessToken || "").trim() || null;

  // O template vai cru para dentro de `content_ids` do Meta e de `ecomm_prodid`
  // do Google. Template invalido nao da erro em lugar nenhum: o evento e
  // aceito e o anuncio dinamico so nao serve aquele item. Entao a recusa e
  // aqui, enquanto o lojista ainda esta olhando.
  const template = (corpo.idTemplate || "").trim();
  if (template && template !== TEMPLATE_PADRAO) {
    const erro = validarTemplate(template);
    if (erro) return { erro };
  }
  const idTemplate = template && template !== TEMPLATE_PADRAO ? template : null;

  if (plataforma === "google") {
    const bruto = (corpo.conta || "").trim();
    const numero = apenasNumeroDaConversao(bruto);
    if (!numero) {
      return { erro: "ID de conversão inválido. Esperado algo como AW-123456789." };
    }

    // Descarta evento desconhecido e rotulo vazio: o mapa nunca chega ao banco
    // como {"purchase": ""}.
    const labels = limparMapaDeRotulos(corpo.labels);
    if (Object.keys(labels).length === 0) {
      return {
        erro:
          "Preencha o rótulo de ao menos um evento — no Google cada evento é uma " +
          "ação de conversão própria, e sem rótulo não há o que enviar.",
      };
    }

    // Guardado como AW-<digitos>: o lojista cola o que o painel mostra, com
    // espaco ou sem prefixo, e a URL do endpoint recusa qualquer outra forma.
    return { conta: `AW-${numero}`, labels, testEventCode: null, idTemplate, token: null };
  }

  // So digitos: o Events Manager as vezes mostra o id com espaco, e o Meta
  // recusa a URL do endpoint se vier qualquer outra coisa.
  const pixel = (corpo.conta || "").replace(/\D/g, "");
  if (!pixel) {
    return { erro: "ID do pixel inválido. Esperado só dígitos." };
  }

  if (opcoes.exigirToken && !token && !opcoes.jaTemToken) {
    // Pixel sem token nao envia NADA: a linha existiria na tela como
    // "configurado" e o Meta nunca receberia um evento.
    return { erro: "O Meta precisa do token do CAPI — sem ele nenhum evento sai." };
  }

  return {
    conta: pixel,
    labels: {},
    testEventCode: (corpo.testEventCode || "").trim() || null,
    idTemplate,
    token,
  };
}

/** Mensagem legivel para o unique (store_id, plataforma, conta). */
function erroDeBanco(mensagem: string): NextResponse {
  if (mensagem.includes("tracking_destinations_loja_conta_key")) {
    return NextResponse.json(
      {
        error:
          "Esta conta já está cadastrada nesta loja. A mesma conta duas vezes " +
          "duplicaria toda conversão.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: mensagem }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const corpo = await lerCorpo(request);
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  if (!corpo.storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }
  if (corpo.plataforma !== "google" && corpo.plataforma !== "meta") {
    return NextResponse.json({ error: "Plataforma invalida." }, { status: 400 });
  }

  const auth = await autorizar(corpo.storeId);
  if (auth.erro !== null) return auth.erro;
  const { admin, loja } = auth;

  const { count } = await admin
    .from("tracking_destinations")
    .select("id", { count: "exact", head: true })
    .eq("store_id", loja.id);

  if ((count ?? 0) >= MAX_DESTINOS_POR_LOJA) {
    return NextResponse.json(
      {
        error: `Limite de ${MAX_DESTINOS_POR_LOJA} destinos por loja. Remova ou desative um antes.`,
      },
      { status: 400 }
    );
  }

  const v = validar(corpo.plataforma, corpo, { exigirToken: true });
  if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });

  const { data: criado, error } = await admin
    .from("tracking_destinations")
    .insert({
      store_id: loja.id,
      user_id: loja.user_id,
      plataforma: corpo.plataforma,
      nome: (corpo.nome || "").trim() || null,
      conta: v.conta,
      labels: v.labels,
      test_event_code: v.testEventCode,
      id_template: v.idTemplate,
      ativo: corpo.ativo ?? true,
    })
    .select("id")
    .single();

  if (error) return erroDeBanco(error.message);

  if (v.token && criado) {
    const { error: erroSegredo } = await admin
      .from("tracking_destination_secrets")
      .upsert({ destination_id: criado.id, access_token: v.token }, {
        onConflict: "destination_id",
      });
    if (erroSegredo) {
      // O destino sem token nao envia nada e ficaria como armadilha silenciosa
      // na tela. Desfaz, para o lojista tentar de novo em vez de descobrir na
      // primeira venda.
      await admin.from("tracking_destinations").delete().eq("id", criado.id);
      return NextResponse.json({ error: erroSegredo.message }, { status: 500 });
    }
  }

  // A linha de config precisa existir para o interruptor da loja ter onde
  // morar. Nao liga nada aqui: ligar e um passo explicito do lojista.
  await admin
    .from("tracking_configs")
    .upsert({ store_id: loja.id, user_id: loja.user_id }, { onConflict: "store_id" });

  return NextResponse.json({ ok: true, id: criado?.id ?? null });
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const corpo = await lerCorpo(request);
  if (!corpo) return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  if (!corpo.id) return NextResponse.json({ error: "id ausente." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("tracking_destinations")
    .select(
      "id, store_id, user_id, plataforma, conta, labels, test_event_code, id_template, ativo"
    )
    .eq("id", corpo.id)
    .maybeSingle();

  // user_id da propria linha, nao da loja: a linha e que decide, e e ela que a
  // policy usaria.
  if (!atual || atual.user_id !== user.id) {
    return NextResponse.json({ error: "Destino nao encontrado." }, { status: 404 });
  }

  const plataforma = atual.plataforma as "google" | "meta";

  // So desligar/ligar: nao exige reenviar conta nem rotulo, senao o toggle da
  // tela precisaria carregar o formulario inteiro.
  const soMudarAtivo =
    typeof corpo.ativo === "boolean" &&
    corpo.conta === undefined &&
    corpo.labels === undefined &&
    corpo.nome === undefined &&
    !(corpo.accessToken || "").trim();

  if (soMudarAtivo) {
    const { error } = await admin
      .from("tracking_destinations")
      .update({ ativo: corpo.ativo, updated_at: new Date().toISOString() })
      .eq("id", atual.id);
    if (error) return erroDeBanco(error.message);
    return NextResponse.json({ ok: true });
  }

  const { data: segredo } = await admin
    .from("tracking_destination_secrets")
    .select("access_token")
    .eq("destination_id", atual.id)
    .maybeSingle();

  const v = validar(
    plataforma,
    {
      ...corpo,
      conta: corpo.conta ?? atual.conta,
      labels: corpo.labels ?? (atual.labels as Record<string, string> | null),
      testEventCode: corpo.testEventCode ?? atual.test_event_code,
      idTemplate: corpo.idTemplate ?? atual.id_template,
    },
    { exigirToken: true, jaTemToken: Boolean(segredo?.access_token) }
  );
  if ("erro" in v) return NextResponse.json({ error: v.erro }, { status: 400 });

  const mudancas: Record<string, unknown> = {
    conta: v.conta,
    labels: v.labels,
    test_event_code: v.testEventCode,
    id_template: v.idTemplate,
    ativo: corpo.ativo ?? atual.ativo,
    updated_at: new Date().toISOString(),
  };
  // Campo ausente nao vira null: PATCH sem `nome` nao e "apague o nome".
  if (corpo.nome !== undefined) mudancas.nome = (corpo.nome || "").trim() || null;

  const { error } = await admin
    .from("tracking_destinations")
    .update(mudancas)
    .eq("id", atual.id);

  if (error) return erroDeBanco(error.message);

  // Token novo substitui; vazio mantem o que esta gravado.
  if (v.token) {
    const { error: erroSegredo } = await admin
      .from("tracking_destination_secrets")
      .upsert({ destination_id: atual.id, access_token: v.token }, {
        onConflict: "destination_id",
      });
    if (erroSegredo) {
      return NextResponse.json({ error: erroSegredo.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Remover
// ---------------------------------------------------------------------------
//
// Apagar leva o HISTORICO junto: `tracking_events.destination_id` tem
// `on delete cascade`, entao os envios daquela conta saem da contagem da tela.
// A tela avisa isso e oferece desativar, que para de enviar e preserva o que
// ja saiu.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id ausente." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: atual } = await admin
    .from("tracking_destinations")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!atual || atual.user_id !== user.id) {
    return NextResponse.json({ error: "Destino nao encontrado." }, { status: 404 });
  }

  const { error } = await admin.from("tracking_destinations").delete().eq("id", atual.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
