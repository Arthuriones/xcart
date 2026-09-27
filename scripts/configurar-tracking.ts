/**
 * Liga o rastreamento de uma loja: pixel, token e (opcional) codigo de teste.
 *
 * Existe porque a tela de configuracao so chega na fase 4, e sem isso o
 * webhook responde "rastreamento desligado" e nada sai.
 *
 * Valida o token ANTES de gravar como ligado: manda um evento de teste ao
 * Meta e so persiste `enabled=true` se ele aceitar. Token errado descoberto
 * aqui custa um comando; descoberto na primeira venda custa a venda.
 *
 * Uso:
 *   npx tsx scripts/configurar-tracking.ts --loja <dominio> --aw AW-123456789 --rotulo AbC-D_efGh
 *   npx tsx scripts/configurar-tracking.ts --loja <dominio> --pixel <id> --token <token> [--teste TEST12345]
 *   npx tsx scripts/configurar-tracking.ts --loja <dominio> --desligar
 *   npx tsx scripts/configurar-tracking.ts --loja <dominio> --ver
 *
 * O token NAO aparece no terminal nem no log -- so o tamanho, para conferir
 * que veio inteiro.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const dominio = arg("loja");
const pixel = arg("pixel");
const aw = arg("aw");
const rotulo = arg("rotulo");
const token = arg("token");
const codigoTeste = arg("teste");
const desligar = process.argv.includes("--desligar");
const apenasVer = process.argv.includes("--ver");

if (!dominio) {
  console.error("falta --loja <dominio>");
  process.exit(1);
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  const { data: loja } = await admin
    .from("stores")
    .select("id, name, shop_domain, user_id")
    .eq("shop_domain", dominio)
    .maybeSingle();

  if (!loja) {
    console.error(`loja ${dominio} nao encontrada`);
    process.exit(1);
  }
  console.log(`loja: ${loja.name} (${loja.shop_domain})`);

  if (apenasVer) {
    const { data: cfg } = await admin
      .from("tracking_configs")
      .select("enabled, meta_pixel_id, meta_test_event_code, google_conversion_id, google_conversion_label, updated_at")
      .eq("store_id", loja.id)
      .maybeSingle();
    const { data: seg } = await admin
      .from("tracking_secrets")
      .select("meta_access_token")
      .eq("store_id", loja.id)
      .maybeSingle();
    console.log("  config :", cfg ?? "(nenhuma)");
    console.log("  token  :", seg?.meta_access_token ? `presente (${seg.meta_access_token.length} chars)` : "ausente");
    const { data: fila } = await admin
      .from("tracking_events")
      .select("status")
      .eq("store_id", loja.id);
    const cont: Record<string, number> = {};
    for (const e of fila || []) cont[e.status] = (cont[e.status] || 0) + 1;
    console.log("  fila   :", Object.keys(cont).length ? cont : "(vazia)");
    return;
  }

  if (desligar) {
    await admin
      .from("tracking_configs")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("store_id", loja.id);
    console.log("  rastreamento DESLIGADO (pixel e token preservados)");
    return;
  }

  const querMeta = Boolean(pixel || token);
  const querGoogle = Boolean(aw || rotulo);

  if (!querMeta && !querGoogle) {
    console.error("falta --aw + --rotulo (Google) ou --pixel + --token (Meta)");
    process.exit(1);
  }
  if (querMeta && (!pixel || !token)) {
    console.error("Meta precisa dos dois: --pixel e --token");
    process.exit(1);
  }
  if (querGoogle && (!aw || !rotulo)) {
    // Um sem o outro nao identifica conversao nenhuma -- a requisicao sairia
    // e o Google descartaria em silencio.
    console.error("Google precisa dos dois: --aw e --rotulo");
    process.exit(1);
  }
  if (querGoogle) {
    const { apenasNumeroDaConversao } = await import("../src/lib/tracking/normalizar");
    if (!apenasNumeroDaConversao(aw!)) {
      console.error(`--aw invalido: "${aw}" (esperado AW-123456789)`);
      process.exit(1);
    }
    console.log(`  google: ${aw} / ${rotulo}`);
  }
  if (querMeta) {
    console.log(`  pixel: ${pixel}`);
    console.log(`  token: ${token!.length} chars`);
    console.log(`  teste: ${codigoTeste || "(sem codigo -- o evento vai para PRODUCAO)"}`);
  }

  // --- valida o token do Meta antes de ligar --------------------------------
  //
  // So o Meta da para validar de antemao: a API dele responde se aceitou. O
  // endpoint de conversao do Google devolve 200 mesmo quando ignora o
  // conteudo, entao nao existe "testar o AW" -- a conferencia e na tela do
  // Google Ads, depois da primeira venda.
  if (querMeta) {
  const { enviarParaMeta, validarEscritaNoPixel } = await import(
    "../src/lib/tracking/meta-capi"
  );
  const { montarUserData, sha256 } = await import("../src/lib/tracking/normalizar");

  // O que decide: o token consegue ESCREVER no pixel?
  //
  // Com um evento custom, nao com um Purchase. Sem `test_event_code` um Purchase
  // de teste conta como conversao de verdade e entra no aprendizado da campanha;
  // um nome custom que ninguem configurou como conversao nao otimiza nada.
  //
  // Nao uso a leitura do pixel para barrar: medido, um token que escreve sem
  // problema responde "(#100) Missing Permission" no GET -- system user com
  // ads_management escreve e nao le metadado.
  const escrita = await validarEscritaNoPixel(pixel!, token!);
  if (!escrita.ok) {
    console.error(`\n  META RECUSOU A CREDENCIAL: ${escrita.erro}`);
    console.error("  nada foi gravado como ligado.");
    process.exit(1);
  }
  console.log(
    `\n  Meta aceitou escrita no pixel (trace ${escrita.trace || "-"}).`
  );
  console.log(
    "  o evento de prova e custom (XcartCredentialCheck): aparece no Events\n" +
      "  Manager e nao e usado para otimizar campanha."
  );

  const agora = Math.floor(Date.now() / 1000);
  const prova = codigoTeste
    ? await enviarParaMeta(
    pixel!,
    token!,
    [
      {
        event_name: "Purchase",
        event_time: agora,
        event_id: `teste_config_${agora}`,
        action_source: "website",
        user_data: montarUserData(
          { email: "teste+config@exemplo.com", pais: "JP" },
          { clientIp: "203.0.113.9", userAgent: "xcart/config" }
        ),
        custom_data: { currency: "JPY", value: 1 },
      },
    ],
    // Sem codigo de teste isto contaria como conversao de verdade. Com codigo,
    // cai na aba de teste do Events Manager.
        { testEventCode: codigoTeste }
      )
    : null;

  if (prova && !prova.ok) {
    console.error(`\n  EVENTO DE PROVA RECUSADO PELO META: ${prova.erro}`);
    console.error("  nada foi gravado como ligado.");
    process.exit(1);
  }
  if (prova) {
    console.log(
      `  Meta aceitou o evento de prova (${prova.recebidos}, trace ${prova.trace || "-"})`
    );
    console.log(
      `  hash de conferencia do e-mail: ${sha256("teste+config@exemplo.com").slice(0, 16)}...`
    );
  }
  }

  // --- grava ----------------------------------------------------------------
  //
  // SO os campos que vieram nesta chamada.
  //
  // Antes o upsert escrevia todos, e ai configurar um destino APAGAVA o outro:
  // rodar `--pixel` depois de `--aw` zerava o Google, sem aviso. Aconteceu de
  // verdade nesta loja. Upsert grava a linha inteira -- campo ausente do objeto
  // fica como estava, campo com null vira null.
  const patch: Record<string, unknown> = {
    store_id: loja.id,
    user_id: loja.user_id,
    enabled: true,
    updated_at: new Date().toISOString(),
  };
  if (pixel) {
    patch.meta_pixel_id = pixel;
    // O codigo de teste acompanha o pixel: e dele que ele fala.
    patch.meta_test_event_code = codigoTeste;
  }
  if (aw) patch.google_conversion_id = aw;
  if (rotulo) {
    // As duas: o mapa e a fonte de verdade, a coluna e fallback de leitura.
    // Gravar so a coluna deixaria a compra funcionando por fallback e o mapa
    // vazio, e ai a tela mostraria o campo do rotulo em branco.
    patch.google_labels = { purchase: rotulo };
    patch.google_conversion_label = rotulo;
  }

  const { error: e1 } = await admin
    .from("tracking_configs")
    .upsert(patch, { onConflict: "store_id" });
  if (e1) {
    console.error("falha ao gravar config:", e1.message);
    process.exit(1);
  }

  if (token) {
    const { error: e2 } = await admin.from("tracking_secrets").upsert(
      {
        store_id: loja.id,
        meta_access_token: token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" }
    );
    if (e2) {
      console.error("falha ao gravar token:", e2.message);
      process.exit(1);
    }
  }

  console.log("\n  rastreamento LIGADO.");
  console.log("  conferir com: npx tsx scripts/testar-webhook-pedido.ts " + loja.shop_domain);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
