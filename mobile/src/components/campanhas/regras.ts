import { ErroApi } from "@/lib/api";
import { casasDaMoeda, dinheiro } from "@/lib/formato";
import {
  ESTRATEGIAS_COM_LANCE,
  ESTRATEGIA_ROAS_MINIMO,
  type CampoEdicao,
  type LinhaCampanha,
  type NivelEdicao,
  type ObjetoAoVivo,
} from "@/lib/tipos";

// ============================================================================
// Regras puras da aba Campanhas no app: o caminho da lista, quem se edita, as
// frases de status e o formulario da edicao. Espelham o site
// (src/app/(dashboard)/campanhas/edicao-anuncio.tsx): quem confere e aplica e
// o servidor (/api/ads/meta/alterar); aqui so se monta o pedido.
// ============================================================================

export type NivelLista = "campanha" | "grupo" | "anuncio";
export type StatusLista = "qualquer" | "ativa" | "pausada";

/** Mudanca de orcamento acima disso pede confirmacao: o Meta pode reiniciar o aprendizado. */
export const LIMITE_APRENDIZADO = 0.2;

/** Os mesmos formatos que as rotas de edicao aceitam (id no Meta e ad_accounts.id). */
const RE_OBJETO = /^[0-9]{5,25}$/;
const RE_CONTA = /^[0-9a-f-]{36}$/i;
/** O mesmo do filtroDeParametros: id fora disso o servidor ignora e traria tudo. */
const RE_CAMPANHA = /^[A-Za-z0-9_-]{1,64}$/;

export const NOME_DA_PLATAFORMA: Record<string, string> = { meta: "Meta", google: "Google", tiktok: "TikTok" };
export const NOME_DO_NIVEL: Record<NivelEdicao, string> = { campanha: "Campanha", grupo: "Conjunto", anuncio: "Anúncio" };

/** "12 campanhas", "1 conjunto"... */
export function quantidadeDoNivel(nivel: NivelLista, n: number): string {
  const nomes: Record<NivelLista, [string, string]> = {
    campanha: ["campanha", "campanhas"],
    grupo: ["conjunto", "conjuntos"],
    anuncio: ["anúncio", "anúncios"],
  };
  const [um, varios] = nomes[nivel];
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/**
 * Caminho da lista. A ordem dos parametros e fixa (nivel, status, q,
 * campanhaId): a mesma chave sempre, para o cache de exemplo e o log.
 */
export function caminhoDaLista(p: { nivel: NivelLista; status: StatusLista; busca: string; campanhaId: string | null }): string {
  const partes = [`nivel=${p.nivel}`, `status=${p.status}`];
  if (p.busca) partes.push(`q=${encodeURIComponent(p.busca)}`);
  if (p.campanhaId) partes.push(`campanhaId=${encodeURIComponent(p.campanhaId)}`);
  return `/api/app/v1/campanhas?${partes.join("&")}`;
}

export function caminhoDoObjeto(conta: string, nivel: NivelEdicao, id: string): string {
  return `/api/ads/meta/objeto?conta=${encodeURIComponent(conta)}&nivel=${nivel}&id=${encodeURIComponent(id)}`;
}

/** Id da campanha para abrir os conjuntos dela; null = nao da para filtrar por ele. */
export function idParaAbrir(linha: LinhaCampanha): string | null {
  const id = linha.campanhaId ?? linha.objetoId;
  return RE_CAMPANHA.test(id) ? id : null;
}

/**
 * O nivel da linha, se ela se edita pelo Panda Track: so Meta, so campanha,
 * conjunto e anuncio, e so com id do Meta (campanha que so veio do pedido nao).
 */
export function nivelEditavel(linha: LinhaCampanha): NivelEdicao | null {
  if (linha.plataforma !== "meta") return null;
  if (linha.nivel !== "campanha" && linha.nivel !== "grupo" && linha.nivel !== "anuncio") return null;
  if (!RE_OBJETO.test(linha.objetoId) || !RE_CONTA.test(linha.contaId)) return null;
  return linha.nivel;
}

/** effective_status que nao e ACTIVE nem PAUSED -> o motivo de nao rodar (as frases do site). */
export function motivoDoStatus(efetivo: string | null): string | null {
  switch ((efetivo ?? "").toUpperCase()) {
    case "CAMPAIGN_PAUSED":
      return "A campanha está pausada: ligue a campanha para este item rodar.";
    case "ADSET_PAUSED":
      return "O conjunto está pausado: ligue o conjunto para este anúncio rodar.";
    case "DISAPPROVED":
      return "Reprovado pelo Meta: corrija no Gerenciador de Anúncios.";
    case "PENDING_REVIEW":
    case "IN_PROCESS":
      return "Em análise no Meta: roda quando for aprovado.";
    case "WITH_ISSUES":
      return "Com problema no Meta: confira no Gerenciador de Anúncios.";
    case "PENDING_BILLING_INFO":
      return "Falta a forma de pagamento na conta de anúncio.";
    case "ARCHIVED":
      return "Arquivado no Meta: não dá para ligar pelo Panda Track.";
    case "DELETED":
      return "Excluído no Meta: não dá para ligar pelo Panda Track.";
    default:
      return null;
  }
}

/** Tom do selo de status. */
export function tomDoStatus(status: string | null): string {
  switch (status) {
    case "ACTIVE":
      return "ok";
    case "DISAPPROVED":
    case "WITH_ISSUES":
      return "err";
    case "PENDING_REVIEW":
    case "IN_PROCESS":
      return "warn";
    default:
      return "neutral";
  }
}

export function travado(status: string | null): boolean {
  return status === "ARCHIVED" || status === "DELETED";
}

/**
 * Erro da chamada -> frase da tela. A do servidor ja vem escrita; quando fala
 * de permissao (perfil conectado so com leitura), diz onde liberar -- a nao ser
 * que ja diga.
 */
export function fraseDoErro(e: unknown, padrao = "Não deu para falar com o Panda Track. Tente de novo."): string {
  const m = e instanceof ErroApi ? e.message : padrao;
  if (/permiss/i.test(m) && !/permitir editar campanhas/i.test(m)) {
    return `${m} Libere em Integrações no site: Permitir editar campanhas.`;
  }
  return m;
}

/** Valor curto para a linha (cabe 4 numeros lado a lado): sem centavo a partir de 100. */
export function dinheiroCurto(valor: number | null, moeda: string): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return dinheiro(valor, moeda, Math.abs(valor) >= 100 ? 0 : casasDaMoeda(moeda));
}

