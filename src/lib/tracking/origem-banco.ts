import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  CAMPOS_ORIGEM,
  mesclarOrigens,
  mesmaOrigem,
  origemDoWebhook,
  type IdentidadeDaOrigem,
  type LinhaOrigem,
  type OrigemDoPedido,
  type PedidoDoWebhook,
} from "@/lib/tracking/origem-pedido";

// ============================================================================
// fin_order_origem (migration 071): grava a origem do pedido, MESCLANDO com a
// que ja esta la -- o webhook sabe a URL de chegada e a identidade, o sync
// sabe a jornada da Shopify, e um nao pode apagar o que o outro achou (regra
// em mesclarOrigens). Um SELECT e um upsert por lote, so do que mudou.
//
// Sem a 071 (tabela ausente) nao grava nada e nao lanca: o resto do webhook
// e do sync segue igual. Linha que o banco RECUSA (CHECK, tipo) fica de fora
// sozinha, com log: uma linha torta nao segura o lote nem prende a passada dos
// 60 dias na mesma pagina.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

export const TABELA_ORIGEM = "fin_order_origem";

type ErroBanco = { code?: string | null; message?: string | null } | null | undefined;

/**
 * A tabela (ou a coluna) nao existe: a 071 ainda nao foi aplicada. Pelo
 * codigo, ou pela mensagem de "nao existe" citando o que a 071 cria. So o
 * nome da tabela nao basta: a violacao de CHECK tambem o cita ("new row for
 * relation fin_order_origem violates...") e seria engolida como "sem tabela".
 */
export function semMigration071(e: ErroBanco): boolean {
  if (!e) return false;
  if (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || e.code === "PGRST204") return true;
  const m = String(e.message ?? "");
  return /does not exist|Could not find/i.test(m) && /fin_order_origem|origem_backfill/i.test(m);
}

/** O banco recusou o DADO (classes 22 e 23: tipo, CHECK, NOT NULL), nao a conexao. */
function linhaRecusada(e: ErroBanco): boolean {
  return /^2[23]/.test(String(e?.code ?? ""));
}

const COLUNAS = ["store_id", "shopify_order_id", ...CAMPOS_ORIGEM].join(", ");

/**
 * Grava as origens de UMA loja, mescladas com as gravadas. `semTabela` = a
 * 071 nao esta aplicada (nada gravado). Outro erro de banco lanca.
 */
export async function gravarOrigens(
  admin: Admin,
  linhas: readonly LinhaOrigem[]
): Promise<{ gravadas: number; semTabela: boolean }> {
  if (linhas.length === 0) return { gravadas: 0, semTabela: false };
  const storeId = linhas[0].store_id;
  const doLote = linhas.filter((l) => l.store_id === storeId);

  const { data, error } = await admin
    .from(TABELA_ORIGEM)
    .select(COLUNAS)
    .eq("store_id", storeId)
    .in(
      "shopify_order_id",
      doLote.map((l) => l.shopify_order_id)
    );
  if (error) {
    if (semMigration071(error)) return { gravadas: 0, semTabela: true };
    throw new Error(`ler origem dos pedidos: ${error.message}`);
  }
  const gravadas = new Map(
    ((data ?? []) as unknown as (OrigemDoPedido & { shopify_order_id: string })[]).map((g) => [g.shopify_order_id, g])
  );

  const agora = new Date().toISOString();
  const mudaram: LinhaOrigem[] = [];
  for (const l of doLote) {
    const antes = gravadas.get(l.shopify_order_id) ?? null;
    const final = mesclarOrigens(l, antes, l.pedido_em);
    if (antes && mesmaOrigem(final, antes)) continue;
    const linha: LinhaOrigem = {
      store_id: l.store_id,
      user_id: l.user_id,
      shopify_order_id: l.shopify_order_id,
      pedido_em: l.pedido_em,
      ...final,
      atualizado_em: agora,
    };
    mudaram.push(linha);
  }
  if (mudaram.length === 0) return { gravadas: 0, semTabela: false };

  const gravar = (lote: LinhaOrigem[]) =>
    admin.from(TABELA_ORIGEM).upsert(lote, { onConflict: "store_id,shopify_order_id" });
  const { error: erroGravar } = await gravar(mudaram);
  if (!erroGravar) return { gravadas: mudaram.length, semTabela: false };
  if (semMigration071(erroGravar)) return { gravadas: 0, semTabela: true };
  if (!linhaRecusada(erroGravar)) throw new Error(`gravar origem dos pedidos: ${erroGravar.message}`);

  // Uma linha recusada derruba o lote inteiro: de novo, uma a uma.
  let feitas = 0;
  for (const linha of mudaram) {
    const { error } = await gravar([linha]);
    if (!error) {
      feitas += 1;
      continue;
    }
    if (!linhaRecusada(error)) throw new Error(`gravar origem dos pedidos: ${error.message}`);
    console.error("[origem] linha recusada pelo banco", linha.store_id, linha.shopify_order_id, error.code, error.message);
  }
  return { gravadas: feitas, semTabela: false };
}

/**
 * A origem no webhook orders/create. NUNCA lanca: e melhor esforco, o sync
 * refaz em ate 15 minutos, e a compra (Purchase) nao pode esperar nem cair
 * por isto.
 */
export async function gravarOrigemDoWebhook(
  admin: Admin,
  loja: { id: string; user_id: string },
  pedido: PedidoDoWebhook,
  identidade: IdentidadeDaOrigem | null
): Promise<void> {
  try {
    const id = String(pedido.id ?? "").trim();
    const em = pedido.created_at ? Date.parse(pedido.created_at) : Number.NaN;
    if (!/^\d+$/.test(id) || !Number.isFinite(em)) return;
    const origem = origemDoWebhook(pedido, identidade);
    if (!origem) return;
    await gravarOrigens(admin, [
      {
        store_id: loja.id,
        user_id: loja.user_id,
        shopify_order_id: id,
        pedido_em: new Date(em).toISOString(),
        ...origem,
      },
    ]);
  } catch (e) {
    console.error("[origem] falha ao gravar a origem do pedido", e instanceof Error ? e.message : e);
  }
}
