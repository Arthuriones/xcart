import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import type { MapaDeRotulos } from "@/lib/tracking/eventos";
import { respostaJson } from "./resposta";

// ============================================================================
// As chamadas da tela de Rastreamento. So chama as rotas que ja existem, com
// os mesmos corpos de antes: nada de envio de rastreamento mudou. A unica
// rota nova e de leitura (/api/leitura/tracking-loja).
// ============================================================================

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Liga ou desliga o envio das compras da loja. */
export async function mudarEnvio(storeId: string, ligar: boolean): Promise<void> {
  const r = await fetch("/api/tracking/config", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ storeId, enabled: ligar }),
  });
  await respostaJson(r, "Não deu para salvar.");
}

/**
 * Grava o script no tema publicado. `remarketing` tambem leva a tag de
 * remarketing do Google -- reinstalar sem ela tiraria a tag de quem ja tem.
 */
export async function instalarScript(
  storeId: string,
  remarketing: boolean
): Promise<{ mudou: boolean; temaNome: string | null }> {
  const r = await fetch("/api/tracking/snippet", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ storeId, remarketing }),
  });
  const j = await respostaJson(r, "Não deu para gravar no tema.");
  return { mudou: Boolean(j.mudou), temaNome: typeof j.temaNome === "string" ? j.temaNome : null };
}

/** Confere de novo a loja na Shopify (pedidos, aviso de pedidos, tema). */
export async function conferirLoja(storeId: string): Promise<DiagnosticoLoja | null> {
  const r = await fetch(`/api/leitura/tracking-diagnostico?loja=${encodeURIComponent(storeId)}`, {
    cache: "no-store",
  });
  const j = await respostaJson(r, "A Shopify não respondeu agora.");
  if (!("diagnostico" in j)) throw new Error("A Shopify não respondeu agora.");
  return (j.diagnostico ?? null) as DiagnosticoLoja | null;
}

/**
 * Um pixel novo na loja (POST /api/tracking/destinos). Devolve o aviso do
 * servidor quando o pixel foi salvo mas a loja nao ligou (limite do plano).
 */
export async function criarPixel(
  dados:
    | {
        storeId: string;
        plataforma: "meta" | "tiktok";
        nome: string;
        conta: string;
        token: string;
        teste: string;
      }
    | { storeId: string; plataforma: "google"; nome: string; conta: string; labels: MapaDeRotulos }
): Promise<string | null> {
  const corpo =
    dados.plataforma === "google"
      ? { labels: dados.labels }
      : { accessToken: dados.token, testEventCode: dados.teste };
  const r = await fetch("/api/tracking/destinos", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ...corpo,
      storeId: dados.storeId,
      plataforma: dados.plataforma,
      nome: dados.nome,
      conta: dados.conta,
    }),
  });
  const j = await respostaJson(r, "Não deu para adicionar o pixel.");
  return typeof j.aviso === "string" && j.aviso ? j.aviso : null;
}

/** Ativa ou desativa um pixel (o historico fica). */
export async function ativarPixel(id: string, ativo: boolean): Promise<void> {
  const r = await fetch("/api/tracking/destinos", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, ativo }),
  });
  await respostaJson(r, "Não deu para salvar.");
}

export async function removerPixel(id: string): Promise<void> {
  const r = await fetch(`/api/tracking/destinos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  await respostaJson(r, "Não deu para remover.");
}

export interface CabecalhoLoja {
  loja: { moeda: string | null; fuso: string | null; criadaEm: string };
  /** Do periodo da barra do topo. null = o calculo falhou. */
  financeiro: { receita: number; pedidos: number; ticket: number | null; moeda: string } | null;
}

/** Faturamento, pedidos, ticket, moeda e fuso da loja (so leitura). */
export async function lerCabecalho(storeId: string): Promise<CabecalhoLoja> {
  const r = await fetch(`/api/leitura/tracking-loja?loja=${encodeURIComponent(storeId)}`, {
    cache: "no-store",
  });
  const j = await respostaJson(r, "Não deu para ler a loja agora.");
  return j as unknown as CabecalhoLoja;
}
