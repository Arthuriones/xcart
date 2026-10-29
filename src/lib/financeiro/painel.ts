import {
  nomeDoPeriodo,
  rotuloDoPeriodo,
  rotuloFuso,
  rotuloIntervalo,
  type Comparacao,
} from "@/components/layout/contexto";
import type { TomStatus } from "@/components/ui/status-badge";
import { direcaoVariacao, formatarVariacao, tomVariacao, type DirecaoVariacao, type TomVariacao } from "@/components/ui/variacao";
import { bomComParcial, terminaHoje, textoDoAnterior } from "@/app/(dashboard)/financeiro/comparacao-parcial";
import { montarIndicadores, type BaseIndicadores, type Indicador } from "@/app/(dashboard)/financeiro/indicadores";
import {
  CUSTOS_SEM_CUSTO,
  SEMAFORO,
  composicaoCod,
  dinheiro,
  foiLido,
  inteiro,
  momentoAtualizado,
  montarDicas,
  montarFaixa,
  montarPendencias,
  nomeDaLoja,
  porcento,
  rotuloLeitura,
  situacaoDasLojas,
  temMovimento,
  valorComSinal,
  vezes,
  type Pendencia,
} from "@/app/(dashboard)/financeiro/lucro-dados";
// So tipos: o painel (client) e a leitura (server-only) nao entram aqui.
import type { ModoComparacao } from "@/app/(dashboard)/financeiro/painel-lucro";
import type { DadosFinanceiro } from "./queries";
import type { LinhaLoja } from "./calculo";
import { pontoDeLinha } from "@/lib/leitura/serie-diaria";
import { TODAS, diaNoFuso, serializarPeriodo, type AdAccountRow } from "./tipos";

// ============================================================================
// O Dashboard montado, sem JSX: o que a tela (financeiro-screen.tsx) e o app
// do celular (/api/app/v1/dashboard) mostram sai DAQUI, para os dois dizerem
// os mesmos numeros com os mesmos textos. Puro: o "agora" vem de quem chama.
//
// montarPainel e o que a tela montava no corpo dela (indicadores, pendencias,
// leitura, rotulos). montarConexao e o que page.tsx monta das contas e das
// lojas desinstaladas. painelDoApp so recorta para o celular: nada novo e
// calculado ali, so as regras de apresentacao que a tela aplica no client
// (variacao com o periodo parcial, "vs." do anterior, a tabela por loja).
// ============================================================================

export type DadosLucro = Extract<DadosFinanceiro, { vazio: false }>;

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

/** O que montarConexao le de cada conta de anuncio. */
export type ContaDaConexao = Pick<AdAccountRow, "store_id" | "checkout_id" | "ativo" | "ultimo_sync_ok_em">;

/**
 * Contas ativas das lojas (e checkouts) do filtro e ate quando pedidos e gasto
 * estao lidos. `contas` null = nao deu para ler as contas: nada de inventar
 * (sem o aviso de "vendeu sem conta", e o gasto conta como nao lido).
 */
