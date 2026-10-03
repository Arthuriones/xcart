import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { billingEnforced } from "@/lib/billing/credits";
import { estadoConexao, SELO_CONEXAO } from "./lojas-estado";

// ============================================================================
// Leitura do assistente "Importar de uma loja Shopify" (/clone/shopify). So
// LEITURA, pela sessao (RLS), sem Shopify:
//   - as lojas do usuario, com o estado da conexao (o mesmo da tela Lojas) e
//     o que a importacao usa delas: nicho (sem nicho a traducao nao roda),
//     idioma e logo;
//   - o saldo de creditos, para a estimativa da Revisao.
//
// Antes a tela usava getPickerStores, que engolia o erro e devolvia lista
// vazia: falha de banco virava "Nenhuma loja conectada". Aqui erro na lista de
// lojas LANCA (a pagina mostra o erro); saldo e conexao sao parte, nao o todo
// -- se falham, viram null e a tela diz "—".
// ============================================================================

export interface LojaImportar {
  id: string;
  nome: string;
  dominio: string;
  /** Sem nicho a IA de texto (traducao) nao roda na loja. */
  temNicho: boolean;
  /** Idioma da IA na loja (pt-BR, en, es...); null = nao configurado. */
  idioma: string | null;
  temLogo: boolean;
  /** null = o estado da conexao nao veio (leitura parcial). */
  conexao: { semAcesso: boolean; tom: "ok" | "warn" | "err" | "neutral"; texto: string } | null;
}

export interface DadosImportar {
  lojas: LojaImportar[];
  /** Creditos de IA na conta; null = a leitura falhou. */
  saldo: number | null;
  /** A conta desconta credito pela IA de imagem hoje. */
  cobrando: boolean;
}

type LinhaLoja = {
  id: string;
  name: string | null;
  shop_domain: string;
  niche: string | null;
  target_language: string | null;
  logo_path: string | null;
  uninstalled_at: string | null;
};

type LinhaSync = {
  store_id: string;
  ultimo_erro: string | null;
  ultimo_erro_tipo: "negado" | "falhou" | null;
  ultimo_sync_ok_em: string | null;
  carga_inicial_ok: boolean | null;
};

export async function lerImportarShopify(): Promise<DadosImportar> {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  const cobrando = billingEnforced();
  if (!user) return { lojas: [], saldo: null, cobrando };

  const [lojas, perfil] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, shop_domain, niche, target_language, logo_path, uninstalled_at")
      .eq("user_id", user.id)
      // Mais nova primeiro: a mesma ordem dos seletores de antes.
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("ai_credits").eq("id", user.id).maybeSingle(),
  ]);
  if (lojas.error) throw new Error(`Falha ao ler as lojas: ${lojas.error.message}`);

  const linhas = (lojas.data ?? []) as LinhaLoja[];
  const ids = linhas.map((l) => l.id);

  let estados: Map<string, LinhaSync> | null = new Map();
  if (ids.length > 0) {
    const sync = await supabase
      .from("fin_sync_state")
      .select("store_id, ultimo_erro, ultimo_erro_tipo, ultimo_sync_ok_em, carga_inicial_ok")
      .in("store_id", ids);
    if (sync.error) {
      console.error("[importar-shopify] estado da conexao", sync.error.message);
      estados = null;
    } else {
      estados = new Map(((sync.data ?? []) as LinhaSync[]).map((s) => [s.store_id, s]));
    }
  }

  const saldoBruto = perfil.error ? null : (perfil.data?.ai_credits as number | null | undefined);
  if (perfil.error) console.error("[importar-shopify] saldo de creditos", perfil.error.message);

  return {
    cobrando,
    saldo: typeof saldoBruto === "number" && Number.isFinite(saldoBruto) ? saldoBruto : null,
    lojas: linhas.map((l): LojaImportar => {
      let conexao: LojaImportar["conexao"] = null;
      if (estados) {
        const s = estados.get(l.id);
        const e = estadoConexao({
          desinstaladaEm: l.uninstalled_at,
          sync: s
            ? {
                ultimoErro: s.ultimo_erro,
                ultimoErroTipo: s.ultimo_erro_tipo,
                ultimoSyncOkEm: s.ultimo_sync_ok_em,
                cargaInicialOk: Boolean(s.carga_inicial_ok),
              }
            : null,
        });
        conexao = { semAcesso: e.semAcesso, ...SELO_CONEXAO[e.chave] };
      }
      return {
        id: l.id,
        nome: l.name?.trim() || l.shop_domain,
        dominio: l.shop_domain,
        temNicho: Boolean(l.niche?.trim()),
        idioma: l.target_language?.trim() || null,
        temLogo: Boolean(l.logo_path),
        conexao,
      };
    }),
  };
}
