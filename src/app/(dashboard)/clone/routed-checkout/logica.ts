import { mapaVelho, targetState } from "@/components/routed-checkout/target-state";
import type { TomStatus } from "@/components/ui/status-badge";
import type { GraphRoute, GraphTarget } from "@/lib/checkout-routes/graph";

// ============================================================================
// Regras da tela de Rotas, sem React e sem banco: estado de cada rota, filtro
// da lista, a divisao do trafego (rascunho, soma, o que vai no PATCH) e as
// frases do teste. Puro para o vitest travar.
//
// A regra de rota e de SKU continua toda no servidor (src/lib/checkout-routes
// e as rotas de API). Aqui so se decide o que mostrar e o que mandar, com os
// mesmos corpos de sempre.
// ============================================================================

// ---------------------------------------------------------------- estado

export type EstadoRota = "ativa" | "atencao" | "pausada";

/** A palavra e o tom de cada estado: os mesmos do mapa unico (STATUS.rota). */
export const SELO_ROTA: Record<EstadoRota, { tom: TomStatus; texto: string }> = {
  ativa: { tom: "ok", texto: "Ativa" },
  atencao: { tom: "warn", texto: "Atenção" },
  pausada: { tom: "neutral", texto: "Pausada" },
};

type RotaParaEstado = Pick<GraphRoute, "enabled" | "lastHeal"> & {
  targets: Pick<GraphTarget, "enabled" | "mappedSkuCount" | "lastHealedAt">[];
};

/**
 * Estado de uma rota inteira.
 *
 * "Atenção" ganha de "Ativa": uma rota no ar com loja de checkout sem produto
 * ligado, com o mapa velho ou com a ultima checagem quebrada parece saudavel
 * e nao esta -- e o caso em que o carrinho falha sem ninguem perceber.
 */
export function estadoDaRota(r: RotaParaEstado, agora: number = Date.now()): EstadoRota {
  if (!r.enabled) return "pausada";
  const semMapa = r.targets.some((t) => t.enabled && t.mappedSkuCount === 0);
  if (semMapa || mapaVelho(r.targets, agora) || (r.lastHeal && !r.lastHeal.ok)) return "atencao";
  return "ativa";
}

/** Quantas lojas de checkout recebem comprador agora (rota no ar, loja ligada, fatia > 0, com produto). */
export function lojasRecebendo(r: Pick<GraphRoute, "enabled" | "targets">): number {
  if (!r.enabled) return 0;
  return r.targets.filter(
    (t) =>
      targetState({
        id: t.id,
        name: "",
        domain: "",
        enabled: t.enabled,
        weight: t.weight,
        sharePercent: t.sharePercent,
        mappedSkuCount: t.mappedSkuCount,
      }) === "ok"
  ).length;
}

/** Estado de uma loja de checkout dentro da rota, com a palavra para a tela. */
export function estadoDaLoja(
  rotaLigada: boolean,
  t: Pick<GraphTarget, "enabled" | "weight" | "mappedSkuCount">
): { tom: TomStatus; texto: string } {
  if (!rotaLigada) return { tom: "neutral", texto: "Rota pausada" };
  if (t.enabled && t.mappedSkuCount === 0) return { tom: "warn", texto: "Sem produto ligado" };
  if (!t.enabled) return { tom: "neutral", texto: "Pausada" };
  if (t.weight <= 0) return { tom: "neutral", texto: "Fora da divisão" };
  return { tom: "ok", texto: "Recebendo" };
}

// ---------------------------------------------------------------- filtro

export type FiltroRotas = "todas" | "ativas" | "atencao" | "pausadas";

export const FILTROS: { valor: FiltroRotas; rotulo: string; estado: EstadoRota | null }[] = [
  { valor: "todas", rotulo: "Todas", estado: null },
  { valor: "ativas", rotulo: "Ativas", estado: "ativa" },
  { valor: "atencao", rotulo: "Atenção", estado: "atencao" },
  { valor: "pausadas", rotulo: "Pausadas", estado: "pausada" },
];

export function filtroDe(valor: string | null | undefined): FiltroRotas {
  return FILTROS.some((f) => f.valor === valor) ? (valor as FiltroRotas) : "todas";
}

export function passaNoFiltro(estado: EstadoRota, filtro: FiltroRotas): boolean {
  const f = FILTROS.find((x) => x.valor === filtro);
  return !f?.estado || f.estado === estado;
}

export function contarPorFiltro(estados: EstadoRota[]): Record<FiltroRotas, number> {
  const n: Record<FiltroRotas, number> = { todas: estados.length, ativas: 0, atencao: 0, pausadas: 0 };
  for (const e of estados) {
    if (e === "ativa") n.ativas += 1;
    else if (e === "atencao") n.atencao += 1;
    else n.pausadas += 1;
  }
  return n;
}

// ---------------------------------------------------------------- abas

