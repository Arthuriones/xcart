import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diaNoFuso, paraNumero, somarDias } from "@/lib/financeiro/tipos";
import { lojasDeDemonstracao } from "@/lib/demonstracao";
import { gastoComImposto } from "@/lib/financeiro/calculo";
import { aplicarAlteracao, lerAoVivo, textoDoErroDeEdicao, tokenDaConta, type ContaGerenciavel } from "@/lib/ads/gerenciar";
import {
  DIAS_DA_JANELA,
  avaliarRegra,
  descreverRegra,
  inicioDoDiaNoFuso,
  orcamentoDaAcao,
  proximaExecucao,
  type NivelEdicao,
  type ObjetoNaJanela,
  type RegraAnuncio,
} from "@/lib/ads/gerenciar-regras";
import type {
  AcaoPassada,
  AlteracaoTela,
  EscopoRegra,
  OpcaoEscopo,
  RegraEntrada,
  RegraTela,
  ResultadoPassada,
} from "@/lib/ads/regras-tipos";

// ============================================================================
// Regras automaticas de anuncio (plano-de-acao/03): banco. A decisao e pura
// (avaliarRegra em gerenciar-regras.ts); a acao no Meta e aplicarAlteracao.
//
// De onde vem cada numero da janela (hoje / 3 / 7 dias, no fuso da conta):
// - gasto, impressoes, cliques e IC: ad_insights_granular (o sync do Meta de
//   15 em 15 min). O IC do Meta ja soma pixel + o nosso servidor (CAPI).
// - compras: fin_order_origem da loja da conta (pedido com o id do objeto),
//   so quando ao menos 80% dos pedidos do Meta trazem o id do nivel.
//   Conta sem loja (checkout externo ou solta) = sem como contar: a regra de
//   custo por compra nao age nela.
// - status e orcamento: o retrato do dia mais recente; antes de agir, o
//   objeto e relido AO VIVO no Meta (aplicarAlteracao).
//
// Seguranca: so conta do dono da regra, do Meta, ativa, com o gasto E o
// detalhe em dia (dado velho nunca dispara acao), fora da loja de
// demonstracao, no maximo MAX_ACOES_POR_PASSADA acoes por passada da regra, e
// uma mudanca de orcamento por objeto por dia.
// ============================================================================

type Db = SupabaseClient;

/** Sync do Meta mais velho que isso: a conta fica de fora da passada. */
export const SYNC_VELHO_MS = 50 * 60 * 1000;

const NIVEL_GRANULAR: Record<NivelEdicao, string> = { campanha: "campanha", grupo: "grupo", anuncio: "anuncio" };
const COLUNA_ORIGEM: Record<NivelEdicao, string> = {
  campanha: "campanha_id",
  grupo: "conjunto_id",
  anuncio: "anuncio_id",
};

export const tabelaAusente = (code?: string) => code === "42P01" || code === "PGRST205";

export interface LinhaRegra {
  id: string;
  user_id: string;
  nome: string;
  ativa: boolean;
  store_id: string | null;
  checkout_id: string | null;
  ad_account_id: string | null;
  nivel: NivelEdicao;
  filtro_nome: string | null;
  metrica: RegraAnuncio["metrica"];
  operador: RegraAnuncio["operador"];
  valor: number | string;
  gasto_minimo: number | string;
  janela: RegraAnuncio["janela"];
  acao: RegraAnuncio["acao"];
  acao_percentual: number | string | null;
  orcamento_limite: number | string | null;
  intervalo_minutos: number;
  ultima_execucao_em: string | null;
  proxima_execucao_em: string;
  ultimo_resultado: ResultadoPassada | null;
}

export const COLUNAS_REGRA =
  "id, user_id, nome, ativa, store_id, checkout_id, ad_account_id, nivel, filtro_nome, metrica, operador, valor, gasto_minimo, janela, acao, acao_percentual, orcamento_limite, intervalo_minutos, ultima_execucao_em, proxima_execucao_em, ultimo_resultado";

const numOuNulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : paraNumero(v));

