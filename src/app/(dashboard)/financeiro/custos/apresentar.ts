import {
  diaValido,
  lerNumero,
  numeroAmbiguo,
  validarCustoItem,
  validarValor,
  type ResultadoCsvCustos,
} from "@/lib/financeiro/csv-custos";
import {
  custoVigente,
  somarDias,
  type CustoItemCorpo,
  type FinStoreSettingsRow,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";
import { plural } from "@/lib/leitura/lojas-estado";
import { DIAS_SUGESTAO, TAXA_ENTREGA_PADRAO, type SugestaoCod } from "@/lib/financeiro/contra-entrega";
import type { DadosCustos, SkuVendido } from "@/lib/financeiro/custos-queries";

// ============================================================================
// Regras da tela Custos e taxas, sem React e sem banco: formato dos numeros,
// validacao dos campos, filtro e pagina da tabela, a linha do tempo de cada
// SKU e as frases que o lojista le. Puro para o vitest travar
// (tests/custos-tela.test.ts).
//
// A validacao do custo e a de src/lib/financeiro/csv-custos.ts, a mesma que a
// rota usa: o que o campo aceita, o servidor aceita.
// ============================================================================

export const POR_PAGINA = 50;

/** Moedas oferecidas no custo: as de fornecedor mais comuns. */
export const MOEDAS_FORNECEDOR = ["USD", "BRL", "EUR", "CNY"] as const;

/** Janela dos SKUs vendidos (a mesma de carregarCustos). */
export const DIAS_JANELA = 60;

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** 4.99 -> "4,99", sem milhar: o texto volta pelo lerNumero sem ambiguidade. */
export function paraCampo(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

/** Valor no campo da tabela: 2 a 4 casas, sem milhar ("1,60", "0,125", "1234,50"). */
export function paraCampoValor(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
}

export function fmtInteiro(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** Custo para ler: 2 a 4 casas ("US$ 0,125", "R$ 12,50"). */
export function fmtCusto(n: number, moeda: string): string {
  try {
    return n.toLocaleString("pt-BR", {
      style: "currency",
      currency: moeda,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  } catch {
    return `${moeda} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
}

/** Custo + frete de uma versao: "US$ 12,50 + frete US$ 3,20". */
export function fmtVersao(v: Pick<ProductCostRow, "custo_unitario" | "frete_unitario" | "moeda">): string {
  const custo = fmtCusto(v.custo_unitario, v.moeda);
  return v.frete_unitario > 0 ? `${custo} + frete ${fmtCusto(v.frete_unitario, v.moeda)}` : custo;
}

/** "2026-09-01" -> "01/09/2026", sem passar por Date (fuso nao importa aqui). */
export function fmtDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return a && m && d ? `${d}/${m}/${a}` : dia;
}

export function semMyshopify(dominio: string): string {
  return dominio.replace(/\.myshopify\.com$/i, "");
}

export { plural };

// ---------------------------------------------------------------------------
// Edicao de uma linha da tabela
// ---------------------------------------------------------------------------

export interface Edicao {
  custo: string;
  frete: string;
  moeda: string;
  /** "AAAA-MM-DD". So e editavel em SKU que ja tem custo. */
  desde: string;
}

export interface ErrosEdicao {
  custo?: string;
  frete?: string;
  desde?: string;
}

export function edicaoInicial(s: SkuVendido, moedaLoja: string | null, hoje: string): Edicao {
  return {
    custo: s.vigente ? paraCampoValor(s.vigente.custo_unitario) : "",
    frete: s.vigente ? paraCampoValor(s.vigente.frete_unitario) : "",
    moeda: s.vigente?.moeda ?? moedaLoja ?? "USD",
    desde: hoje,
  };
}

/** Mesmo valor escrito de outro jeito ("4,9" e "4,90") nao conta como alteracao. */
function mesmoNumero(a: string, b: string, vazioVale: number | null): boolean {
  if (a.trim() === b.trim()) return true;
  const na = a.trim() === "" ? vazioVale : lerNumero(a);
  const nb = b.trim() === "" ? vazioVale : lerNumero(b);
  return na !== null && nb !== null && Number.isFinite(na) && na === nb;
}

export function mudou(e: Edicao, inicial: Edicao): boolean {
  return (
    !mesmoNumero(e.custo, inicial.custo, null) ||
    !mesmoNumero(e.frete, inicial.frete, 0) ||
    e.moeda !== inicial.moeda ||
    e.desde !== inicial.desde
  );
}

/** Motivo da validacao (minusculo, com o valor) -> frase curta para baixo do campo. */
export function motivoCurto(motivo: string): string {
  if (/vazio/.test(motivo)) return motivo.startsWith("frete") ? "Informe o frete" : "Informe o custo";
  // "escreva 4990 (milhar) ou 4,99 (decimal)" -> "Use 4990 ou 4,99": cabe embaixo do campo estreito.
  const ambiguo = motivo.match(/ambíguo: escreva (\S+) \(milhar\) ou (\S+) \(decimal\)/);
  if (ambiguo) return `Use ${ambiguo[1]} ou ${ambiguo[2]}`;
  if (/não é número/.test(motivo)) return "Não é um número";
  if (/negativo/.test(motivo)) return "Não pode ser negativo";
  if (/alto demais/.test(motivo)) return "Alto demais: confira as casas decimais";
  return motivo.charAt(0).toUpperCase() + motivo.slice(1);
}

/** Erro de cada campo, todos de uma vez (nunca so o primeiro). */
export function errosDaEdicao(e: Edicao): ErrosEdicao {
  const erros: ErrosEdicao = {};
  const custo = validarValor(e.custo, "custo");
  if (!custo.ok) erros.custo = motivoCurto(custo.motivo);
  if (e.frete.trim() !== "") {
    const frete = validarValor(e.frete, "frete");
    if (!frete.ok) erros.frete = motivoCurto(frete.motivo);
  }
  if (!diaValido(e.desde)) erros.desde = "Data inválida";
  return erros;
}

export function temErro(e: ErrosEdicao): boolean {
  return Boolean(e.custo || e.frete || e.desde);
}

/** A linha editada no formato da rota (o mesmo corpo de sempre), ou null se invalida. */
export function itemDaEdicao(sku: string, e: Edicao, moedaLoja: string | null): CustoItemCorpo | null {
  const r = validarCustoItem(
    { sku, custo_unitario: e.custo, frete_unitario: e.frete, moeda: e.moeda, valido_desde: e.desde },
    moedaLoja
  );
  return r.ok ? r.item : null;
}

/** Moedas do campo: a da loja primeiro, as de fornecedor e a atual se for outra. */
export function opcoesDeMoeda(moedaLoja: string | null, atual?: string): string[] {
  const lista = [moedaLoja, ...MOEDAS_FORNECEDOR, atual].filter((m): m is string => Boolean(m));
  return [...new Set(lista)];
}

// ---------------------------------------------------------------------------
// Filtro, ordem e pagina
// ---------------------------------------------------------------------------

export type Situacao = "todos" | "semCusto" | "alterados";
export type Ordem = "pendentes" | "vendidos" | "sku";

export const ROTULO_ORDEM: Record<Ordem, string> = {
  pendentes: "Sem custo primeiro",
  vendidos: "Mais vendidos",
  sku: "SKU de A a Z",
};

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function filtrarSkus(
  skus: readonly SkuVendido[],
  o: {
    situacao: Situacao;
    busca: string;
    alterados: ReadonlySet<string>;
    /** Nome do produto por SKU, quando ja veio da Shopify: a busca acha pelo nome tambem. */
    nomes?: ReadonlyMap<string, string>;
  }
): SkuVendido[] {
  const termo = normalizar(o.busca);
  return skus.filter((s) => {
    if (o.situacao === "semCusto" && s.vigente) return false;
    if (o.situacao === "alterados" && !o.alterados.has(s.sku)) return false;
    if (!termo) return true;
    return normalizar(`${s.sku} ${o.nomes?.get(s.sku) ?? ""}`).includes(termo);
  });
}

const colator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export function ordenarSkus(skus: readonly SkuVendido[], ordem: Ordem): SkuVendido[] {
  const lista = [...skus];
  const porSku = (a: SkuVendido, b: SkuVendido) => colator.compare(a.sku, b.sku);
  if (ordem === "sku") return lista.sort(porSku);
  if (ordem === "vendidos") return lista.sort((a, b) => b.unidades - a.unidades || porSku(a, b));
  // Sem custo primeiro (e o que falta fazer), e entre eles o que mais vende.
  return lista.sort((a, b) => {
    const semA = a.vigente ? 1 : 0;
    const semB = b.vigente ? 1 : 0;
    return semA - semB || b.unidades - a.unidades || porSku(a, b);
  });
}

export interface Pagina<T> {
  itens: T[];
  /** 1 em diante, ja dentro do limite. */
  pagina: number;
  paginas: number;
  total: number;
  /** Posicao do primeiro e do ultimo item mostrado (1 em diante; 0 sem itens). */
  de: number;
  ate: number;
}

export function paginar<T>(lista: readonly T[], pagina: number, tamanho = POR_PAGINA): Pagina<T> {
  const total = lista.length;
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  const inicio = (p - 1) * tamanho;
  const itens = lista.slice(inicio, inicio + tamanho);
  return { itens, pagina: p, paginas, total, de: total ? inicio + 1 : 0, ate: inicio + itens.length };
}

// ---------------------------------------------------------------------------
// Historico do SKU: a regra de versao, em linha do tempo
// ---------------------------------------------------------------------------

export interface EtapaCusto {
  versao: ProductCostRow;
  /** Que pedidos esta versao cobre, em palavras. */
  periodo: string;
  valeHoje: boolean;
  /** Comeca depois de hoje: ainda nao vale para nenhum pedido. */
  futura: boolean;
}

/**
 * As versoes de um SKU como linha do tempo, da mais nova para a mais antiga.
 * A regra e a de custoVigente: cada versao vale da data dela ate a vespera da
 * seguinte, e a PRIMEIRA vale tambem para todos os pedidos anteriores a ela.
 */
export function linhaDoTempo(versoes: readonly ProductCostRow[], hoje: string): EtapaCusto[] {
  const v = [...versoes].sort((a, b) => (a.valido_desde < b.valido_desde ? -1 : a.valido_desde > b.valido_desde ? 1 : 0));
  const vigente = custoVigente(v, hoje);
  return v
    .map((versao, i): EtapaCusto => {
      const proxima = v[i + 1];
      const fim = proxima ? fmtDia(somarDias(proxima.valido_desde, -1)) : null;
      const inicio = fmtDia(versao.valido_desde);
      const futura = versao.valido_desde > hoje;
      let periodo: string;
      if (v.length === 1) periodo = "Todos os pedidos";
      else if (i === 0) periodo = `Pedidos até ${fim}`;
      else if (fim) periodo = `De ${inicio} a ${fim}`;
      else periodo = futura ? `A partir de ${inicio}` : `Desde ${inicio}`;
      return { versao, periodo, valeHoje: versao.id === vigente?.id, futura };
    })
    .reverse();
}

/** O que muda no lucro ao apagar uma versao. Concreto, para a confirmacao. */
export function efeitoDeApagar(
  versoes: readonly ProductCostRow[],
  id: string,
  temCustoPadrao: boolean
): string {
  const v = [...versoes].sort((a, b) => (a.valido_desde < b.valido_desde ? -1 : a.valido_desde > b.valido_desde ? 1 : 0));
  const i = v.findIndex((x) => x.id === id);
  if (i < 0) return "Esta versão já não existe.";
  if (v.length === 1) {
    return temCustoPadrao
      ? "O produto fica sem custo cadastrado, e os pedidos dele passam a usar o custo padrão da loja."
      : "O produto fica sem custo, e o lucro dos pedidos dele fica alto demais até você lançar outro.";
  }
  const proxima = v[i + 1];
  const fim = proxima ? fmtDia(somarDias(proxima.valido_desde, -1)) : null;
  if (i === 0) {
    return `Os pedidos até ${fim} passam a usar o custo que vale desde ${fmtDia(proxima.valido_desde)}: ${fmtVersao(proxima)}.`;
  }
  const trecho = fim ? `de ${fmtDia(v[i].valido_desde)} a ${fim}` : `desde ${fmtDia(v[i].valido_desde)}`;
  return `Os pedidos ${trecho} voltam a usar o custo anterior: ${fmtVersao(v[i - 1])}.`;
}

/** "Vale desde" de uma linha sem edicao: o periodo da versao que vale hoje. */
export function periodoVigente(s: SkuVendido, hoje: string): string | null {
  if (!s.vigente) return null;
  return linhaDoTempo(s.versoes, hoje).find((e) => e.valeHoje)?.periodo ?? null;
}

// ---------------------------------------------------------------------------
// Taxa de pagamento e custo padrao
// ---------------------------------------------------------------------------

export interface FormTaxas {
  pct: string;
  fixa: string;
  padrao: string;
}

export interface CorpoTaxas {
  taxa_pct: number;
  taxa_fixa: number;
  custo_padrao_pct: number | null;
}

export function formTaxasDe(cfg: Pick<FinStoreSettingsRow, "taxa_pct" | "taxa_fixa" | "custo_padrao_pct"> | null): FormTaxas {
  return {
    pct: paraCampo(cfg?.taxa_pct),
    fixa: paraCampo(cfg?.taxa_fixa),
    padrao: paraCampo(cfg?.custo_padrao_pct),
  };
}

/** Numero de um campo de taxa, ou a frase do erro. Vazio devolve `vazioVale`. */
function numeroDaTaxa<V extends number | null>(
  texto: string,
  vazioVale: V,
  aceita: (n: number) => boolean,
  faixa: string
): { ok: true; valor: number | V } | { ok: false; erro: string } {
  if (texto.trim() === "") return { ok: true, valor: vazioVale };
  if (numeroAmbiguo(texto)) {
    const t = texto.trim();
    return { ok: false, erro: `Ambíguo: escreva ${t.replace(".", "")} (milhar) ou ${t.replace(".", ",")} (decimal)` };
  }
  const n = lerNumero(texto);
  if (!Number.isFinite(n)) return { ok: false, erro: "Não é um número" };
  if (!aceita(n)) return { ok: false, erro: faixa };
  return { ok: true, valor: n };
}

/**
 * Os tres campos validados de uma vez. Os limites sao os da rota (que repete
 * os CHECK da tabela): a mensagem aparece no campo, antes de mandar.
 */
export function validarTaxas(f: FormTaxas): {
  erros: Partial<Record<keyof FormTaxas, string>>;
  corpo: CorpoTaxas | null;
} {
  const pct = numeroDaTaxa(f.pct, 0, (n) => n >= 0 && n < 100, "Use um número de 0 a 99,99");
  const fixa = numeroDaTaxa(f.fixa, 0, (n) => n >= 0 && n <= 10000, "Use um número de 0 a 10.000");
  const padrao = numeroDaTaxa(f.padrao, null, (n) => n >= 0 && n <= 100, "Use um número de 0 a 100, ou deixe vazio");
  const erros: Partial<Record<keyof FormTaxas, string>> = {};
  if (!pct.ok) erros.pct = pct.erro;
  if (!fixa.ok) erros.fixa = fixa.erro;
  if (!padrao.ok) erros.padrao = padrao.erro;
  if (!pct.ok || !fixa.ok || !padrao.ok) return { erros, corpo: null };
  return { erros, corpo: { taxa_pct: pct.valor, taxa_fixa: fixa.valor, custo_padrao_pct: padrao.valor } };
}

/** O formulario mudou em relacao ao que esta gravado? Compara o valor, nao o texto. */
export function taxasMudaram(f: FormTaxas, base: FormTaxas): boolean {
  return (
    !mesmoNumero(f.pct, base.pct, 0) || !mesmoNumero(f.fixa, base.fixa, 0) || !mesmoNumero(f.padrao, base.padrao, null)
  );
}

// ---------------------------------------------------------------------------
// Como a loja recebe (contra entrega)
// ---------------------------------------------------------------------------

export type ModoRecebimento = "online" | "cod";

export interface FormRecebimento {
  modo: ModoRecebimento;
  /** Taxa de entrega padrao (%). Vazio = 70. */
  entrega: string;
  /** Custo por recusado enviado, moeda da loja. Vazio = 0. */
  devolucao: string;
}

export interface CorpoRecebimento {
  contra_entrega: boolean;
  cod_taxa_entrega: number;
  cod_custo_devolucao: number;
}

export function formRecebimentoDe(
  cfg: Pick<FinStoreSettingsRow, "contra_entrega" | "cod_taxa_entrega" | "cod_custo_devolucao"> | null
): FormRecebimento {
  return {
    modo: cfg?.contra_entrega === true ? "cod" : "online",
    entrega: paraCampo(cfg?.cod_taxa_entrega ?? TAXA_ENTREGA_PADRAO),
    devolucao: paraCampo(cfg?.cod_custo_devolucao ?? 0),
  };
}

/** Os limites sao os da rota (que repete os CHECK da 068). */
export function validarRecebimento(f: FormRecebimento): {
  erros: Partial<Record<"entrega" | "devolucao", string>>;
  corpo: CorpoRecebimento | null;
} {
  const entrega = numeroDaTaxa(f.entrega, TAXA_ENTREGA_PADRAO, (n) => n >= 0 && n <= 100, "Use um número de 0 a 100");
  const devolucao = numeroDaTaxa(f.devolucao, 0, (n) => n >= 0 && n <= 10000, "Use um número de 0 a 10.000");
  const erros: Partial<Record<"entrega" | "devolucao", string>> = {};
  if (!entrega.ok) erros.entrega = entrega.erro;
  if (!devolucao.ok) erros.devolucao = devolucao.erro;
  if (!entrega.ok || !devolucao.ok) return { erros, corpo: null };
  return {
    erros,
    corpo: { contra_entrega: f.modo === "cod", cod_taxa_entrega: entrega.valor, cod_custo_devolucao: devolucao.valor },
  };
}

export function recebimentoMudou(f: FormRecebimento, base: FormRecebimento): boolean {
  return (
    f.modo !== base.modo ||
    !mesmoNumero(f.entrega, base.entrega, TAXA_ENTREGA_PADRAO) ||
    !mesmoNumero(f.devolucao, base.devolucao, 0)
  );
}

/** "4 de 5 pedidos dos últimos 7 dias foram contra entrega." null = nada a sugerir. */
export function textoSugestaoCod(s: SugestaoCod, modo: ModoRecebimento): string | null {
  if (modo === "cod" || !s.sugere) return null;
  return `${s.cod} de ${plural(s.total, "pedido", "pedidos")} dos últimos ${DIAS_SUGESTAO} dias ${s.cod === 1 ? "foi" : "foram"} contra entrega.`;
}

// ---------------------------------------------------------------------------
// Falha ao gravar
// ---------------------------------------------------------------------------

/**
 * A frase da falha, pelo status: nunca o "Unauthorized" cru nem o erro do
 * banco. `status` null = sem resposta (rede). Erro 400 traz o texto da rota,
 * que ja e em portugues e diz qual valor foi recusado.
 */
export function mensagemDeFalha(
  status: number | null,
  corpo: { error?: unknown; gravados?: unknown } | null,
  total?: number
): string {
  if (status === null) return "Sem conexão com o servidor. Nada se perdeu: tente de novo.";
  if (status === 401) return "Sua sessão expirou. Entre de novo em outra aba e salve outra vez.";
  if (status === 404) return "Esta loja não está mais na sua conta.";
  // 409: o recebimento numa loja sem taxa ("Salve a taxa de pagamento primeiro.").
  if (status === 400 || status === 409) {
    const texto = typeof corpo?.error === "string" ? corpo.error.trim() : "";
    return texto || "Algum valor foi recusado. Confira os campos e tente de novo.";
  }
  const gravados = Number(corpo?.gravados) || 0;
  if (gravados > 0 && total) {
    return `Só parte foi salva (${fmtInteiro(gravados)} de ${fmtInteiro(total)}). Tente de novo para salvar o resto.`;
  }
  return "Não deu para salvar agora. Nada se perdeu: tente de novo em instantes.";
}

// ---------------------------------------------------------------------------
// Planilha (CSV)
// ---------------------------------------------------------------------------

/** Campo de CSV com ";": aspas so quando precisa (SKU com ";" ou aspas). */
function campoCsv(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * O modelo ja preenchido com os SKUs da tela e o custo atual. "valido_desde"
 * vai vazio de proposito: reimportar sem mexer na data lanca a versao a
 * partir de hoje, sem reescrever o custo dos pedidos antigos.
 */
export function montarModeloCsv(skus: readonly SkuVendido[], moedaPadrao: string): string {
  const linhas = ["sku;custo_unitario;frete_unitario;moeda;valido_desde"];
  for (const s of skus) {
    const v = s.vigente;
    linhas.push(
      [campoCsv(s.sku), v ? paraCampo(v.custo_unitario) : "", v ? paraCampo(v.frete_unitario) : "", v?.moeda ?? moedaPadrao, ""].join(";")
    );
  }
  return linhas.join("\r\n") + "\r\n";
}

export interface ResumoPrevia {
  prontos: number;
  comErro: number;
  /** SKUs da planilha que nao venderam em 60 dias (gravados assim mesmo). */
  semVenda: string[];
  /** Linhas com o mesmo SKU e a mesma data de outra: vale a ultima. */
  repetidos: number;
}

export function resumirPrevia(previa: ResultadoCsvCustos, skus: readonly SkuVendido[]): ResumoPrevia {
  const vendidos = new Set(skus.filter((s) => s.unidades > 0).map((s) => s.sku));
  const vistos = new Set<string>();
  let repetidos = 0;
  for (const i of previa.itens) {
    const chave = `${i.sku}\u0000${i.valido_desde ?? ""}`;
    if (vistos.has(chave)) repetidos += 1;
    vistos.add(chave);
  }
  return {
    prontos: previa.itens.length,
    comErro: previa.erros.length,
    semVenda: [...new Set(previa.itens.filter((i) => !vendidos.has(i.sku)).map((i) => i.sku))],
    repetidos,
  };
}

// ---------------------------------------------------------------------------
// Escolher loja (com "Todas as lojas" na barra)
// ---------------------------------------------------------------------------

export interface ResumoCustosLoja {
  /** SKUs que venderam em 60 dias. */
  vendidos: number;
  /** Desses, quantos tem custo. */
  comCusto: number;
  taxa: boolean;
  sincronizado: boolean;
}

export function resumirCustos(d: Pick<DadosCustos, "skus" | "config" | "sincronizado">): ResumoCustosLoja {
  const vendidos = d.skus.filter((s) => s.unidades > 0);
  return {
    vendidos: vendidos.length,
    comCusto: vendidos.filter((s) => s.vigente).length,
    taxa: Boolean(d.config),
    sincronizado: d.sincronizado,
  };
}

/** Quanto falta fazer numa loja: SKU vendido sem custo + taxa nao configurada. */
export function pendenciasDaLoja(r: ResumoCustosLoja | null): number {
  if (!r) return 0;
  return r.vendidos - r.comCusto + (r.taxa ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Sair com alteracao nao salva
// ---------------------------------------------------------------------------

/**
 * O clique num link sai desta tela para outra do app? Devolve o destino
 * (caminho + busca + ancora) ou null quando o navegador cuida sozinho: outra
 * aba, Ctrl/Cmd + clique, download, outro site ou ancora na mesma pagina.
 */
export function destinoInterno(l: {
  href: string;
  target: string | null;
  download: boolean;
  botao: number;
  modificador: boolean;
  atual: string;
}): string | null {
  if (l.botao !== 0 || l.modificador || l.download) return null;
  if (l.target && l.target !== "_self") return null;
  let destino: URL;
  let atual: URL;
  try {
    atual = new URL(l.atual);
    destino = new URL(l.href, atual);
  } catch {
    return null;
  }
  if (destino.origin !== atual.origin) return null;
  if (destino.pathname === atual.pathname && destino.search === atual.search) return null;
  return `${destino.pathname}${destino.search}${destino.hash}`;
}
