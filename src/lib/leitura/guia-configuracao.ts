import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { estadoConexao } from "@/lib/leitura/lojas-estado";
import { checarSnippet } from "@/lib/tracking/diagnostico";
import {
  COOKIE_GUIA_CAMINHO,
  COOKIE_GUIA_DISPENSADO,
  caminhoDoGuia,
  montarGuia,
  type CaminhoGuia,
  type ContaGuia,
  type DestinoGuia,
  type FotoGuia,
  type Guia,
  type LojaGuia,
  type RotaGuia,
} from "@/lib/leitura/guia-passos";

// ============================================================================
// Leitura nova do Guia de configuracao. So SELECT e tudo pela sessao (RLS) --
// menos a EXISTENCIA do token do Meta, que mora numa tabela sem policy
// nenhuma: ali entra o admin, so com ids de destino que a sessao acabou de ler
// (do proprio usuario), e o valor do token nunca sai.
//
// A unica ida a Shopify e o script no tema (lerScriptNoTema): so para loja com
// rastreamento ligado, e guardada por 10 minutos.
//
// Le: stores, fin_sync_state, tracking_configs, tracking_destinations (+ a
// existencia do segredo), ad_accounts, fin_store_settings, product_costs,
// routed_checkout_configs, routed_checkout_targets (sem o mapa de SKU: so a
// contagem dos que tem mapa), routed_checkout_fallbacks e tracking_events.
//
// Cada parte falha sozinha e vira null na foto: o passo fica "nao conferido"
// em vez de "falta" -- erro nunca vira zero.
// ============================================================================

type Cliente = Awaited<ReturnType<typeof createClient>>;

const VAZIA: FotoGuia = {
  lojas: [],
  rastreamentoLigado: [],
  pixelCheckoutVisto: [],
  scriptNoTema: {},
  destinos: [],
  contas: [],
  custos: { comTaxa: [], comCusto: [] },
  ultimaVenda: { em: null, plataforma: null },
  rotas: [],
  destinosComSku: 0,
  scriptVisto: { em: null },
  carrinhoRoteado: { em: null },
};

function log(parte: string, erro: unknown) {
  console.error(`[guia] falha ao ler ${parte}:`, erro instanceof Error ? erro.message : erro);
}