export function regraDaLinha(l: LinhaRegra): RegraAnuncio {
  return {
    id: l.id,
    nome: l.nome,
    nivel: l.nivel,
    filtroNome: l.filtro_nome,
    metrica: l.metrica,
    operador: l.operador,
    valor: paraNumero(l.valor),
    gastoMinimo: paraNumero(l.gasto_minimo),
    janela: l.janela,
    acao: l.acao,
    acaoPercentual: numOuNulo(l.acao_percentual),
    orcamentoLimite: numOuNulo(l.orcamento_limite),
    intervaloMinutos: l.intervalo_minutos,
  };
}

export function escopoDaLinha(l: Pick<LinhaRegra, "store_id" | "checkout_id" | "ad_account_id">): EscopoRegra {
  if (l.store_id) return { tipo: "loja", id: l.store_id };
  if (l.checkout_id) return { tipo: "checkout", id: l.checkout_id };
  return { tipo: "conta", id: l.ad_account_id ?? "" };
}

/** Entrada da tela (ja validada por erroDaRegra) -> colunas. */
export function colunasDaEntrada(e: RegraEntrada): Record<string, unknown> {
  const deOrcamento = e.acao === "diminuir_orcamento" || e.acao === "aumentar_orcamento";
  return {
    nome: e.nome.trim(),
    ...(e.ativa === undefined ? {} : { ativa: e.ativa }),
    store_id: e.escopo.tipo === "loja" ? e.escopo.id : null,
    checkout_id: e.escopo.tipo === "checkout" ? e.escopo.id : null,
    ad_account_id: e.escopo.tipo === "conta" ? e.escopo.id : null,
    nivel: e.nivel,
    filtro_nome: e.filtroNome?.trim() ? e.filtroNome.trim() : null,
    metrica: e.metrica,
    operador: e.operador,
    valor: e.valor,
    gasto_minimo: e.gastoMinimo,
    janela: e.janela,
    acao: e.acao,
    acao_percentual: deOrcamento ? e.acaoPercentual : null,
    orcamento_limite: deOrcamento ? e.orcamentoLimite : null,
    intervalo_minutos: e.intervaloMinutos,
  };
}

/** Entrada crua do corpo -> RegraEntrada (tipos certos); a validacao de valores e erroDaRegra. */
export function entradaDoCorpo(c: unknown): RegraEntrada | null {
  if (!c || typeof c !== "object") return null;
  const r = c as Record<string, unknown>;
  const esc = r.escopo as Record<string, unknown> | undefined;
  const tipo = esc?.tipo;
  if (tipo !== "loja" && tipo !== "checkout" && tipo !== "conta") return null;
  if (typeof esc?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(esc.id)) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
  const numNulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  return {
    nome: typeof r.nome === "string" ? r.nome : "",
    ativa: typeof r.ativa === "boolean" ? r.ativa : undefined,
    escopo: { tipo, id: esc.id },
    nivel: r.nivel as RegraEntrada["nivel"],
    filtroNome: typeof r.filtroNome === "string" ? r.filtroNome : null,
    metrica: r.metrica as RegraEntrada["metrica"],
    operador: r.operador as RegraEntrada["operador"],
    valor: num(r.valor),
    gastoMinimo: r.gastoMinimo === undefined ? 0 : num(r.gastoMinimo),
    janela: (r.janela ?? "hoje") as RegraEntrada["janela"],
    acao: r.acao as RegraEntrada["acao"],
    acaoPercentual: numNulo(r.acaoPercentual),
    orcamentoLimite: numNulo(r.orcamentoLimite),
    intervaloMinutos: num(r.intervaloMinutos),
  };
}

const COLUNAS_CONTA = "id, user_id, external_id, nome, moeda, fuso, store_id, checkout_id, ultimo_sync_ok_em, ativo";

type ContaLida = ContaGerenciavel & { ativo: boolean };

/** Contas do Meta do dono no escopo (loja, checkout ou a propria conta). */
export async function contasDoEscopo(db: Db, userId: string, escopo: EscopoRegra): Promise<ContaLida[]> {
  let q = db.from("ad_accounts").select(COLUNAS_CONTA).eq("user_id", userId).eq("plataforma", "meta");
  q = escopo.tipo === "loja" ? q.eq("store_id", escopo.id) : escopo.tipo === "checkout" ? q.eq("checkout_id", escopo.id) : q.eq("id", escopo.id);
  const { data, error } = await q;
  if (error) throw new Error(`Falha ao ler as contas: ${error.message}`);
  return ((data ?? []) as ContaLida[]).filter((c) => c.ativo && Boolean(c.moeda));
}

