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
      .select("enabled, web_pixel_visto_em, updated_at")
      .eq("store_id", loja.id)
      .maybeSingle();
    console.log("  ligado :", cfg?.enabled ? "sim" : "nao");
    console.log("  pixel checkout:", cfg?.web_pixel_visto_em || "(nunca mandou evento)");

    // Os destinos sao LINHAS desde a 043 -- a loja pode ter cinco contas de
    // Google e dois pixels Meta. Ler as colunas antigas aqui mostraria o estado
    // de antes da migracao, e o script mentiria.
    const { destinosParaTela } = await import("../src/lib/tracking/destinos");
    const destinos = (await destinosParaTela(admin, [loja.id])).get(loja.id) || [];
    if (destinos.length === 0) {
      console.log("  destinos: (nenhum)");
    } else {
      for (const d of destinos) {
        const extra =
          d.plataforma === "meta"
            ? `token ${d.temToken ? "presente" : "AUSENTE"}`
            : `rotulos: ${Object.keys(d.labels).join(", ") || "(nenhum)"}`;
        console.log(
          `  destino: ${d.plataforma} ${d.conta} "${d.nome || "-"}" ` +
            `${d.ativo ? "ativo" : "desativado"} / ${extra}`
        );
      }
    }
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
  // Em tracking_destinations, uma linha por conta -- nao mais em colunas de
  // tracking_configs.
  //
  // Isso resolve de raiz o acidente que o comentario antigo aqui descrevia:
  // configurar um destino APAGAVA o outro, porque o upsert escrevia a linha
  // inteira. Com uma linha por conta, Google e Meta nao se tocam, e a segunda
  // conta da mesma plataforma tem onde morar.
  //
  // O unique e (store_id, plataforma, conta): rodar de novo com a mesma conta
  // ATUALIZA, nao duplica.
  const { error: e0 } = await admin.from("tracking_configs").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );
  if (e0) {
    console.error("falha ao ligar a loja:", e0.message);
    process.exit(1);
  }

  const alvo = loja;

  async function gravarDestino(
    plataforma: "google" | "meta",
    conta: string,
    campos: Record<string, unknown>
  ): Promise<string> {
    const { data: ja } = await admin
      .from("tracking_destinations")
      .select("id")
      .eq("store_id", alvo.id)
      .eq("plataforma", plataforma)
      .eq("conta", conta)
      .maybeSingle();

    if (ja) {
      const { error } = await admin
        .from("tracking_destinations")
        .update({ ...campos, ativo: true, updated_at: new Date().toISOString() })
        .eq("id", ja.id);
      if (error) {
        console.error(`falha ao atualizar destino ${plataforma}:`, error.message);
        process.exit(1);
      }
      return ja.id;
    }

    const { data: criado, error } = await admin
      .from("tracking_destinations")
      .insert({
        store_id: alvo.id,
        user_id: alvo.user_id,
        plataforma,
        conta,
        nome: plataforma === "google" ? "Google Ads" : "Meta",
        ...campos,
      })
      .select("id")
      .single();
    if (error || !criado) {
      console.error(`falha ao criar destino ${plataforma}:`, error?.message || "sem id");
      process.exit(1);
    }
    return criado.id;
  }

  if (aw) {
    // Mapa com a compra. O rotulo e obrigatorio junto do --aw, entao nunca grava
    // conta sem rotulo -- conta sem rotulo nao envia nada e apareceria como
    // "configurado" na tela.
    await gravarDestino("google", aw, { labels: { purchase: rotulo } });
    console.log(`  destino Google gravado: ${aw} / purchase=${rotulo}`);
  }

  if (pixel) {
    const destinoId = await gravarDestino("meta", pixel, {
      // O codigo de teste acompanha o pixel: e dele que ele fala.
      test_event_code: codigoTeste,
    });
    const { error: e2 } = await admin.from("tracking_destination_secrets").upsert(
      {
        destination_id: destinoId,
        access_token: token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "destination_id" }
    );
    if (e2) {
      console.error("falha ao gravar token:", e2.message);
      process.exit(1);
    }
    console.log(`  destino Meta gravado: ${pixel} (token ${token!.length} chars)`);
  }

  console.log("\n  rastreamento LIGADO.");
  console.log("  conferir com: npx tsx scripts/testar-webhook-pedido.ts " + loja.shop_domain);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
