import { diaNoFuso, somarDias, FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import { diaCurto, horaNoFuso } from "@/components/layout/contexto";
import type { StoreRole } from "@/lib/checkout-routes/store-roles";

// ============================================================================
// Regras da tela Lojas, sem React e sem banco: o estado da conexao de cada
// loja, a acao sugerida, o inventario do que some ao remover e as frases que
// o lojista le. Puro para o vitest travar -- e importado pelo servidor
// (resumo-lojas.ts) e pelo cliente (a lista e o assistente de conexao).
// ============================================================================

/**
 * Estado da conexao. As chaves de "sem acesso" batem com STATUS.loja da
 * fundacao (status-badge.tsx); "falhaSync" e a loja que conecta mas cuja
 * ultima rodada de pedidos falhou por outro motivo -- continua entre as ativas.
 */
export type ChaveConexao =
  | "conectada"
  | "falhaSync"
  | "semPermissao"
  | "tokenInvalido"
  | "appDesinstalado"
  | "pausada";

export type SugestaoLoja = "reconectar" | "remover" | "sincronizar" | null;

export interface EntradaConexao {
  /** stores.uninstalled_at: o webhook app/uninstalled gravou. */
  desinstaladaEm: string | null;
  /** A linha de fin_sync_state da loja; null = nunca sincronizou. */
  sync: {
    ultimoErro: string | null;
    ultimoErroTipo: "negado" | "falhou" | null;
    ultimoSyncOkEm: string | null;
    cargaInicialOk: boolean;
  } | null;
}

export interface EstadoConexao {
  chave: ChaveConexao;
  /** Vai para a aba "Sem acesso": a Shopify nao deixa ler a loja. */
  semAcesso: boolean;
  /** A linha de apoio embaixo do selo: "Falta a permissão de pedidos", "desde 12/09". */
  detalhe: string;
  /** Desde quando a loja esta assim (ISO), quando se sabe. */
  desde: string | null;
  sugestao: SugestaoLoja;
}

/** 402 da Shopify = loja pausada, congelada ou sem plano (ver shopify/client.ts). */
const RE_PAUSADA = /\b402\b|payment required|pausad|frozen|congelad|\b423\b|locked/i;

/**
 * Credencial que nao vale mais. As frases sao as que o client da Shopify
 * grava em ultimo_erro (getAccessToken) e o 401 cru da Admin API.
 */
const RE_TOKEN =
  /invalid_credentials|client id ou client secret|invalid api key|invalid_client|\b401\b|unauthorized|n[aã]o est[aá] instalado|application_cannot_be_found|app_not_installed/i;

function desdeTexto(iso: string | null, fuso = FUSO_RELATORIO_PADRAO): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `desde ${diaCurto(diaNoFuso(new Date(ms), fuso))}`;
}

/**
 * O estado da conexao de uma loja, pelo que o banco ja sabe: a marca de
 * desinstalacao e o ultimo erro da sincronizacao de pedidos. Nao pergunta a
 * Shopify -- a tela abre sem depender dela.
 */
export function estadoConexao(e: EntradaConexao): EstadoConexao {
  if (e.desinstaladaEm) {
    return {
      chave: "appDesinstalado",
      semAcesso: true,
      detalhe: desdeTexto(e.desinstaladaEm) ?? "O app saiu da loja",
      desde: e.desinstaladaEm,
      sugestao: "remover",
    };
  }

  const s = e.sync;
  const erro = s?.ultimoErro ?? "";
  const parouEm = s?.ultimoSyncOkEm ?? null;

  if (s?.ultimoErroTipo === "negado") {
    return {
      chave: "semPermissao",
      semAcesso: true,
      detalhe: "Falta a permissão de pedidos",
      desde: parouEm,
      sugestao: "reconectar",
    };
  }
  if (erro && RE_PAUSADA.test(erro)) {
    return {
      chave: "pausada",
      semAcesso: true,
      detalhe: "Pausada ou sem plano na Shopify",
      desde: parouEm,
      sugestao: "remover",
    };
  }
  if (erro && RE_TOKEN.test(erro)) {
    return {
      chave: "tokenInvalido",
      semAcesso: true,
      detalhe: desdeTexto(parouEm) ?? "A credencial não vale mais",
      desde: parouEm,
      sugestao: "reconectar",
    };
  }
  if (erro) {
    return {
      chave: "falhaSync",
      semAcesso: false,
      detalhe: "A última busca de pedidos falhou",
      desde: null,
      sugestao: "sincronizar",
    };
  }
  return {
    chave: "conectada",
    semAcesso: false,
    detalhe: !s
      ? "Primeira busca de pedidos pendente"
      : s.cargaInicialOk
        ? "Pedidos em dia"
        : "Puxando os pedidos dos últimos 60 dias",
    desde: null,
    sugestao: null,
  };
}

/** Selo de cada estado. Tons iguais aos de STATUS.loja. */
export const SELO_CONEXAO: Record<
  ChaveConexao,
  { tom: "ok" | "warn" | "err" | "neutral"; texto: string }
