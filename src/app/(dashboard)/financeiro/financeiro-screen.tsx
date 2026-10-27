import { nomeDoPeriodo, rotuloDoPeriodo, rotuloFuso, rotuloIntervalo, type Comparacao } from "@/components/layout/contexto";
import { TODAS, diaNoFuso } from "@/lib/financeiro/tipos";
import type { DadosFinanceiro } from "@/lib/financeiro/queries";
import { pontoDeLinha, type SerieDiaria } from "@/lib/leitura/serie-diaria";
import type { PorProduto } from "@/lib/leitura/por-produto";
import type { LinhaCampanha } from "@/lib/leitura/por-campanha";
import { Cascata } from "./cascata";
import { ComoCalculamos } from "./como-calculamos";
import { DetalharPor } from "./detalhar-por";
import { montarIndicadores, type BaseIndicadores } from "./indicadores";
import {
  CUSTOS_SEM_CUSTO,
  composicaoCod,
  montarDicas,
  montarPendencias,
  nomeDaLoja,
  porcento,
  rotuloLeitura,
  situacaoDasLojas,
  temMovimento,
  type Pendencia,
} from "./lucro-dados";
import { PainelLucro, type ModoComparacao } from "./painel-lucro";
import { FaixaPendencias, LeituraDoLucro, PuxarAgoraProvider } from "./pendencias";

// ============================================================================
// A tela Dashboard (mockup "design novo/Dashboard.dc.html"), montada no
// servidor: a faixa de pendencias (uma linha: o aviso de custo ou a pendencia
// mais grave), de quando sao os pedidos e o gasto com o "Puxar agora", o
// destaque com o grafico de linha ao lado da composicao do lucro, a faixa de
// KPIs, "Detalhar por" e "Como calculamos". So a faixa, a leitura, o painel do
// destaque e as abas sao client.
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
  /** Que lado ja teve leitura: o rotulo so nomeia esse (foiLido). */
  lido: { pedidos: boolean; gasto: boolean };
}

/**
 * O aviso de custo: so quando ha venda sem custo cadastrado. A segunda frase
 * so diz "maior do que é" quando alguma loja nao tem custo padrao -- com ele,
 * o SKU sem custo usa o padrao e o lucro e estimativa, nao inflado. Vai na
 * faixa de pendencias, como a linha dela (so a critica passa na frente).
 */