/** O escopo e do usuario? (loja, checkout ou conta do Meta dele) */
export async function escopoEDoUsuario(db: Db, userId: string, escopo: EscopoRegra): Promise<boolean> {
  const tabela = escopo.tipo === "loja" ? "stores" : escopo.tipo === "checkout" ? "checkouts_externos" : "ad_accounts";
  let q = db.from(tabela).select("id").eq("id", escopo.id).eq("user_id", userId);
  if (escopo.tipo === "conta") q = q.eq("plataforma", "meta");
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`Falha ao conferir o escopo: ${error.message}`);
  return Boolean(data);
}

/** Opcoes de escopo da tela: lojas, checkouts e contas do Meta do usuario. */
export async function escoposDoUsuario(db: Db, userId: string): Promise<OpcaoEscopo[]> {
  const [lojas, checkouts, contas] = await Promise.all([
    db.from("stores").select("id, name, shop_domain").eq("user_id", userId),
    db.from("checkouts_externos").select("id, nome").eq("user_id", userId),
    db.from("ad_accounts").select("id, nome, external_id, moeda, store_id, checkout_id, ativo").eq("user_id", userId).eq("plataforma", "meta"),
  ]);
  if (lojas.error) throw new Error(`Falha ao ler as lojas: ${lojas.error.message}`);
  if (contas.error) throw new Error(`Falha ao ler as contas: ${contas.error.message}`);
  const listaContas = ((contas.data ?? []) as {
    id: string;
    nome: string | null;
    external_id: string;
    moeda: string | null;
    store_id: string | null;
    checkout_id: string | null;
    ativo: boolean;
  }[]).filter((c) => c.ativo);
  const demo = await lojasDeDemonstracao(db, (lojas.data ?? []).map((l: { id: string }) => l.id)).catch(() => new Set<string>());
  const moedaDe = (cs: typeof listaContas) => {
    const m = [...new Set(cs.map((c) => c.moeda).filter(Boolean))];
    return m.length === 1 ? (m[0] as string) : null;
  };
  const saida: OpcaoEscopo[] = [];
  for (const l of (lojas.data ?? []) as { id: string; name: string | null; shop_domain: string | null }[]) {
    if (demo.has(l.id)) continue;
    const cs = listaContas.filter((c) => c.store_id === l.id);
    saida.push({ tipo: "loja", id: l.id, nome: l.name || l.shop_domain || "Loja", contasMeta: cs.length, moeda: moedaDe(cs) });
  }
  // Checkout externo: tabela da 069; sem ela, nenhum.
  if (!checkouts.error) {
    for (const c of (checkouts.data ?? []) as { id: string; nome: string | null }[]) {
      const cs = listaContas.filter((x) => x.checkout_id === c.id);
      saida.push({ tipo: "checkout", id: c.id, nome: c.nome || "Checkout", contasMeta: cs.length, moeda: moedaDe(cs) });
    }
  }
  for (const c of listaContas) {
    saida.push({ tipo: "conta", id: c.id, nome: `${c.nome || "Conta"} (${c.external_id})`, contasMeta: 1, moeda: c.moeda });
  }
  return saida;
}

interface LinhaGranular {
  data: string;
  objeto_id: string;
  objeto_nome: string | null;
  objeto_status: string | null;
  orcamento: number | string | null;
  gasto: number | string | null;
  impressoes: number | string | null;
  cliques: number | string | null;
  ic: number | string | null;
  sincronizado_em: string | null;
}

/** Abaixo disso de pedidos do Meta com o id do nivel, o custo por compra nao e contado. */
export const COBERTURA_MINIMA_DE_IDS = 0.8;

/** O motivo de a conta ficar de fora da passada (vira aviso, nunca acao). */
export class ContaForaDaPassada extends Error {}

