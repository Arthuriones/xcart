import { calcularFinanceiro, criarConversor, gastoComImposto, type EntradaFinanceiro, type PedidoExternoFin, type Totais } from "@/lib/financeiro/calculo";
import { diasNoIntervalo, paraNumero, type AdAccountRow, type AdSpendDailyRow, type FinOrderRow } from "@/lib/financeiro/tipos";
import {
  derivar,
  somarEm,
  somasVazias,
  type IdentidadeCampanha,
  type LinhaCampanha,
  type NivelGranularidade,
  type SomasCampanha,
} from "./metricas";

// ============================================================================
// Tela Campanhas: conta, campanha, conjunto e anuncio no periodo do topo, com
// o lucro de cada um pelos pedidos. Puro, sem "server-only"; quem le o banco
// e src/lib/leitura/campanhas.ts.
//
// METRICAS DE ANUNCIO (cruas, moeda da conta, convertidas pela cotacao do dia
// como no Lucro):
// - ad_insights_granular (o detalhe: campanha, conjunto e anuncio) e a fonte
//   do dia da conta que tem detalhe. O nivel "conta" dela nao e lido.
// - Dia da conta SEM detalhe (antes do sync novo, Google): a campanha sai de
//   ad_spend_daily nivel campanha (gasto, impressoes, cliques). Conjunto e
//   anuncio nao existem nesses dias, e IC/video/frequencia ficam de fora.
// - A conta: gasto, impressoes e cliques do ad_spend_daily nivel CONTA quando
//   o dia tem (a verdade do gasto, a mesma do Dashboard: inclui anuncio
//   apagado); senao, a soma das campanhas do dia. IC e video somam das
//   campanhas.
// - Status, nome, tipo e orcamento: os do dia mais recente com detalhe.
//
// VENDAS: as dos pedidos (fin_order_origem e pedidos_externos), nunca as
// compras que a plataforma reporta. Cada pedido do periodo cai no anuncio, no
// conjunto e na campanha pelos ids DELE (o que faltar vem do objeto achado:
// pedido so com o anuncio ganha o conjunto e a campanha do anuncio), e na conta
// desses objetos uma vez. Receita, custo, taxas e o que conta como venda sao os
// do Lucro: os pedidos de cada grupo passam por calcularFinanceiro. No dia sem
// detalhe da conta, o pedido nao entra no conjunto/anuncio (o gasto deles nao
// existe nesse dia; somar a venda sem o gasto inflaria o lucro) -- so na
// campanha. Pedido que nao cai em nenhuma linha vai para o resumo "sem
// campanha identificada".
// ============================================================================

export interface InsightGranularRow {
  ad_account_id: string;
  data: string;
  nivel: string;
  objeto_id: string;
  objeto_nome: string | null;
  objeto_status: string | null;
  campanha_id: string | null;
  campanha_nome: string | null;
  grupo_id: string | null;
  grupo_nome: string | null;
  tipo: string | null;
  orcamento: number | string | null;
  cpa_desejado?: number | string | null;
  gasto: number | string | null;
  impressoes: number | string | null;
  cliques: number | string | null;
  ic: number | string | null;
  vis_video: number | string | null;
  vis_3s: number | string | null;
  /** CONTAGEM de visualizacoes ate 75% (contrato do sync). */
  retencao_75: number | string | null;
  frequencia: number | string | null;
  moeda: string;
  sincronizado_em?: string | null;
}

export type GastoDiarioRow = Pick<
  AdSpendDailyRow,
  "ad_account_id" | "data" | "nivel" | "campanha_id" | "campanha_nome" | "moeda" | "gasto" | "impressoes" | "cliques"
> & { sincronizado_em?: string | null };

export type ContaCampanhas = Pick<AdAccountRow, "id" | "nome" | "plataforma" | "external_id"> & {
  status_externo?: string | null;
  /** A moeda da CONTA: e ela que diz se o Meta cobra o imposto do Brasil (gastoComImposto). */
  moeda?: string | null;
};

