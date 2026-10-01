import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rotuloDoEvento, type MapaDeRotulos } from "@/lib/tracking/eventos";

// ============================================================================
// Os destinos de conversao de uma loja.
//
// Ate a migration 043 isto eram COLUNAS em tracking_configs: um Google e um
// Meta por loja. Virou tabela para a loja poder ter varios -- agencia e lojista
// com pixels separados, duas contas no mesmo catalogo, troca de conta sem
// apagar a antiga.
//
// O que isso obriga: `destination_id` entra na chave de deduplicacao da fila.
// Sem ele, dois pixels Meta na mesma loja colidiriam em
// (store_id, 'meta', event_id) e o segundo sumiria como "duplicado" -- em
// silencio, que e o pior jeito de falhar.
// ============================================================================

export interface Destino {
  id: string;
  storeId: string;
  plataforma: "google" | "meta";
  /** Apelido do lojista. Com dois da mesma plataforma, o id nao basta na tela. */
  nome: string | null;
  /** AW-XXXXXXXXX no Google, id do pixel no Meta. */
  conta: string;
  labels: MapaDeRotulos;
  testEventCode: string | null;
  ativo: boolean;
  /** So no Meta, e so quando o chamador pediu. Nunca sai para o cliente. */
  token?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Destinos ATIVOS de uma loja, com o token quando houver.
 *
 * O token mora em outra tabela por um motivo de RLS: ela e por LINHA, nao por
 * coluna -- deixar o token na linha que o lojista le entregaria o token junto,
 * e ele posta evento na conta de anuncios dele.
 */
export async function destinosDaLoja(
  admin: Admin,
  storeId: string,
  opcoes: { comToken?: boolean } = {}
): Promise<Destino[]> {
  const { data } = await admin
    .from("tracking_destinations")
    .select("id, store_id, plataforma, nome, conta, labels, test_event_code, ativo")
    .eq("store_id", storeId)
    .eq("ativo", true)
    .order("created_at", { ascending: true });

  const destinos: Destino[] = (data || []).map((d) => ({
    id: d.id,
    storeId: d.store_id,
    plataforma: d.plataforma as "google" | "meta",
    nome: d.nome,
    conta: d.conta,
    labels: (d.labels as MapaDeRotulos | null) ?? {},
    testEventCode: d.test_event_code,
    ativo: d.ativo,
  }));

  if (!opcoes.comToken || destinos.length === 0) return destinos;

  const ids = destinos.map((d) => d.id);
  const { data: segredos } = await admin
    .from("tracking_destination_secrets")
    .select("destination_id, access_token")
    .in("destination_id", ids);

  const porId = new Map((segredos || []).map((s) => [s.destination_id, s.access_token]));
  for (const d of destinos) d.token = porId.get(d.id) ?? null;
  return destinos;
}

/**
 * Todos os destinos de varias lojas, para a TELA.
 *
 * Difere de `destinosDaLoja` em duas coisas, e as duas sao de proposito:
 *
 *   - traz o DESATIVADO tambem. Destino desligado que desaparece da tela nao da
 *     para religar, e o lojista refaz do zero achando que perdeu.
 *   - nunca traz o token, so `temToken`. Esta funcao alimenta uma resposta que
 *     chega ao navegador.
 */
export async function destinosParaTela(
  admin: Admin,
  storeIds: string[]
): Promise<Map<string, (Omit<Destino, "token"> & { temToken: boolean })[]>> {
  const porLoja = new Map<string, (Omit<Destino, "token"> & { temToken: boolean })[]>();
  if (storeIds.length === 0) return porLoja;

  const { data } = await admin
    .from("tracking_destinations")
    .select("id, store_id, plataforma, nome, conta, labels, test_event_code, ativo")
    .in("store_id", storeIds)
    .order("created_at", { ascending: true });

  const linhas = data || [];
  if (linhas.length === 0) return porLoja;

  // So a EXISTENCIA do token. A tabela de segredo nao tem policy nenhuma, e o
  // valor nunca atravessa para o cliente.
  const { data: segredos } = await admin
    .from("tracking_destination_secrets")
    .select("destination_id, access_token")
    .in(
      "destination_id",
      linhas.map((l) => l.id)
    );
  const comToken = new Set(
    (segredos || []).filter((s) => s.access_token).map((s) => s.destination_id)
  );

  for (const d of linhas) {
    const lista = porLoja.get(d.store_id) || [];
    lista.push({
      id: d.id,
      storeId: d.store_id,
      plataforma: d.plataforma as "google" | "meta",
      nome: d.nome,
      conta: d.conta,
      labels: (d.labels as MapaDeRotulos | null) ?? {},
      testEventCode: d.test_event_code,
      ativo: d.ativo,
      temToken: comToken.has(d.id),
    });
    porLoja.set(d.store_id, lista);
  }
  return porLoja;
}

/**
 * As contas do Google ATIVAS de uma loja, para a tag do tema.
 *
 * O remarketing e a unica parte do rastreamento que roda no navegador, e cada
 * conta de anuncio monta a SUA lista -- publico criado na conta A nao serve na
 * conta B. Com cinco contas anunciando a mesma loja, mandar so a primeira
 * deixaria quatro sem publico nenhum.
 */
export async function contasGoogleDaLoja(
  admin: Admin,
  storeId: string
): Promise<string[]> {
  const { data } = await admin
    .from("tracking_destinations")
    .select("conta")
    .eq("store_id", storeId)
    .eq("plataforma", "google")
    .eq("ativo", true)
    .order("created_at", { ascending: true });

  const vistas = new Set<string>();
  for (const d of data || []) {
    const conta = (d.conta || "").trim();
    if (conta) vistas.add(conta);
  }
  return [...vistas];
}

/** Um destino pelo id, com token. Usado pela fila ao entregar. */
export async function destinoPorId(
  admin: Admin,
  destinationId: string
): Promise<Destino | null> {
  const { data } = await admin
    .from("tracking_destinations")
    .select("id, store_id, plataforma, nome, conta, labels, test_event_code, ativo")
    .eq("id", destinationId)
    .maybeSingle();

  if (!data) return null;

  const { data: segredo } = await admin
    .from("tracking_destination_secrets")
    .select("access_token")
    .eq("destination_id", destinationId)
    .maybeSingle();

  return {
    id: data.id,
    storeId: data.store_id,
    plataforma: data.plataforma as "google" | "meta",
    nome: data.nome,
    conta: data.conta,
    labels: (data.labels as MapaDeRotulos | null) ?? {},
    testEventCode: data.test_event_code,
    ativo: data.ativo,
    token: segredo?.access_token ?? null,
  };
}

/**
 * Este destino quer este evento?
 *
 * No Google cada evento e uma conversion action propria, com rotulo proprio --
 * evento sem rotulo e o lojista dizendo que nao quer aquele evento. No Meta um
 * pixel cobre todos, entao basta estar configurado.
 */
export function destinoAceita(destino: Destino, nomeDoEvento: string): boolean {
  if (!destino.ativo) return false;
  if (destino.plataforma === "meta") return Boolean(destino.conta && destino.token);
  return Boolean(destino.conta) && rotuloDoEvento(destino.labels, nomeDoEvento) !== null;
}

/** Para a mensagem de erro da fila dizer o que falta, e nao so "sem config". */
export function porQueRecusa(destino: Destino, nomeDoEvento: string): string {
  if (!destino.ativo) return "destino desativado";
  if (!destino.conta) return "destino sem conta configurada";
  if (destino.plataforma === "meta") {
    return destino.token ? "" : "destino do Meta sem token do CAPI";
  }
  return rotuloDoEvento(destino.labels, nomeDoEvento) !== null
    ? ""
    : `sem rotulo configurado para o evento "${nomeDoEvento}"`;
}