export function montarConexao(
  dados: Pick<DadosLucro, "lojaIds" | "checkoutIds" | "estados">,
  contas: ContaDaConexao[] | null,
  desinstaladas: Record<string, string>
): ConexaoLucro {
  const lojaSet = new Set([...dados.lojaIds, ...dados.checkoutIds]);
  const destino = (c: ContaDaConexao) => c.store_id ?? c.checkout_id ?? null;
  const contasAtivas = contas
    ? contas.filter((c) => {
        const d = destino(c);
        return c.ativo && d !== null && lojaSet.has(d);
      })
    : null;
  const syncPedidos = dados.estados.map((e) => e.ultimo_sync_ok_em);
  const syncGasto = (contasAtivas ?? []).map((c) => c.ultimo_sync_ok_em);
  return {
    desinstaladas,
    lojasComConta: contasAtivas ? [...new Set(contasAtivas.map((c) => String(destino(c))))] : null,
    atualizadoEm: momentoAtualizado(syncPedidos, syncGasto),
    lido: { pedidos: foiLido(syncPedidos), gasto: foiLido(syncGasto) },
  };
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

export interface PainelMontado {
  moeda: DadosLucro["resultado"]["moeda"];
  /** "Todas as lojas" ou o nome da escolhida. */
  rotuloLoja: string;
  /** O periodo por extenso: "Últimos 7 dias (13/10–19/10)". */
  periodoPorExtenso: string;
  /** Loja · periodo por extenso · moeda (o leitor de tela do grafico). */
  contexto: string;
  /** O nome curto do periodo (nomeDoPeriodo). */
  rotuloPeriodo: string;
  rotuloAnterior: string;
  umDia: boolean;
  /** Recebido, A receber e Previsto no lugar do Faturamento. */
  contraEntrega: boolean;
  /** Alguma loja Shopify do filtro em contra entrega (devolucoes, "Pedidos pagos"). */
  codShopify: boolean;
  venda: BaseIndicadores["venda"];
  /** Checkout de comissao (Sphere) no filtro. */
  comissao: boolean;
  principal: Indicador;
  celulas: Indicador[];
  comparacao: ModoComparacao;
  /** O aviso de custo, a parte das pendencias (montarFaixa decide a ordem). */
  custo: Pendencia | null;
  pendencias: Pendencia[];
  leitura: string | null;
  horaLeitura: string | null;
  lidoEm: number | null;
  /** Aba Loja do "Detalhar por": com "Todas as lojas" e 2 ou mais. */
  mostrarLoja: boolean;
  /** Lojas desinstaladas ou que a Shopify nega ler. */
  lojasSemAcesso: string[];
  rotuloReceita: string;
  rotuloLucro: string;
  rotuloPedidos: string;
  fusoNota: string;
}

/** O Dashboard a partir do calculo de sempre (getFinanceiro). `agora` em ms. */
export function montarPainel(
  dados: DadosLucro,
  comparacao: Comparacao,
  conexao: ConexaoLucro,
  agora: number
): PainelMontado {
  const { resultado: r, filtro } = dados;
  const moeda = r.moeda;
  const lojaEscolhida =
    filtro.lojaId !== TODAS
      ? [...dados.lojas, ...dados.checkouts].find((l) => l.id === filtro.lojaId)
      : undefined;
  const rotuloLoja = lojaEscolhida ? nomeDaLoja(lojaEscolhida) : "Todas as lojas";
  const hoje = diaNoFuso(new Date(agora), dados.fuso);
  const periodoPorExtenso = rotuloDoPeriodo(filtro.periodo, r.intervalos.atual, hoje);

  const situacoes = situacaoDasLojas(dados.lojaIds, dados.estados, conexao.desinstaladas);
  const lojasSemAcesso = dados.lojaIds.filter((id) => {
    const s = situacoes.get(id)?.situacao;
    return s === "desinstalada" || s === "sem-acesso";
  });
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

  // Relativo ao momento da leitura: cada visita, troca de filtro ou "Puxar
  // agora" calcula de novo.
  const lidoEm = conexao.atualizadoEm;
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
  const fusoNota =
    filtro.lojaId !== TODAS
      ? `os dias contam no ${rotuloFuso(dados.fuso)}`
      : `cada pedido conta no dia do fuso da loja, e “hoje” segue o ${rotuloFuso(dados.fuso)}`;

  return {
    moeda,
    rotuloLoja,
    periodoPorExtenso,
    contexto: `${rotuloLoja} · ${periodoPorExtenso} · ${moeda}`,
    rotuloPeriodo: nomeDoPeriodo(filtro.periodo, r.intervalos.atual, hoje),
    rotuloAnterior: rotuloIntervalo(r.intervalos.anterior),
    umDia: r.intervalos.atual.desde === r.intervalos.atual.ate,
    contraEntrega,
    codShopify,
    venda,
    comissao: comissaoIds.length > 0,
    principal,
    celulas,
    comparacao: !comparando ? "nenhuma" : semBase ? "sem-base" : "anterior",
    custo: avisoDeCusto(cobertura, r.avisos.lojasSemCustoPadraoComFalta.length > 0),
    pendencias,
    leitura: rotuloLeitura(lidoEm, agora, conexao.lido),
    horaLeitura,
    lidoEm,
    mostrarLoja,
    lojasSemAcesso,
    rotuloReceita: contraEntrega ? "Recebido" : "Faturamento",
    rotuloLucro: contraEntrega ? "Lucro realizado" : "Lucro estimado",
    // A serie conta so o pedido que entrou (pago; na comissao, aprovado ou
    // pago). Em contra entrega o KPI "Pedidos" conta os gerados: o mesmo
    // rotulo no tooltip juntaria dois numeros diferentes.
    rotuloPedidos: !contraEntrega ? "Pedidos" : codShopify ? "Pedidos pagos" : "Pedidos aprovados",
    fusoNota,
  };
}

// ---------------------------------------------------------------------------
// O recorte do celular
// ---------------------------------------------------------------------------

export interface VariacaoDoApp {
  /** "12,3%" ou "1,5 p.p.", sem sinal: a direcao diz. */
  texto: string;
  direcao: DirecaoVariacao;
  /** Verde no lado bom, vermelho no ruim; neutro com o periodo terminando hoje. */
  tom: TomVariacao;
}

export interface CartaoDoApp {
  id: string;
  rotulo: string;
  /** O valor formatado, com o menos tipografico no negativo. */
  texto: string;
  valor: number | null;
  negativo: boolean;
  /** Ausente = sem comparacao; null = sem base no periodo anterior. */
  variacao?: VariacaoDoApp | null;
  /** A linha sob o numero: o anterior ("vs. ..."), Meta e Google, o ROAS de equilibrio. */
  linha?: string;
  /** O que o numero junta ou deixa de fora. */
  detalhe?: string;
  selo?: { texto: string; tom: TomStatus };
  definicao: string;
  notas?: string[];
}

export interface LojaDoApp {
  id: string;
  nome: string;
  situacao: { texto: string; tom: TomStatus };
  pedidos: string;
  faturamento: string;
  gasto: string;
  roas: string;
  lucro: string;
  lucroNegativo: boolean;
  margem: string;
}

/** A mesma situacao da aba Loja (detalhar-por.tsx): o semaforo, ou "Sem acesso". */
const SEM_ACESSO: { texto: string; tom: TomStatus } = { tom: "neutral", texto: "Sem acesso" };

function variacaoDoApp(c: Indicador, parcial: boolean): VariacaoDoApp | null | undefined {
  if (c.variacao === undefined) return undefined;
  if (c.variacao === null || !Number.isFinite(c.variacao)) return null;
  return {
    texto: formatarVariacao(c.variacao, c.formato),
    direcao: direcaoVariacao(c.variacao),
    tom: tomVariacao(c.variacao, bomComParcial(c.bom, parcial)),
  };
}

function cartao(c: Indicador, linha: string | undefined, variacao: VariacaoDoApp | null | undefined): CartaoDoApp {
  const v = valorComSinal(c.texto, c.valor);
  return {
    id: c.id,
    rotulo: c.rotulo,
    texto: v.texto,
    valor: c.valor,
    negativo: v.negativo,
    ...(variacao !== undefined ? { variacao } : {}),
    ...(linha ? { linha } : {}),
    ...(c.detalhe ? { detalhe: c.detalhe } : {}),
    ...(c.selo ? { selo: c.selo } : {}),
    definicao: c.definicao,
    ...(c.notas?.length ? { notas: c.notas } : {}),
  };
}

/**
 * As linhas da aba Loja, como a tabela abre: loja sem acesso e parada fica de
 * fora, a ordem e a do lucro (maior primeiro) e sem movimento no total nao ha
 * linha. Vazio quando a tela nao mostra a aba (uma loja so).
 */
function lojasDoApp(p: PainelMontado, dados: DadosLucro): LojaDoApp[] {
  const r = dados.resultado;
  if (!p.mostrarLoja || !temMovimento(r.atual)) return [];
  const semAcesso = new Set(p.lojasSemAcesso);
  const comMovimento = (l: LinhaLoja) => l.receita !== 0 || l.gasto !== 0 || l.pedidos !== 0 || l.cmv !== 0;
  return r.porLoja
    .filter((l) => !(semAcesso.has(l.storeId) && !comMovimento(l)))
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.lucro - a.l.lucro || a.i - b.i)
    .map(({ l }) => {
      const lucro = valorComSinal(dinheiro(l.lucro, p.moeda), l.lucro);
      return {
        id: l.storeId,
        nome: nomeDaLoja(l),
        situacao: semAcesso.has(l.storeId) ? SEM_ACESSO : SEMAFORO[l.semaforo],
        pedidos: inteiro(l.pedidos),
        faturamento: dinheiro(l.receita, p.moeda),
        gasto: dinheiro(l.gasto, p.moeda),
        roas: vezes(l.roas),
        lucro: lucro.texto,
        lucroNegativo: lucro.negativo,
        margem: porcento(l.margem),
      };
    });
}