/** A foto do que existe na conta, para montar os passos dos dois caminhos. */
export const lerFotoGuia = cache(async (): Promise<FotoGuia> => {
  const user = await getCurrentUser();
  if (!user) return VAZIA;
  const supabase = await createClient();

  // Primeira ida: tudo que so depende do usuario.
  const [lojasRes, syncRes, ligadoRes, destinosRes, contasRes, taxaRes, rotasRes] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, shop_domain, uninstalled_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("fin_sync_state")
      .select("store_id, ultimo_erro_tipo, ultimo_erro, ultimo_sync_ok_em, carga_inicial_ok")
      .eq("user_id", user.id),
    supabase
      .from("tracking_configs")
      .select("store_id, web_pixel_visto_em")
      .eq("user_id", user.id)
      .eq("enabled", true),
    supabase
      .from("tracking_destinations")
      .select("id, store_id, plataforma, ativo, labels, test_event_code")
      .eq("user_id", user.id),
    supabase.from("ad_accounts").select("plataforma, store_id, ativo, ultimo_erro").eq("user_id", user.id),
    supabase.from("fin_store_settings").select("store_id, custo_padrao_pct").eq("user_id", user.id),
    supabase
      .from("routed_checkout_configs")
      .select("id, enabled, source_store_id, target_store_id")
      .eq("user_id", user.id),
  ]);

  // --- Lojas e a conexao de cada uma --------------------------------------
  let lojas: LojaGuia[] | null = null;
  if (lojasRes.error) log("lojas", lojasRes.error);
  else {
    if (syncRes.error) log("sincronizacao", syncRes.error);
    const sync = new Map(
      (syncRes.error ? [] : syncRes.data ?? []).map((s) => [
        String(s.store_id),
        {
          ultimoErroTipo: (s.ultimo_erro_tipo ?? null) as "negado" | "falhou" | null,
          ultimoErro: s.ultimo_erro ?? null,
          ultimoSyncOkEm: s.ultimo_sync_ok_em ?? null,
          cargaInicialOk: Boolean(s.carga_inicial_ok),
        },
      ])
    );
    lojas = (lojasRes.data ?? []).map((l) => ({
      id: String(l.id),
      nome: String(l.name || l.shop_domain || "Loja sem nome"),
      // Sem a leitura da sincronizacao, so a desinstalacao conta: melhor uma
      // loja pausada aparecer ativa do que todas sumirem.
      semAcesso: estadoConexao({
        desinstaladaEm: l.uninstalled_at ?? null,
        sync: sync.get(String(l.id)) ?? null,
      }).semAcesso,
    }));
  }
  const idsLojas = (lojas ?? []).map((l) => l.id);
  const idsAtivas = (lojas ?? []).filter((l) => !l.semAcesso).map((l) => l.id);
  // Ligadas e com acesso: so nelas o script no tema decide alguma coisa.
  const idsLigadas = ligadoRes.error
    ? []
    : (ligadoRes.data ?? []).map((c) => String(c.store_id)).filter((id) => idsAtivas.includes(id));

  // --- Rotas ----------------------------------------------------------------
  if (rotasRes.error) log("rotas", rotasRes.error);
  const rotasBrutas = rotasRes.error ? null : rotasRes.data ?? [];
  const idsRotas = (rotasBrutas ?? []).map((r) => String(r.id));

  if (destinosRes.error) log("destinos de rastreamento", destinosRes.error);
  const destinosBrutos = destinosRes.error ? null : destinosRes.data ?? [];
  // Meta e TikTok recebem a compra pelo token; o Google, pelo rotulo.
  const comToken = (p: unknown) => p === "meta" || p === "tiktok";
  const idsComToken = (destinosBrutos ?? []).filter((d) => comToken(d.plataforma)).map((d) => String(d.id));

  // Segunda ida: o que depende das lojas, das rotas e dos destinos.
  const [segredos, custosPorLoja, alvos, comSku, script, roteado, venda, scriptNoTema] = await Promise.all([
    idsComToken.length > 0 ? lerTokens(idsComToken) : Promise.resolve(new Set<string>()),
    lerLojasComCusto(supabase, idsAtivas),
    idsRotas.length > 0
      ? supabase
          .from("routed_checkout_targets")
          .select("route_id, target_store_id, enabled, weight")
          .in("route_id", idsRotas)
      : Promise.resolve({ data: [], error: null }),
    idsRotas.length > 0
      ? supabase
          .from("routed_checkout_targets")
          .select("id", { count: "exact", head: true })
          .in("route_id", idsRotas)
          // O mapa e um jsonb de ate centenas de KB por destino: aqui so
          // interessa se esta vazio, e o banco responde isso sem baixa-lo.
          .neq("sku_map", "{}")
      : Promise.resolve({ count: 0, error: null }),
    ultimoSinalDaRota(supabase, idsRotas, "loader_ready"),
    ultimoSinalDaRota(supabase, idsRotas, "routed_ok"),
    idsLojas.length > 0
      ? supabase
          .from("tracking_events")
          .select("sent_at, created_at, destination")
          .in("store_id", idsLojas)
          .eq("event_name", "Purchase")
          .eq("status", "enviado")
          // So o que aparece em Eventos ao vivo: o Google vai pela tag.
          .in("destination", ["meta", "tiktok"])
          // 'enviado' sem sent_at fechou sem sair (teste, sem clique no
          // Google): nao e venda que chegou na plataforma.
          .not("sent_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    lerScriptNoTema(idsLigadas),
  ]);

  // --- Rastreamento ---------------------------------------------------------
  if (ligadoRes.error) log("rastreamento ligado", ligadoRes.error);
  const destinos: DestinoGuia[] | null =
    destinosBrutos && segredos
      ? destinosBrutos.map((d) => {
          const plataforma: DestinoGuia["plataforma"] =
            d.plataforma === "google" ? "google" : d.plataforma === "tiktok" ? "tiktok" : "meta";
          const labels = (d.labels ?? {}) as Record<string, unknown>;
          return {
            storeId: String(d.store_id),
            plataforma,
            ativo: Boolean(d.ativo),
            recebeCompra:
              plataforma !== "google"
                ? segredos.has(String(d.id))
                : // Google: a tag do navegador dispara a compra pelo rotulo.
                  typeof labels.purchase === "string" && labels.purchase.trim() !== "",
            modoTeste: plataforma !== "google" && Boolean(String(d.test_event_code ?? "").trim()),
          };
        })
      : null;

  // --- Contas de anuncio ------------------------------------------------------
  if (contasRes.error) log("contas de anuncio", contasRes.error);
  const contas: ContaGuia[] | null = contasRes.error
    ? null
    : (contasRes.data ?? []).map((c) => ({
        plataforma: c.plataforma === "google" ? "google" : "meta",
        storeId: c.store_id ? String(c.store_id) : null,
        ativo: Boolean(c.ativo),
        comErro: Boolean(c.ultimo_erro),
      }));

  // --- Custos e taxas ---------------------------------------------------------
  if (taxaRes.error) log("taxas", taxaRes.error);
  const custos =
    taxaRes.error || !custosPorLoja
      ? null
      : {
          comTaxa: (taxaRes.data ?? []).map((t) => String(t.store_id)),
          // Custo padrao (% do preco) tambem tira o produto do zero.
          comCusto: [
            ...new Set([
              ...custosPorLoja,
              ...(taxaRes.data ?? [])
                .filter((t) => t.custo_padrao_pct !== null && t.custo_padrao_pct !== undefined)
                .map((t) => String(t.store_id)),
            ]),
          ],
        };

  // --- Rotas montadas ---------------------------------------------------------
  if (alvos.error) log("destinos das rotas", alvos.error);
  let rotas: RotaGuia[] | null = null;
  if (rotasBrutas && !alvos.error) {
    const porRota = new Map<string, RotaGuia["destinos"]>();
    for (const a of (alvos.data ?? []) as {
      route_id: string;
      target_store_id: string;
      enabled: boolean | null;
      weight: number | null;
    }[]) {
      const lista = porRota.get(String(a.route_id)) ?? [];
      lista.push({
        lojaId: String(a.target_store_id),
        ativo: a.enabled !== false,
        peso: Number(a.weight ?? 0),
      });
      porRota.set(String(a.route_id), lista);
    }
    rotas = rotasBrutas.map((r) => ({
      id: String(r.id),
      ligada: Boolean(r.enabled),
      vitrineId: String(r.source_store_id ?? ""),
      // Rota anterior aos destinos (migration 025) nao tem linha: cai no
      // destino da propria rota, com peso 1 -- a mesma regra de getStoresWithRoles.
      destinos:
        porRota.get(String(r.id)) ??
        (r.target_store_id ? [{ lojaId: String(r.target_store_id), ativo: true, peso: 1 }] : []),
    }));
  }
  if (comSku.error) log("produtos ligados", comSku.error);
  if (venda.error) log("compras enviadas", venda.error);

  const vendaLinha = venda.data as { sent_at: string | null; created_at: string; destination: string } | null;

  return {
    lojas,
    rastreamentoLigado: ligadoRes.error ? null : (ligadoRes.data ?? []).map((c) => String(c.store_id)),
    // So as ligadas: e o que o passo do rastreamento olha.
    pixelCheckoutVisto: ligadoRes.error
      ? null
      : (ligadoRes.data ?? []).filter((c) => c.web_pixel_visto_em).map((c) => String(c.store_id)),
    scriptNoTema,
    destinos,
    contas,
    custos,
    ultimaVenda: venda.error
      ? null
      : {
          em: vendaLinha ? vendaLinha.sent_at || vendaLinha.created_at : null,
          plataforma:
            vendaLinha?.destination === "meta" || vendaLinha?.destination === "tiktok"
              ? vendaLinha.destination
              : null,
        },
    rotas,
    destinosComSku: comSku.error ? null : (comSku.count ?? 0),
    scriptVisto: script,
    carrinhoRoteado: roteado,
  };
});