/**
 * O que cada objeto do nivel fez na janela, numa conta. LANCA ContaForaDaPassada
 * quando o detalhe de hoje esta velho: o ultimo_sync_ok_em da conta marca o
 * GASTO, e o detalhe (ad_insights_granular) pode ter ficado para tras (cota do
 * Meta, lista grande demais) -- gasto congelado com compras frescas daria um
 * custo por compra falso.
 */
export async function objetosNaJanela(
  db: Db,
  conta: ContaGerenciavel,
  regra: RegraAnuncio,
  agoraMs: number
): Promise<{ objetos: ObjetoNaJanela[]; aviso: string | null }> {
  const hoje = diaNoFuso(new Date(agoraMs), conta.fuso);
  const desde = somarDias(hoje, -(DIAS_DA_JANELA[regra.janela] - 1));
  const linhas: LinhaGranular[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from("ad_insights_granular")
      .select("data, objeto_id, objeto_nome, objeto_status, orcamento, gasto, impressoes, cliques, ic, sincronizado_em")
      .eq("ad_account_id", conta.id)
      .eq("nivel", NIVEL_GRANULAR[regra.nivel])
      .gte("data", desde)
      .lte("data", hoje)
      .order("data", { ascending: true })
      .range(de, de + 999);
    if (error) throw new Error(`Falha ao ler as métricas: ${error.message}`);
    linhas.push(...((data ?? []) as LinhaGranular[]));
    if ((data ?? []).length < 1000) break;
  }

  // O sync regrava a linha de HOJE de todo objeto ativo em toda passada boa:
  // a mais nova delas diz se o detalhe esta em dia.
  const ultimaDeHoje = linhas
    .filter((l) => l.data === hoje && l.sincronizado_em)
    .reduce((m, l) => Math.max(m, Date.parse(l.sincronizado_em as string) || 0), 0);
  if (!ultimaDeHoje || agoraMs - ultimaDeHoje > SYNC_VELHO_MS) {
    throw new ContaForaDaPassada("detalhe de campanhas do Meta desatualizado; a conta ficou de fora.");
  }

  const porObjeto = new Map<string, ObjetoNaJanela & { dia: string }>();
  for (const l of linhas) {
    const base = porObjeto.get(l.objeto_id) ?? {
      contaId: conta.id,
      objetoId: l.objeto_id,
      nome: l.objeto_nome ?? l.objeto_id,
      nivel: regra.nivel,
      status: "",
      gasto: 0,
      impressoes: 0,
      cliques: 0,
      ic: 0,
      compras: null,
      orcamentoDiario: 0,
      dia: "",
    };
    // Com o imposto do Meta no Brasil, como na aba Campanhas: o custo por IC
    // que a regra julga e o mesmo que o lojista ve na tela.
    base.gasto += gastoComImposto(paraNumero(l.gasto), "meta", conta.moeda);
    base.impressoes += paraNumero(l.impressoes);
    base.cliques += paraNumero(l.cliques);
    base.ic += paraNumero(l.ic);
    // Ordem crescente: o ultimo dia lido e o retrato de agora.
    if (l.data >= base.dia) {
      base.dia = l.data;
      base.status = (l.objeto_status ?? "").toUpperCase();
      base.nome = l.objeto_nome ?? base.nome;
      base.orcamentoDiario = paraNumero(l.orcamento);
    }
    porObjeto.set(l.objeto_id, base);
  }
  // Sem a linha de hoje o objeto nao esta ativo agora (o sync a cria para todo ativo).
  for (const o of porObjeto.values()) if (o.dia !== hoje) o.status = "";

  // Compras do Panda Track: so com a loja da conta, e so se os pedidos do Meta
  // trazem o id do nivel. Pedido sem o id contaria como "zero compras" e a
  // regra pausaria quem vendeu.
  let aviso: string | null = null;
  if (conta.store_id && porObjeto.size > 0) {
    const inicio = new Date(inicioDoDiaNoFuso(desde, conta.fuso)).toISOString();
    const coluna = COLUNA_ORIGEM[regra.nivel];
    const contagem = new Map<string, number>();
    let lido = true;
    let doMeta = 0;
    let comId = 0;
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db
        .from("fin_order_origem")
        .select(`plataforma, clique, ${coluna}`)
        .eq("store_id", conta.store_id)
        .gte("pedido_em", inicio)
        .range(de, de + 999);
      if (error) {
        lido = false;
        break;
      }
      for (const r of (data ?? []) as unknown as Record<string, string | null>[]) {
        const id = r[coluna];
        if (r.plataforma === "meta" || r.clique === "meta") {
          doMeta += 1;
          if (id) comId += 1;
        }
        if (id) contagem.set(id, (contagem.get(id) ?? 0) + 1);
      }
      if ((data ?? []).length < 1000) break;
    }
    if (lido && doMeta > 0 && comId / doMeta < COBERTURA_MINIMA_DE_IDS) {
      aviso = `só ${comId} de ${doMeta} pedidos do Meta trazem o id do anúncio; o custo por compra não foi contado.`;
    } else if (lido) {
      for (const o of porObjeto.values()) o.compras = contagem.get(o.objetoId) ?? 0;
    }
  }

  const objetos = [...porObjeto.values()].map((o) => {
    const { dia, ...resto } = o;
    void dia;
    return resto;
  });
  return { objetos, aviso };
}

