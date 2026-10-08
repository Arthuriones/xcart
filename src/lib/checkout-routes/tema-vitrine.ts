import type { SupabaseClient } from "@supabase/supabase-js";
import { safeFetch } from "@/lib/net/safe-url";
import { assertShopDomainPublico } from "@/lib/shopify/safe-shop";
import { getPublicAppUrl } from "@/lib/public-url";
import { buildEmbedConfig, type EmbedConfig } from "@/lib/checkout-routes/embed-config";
import {
  ASSET_DO_CONFIG,
  configParaOTema,
  hashDoConfig,
  trocarScriptNoTema,
  type TrocaNoTema,
} from "@/lib/checkout-routes/tema-script";

// ============================================================================
// O xcart-config.json no tema da vitrine.
//
// O loader roteia PRIMEIRO pelo mapa embutido no tema (o asset), e so cai na
// API quando o asset nao cobre o carrinho. O asset so era regravado pelo
// botao "Instalar na vitrine". O conserto de hora em hora, o "Corrigir agora",
// pausar a rota, pausar/tirar/pesar uma loja de checkout -- tudo mudava so o
// banco. Medido na NORAH: o asset era de 07/09, 46 SKUs do banco faltavam no
// tema (38% da vitrine dependia da API) e 13 SKUs que o conserto ja tinha
// tirado do mapa continuavam no tema, apontando para a variante errada. Loja
// pausada no painel porque a conta de pagamento caiu continuava recebendo
// comprador pelo caminho inline.
//
// Agora toda mudanca de mapa ou de destino chama sincronizarTemaDaRota, que
// compara o config pelo conteudo (hash guardado em settings.theme_sync) e so
// escreve na Shopify quando mudou.
// ============================================================================

export type EstadoTema =
  | "em_dia"
  | "atualizado"
  | "instalado"
  | "sem_script"
  | "script_de_outra_rota"
  | "sem_config_url"
  | "falhou";

export interface ResultadoTema {
  estado: EstadoTema;
  mensagem?: string;
}

/** Guardado em routed_checkout_configs.settings.theme_sync. */
export interface SincroniaDoTema {
  /** Hash do ultimo config que chegou ao tema (ou que nao precisa chegar). */
  hash?: string;
  at: string;
  estado: EstadoTema;
  mensagem?: string;
}

export class TemaError extends Error {
  status: number;
  /** A falha ja foi gravada em theme_sync (com o hash). */
  registrado = false;
  /** Motivo que a tela trata pelo nome (ex.: "rota_pausada"). */
  codigo?: string;
  constructor(message: string, status = 500, codigo?: string) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

/**
 * Com o MESMO config, quando olhar o tema de novo. Falha (loja sem
 * write_themes, app removido) ou tema sem o script desta rota: a cada 6 h --
 * senao seria em todo conserto, de hora em hora. Tema ja atualizado: uma vez
 * por dia, para pegar o lojista que publicou outro tema (o asset mora no
 * tema). Config novo olha na hora.
 */
const REPETIR_FALHA_MS = 6 * 60 * 60 * 1000;
const REVALIDAR_MS = 24 * 60 * 60 * 1000;

const CONFIG_SELECT =
  "id, user_id, enabled, public_token, rotation, sku_map, variant_map, settings, source_store_id, target_store_id, target:target_store_id(name, shop_domain, target_language)";

interface LojaVitrine {
  shop_domain: string;
  client_id?: string | null;
  client_secret?: string | null;
  access_token?: string | null;
  uninstalled_at?: string | null;
}

async function shopifyRest(
  domain: string,
  accessToken: string,
  path: string,
  options: RequestInit = {}
) {
  // Mesma trava de dominio do cliente Shopify: o token vai no header para o
  // host que estiver em shop_domain.
  const host = await assertShopDomainPublico(domain);
  const res = await safeFetch(`https://${host}/admin/api/2024-10${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TemaError(`Shopify REST ${res.status}: ${body.slice(0, 200)}`, 502);
  }
  return res.json();
}

async function tokenDaVitrine(loja: LojaVitrine): Promise<string> {
  // client_credentials sempre que houver credencial do app: devolve um token
  // com os escopos atuais (write_themes). Loja conectada por OAuth nao tem
  // client_secret proprio -- usa o token guardado.
  if (!loja.client_id || !loja.client_secret) {
    if (loja.access_token) return loja.access_token;
    throw new TemaError("A vitrine nao tem credencial para escrever no tema.", 409);
  }
  const host = await assertShopDomainPublico(loja.shop_domain);
  const res = await safeFetch(`https://${host}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: loja.client_id,
      client_secret: loja.client_secret,
    }),
  });
  if (!res.ok) throw new TemaError("Falha ao obter token de acesso da vitrine.", 502);
  const data = await res.json();
  return data.access_token;
}

