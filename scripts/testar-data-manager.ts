/**
 * Confere a Data Manager API do Google SEM gravar conversao nenhuma.
 *
 * Manda um evento INVENTADO com `validateOnly: true` para cada acao
 * configurada: o Google confere a credencial, o acesso a conta e o formato, e
 * nao grava nada. Fica FORA da fila de proposito -- validateOnly nao gera
 * diagnostico, e rodado sobre linha real a conversao ficaria como "enviada" e
 * se perderia.
 *
 * O que ele NAO prova: que o clique sera achado. Isso so o diagnostico de um
 * envio de verdade diz (o cron confere 30 min a 24 h depois). Se o Google
 * reclamar so do gclid inventado, a credencial e a conta estao certas.
 *
 * Precisa de GOOGLE_DM_SA_EMAIL e GOOGLE_DM_SA_KEY no .env.local (ou o JSON
 * inteiro da service account em GOOGLE_DM_SA_KEY).
 *
 * Uso:
 *   npm run op -- scripts/testar-data-manager.ts <loja>.myshopify.com
 *   npm run op -- scripts/testar-data-manager.ts --cliente 123-456-7890 --acao 111 [--mcc 123-456-7890]
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const args = process.argv.slice(2);
function valorDe(nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Inventado e com cara de teste: nunca existe em conta nenhuma. */
const GCLID_INVENTADO = "TESTE-xcart-validateOnly";

interface Alvo {
  rotulo: string;
  customerId: string;
  loginCustomerId: string | null;
  acao: string;
}

async function alvosDaLoja(dominio: string): Promise<Alvo[]> {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { idDeCliente, limparAcoes } = await import("../src/lib/tracking/google-url");
  const admin = createAdminClient();

  // Por dominio .myshopify.com, nunca por nome: o nome no banco e velho.
  const { data: loja } = await admin
    .from("stores")
    .select("id, shop_domain")
    .eq("shop_domain", dominio)
    .maybeSingle();
  if (!loja) {
    console.error(`loja ${dominio} não encontrada`);
    process.exit(1);
  }

  const { data: destinos, error } = await admin
    .from("tracking_destinations")
    .select("*")
    .eq("store_id", loja.id)
    .eq("plataforma", "google");
  if (error) {
    console.error(`não consegui ler os destinos: ${error.message}`);
    process.exit(1);
  }

  const alvos: Alvo[] = [];
  for (const d of destinos || []) {
    const nome = d.nome ? `${d.nome} (${d.conta})` : d.conta;
    const customerId = idDeCliente(d.customer_id);
    const acoes = limparAcoes(d.acoes);
    if (!customerId || Object.keys(acoes).length === 0) {
      console.log(`--    ${nome}: sem ID do cliente e ações (configure em Integrações › Google)`);
      continue;
    }
    for (const [evento, acao] of Object.entries(acoes)) {
      alvos.push({
        rotulo: `${nome} · ${evento}${d.ativo ? "" : " (desativado)"}`,
        customerId,
        loginCustomerId: idDeCliente(d.login_customer_id),
        acao: String(acao),
      });
    }
  }
  return alvos;
}

async function main() {
  const { credencialDoGoogle, enviarAoDataManager } = await import("../src/lib/tracking/google-dm");
  const { idDeCliente, montarCorpoDataManager } = await import("../src/lib/tracking/google-url");

  const cred = credencialDoGoogle();
  if (!cred) {
    console.error(
      "Falta a credencial: GOOGLE_DM_SA_EMAIL e GOOGLE_DM_SA_KEY no .env.local (ou o JSON inteiro em GOOGLE_DM_SA_KEY)."
    );
    process.exit(1);
  }
  console.log(`service account: ${cred.email}\n`);

  let alvos: Alvo[];
  const cliente = valorDe("cliente");
  if (cliente) {
    const customerId = idDeCliente(cliente);
    const acao = (valorDe("acao") || "").trim();
    const mcc = valorDe("mcc");
    if (!customerId || !/^\d+$/.test(acao)) {
      console.error("uso: --cliente 123-456-7890 --acao <ID numérico da ação> [--mcc 123-456-7890]");
      process.exit(1);
    }
    alvos = [{ rotulo: "linha de comando", customerId, loginCustomerId: mcc ? idDeCliente(mcc) : null, acao }];
  } else {
    const dominio = args.find((a) => !a.startsWith("--"));
    if (!dominio) {
      console.error(
        "uso: npm run op -- scripts/testar-data-manager.ts <loja>.myshopify.com\n" +
          "  ou: npm run op -- scripts/testar-data-manager.ts --cliente 123-456-7890 --acao 111 [--mcc 123-456-7890]"
      );
      process.exit(1);
    }
    alvos = await alvosDaLoja(dominio);
  }

  if (alvos.length === 0) {
    console.log("Nada para testar.");
    return;
  }

  let falhas = 0;
  for (const a of alvos) {
    const corpo = montarCorpoDataManager({
      customerId: a.customerId,
      loginCustomerId: a.loginCustomerId,
      acao: a.acao,
      clique: { gclid: GCLID_INVENTADO },
      transactionId: `xcart-teste-${Date.now()}`,
      quando: new Date(Date.now() - 60_000),
      validateOnly: true,
    });
    // Trava: este script nunca manda evento de verdade.
    if (corpo.validateOnly !== true) throw new Error("corpo sem validateOnly: abortado");

    const r = await enviarAoDataManager(corpo);
    const conta = `conta ${a.customerId}${a.loginCustomerId ? ` via MCC ${a.loginCustomerId}` : ""}, ação ${a.acao}`;
    if (r.ok) {
      console.log(`OK    ${a.rotulo} (${conta})`);
    } else {
      falhas += 1;
      console.log(`FALHA ${a.rotulo} (${conta}): ${r.erro}`);
    }
  }

  console.log(
    falhas
      ? `\n${falhas} de ${alvos.length} recusados. Sem permissão = a service account não foi adicionada à conta (ou à MCC).`
      : `\nTudo aceito. Nada foi gravado no Google.`
  );
  // exitCode, e nao process.exit: no Windows, sair com a conexao HTTP ainda
  // fechando derruba o Node com uma assercao do libuv.
  process.exitCode = falhas ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
