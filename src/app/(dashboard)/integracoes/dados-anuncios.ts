import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listarContasDoUsuario } from "@/lib/ads/contas";
import { filtroResolvido } from "@/lib/filtro-global";
import { lerGastoPorConta } from "@/lib/leitura/gasto-por-conta";
import { lerDestinosDeCompra, type DestinoDeCompra } from "@/lib/leitura/integracoes";
import { ROTULO_PERIODO, rotuloIntervalo } from "@/components/layout/contexto";
import {
  FUSO_RELATORIO_PADRAO,
  TODAS,
  diaNoFuso,
  intervaloDoPeriodo,
  type ContaAnuncioResumo,
  type LojaDoSeletor,
  type Plataforma,
} from "@/lib/financeiro/tipos";
import { gastoNaTela, type GastoNaTela } from "./regras";

// ============================================================================
// O que Meta e Google leem no servidor: contas (sem segredo, so "tem token"),
// lojas, fuso de cada loja, gasto por conta e os destinos de conversao. So
// banco -- nada de Meta ou Google na renderizacao.
//
// Cada bloco que nao e a lista de contas falha sozinho (gasto, fuso,
// destinos): a tela mostra o aviso daquele bloco e o resto continua.
// ============================================================================

export interface DadosAnuncios {
  /** Contas desta plataforma que a tela mostra (filtradas pela loja da barra). */
  contas: ContaAnuncioResumo[];
  /** Contas desta plataforma, sem filtro de loja (o token e um so). */
  daPlataforma: ContaAnuncioResumo[];
  lojas: LojaDoSeletor[];
  /** Loja escolhida na barra do topo, ou null com todas. */
  lojaFiltrada: LojaDoSeletor | null;
  /** store_id -> fuso IANA da loja (do sync de pedidos). */
  fusosLoja: Record<string, string>;
  erroFuso: string | null;
  /** Fuso dos horarios da tela (o do relatorio). */
  fuso: string;
  moeda: string;
  /** "Últimos 30 dias (03/09–02/10)". */
  periodo: string;
  gastos: Record<string, GastoNaTela>;
  erroGasto: string | null;
  destinos: DestinoDeCompra[];
  erroDestinos: string | null;
  /** Perfis OAuth conectados (Meta/Google). */
  conexoes?: ConexaoOAuthResumo[];
  /** Relogio do servidor: o mesmo no HTML e na hidratacao. */
  agoraMs: number;
}

export interface ConexaoOAuthResumo {
  id: string;
  plataforma: string;
  external_user_id: string;
  nome: string | null;
  email: string | null;
  foto_url: string | null;
  token_expira_em: string | null;
  created_at: string;
}

async function fusosDasLojas(ids: string[]): Promise<{ fusos: Record<string, string>; erro: string | null }> {
  if (ids.length === 0) return { fusos: {}, erro: null };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fin_sync_state").select("store_id, fuso").in("store_id", ids);
  if (error) return { fusos: {}, erro: error.message };
  const fusos: Record<string, string> = {};
  for (const r of (data || []) as { store_id: string; fuso: string | null }[]) {
    if (r.fuso) fusos[String(r.store_id)] = r.fuso;
  }
  return { fusos, erro: null };
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function carregarAnuncios(
  plataforma: Plataforma
): Promise<{ ok: true; dados: DadosAnuncios } | { ok: false; erro: string }> {
  let todas: ContaAnuncioResumo[];
  let filtroLojas: Awaited<ReturnType<typeof filtroResolvido>>;
  try {
    [todas, filtroLojas] = await Promise.all([listarContasDoUsuario(), filtroResolvido()]);
  } catch (e) {
    return { ok: false, erro: mensagem(e) };
  }
  const { filtro, lojas } = filtroLojas;
  const agora = new Date();

  const { fusos, erro: erroFuso } = await fusosDasLojas(lojas.map((l) => l.id));
  const lojaFiltrada = filtro.lojaId !== TODAS ? (lojas.find((l) => l.id === filtro.lojaId) ?? null) : null;
  // O mesmo "hoje" do Lucro: o da loja escolhida, ou Sao Paulo com todas.
  const fuso = (lojaFiltrada && fusos[lojaFiltrada.id]) || FUSO_RELATORIO_PADRAO;
  const intervalo = intervaloDoPeriodo(filtro.periodo, diaNoFuso(agora, fuso)).atual;

  const daPlataforma = todas.filter((c) => c.plataforma === plataforma);
  // Com uma loja escolhida: as contas dela e as que ainda nao tem loja (sao
  // as que pedem para ser ligadas).
  const contas = lojaFiltrada
    ? daPlataforma.filter((c) => c.store_id === lojaFiltrada.id || !c.store_id)
    : daPlataforma;

  const [gasto, destinos] = await Promise.all([
    lerGastoPorConta({
      contas: contas.map((c) => ({ id: c.id, fuso: c.fuso })),
      intervalo,
      moeda: filtro.moeda,
      agora,
    }).then(
      (m) => ({ m, erro: null as string | null }),
      (e) => ({ m: new Map(), erro: mensagem(e) })
    ),
    lerDestinosDeCompra(plataforma).then(
      (d) => ({ d, erro: null as string | null }),
      (e) => ({ d: [] as DestinoDeCompra[], erro: mensagem(e) })
    ),
  ]);

  const gastos: Record<string, GastoNaTela> = {};
  for (const c of contas) gastos[c.id] = gastoNaTela(gasto.m.get(c.id), filtro.moeda);

  let conexoes: ConexaoOAuthResumo[] = [];
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: conRows } = await supabase
        .from("ad_connections")
        .select("id, plataforma, external_user_id, nome, email, foto_url, token_expira_em, created_at")
        .eq("user_id", user.id)
        .eq("plataforma", plataforma)
        .order("created_at", { ascending: false });
      conexoes = (conRows || []) as ConexaoOAuthResumo[];
    }
  } catch {
    conexoes = [];
  }

  return {
    ok: true,
    dados: {
      contas,
      daPlataforma,
      conexoes,
      lojas,
      lojaFiltrada,
      fusosLoja: fusos,
      erroFuso,
      fuso,
      moeda: filtro.moeda,
      periodo: `${ROTULO_PERIODO[filtro.periodo]} (${rotuloIntervalo(intervalo)})`,
      gastos,
      erroGasto: gasto.erro,
      destinos: lojaFiltrada ? destinos.d.filter((d) => d.storeId === lojaFiltrada.id) : destinos.d,
      erroDestinos: destinos.erro,
      agoraMs: agora.getTime(),
    },
  };
}
