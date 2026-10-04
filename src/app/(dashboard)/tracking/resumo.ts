import type { LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import {
  ORDEM_SAUDE,
  aceitamCompra,
  emModoTeste,
  melhorDa,
  numerosDoEvento,
  pelaTag,
  pixelCheckoutJaVisto,
  recebemCompra,
  saudeDaLoja,
  tagComCompra,
  vereditoDoDestino,
  type Plataforma,
  type Saude,
} from "./saude";

// ============================================================================
// O que a tela de Rastreamento mostra de cada loja, sem React.
//
// A REGRA continua em saude.ts e nao muda aqui. Este arquivo so traduz o
// resultado dela em numeros:
//   - as duas colunas da linha (Meta: chegaram de esperados; Google: a tag);
//   - a ordem das lojas e os numeros do topo.
// O texto que a tela mostra mora em vista.ts.
//
// Imports so de TIPO de queries.ts e diagnostico.ts, como em saude.ts: eles
// tem "server-only".
// ============================================================================

export type TomSaude = "ok" | "warn" | "err" | "neutral";

export const TOM_DA_SAUDE: Record<Saude, TomSaude> = {
  parado: "err",
  atencao: "warn",
  ok: "ok",
  desligado: "neutral",
};

/** Ordem das colunas na linha: Meta, depois Google. */
export const PLATAFORMAS: Plataforma[] = ["meta", "google"];

// ---------------------------------------------------------------------------
// As colunas Meta e Google da linha.
// ---------------------------------------------------------------------------

export type ColunaPlataforma =
  | { tipo: "desligado"; motivo: string }
  | { tipo: "nao-recebe"; motivo: string }
  /** Google: a tag do navegador dispara a compra; o servidor nao conta. */
  | { tipo: "tag"; contas: number }
  | { tipo: "sem-contagem"; contas: number }
  | { tipo: "sem-pedidos"; compras: number; semClique: number; contas: number }
  | {
      tipo: "razao";
      chegaram: number;
      esperados: number;
      faltam: number;
      semClique: number;
      contas: number;
    };

function proporcao(v: { chegaram: number; esperados: number }) {
  return v.esperados > 0 ? v.chegaram / v.esperados : 1;
}

/**
 * Compras de uma plataforma numa loja. Com varias contas da mesma plataforma,
 * vale a PIOR: e a linha que diz se algo precisa de mao.
 */
export function colunaDaPlataforma(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  p: Plataforma
): ColunaPlataforma {
  const daPlataforma = loja.destinos.filter((d) => d.plataforma === p);
  const ativos = daPlataforma.filter((d) => d.ativo);
  if (!loja.ligado) {
    return {
      tipo: "desligado",
      motivo: ativos.length > 0 ? "envio desligado nesta loja" : "sem destino nesta loja",
    };
  }
  if (ativos.length === 0) {
    return {
      tipo: "desligado",
      motivo: daPlataforma.length > 0 ? "destino desativado" : "sem destino nesta loja",
    };
  }
  if (p === "google") {
    const comCompra = tagComCompra(loja).length;
    if (comCompra === 0) return { tipo: "nao-recebe", motivo: "sem rótulo da compra" };
    // A compra do Google so sai pelo pixel do checkout: sem ele, a tag nao
    // dispara venda nenhuma, e "tag ativa" seria mentira.
    if (!pixelCheckoutJaVisto(loja)) return { tipo: "nao-recebe", motivo: "falta o pixel do checkout" };
    return { tipo: "tag", contas: comCompra };
  }
  const recebem = recebemCompra(loja).filter((d) => d.plataforma === p);
  if (recebem.length === 0) {
    const emTeste = aceitamCompra(loja).some((d) => d.plataforma === p && emModoTeste(d));
    return {
      tipo: "nao-recebe",
      motivo: emTeste ? "em modo teste" : "falta o token de conversões",
    };
  }
  if (loja.contagemIndisponivel) return { tipo: "sem-contagem", contas: recebem.length };

  const melhor = melhorDa(recebem, p);
  const semClique = melhor?.contagem.semAtribPorEvento.purchase ?? 0;
  let pior: { chegaram: number; esperados: number; faltam: number } | null = null;
  let compras = 0;
  for (const d of recebem) {
    const v = vereditoDoDestino(d, loja, diag);
    if (v.tipo === "razao") {
      if (
        !pior ||
        v.faltam > pior.faltam ||
        (v.faltam === pior.faltam && proporcao(v) < proporcao(pior))
      ) {
        pior = { chegaram: v.chegaram, esperados: v.esperados, faltam: v.faltam };
      }
    } else if (v.tipo === "sem-pedidos") {
      compras = Math.max(compras, v.compras);
    }
  }
  if (pior) return { tipo: "razao", ...pior, semClique, contas: recebem.length };
  return { tipo: "sem-pedidos", compras, semClique, contas: recebem.length };
}

// ---------------------------------------------------------------------------
// Uma linha da lista.
// ---------------------------------------------------------------------------

export interface LinhaLoja {
  loja: LojaTracking;
  saude: Saude;
  colunas: Record<Plataforma, ColunaPlataforma>;
}

/**
 * `temDiag`: a pagina perguntou a Shopify sobre esta loja nesta carga (so
 * loja ligada passa pelo diagnostico). Sem isso, cobrar "nao deu para
 * conferir" seria acusar uma falha que nao houve.
 */
export function linhaDaLoja(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  temDiag: boolean
): LinhaLoja {
  const { saude } = saudeDaLoja(loja, loja.ligado, diag, temDiag);
  return {
    loja,
    saude,
    colunas: {
      meta: colunaDaPlataforma(loja, diag, "meta"),
      google: colunaDaPlataforma(loja, diag, "google"),
    },
  };
}

/** Da mais urgente para a mais tranquila. Empate mantem a ordem do servidor. */
export function ordenarLinhas(linhas: LinhaLoja[]): LinhaLoja[] {
  return [...linhas].sort((a, b) => ORDEM_SAUDE[a.saude] - ORDEM_SAUDE[b.saude]);
}

// ---------------------------------------------------------------------------
// Numeros do topo e o comparativo.
// ---------------------------------------------------------------------------

/** Chegaram de esperados numa plataforma, somando as lojas que comparam. */
export interface CoberturaPlataforma {
  chegaram: number;
  esperados: number;
  lojas: number;
}

export interface ResumoTela {
  /** Lojas na tela (ligadas ou nao). */
  total: number;
  rastreando: number;
  semDestino: number;
  /** Soma dos pedidos das lojas ligadas que a Shopify respondeu. null = nenhuma respondeu. */
  pedidos: number | null;
  /** Lojas ligadas cujos pedidos nao foram conferidos. */
  lojasSemPedidos: number;
  /**
   * Vendas que sairam para pelo menos um destino (o maior por loja, nunca a
   * soma). null = a contagem da fila falhou: zero aqui seria mentira.
   */
  enviadas: number | null;
  /**
   * Pedidos das lojas que da para comparar (lista de pedidos e contagem da
   * fila em maos). null = nenhuma loja compara.
   */
  pedidosComparaveis: number | null;
  /**
   * Pedido a pedido, por plataforma: a soma das colunas da linha (a pior conta
   * de cada loja). Separado de proposito -- o Google recebendo tudo nao pode
   * esconder o Meta sem receber nada.
   */
  porPlataforma: Record<Plataforma, CoberturaPlataforma | null>;
  /** Lojas ligadas que ficaram fora da comparacao. */
  lojasForaDaCobertura: number;
  paradas: number;
  atencao: number;
}

export function resumoDaTela(
  linhas: LinhaLoja[],
  diagnostico: Record<string, DiagnosticoLoja | undefined>
): ResumoTela {
  const ligadas = linhas.filter((l) => l.loja.ligado);
  let pedidos: number | null = null;
  let lojasSemPedidos = 0;
  let enviadas: number | null = 0;
  let pedidosComparaveis: number | null = null;
  let lojasForaDaCobertura = 0;
  const porPlataforma: Record<Plataforma, CoberturaPlataforma | null> = {
    meta: null,
    google: null,
  };

  for (const { loja, colunas } of ligadas) {
    const diag = diagnostico[loja.storeId] ?? null;
    if (diag?.pedidos7d == null) lojasSemPedidos += 1;
    else pedidos = (pedidos ?? 0) + diag.pedidos7d;

    // MAX entre os destinos, nao soma: a mesma venda rende uma linha para cada
    // conta configurada. Meta em modo teste fica fora -- vai para a aba de
    // teste, nao para a campanha. Compra de teste do dono tambem (a regra "sem
    // testes" do resto da tela): sem codigo de teste ela nem sai. Sem a
    // contagem, o total inteiro e "—".
    if (loja.contagemIndisponivel) enviadas = null;
    else if (enviadas !== null) {
      enviadas += loja.destinos
        .filter((d) => !emModoTeste(d) && !pelaTag(d))
        .reduce((m, d) => Math.max(m, numerosDoEvento(d, "purchase", false).total), 0);
    }

    // Sem lista de pedidos ou sem contagem da fila nao ha comparacao: somar
    // como zero acusaria venda perdida que nao se perdeu.
    if (loja.contagemIndisponivel || !diag?.pedidoIds) {
      lojasForaDaCobertura += 1;
      continue;
    }
    pedidosComparaveis = (pedidosComparaveis ?? 0) + diag.pedidoIds.length;
    for (const p of PLATAFORMAS) {
      const c = colunas[p];
      if (c.tipo !== "razao") continue;
      const atual = porPlataforma[p] ?? { chegaram: 0, esperados: 0, lojas: 0 };
      porPlataforma[p] = {
        chegaram: atual.chegaram + c.chegaram,
        esperados: atual.esperados + c.esperados,
        lojas: atual.lojas + 1,
      };
    }
  }

  return {
    total: linhas.length,
    rastreando: ligadas.length,
    semDestino: linhas.filter((l) => l.loja.destinos.length === 0).length,
    pedidos,
    lojasSemPedidos,
    enviadas,
    pedidosComparaveis,
    porPlataforma,
    lojasForaDaCobertura,
    paradas: ligadas.filter((l) => l.saude === "parado").length,
    atencao: ligadas.filter((l) => l.saude === "atencao").length,
  };
}

const INTEIRO = new Intl.NumberFormat("pt-BR");
const PORCENTO = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatarInteiro(n: number): string {
  return INTEIRO.format(n);
}

/** 0,745 -> "74,5%". */
export function formatarFracao(f: number): string {
  return PORCENTO.format(f);
}
