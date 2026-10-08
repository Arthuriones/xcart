import { Suspense } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CampanhasTela } from "./campanhas-tela";
import type { LinhaCampanha } from "./tipos";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campanhas | xcart",
  description: "Dashboard analítico de campanhas, conjuntos e anúncios de tráfego pago.",
};

async function carregarDadosCampanhas() {
  const supabase = await createClient();
  const user = await getCurrentUser();

  if (!user) {
    return { contas: [], linhas: [], colunasSalvas: [] };
  }

  // 1. Busca contas de anúncio do usuário
  const { data: contasData } = await supabase
    .from("ad_accounts")
    .select("id, nome, plataforma, external_id, status")
    .eq("user_id", user.id)
    .order("nome", { ascending: true });

  const contas = (contasData || []).map((c) => ({
    id: c.id,
    nome: c.nome || `Conta ${c.external_id}`,
    plataforma: c.plataforma,
  }));

  // 2. Busca preferências de colunas do usuário
  const { data: prefData } = await supabase
    .from("user_dashboard_preferences")
    .select("colunas")
    .eq("user_id", user.id)
    .maybeSingle();

  const colunasSalvas = (prefData?.colunas || []) as string[];

  // 3. Busca insights granulares
  const { data: insightsData } = await supabase
    .from("ad_insights_granular")
    .select("*")
    .eq("user_id", user.id)
    .order("data", { ascending: false });

  // Mapeia para LinhaCampanha
  const linhas: LinhaCampanha[] = (insightsData || []).map((row) => {
    const conta = contas.find((c) => c.id === row.ad_account_id);
    return {
      id: row.id,
      objetoId: row.objeto_id,
      nome: row.objeto_nome,
      status: row.objeto_status || "ACTIVE",
      plataforma: row.plataforma as "meta" | "google" | "tiktok",
      nivel: row.nivel as "conta" | "campanha" | "grupo" | "anuncio",
      contaId: row.ad_account_id,
      contaNome: conta?.nome || "Conta de Anúncio",
      campanhaId: row.campanha_id,
      campanhaNome: row.campanha_nome,
      grupoId: row.grupo_id,
      grupoNome: row.grupo_nome,
      tipo: row.tipo || "CBO",
      orcamento: Number(row.orcamento || 0),
      cpaDesejado: row.cpa_desejado ? Number(row.cpa_desejado) : undefined,
      gastos: Number(row.gasto || 0),
      faturamento: Number(row.faturamento || 0),
      custoProduto: Number(row.custo_produto || 0),
      lucro: Number(row.lucro || 0),
      roas: Number(row.roas || 0),
      roi: Number(row.roi || 0),
      margem: Number(row.margem || 0),
      cpa: Number(row.cpa || 0),
      vendas: Number(row.vendas || 0),
      cliques: Number(row.cliques || 0),
      impressoes: Number(row.impressoes || 0),
      cpc: Number(row.cpc || 0),
      cpm: Number(row.cpm || 0),
      ctr: Number(row.ctr || 0),
      ic: Number(row.ic || 0),
      cpi: Number(row.cpi || 0),
      visVideo: Number(row.vis_video || 0),
      vis3s: Number(row.vis_3s || 0),
      retencao75: Number(row.retencao_75 || 0),
      hookRate: Number(row.hook_rate || 0),
      holdRate: Number(row.hold_rate || 0),
      frequencia: Number(row.frequencia || 1),
    };
  });

  return { contas, linhas, colunasSalvas };
}

export default async function CampanhasPage() {
  const { contas, linhas, colunasSalvas } = await carregarDadosCampanhas();

  return (
    <div className="flex flex-col gap-6" data-largura="total">
      {/* Cabeçalho da Tela */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-overlay font-bold text-ink tracking-tight">Campanhas</h1>
          <p className="text-dense text-t2">
            Métricas de performance de tráfego pago por conta, campanha, conjunto e criativo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/integracoes"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surface-2 hover:text-ink transition"
          >
            <Plug className="h-3.5 w-3.5" />
            <span>Gerenciar integrações</span>
          </Link>
        </div>
      </div>

      {contas.length === 0 ? (
        <EmptyState
          icone={<Plug className="h-8 w-8 text-t3" />}
          titulo="Nenhuma conta de anúncio conectada"
          descricao="Conecte seu Meta Ads ou Google Ads em Integrações com 1 clique para acompanhar suas campanhas em tempo real."
          acao={
            <Link href="/integracoes" className={buttonVariants()}>
              Conectar conta de anúncios
            </Link>
          }
          className="min-h-80"
        />
      ) : (
        <Suspense fallback={<div className="text-t2 text-xs py-8">Carregando painel de campanhas...</div>}>
          <CampanhasTela
            linhasIniciais={linhas}
            contas={contas}
            colunasSalvas={colunasSalvas}
          />
        </Suspense>
      )}
    </div>
  );
}