/**
 * Quais destinos do Meta tem token gravado. So a existencia: o valor fica no
 * banco. null = a leitura falhou.
 */
async function lerTokens(ids: string[]): Promise<Set<string> | null> {
  const { data, error } = await createAdminClient()
    .from("tracking_destination_secrets")
    .select("destination_id")
    .in("destination_id", ids)
    .not("access_token", "is", null)
    .neq("access_token", "");
  if (error) {
    log("tokens do Meta", error);
    return null;
  }
  return new Set((data ?? []).map((s) => String(s.destination_id)));
}

/** A etiqueta do script no tema de uma loja: a rota que instala a tag a invalida. */
export function tagScriptNoTema(storeId: string): string {
  return `guia-script-tema-${storeId}`;
}

/** Acima disto a tela segue sem a resposta (nao conferido); a conferencia termina e fica guardada. */
const TETO_TEMA_MS = 8_000;

/**
 * O script do xcart esta no tema publicado? A MESMA regra do temSnippet da
 * tela de Rastreamento (checarSnippet), mas guardada por 10 minutos: o menu
 * lateral le o guia a cada navegacao e nao pode ir a Shopify toda vez. Quem
 * instala ou remove a tag (api/tracking/snippet) invalida a etiqueta da loja.
 *
 * A credencial e lida pelo admin so com ids que a sessao acabou de ler (do
 * proprio usuario), e so o booleano sai daqui. null = nao deu para conferir.
 */