// ----------------------------------------------------------------------------
// Formulario da edicao
// ----------------------------------------------------------------------------

export type CampoNumero = Exclude<CampoEdicao, "status">;

export interface DefCampo {
  campo: CampoNumero;
  rotulo: string;
  ajuda: string | null;
  atual: number;
  dinheiro: boolean;
  casas: number;
}

export interface Formulario {
  ligado: boolean;
  valores: Partial<Record<CampoNumero, string>>;
}

export interface Mudanca {
  campo: CampoEdicao;
  rotulo: string;
  valor: string | number;
  antes: number | null;
  depois: number | null;
  /** Orcamento que muda mais de 20%: pede confirmacao. */
  grande: boolean;
}

function arredondar(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Numero no campo como o lojista digita: virgula decimal, sem milhar. */
export function textoDoCampo(v: number, casas: number): string {
  return arredondar(v, casas).toString().replace(".", ",");
}

/** Os campos de numero que ESTE objeto tem (o que for null nao aparece). */
export function camposDoObjeto(o: ObjetoAoVivo): DefCampo[] {
  const lista: DefCampo[] = [];
  const casas = casasDaMoeda(o.moeda);
  if (o.nivel !== "anuncio") {
    if (o.diario !== null) {
      lista.push({ campo: "orcamento_diario", rotulo: "Orçamento diário", ajuda: null, atual: o.diario, dinheiro: true, casas });
    }
    if (o.total !== null) {
      lista.push({
        campo: "orcamento_total",
        rotulo: "Orçamento total",
        ajuda: "O que gasta do início ao fim.",
        atual: o.total,
        dinheiro: true,
        casas,
      });
    }
  }
  if (o.nivel === "grupo" && o.estrategia) {
    if (ESTRATEGIAS_COM_LANCE.includes(o.estrategia) && o.lance !== null) {
      lista.push({
        campo: "lance",
        rotulo: o.estrategia === "COST_CAP" ? "Limite de custo" : "Limite de lance",
        ajuda: o.estrategia === "COST_CAP" ? "Custo por resultado que o Meta busca." : "Lance máximo por leilão.",
        atual: o.lance,
        dinheiro: true,
        casas,
      });
    }
    if (o.estrategia === ESTRATEGIA_ROAS_MINIMO && o.roasMinimo !== null) {
      lista.push({
        campo: "roas_minimo",
        rotulo: "ROAS mínimo",
        ajuda: "1,5 = o Meta busca compras de 1,5 vez o gasto.",
        atual: o.roasMinimo,
        dinheiro: false,
        casas: 4,
      });
    }
  }
  return lista;
}

/** Frase de quando o orcamento nao se edita aqui (null = tem campo de orcamento). */
export function semOrcamento(o: ObjetoAoVivo): string | null {
  if (o.nivel === "anuncio") return "Anúncio não tem orçamento: ele usa o do conjunto ou o da campanha.";
  if (o.diario !== null || o.total !== null) return null;
  return o.nivel === "grupo" ? "O orçamento fica na campanha (CBO)." : "O orçamento fica nos conjuntos (ABO).";
}

/** Frase de quando o conjunto nao tem lance para editar (null = tem, ou nao e conjunto). */
export function semLance(o: ObjetoAoVivo): string | null {
  if (o.nivel !== "grupo") return null;
  if (o.estrategia && ESTRATEGIAS_COM_LANCE.includes(o.estrategia)) {
    return o.lance === null ? "O Meta não informou o lance deste conjunto." : null;
  }
  if (o.estrategia === ESTRATEGIA_ROAS_MINIMO) {
    return o.roasMinimo === null ? "O Meta não informou o ROAS mínimo deste conjunto." : null;
  }
  return "Estratégia sem lance para editar (menor custo).";
}

export function formularioDe(o: ObjetoAoVivo): Formulario {
  const valores: Formulario["valores"] = {};
  for (const def of camposDoObjeto(o)) valores[def.campo] = textoDoCampo(def.atual, def.casas);
  return { ligado: o.status === "ACTIVE", valores };
}

/** O valor de agora como o servidor compara (valorDoCampo em gerenciar.ts). */
export function esperadoDe(o: ObjetoAoVivo, campo: CampoEdicao): string {
  switch (campo) {
    case "status":
      return String(o.status);
    case "orcamento_diario":
      return String(o.diario);
    case "orcamento_total":
      return String(o.total);
    case "lance":
      return String(o.lance);
    case "roas_minimo":
      return String(o.roasMinimo);
  }
}

export function calcular(
  o: ObjetoAoVivo,
  f: Formulario,
  lerNumero: (t: string) => number | null
): { mudancas: Mudanca[]; erros: Partial<Record<CampoNumero, string>> } {
  const mudancas: Mudanca[] = [];
  const erros: Partial<Record<CampoNumero, string>> = {};
  for (const def of camposDoObjeto(o)) {
    const n = lerNumero(f.valores[def.campo] ?? "");
    if (n === null || n <= 0) {
      erros[def.campo] = "Informe um valor maior que zero.";
      continue;
    }
    const novo = arredondar(n, def.casas);
    if (novo === def.atual) continue;
    const variacao = Math.abs(novo - def.atual) / def.atual;
    mudancas.push({
      campo: def.campo,
      rotulo: def.rotulo,
      valor: novo,
      antes: def.atual,
      depois: novo,
      grande: variacao > LIMITE_APRENDIZADO,
    });
  }
  // Status por ultimo: ligar ja com o orcamento novo.
  if (f.ligado !== (o.status === "ACTIVE")) {
    mudancas.push({ campo: "status", rotulo: "Status", valor: f.ligado ? "ACTIVE" : "PAUSED", antes: null, depois: null, grande: false });
  }
  return { mudancas, erros };
}

/** O objeto atual que o 409 da edicao traz no corpo (null = 409 de outra causa). */
export function objetoDoConflito(e: unknown): ObjetoAoVivo | null {
  if (!(e instanceof ErroApi) || e.status !== 409) return null;
  const o = e.corpo?.objeto;
  if (!o || typeof o !== "object") return null;
  const obj = o as Partial<ObjetoAoVivo>;
  return typeof obj.id === "string" && typeof obj.nivel === "string" && typeof obj.moeda === "string"
    ? (obj as ObjetoAoVivo)
    : null;
}

/** semDetalhe chega como unknown[] (ContaSemDetalhe no servidor): so o que da para ler. */
export function contasSemDetalhe(lista: unknown[]): { contaNome: string; dias: number }[] {
  const saida: { contaNome: string; dias: number }[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.contaNome === "string" && typeof r.dias === "number") saida.push({ contaNome: r.contaNome, dias: r.dias });
  }
  return saida;
}