/** Esta regra ja mudou o orcamento deste objeto hoje (no fuso da conta)? Na duvida, sim. */
async function orcamentoJaMudouHoje(
  db: Db,
  regraId: string,
  conta: ContaGerenciavel,
  objetoId: string,
  agoraMs: number
): Promise<boolean> {
  const inicio = new Date(inicioDoDiaNoFuso(diaNoFuso(new Date(agoraMs), conta.fuso), conta.fuso)).toISOString();
  const { count, error } = await db
    .from("ad_alteracoes")
    .select("id", { count: "exact", head: true })
    .eq("regra_id", regraId)
    .eq("ad_account_id", conta.id)
    .eq("objeto_id", objetoId)
    .eq("campo", "orcamento_diario")
    .eq("ok", true)
    .gte("criado_em", inicio);
  if (error) return true;
  return (count ?? 0) > 0;
}

/**
 * Uma passada da regra. `simular` = so diz o que faria (nada no Meta, nada
 * gravado). A regra precisa ser do `userId` (o cron passa o dono dela).
 *
 * Os objetos de TODAS as contas do escopo sao julgados juntos: o teto de
 * acoes por passada e a ordem "quem mais gastou primeiro" valem para a regra
 * inteira, nao para cada conta. Mudanca de orcamento: no maximo uma por
 * objeto por dia por regra (senao "aumentar 20%" de hora em hora se acumula).
 */