function scriptNoTemaDaLoja(storeId: string): Promise<boolean | null> {
  return unstable_cache(
    async (): Promise<boolean | null> => {
      const { data: l } = await createAdminClient()
        .from("stores")
        .select("shop_domain, client_id, client_secret, access_token")
        .eq("id", storeId)
        .maybeSingle();
      if (!l?.client_id || !l.client_secret) return null;
      const r = await checarSnippet({
        shopDomain: l.shop_domain,
        clientId: l.client_id,
        clientSecret: l.client_secret,
        accessToken: l.access_token,
      });
      return r ? r.tem : null;
    },
    ["guia-script-no-tema", storeId],
    { revalidate: 600, tags: [tagScriptNoTema(storeId)] }
  )();
}

/** O script no tema de cada loja ligada. Uma loja que falha vira null so nela. */
async function lerScriptNoTema(ids: string[]): Promise<Record<string, boolean | null>> {
  const respostas = await Promise.all(
    ids.map(async (id) => {
      let relogio: ReturnType<typeof setTimeout> | undefined;
      const teto = new Promise<null>((resolver) => {
        relogio = setTimeout(() => resolver(null), TETO_TEMA_MS);
      });
      try {
        return await Promise.race([scriptNoTemaDaLoja(id), teto]);
      } catch (e) {
        log(`o script no tema (${id})`, e);
        return null;
      } finally {
        clearTimeout(relogio);
      }
    })
  );
  return Object.fromEntries(ids.map((id, i) => [id, respostas[i]]));
}

/**
 * Lojas com pelo menos um custo de produto. Uma consulta de uma linha por
 * loja (sao poucas): a tabela tem uma linha por SKU e versao. null = falhou.
 */
async function lerLojasComCusto(supabase: Cliente, ids: string[]): Promise<string[] | null> {
  if (ids.length === 0) return [];
  const respostas = await Promise.all(
    ids.map((id) =>
      supabase.from("product_costs").select("store_id").eq("store_id", id).limit(1)
    )
  );
  const falha = respostas.find((r) => r.error);
  if (falha?.error) {
    log("custos de produto", falha.error);
    return null;
  }
  return ids.filter((_, i) => (respostas[i].data ?? []).length > 0);
}

/**
 * O sinal mais recente que o script da vitrine gravou: "loader_ready" (o
 * script carregou, guardado por 30 dias) ou "routed_ok" (levou um carrinho a
 * uma loja de checkout, guardado por 180). null = a leitura falhou.
 */
async function ultimoSinalDaRota(
  supabase: Cliente,
  idsRotas: string[],
  motivo: "loader_ready" | "routed_ok"
): Promise<{ em: string | null } | null> {
  if (idsRotas.length === 0) return { em: null };
  const { data, error } = await supabase
    .from("routed_checkout_fallbacks")
    .select("created_at")
    .in("route_config_id", idsRotas)
    .eq("reason", motivo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    log(motivo === "loader_ready" ? "o script da vitrine" : "os carrinhos roteados", error);
    return null;
  }
  return { em: data?.created_at ? String(data.created_at) : null };
}

// ---------------------------------------------------------------------------
// O guia pronto: os dois caminhos montados, o escolhido e se foi dispensado.
// A tela /setup usa tudo; o menu lateral (sidebar-data.tsx) usa so o caminho
// escolhido (feitos, total, proximo, completo), e o topo do Lucro pode usar o
// mesmo.
// ---------------------------------------------------------------------------

export interface GuiaDaConta {
  caminho: CaminhoGuia;
  guias: Record<CaminhoGuia, Guia>;
  /** O lojista dispensou o guia do menu e do Lucro (esta tela continua). */
  dispensado: boolean;
  /** A conta tem rota: decide o caminho quando nao ha escolha guardada. */
  temRota: boolean;
}

export const lerGuiaDaConta = cache(async (caminhoDaUrl?: string | null): Promise<GuiaDaConta> => {
  const [foto, jar] = await Promise.all([lerFotoGuia(), cookies()]);
  const agora = new Date();
  // Leitura de rota que falhou nao decide o caminho: cai no direto, o mais comum.
  const temRota = (foto.rotas?.length ?? 0) > 0;
  return {
    caminho: caminhoDoGuia(caminhoDaUrl, jar.get(COOKIE_GUIA_CAMINHO)?.value, temRota),
    guias: {
      direto: montarGuia(foto, "direto", agora),
      vitrine: montarGuia(foto, "vitrine", agora),
    },
    dispensado: jar.get(COOKIE_GUIA_DISPENSADO)?.value === "1",
    temRota,
  };
});
