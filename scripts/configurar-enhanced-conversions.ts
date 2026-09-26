/**
 * Liga o enhanced conversions de uma loja e PROVA que a cadeia funciona.
 *
 * Enhanced conversions e uma segunda chamada por venda: a conversao base leva o
 * gclid e conta a venda, esta acrescenta e-mail e telefone hasheados por cima,
 * casando pelo numero do pedido. Ela vai pela Google Ads API, nao pelo ping.
 *
 * O ensaio no fim (--ensaio, ligado por padrao) usa validateOnly: o Google
 * valida credencial, conversion action e formato dos hashes e NAO aplica nada.
 * E o unico jeito de descobrir agora, e nao na primeira venda, que o developer
 * token nao tem acesso ou que o rotulo e de outra conta.
 *
 * Antes de rodar, tres coisas precisam existir:
 *
 *   1. GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID e
 *      GOOGLE_ADS_OAUTH_CLIENT_SECRET no ambiente (sao do xcart, nao do lojista);
 *   2. na conta de anuncios: a acao de compra com enhanced conversions ligado e
 *      o metodo marcado como "Google Ads API";
 *   3. um refresh token OAuth da conta Google do lojista, com escopo
 *      https://www.googleapis.com/auth/adwords.
 *
 * Uso:
 *   npx tsx scripts/configurar-enhanced-conversions.ts --loja <dominio> --ver
 *   npx tsx scripts/configurar-enhanced-conversions.ts --loja <dominio> \
 *     --customer 1234567890 [--mcc 9876543210] --refresh <token>
 *   npx tsx scripts/configurar-enhanced-conversions.ts --loja <dominio> --desligar
 *
 * O refresh token nao aparece no terminal -- so o tamanho, para conferir que
 * veio inteiro.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const dominio = arg("loja");
const customer = arg("customer");
const mcc = arg("mcc");
const refresh = arg("refresh");
const apenasVer = process.argv.includes("--ver");
const desligar = process.argv.includes("--desligar");
const semEnsaio = process.argv.includes("--sem-ensaio");

if (!dominio) {
  console.error("falta --loja <dominio>");
  process.exit(1);
}

const soDigitos = (v: string | null) => {
  const d = (v || "").replace(/\D/g, "");
  return d || null;
};

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const {
    apiDisponivel,
    dataDeAjuste,
    descobrirConversionAction,
    enviarEnhancement,
  } = await import("../src/lib/tracking/google-ads-api");
  const { sha256 } = await import("../src/lib/tracking/normalizar");

  const admin = createAdminClient();

  const { data: loja } = await admin
    .from("stores")
    .select("id, name, shop_domain")
    .eq("shop_domain", dominio)
    .maybeSingle();

  if (!loja) {
    console.error(`loja ${dominio} nao encontrada`);
    process.exit(1);
  }
  console.log(`loja: ${loja.name || loja.shop_domain} (${loja.id})`);

  if (!apiDisponivel()) {
    console.error(
      "\nfalta no ambiente: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID,\n" +
        "GOOGLE_ADS_OAUTH_CLIENT_SECRET. Sem eles nenhum enhancement sai."
    );
    if (!apenasVer) process.exit(1);
  }

  if (desligar) {
    // Apaga o refresh token e o customer id: sem os dois o webhook nao
    // enfileira mais enhancement. A conversao base continua saindo.
    await admin
      .from("tracking_secrets")
      .update({ google_refresh_token: null })
      .eq("store_id", loja.id);
    await admin
      .from("tracking_configs")
      .update({ google_customer_id: null, google_conversion_action_id: null })
      .eq("store_id", loja.id);
    console.log("\nenhanced conversions desligado. A conversao base segue normal.");
    return;
  }

  // ---- gravar o que veio por parametro
  if (refresh) {
    const { error } = await admin.from("tracking_secrets").upsert(
      { store_id: loja.id, google_refresh_token: refresh },
      { onConflict: "store_id" }
    );
    if (error) throw new Error(`falha ao gravar o refresh token: ${error.message}`);
    console.log(`refresh token gravado (${refresh.length} caracteres)`);
  }

  if (customer) {
    const digitos = soDigitos(customer);
    if (!digitos) {
      console.error(`--customer invalido: "${customer}"`);
      process.exit(1);
    }
    // Trocar de conta invalida o id da action guardado: ele e de OUTRA conta, e
    // enriqueceria a conversao errada sem dar erro nenhum.
    const { error } = await admin.from("tracking_configs").upsert(
      {
        store_id: loja.id,
        user_id: (
          await admin.from("stores").select("user_id").eq("id", loja.id).single()
        ).data?.user_id,
        google_customer_id: digitos,
        google_login_customer_id: soDigitos(mcc),
        google_conversion_action_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" }
    );
    if (error) throw new Error(`falha ao gravar a conta: ${error.message}`);
    console.log(`conta: ${digitos}${soDigitos(mcc) ? ` (via MCC ${soDigitos(mcc)})` : ""}`);
  }

  // ---- estado atual
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin
      .from("tracking_configs")
      .select(
        "enabled, google_conversion_id, google_conversion_label, google_customer_id, google_login_customer_id, google_conversion_action_id"
      )
      .eq("store_id", loja.id)
      .maybeSingle(),
    admin
      .from("tracking_secrets")
      .select("google_refresh_token")
      .eq("store_id", loja.id)
      .maybeSingle(),
  ]);

  console.log("\n--- estado ---");
  console.log(`rastreamento ligado : ${cfg?.enabled ? "sim" : "NAO"}`);
  console.log(`id de conversao     : ${cfg?.google_conversion_id || "(vazio)"}`);
  console.log(`rotulo              : ${cfg?.google_conversion_label || "(vazio)"}`);
  console.log(`conta de anuncios   : ${cfg?.google_customer_id || "(vazio)"}`);
  console.log(`MCC                 : ${cfg?.google_login_customer_id || "(nenhuma)"}`);
  console.log(
    `refresh token       : ${seg?.google_refresh_token ? `presente (${seg.google_refresh_token.length} car.)` : "(vazio)"}`
  );
  console.log(
    `conversion action   : ${cfg?.google_conversion_action_id || "(sera descoberto no 1o envio)"}`
  );

  if (apenasVer) return;

  const rotulo = cfg?.google_conversion_label || null;
  const conta = cfg?.google_customer_id || null;
  const refreshGravado = seg?.google_refresh_token || null;

  const faltando: string[] = [];
  if (!rotulo) faltando.push("rotulo da conversao");
  if (!conta) faltando.push("--customer");
  if (!refreshGravado) faltando.push("--refresh");
  if (!rotulo || !conta || !refreshGravado) {
    console.log(`\nfalta: ${faltando.join(", ")}`);
    return;
  }

  const creds = {
    customerId: conta,
    loginCustomerId: cfg?.google_login_customer_id ?? null,
    refreshToken: refreshGravado,
  };

  // ---- do rotulo para o id numerico da action
  console.log("\n--- procurando a conversion action pelo rotulo ---");
  const achada = await descobrirConversionAction(creds, rotulo);
  if (!achada.ok || !achada.dados) {
    console.error(`FALHOU: ${achada.erro}`);
    process.exit(1);
  }
  console.log(`achada: "${achada.dados.nome}" -> id ${achada.dados.id}`);

  await admin
    .from("tracking_configs")
    .update({ google_conversion_action_id: achada.dados.id })
    .eq("store_id", loja.id);

  if (semEnsaio) {
    console.log("\n--ensaio pulado.");
    return;
  }

  // ---- ensaio: valida tudo e nao aplica nada
  console.log("\n--- ensaio (validateOnly: nada e aplicado) ---");
  const r = await enviarEnhancement(creds, {
    conversionActionResourceName: achada.dados.resourceName,
    // Pedido inventado de proposito: com validateOnly o Google nem procura a
    // conversao, so confere se a requisicao esta bem formada e autorizada.
    orderId: `ensaio-${Date.now()}`,
    adjustmentDateTime: dataDeAjuste(),
    identificadores: [
      {
        hashedEmail: sha256("ensaio@exemplo.com"),
        userIdentifierSource: "FIRST_PARTY",
      },
    ],
    apenasValidar: true,
  });

  if (!r.ok) {
    console.error(`FALHOU: ${r.erro}`);
    console.error(
      "\nOs motivos comuns, em ordem de frequencia:\n" +
        "  - a acao de conversao nao tem enhanced conversions ligado, ou o metodo\n" +
        "    nao esta marcado como 'Google Ads API' no painel do Google Ads;\n" +
        "  - o developer token nao tem acesso de producao (token de teste nao\n" +
        "    alcanca conta real);\n" +
        "  - conta gerenciada por MCC sem --mcc."
    );
    process.exit(1);
  }

  console.log("passou. A cadeia inteira esta de pe:");
  console.log("  credencial OK, conversion action OK, formato dos hashes OK.");
  console.log(
    "\nA partir da proxima venda o webhook enfileira o enhancement 20 minutos\n" +
      "depois do pedido -- tempo para a conversao base constar no Google."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
