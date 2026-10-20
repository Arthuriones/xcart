// ============================================================================
// Loja de demonstracao (migration 074, stores.demonstracao).
//
// Uma loja com pedidos, custos, gasto e eventos gravados direto no banco por
// scripts/demo-loja.ts, sem Shopify, Meta ou Google por tras. As telas a leem
// como qualquer loja. O que fala com fora a pula -- a credencial dela e
// inventada, e cada tentativa viraria "Token invalido" na tela e alerta:
//
//   - o sync de pedidos (api/jobs/financeiro/pedidos) e o gasto do Meta
//     (api/jobs/ads/meta), no cron e no "Atualizar agora";
//   - os alertas (alertas/avaliar.ts): a loja nem entra no mapa de lojas;
//   - o diagnostico do Rastreamento (tracking/diagnostico.ts), que responde
//     pelo banco, e o script no tema do Guia;
//   - os nomes de produto de Custos, que saem de demonstracao_catalogo;
//   - o coletor publico (api/tracking/collect): evento para ela e recusado.
//
// E com "Todas" no topo (filtro-global.ts) ela fica fora de `lojaIds`: os
// numeros de Todas sao os da operacao de verdade. So conta escolhida.
//
// NADA DAQUI VAI PARA A TELA. A marca e so do banco.
//
// A coluna so existe depois da 074: toda leitura dela pede a coluna e, se o
// banco disser que ela nao existe (42703), repete sem ela -- e sem a migration
// nenhuma loja e de demonstracao. Puro (sem server-only): os testes e o script
// importam.
// ============================================================================

import type { createAdminClient } from "@/lib/supabase/admin";
import { ehColunaAusente } from "@/lib/financeiro/mapear-pedido";
import { motivoParaIgnorarPedido } from "@/lib/tracking/filtro-pedido";
import type { ProdutoDoSku } from "@/lib/leitura/sku-shopify";

export const COLUNA_DEMONSTRACAO = "demonstracao";

type Admin = ReturnType<typeof createAdminClient>;

interface ErroDoBanco {
  code?: string | null;
  message?: string | null;
}

/** A linha de `stores` e de demonstracao? Sem a coluna (ou lida sem ela): nao. */
export function ehDemonstracao(linha: unknown): boolean {
  return Boolean(
    linha && typeof linha === "object" && (linha as Record<string, unknown>)[COLUNA_DEMONSTRACAO] === true
  );
}

/**
 * Roda a consulta de `stores` pedindo tambem a marca. Sem a 074 (coluna
 * ausente), roda de novo com as colunas de antes. `consultar` monta a consulta
 * inteira a cada chamada: o construtor do supabase-js nao se reaproveita.
 */
export async function comMarcaDeDemonstracao<R extends { error: ErroDoBanco | null }>(
  colunas: string,
  consultar: (colunas: string) => PromiseLike<R>
): Promise<R> {
  const r = await consultar(`${colunas}, ${COLUNA_DEMONSTRACAO}`);
  if (r.error && ehColunaAusente(r.error)) return consultar(colunas);
  return r;
}

/**
 * Quais destas lojas sao de demonstracao. Sem a 074: nenhuma. Outro erro de
 * banco LANCA -- quem chama nao pode seguir achando que nenhuma e, senao
 * chama a API de fora com a credencial inventada.
 */
export async function lojasDeDemonstracao(admin: Admin, ids: readonly string[]): Promise<Set<string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return new Set();
  const { data, error } = await admin
    .from("stores")
    .select("id")
    .in("id", unicos)
    .eq(COLUNA_DEMONSTRACAO, true);
  if (error) {
    if (ehColunaAusente(error)) return new Set();
    throw new Error(`falha ao ler as lojas de demonstracao: ${error.message}`);
  }
  return new Set(((data ?? []) as { id: string }[]).map((l) => String(l.id)));
}

/** Uma linha de fin_orders como o diagnostico da loja de demonstracao le. */
export interface PedidoParaDiagnostico {
  shopify_order_id: string;
  criado_em: string;
  tipo: string | null;
  origem: string | null;
  total_bruto: number | string | null;
}

/** O teto da tela de verdade: 4 paginas de 250 pedidos da Shopify. */
export const MAX_PEDIDOS_DIAGNOSTICO = 1000;

/**
 * Os pedidos que deveriam ter virado compra, pelo banco, no formato do
 * diagnostico da Shopify (tracking/diagnostico.ts): sem teste, PDV, draft e
 * valor zero, e sem os dos ultimos `carenciaMs` (o webhook ainda pode estar
 * em voo). Mais velho primeiro, cortado no mesmo teto da Shopify.
 */
export function pedidosEsperadosDoBanco(
  linhas: readonly PedidoParaDiagnostico[],
  agoraMs: number,
  carenciaMs: number
): { ids: string[]; criadoEm: Record<string, string> } {
  const limite = agoraMs - carenciaMs;
  const validas = linhas
    .filter((p) => {
      const criado = Date.parse(p.criado_em);
      if (!Number.isFinite(criado) || criado > limite) return false;
      // A MESMA regra do webhook (e do diagnostico pela Shopify).
      return !motivoParaIgnorarPedido({ test: p.tipo === "teste", source_name: p.origem, total_price: p.total_bruto });
    })
    .sort((a, b) => Date.parse(a.criado_em) - Date.parse(b.criado_em))
    .slice(0, MAX_PEDIDOS_DIAGNOSTICO);
  const ids: string[] = [];
  const criadoEm: Record<string, string> = {};
  for (const p of validas) {
    const id = String(p.shopify_order_id);
    ids.push(id);
    criadoEm[id] = p.criado_em;
  }
  return { ids, criadoEm };
}

/**
 * Nome, variante e foto dos SKUs, pelo catalogo da loja de demonstracao
 * (demonstracao_catalogo, 074) -- o que a tela Custos pergunta a Shopify numa
 * loja real. null = a loja nao e de demonstracao (ou a 074 nao foi aplicada):
 * quem chama segue para a Shopify. SKU fora do catalogo fica de fora, como o
 * que a Shopify nao acha. Erro de banco LANCA.
 */
export async function catalogoDaDemonstracao(
  admin: Admin,
  storeId: string,
  skus: readonly string[]
): Promise<Record<string, ProdutoDoSku> | null> {
  const { data: loja, error } = await admin
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq(COLUNA_DEMONSTRACAO, true)
    .maybeSingle();
  if (error) {
    if (ehColunaAusente(error)) return null;
    throw new Error(`falha ao ler a loja: ${error.message}`);
  }
  if (!loja) return null;
  if (skus.length === 0) return {};
  const { data: itens, error: erroItens } = await admin
    .from("demonstracao_catalogo")
    .select("sku, nome, variante, imagem")
    .eq("store_id", storeId)
    .in("sku", [...skus]);
  if (erroItens) throw new Error(`falha ao ler o catalogo: ${erroItens.message}`);
  const saida: Record<string, ProdutoDoSku> = {};
  for (const i of (itens ?? []) as { sku: string; nome: string; variante: string | null; imagem: string | null }[]) {
    saida[i.sku] = {
      nome: i.nome,
      variante: i.variante || null,
      imagem: typeof i.imagem === "string" && i.imagem.startsWith("https://") ? i.imagem : null,
    };
  }
  return saida;
}
