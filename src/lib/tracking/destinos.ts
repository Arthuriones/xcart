import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rotuloDoEvento,
  vaiPeloServidor,
  type MapaDeRotulos,
  type PlataformaDestino,
} from "@/lib/tracking/eventos";
import { contasGoogleParaNavegador, type ContaGoogleNoNavegador } from "@/lib/tracking/google-tag";

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
//
// O destino GOOGLE (conta AW- e um rotulo por evento) continua aqui como
// configuracao, mas nao e destino de FILA: quem envia e a tag do Google no
// navegador, que le esta configuracao por /api/tracking/google-config.
// ============================================================================

export interface Destino {
  id: string;
  storeId: string;
  plataforma: PlataformaDestino;
  /** Apelido do lojista. Com dois da mesma plataforma, o id nao basta na tela. */
  nome: string | null;
  /** AW-XXXXXXXXX no Google, id do pixel no Meta, Pixel Code no TikTok. */
  conta: string;
  labels: MapaDeRotulos;
  testEventCode: string | null;
  /**
   * Formato do id de produto, com {variant_id}, {product_id} e {sku}.
   *
   * null = `{variant_id}`, que e o que o codigo fazia antes de isto existir.
   * Mora por destino porque o catalogo do Meta e o feed do Google sao dois
   * catalogos diferentes e podem usar formatos diferentes na mesma loja.
   */
  idTemplate: string | null;
  ativo: boolean;
  /**
   * Token do Meta (CAPI) ou do TikTok (Events API), e so quando o chamador
   * pediu. Nunca sai para o cliente.
   */
  token?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * As colunas da linha. `*` e nao a lista: coluna nova que chegue por migration
 * antes ou depois do deploy nao derruba a leitura -- e o coletor e o webhook
 * param o Meta junto quando ela falha.
 */
const COLUNAS = "*";

/** Linha do banco -> Destino, sem o token. */
function destinoDaLinha(d: Record<string, unknown>): Destino {
  return {
    id: String(d.id),
    storeId: String(d.store_id),
    plataforma: d.plataforma as PlataformaDestino,
    nome: (d.nome as string | null) ?? null,
    conta: String(d.conta ?? ""),
    labels: (d.labels as MapaDeRotulos | null) ?? {},
    testEventCode: (d.test_event_code as string | null) ?? null,
    idTemplate: (d.id_template as string | null) ?? null,
    ativo: Boolean(d.ativo),
  };
}

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
  const { data, error } = await admin
    .from("tracking_destinations")
    .select(COLUNAS)
    .eq("store_id", storeId)
    .eq("ativo", true)
    .order("created_at", { ascending: true });

  // Erro de banco nao e "loja sem destino". Devolver lista vazia fazia o
  // webhook responder 200 'nenhum destino', e com 200 a Shopify nao reentrega.
  if (error) throw new Error(`falha ao ler os destinos da loja: ${error.message}`);

  const destinos: Destino[] = (data || []).map(destinoDaLinha);

  if (!opcoes.comToken || destinos.length === 0) return destinos;

  const ids = destinos.map((d) => d.id);
  const { data: segredos, error: erroSegredo } = await admin
    .from("tracking_destination_secrets")
    .select("destination_id, access_token")
    .in("destination_id", ids);

  // Sem isto, um erro aqui deixava todo destino Meta "sem token", e
  // `destinoAceita` recusava a compra como se a loja nao tivesse Meta.
  if (erroSegredo) {
    throw new Error(`falha ao ler os tokens dos destinos: ${erroSegredo.message}`);
  }

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
    .select(COLUNAS)
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
    lista.push({ ...destinoDaLinha(d), temToken: comToken.has(d.id) });
    porLoja.set(d.store_id, lista);
  }
  return porLoja;
}

/**
 * As contas Google ATIVAS da loja, com os rotulos, para a tag do Google no
 * navegador (/api/tracking/google-config).
 *
 * Erro de banco LANCA: a rota responde sem cache, e o navegador tenta de novo
 * na proxima pagina em vez de guardar "loja sem Google".
 */