export interface IdsDoPedido {
  campanha_id?: string | null;
  conjunto_id?: string | null;
  anuncio_id?: string | null;
}
export type OrigemShopify = IdsDoPedido & { store_id: string; shopify_order_id: string };
export type OrigemExterna = IdsDoPedido & { checkout_id: string; pedido_id: string };

export interface EntradaCampanhas {
  /** A entrada do Lucro (pedidos, custos, taxas, cambio, intervalos). So o periodo ATUAL e usado. */
  financeiro: EntradaFinanceiro;
  /** As contas do filtro: linha de outra conta e ignorada. */
  contas: ContaCampanhas[];
  granular: InsightGranularRow[];
  /** ad_spend_daily, niveis conta e campanha. */
  gastos: GastoDiarioRow[];
  origens: OrigemShopify[];
  origensExternas: OrigemExterna[];
  /**
   * Linhas de ANTES do periodo, so dos ids que algum pedido do periodo traz e
   * o periodo nao tem (campanha pausada, venda de clique antigo): dao nome e
   * conta ao objeto, sem metrica nenhuma.
   */
  anteriores?: { granular: InsightGranularRow[]; gastos: GastoDiarioRow[] };
}

export interface ParteAtribuida {
  vendas: number;
  vendasPendentes: number;
  faturamento: number;
}

export interface ResumoAtribuicao {
  identificadas: ParteAtribuida;
  /** Pedido sem id nenhum de campanha (direto, organico, sem UTM). */
  semId: ParteAtribuida;
  /** Com id, mas de nenhum objeto das contas do filtro (conta nao conectada, outra loja). */
  idDesconhecido: ParteAtribuida;
}

export interface ContaSemDetalhe {
  contaId: string;
  contaNome: string;
  /** Dias do periodo com gasto e sem detalhe: so a campanha aparece neles. */
  dias: number;
}

export interface ResultadoCampanhas {
  linhas: LinhaCampanha[];
  atribuicao: ResumoAtribuicao;
  semDetalhe: ContaSemDetalhe[];
  diasNoPeriodo: number;
  moedasSemCotacao: string[];
  cambioAproximado: boolean;
  /** O sincronizado_em mais recente das linhas do periodo. */
  sincronizadoEm: string | null;
}

const NIVEIS_DETALHE = new Set(["campanha", "grupo", "anuncio"]);
type NivelObjeto = "campanha" | "grupo" | "anuncio";

interface Objeto {
  ident: IdentidadeCampanha;
  somas: SomasCampanha;
  /** Dia da identidade atual: a mais recente vence. */
  diaIdent: string;
  /** A identidade veio do detalhe (status, tipo, orcamento). Ela vence a do gasto. */
  identDoDetalhe: boolean;
}

interface Metricas3 {
  gasto: number;
  impressoes: number;
  cliques: number;
}

const diaDe = (v: unknown) => String(v ?? "").slice(0, 10);
const idLimpo = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  return s ? s : null;
};