function avisoDeCusto(cobertura: number | null, semCustoPadrao: boolean): Pendencia | null {
  // Abaixo de 0,05% o texto diria "0,0%": e o "Todos com custo" dos Pedidos.
  if (cobertura === null || cobertura >= 0.9995) return null;
  return {
    id: "custo",
    tom: "warn",
    titulo: `${porcento(1 - cobertura)} das vendas estão sem custo cadastrado.`,
    detalhe: semCustoPadrao
      ? "O lucro estimado aparece maior do que é."
      : "Elas usam o custo padrão da loja: o lucro é uma estimativa.",
    acao: { rotulo: "Cadastrar custos", href: CUSTOS_SEM_CUSTO },
  };
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
  const lojaEscolhida =
    filtro.lojaId !== TODAS
      ? [...dados.lojas, ...dados.checkouts].find((l) => l.id === filtro.lojaId)
      : undefined;
  const rotuloLoja = lojaEscolhida ? nomeDaLoja(lojaEscolhida) : "Todas as lojas";
  const hoje = diaNoFuso(new Date(), dados.fuso);
  // So para o leitor de tela do grafico: na tela, a barra do topo ja diz.
  const contexto = `${rotuloLoja} · ${rotuloDoPeriodo(filtro.periodo, r.intervalos.atual, hoje)} · ${moeda}`;

  const situacoes = situacaoDasLojas(dados.lojaIds, dados.estados, conexao.desinstaladas);
  const semAcesso = (id: string) => {
    const s = situacoes.get(id)?.situacao;
    return s === "desinstalada" || s === "sem-acesso";
  };
  // porDia vem do mais novo para o mais antigo; o grafico quer o contrario.
  const pontos = [...r.porDia].reverse().map(pontoDeLinha);
  const lucroPorLoja = new Map((extras?.serie.porLoja ?? []).map((l) => [l.storeId, l.lucro]));
  const mostrarLoja = filtro.lojaId === TODAS && dados.lojaIds.length + dados.checkoutIds.length >= 2;

  // Loja marcada "Contra entrega" em Custos e taxas (ou, com todas as lojas,
  // alguma delas): Recebido, A receber e Previsto no lugar do Faturamento.
  const contraEntrega = r.lojasContraEntrega.length > 0;
  // Checkout externo de comissao (Sphere) entra nestes indicadores sempre. Os
  // textos seguem o que o filtro soma: so checkout ("Taxa de aprovação", sem
  // custo de produto), so loja, ou os dois -- com "Todas", loja online +
  // checkout ja abre estes indicadores, e a taxa ai e so a de aprovacao. O de
  // VENDA (Cakto) conta como loja online: nunca abre estes indicadores, mas
  // junto da comissao sem loja Shopify (semLoja) os de produto e devolucao
  // saem para os do checkout de comissao.
  const noFiltro = new Set(dados.checkoutIds);
  const vendaIds = dados.checkouts.filter((c) => c.modelo === "venda" && noFiltro.has(c.id)).map((c) => c.id);
  const comissaoIds = dados.checkoutIds.filter((id) => !vendaIds.includes(id));
  const composicao = composicaoCod([...dados.lojaIds, ...vendaIds], comissaoIds, r.lojasContraEntrega);
  const codShopify = r.lojasContraEntrega.some((id) => dados.lojaIds.includes(id));
  const venda: BaseIndicadores["venda"] =
    vendaIds.length === 0 ? undefined : dados.lojaIds.length === 0 && comissaoIds.length === 0 ? "so" : "junto";
  const comparando = comparacao === "anterior";
  const semBase = comparando && !temMovimento(r.anterior);
  // Contra entrega: a cobertura conta o custo do que ainda vai ser enviado.
  const cobertura = contraEntrega ? r.atual.cod.coberturaCusto : r.atual.coberturaCusto;
  const base: BaseIndicadores = {
    moeda,
    atual: r.atual,
    anterior: r.anterior,
    compara: comparando && !semBase,
    dicas: montarDicas(r.avisos, cobertura, contraEntrega),
    entrega: r.entrega,
    composicao,
    venda,
    semLoja: dados.lojaIds.length === 0,
  };
  const { principal, celulas } = montarIndicadores(base, contraEntrega);
  const modo: ModoComparacao = !comparando ? "nenhuma" : semBase ? "sem-base" : "anterior";

  // O que deixa o numero errado ou incompleto. A de custo sai: o aviso de
  // custo ja diz, e vale ate para o custo padrao (que nao e pendencia).
  const pendencias = montarPendencias({
    lojas: dados.lojas,
    lojaIds: dados.lojaIds,
    estados: dados.estados,
    contas: dados.contas,
    avisos: r.avisos,
    coberturaCusto: cobertura,
    porLoja: r.porLoja.map((l) => ({ storeId: l.storeId, receita: l.receita, pedidos: l.pedidos })),
    desinstaladas: conexao.desinstaladas,
    lojasComConta: conexao.lojasComConta,
  }).filter((p) => p.id !== "custo-faltando");

  // Relativo ao momento em que a pagina foi montada (force-dynamic): cada
  // visita, troca de filtro ou "Puxar agora" calcula de novo.
  const lidoEm = conexao.atualizadoEm;
  const leitura = rotuloLeitura(lidoEm, instante(), conexao.lido);
  const horaLeitura =
    lidoEm === null
      ? null
      : `Última leitura: ${new Intl.DateTimeFormat("pt-BR", {
          timeZone: dados.fuso,
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(lidoEm)}`;

  // Com todas as lojas, cada pedido conta no dia do fuso da loja dele e o
  // "hoje" e o de Sao Paulo; com uma loja, os dias sao todos no fuso dela.
  const umaLoja = filtro.lojaId !== TODAS;
  const fusoNota = umaLoja
    ? `os dias contam no ${rotuloFuso(dados.fuso)}`
    : `cada pedido conta no dia do fuso da loja, e “hoje” segue o ${rotuloFuso(dados.fuso)}`;

  return (
    <div data-largura="total" className="@container mx-auto flex w-full max-w-330 flex-col gap-4 min-[760px]:gap-6">
      {/* Um "Puxar agora" so: o da faixa e o da leitura travam juntos. */}
      <PuxarAgoraProvider>
        <FaixaPendencias
          custo={avisoDeCusto(cobertura, r.avisos.lojasSemCustoPadraoComFalta.length > 0)}
          itens={pendencias}
        />

        {/* Margem negativa: a linha fica a 12px do destaque, como cabecalho dele. */}
        <div className="-mb-1 min-[760px]:-mb-3">
          <LeituraDoLucro
            rotulo={leitura}
            iso={lidoEm === null ? null : new Date(lidoEm).toISOString()}
            hora={horaLeitura}
          />
        </div>
      </PuxarAgoraProvider>

      <PainelLucro
        moeda={moeda}
        principal={principal}
        celulas={celulas}
        atual={pontos}
        anterior={extras ? extras.serie.anterior : null}
        comparacao={modo}
        umDia={r.intervalos.atual.desde === r.intervalos.atual.ate}
        rotuloPeriodo={nomeDoPeriodo(filtro.periodo, r.intervalos.atual, hoje)}
        rotuloAnterior={rotuloIntervalo(r.intervalos.anterior)}
        contexto={contexto}
        rotuloReceita={contraEntrega ? "Recebido" : "Faturamento"}
        rotuloLucro={contraEntrega ? "Lucro realizado" : "Lucro estimado"}
        // A serie conta so o pedido que entrou (pago; na comissao, aprovado ou
        // pago). Em contra entrega o KPI "Pedidos" conta os gerados: o mesmo
        // rotulo no tooltip juntaria dois numeros diferentes.
        rotuloPedidos={!contraEntrega ? "Pedidos" : codShopify ? "Pedidos pagos" : "Pedidos aprovados"}
        composicao={
          <Cascata
            atual={r.atual}
            moeda={moeda}
            contraEntrega={contraEntrega}
            devolucoes={codShopify}
            venda={Boolean(venda)}
          />
        }
      />

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

      <ComoCalculamos contraEntrega={codShopify} checkout={comissaoIds.length > 0} venda={vendaIds.length > 0} />

      <p className="text-label text-t3 text-pretty">
        Lucro estimado, não contábil. O faturamento inclui o frete cobrado. Pedidos sincronizam a cada 15 minutos;{" "}
        {fusoNota}.
      </p>
    </div>
  );
}
