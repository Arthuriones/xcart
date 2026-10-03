import "server-only";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { calcularFinanceiro, type ResultadoFinanceiro } from "./calculo";
import type { AdAccountRow, FiltroGlobal, FinSyncStateRow, LojaDoSeletor } from "./tipos";

// ============================================================================
// Leitura da tela Lucro. So banco (fin_orders, gasto, cambio): nada de Shopify
// nem Meta aqui -- a home nao pode depender de API externa para abrir. Quem
// fala com elas sao os crons.
//
// A leitura em si mora em src/lib/leitura/base-lucro.ts, memorizada por
// requisicao: o calculo daqui e as partes novas da tela (serie, produto,
// campanha) usam o MESMO resultado, e a home le o banco uma vez so.
//
// Erro de banco LANCA. Zero no lugar de "nao consegui ler" diria ao lojista
// que ele nao vendeu nada, e ele desligaria anuncio por isso.
// ============================================================================

/** Script do Google roda de hora em hora: 3h sem dado ja e falha, nao atraso. */
const GOOGLE_SEM_DADO_MS = 3 * 60 * 60 * 1000;

export interface ResumoContas {
  total: number;
  semLoja: number;
  comErro: { nome: string; erro: string }[];
  googleSemDado3h: string[];
}

export type DadosFinanceiro =
  | { vazio: true }
  | {
      vazio: false;
      filtro: FiltroGlobal;
      lojas: LojaDoSeletor[];
      lojaIds: string[];
      estados: FinSyncStateRow[];
      contas: ResumoContas;
      resultado: ResultadoFinanceiro;
      /** Maior ultimo_sync_ok_em entre pedidos e contas. */
      atualizadoEm: string | null;
      /** Fuso do "hoje" usado no periodo: o da loja, ou Sao Paulo com todas. */
      fuso: string;
    };

function maiorData(datas: (string | null | undefined)[]): string | null {
  let maior: string | null = null;
  let maiorMs = -Infinity;
  for (const d of datas) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms > maiorMs) {
      maiorMs = ms;
      maior = d;
    }
  }
  return maior;
}

export async function getFinanceiro(): Promise<DadosFinanceiro> {
  const base = await lerBaseLucro();
  if (!base) return { vazio: true };
  const { entrada, filtro, lojas, lojaIds, estados, contas, fuso } = base;

  const resultado = calcularFinanceiro(entrada);

  // Contas que importam para ESTA tela: as das lojas filtradas e as soltas
  // (sem loja, o gasto delas nao entra em lugar nenhum).
  const lojaSet = new Set(lojaIds);
  const contasDasLojas = contas.filter((c) => c.store_id && lojaSet.has(c.store_id));
  const relevantes = contas.filter((c) => !c.store_id || lojaSet.has(c.store_id));
  const agora = Date.now();
  const nomeConta = (c: AdAccountRow) =>
    `${c.plataforma === "google" ? "Google" : "Meta"} ${c.nome || c.external_id}`;
  const resumoContas: ResumoContas = {
    total: contas.length,
    semLoja: contas.filter((c) => !c.store_id && c.ativo).length,
    comErro: relevantes
      .filter((c) => c.ativo && c.ultimo_erro)
      .map((c) => ({ nome: nomeConta(c), erro: String(c.ultimo_erro) })),
    googleSemDado3h: contasDasLojas
      .filter((c) => {
        if (c.plataforma !== "google" || !c.ativo) return false;
        const ultimo = c.ultimo_sync_ok_em || c.ultimo_dado_gerado_em;
        const ms = ultimo ? Date.parse(ultimo) : NaN;
        return !Number.isFinite(ms) || agora - ms > GOOGLE_SEM_DADO_MS;
      })
      .map(nomeConta),
  };

  return {
    vazio: false,
    filtro,
    lojas,
    lojaIds,
    estados,
    contas: resumoContas,
    resultado,
    atualizadoEm: maiorData([
      ...estados.map((e) => e.ultimo_sync_ok_em),
      ...contasDasLojas.map((c) => c.ultimo_sync_ok_em),
    ]),
    fuso,
  };
}