/** Os ids que os pedidos do periodo trazem e as linhas do periodo nao tem (para ler `anteriores`). */
export function idsFaltando(
  e: Pick<EntradaCampanhas, "financeiro" | "granular" | "gastos" | "origens" | "origensExternas">
): string[] {
  const { desde, ate } = e.financeiro.intervalos.atual;
  const presentes = new Set<string>();
  for (const g of e.granular) presentes.add(String(g.objeto_id));
  for (const g of e.gastos) if (g.nivel === "campanha" && g.campanha_id) presentes.add(String(g.campanha_id));
  const noPeriodo = new Set<string>();
  for (const p of e.financeiro.pedidos) {
    const d = diaDe(p.dia_local);
    if (d >= desde && d <= ate) noPeriodo.add(`${p.store_id}|${p.shopify_order_id}`);
  }
  for (const x of e.financeiro.externos ?? []) {
    const d = diaDe(x.dia_local);
    if (d >= desde && d <= ate && x.pedido_id) noPeriodo.add(`ck:${x.checkout_id}|${x.pedido_id}`);
  }
  const faltam = new Set<string>();
  const olhar = (chave: string, ids: IdsDoPedido) => {
    if (!noPeriodo.has(chave)) return;
    for (const v of [ids.campanha_id, ids.conjunto_id, ids.anuncio_id]) {
      const id = idLimpo(v);
      if (id && !presentes.has(id)) faltam.add(id);
    }
  };
  for (const o of e.origens) olhar(`${o.store_id}|${o.shopify_order_id}`, o);
  for (const o of e.origensExternas) olhar(`ck:${o.checkout_id}|${o.pedido_id}`, o);
  return [...faltam].sort();
}

/** "ativa"/"fechada" de ad_accounts.status_externo no formato do status dos objetos. */
function statusDaConta(c: ContaCampanhas): string | null {
  if (c.status_externo === "ativa") return "ACTIVE";
  if (c.status_externo === "fechada") return "CLOSED";
  return null;
}