export async function googleDaLoja(admin: Admin, storeId: string): Promise<ContaGoogleNoNavegador[]> {
  const { data, error } = await admin
    .from("tracking_destinations")
    .select("conta, labels, ativo")
    .eq("store_id", storeId)
    .eq("plataforma", "google")
    .eq("ativo", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`falha ao ler as contas Google da loja: ${error.message}`);
  return contasGoogleParaNavegador(data || []);
}

/**
 * O que a tag do tema precisa saber sobre o Google: as contas e o formato do id.
 *
 * As contas no PLURAL porque cada conta de anuncio monta a SUA lista de
 * remarketing -- publico criado na conta A nao serve na conta B. Com cinco
 * contas anunciando a mesma loja, mandar so a primeira deixaria quatro sem
 * publico nenhum.
 *
 * O template vem junto porque `ecomm_prodid` e montado no NAVEGADOR, e ele tem
 * que casar com o id do Merchant Center igual aos eventos do servidor. Com
 * varias contas vale o template da primeira: o feed do Merchant Center da loja
 * e um so, entao elas nao deveriam divergir -- e se divergirem, a tela mostra
 * cada destino com o seu.
 */
export async function remarketingDaLoja(
  admin: Admin,
  storeId: string
): Promise<{ contas: string[]; idTemplate: string | null }> {
  const { data } = await admin
    .from("tracking_destinations")
    .select("conta, id_template")
    .eq("store_id", storeId)
    .eq("plataforma", "google")
    .eq("ativo", true)
    .order("created_at", { ascending: true });

  const contas: string[] = [];
  let idTemplate: string | null = null;
  for (const d of data || []) {
    const conta = (d.conta || "").trim();
    if (conta && !contas.includes(conta)) contas.push(conta);
    if (idTemplate === null && d.id_template) idTemplate = d.id_template;
  }
  return { contas, idTemplate };
}

/** Um destino pelo id, com token. Usado pela fila ao entregar. */
export async function destinoPorId(
  admin: Admin,
  destinationId: string
): Promise<Destino | null> {
  const { data } = await admin
    .from("tracking_destinations")
    .select(COLUNAS)
    .eq("id", destinationId)
    .maybeSingle();

  if (!data) return null;

  const { data: segredo } = await admin
    .from("tracking_destination_secrets")
    .select("access_token")
    .eq("destination_id", destinationId)
    .maybeSingle();

  return { ...destinoDaLinha(data), token: segredo?.access_token ?? null };
}

/**
 * Este destino quer este evento NA FILA DO SERVIDOR?
 *
 * Meta e TikTok: um pixel cobre todos os eventos, entao basta estar
 * configurado (pixel + token). O Google nunca -- vai pelo navegador (tag do
 * Google), fora da fila.
 */
export function destinoAceita(destino: Destino): boolean {
  if (!destino.ativo) return false;
  if (!vaiPeloServidor(destino.plataforma)) return false;
  return Boolean(destino.conta && destino.token);
}

/**
 * A tag do Google, no navegador, dispara este evento para este destino? Conta
 * ativa com rotulo para o evento. Serve para decidir se a loja pode ser ligada
 * so com Google -- `destinoAceita` e da fila, e la o Google nunca entra.
 */
export function tagDoGoogleDispara(destino: Destino, nomeDoEvento: string): boolean {
  return (
    destino.ativo &&
    destino.plataforma === "google" &&
    Boolean(destino.conta) &&
    rotuloDoEvento(destino.labels, nomeDoEvento) !== null
  );
}

/** Para a mensagem de erro da fila dizer o que falta, e nao so "sem config". */
export function porQueRecusa(destino: Destino): string {
  if (!destino.ativo) return "destino desativado";
  if (!vaiPeloServidor(destino.plataforma)) return "o Google vai pelo navegador (tag do Google), não pelo servidor";
  if (!destino.conta) return "destino sem conta configurada";
  if (destino.token) return "";
  return destino.plataforma === "tiktok"
    ? "destino do TikTok sem token da Events API"
    : "destino do Meta sem token do CAPI";
}