/**
 * O Dashboard para o celular: o filtro ja conferido, o periodo, os cartoes
 * com texto pronto, a tabela por loja, as pendencias na ordem da faixa e a
 * hora da leitura. So numero do lojista: nada de comprador.
 */
export function painelDoApp(p: PainelMontado, dados: DadosLucro, comparacao: Comparacao) {
  const r = dados.resultado;
  // O mesmo "termina hoje" do painel: o ultimo dia da serie ainda corre.
  const parcial = terminaHoje([...r.porDia].reverse().map(pontoDeLinha));
  const m = p.principal;

  // A linha do destaque, como o painel escreve.
  let linhaPrincipal: string | undefined;
  let variacaoPrincipal = variacaoDoApp(m, parcial);
  if (p.comparacao === "nenhuma") {
    linhaPrincipal = "Sem comparação";
    variacaoPrincipal = undefined;
  } else if (p.comparacao === "sem-base" || m.variacao === undefined || (m.variacao === null && !m.anterior)) {
    linhaPrincipal = `Sem base de comparação em ${p.rotuloAnterior}`;
    variacaoPrincipal = undefined;
  } else if (m.anterior) {
    linhaPrincipal = textoDoAnterior(m.anterior.cheio.replace(/^-/, "−"), p.rotuloAnterior, {
      umDia: p.umDia,
      parcial,
    });
  }

  const faixa = montarFaixa(p.pendencias, [], p.custo);
  return {
    vazio: false as const,
    filtro: {
      /** "todas" ou o id da loja/checkout: o valor que volta no x-xc-loja. */
      loja: dados.filtro.lojaId,
      nomeLoja: p.rotuloLoja,
      /** O valor que volta no x-xc-periodo. */
      periodo: serializarPeriodo(dados.filtro.periodo),
      moeda: dados.filtro.moeda,
      comparar: comparacao,
    },
    periodo: {
      rotulo: p.rotuloPeriodo,
      porExtenso: p.periodoPorExtenso,
      desde: r.intervalos.atual.desde,
      ate: r.intervalos.atual.ate,
      umDia: p.umDia,
      terminaHoje: parcial,
      anterior: { ...r.intervalos.anterior, rotulo: p.rotuloAnterior },
    },
    moeda: p.moeda,
    comparacao: p.comparacao,
    contraEntrega: p.contraEntrega,
    /** Os nomes das linhas do grafico (a serie do /dashboard/serie). */
    grafico: { receita: p.rotuloReceita, lucro: p.rotuloLucro, pedidos: p.rotuloPedidos },
    principal: cartao(m, linhaPrincipal, variacaoPrincipal),
    cartoes: p.celulas.map((c) =>
      cartao(
        c,
        c.sub ?? (c.variacao !== undefined && c.anterior ? `vs. ${c.anterior.compacto.replace(/^-/, "−")}` : undefined),
        variacaoDoApp(c, parcial)
      )
    ),
    porLoja: lojasDoApp(p, dados),
    pendencias: (faixa.linha ? [faixa.linha, ...faixa.resto] : []).map((x) => ({
      id: x.id,
      tom: x.tom,
      titulo: x.titulo,
      ...(x.detalhe ? { detalhe: x.detalhe } : {}),
      ...(x.acao ? { acao: x.acao } : {}),
      ...(x.dispensavel ? { dispensavel: true } : {}),
    })),
    leitura: {
      rotulo: p.leitura,
      hora: p.horaLeitura,
      em: p.lidoEm === null ? null : new Date(p.lidoEm).toISOString(),
    },
  };
}

export type DashboardDoApp = ReturnType<typeof painelDoApp>;
