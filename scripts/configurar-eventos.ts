/**
 * Define o rotulo de cada evento rastreado de UMA conta do Google.
 *
 * No Google Ads cada evento e uma conversion action propria, com rotulo
 * proprio. O `AW-XXXXXXXXX` e da conta e nao muda; o rotulo muda por evento.
 * Entao configurar "adicionar ao carrinho" e colar o rotulo DAQUELA action --
 * usar o rotulo da compra faria o Google contar carrinho como venda.
 *
 * POR QUE PRECISA DIZER QUAL CONTA
 *
 * Desde a migration 043 a loja pode ter varias contas do Google, cada uma com o
 * seu conjunto de rotulos -- cinco contas anunciando produtos diferentes do
 * mesmo catalogo e o caso real. Com uma so, o script acha sozinha; com mais de
 * uma, `--conta` e obrigatorio, porque escrever o rotulo na conta errada manda a
 * conversao para a action errada e nao da erro nenhum.
 *
 * No painel do Google Ads: Objetivos -> Conversoes -> criar uma acao por evento.
 * Deixe a compra como PRINCIPAL e as outras como SECUNDARIAS (observacao),
 * senao o Google otimiza a campanha para carrinho em vez de venda.
 *
 * Uso -- por `npm run op`, nao por `npx tsx` direto (ver CLAUDE.md):
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> --ver
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> \
 *     --rotulo purchase=AbC-D_efGh --rotulo add_to_cart=XyZ-1_23
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> \
 *     --conta AW-123456789 --rotulo purchase=AbC-D_efGh
 *   npm run op -- scripts/configurar-eventos.ts --loja <dominio> --limpar view_item
 *
 * Evento sem rotulo simplesmente nao e rastreado naquela conta.
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
const contaPedida = arg("conta");
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
  const { destinosParaTela } = await import("../src/lib/tracking/destinos");

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
    .select("enabled")
    .eq("store_id", loja.id)
    .maybeSingle();

  const doGoogle = ((await destinosParaTela(admin, [loja.id])).get(loja.id) || []).filter(
    (d) => d.plataforma === "google"
  );

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
    console.log(`\nligado: ${cfg?.enabled ? "sim" : "NAO"}`);
    if (doGoogle.length === 0) {
      console.log(
        "\nNenhuma conta do Google nesta loja. Cadastre na tela de Rastreamento, ou\n" +
          "com configurar-tracking.ts --aw AW-XXXXXXXXX --rotulo <rotulo>."
      );
      return;
    }
    for (const d of doGoogle) {
      console.log(
        `\nconta ${d.conta} "${d.nome || "-"}" ${d.ativo ? "" : "(DESATIVADA)"}`
      );
      mostrar(d.labels);
    }
    return;
  }

  if (doGoogle.length === 0) {
    console.error(
      "\nnenhuma conta do Google nesta loja -- nao ha onde gravar rotulo.\n" +
        "Cadastre a conta primeiro (tela de Rastreamento, ou configurar-tracking.ts --aw)."
    );
    process.exit(1);
  }

  // Com mais de uma conta, nao da para adivinhar: gravar o rotulo na conta
  // errada manda a conversao para a action errada e nao produz erro nenhum.
  let destino = doGoogle[0];
  if (contaPedida) {
    const achado = doGoogle.find(
      (d) => d.conta === contaPedida || d.conta === `AW-${contaPedida.replace(/\D/g, "")}`
    );
    if (!achado) {
      console.error(
        `\nconta "${contaPedida}" nao esta nesta loja. Contas: ${doGoogle
          .map((d) => d.conta)
          .join(", ")}`
      );
      process.exit(1);
    }
    destino = achado;
  } else if (doGoogle.length > 1) {
    console.error(
      `\nesta loja tem ${doGoogle.length} contas do Google. Diga qual com --conta:\n` +
        doGoogle.map((d) => `  --conta ${d.conta}  "${d.nome || "-"}"`).join("\n")
    );
    process.exit(1);
  }

  console.log(`conta: ${destino.conta} "${destino.nome || "-"}"`);
  const atual = limparMapaDeRotulos(destino.labels);

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

  // Conta do Google sem rotulo nenhum nao envia nada, e apareceria na tela como
  // destino configurado -- armadilha silenciosa. Com varias contas isto nao
  // desliga a loja: as outras continuam enviando.
  if (Object.keys(limpo).length === 0) {
    console.error(
      `\nisto deixaria a conta ${destino.conta} com zero eventos rastreados, e ela\n` +
        "apareceria como configurada sem enviar nada. Para parar esta conta,\n" +
        "desative o destino na tela de Rastreamento."
    );
    process.exit(1);
  }

  const { error } = await admin
    .from("tracking_destinations")
    .update({ labels: limpo, updated_at: new Date().toISOString() })
    .eq("id", destino.id);

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