export function montarCampanhas(e: EntradaCampanhas): ResultadoCampanhas {
  const fin = e.financeiro;
  const { desde, ate } = fin.intervalos.atual;
  const dentro = (d: string) => d >= desde && d <= ate;
  const converter = criarConversor(fin.cambio);
  const moedasSemCotacao = new Set<string>();
  let cambioAproximado = false;
  let sincronizadoEm: string | null = null;
  const anotarSync = (v: string | null | undefined) => {
    if (v && (!sincronizadoEm || v > sincronizadoEm)) sincronizadoEm = v;
  };
  /** Fator de 1 unidade da moeda da linha para a do relatorio no dia; null = sem cotacao. */
  const fatorDe = (moeda: string, dia: string): number | null => {
    const f = converter(1, moeda, fin.moeda, dia);
    if (!f) {
      moedasSemCotacao.add(String(moeda || "").toUpperCase());
      return null;
    }
    if (f.aproximado) cambioAproximado = true;
    return f.valor;
  };

  const contaPorId = new Map(e.contas.map((c) => [c.id, c]));
  const nomeDaConta = (c: ContaCampanhas) => c.nome || `Conta ${c.external_id}`;
  const objetos = new Map<string, Objeto>();

  const criar = (nivel: NivelGranularidade, conta: ContaCampanhas, objetoId: string): Objeto => {
    const id = `${nivel}:${conta.id}:${objetoId}`;
    let o = objetos.get(id);
    if (o) return o;
    const ehConta = nivel === "conta";
    o = {
      ident: {
        id,
        objetoId,
        nome: ehConta ? nomeDaConta(conta) : objetoId,
        status: ehConta ? statusDaConta(conta) : null,
        plataforma: conta.plataforma,
        nivel,
        contaId: conta.id,
        contaNome: nomeDaConta(conta),
        campanhaId: nivel === "campanha" ? objetoId : null,
        campanhaNome: null,
        grupoId: nivel === "grupo" ? objetoId : null,
        grupoNome: null,
        tipo: null,
        orcamento: null,
        cpaDesejado: null,
      },
      somas: somasVazias(),
      diaIdent: "",
      identDoDetalhe: false,
    };
    objetos.set(id, o);
    return o;
  };
  const linhaDaConta = (conta: ContaCampanhas) => criar("conta", conta, conta.external_id);

  /** Identidade pelo detalhe: o dia mais recente vence. */
  const identDoDetalhe = (o: Objeto, g: InsightGranularRow, dia: string, fator: number | null) => {
    if (o.identDoDetalhe && dia < o.diaIdent) return;
    const nivel = o.ident.nivel;
    const nome = idLimpo(g.objeto_nome) ?? o.ident.objetoId;
    const valor = (v: unknown) => (fator !== null && paraNumero(v) > 0 ? paraNumero(v) * fator : null);
    o.ident.nome = nome;
    o.ident.status = idLimpo(g.objeto_status);
    o.ident.tipo = idLimpo(g.tipo);
    // 0 = o orcamento nao e deste nivel (ABO na campanha, CBO no conjunto) ou e vitalicio.
    o.ident.orcamento = valor(g.orcamento);
    o.ident.cpaDesejado = valor(g.cpa_desejado);
    o.ident.campanhaId = nivel === "campanha" ? o.ident.objetoId : idLimpo(g.campanha_id);
    o.ident.campanhaNome = nivel === "campanha" ? nome : idLimpo(g.campanha_nome);
    o.ident.grupoId = nivel === "grupo" ? o.ident.objetoId : idLimpo(g.grupo_id);
    o.ident.grupoNome = nivel === "grupo" ? nome : idLimpo(g.grupo_nome);
    o.diaIdent = dia;
    o.identDoDetalhe = true;
  };
  /** Identidade pelo gasto por campanha: so o nome, e so sem detalhe. */
  const identDoGasto = (o: Objeto, g: GastoDiarioRow, dia: string) => {
    if (o.identDoDetalhe || dia < o.diaIdent) return;
    const nome = idLimpo(g.campanha_nome) ?? o.ident.objetoId;
    o.ident.nome = nome;
    o.ident.campanhaNome = nome;
    o.diaIdent = dia;
  };

  // --- Detalhe (ad_insights_granular) ------------------------------------
  const comDetalhe = new Set<string>();
  for (const g of e.granular) {
    if (!NIVEIS_DETALHE.has(g.nivel) || !contaPorId.has(g.ad_account_id)) continue;
    const dia = diaDe(g.data);
    if (dentro(dia)) comDetalhe.add(`${g.ad_account_id}|${dia}`);
  }

  /** Por conta e dia: o nivel conta do ad_spend_daily e a soma das campanhas. */
  const porContaDia = new Map<string, { conta: ContaCampanhas; doNivelConta: Metricas3 | null; dasCampanhas: Metricas3 }>();
  const contaDia = (conta: ContaCampanhas, dia: string) => {
    const k = `${conta.id}|${dia}`;
    let v = porContaDia.get(k);
    if (!v) {
      v = { conta, doNivelConta: null, dasCampanhas: { gasto: 0, impressoes: 0, cliques: 0 } };
      porContaDia.set(k, v);
    }
    return v;
  };

  for (const g of e.granular) {
    if (!NIVEIS_DETALHE.has(g.nivel)) continue;
    const conta = contaPorId.get(g.ad_account_id);
    const objetoId = idLimpo(g.objeto_id);
    const dia = diaDe(g.data);
    if (!conta || !objetoId || !dentro(dia)) continue;
    anotarSync(g.sincronizado_em);
    const fator = fatorDe(g.moeda, dia);
    const o = criar(g.nivel as NivelObjeto, conta, objetoId);
    identDoDetalhe(o, g, dia, fator);

    const gasto = fator === null ? 0 : gastoComImposto(paraNumero(g.gasto), conta.plataforma, conta.moeda ?? g.moeda) * fator;
    const impressoes = paraNumero(g.impressoes);
    const cliques = paraNumero(g.cliques);
    const frequencia = paraNumero(g.frequencia);
    const video: Partial<SomasCampanha> = {
      detalhe: true,
      gastoDetalhe: gasto,
      impressoesDetalhe: impressoes,
      ic: paraNumero(g.ic),
      visVideo: paraNumero(g.vis_video),
      vis3s: paraNumero(g.vis_3s),
      vis75: paraNumero(g.retencao_75),
      frequenciaPeso: frequencia > 0 ? frequencia * impressoes : 0,
      impressoesFrequencia: frequencia > 0 ? impressoes : 0,
    };
    somarEm(o.somas, { ...video, gastos: gasto, impressoes, cliques });
    if (g.nivel === "campanha") {
      // A conta: o detalhe e a soma das campanhas; gasto/impressoes/cliques vao pelo dia.
      somarEm(linhaDaConta(conta).somas, video);
      const cd = contaDia(conta, dia).dasCampanhas;
      cd.gasto += gasto;
      cd.impressoes += impressoes;
      cd.cliques += cliques;
    }
  }

  // --- Gasto (ad_spend_daily) --------------------------------------------
  const semDetalhe = new Set<string>();
  for (const g of e.gastos) {
    const conta = contaPorId.get(g.ad_account_id);
    const dia = diaDe(g.data);
    if (!conta || !dentro(dia)) continue;
    if (g.nivel !== "conta" && g.nivel !== "campanha") continue;
    const campanhaId = idLimpo(g.campanha_id);
    if (g.nivel === "campanha" && (!campanhaId || comDetalhe.has(`${conta.id}|${dia}`))) continue;
    anotarSync(g.sincronizado_em);
    const fator = fatorDe(g.moeda, dia);
    const m: Metricas3 = {
      gasto: fator === null ? 0 : gastoComImposto(paraNumero(g.gasto), conta.plataforma, conta.moeda ?? g.moeda) * fator,
      impressoes: paraNumero(g.impressoes),
      cliques: paraNumero(g.cliques),
    };
    const cd = contaDia(conta, dia);
    if (g.nivel === "conta") {
      const c = cd.doNivelConta ?? { gasto: 0, impressoes: 0, cliques: 0 };
      c.gasto += m.gasto;
      c.impressoes += m.impressoes;
      c.cliques += m.cliques;
      cd.doNivelConta = c;
      continue;
    }
    if (m.gasto > 0 || m.impressoes > 0 || m.cliques > 0) semDetalhe.add(`${conta.id}|${dia}`);
    const o = criar("campanha", conta, campanhaId!);
    identDoGasto(o, g, dia);
    somarEm(o.somas, { gastos: m.gasto, impressoes: m.impressoes, cliques: m.cliques });
    cd.dasCampanhas.gasto += m.gasto;
    cd.dasCampanhas.impressoes += m.impressoes;
    cd.dasCampanhas.cliques += m.cliques;
  }

  for (const { conta, doNivelConta, dasCampanhas } of porContaDia.values()) {
    const m = doNivelConta ?? dasCampanhas;
    somarEm(linhaDaConta(conta).somas, { gastos: m.gasto, impressoes: m.impressoes, cliques: m.cliques });
  }

  // --- Atribuicao pelos pedidos --------------------------------------------
  const porId: Record<NivelObjeto, Map<string, Objeto[]>> = { campanha: new Map(), grupo: new Map(), anuncio: new Map() };
  const indexar = (o: Objeto) => {
    const nivel = o.ident.nivel as NivelObjeto;
    const lista = porId[nivel].get(o.ident.objetoId) ?? [];
    lista.push(o);
    // A mesma conta conectada duas vezes: fica sempre a mesma linha (a de menor id).
    lista.sort((a, b) => (a.ident.contaId < b.ident.contaId ? -1 : 1));
    porId[nivel].set(o.ident.objetoId, lista);
  };
  for (const o of objetos.values()) if (o.ident.nivel !== "conta") indexar(o);

  // Os de antes do periodo: identidade so, criados quando um pedido pede.
  const catalogo: Record<NivelObjeto, Map<string, () => Objeto | null>> = {
    campanha: new Map(),
    grupo: new Map(),
    anuncio: new Map(),
  };
  const ultimoDoCatalogo = new Map<string, string>();
  const noCatalogo = (nivel: NivelObjeto, objetoId: string, dia: string, fazer: () => Objeto | null) => {
    const k = `${nivel}:${objetoId}`;
    if (dia < (ultimoDoCatalogo.get(k) ?? "")) return;
    ultimoDoCatalogo.set(k, dia);
    catalogo[nivel].set(objetoId, fazer);
  };
  for (const g of e.anteriores?.gastos ?? []) {
    const conta = contaPorId.get(g.ad_account_id);
    const id = idLimpo(g.campanha_id);
    if (!conta || !id || g.nivel !== "campanha") continue;
    const dia = diaDe(g.data);
    noCatalogo("campanha", id, dia, () => {
      const o = criar("campanha", conta, id);
      identDoGasto(o, g, dia);
      return o;
    });
  }
  for (const g of e.anteriores?.granular ?? []) {
    const conta = contaPorId.get(g.ad_account_id);
    const id = idLimpo(g.objeto_id);
    if (!conta || !id || !NIVEIS_DETALHE.has(g.nivel)) continue;
    const dia = diaDe(g.data);
    // O detalhe vence o gasto do mesmo dia: entra depois.
    noCatalogo(g.nivel as NivelObjeto, id, dia, () => {
      const o = criar(g.nivel as NivelObjeto, conta, id);
      identDoDetalhe(o, g, dia, fatorDe(g.moeda, dia));
      return o;
    });
  }

  const achar = (nivel: NivelObjeto, id: string | null): Objeto | undefined => {
    if (!id) return undefined;
    const lista = porId[nivel].get(id);
    if (lista?.length) return lista[0];
    const fazer = catalogo[nivel].get(id);
    if (!fazer) return undefined;
    catalogo[nivel].delete(id);
    const o = fazer();
    if (!o) return undefined;
    indexar(o);
    return o;
  };

  /** null = sem id nenhum; [] = com id, sem objeto. */
  const resolver = (ids: IdsDoPedido | undefined, dia: string): Objeto[] | null => {
    const idA = idLimpo(ids?.anuncio_id);
    const idG = idLimpo(ids?.conjunto_id);
    const idC = idLimpo(ids?.campanha_id);
    if (!idA && !idG && !idC) return null;
    const a = achar("anuncio", idA);
    const g = achar("grupo", idG ?? a?.ident.grupoId ?? null);
    const c = achar("campanha", idC ?? a?.ident.campanhaId ?? g?.ident.campanhaId ?? null);
    // Dia sem detalhe na conta do objeto: conjunto e anuncio nao tem gasto nesse dia.
    const comGasto = (o: Objeto | undefined) => (o && !semDetalhe.has(`${o.ident.contaId}|${dia}`) ? o : undefined);
    return [comGasto(a), comGasto(g), c].filter((o): o is Objeto => Boolean(o));
  };

  interface Grupo {
    objetos: Objeto[];
    pedidos: FinOrderRow[];
    externos: PedidoExternoFin[];
  }
  const grupos = new Map<string, Grupo>();
  const semId: Grupo = { objetos: [], pedidos: [], externos: [] };
  const desconhecido: Grupo = { objetos: [], pedidos: [], externos: [] };
  const grupoDe = (objs: Objeto[] | null): Grupo => {
    if (objs === null) return semId;
    if (objs.length === 0) return desconhecido;
    const k = objs.map((o) => o.ident.id).join("#");
    let gr = grupos.get(k);
    if (!gr) {
      gr = { objetos: objs, pedidos: [], externos: [] };
      grupos.set(k, gr);
    }
    return gr;
  };

  const origemShopify = new Map(e.origens.map((o) => [`${o.store_id}|${o.shopify_order_id}`, o]));
  const origemExterna = new Map(e.origensExternas.map((o) => [`${o.checkout_id}|${o.pedido_id}`, o]));
  for (const p of fin.pedidos) {
    const dia = diaDe(p.dia_local);
    // Teste e PDV nao sao venda de anuncio (o calculo tambem os ignora).
    if (!dentro(dia) || p.tipo === "teste" || p.tipo === "pdv") continue;
    grupoDe(resolver(origemShopify.get(`${p.store_id}|${p.shopify_order_id}`), dia)).pedidos.push(p);
  }
  for (const x of fin.externos ?? []) {
    const dia = diaDe(x.dia_local);
    if (!dentro(dia)) continue;
    const ids = x.pedido_id ? origemExterna.get(`${x.checkout_id}|${x.pedido_id}`) : undefined;
    grupoDe(resolver(ids, dia)).externos.push(x);
  }

  /** A conta do Lucro sobre os pedidos do grupo, sem anuncio: so o periodo atual. */
  const contaDoGrupo = (gr: Grupo): Totais | null => {
    if (gr.pedidos.length === 0 && gr.externos.length === 0) return null;
    const r = calcularFinanceiro({ ...fin, pedidos: gr.pedidos, externos: gr.externos, contas: [], gastos: [] });
    for (const m of r.avisos.moedasSemCotacao) moedasSemCotacao.add(m);
    if (r.avisos.cambioAproximado) cambioAproximado = true;
    return r.atual;
  };
  const parteDe = (t: Totais | null): ParteAtribuida & Pick<SomasCampanha, "custoProduto" | "lucroPedidos"> =>
    t
      ? {
          vendas: t.pedidos,
          // Pix/boleto aguardando (venda) + contra entrega vivo e comissao pendente (cod.abertos).
          vendasPendentes: t.cod.abertos + t.venda.aguardando,
          faturamento: t.receita,
          custoProduto: t.cmv,
          // Totais.lucro com gasto zero = receita - custo - taxas - devolucoes.
          lucroPedidos: t.lucro,
        }
      : { vendas: 0, vendasPendentes: 0, faturamento: 0, custoProduto: 0, lucroPedidos: 0 };

  const identificadas: ParteAtribuida = { vendas: 0, vendasPendentes: 0, faturamento: 0 };
  for (const gr of grupos.values()) {
    const parte = parteDe(contaDoGrupo(gr));
    const contas = new Set<string>();
    for (const o of gr.objetos) {
      somarEm(o.somas, parte);
      contas.add(o.ident.contaId);
    }
    for (const id of contas) somarEm(linhaDaConta(contaPorId.get(id)!).somas, parte);
    identificadas.vendas += parte.vendas;
    identificadas.vendasPendentes += parte.vendasPendentes;
    identificadas.faturamento += parte.faturamento;
  }
  const resumo = (gr: Grupo): ParteAtribuida => {
    const { vendas, vendasPendentes, faturamento } = parteDe(contaDoGrupo(gr));
    return { vendas, vendasPendentes, faturamento };
  };

  // --- Saida --------------------------------------------------------------
  const linhas: LinhaCampanha[] = [...objetos.values()].map((o) => ({ ...o.ident, ...o.somas, ...derivar(o.somas) }));
  linhas.sort((a, b) => b.gastos - a.gastos || b.faturamento - a.faturamento || a.nome.localeCompare(b.nome));

  const diasSem = new Map<string, number>();
  for (const k of semDetalhe) {
    const id = k.slice(0, k.indexOf("|"));
    diasSem.set(id, (diasSem.get(id) ?? 0) + 1);
  }
  const semDetalheLista: ContaSemDetalhe[] = [...diasSem.entries()]
    .map(([contaId, dias]) => ({ contaId, contaNome: nomeDaConta(contaPorId.get(contaId)!), dias }))
    .sort((a, b) => a.contaNome.localeCompare(b.contaNome));

  return {
    linhas,
    atribuicao: { identificadas, semId: resumo(semId), idDesconhecido: resumo(desconhecido) },
    semDetalhe: semDetalheLista,
    diasNoPeriodo: diasNoIntervalo(fin.intervalos.atual),
    moedasSemCotacao: [...moedasSemCotacao].filter(Boolean).sort(),
    cambioAproximado,
    sincronizadoEm,
  };
}
