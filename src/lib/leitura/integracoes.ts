import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { listarLojasDoUsuario } from "@/lib/filtro-global";
import { destinosParaTela } from "@/lib/tracking/destinos";
import type { Plataforma, RegraAlerta } from "@/lib/financeiro/tipos";

// ============================================================================
// Leituras novas da tela Integracoes. So SELECT, nada de API externa.
//
// - lerResumoIntegracoes: o estado de cada plataforma no menu da tela
//   (ad_accounts, stores, fin_sync_state, alerta_config, mcp_tokens), pela
//   sessao (RLS). Cada parte falha sozinha: o menu mostra "—" naquela e segue.
// - lerConexaoDasLojas: lojas e a ultima leitura de pedidos (stores +
//   fin_sync_state), pela sessao.
// - lerDestinosDeCompra: os destinos de conversao (pixel do Meta, AW- do
//   Google) que o rastreamento ja tem, e os alertas abertos deles. Os destinos
//   vem de destinosParaTela (src/lib/tracking/destinos.ts, chamado sem
//   alteracao) com as lojas da SESSAO -- nunca loja de outro usuario. O token
//   nao sai daqui: so "tem token".
// ============================================================================

export interface ContaResumida {
  plataforma: Plataforma;
  store_id: string | null;
  ativo: boolean;
  ultimo_erro: string | null;
}

export interface ResumoIntegracoes {
  contas: ContaResumida[] | null;
  lojas: { total: number; semAcesso: number } | null;
  telegram: boolean | null;
  tokensClaude: number | null;
}

async function ou<T>(promessa: PromiseLike<T>): Promise<T | null> {
  try {
    return await promessa;
  } catch {
    return null;
  }
}

export async function lerResumoIntegracoes(): Promise<ResumoIntegracoes> {
  const user = await getCurrentUser();
  if (!user) return { contas: [], lojas: { total: 0, semAcesso: 0 }, telegram: false, tokensClaude: 0 };
  const supabase = await createClient();
  const agoraIso = new Date().toISOString();

  const [contas, lojas, sync, config, tokens] = await Promise.all([
    ou(
      supabase
        .from("ad_accounts")
        .select("plataforma, store_id, ativo, ultimo_erro")
        .eq("user_id", user.id)
    ),
    ou(supabase.from("stores").select("id, uninstalled_at").eq("user_id", user.id)),
    ou(supabase.from("fin_sync_state").select("store_id, ultimo_erro_tipo").eq("user_id", user.id)),
    ou(
      supabase
        .from("alerta_config")
        .select("telegram_chat_id")
        .eq("user_id", user.id)
        .maybeSingle()
    ),
    ou(
      supabase
        .from("mcp_tokens")
        .select("id", { count: "exact", head: true })
        .is("revoked_at", null)
        .gt("expires_at", agoraIso)
    ),
  ]);

  let resumoLojas: ResumoIntegracoes["lojas"] = null;
  if (lojas && !lojas.error) {
    const negadas = new Set(
      sync && !sync.error
        ? (sync.data ?? [])
            .filter((s: { ultimo_erro_tipo: string | null }) => s.ultimo_erro_tipo === "negado")
            .map((s: { store_id: string }) => String(s.store_id))
        : []
    );
    const lista = (lojas.data ?? []) as { id: string; uninstalled_at: string | null }[];
    resumoLojas = {
      total: lista.length,
      semAcesso: lista.filter((l) => l.uninstalled_at || negadas.has(String(l.id))).length,
    };
  }

  return {
    contas:
      contas && !contas.error
        ? ((contas.data ?? []) as ContaResumida[]).map((c) => ({
            plataforma: c.plataforma,
            store_id: c.store_id ?? null,
            ativo: Boolean(c.ativo),
            ultimo_erro: c.ultimo_erro ?? null,
          }))
        : null,
    lojas: resumoLojas,
    telegram:
      config && !config.error
        ? Boolean((config.data as { telegram_chat_id?: string | null } | null)?.telegram_chat_id)
        : null,
    tokensClaude: tokens && !tokens.error ? (tokens.count ?? 0) : null,
  };
}

// ---------------------------------------------------------------------------
// Lojas e a conexao de cada uma
// ---------------------------------------------------------------------------

export interface LojaConexao {
  id: string;
  nome: string;
  dominio: string;
  desinstaladaEm: string | null;
  sync: {
    ultimoErroTipo: "negado" | "falhou" | null;
    ultimoErro: string | null;
    ultimoSyncOkEm: string | null;
  } | null;
}

