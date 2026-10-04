import { ROTULO_PERIODO, rotuloIntervalo, type Comparacao } from "@/components/layout/contexto";
import { TODAS } from "@/lib/financeiro/tipos";
import type { DadosFinanceiro } from "@/lib/financeiro/queries";
import { pontoDeLinha, type SerieDiaria } from "@/lib/leitura/serie-diaria";
import type { PorProduto } from "@/lib/leitura/por-produto";
import type { LinhaCampanha } from "@/lib/leitura/por-campanha";
import { Cascata } from "./cascata";
import { ComoCalculamos } from "./como-calculamos";
import { DetalharPor } from "./detalhar-por";
import { GraficoFaturamento } from "./grafico-faturamento";
import { IndicadoresKpi, IndicadoresTopo, LinhaAtualizado, type BaseIndicadores } from "./indicadores";
import { haQuanto, montarDicas, montarPendencias, nomeDaLoja, situacaoDasLojas, temMovimento } from "./lucro-dados";
import { Pendencias } from "./pendencias";
import { PorLoja } from "./por-loja";

// ============================================================================
// A tela Dashboard (mockup "design novo/2.0/Dashboard.dc.html"), montada no
// servidor: pendencias (o unico bloco de aviso), 5 cartoes de resumo, grafico
// de faturamento com os custos do periodo ao lado, os KPIs, "Por loja",
// "Detalhar por" e "Como calculamos". So o grafico e as abas sao client.
//
// `dados` vem de getFinanceiro (o calculo de sempre). `extras` sao as leituras
// novas (serie do periodo anterior, produto, campanha): se falharem, a tela
// abre igual e so as partes que dependem delas mostram o erro.
// ============================================================================

export type DadosLucro = Extract<DadosFinanceiro, { vazio: false }>;

export interface ExtrasLucro {
  serie: SerieDiaria;
  produtos: PorProduto;
  /** null = o gasto por campanha nao foi lido (so a aba Campanha mostra o erro). */
  campanhas: LinhaCampanha[] | null;
}

/** O que a tela sabe das lojas e contas alem do calculo (page.tsx). */
export interface ConexaoLucro {
  /** stores.uninstalled_at das lojas marcadas (id -> ISO). */
  desinstaladas: Record<string, string>;
  /** Lojas com conta de anuncio ativa. null = nao deu para ler. */
  lojasComConta: string[] | null;
  /** Ate quando pedidos e gasto estao lidos (ms). null = nada lido ainda. */
  atualizadoEm: number | null;
}

/** O relogio do servidor, lido fora do corpo do componente. */
function instante(): number {
  return Date.now();
}

export function FinanceiroScreen({
  dados,
  comparacao,
  extras,
  erroExtras,
  conexao,
}: {
  dados: DadosLucro;
  comparacao: Comparacao;
  extras: ExtrasLucro | null;
  erroExtras: string | null;
  conexao: ConexaoLucro;
}) {
  const { resultado: r, filtro } = dados;
  const moeda = r.moeda;
  const lojaEscolhida = filtro.lojaId !== TODAS ? dados.lojas.find((l) => l.id === filtro.lojaId) : undefined;
  const rotuloLoja = lojaEscolhida ? nomeDaLoja(lojaEscolhida) : "Todas as lojas";
  // So para o leitor de tela do grafico: na tela, a barra do topo ja diz.
  const contexto = `${rotuloLoja} · ${ROTULO_PERIODO[filtro.periodo]} (${rotuloIntervalo(r.intervalos.atual)}) · ${moeda}`;

  const situacoes = situacaoDasLojas(dados.lojaIds, dados.estados, conexao.desinstaladas);
  const semAcesso = (id: string) => {
    const s = situacoes.get(id)?.situacao;
    return s === "desinstalada" || s === "sem-acesso";
  };
  const pendencias = montarPendencias({
    lojas: dados.lojas,
    lojaIds: dados.lojaIds,
    estados: dados.estados,
    contas: dados.contas,
    avisos: r.avisos,
    coberturaCusto: r.atual.coberturaCusto,
    porLoja: r.porLoja.map((l) => ({ storeId: l.storeId, receita: l.receita, pedidos: l.pedidos })),
    desinstaladas: conexao.desinstaladas,
    lojasComConta: conexao.lojasComConta,
  });

  // Relativo ao momento em que a pagina foi montada (force-dynamic): cada
  // visita ou troca de filtro calcula de novo.
  const atualizado = conexao.atualizadoEm === null ? null : haQuanto(conexao.atualizadoEm, instante());

  // porDia vem do mais novo para o mais antigo; o grafico quer o contrario.
  const pontos = [...r.porDia].reverse().map(pontoDeLinha);
  const lucroPorLoja = new Map((extras?.serie.porLoja ?? []).map((l) => [l.storeId, l.lucro]));
  const mostrarLoja = filtro.lojaId === TODAS && dados.lojaIds.length >= 2;

  const comparando = comparacao === "anterior";
  const semBase = comparando && !temMovimento(r.anterior);
  const base: BaseIndicadores = {
    moeda,
    atual: r.atual,
    anterior: r.anterior,
    compara: comparando && !semBase,
    dicas: montarDicas(r.avisos, r.atual.coberturaCusto),
  };

  return (
    <div className="flex flex-col gap-6">
      <Pendencias itens={pendencias} />

      <div className="flex flex-col gap-3.5">
        <LinhaAtualizado
          atualizado={
            atualizado && conexao.atualizadoEm !== null
              ? { texto: atualizado, iso: new Date(conexao.atualizadoEm).toISOString() }
              : null
          }
          semBase={semBase}
          rotuloAnterior={rotuloIntervalo(r.intervalos.anterior)}
        />
        <IndicadoresTopo {...base} />
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <GraficoFaturamento pontos={pontos} moeda={moeda} contexto={contexto} />
          <Cascata atual={r.atual} moeda={moeda} />
        </div>
        <IndicadoresKpi {...base} />
        {mostrarLoja && <PorLoja lojas={r.porLoja} moeda={moeda} />}
      </div>

      <DetalharPor
        moeda={moeda}
        intervalo={r.intervalos.atual}
        rotuloLoja={rotuloLoja}
        mostrarLoja={mostrarLoja}
        lojas={r.porLoja.map((l) => ({
          linha: l,
          semAcesso: semAcesso(l.storeId),
          lucroPorDia: lucroPorLoja.get(l.storeId) ?? null,
        }))}
        total={r.atual}
        dias={r.porDia}
        produtos={extras ? extras.produtos : null}
        campanhas={extras ? extras.campanhas : null}
        erroExtras={erroExtras}
      />

      <ComoCalculamos />
    </div>
  );
}
