import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rotuloDoEvento, type MapaDeRotulos } from "@/lib/tracking/eventos";
import {
  acaoDoEvento,
  idDeCliente,
  limparAcoes,
  usaDataManager,
  type AcoesDataManager,
} from "@/lib/tracking/google-url";
import { temCredencialDoGoogle } from "@/lib/tracking/google-dm";

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
   * So Google, pela Data Manager API (migration 054). Com `customerId` e ao
   * menos uma acao, o destino sai por la; sem, continua no ping antigo pelos
   * `labels`. Opcionais para nao obrigar quem monta Destino a mao.
   */
  customerId?: string | null;
  loginCustomerId?: string | null;
  acoes?: AcoesDataManager;
  /** So no Meta, e so quando o chamador pediu. Nunca sai para o cliente. */
  token?: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * As colunas da linha. `*` e nao a lista: com a lista, um deploy que chegue
 * antes da migration 054 faria TODA leitura de destino falhar -- e o coletor e
 * o webhook param o Meta junto. Com `*`, antes da 054 as colunas novas so vem
 * ausentes e o Google segue no caminho antigo.
 */
const COLUNAS = "*";

/** Linha do banco -> Destino, sem o token. */
function destinoDaLinha(d: Record<string, unknown>): Destino {
  return {
    id: String(d.id),
    storeId: String(d.store_id),
    plataforma: d.plataforma as "google" | "meta",
    nome: (d.nome as string | null) ?? null,
    conta: String(d.conta ?? ""),
    labels: (d.labels as MapaDeRotulos | null) ?? {},
    testEventCode: (d.test_event_code as string | null) ?? null,
    idTemplate: (d.id_template as string | null) ?? null,
    ativo: Boolean(d.ativo),
    customerId: idDeCliente(d.customer_id),
    loginCustomerId: idDeCliente(d.login_customer_id),
    acoes: limparAcoes(d.acoes),
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
 * Este destino quer este evento?
 *
 * No Google cada evento e uma conversion action propria. Pela Data Manager, o
 * evento sem ID de acao e o lojista dizendo que nao quer aquele evento -- e sem
 * a credencial da service account no servidor nada sai, entao nada entra na
 * fila (a tela mostra "falta configurar"). No caminho antigo vale o rotulo. No
 * Meta um pixel cobre todos, entao basta estar configurado.
 */
export function destinoAceita(destino: Destino, nomeDoEvento: string): boolean {
  if (!destino.ativo) return false;
  if (destino.plataforma === "meta") return Boolean(destino.conta && destino.token);
  if (usaDataManager(destino)) {
    return acaoDoEvento(destino.acoes, nomeDoEvento) !== null && temCredencialDoGoogle();
  }
  return Boolean(destino.conta) && rotuloDoEvento(destino.labels, nomeDoEvento) !== null;
}

/** Para a mensagem de erro da fila dizer o que falta, e nao so "sem config". */
export function porQueRecusa(destino: Destino, nomeDoEvento: string): string {
  if (!destino.ativo) return "destino desativado";
  if (!destino.conta) return "destino sem conta configurada";
  if (destino.plataforma === "meta") {
    return destino.token ? "" : "destino do Meta sem token do CAPI";
  }
  if (usaDataManager(destino)) {
    if (acaoDoEvento(destino.acoes, nomeDoEvento) === null) {
      return `sem ID de ação para o evento "${nomeDoEvento}"`;
    }
    return temCredencialDoGoogle() ? "" : "falta a credencial do Google (service account) no servidor";
  }
  return rotuloDoEvento(destino.labels, nomeDoEvento) !== null
    ? ""
    : `sem rotulo configurado para o evento "${nomeDoEvento}"`;
}