export async function rodarRegra(
  db: Db,
  linha: LinhaRegra,
  opcoes: { simular: boolean; agoraMs: number }
): Promise<ResultadoPassada> {
  const regra = regraDaLinha(linha);
  const resultado: ResultadoPassada = {
    quando: new Date(opcoes.agoraMs).toISOString(),
    julgados: 0,
    acoes: [],
    ignorados: [],
    cortados: 0,
    avisos: [],
  };

  let contas: ContaLida[];
  try {
    contas = await contasDoEscopo(db, linha.user_id, escopoDaLinha(linha));
  } catch (e) {
    resultado.avisos.push(e instanceof Error ? e.message : "Falha ao ler as contas.");
    return resultado;
  }
  if (contas.length === 0) {
    resultado.avisos.push("Nenhuma conta do Meta ativa neste escopo.");
    return resultado;
  }
  const demo = await lojasDeDemonstracao(db, contas.map((c) => c.store_id ?? "")).catch(() => new Set<string>());

  // 1. O que cada conta fez na janela.
  const contaPorId = new Map<string, ContaLida>();
  const todos: ObjetoNaJanela[] = [];
  for (const conta of contas) {
    const rotulo = conta.nome || conta.external_id;
    if (conta.store_id && demo.has(conta.store_id)) continue;
    const syncOk = conta.ultimo_sync_ok_em ? Date.parse(conta.ultimo_sync_ok_em) : 0;
    if (!syncOk || opcoes.agoraMs - syncOk > SYNC_VELHO_MS) {
      resultado.avisos.push(`${rotulo}: dados do Meta desatualizados (sync parado); a conta ficou de fora.`);
      continue;
    }
    try {
      const lido = await objetosNaJanela(db, conta, regra, opcoes.agoraMs);
      if (lido.aviso && regra.metrica === "custo_por_compra") resultado.avisos.push(`${rotulo}: ${lido.aviso}`);
      if (regra.metrica === "custo_por_compra" && !conta.store_id) {
        resultado.avisos.push(`${rotulo}: sem loja ligada, o custo por compra não é contado.`);
      }
      contaPorId.set(conta.id, conta);
      todos.push(...lido.objetos);
    } catch (e) {
      resultado.avisos.push(`${rotulo}: ${e instanceof Error ? e.message : "falha ao ler as métricas"}`);
    }
  }

  // 2. Uma avaliacao so, para a regra inteira.
  const r = avaliarRegra(regra, todos);
  resultado.julgados = r.julgados;
  resultado.ignorados.push(...r.ignorados);
  resultado.cortados = r.cortados;

  // 3. As acoes, conta a conta (cada uma com o seu token).
  const tokens = new Map<string, string | null>();
  for (const d of r.decisoes) {
    const conta = contaPorId.get(d.objeto.contaId);
    if (!conta) continue;
    const rotulo = conta.nome || conta.external_id;
    const deOrcamento = d.acao === "diminuir_orcamento" || d.acao === "aumentar_orcamento";
    const acao: AcaoPassada = {
      contaNome: rotulo,
      objetoId: d.objeto.objetoId,
      nome: d.objeto.nome,
      valorMetrica: d.valorMetrica,
      acao: d.acao,
      orcamentoAtual: deOrcamento ? d.objeto.orcamentoDiario : null,
      orcamentoNovo: d.orcamentoNovo,
    };
    if (opcoes.simular || d.acao === "avisar") {
      if (!opcoes.simular) acao.ok = true;
      resultado.acoes.push(acao);
      continue;
    }
    if (!tokens.has(conta.id)) tokens.set(conta.id, await tokenDaConta(db, conta.id).catch(() => null));
    const token = tokens.get(conta.id) ?? null;
    if (!token) {
      resultado.acoes.push({ ...acao, ok: false, erro: "sem token do Meta" });
      continue;
    }
    try {
      if (d.acao === "pausar") {
        const a = await aplicarAlteracao({
          db,
          conta,
          token,
          nivel: regra.nivel,
          objetoId: d.objeto.objetoId,
          campo: "status",
          valor: "PAUSED",
          origem: "regra",
          regraId: linha.id,
        });
        resultado.acoes.push({ ...acao, ok: a.ok, erro: a.ok ? null : a.erro });
        continue;
      }
      if (await orcamentoJaMudouHoje(db, linha.id, conta, d.objeto.objetoId, opcoes.agoraMs)) {
        resultado.ignorados.push({
          objetoId: d.objeto.objetoId,
          nome: d.objeto.nome,
          motivo: "esta regra já mudou o orçamento dele hoje",
        });
        continue;
      }
      // O orcamento novo sai do valor AO VIVO, nao do retrato do sync; e so
      // de objeto que esta rodando agora no Meta.
      const vivo = await lerAoVivo(conta, token, regra.nivel, d.objeto.objetoId);
      if (!vivo || vivo.efetivo !== "ACTIVE") {
        resultado.ignorados.push({
          objetoId: d.objeto.objetoId,
          nome: d.objeto.nome,
          motivo: !vivo ? "não encontrado no Meta" : "não está rodando no Meta agora",
        });
        continue;
      }
      const atual = vivo.diario ?? 0;
      const conta2 = orcamentoDaAcao(regra, atual);
      if ("motivo" in conta2) {
        resultado.ignorados.push({ objetoId: d.objeto.objetoId, nome: d.objeto.nome, motivo: conta2.motivo });
        continue;
      }
      const a = await aplicarAlteracao({
        db,
        conta,
        token,
        nivel: regra.nivel,
        objetoId: d.objeto.objetoId,
        campo: "orcamento_diario",
        valor: conta2.novo,
        esperado: String(atual),
        origem: "regra",
        regraId: linha.id,
      });
      resultado.acoes.push({
        ...acao,
        orcamentoAtual: atual,
        orcamentoNovo: conta2.novo,
        ok: a.ok,
        erro: a.ok ? null : a.erro,
      });
    } catch (e) {
      resultado.acoes.push({ ...acao, ok: false, erro: textoDoErroDeEdicao(e) });
    }
  }
  return resultado;
}

