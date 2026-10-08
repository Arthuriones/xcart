// ============================================================================
// Loja da rota que o conserto nao consegue atender: pausada pela Shopify, sem
// o app, ou vitrine com senha. Sem rede e sem banco: o conserto (heal.ts), o
// cron (/api/jobs/routes/heal) e a tela usam as mesmas regras.
//
// Auditoria de producao (08/10/2026): rotas ligadas apontando para loja com
// 402, credencial revogada e vitrine com senha. O cron gastava passada nelas
// de hora em hora, falhava, e a tela dizia so "achou um problema" -- ou nada,
// no caso da vitrine com senha (o conserto morria no products.json).
// ============================================================================

import type { MotivoLojaOffline } from "@/lib/shopify/store-health";
import type { ConferenciaDosPares } from "@/lib/checkout-routes/conserto-regras";

export type MotivoForaDoAr =
  | "loja_pausada"
  | "sem_app"
  | "vitrine_fechada"
  | "loja_fechada";

export type LadoDaRota = "vitrine" | "checkout";

/**
 * Loja assim nao volta sozinha em uma hora: o lojista precisa reativar o
 * plano, reconectar ou tirar a senha. O cron so tenta de novo depois disto.
 * O "Corrigir" da tela nao espera -- o lojista pode ter acabado de resolver.
 */
export const ESPERA_LOJA_FORA_DO_AR_MS = 12 * 60 * 60 * 1000;

/** A palavra curta da tela, para selo e titulo. */
export const ROTULO_FORA_DO_AR: Record<MotivoForaDoAr, string> = {
  loja_pausada: "Pausada pela Shopify",
  sem_app: "App desconectado",
  vitrine_fechada: "Vitrine com senha",
  loja_fechada: "Fechada na Shopify",
};

/**
 * O motivo da saude da loja (store-health) que merece espera. "erro"
 * (rede, Shopify fora) nao: pode ser passageiro, o cron tenta na proxima hora.
 */
export function motivoDaSaude(motivo: MotivoLojaOffline | undefined): MotivoForaDoAr | null {
  switch (motivo) {
    case "congelada":
      return "loja_pausada";
    case "desinstalado":
    case "sem_acesso":
      return "sem_app";
    case "nao_encontrada":
      return "loja_fechada";
    default:
      return null;
  }
}

/** A frase do card, com a loja e o que fazer. */
export function mensagemForaDoAr(
  motivo: MotivoForaDoAr,
  lado: LadoDaRota,
  dominio: string
): string {
  const loja = `${lado === "vitrine" ? "A vitrine" : "A loja de checkout"} ${dominio}`;
  switch (motivo) {
    case "loja_pausada":
      return `${loja} está pausada ou sem plano na Shopify. Reative o plano no admin da Shopify.${
        lado === "checkout" ? " Enquanto isso, o checkout dela não abre para o comprador." : ""
      }`;
    case "sem_app":
      return `${loja} não dá mais acesso ao xcart (app removido ou credencial revogada). Reconecte a loja em Lojas.`;
    case "vitrine_fechada":
      return `${loja} está com senha: o xcart não consegue ler os produtos dela. Tire a senha em Loja virtual > Preferências.`;
    case "loja_fechada":
      return `${loja} não existe mais na Shopify. Tire a loja da rota ou aponte para outra.`;
  }
}

/** O que fica gravado em settings.last_heal quando a loja esta fora do ar. */
export interface ForaDoAr {
  motivo: MotivoForaDoAr;
  lado: LadoDaRota;
  /** ISO: antes disto o cron nao tenta de novo. */
  proximaTentativa: string;
}

export function foraDoAr(
  motivo: MotivoForaDoAr,
  lado: LadoDaRota,
  agora: number = Date.now()
): ForaDoAr {
  return {
    motivo,
    lado,
    proximaTentativa: new Date(agora + ESPERA_LOJA_FORA_DO_AR_MS).toISOString(),
  };
}

/**
 * O cron pode consertar este destino agora? Le o settings.last_heal do
 * destino; sem espera marcada (ou com ela vencida, ou ilegivel) = pode.
 */
export function cronPodeTentar(settings: unknown, agora: number = Date.now()): boolean {
  const ultimo = (settings as { last_heal?: { proximaTentativa?: unknown } } | null)?.last_heal;
  const proxima = typeof ultimo?.proximaTentativa === "string" ? Date.parse(ultimo.proximaTentativa) : NaN;
  return !Number.isFinite(proxima) || proxima <= agora;
}

export function ehMotivoForaDoAr(valor: unknown): valor is MotivoForaDoAr {
  return typeof valor === "string" && Object.prototype.hasOwnProperty.call(ROTULO_FORA_DO_AR, valor);
}

// ---------------------------------------------------------------------------
// O que a tela le do settings.last_heal de cada loja de checkout
// ---------------------------------------------------------------------------

/** A ultima passada do conserto numa loja de checkout, pronta para a tela. */
export interface ConsertoDoDestino {
  at: string | null;
  foraDoAr: { motivo: MotivoForaDoAr; lado: LadoDaRota } | null;
  precoDiferente: ConferenciaDosPares["precoDiferente"];
  indisponiveis: ConferenciaDosPares["indisponiveis"] | null;
}

function numero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.slice(0, 200) : "";
}

/**
 * Le o settings.last_heal (jsonb, sem garantia de forma) de um destino.
 * Campo que nao confere vira ausente; nada aqui lanca.
 */
export function lerConsertoDoDestino(raw: unknown): ConsertoDoDestino | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r.at === "string" ? r.at : null;

  const lado: LadoDaRota | null = r.lado === "vitrine" || r.lado === "checkout" ? r.lado : null;
  const fora = ehMotivoForaDoAr(r.motivo) && lado ? { motivo: r.motivo, lado } : null;

  const conf = (r.conferencia && typeof r.conferencia === "object"
    ? r.conferencia
    : {}) as Record<string, unknown>;

  let precoDiferente: ConsertoDoDestino["precoDiferente"] = null;
  const p = conf.precoDiferente as Record<string, unknown> | null | undefined;
  if (p && typeof p === "object" && typeof p.moeda === "string") {
    precoDiferente = {
      total: numero(p.total),
      moeda: p.moeda.slice(0, 8),
      exemplos: (Array.isArray(p.exemplos) ? p.exemplos : []).slice(0, 3).map((e) => {
        const x = (e || {}) as Record<string, unknown>;
        return {
          produto: texto(x.produto),
          variante: texto(x.variante),
          sku: texto(x.sku),
          vitrine: texto(x.vitrine),
          checkout: texto(x.checkout),
        };
      }),
    };
  }

  let indisponiveis: ConsertoDoDestino["indisponiveis"] = null;
  const i = conf.indisponiveis as Record<string, unknown> | null | undefined;
  if (i && typeof i === "object") {
    indisponiveis = {
      total: numero(i.total),
      inativo: numero(i.inativo),
      foraDaLoja: numero(i.foraDaLoja),
      semEstoque: numero(i.semEstoque),
      exemplos: (Array.isArray(i.exemplos) ? i.exemplos : []).slice(0, 3).flatMap((e) => {
        const x = (e || {}) as Record<string, unknown>;
        const motivo = x.motivo;
        if (motivo !== "inativo" && motivo !== "fora_da_loja" && motivo !== "sem_estoque") return [];
        return [{ produto: texto(x.produto), variante: texto(x.variante), sku: texto(x.sku), motivo }];
      }),
    };
  }

  return { at, foraDoAr: fora, precoDiferente, indisponiveis };
}
