import "server-only";
import { createClient } from "@/lib/supabase/server";
import { carregarCustos, type DadosCustos } from "@/lib/financeiro/custos-queries";
import type { LojaDoSeletor } from "@/lib/financeiro/tipos";
import { estadoConexao, type EstadoConexao } from "./lojas-estado";

// ============================================================================
// Leitura da tela Custos e taxas alem do que carregarCustos ja traz: o estado
// da conexao de cada loja (para separar as que estao sem acesso) e, com
// "Todas as lojas" na barra, os custos de cada loja para mostrar o progresso.
//
// So LEITURA, pela sessao (RLS limita ao dono). O custo continua vindo de
// carregarCustos, chamado sem mudar nada -- uma loja que falha nao derruba as
// outras: o cartao dela diz que nao deu para ler.
// ============================================================================

/**
 * Estado da conexao por loja, pelo que o banco ja sabe (marca de desinstalacao
 * e ultimo erro da sincronizacao de pedidos). null = nao deu para ler: a tela
 * trata todas como ativas em vez de inventar "sem acesso".
 */
export async function lerConexoes(ids: string[]): Promise<Map<string, EstadoConexao> | null> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const [marcas, estados] = await Promise.all([
    supabase.from("stores").select("id, uninstalled_at").in("id", ids),
    supabase
      .from("fin_sync_state")
      .select("store_id, ultimo_erro, ultimo_erro_tipo, ultimo_sync_ok_em, carga_inicial_ok")
      .in("store_id", ids),
  ]);
  if (marcas.error || estados.error) {
    console.error("[custos] conexao das lojas", marcas.error ?? estados.error);
    return null;
  }
  const desinstalada = new Map(
    ((marcas.data ?? []) as { id: string; uninstalled_at: string | null }[]).map((m) => [
      String(m.id),
      m.uninstalled_at,
    ])
  );
  const sync = new Map(
    (
      (estados.data ?? []) as {
        store_id: string;
        ultimo_erro: string | null;
        ultimo_erro_tipo: "negado" | "falhou" | null;
        ultimo_sync_ok_em: string | null;
        carga_inicial_ok: boolean | null;
      }[]
    ).map((e) => [String(e.store_id), e])
  );
  return new Map(
    ids.map((id) => {
      const s = sync.get(id);
      return [
        id,
        estadoConexao({
          desinstaladaEm: desinstalada.get(id) ?? null,
          sync: s
            ? {
                ultimoErro: s.ultimo_erro,
                ultimoErroTipo: s.ultimo_erro_tipo,
                ultimoSyncOkEm: s.ultimo_sync_ok_em,
                cargaInicialOk: Boolean(s.carga_inicial_ok),
              }
            : null,
        }),
      ];
    })
  );
}

export interface CustosDaLoja {
  loja: LojaDoSeletor;
  conexao: EstadoConexao | null;
  /** null = a leitura desta loja falhou (as outras seguem). */
  dados: DadosCustos | null;
}

/** Custos e conexao de cada loja, em paralelo. Nao lanca. */
export async function lerCustosDasLojas(lojas: LojaDoSeletor[]): Promise<CustosDaLoja[]> {
  const [conexoes, ...custos] = await Promise.all([
    lerConexoes(lojas.map((l) => l.id)).catch((e) => {
      console.error("[custos] conexao das lojas", e);
      return null;
    }),
    ...lojas.map((l) =>
      carregarCustos(l.id).catch((e) => {
        console.error(`[custos] loja ${l.id}`, e);
        return null;
      })
    ),
  ]);
  return lojas.map((loja, i) => ({
    loja,
    conexao: conexoes?.get(loja.id) ?? null,
    dados: custos[i] ?? null,
  }));
}