> = {
  conectada: { tom: "ok", texto: "Conectada" },
  falhaSync: { tom: "warn", texto: "Falha ao sincronizar" },
  semPermissao: { tom: "err", texto: "Sem permissão" },
  tokenInvalido: { tom: "warn", texto: "Token inválido" },
  appDesinstalado: { tom: "neutral", texto: "App desinstalado" },
  pausada: { tom: "neutral", texto: "Pausada" },
};

/** Ordem para ordenar a coluna Conexão: o que pede mão primeiro. */
export const ORDEM_CONEXAO: Record<ChaveConexao, number> = {
  semPermissao: 0,
  tokenInvalido: 1,
  falhaSync: 2,
  pausada: 3,
  appDesinstalado: 4,
  conectada: 5,
};

export const ROTULO_SUGESTAO: Record<Exclude<SugestaoLoja, null>, string> = {
  reconectar: "Reconectar",
  remover: "Remover do xcart",
  sincronizar: "Tentar de novo",
};

// ---------------------------------------------------------------------------
// Datas e textos curtos
// ---------------------------------------------------------------------------

/**
 * "hoje, 14:28" / "ontem, 09:12" / "12/09, 14:28" / "12/09/2025". Null quando
 * nao ha data -- a tela mostra "—".
 */
export function quandoFoi(
  iso: string | null | undefined,
  agora: Date,
  fuso = FUSO_RELATORIO_PADRAO
): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const dia = diaNoFuso(new Date(ms), fuso);
  const hoje = diaNoFuso(agora, fuso);
  const hora = horaNoFuso(ms, fuso);
  if (dia === hoje) return `hoje, ${hora}`;
  if (dia === somarDias(hoje, -1)) return `ontem, ${hora}`;
  if (dia.slice(0, 4) !== hoje.slice(0, 4)) {
    return `${diaCurto(dia)}/${dia.slice(0, 4)}`;
  }
  return `${diaCurto(dia)}, ${hora}`;
}

/** "DD/MM" de um instante, ou null. */
export function diaDe(iso: string | null | undefined, fuso = FUSO_RELATORIO_PADRAO): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return diaCurto(diaNoFuso(new Date(ms), fuso));
}

const NOMES_IDIOMA: Record<string, string> = {
  pt: "português",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  de: "alemão",
  it: "italiano",
  ja: "japonês",
  nl: "holandês",
  pl: "polonês",
  sv: "sueco",
  da: "dinamarquês",
  fi: "finlandês",
  no: "norueguês",
  ko: "coreano",
  zh: "chinês",
};

/** "en-US" -> "inglês". Codigo desconhecido volta como veio; vazio vira null. */
export function nomeIdioma(codigo: string | null | undefined): string | null {
  const base = String(codigo || "").trim().split(/[-_]/)[0].toLowerCase();
  if (!base) return null;
  if (NOMES_IDIOMA[base]) return NOMES_IDIOMA[base];
  try {
    const nome = new Intl.DisplayNames(["pt-BR"], { type: "language" }).of(base);
    return nome && nome !== base ? nome.toLowerCase() : base;
  } catch {
    return base;
  }
}

/** "USD · inglês", "USD", "inglês" ou "—". */
export function moedaIdioma(moeda: string | null | undefined, idioma: string | null | undefined): string {
  const partes = [moeda ? String(moeda).toUpperCase() : null, nomeIdioma(idioma)].filter(Boolean);
  return partes.length ? partes.join(" · ") : "—";
}

export function rotuloPapel(papel: StoreRole): string {
  switch (papel) {
    case "vitrine":
      return "Vitrine";
    case "checkout":
      return "Checkout";
    case "both":
      return "Vitrine e checkout";
    default:
      return "Sem rota";
  }
}

/** "1 pedido" / "3 pedidos", com milhar em pt-BR. */
export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// Filtro da lista
// ---------------------------------------------------------------------------

export type GrupoLojas = "ativas" | "semAcesso" | "todas";