/** Lojas do usuario com a ultima leitura de pedidos. Erro de banco LANCA. */
export async function lerConexaoDasLojas(): Promise<LojaConexao[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const [lojas, sync] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, shop_domain, uninstalled_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("fin_sync_state")
      .select("store_id, ultimo_erro_tipo, ultimo_erro, ultimo_sync_ok_em")
      .eq("user_id", user.id),
  ]);
  if (lojas.error) throw new Error(`Falha ao ler as lojas: ${lojas.error.message}`);
  if (sync.error) throw new Error(`Falha ao ler a leitura de pedidos: ${sync.error.message}`);

  const porLoja = new Map(
    (sync.data ?? []).map(
      (s: {
        store_id: string;
        ultimo_erro_tipo: "negado" | "falhou" | null;
        ultimo_erro: string | null;
        ultimo_sync_ok_em: string | null;
      }) => [
        String(s.store_id),
        {
          ultimoErroTipo: s.ultimo_erro_tipo ?? null,
          ultimoErro: s.ultimo_erro ?? null,
          ultimoSyncOkEm: s.ultimo_sync_ok_em ?? null,
        },
      ]
    )
  );

  return (
    (lojas.data ?? []) as {
      id: string;
      name: string | null;
      shop_domain: string | null;
      uninstalled_at: string | null;
    }[]
  ).map((l) => {
    const dominio = String(l.shop_domain || "");
    return {
      id: String(l.id),
      nome: String(l.name || dominio),
      dominio,
      desinstaladaEm: l.uninstalled_at ?? null,
      sync: porLoja.get(String(l.id)) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Destinos de conversao (o "enviar as compras" de cada plataforma)
// ---------------------------------------------------------------------------

export interface DestinoDeCompra {
  id: string;
  storeId: string;
  /** Apelido do lojista. */
  nome: string | null;
  /** Id do pixel (Meta) ou AW- (Google). */
  conta: string;
  ativo: boolean;
  /** So Meta: o token do CAPI esta gravado. */
  temToken: boolean;
  /** So Google: quantos eventos tem rotulo, e se a compra tem. */
  rotulos: number;
  rotuloCompra: boolean;
  /** So Meta: codigo de teste ligado (o evento nao conta como conversao). */
  modoTeste: boolean;
  /** Alertas abertos deste destino (token recusado, compra que nao chegou). */
  alertas: RegraAlerta[];
}

const REGRAS_DE_DESTINO: RegraAlerta[] = ["meta_capi_token", "envio_falhando"];

/** Destinos de uma plataforma nas lojas do usuario. Erro de banco LANCA. */
export async function lerDestinosDeCompra(plataforma: Plataforma): Promise<DestinoDeCompra[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const lojas = await listarLojasDoUsuario();
  if (lojas.length === 0) return [];

  const supabase = await createClient();
  const [porLoja, alertas] = await Promise.all([
    destinosParaTela(
      createAdminClient(),
      lojas.map((l) => l.id)
    ),
    supabase
      .from("alertas")
      .select("store_id, regra, chave")
      .eq("user_id", user.id)
      .is("resolvido_em", null)
      .in("regra", REGRAS_DE_DESTINO),
  ]);
  if (alertas.error) throw new Error(`Falha ao ler os alertas: ${alertas.error.message}`);

  // A chave dos dois alertas e o id do destino (src/lib/alertas/avaliar.ts).
  const alertasPorDestino = new Map<string, RegraAlerta[]>();
  for (const a of (alertas.data ?? []) as { regra: RegraAlerta; chave: string }[]) {
    const lista = alertasPorDestino.get(String(a.chave)) ?? [];
    lista.push(a.regra);
    alertasPorDestino.set(String(a.chave), lista);
  }

  const saida: DestinoDeCompra[] = [];
  for (const loja of lojas) {
    for (const d of porLoja.get(loja.id) ?? []) {
      if (d.plataforma !== plataforma) continue;
      saida.push({
        id: d.id,
        storeId: loja.id,
        nome: d.nome,
        conta: d.conta,
        ativo: d.ativo,
        temToken: d.temToken,
        rotulos: Object.values(d.labels ?? {}).filter(Boolean).length,
        rotuloCompra: Boolean(d.labels?.purchase),
        modoTeste: Boolean(d.testEventCode),
        alertas: alertasPorDestino.get(d.id) ?? [],
      });
    }
  }
  return saida;
}
