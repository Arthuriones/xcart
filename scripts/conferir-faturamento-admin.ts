/**
 * Confere a apuracao de faturamento do painel admin sem subir o app.
 *
 * A rota /api/admin/revenue exige sessao de admin no navegador; este script
 * chama a mesma funcao por baixo, para dar para validar o numero contra a
 * Shopify antes de olhar a tela.
 *
 * Uso:  npx tsx scripts/conferir-faturamento-admin.ts [7|30|60]
 */
import Module from "node:module";
import { config } from "dotenv";

config({ path: ".env.local" });

// `server-only` nao e um pacote de verdade: o Next resolve por alias no
// bundler, para quebrar o build se um modulo de servidor for importado pelo
// cliente. Fora do Next ele nao existe e o require estoura. A guarda continua
// valendo no app; aqui so apontamos para um modulo vazio e inofensivo.
const resolver = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })
  ._resolveFilename;
(Module as unknown as { _resolveFilename: unknown })._resolveFilename = function (
  this: unknown,
  pedido: string,
  ...resto: unknown[]
) {
  if (pedido === "server-only" || pedido === "client-only") {
    // "util" (sem o prefixo node:) volta como builtin e o loader entende.
    return resolver.call(this, "util", ...resto);
  }
  return resolver.call(this, pedido, ...resto);
};

async function main() {
  const bruto = process.argv[2] || "30";
  const periodo = (["7", "30", "60"].includes(bruto) ? bruto : "30") as "7" | "30" | "60";

  // Import tardio: o modulo le variaveis de ambiente no topo, entao precisa
  // acontecer DEPOIS do dotenv.
  const { getFaturamentoAdmin } = await import("../src/lib/sales/admin");

  const inicio = Date.now();
  const d = await getFaturamentoAdmin(periodo);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  const brl = (c: number) =>
    (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  console.log(`\nperiodo: ${d.period} dias  |  apurado em ${segundos}s`);
  console.log(`lojas de checkout consultadas: ${d.storeCount}`);
  console.log(`sem read_orders: ${d.deniedCount}  |  nao responderam: ${d.failedCount}`);
  if (d.moedasSemTaxa.length) {
    console.log(`SEM TAXA DE CAMBIO (ficou fora do total): ${d.moedasSemTaxa.join(", ")}`);
  }
  console.log(`\nTOTAL: ${brl(d.totalRevenueBrlCents)} em ${d.totalOrders} pedidos pagos\n`);

  console.log("ranking:");
  for (const [i, u] of d.usuarios.entries()) {
    const valorUsuario = u.lojasComDados === 0 ? "sem dados" : brl(u.revenueBrlCents);
    console.log(
      `${(u.lojasComDados === 0 ? " -" : String(i + 1).padStart(2))}. ${u.email.padEnd(34)} ` +
        `${valorUsuario.padStart(14)}  ${String(u.orders).padStart(4)} pedidos  ` +
        `${u.lojasComDados}/${u.lojas.length} loja(s) com dados`
    );
    for (const l of u.lojas) {
      const valor = l.problem
        ? l.problem === "denied"
          ? "sem read_orders"
          : "nao respondeu"
        : `${(l.revenueCents / 100).toLocaleString("pt-BR")} ${l.currency}`;
      console.log(
        `      ${l.name.slice(0, 30).padEnd(32)} ${valor.padStart(22)}  ${l.orders} ped.  <- ${l.vitrines.join(", ") || "?"}`
      );
    }
  }
  console.log();
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
