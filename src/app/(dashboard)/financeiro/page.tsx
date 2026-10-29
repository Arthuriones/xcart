import { Suspense } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ROTA_CONECTAR_OPERACAO, ROTULO_CONECTAR_OPERACAO } from "@/lib/conectar-operacao";
import { filtroResolvido, lerComparacao, lerFiltroGlobal } from "@/lib/filtro-global";
import { TODAS, type Periodo } from "@/lib/financeiro/tipos";
import { getFinanceiro } from "@/lib/financeiro/queries";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarPorCampanha } from "@/lib/leitura/por-campanha";
import { montarPorProduto } from "@/lib/leitura/por-produto";
import { montarSerieDiaria } from "@/lib/leitura/serie-diaria";
import { montarConexao } from "@/lib/financeiro/painel";
import { createClient } from "@/lib/supabase/server";
import { ErroLucro } from "./erro-lucro";
import { EsqueletoLucro } from "./esqueleto";
import { FinanceiroScreen, type ConexaoLucro, type ExtrasLucro } from "./financeiro-screen";

export const dynamic = "force-dynamic";

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * stores.uninstalled_at das lojas do filtro (id -> ISO), so as marcadas. A
 * busca de pedidos pula loja desinstalada, entao sem isto ela some calada do
 * Lucro. Erro LANCA: quem chama segue sem a marca (o erro da busca ainda pega
 * a loja antiga, que nao tem a marca do webhook).
 */
async function lerDesinstaladas(): Promise<Record<string, string>> {
  const { lojaIds } = await filtroResolvido();
  if (lojaIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.from("stores").select("id, uninstalled_at").in("id", lojaIds);
  if (error) throw new Error(error.message);
  const saida: Record<string, string> = {};
  for (const l of (data ?? []) as { id: string; uninstalled_at: string | null }[]) {
    if (l.uninstalled_at) saida[String(l.id)] = l.uninstalled_at;
  }
  return saida;
}

/**
 * Le tudo no servidor, numa ida so: o calculo de sempre (getFinanceiro) e, em
 * paralelo, as linhas cruas para as leituras novas (serie do periodo anterior,
 * produto, campanha). Se as novas falharem, a tela abre igual e so as partes
 * que dependem delas mostram o erro.
 */
async function Conteudo() {
  const comparacao = await lerComparacao();
  const [principal, base, marcas] = await Promise.allSettled([
    getFinanceiro(),
    lerBaseLucro(),
    lerDesinstaladas(),
  ]);

  if (principal.status === "rejected") {
    console.error("[lucro] calculo", principal.reason);
    // Erro de banco aparece; nunca vira zero. Zero diria "nao vendeu".
    return <ErroLucro titulo="Não conseguimos carregar o Dashboard" detalhe={mensagem(principal.reason)} />;
  }
  const dados = principal.value;
  if (dados.vazio) return <SemLojas />;

  let extras: ExtrasLucro | null = null;
  let erroExtras: string | null = null;
  if (base.status === "rejected") {
    console.error("[lucro] leituras novas", base.reason);
    erroExtras = mensagem(base.reason);
  } else if (base.value) {
    try {
      const b = base.value;
      extras = {
        serie: montarSerieDiaria(b.entrada, {
          porLoja: dados.filtro.lojaId === TODAS && dados.lojaIds.length + dados.checkoutIds.length >= 2,
        }),
        produtos: montarPorProduto(b.entrada),
        // Falha so no gasto por campanha: so a aba Campanha mostra o erro.
        campanhas: b.erroCampanha
          ? null
          : montarPorCampanha({
              contas: b.contas,
              gastos: b.gastosCampanha,
              cambio: b.entrada.cambio,
              moeda: b.entrada.moeda,
              intervalo: b.entrada.intervalos.atual,
              lojaIds: [...b.lojaIds, ...b.checkoutIds],
            }),
      };
      if (b.erroCampanha) erroExtras = b.erroCampanha;
    } catch (e) {
      console.error("[lucro] montagem", e);
      erroExtras = mensagem(e);
    }
  }
  if (marcas.status === "rejected") console.error("[lucro] lojas desinstaladas", marcas.reason);

  // Contas ativas das lojas (e checkouts) do filtro. getFinanceiro le a MESMA
  // base (memorizada): se ele abriu, ela tambem. Sem ela, nada de inventar.
  // A mesma regra da rota do app (src/lib/financeiro/painel.ts).
  const conexao: ConexaoLucro = montarConexao(
    dados,
    base.status === "fulfilled" && base.value ? base.value.contas : null,
    marcas.status === "fulfilled" ? marcas.value : {}
  );

  return (
    <FinanceiroScreen
      dados={dados}
      comparacao={comparacao}
      extras={extras}
      erroExtras={erroExtras}
      conexao={conexao}
    />
  );
}

/** O vazio do mockup: borda tracejada, o icone de loja e um CTA so. */
function SemLojas() {
  return (
    <div className="flex min-h-105 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong px-4 py-12 text-center">
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-card border border-border text-t2"
      >
        <Store className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="mt-1 text-overlay text-ink">Conecte uma loja ou um checkout</h2>
      <p className="max-w-[46ch] text-body text-t2 text-pretty">
        Cruzamos os pedidos (ou as comissões) com o gasto do Meta e do Google.
      </p>
      <Link href={ROTA_CONECTAR_OPERACAO} className={`mt-1.5 ${buttonVariants({})}`}>
        {ROTULO_CONECTAR_OPERACAO}
      </Link>
    </div>
  );
}

/** O periodo e um dia so? Para o esqueleto ter a forma do painel no celular. */
function umDiaDoPeriodo(p: Periodo): boolean {
  return typeof p === "string" ? p === "hoje" || p === "ontem" : p.desde === p.ate;
}

export default async function FinanceiroPage() {
  // So cookies (sem banco): servem de key para o Suspense. Trocar loja,
  // periodo, moeda ou comparacao mostra o esqueleto de novo em vez de deixar o
  // numero velho na tela.
  const [filtro, comparacao] = await Promise.all([lerFiltroGlobal(), lerComparacao()]);
  // Sem PageHeader: o titulo da tela fica na barra do topo da casca.
  return (
    <Suspense
      key={JSON.stringify({ filtro, comparacao })}
      fallback={<EsqueletoLucro umDia={umDiaDoPeriodo(filtro.periodo)} />}
    >
      <Conteudo />
    </Suspense>
  );
}