/** Grupo + busca por nome ou dominio, sem diferenciar caixa nem acento. */
export function filtrarLojas<T extends { semAcesso: boolean; nome: string; dominio: string }>(
  lojas: T[],
  grupo: GrupoLojas,
  busca: string
): T[] {
  const termo = normalizar(busca);
  return lojas.filter((l) => {
    if (grupo === "ativas" && l.semAcesso) return false;
    if (grupo === "semAcesso" && !l.semAcesso) return false;
    if (!termo) return true;
    return normalizar(`${l.nome} ${l.dominio}`).includes(termo);
  });
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Remover: o inventario do que some
// ---------------------------------------------------------------------------

/** Contagens reais do que a remocao leva (ou deixa sem loja). */
export interface InventarioLoja {
  produtos: number;
  materiais: number;
  temLogo: boolean;
  /** Rotas em que a loja e a vitrine: a rota inteira some. */
  rotasComoVitrine: number;
  /** Destinos de rota em que ela e a loja de checkout. */
  destinosComoCheckout: number;
  destinosRastreamento: number;
  rastreamentoLigado: boolean;
  /** fin_orders da loja. */
  pedidos: number;
  custos: number;
  alertas: number;
  /** ad_accounts ligadas a ela: nao somem, ficam sem loja. */
  contasAnuncio: number;
}

/**
 * As frases do dialogo de remocao: o que e apagado e o que fica. Cada item so
 * aparece com numero real maior que zero -- nada de "0 produtos".
 */
export function itensInventario(inv: InventarioLoja): { apaga: string[]; fica: string[] } {
  const apaga: string[] = [];
  if (inv.produtos > 0) apaga.push(`${plural(inv.produtos, "produto importado", "produtos importados")}`);
  if (inv.materiais > 0 || inv.temLogo) {
    const partes = [
      inv.materiais > 0 ? plural(inv.materiais, "material de marca", "materiais de marca") : null,
      inv.temLogo ? "a logo" : null,
    ].filter(Boolean);
    apaga.push(partes.join(" e "));
  }
  if (inv.rotasComoVitrine > 0) {
    apaga.push(
      `${plural(inv.rotasComoVitrine, "rota", "rotas")} em que ela é a vitrine — o carrinho dela deixa de ser roteado`
    );
  }
  if (inv.destinosComoCheckout > 0) {
    apaga.push(
      `${plural(inv.destinosComoCheckout, "destino de rota", "destinos de rota")} em que ela é a loja de checkout — a vitrine perde esse destino`
    );
  }
  if (inv.destinosRastreamento > 0 || inv.rastreamentoLigado) {
    const base =
      inv.destinosRastreamento > 0
        ? `${plural(inv.destinosRastreamento, "destino de rastreamento", "destinos de rastreamento")} e o histórico de envios`
        : "A configuração de rastreamento e o histórico de envios";
    apaga.push(inv.rastreamentoLigado ? `${base} (o rastreamento está ligado)` : base);
  }
  if (inv.pedidos > 0) {
    apaga.push(`${plural(inv.pedidos, "pedido sincronizado", "pedidos sincronizados")} e o histórico de lucro`);
  }
  if (inv.custos > 0) apaga.push(plural(inv.custos, "custo de produto", "custos de produto"));
  if (inv.alertas > 0) apaga.push(plural(inv.alertas, "alerta", "alertas"));

  const fica: string[] = [];
  if (inv.contasAnuncio > 0) {
    fica.push(
      `${plural(inv.contasAnuncio, "conta de anúncio continua", "contas de anúncio continuam")} no xcart, sem loja ligada — o gasto sai do lucro até você ligar outra loja`
    );
  }
  return { apaga, fica };
}

// ---------------------------------------------------------------------------
// Conectar: erro cru da API ou do retorno da Shopify -> frase humana
// ---------------------------------------------------------------------------

/**
 * A API de conexao e o retorno do OAuth devolvem texto tecnico, em ingles ou
 * sem acento ("Failed to save store", "Unauthorized", "Sessao de instalacao
 * invalida"). Isto traduz para o que o lojista pode fazer. O texto cru fica
 * para o "Ver detalhe".
 */
export const MENSAGEM_CONEXAO_PADRAO =
  "Não deu para conectar a loja agora. Tente de novo; se continuar, confira o domínio e as credenciais.";

export function mensagemConexao(erro: string | null | undefined, status?: number): string {
  const e = String(erro || "");
  if (status === 401 || /^unauthorized$/i.test(e.trim())) {
    return "Sua sessão expirou. Entre de novo e tente outra vez.";
  }
  if (/client id ou client secret|invalid_credentials|invalid_client/i.test(e)) {
    return "O Client ID ou o Client Secret não confere. Copie os dois de novo na página do app, em dev.shopify.com.";
  }
  if (/\b402\b|payment required|pausad|sem plano/i.test(e)) {
    return "A Shopify recusou porque a loja está pausada ou sem plano. Ative um plano na loja e tente de novo.";
  }
  if (/sess[aã]o de instala[cç][aã]o/i.test(e)) {
    return "A autorização expirou ou foi aberta em outro navegador. Comece a conexão de novo, neste navegador.";
  }
  if (/assinatura do callback/i.test(e)) {
    return "A resposta da Shopify não confere com este app. Confira se o Client Secret é do mesmo app.";
  }
  if (/loja do callback/i.test(e)) {
    return "A loja autorizada na Shopify é outra. Autorize a mesma loja que você informou aqui.";
  }
  if (/sem par[aâ]metros|url de redirecionamento/i.test(e)) {
    return "A URL de redirecionamento do app está diferente. Ela precisa terminar exatamente em /api/shopify/auth.";
  }
  if (/cadastre a loja/i.test(e)) {
    return "Comece por aqui: informe o domínio e as credenciais antes de instalar o app.";
  }
  if (/trocar o c[oó]digo|token de acesso|erro de rede/i.test(e)) {
    return "A Shopify não confirmou a autorização. Tente conectar de novo.";
  }
  if (/dom[ií]nio/i.test(e)) {
    return "Não encontramos essa loja. Use o domínio que termina em .myshopify.com.";
  }
  if (/failed to save|falha ao salvar/i.test(e)) {
    return "Não deu para salvar a loja agora. Tente de novo em instantes.";
  }
  return MENSAGEM_CONEXAO_PADRAO;
}
