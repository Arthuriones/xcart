import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/net/safe-url";
import { diaNoFuso, somarDias, type FxRateRow } from "./tipos";
import { dataPtax, mesclarCambio, parseFrankfurterV2, parsePtax } from "./cambio-parse";

// ============================================================================
// Atualiza fx_rates. Roda a cada 6 h; cada rodada rele os ultimos 10 dias
// (fim de semana e feriado nao tem cotacao, e a fonte as vezes publica atrasado).
// Tabela vazia: 120 dias, para o historico ja nascer convertido.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const DIAS_NORMAL = 10;
const DIAS_PRIMEIRA_CARGA = 120;
const LOTE_UPSERT = 1000;
const TIMEOUT_MS = 15000;

function urlFrankfurter(desde: string, ate: string): string {
  // Sem quotes: a v2 devolve todas, e o filtro fica em MOEDAS_GUARDADAS.
  return `https://api.frankfurter.dev/v2/rates?from=${desde}&to=${ate}&base=USD`;
}

function urlPtax(desde: string, ate: string): string {
  return (
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@moeda='USD'&@dataInicial='${dataPtax(desde)}'&@dataFinalCotacao='${dataPtax(ate)}'` +
    "&$format=json&$filter=tipoBoletim%20eq%20'Fechamento'"
  );
}

async function lerJson(url: string, fonte: string): Promise<unknown> {
  const res = await safeFetch(url, {
    headers: { accept: "application/json" },
    timeoutMs: TIMEOUT_MS,
  });
  if (!res.ok) throw new Error(`${fonte}: HTTP ${res.status}`);
  return res.json();
}

export async function atualizarCambio(
  admin: Admin,
  agora = new Date()
): Promise<{ linhas: number; ptax: boolean }> {
  const hoje = diaNoFuso(agora, "UTC");

  const { count, error: erroContagem } = await admin
    .from("fx_rates")
    .select("moeda", { count: "exact", head: true });
  if (erroContagem) throw new Error(`ler fx_rates: ${erroContagem.message}`);
  const desde = somarDias(hoje, -(count ? DIAS_NORMAL : DIAS_PRIMEIRA_CARGA));

  // Frankfurter e a fonte principal: sem ela nao ha EUR, GBP etc. O erro sobe
  // depois de gravar a PTAX (se veio), para o BRL nao envelhecer junto.
  let frank: FxRateRow[] = [];
  let erroFrank: string | null = null;
  try {
    frank = parseFrankfurterV2(await lerJson(urlFrankfurter(desde, hoje), "Frankfurter"));
    if (frank.length === 0) erroFrank = "Frankfurter respondeu sem cotacao no periodo";
  } catch (e) {
    erroFrank = e instanceof Error ? e.message : "Frankfurter falhou";
  }

  // PTAX e refinamento do BRL: se o BCB cair, o BRL do Frankfurter (BCE) serve.
  let ptax: FxRateRow[] = [];
  try {
    ptax = parsePtax(await lerJson(urlPtax(desde, hoje), "PTAX"));
  } catch {
    ptax = [];
  }

  const atualizadoEm = new Date().toISOString();
  const linhas = mesclarCambio(frank, ptax).map((r) => ({ ...r, atualizado_em: atualizadoEm }));

  for (let i = 0; i < linhas.length; i += LOTE_UPSERT) {
    const { error } = await admin
      .from("fx_rates")
      .upsert(linhas.slice(i, i + LOTE_UPSERT), { onConflict: "data,moeda" });
    if (error) throw new Error(`gravar fx_rates: ${error.message}`);
  }

  if (erroFrank) throw new Error(erroFrank);
  return { linhas: linhas.length, ptax: ptax.length > 0 };
}