async function gravarSincronia(
  admin: SupabaseClient,
  routeId: string,
  sincronia: SincroniaDoTema
) {
  // Le de novo na hora de gravar: o conserto acabou de escrever last_heal no
  // mesmo jsonb, e espalhar o settings lido no comeco apagaria aquilo.
  const { data } = await admin
    .from("routed_checkout_configs")
    .select("settings")
    .eq("id", routeId)
    .maybeSingle();
  const settings = ((data?.settings as Record<string, unknown> | null) || {}) as Record<
    string,
    unknown
  >;
  const { error } = await admin
    .from("routed_checkout_configs")
    .update({ settings: { ...settings, theme_sync: sincronia } })
    .eq("id", routeId);
  if (error) console.warn("[tema-vitrine] nao gravei theme_sync:", error.message);
}

export interface PublicacaoNoTema extends ResultadoTema {
  embed: EmbedConfig;
  troca: TrocaNoTema | null;
}

/**
 * Leva o config da rota ao tema publicado da vitrine.
 *
 * `instalar` (botao "Instalar na vitrine"): escreve o asset e poe o script
 * desta rota no theme.liquid, como sempre. Sem `instalar` (automatico): so
 * escreve se o tema ja tem o script DESTA rota lendo o config embutido --
 * nunca instala sozinho, nunca mexe no asset de outra rota.
 *
 * `forcar` ignora o hash (o botao sempre escreve). Lanca TemaError.
 */
export async function publicarConfigNoTema(
  admin: SupabaseClient,
  routeId: string,
  opcoes: { instalar: boolean; forcar?: boolean; userId?: string }
): Promise<PublicacaoNoTema> {
  let query = admin.from("routed_checkout_configs").select(CONFIG_SELECT).eq("id", routeId);
  if (opcoes.userId) query = query.eq("user_id", opcoes.userId);
  const { data: config, error } = await query.maybeSingle();
  if (error || !config) throw new TemaError("Rota não encontrada.", 404);

  // Instalar com a rota pausada grava o config sem destino: o loader cai na
  // API, a API recusa rota pausada e TODO clique de checkout da vitrine vira
  // "Erro ao carregar checkout". O assistente oferecia "Instalar" logo abaixo
  // de "rota criada pausada" -- e respondia "instalado" com as contagens do
  // mapa cheio. Recusa: ligue a rota primeiro. O reenvio automatico continua
  // valendo para rota pausada, porque ali o script ja esta no tema e quem
  // pausou quer mesmo parar de rotear.
  if (opcoes.instalar && config.enabled === false) {
    throw new TemaError(
      "A rota está pausada. Com ela pausada, o script trava o checkout da vitrine. Ligue a rota e instale de novo.",
      409,
      "rota_pausada"
    );
  }

  let embed: EmbedConfig;
  try {
    embed = await buildEmbedConfig(admin, config);
  } catch (erro) {
    // Banco fora na leitura dos destinos: nao escreve nada no tema. Montar o
    // config assim (sem as linhas de destino, caindo no legado) gravaria na
    // vitrine o mapa velho do primario, sem rodizio. Sem hash: a proxima
    // chamada tenta de novo.
    throw new TemaError(
      erro instanceof Error ? erro.message : "Falha ao ler as lojas de checkout da rota.",
      503
    );
  }
  if (opcoes.instalar && embed.targets.length === 0) {
    throw new TemaError("Esta rota nao tem loja de checkout com dominio configurado.", 409);
  }
  const paraTema = configParaOTema(embed, config.enabled !== false);
  const hash = hashDoConfig(paraTema);
  const settings = (config.settings || {}) as { theme_sync?: SincroniaDoTema };

  const anterior = settings.theme_sync;
  if (!opcoes.forcar && anterior?.hash === hash) {
    const desde = Date.parse(anterior.at);
    const idade = Number.isFinite(desde) ? Date.now() - desde : Infinity;
    const chegou = anterior.estado === "atualizado" || anterior.estado === "instalado";
    if (idade < (chegou ? REVALIDAR_MS : REPETIR_FALHA_MS)) {
      return chegou
        ? { estado: "em_dia", embed, troca: null }
        : { estado: anterior.estado, mensagem: anterior.mensagem, embed, troca: null };
    }
  }

  try {
    return await escreverNoTema(admin, routeId, config, embed, paraTema, hash, opcoes.instalar);
  } catch (erro) {
    if (!opcoes.instalar) {
      const mensagem = (erro instanceof Error ? erro.message : "erro desconhecido").slice(0, 200);
      await gravarSincronia(admin, routeId, {
        hash,
        at: new Date().toISOString(),
        estado: "falhou",
        mensagem,
      });
      if (erro instanceof TemaError) erro.registrado = true;
    }
    throw erro;
  }
}

