import {
  getShopInfo,
  ShopifyClientError,
  type ShopifyCredentials,
} from "@/lib/shopify/client";

// ============================================================================
// Alcancabilidade de uma loja Shopify.
//
// Uma auditoria em producao encontrou 13 de 44 lojas conectadas inalcancaveis
// (plano vencido, app desinstalado, token revogado) e 6 de 13 rotas LIGADAS
// apontando para uma delas. O app nao dizia nada: o painel mostrava a rota
// verde enquanto todo cliente que clicava em finalizar caia num checkout que
// nao carrega.
//
// O motivo importa porque a acao muda: loja congelada o lojista resolve no
// admin da Shopify; app desinstalado exige reconectar aqui.
// ============================================================================

export type MotivoLojaOffline =
  | "congelada"
  | "desinstalado"
  | "sem_acesso"
  | "nao_encontrada"
  | "erro";

export interface SaudeDaLoja {
  ok: boolean;
  motivo?: MotivoLojaOffline;
  /** Texto pronto para mostrar ao lojista, ja com o que fazer. */
  mensagem?: string;
  detalhe?: string;
  /** Nome atual da loja na Shopify (o do banco pode ser velho). */
  nome?: string;
  /** Moeda da loja (currencyCode), para comparar preco entre as duas. */
  moeda?: string;
}

/**
 * O codigo do erro do cliente vem antes do texto: "Client ID ou Client Secret
 * invalidos" (credencial revogada) nao tem 401 nem "token" na frase e caia
 * em "erro" generico -- o cron tentava de novo toda hora.
 */
function motivoPeloCodigo(erro: unknown): MotivoLojaOffline | null {
  if (!(erro instanceof ShopifyClientError)) return null;
  if (erro.code === "APP_NOT_INSTALLED") return "desinstalado";
  if (erro.code === "INVALID_CREDENTIALS") return "sem_acesso";
  if (erro.statusCode === 402) return "congelada";
  if (erro.statusCode === 401 || erro.statusCode === 403) return "sem_acesso";
  return null;
}

function classificar(msg: string, codigo?: MotivoLojaOffline | null): {
  motivo: MotivoLojaOffline;
  mensagem: string;
} {
  if (codigo === "congelada" || (!codigo && /402|payment required|pausada|congelada|sem plano/i.test(msg))) {
    return {
      motivo: "congelada",
      mensagem:
        "A loja esta pausada ou sem plano ativo na Shopify. Reative o plano no admin da Shopify — enquanto isso o checkout nao carrega para o cliente.",
    };
  }
  if (codigo === "desinstalado" || (!codigo && /application_cannot_be_found|nao esta instalado|not installed/i.test(msg))) {
    return {
      motivo: "desinstalado",
      mensagem:
        "O app nao esta mais instalado nessa loja. Reconecte a loja em Lojas para a rota voltar a funcionar.",
    };
  }
  if (codigo === "sem_acesso" || /401|403|unauthorized|forbidden|token/i.test(msg)) {
    return {
      motivo: "sem_acesso",
      mensagem:
        "As credenciais dessa loja foram revogadas ou expiraram. Reconecte a loja em Lojas.",
    };
  }
  if (/404|not found/i.test(msg)) {
    return {
      motivo: "nao_encontrada",
      mensagem:
        "Essa loja nao existe mais na Shopify. Remova a rota ou aponte para outra loja.",
    };
  }
  return {
    motivo: "erro",
    mensagem: "Nao foi possivel falar com essa loja na Shopify.",
  };
}

export async function verificarLoja(
  creds: ShopifyCredentials
): Promise<SaudeDaLoja> {
  try {
    const info = (await getShopInfo(creds)) as
      | { shop?: { name?: string; currencyCode?: string } }
      | null
      | undefined;
    return {
      ok: true,
      ...(info?.shop?.name ? { nome: info.shop.name } : {}),
      ...(info?.shop?.currencyCode ? { moeda: info.shop.currencyCode } : {}),
    };
  } catch (erro) {
    const detalhe = erro instanceof Error ? erro.message : String(erro);
    const { motivo, mensagem } = classificar(detalhe, motivoPeloCodigo(erro));
    return { ok: false, motivo, mensagem, detalhe: detalhe.slice(0, 300) };
  }
}

/** Checa as duas pontas de uma rota de uma vez. */
export async function verificarParDaRota(
  vitrine: ShopifyCredentials,
  checkout: ShopifyCredentials
) {
  const [source, target] = await Promise.all([
    verificarLoja(vitrine),
    verificarLoja(checkout),
  ]);
  return {
    source,
    target,
    ok: source.ok && target.ok,
    // A vitrine vem primeiro: se ela esta fora, nem existe trafego para rotear.
    mensagem: !source.ok
      ? `Loja vitrine (${vitrine.shopDomain}): ${source.mensagem}`
      : !target.ok
        ? `Loja de checkout (${checkout.shopDomain}): ${target.mensagem}`
        : undefined,
  };
}
