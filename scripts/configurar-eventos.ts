/**
 * Define o rotulo de cada evento rastreado de uma loja.
 *
 * No Google Ads cada evento e uma conversion action propria, com rotulo
 * proprio. O `AW-XXXXXXXXX` e da conta e nao muda; o rotulo muda por evento.
 * Entao configurar "adicionar ao carrinho" e colar o rotulo DAQUELA action --
 * usar o rotulo da compra faria o Google contar carrinho como venda.
 *
 * No painel do Google Ads: Objetivos -> Conversoes -> criar uma acao por evento.
 * Deixe a compra como PRINCIPAL e as outras como SECUNDARIAS (observacao),
 * senao o Google otimiza a campanha para carrinho em vez de venda.
 *
 * Uso -- por `npm run op`, nao por `npx tsx` direto (ver CLAUDE.md):
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> --ver
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> \
 *     --rotulo purchase=AbC-D_efGh --rotulo add_to_cart=XyZ-1_23
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> --limpar view_item
 *
 * Eventos: view_item, add_to_cart, begin_checkout, purchase.
 * Evento sem rotulo simplesmente nao e rastreado.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/** `--rotulo` pode repetir: um por evento. */
function todos(nome: string): string[] {
  const saida: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${nome}` && process.argv[i + 1]) {
      saida.push(process.argv[i + 1]);
    }
  }
  return saida;
}

const dominio = arg("loja");
const apenasVer = process.argv.includes("--ver");
const paraLimpar = todos("limpar");
const pares = todos("rotulo");

if (!dominio) {
  console.error("falta --loja <dominio>");
  process.exit(1);
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { EVENTOS, eventoValido, limparMapaDeRotulos } = await import(
    "../src/lib/tracking/eventos"
  );

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
  console.log(`loja: ${loja.name || loja.shop_domain} (${loja.id})`);

  const { data: cfg } = await admin
    .from("tracking_configs")
    .select("enabled, google_conversion_id, google_conversion_label, google_labels")
    .eq("store_id", loja.id)
    .maybeSingle();

  const atual = limparMapaDeRotulos(cfg?.google_labels);

  function mostrar(mapa: Record<string, string | undefined>) {
    console.log("\n--- eventos ---");
    for (const ev of EVENTOS) {
      const r = mapa[ev.chave];
      const origem = ev.origem === "webhook" ? "webhook" : "snippet";
      console.log(
        `  ${ev.chave.padEnd(15)} ${(r || "(nao rastreado)").padEnd(24)} ${origem}`
      );
    }
  }

  if (apenasVer) {
    console.log(`\nligado          : ${cfg?.enabled ? "sim" : "NAO"}`);
    console.log(`id de conversao : ${cfg?.google_conversion_id || "(vazio)"}`);
    mostrar(atual);
    if (!cfg?.google_conversion_id) {
      console.log(
        "\nSem id de conversao nada sai. Use configurar-tracking.ts --aw AW-XXXXXXXXX."
      );
    }
    return;
  }

  if (pares.length === 0 && paraLimpar.length === 0) {
    console.log("\nnada a fazer: passe --rotulo evento=valor, --limpar evento, ou --ver");
    mostrar(atual);
    return;
  }

  const novo: Record<string, string> = { ...atual } as Record<string, string>;

  for (const par of pares) {
    const corte = par.indexOf("=");
    if (corte <= 0) {
      console.error(`--rotulo mal formado: "${par}". Esperado evento=rotulo.`);
      process.exit(1);
    }
    const chave = par.slice(0, corte).trim();
    const valor = par.slice(corte + 1).trim();
    if (!eventoValido(chave)) {
      console.error(
        `evento desconhecido: "${chave}". Conhecidos: ${EVENTOS.map((e) => e.chave).join(", ")}`
      );
      process.exit(1);
    }
    if (!valor) {
      console.error(`rotulo vazio para "${chave}". Para remover, use --limpar ${chave}.`);
      process.exit(1);
    }
    novo[chave] = valor;
  }

  for (const chave of paraLimpar) {
    if (!eventoValido(chave)) {
      console.error(`evento desconhecido em --limpar: "${chave}"`);
      process.exit(1);
    }
    delete novo[chave];
  }

  const limpo = limparMapaDeRotulos(novo);

  // Ligar sem id de conversao e sem rotulo nenhum e recusado pelo proprio
  // banco (tracking_configs_ligado_precisa_destino). Avisar aqui da uma
  // mensagem legivel em vez do erro do CHECK.
  if (cfg?.enabled && Object.keys(limpo).length === 0) {
    console.error(
      "\na loja esta LIGADA e isto deixaria zero eventos rastreados. Desligue primeiro\n" +
        "(configurar-tracking.ts --desligar) ou mantenha ao menos um rotulo."
    );
    process.exit(1);
  }

  const { error } = await admin.from("tracking_configs").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      google_labels: limpo,
      // A coluna legada e espelhada, nao esquecida: ela ainda e fallback de
      // leitura da compra, e um valor velho ali faria a conversao de venda
      // continuar saindo depois de o rotulo sair do mapa.
      google_conversion_label: limpo.purchase ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );

  if (error) {
    console.error("falha ao gravar:", error.message);
    process.exit(1);
  }

  console.log("\ngravado.");
  mostrar(limpo);
  console.log(
    "\nLembrete: as acoes que nao sao compra devem estar como SECUNDARIAS no\n" +
      "Google Ads, senao a campanha passa a otimizar para carrinho."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
