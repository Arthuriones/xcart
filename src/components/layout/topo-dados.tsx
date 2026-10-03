import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido, lerComparacao } from "@/lib/filtro-global";
import { contarAlertasAbertos } from "@/lib/leitura/notificacoes";
import {
  FUSO_RELATORIO_PADRAO,
  PERIODOS,
  TODAS,
  diaNoFuso,
  intervaloDoPeriodo,
} from "@/lib/financeiro/tipos";
import type { DadosContexto, LojaContexto } from "./seletor-global";
import { TopNav } from "./top-nav";

/**
 * Busca no servidor o que o topo precisa: lojas, filtro gravado em cookie,
 * fuso do relatorio e quantos alertas estao abertos. So banco, nunca Shopify.
 *
 * Fica fora do layout pelo mesmo motivo de sidebar-data.tsx: o layout
 * renderiza isto dentro de <Suspense>, e a tela nao espera estas consultas.
 *
 * Erro de leitura some (null) em vez de derrubar o layout: sem barra de
 * contexto a pagina continua usando o filtro do cookie, e mostra o proprio
 * erro de banco se for o caso, porque le as mesmas lojas.
 */
export async function TopoDados() {
  const [contexto, alertas] = await Promise.all([
    lerContexto().catch(() => null),
    contarAlertasAbertos().catch(() => null),
  ]);
  return <TopNav contexto={contexto} alertasAbertos={alertas} />;
}

async function lerContexto(): Promise<DadosContexto> {
  const [{ filtro, lojas }, comparacao, user] = await Promise.all([
    filtroResolvido(),
    lerComparacao(),
    getCurrentUser(),
  ]);

  // fin_sync_state traz o fuso real da loja (Shop.ianaTimezone) e se a
  // Shopify nega ler os pedidos -- a loja antiga que vai para "Sem acesso".
  const estados = new Map<string, { fuso: string | null; negado: boolean }>();
  if (user && lojas.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("fin_sync_state")
      .select("store_id, fuso, ultimo_erro_tipo")
      .eq("user_id", user.id);
    for (const e of (data ?? []) as {
      store_id: string;
      fuso: string | null;
      ultimo_erro_tipo: string | null;
    }[]) {
      estados.set(String(e.store_id), { fuso: e.fuso, negado: e.ultimo_erro_tipo === "negado" });
    }
  }

  const lojasContexto: LojaContexto[] = lojas.map((l) => ({
    ...l,
    semAcesso: estados.get(l.id)?.negado ?? false,
  }));

  // O mesmo fuso que o Lucro usa para o "hoje": o da loja escolhida, ou o de
  // Sao Paulo com todas as lojas (ver getFinanceiro).
  const fuso =
    (filtro.lojaId !== TODAS && estados.get(filtro.lojaId)?.fuso) || FUSO_RELATORIO_PADRAO;
  const hoje = diaNoFuso(new Date(), fuso);
  const intervalos = Object.fromEntries(
    PERIODOS.map((p) => [p.id, intervaloDoPeriodo(p.id, hoje)])
  ) as DadosContexto["intervalos"];

  return { lojas: lojasContexto, filtro, comparacao, fuso, intervalos, hoje };
}

/** O topo enquanto os dados nao chegaram: mesma altura, sem pulo. */
export function TopoEsqueleto() {
  return (
    <>
      <div aria-hidden className="sticky top-0 z-30 hidden h-15 border-b border-border bg-surface md:block" />
      <div aria-hidden className="sticky top-0 z-30 h-14 border-b border-border bg-surface md:hidden" />
    </>
  );
}
