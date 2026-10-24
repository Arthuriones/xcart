import { estadoConexao } from "@/lib/leitura/lojas-estado";
import type { FinSyncStateRow } from "./tipos";

// ============================================================================
// Regras da rodada do cron de pedidos (/api/jobs/financeiro/pedidos), sem
// banco e sem rede: a ordem das lojas, quando uma loja espera e quantas
// paginas ela le. Puro para o vitest travar.
//
// Medido em producao (24/10/2026): 32 de 56 lojas do cron fora do ar (14 com
// 401, 12 com 402, 6 sem o app) comiam ~15 s de toda rodada, de 15 em 15 min.
// ============================================================================

/** Loja sem read_orders (`negado`): o cron so tenta de novo depois disso. */
export const ESPERA_NEGADO_MS = 6 * 60 * 60 * 1000;
/** Loja fora do ar na Shopify (401, 402, sem o app, fechada): idem. */
export const ESPERA_FORA_DO_AR_MS = 6 * 60 * 60 * 1000;
/**
 * Carga inicial (60 dias), na primeira volta do cron: paginas por loja (10 x 8
 * pedidos). Varios cadastros no mesmo dia nao comem o orcamento das lojas que
 * ja estao em dia. O que sobra do orcamento vai para a segunda volta.
 */
export const MAX_PAGINAS_CARGA_INICIAL = 10;
/**
 * Segunda volta do cron: a carga inicial que parou no teto continua, pela
 * retomada (053), com a sobra do orcamento -- quem limita e o prazo
 * (`prazoDaSegundaVolta`); este teto e so a trava de seguranca. Sem a segunda
 * volta, a carga andava 80 pedidos por rodada (7.680 por dia) mesmo com a
 * rodada ociosa: loja nova de 300 pedidos/dia levava ~2,7 dias para mostrar o
 * "Hoje", porque a carga anda do mais velho para o mais novo.
 */
export const MAX_PAGINAS_SEGUNDA_VOLTA = 500;

type EstadoDaEspera = Pick<FinSyncStateRow, "ultimo_sync_em" | "ultimo_erro" | "ultimo_erro_tipo">;

export function haMenosDe(iso: string | null | undefined, ms: number, agora: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && agora - t < ms;
}

/**
 * A ultima rodada falhou porque a loja esta fora do ar na Shopify: o que a
 * tela Lojas ja chama de "sem acesso" (lojas-estado.ts: credencial/401,
 * pausada/402/423, app desinstalado) mais o 404 da Admin API (loja fechada).
 * Erro do GraphQL (HTTP 200 com `errors`) nunca: a loja respondeu, e um custo
 * de 402 pontos no JSON casaria com o "402". Timeout e 5xx tambem nao: passam.
 */
export function lojaForaDoArNoSync(ultimoErro: string | null | undefined): boolean {
  const erro = ultimoErro ?? "";
  if (!erro || /^Shopify GraphQL error/i.test(erro)) return false;
  if (/^Shopify API error: 404\b/.test(erro)) return true;
  return estadoConexao({
    desinstaladaEm: null,
    sync: { ultimoErro: erro, ultimoErroTipo: "falhou", ultimoSyncOkEm: null, cargaInicialOk: true },
  }).semAcesso;
}

/**
 * O cron pula a loja nesta rodada? Negado ou fora do ar, ate 6 h depois da
 * ultima tentativa (`ultimo_sync_em`). O botao da sessao nunca espera: o
 * lojista pode ter acabado de reconectar.
 */
export function cronEsperaALoja(estado: EstadoDaEspera | null | undefined, agora: number): boolean {
  if (!estado) return false;
  const espera =
    estado.ultimo_erro_tipo === "negado"
      ? ESPERA_NEGADO_MS
      : estado.ultimo_erro_tipo === "falhou" && lojaForaDoArNoSync(estado.ultimo_erro)
        ? ESPERA_FORA_DO_AR_MS
        : 0;
  return espera > 0 && haMenosDe(estado.ultimo_sync_em, espera, agora);
}

/**
 * Rodizio: quem esta ha mais tempo sem tentativa vai primeiro, e loja sem
 * linha de estado (nunca leu) antes de todas. Empate fica na ordem que veio.
 * Sem isto a ordem era a do banco, e as mesmas lojas ficavam sem vez sempre
 * que o orcamento da rodada acabava antes delas.
 */
export function ordenarParaRodizio<T extends { id: string }>(
  lojas: readonly T[],
  estados: ReadonlyMap<string, Pick<FinSyncStateRow, "ultimo_sync_em">>
): T[] {
  const quando = (l: T) => {
    const t = Date.parse(estados.get(l.id)?.ultimo_sync_em ?? "");
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  return lojas
    .map((l, i) => ({ l, i, t: quando(l) }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t - b.t))
    .map((x) => x.l);
}

/**
 * Paginas desta rodada: no cron, a carga inicial anda em pedacos; loja em dia,
 * o padrao do sync. O "Atualizar agora" (sessao) le so as lojas do proprio
 * usuario, nao divide orcamento com ninguem: o padrao do sync, como antes.
 */
export function paginasDaRodada(
  estado: Pick<FinSyncStateRow, "carga_inicial_ok"> | null | undefined,
  doCron = true
): number | undefined {
  return estado?.carga_inicial_ok || !doCron ? undefined : MAX_PAGINAS_CARGA_INICIAL;
}

/**
 * Prazo de uma loja na segunda volta: a sobra do orcamento dividida pelas que
 * faltam (esta inclusa). A que termina antes deixa a sobra para as seguintes;
 * a ultima vai ate o fim do orcamento.
 */
export function prazoDaSegundaVolta(agora: number, limiteEm: number, restantes: number): number {
  return agora + Math.max(0, limiteEm - agora) / Math.max(1, restantes);
}