async function escreverNoTema(
  admin: SupabaseClient,
  routeId: string,
  config: { source_store_id: string; user_id: string; public_token: string },
  embed: EmbedConfig,
  paraTema: EmbedConfig,
  hash: string,
  instalar: boolean
): Promise<PublicacaoNoTema> {
  // Dono da rota = dono da vitrine. O filtro importa: este e o cliente admin.
  const { data: loja } = await admin
    .from("stores")
    .select("shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .eq("id", config.source_store_id)
    .eq("user_id", config.user_id)
    .maybeSingle();
  if (!loja) throw new TemaError("Vitrine não encontrada.", 404);
  if ((loja as LojaVitrine).uninstalled_at) {
    throw new TemaError(`O app foi removido de ${loja.shop_domain}.`, 409);
  }

  const accessToken = await tokenDaVitrine(loja as LojaVitrine);
  const dominio = loja.shop_domain as string;

  const themesData = await shopifyRest(dominio, accessToken, "/themes.json");
  const themes = (themesData.themes || []) as { id: number; role: string }[];
  const tema = themes.find((t) => t.role === "main");
  if (!tema) throw new TemaError("Tema ativo não encontrado na vitrine.", 404);

  const layout = await shopifyRest(
    dominio,
    accessToken,
    `/themes/${tema.id}/assets.json?asset[key]=layout/theme.liquid`
  );
  const atual: string = layout.asset?.value || "";
  if (!atual) throw new TemaError("theme.liquid não encontrado ou vazio.", 404);

  const appOrigin = getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "https://xcart.app");
  const { conteudo, troca } = trocarScriptNoTema(atual, {
    token: config.public_token,
    appOrigin,
    instalar,
  });

  const agora = new Date().toISOString();
  if (troca === "sem_script" || troca === "script_de_outra_rota" || troca === "sem_config_url") {
    if (instalar) {
      throw new TemaError("Não achei onde pôr o script no theme.liquid (falta </head>).", 404);
    }
    // Nada a escrever, e nada vai mudar ate o tema mudar: guarda o hash para
    // nao perguntar a Shopify de novo a cada conserto.
    await gravarSincronia(admin, routeId, { hash, at: agora, estado: troca });
    return { estado: troca, embed, troca };
  }

  // Asset primeiro: o script novo le pelo Liquid, entao ele tem que existir
  // no tema antes de o theme.liquid apontar para ele. Na revalidacao diaria o
  // asset costuma estar igual: le antes, e so escreve se mudou.
  const valor = JSON.stringify(paraTema);
  let assetIgual = false;
  if (!instalar && troca === "igual") {
    const atualDoAsset = await shopifyRest(
      dominio,
      accessToken,
      `/themes/${tema.id}/assets.json?asset[key]=${ASSET_DO_CONFIG}`
    ).catch(() => null);
    assetIgual = atualDoAsset?.asset?.value === valor;
  }
  if (!assetIgual) {
    await shopifyRest(dominio, accessToken, `/themes/${tema.id}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({ asset: { key: ASSET_DO_CONFIG, value: valor } }),
    });
  }
  if (conteudo !== atual) {
    await shopifyRest(dominio, accessToken, `/themes/${tema.id}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({ asset: { key: "layout/theme.liquid", value: conteudo } }),
    });
  }

  const estado: EstadoTema = instalar ? "instalado" : "atualizado";
  await gravarSincronia(admin, routeId, { hash, at: agora, estado });
  return { estado, embed, troca };
}

/**
 * Reenvio automatico, depois de qualquer mudanca de mapa ou de destino.
 * Nunca lanca: o que chamou (conserto, liga/desliga, divisao) ja fez o
 * trabalho dele, e o tema desatualizado fica registrado em
 * settings.theme_sync para a proxima tentativa e para a tela.
 */
export async function sincronizarTemaDaRota(
  admin: SupabaseClient,
  routeId: string
): Promise<ResultadoTema> {
  try {
    const { estado, mensagem } = await publicarConfigNoTema(admin, routeId, { instalar: false });
    return mensagem ? { estado, mensagem } : { estado };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "erro desconhecido";
    console.warn("[tema-vitrine] reenvio ao tema falhou:", routeId, mensagem);
    // Falha antes do hash (rota sumiu, banco fora): registra sem hash, e a
    // proxima chamada tenta de novo.
    if (!(erro instanceof TemaError && erro.registrado)) {
      await gravarSincronia(admin, routeId, {
        at: new Date().toISOString(),
        estado: "falhou",
        mensagem: mensagem.slice(0, 200),
      }).catch(() => {});
    }
    return { estado: "falhou", mensagem };
  }
}
