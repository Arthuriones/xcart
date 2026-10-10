import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  celularParaTela,
  lerCelularesDaTela,
  semTabelaDeCelulares,
  urlDeWebhookValida,
} from "@/lib/alertas/venda-webhook";
import { MAX_CELULARES, MAX_NOME, nomeDoCelular } from "@/lib/alertas/venda-celulares";

export const runtime = "nodejs";

// ============================================================================
// "Venda no celular": os celulares que recebem a venda (venda_webhooks, 070)
// e o liga/desliga geral (alerta_config.notificar_vendas).
//
//   GET    lista: id, nome, host e o ultimo envio. NUNCA a URL.
//   POST   { nome?, url } adiciona um celular (ate MAX_CELULARES).
//   PATCH  { ativo } liga/desliga tudo, sem apagar os celulares.
//
// Remover e testar um celular: /api/alertas/venda-webhook/[id] (DELETE) e
// /api/alertas/venda-webhook/[id]/teste (POST).
//
// A URL e segredo (a do Pushcut tem a chave da conta): a tabela nao tem
// policy, entao a SESSAO diz quem e o dono e o service role grava, sempre
// filtrando pelo user_id da sessao. A URL nunca vai em filtro de consulta
// (o PostgREST registra a query string): duplicado se confere aqui.
// ============================================================================

const SEM_TABELA = "Para cadastrar celulares, falta atualizar o banco. Tente de novo mais tarde.";

function json(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

async function usuarioDaSessao(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

async function lerCorpo(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const corpo = (await request.json()) as unknown;
    return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  const admin = createAdminClient();
  try {
    const [cfg, lista] = await Promise.all([
      admin.from("alerta_config").select("notificar_vendas").eq("user_id", user.id).maybeSingle(),
      lerCelularesDaTela(admin, user.id),
    ]);
    return json(200, {
      ok: true,
      ativo: (cfg.data as { notificar_vendas?: boolean } | null)?.notificar_vendas !== false,
      celulares: lista.celulares,
      semTabela: lista.semTabela,
      maximo: MAX_CELULARES,
    });
  } catch (e) {
    return json(500, { ok: false, erro: `Não deu para ler os celulares: ${e instanceof Error ? e.message : e}` });
  }
}

export async function POST(request: NextRequest) {
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  const corpo = await lerCorpo(request);
  if (!corpo) return json(400, { ok: false, erro: "Corpo inválido." });

  const url = typeof corpo.url === "string" ? corpo.url.trim() : "";
  if (!url || !urlDeWebhookValida(url)) {
    return json(400, { ok: false, erro: "Cole a URL inteira do webhook, começando com https://." });
  }
  const nome = nomeDoCelular(corpo.nome);
  if (!nome) return json(400, { ok: false, erro: `Use um nome de até ${MAX_NOME} letras.` });

  const admin = createAdminClient();

  const { data: atuais, error: erroLeitura } = await admin
    .from("venda_webhooks")
    .select("id, url")
    .eq("user_id", user.id)
    .limit(MAX_CELULARES + 1);
  if (erroLeitura) {
    if (semTabelaDeCelulares(erroLeitura)) return json(409, { ok: false, erro: SEM_TABELA, semTabela: true });
    return json(500, { ok: false, erro: `Não deu para salvar: ${erroLeitura.message}` });
  }
  const lista = (atuais || []) as { id: string; url: string | null }[];
  if (lista.some((l) => String(l.url || "").trim() === url)) {
    return json(409, { ok: false, erro: "Esse webhook já está cadastrado." });
  }
  if (lista.length >= MAX_CELULARES) {
    return json(409, { ok: false, erro: `O limite é de ${MAX_CELULARES} celulares. Remova um para adicionar outro.` });
  }

  const { data: linha, error } = await admin
    .from("venda_webhooks")
    .insert({ user_id: user.id, nome, url })
    .select("id, nome, url, ultimo_envio_em, ultimo_erro")
    .single();
  if (error || !linha) {
    if (error?.code === "23505") return json(409, { ok: false, erro: "Esse webhook já está cadastrado." });
    // A mensagem do Postgres nao traz a URL (ela fica no `details`, que nao sai daqui).
    return json(500, { ok: false, erro: `Não deu para salvar: ${error?.message ?? "sem resposta do banco"}` });
  }

  // O primeiro celular liga o aviso: quem cadastra quer receber.
  if (lista.length === 0) {
    const { error: erroCfg } = await admin
      .from("alerta_config")
      .upsert(
        { user_id: user.id, notificar_vendas: true, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (erroCfg) console.warn("[alertas/venda-webhook] nao ligou o aviso", erroCfg.message);
  }

  return json(200, {
    ok: true,
    celular: celularParaTela(
      linha as { id: string; nome: string | null; url: string | null; ultimo_envio_em: string | null; ultimo_erro: string | null }
    ),
  });
}

export async function PATCH(request: NextRequest) {
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  const corpo = await lerCorpo(request);
  if (!corpo || typeof corpo.ativo !== "boolean") return json(400, { ok: false, erro: "Corpo inválido." });

  // A linha de config pode nao existir ainda (quem nunca abriu o Telegram).
  const { error } = await createAdminClient()
    .from("alerta_config")
    .upsert(
      { user_id: user.id, notificar_vendas: corpo.ativo, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return json(500, { ok: false, erro: `Não deu para salvar: ${error.message}` });
  return json(200, { ok: true, ativo: corpo.ativo });
}