/** Linha do banco -> o que a tela mostra. */
export function regraTela(l: LinhaRegra, escopos: OpcaoEscopo[]): RegraTela {
  const r = regraDaLinha(l);
  const escopo = escopoDaLinha(l);
  const op = escopos.find((e) => e.tipo === escopo.tipo && e.id === escopo.id);
  return {
    ...r,
    ativa: l.ativa,
    escopo,
    escopoNome: op?.nome ?? "—",
    moeda: op?.moeda ?? null,
    descricao: descreverRegra(r),
    ultimaExecucaoEm: l.ultima_execucao_em,
    proximaExecucaoEm: l.proxima_execucao_em,
    ultimoResultado: l.ultimo_resultado,
  };
}

/** Ultimas alteracoes do usuario, com o nome da conta e da regra. */
export async function historicoDoUsuario(db: Db, userId: string, limite = 60): Promise<AlteracaoTela[] | null> {
  const { data, error } = await db
    .from("ad_alteracoes")
    .select("id, criado_em, ad_account_id, nivel, objeto_id, objeto_nome, campo, antes, depois, origem, regra_id, ok, erro")
    .eq("user_id", userId)
    .order("criado_em", { ascending: false })
    .limit(limite);
  if (error) {
    if (tabelaAusente(error.code)) return null;
    throw new Error(`Falha ao ler o histórico: ${error.message}`);
  }
  const linhas = (data ?? []) as {
    id: number;
    criado_em: string;
    ad_account_id: string;
    nivel: NivelEdicao;
    objeto_id: string;
    objeto_nome: string | null;
    campo: AlteracaoTela["campo"];
    antes: string | null;
    depois: string | null;
    origem: "manual" | "regra";
    regra_id: string | null;
    ok: boolean;
    erro: string | null;
  }[];
  const contaIds = [...new Set(linhas.map((l) => l.ad_account_id))];
  const regraIds = [...new Set(linhas.map((l) => l.regra_id).filter(Boolean))] as string[];
  const [contas, regras] = await Promise.all([
    contaIds.length ? db.from("ad_accounts").select("id, nome, external_id").in("id", contaIds) : Promise.resolve({ data: [] }),
    regraIds.length ? db.from("ad_regras").select("id, nome").in("id", regraIds) : Promise.resolve({ data: [] }),
  ]);
  const nomeConta = new Map(
    ((contas.data ?? []) as { id: string; nome: string | null; external_id: string }[]).map((c) => [c.id, c.nome || c.external_id])
  );
  const nomeRegra = new Map(((regras.data ?? []) as { id: string; nome: string }[]).map((r) => [r.id, r.nome]));
  return linhas.map((l) => ({
    id: l.id,
    criadoEm: l.criado_em,
    contaNome: nomeConta.get(l.ad_account_id) ?? "Conta",
    nivel: l.nivel,
    objetoId: l.objeto_id,
    objetoNome: l.objeto_nome,
    campo: l.campo,
    antes: l.antes,
    depois: l.depois,
    origem: l.origem,
    regraNome: l.regra_id ? (nomeRegra.get(l.regra_id) ?? null) : null,
    ok: l.ok,
    erro: l.erro,
  }));
}

/** Grava o fim da passada e marca a proxima. */
export async function fecharPassada(db: Db, linha: LinhaRegra, resultado: ResultadoPassada, agoraMs: number): Promise<void> {
  await db
    .from("ad_regras")
    .update({
      ultima_execucao_em: resultado.quando,
      proxima_execucao_em: proximaExecucao(agoraMs, linha.intervalo_minutos),
      ultimo_resultado: resultado,
      atualizado_em: new Date(agoraMs).toISOString(),
    })
    .eq("id", linha.id);
}
