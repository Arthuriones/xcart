import { NextRequest, NextResponse } from "next/server";
import { apagarViaLoja } from "@/lib/stores/authorize";
import { createClient } from "@/lib/supabase/server";

/**
 * Os unicos buckets que estas rotas podem tocar.
 *
 * O nome do bucket vinha do corpo/querystring sem checagem. Bucket sem policy
 * de storage nao aceita escrita de ninguem, entao nao havia furo hoje -- mas
 * um bucket novo criado sem policy amanha abriria um.
 */
const BUCKETS_PERMITIDOS = new Set(["store-assets", "store-logos", "product-images"]);

export const runtime = "nodejs";

/**
 * Materiais da marca de uma loja: listar, enviar e apagar.
 *
 * Existe para as telas pararem de falar com o Supabase pelo navegador. Cada
 * tela que importava o cliente do browser carregava 59 KB comprimidos so por
 * causa disso -- e o RLS ja garante que o usuario so alcanca as proprias
 * lojas, aqui pela sessao em cookie.
 */
export async function GET(request: NextRequest) {
  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId e obrigatorio." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_assets")
    .select("id, store_id, file_path, label, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Falha ao listar materiais." }, { status: 500 });
  }
  return NextResponse.json({ assets: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData();
  const storeId = String(form.get("storeId") || "");
  const bucket = String(form.get("bucket") || "store-assets");
  if (!BUCKETS_PERMITIDOS.has(bucket)) {
    return NextResponse.json({ error: "Bucket invalido." }, { status: 400 });
  }
  const label = String(form.get("label") || "");
  const arquivo = form.get("file");

  if (!storeId || !(arquivo instanceof File)) {
    return NextResponse.json(
      { error: "storeId e arquivo sao obrigatorios." },
      { status: 400 }
    );
  }
  // O caminho comeca com o id do usuario porque a policy do bucket casa
  // foldername[1] com auth.uid(). Fora desse formato o upload e recusado.
  const nome = arquivo.name.replace(/[^\w.-]/g, "_");
  const path = `${user.id}/${storeId}/${Date.now()}-${nome}`;

  const { error: erroUpload } = await supabase.storage
    .from(bucket)
    .upload(path, arquivo, { upsert: true, contentType: arquivo.type || undefined });

  if (erroUpload) {
    return NextResponse.json({ error: "Falha ao enviar o arquivo." }, { status: 500 });
  }

  // store-logos guarda so o caminho na loja; store-assets vira linha propria.
  if (bucket === "store-assets") {
    const { error } = await supabase
      .from("store_assets")
      .insert({ store_id: storeId, file_path: path, label: label || nome });
    if (error) {
      return NextResponse.json(
        { error: "Arquivo enviado, mas falhou ao registrar." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ path });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const filePath = searchParams.get("filePath");
  const bucket = searchParams.get("bucket") || "store-assets";
  if (!id || !filePath) {
    return NextResponse.json(
      { error: "id e filePath sao obrigatorios." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Defesa em profundidade.
  //
  // filePath vem cru da querystring: nada aqui impedia pedir a remocao do
  // arquivo de outro usuario. Hoje quem segura e a policy do storage, que casa
  // foldername[1] com auth.uid() -- conferido bucket a bucket. Mas a rota
  // estava dependendo INTEIRAMENTE disso: bastaria alguem criar um bucket sem
  // policy, ou afrouxar uma, para virar IDOR de verdade.
  //
  // Aqui o caminho tem que comecar com o id de quem pediu, e o bucket tem que
  // ser um dos conhecidos -- `bucket` tambem vinha do usuario.
  if (!BUCKETS_PERMITIDOS.has(bucket)) {
    return NextResponse.json({ error: "Bucket invalido." }, { status: 400 });
  }
  if (!filePath.startsWith(`${user.id}/`) || filePath.includes("..")) {
    return NextResponse.json({ error: "Arquivo nao encontrado." }, { status: 404 });
  }
  // A linha do banco sai pelo helper, que faz o salto ate o dono da loja de
  // forma explicita. Antes era .eq("id", id) solto, com a recusa vindo so da
  // policy -- e o comentario acima ja dizia que depender de uma camada so era
  // o problema.
  const remocao = await apagarViaLoja("store_assets", id);
  if (!remocao.ok) {
    return NextResponse.json(
      { error: "Material nao encontrado." },
      { status: remocao.erro === "Unauthorized" ? 401 : 404 }
    );
  }

  const { error: erroArquivo } = await supabase.storage.from(bucket).remove([filePath]);
  if (erroArquivo) {
    return NextResponse.json({ error: "Falha ao remover o arquivo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
