import type { Comparacao } from "@/components/layout/contexto";
import { montarPainel, type ConexaoLucro, type DadosLucro } from "@/lib/financeiro/painel";
import { pontoDeLinha, type SerieDiaria } from "@/lib/leitura/serie-diaria";
import type { PorProduto } from "@/lib/leitura/por-produto";
import type { LinhaCampanha } from "@/lib/leitura/por-campanha";
import { Cascata } from "./cascata";
import { ComoCalculamos } from "./como-calculamos";
import { DetalharPor } from "./detalhar-por";
import { PainelLucro } from "./painel-lucro";
import { FaixaPendencias, LeituraDoLucro, PuxarAgoraProvider } from "./pendencias";

// ============================================================================
// A tela Dashboard (design "design novo/Panda Track - App.dc.html"), montada no
// servidor: a faixa de pendencias (uma linha: o aviso de custo ou a pendencia
// mais grave), de quando sao os pedidos e o gasto com o "Puxar agora", o
// destaque (abas das metricas e grafico de barras) ao lado da composicao do lucro, a faixa de
// KPIs, "Detalhar por" e "Como calculamos". So a faixa, a leitura, o painel do
// destaque e as abas sao client.
//
// `dados` vem de getFinanceiro (o calculo de sempre). `extras` sao as leituras
// novas (serie do periodo anterior, produto, campanha): se falharem, a tela
// abre igual e so as partes que dependem delas mostram o erro.
//
// Indicadores, pendencias, leitura e rotulos saem de montarPainel
// (src/lib/financeiro/painel.ts), a mesma montagem do app do celular.
// ============================================================================

export type { ConexaoLucro, DadosLucro };

export interface ExtrasLucro {
  serie: SerieDiaria;
  produtos: PorProduto;
  /** null = o gasto por campanha nao foi lido (so a aba Campanha mostra o erro). */
  campanhas: LinhaCampanha[] | null;
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
  const r = dados.resultado;
  // Relativo ao momento em que a pagina foi montada (force-dynamic): cada
  // visita, troca de filtro ou "Puxar agora" calcula de novo.
  const p = montarPainel(dados, comparacao, conexao, instante());
  const moeda = p.moeda;
  const semAcesso = new Set(p.lojasSemAcesso);
  // porDia vem do mais novo para o mais antigo; o grafico quer o contrario.
  const pontos = [...r.porDia].reverse().map(pontoDeLinha);
  const lucroPorLoja = new Map((extras?.serie.porLoja ?? []).map((l) => [l.storeId, l.lucro]));

  return (
    <div data-largura="total" className="@container mx-auto flex w-full max-w-330 flex-col gap-4 min-[760px]:gap-6">
      {/* Um "Puxar agora" so: o da faixa e o da leitura travam juntos. */}
      <PuxarAgoraProvider>
        <FaixaPendencias custo={p.custo} itens={p.pendencias} />

        {/* Margem negativa: a linha fica a 12px do destaque, como cabecalho dele. */}
        <div className="-mb-1 min-[760px]:-mb-3">
          <LeituraDoLucro
            rotulo={p.leitura}
            iso={p.lidoEm === null ? null : new Date(p.lidoEm).toISOString()}
            hora={p.horaLeitura}
          />
        </div>
      </PuxarAgoraProvider>

      <PainelLucro
        moeda={moeda}
        principal={p.principal}
        celulas={p.celulas}
        veredito={p.veredito}
        atual={pontos}
        anterior={extras ? extras.serie.anterior : null}
        comparacao={p.comparacao}
        umDia={p.umDia}
        rotuloPeriodo={p.rotuloPeriodo}
        rotuloAnterior={p.rotuloAnterior}
        // So para o leitor de tela do grafico: na tela, a barra do topo ja diz.
        contexto={p.contexto}
        rotuloReceita={p.rotuloReceita}
        rotuloLucro={p.rotuloLucro}
        rotuloPedidos={p.rotuloPedidos}
        composicao={
          <Cascata
            atual={r.atual}
            moeda={moeda}
            contraEntrega={p.contraEntrega}
            devolucoes={p.codShopify}
            venda={Boolean(p.venda)}
          />
        }
      />

      <DetalharPor
        moeda={moeda}
        intervalo={r.intervalos.atual}
        rotuloLoja={p.rotuloLoja}
        mostrarLoja={p.mostrarLoja}
        lojas={r.porLoja.map((l) => ({
          linha: l,
          semAcesso: semAcesso.has(l.storeId),
          lucroPorDia: lucroPorLoja.get(l.storeId) ?? null,
        }))}
        total={r.atual}
        dias={r.porDia}
        produtos={extras ? extras.produtos : null}
        campanhas={extras ? extras.campanhas : null}
        erroExtras={erroExtras}
      />

      <ComoCalculamos contraEntrega={p.codShopify} checkout={p.comissao} venda={Boolean(p.venda)} />

      <p className="text-label text-t3 text-pretty">
        Lucro estimado, não contábil. O faturamento inclui o frete cobrado. Pedidos sincronizam a cada 15 minutos;{" "}
        {p.fusoNota}.
      </p>
    </div>
  );
}