export const ABAS = [
  { id: "visao", rotulo: "Visão" },
  { id: "lojas", rotulo: "Lojas e divisão" },
  { id: "diagnostico", rotulo: "Diagnóstico" },
  { id: "instalacao", rotulo: "Instalação" },
] as const;
export type AbaRota = (typeof ABAS)[number]["id"];

export function abaDe(valor: string | null | undefined): AbaRota {
  return ABAS.find((a) => a.id === valor)?.id ?? "visao";
}

/** Endereco de uma rota (e aba) no console. A Visao e o padrao e nao vai na URL. */
export function hrefRota(rotaId: string, aba: AbaRota = "visao", extra?: Record<string, string>): string {
  const p = new URLSearchParams({ rota: rotaId });
  if (aba !== "visao") p.set("aba", aba);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  return `/clone/routed-checkout?${p.toString()}`;
}

// ---------------------------------------------------------------- divisao

/**
 * Le o que o lojista digitou no campo de %. Aceita "45", "45,5" e "45.5"
 * (arredonda: o peso gravado e inteiro). Fora de 0-100 ou sem numero = null.
 */
export function lerPercentual(texto: string): number | null {
  const limpo = texto.trim().replace("%", "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n);
}

/** Partes iguais que somam 100 (o resto vai para as primeiras). */
export function dividirIgual(ids: string[]): Record<string, number> {
  const saida: Record<string, number> = {};
  if (ids.length === 0) return saida;
  const parte = Math.floor(100 / ids.length);
  const resto = 100 - parte * ids.length;
  ids.forEach((id, i) => {
    saida[id] = parte + (i < resto ? 1 : 0);
  });
  return saida;
}

export interface ConferenciaDivisao {
  /** Pode salvar: todo campo e numero valido e a soma fecha 100. */
  ok: boolean;
  /** Soma dos campos validos (para mostrar "Soma: 95%"). */
  soma: number;
  /** ids com valor invalido (vazio, letra, fora de 0-100). */
  invalidos: string[];
  /** Frase para o lojista quando nao pode salvar; null quando pode. */
  motivo: string | null;
}

/** Confere o rascunho da divisao antes de salvar. */
export function conferirDivisao(rascunho: Record<string, string>): ConferenciaDivisao {
  let soma = 0;
  const invalidos: string[] = [];
  for (const [id, texto] of Object.entries(rascunho)) {
    const v = lerPercentual(texto);
    if (v === null) invalidos.push(id);
    else soma += v;
  }
  if (invalidos.length > 0) {
    return { ok: false, soma, invalidos, motivo: "Use números de 0 a 100 em cada loja." };
  }
  if (Object.keys(rascunho).length > 0 && soma === 0) {
    return { ok: false, soma, invalidos, motivo: "Pelo menos uma loja precisa receber tráfego." };
  }
  if (soma !== 100) {
    const falta = 100 - soma;
    return {
      ok: false,
      soma,
      invalidos,
      motivo: falta > 0 ? `Faltam ${falta}% para fechar 100%.` : `Passou ${-falta}% de 100%.`,
    };
  }
  return { ok: true, soma, invalidos, motivo: null };
}

/**
 * O que vai no PATCH de /api/checkout-routes/[id]/targets: o % de cada loja
 * ligada vira o peso dela (peso e relativo, entao 45/55 da 45%/55%).
 *
 * Se qualquer % mudou, vao TODAS as lojas ligadas: mandar so a que mudou
 * deixaria as outras com o peso antigo, e como o peso e relativo a conta
 * nao fecharia (pesos 1/1/2 com A=30 e B=20 dariam 30/20/2, nao 30/20/50).
 * Nada mudou = lista vazia (nao ha o que salvar).
 */
export function mudancasDaDivisao(
  alvos: Pick<GraphTarget, "id" | "sharePercent">[],
  rascunho: Record<string, string>
): { id: string; weight: number }[] {
  const valores = alvos
    .filter((a) => a.id in rascunho)
    .map((a) => ({ a, v: lerPercentual(rascunho[a.id]) }));
  if (valores.some((x) => x.v === null)) return [];
  if (!valores.some((x) => x.v !== x.a.sharePercent)) return [];
  return valores.map((x) => ({ id: x.a.id, weight: x.v as number }));
}

/** O rascunho inicial: o % de hoje de cada loja ligada. */
export function rascunhoInicial(
  alvos: Pick<GraphTarget, "id" | "enabled" | "sharePercent">[]
): Record<string, string> {
  const r: Record<string, string> = {};
  for (const a of alvos) if (a.enabled) r[a.id] = String(a.sharePercent);
  return r;
}

export const ESTRATEGIAS = [
  {
    valor: "sticky",
    rotulo: "Sempre a mesma loja",
    dica: "Quem volta ao carrinho reencontra o mesmo checkout.",
  },
  {
    valor: "each_checkout",
    rotulo: "Sorteia toda vez",
    dica: "Divide mais rápido, mas o comprador pode ver domínios diferentes.",
  },
] as const;
export type Estrategia = (typeof ESTRATEGIAS)[number]["valor"];

// ---------------------------------------------------------------- teste

/** O que /api/checkout-routes/health devolve e a tela usa. */
export interface ResultadoTeste {
  ok: boolean;
  coveragePercent: number;
  noSkuCount: number;
  missingCount: number;
  wrongCount: number;
  checkedTargetName?: string;
  shipping?: { ok: boolean } | null;
  storeIssue?: { message?: string } | null;
  fallbackCount7d?: number;
  loaderReady7d?: number;
  routedOk7d?: number;
}

export interface LinhaTeste {
  tom: "ok" | "warn" | "err";
  texto: string;
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** As frases do resultado do teste, do mais grave para o menos. */
export function linhasDoTeste(r: ResultadoTeste): LinhaTeste[] {
  const linhas: LinhaTeste[] = [];
  if (r.storeIssue) {
    linhas.push({
      tom: "err",
      texto:
        r.storeIssue.message?.trim() ||
        "Uma das lojas não respondeu. Confira a conexão dela em Lojas.",
    });
    return linhas;
  }
  const semSku = n(r.noSkuCount);
  const semPar = n(r.missingCount);
  const errada = n(r.wrongCount);
  if (errada > 0) {
    linhas.push({
      tom: "err",
      texto: `${errada === 1 ? "1 SKU aponta" : `${errada} SKUs apontam`} para a variante errada: o comprador cai em outro produto.`,
    });
  }
  if (semPar > 0) {
    linhas.push({
      tom: "warn",
      texto: `${semPar === 1 ? "1 SKU da vitrine não tem par" : `${semPar} SKUs da vitrine não têm par`} na loja de checkout.`,
    });
  }
  if (semSku > 0) {
    linhas.push({
      tom: "warn",
      texto: `${semSku === 1 ? "1 variante da vitrine está" : `${semSku} variantes da vitrine estão`} sem SKU e nunca são levadas ao checkout.`,
    });
  }
  if (r.shipping && r.shipping.ok === false) {
    linhas.push({
      tom: "warn",
      texto: "A loja de checkout não entrega no país desta rota: o comprador trava no frete.",
    });
  }
  if (linhas.length === 0 && r.ok) {
    linhas.push({ tom: "ok", texto: "Todo produto da vitrine tem par certo na loja de checkout." });
  }
  return linhas;
}

/** "O que o teste mostra" pede conserto? (Corrigir so faz sentido nestes casos.) */
export function testePedeConserto(r: ResultadoTeste): boolean {
  if (r.storeIssue) return false;
  return n(r.missingCount) > 0 || n(r.wrongCount) > 0 || n(r.noSkuCount) > 0;
}

/** Frase do conserto, a partir do que /api/checkout-routes/repair devolve. */
export function fraseDoConserto(d: {
  noop?: boolean;
  createdProductCount?: number;
  extendedCount?: number;
  stampedSkuCount?: number;
  fixedWrongCount?: number;
}): string {
  if (d.noop) return "Nada para corrigir: a rota já estava certa.";
  const partes: string[] = [];
  const criados = n(d.createdProductCount);
  const variantes = n(d.extendedCount);
  const skus = n(d.stampedSkuCount);
  const trocados = n(d.fixedWrongCount);
  if (criados > 0) partes.push(criados === 1 ? "1 produto criado" : `${criados} produtos criados`);
  if (variantes > 0) partes.push(variantes === 1 ? "1 variante criada" : `${variantes} variantes criadas`);
  if (skus > 0) partes.push(skus === 1 ? "1 SKU gravado na vitrine" : `${skus} SKUs gravados na vitrine`);
  if (trocados > 0) partes.push(trocados === 1 ? "1 par corrigido" : `${trocados} pares corrigidos`);
  return partes.length > 0 ? `Corrigida: ${partes.join(", ")}.` : "Corrigida.";
}

// ---------------------------------------------------------------- instalacao

/**
 * O sinal de que o script esta na vitrine: o ultimo "loader_ready" que ele
 * mandou. Ele so dispara quando alguem abre produto ou carrinho, entao "sem
 * sinal" pode ser vitrine sem visita -- a tela diz isso.
 */
export function estadoInstalacao(
  ultimoSinal: string | null | undefined,
  erro: boolean
): { tom: TomStatus; texto: string } {
  if (erro) return { tom: "neutral", texto: "Sem leitura agora" };
  if (ultimoSinal) return { tom: "ok", texto: "Script ativo" };
  return { tom: "warn", texto: "Sem sinal do script" };
}

/**
 * O codigo que o lojista cola no tema. Sai EXATAMENTE como antes (console e
 * assistente usavam este mesmo texto): mudar um espaco aqui muda o que vai
 * para a loja.
 */
export function codigoDoScript(origem: string, token: string): string {
  return `<script\n  src="${origem}/routed-checkout-loader.js"\n  data-token="${token}"\n  async>\n</script>`;
}
