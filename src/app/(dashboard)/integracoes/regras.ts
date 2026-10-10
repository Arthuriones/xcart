import type { TomStatus } from "@/components/ui/status-badge";
import { diaNoFuso, type ContaAnuncioResumo } from "@/lib/financeiro/tipos";
import { horaNoFuso } from "@/components/layout/contexto";
import type { GastoDaConta, ValorGasto } from "@/lib/leitura/gasto-por-conta-soma";
import type {
  DestinoDeCompra,
  LojaConexao,
  ResumoIntegracoes,
} from "@/lib/leitura/integracoes";
import type { CheckoutResumo } from "@/lib/checkouts-externos/tipos";

// ============================================================================
// Regras da tela Integracoes, sem React e sem banco: a situacao de cada conta,
// os filtros, o estado de cada destino, de cada loja e do menu de plataformas.
//
// Uma regra, um lugar: o selo da linha, o contador do filtro e o ponto do menu
// leem daqui -- se cada um decidisse do seu jeito, o menu diria "tudo certo"
// com uma linha vermelha na tabela. O vitest importa este arquivo direto
// (os imports de leitura sao so de TIPO).
// ============================================================================

export interface Estado {
  tom: TomStatus;
  texto: string;
  /** Uma linha de apoio: "às 14:30", "gasto fora do lucro". */
  detalhe?: string | null;
}

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "às 14:30" se foi hoje no fuso; senao "em 28/09 às 14:30". */
export function quando(iso: string, agoraMs: number, fuso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const hora = horaNoFuso(ms, fuso);
  const dia = diaNoFuso(new Date(ms), fuso);
  if (dia === diaNoFuso(new Date(agoraMs), fuso)) return `às ${hora}`;
  return `em ${dia.slice(8, 10)}/${dia.slice(5, 7)} às ${hora}`;
}

/** 1234567890 -> 123-456-7890, como o Google Ads mostra. */
export function formatarCustomerId(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/** "America/New_York" -> "New York". */
export function cidadeDoFuso(fuso: string | null): string | null {
  if (!fuso) return null;
  return fuso.split("/").pop()?.replace(/_/g, " ") || null;
}

/** "A, B e C" / "A, B e mais 3". */
export function listarNomes(nomes: string[], maximo = 3): string {
  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  if (nomes.length <= maximo) return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${nomes.slice(0, maximo).join(", ")} e mais ${nomes.length - maximo}`;
}

// ---------------------------------------------------------------------------
// Conta de anuncio
// ---------------------------------------------------------------------------

/** Mesmos limites do alerta "gasto sem atualizar" (src/lib/alertas/avaliar.ts). */
export const ATRASO_META_MS = 90 * 60 * 1000;
export const ATRASO_GOOGLE_MS = 3 * 60 * 60 * 1000;

export type GrupoConta = "ok" | "aguardando" | "semLoja" | "problema" | "pausada";

export interface SituacaoConta extends Estado {
  grupo: GrupoConta;
}

/** Ordem na tabela quando se ordena por situacao: o que pede acao primeiro. */
export const ORDEM_GRUPO: Record<GrupoConta, number> = {
  problema: 0,
  semLoja: 1,
  aguardando: 2,
  ok: 3,
  pausada: 4,
};

type ContaParaSituacao = Pick<
  ContaAnuncioResumo,
  "plataforma" | "ativo" | "store_id" | "temSegredo" | "ultimo_erro" | "ultimo_sync_ok_em"
> &
  Partial<Pick<ContaAnuncioResumo, "checkout_id">>;

/**
 * A situacao de uma conta. Pausada vem antes do erro: o cron nao le conta
 * pausada, entao o erro dela e velho e nao pede acao.
 */
export function situacaoDaConta(c: ContaParaSituacao, agoraMs: number, fuso: string): SituacaoConta {
  const meta = c.plataforma === "meta";
  if (!c.ativo) {
    return {
      grupo: "pausada",
      tom: "neutral",
      texto: "Pausada",
      detalhe: meta ? "o xcart não lê o gasto dela" : "o envio do script é ignorado",
    };
  }
  if (c.ultimo_erro) return { grupo: "problema", tom: "err", texto: "Erro", detalhe: c.ultimo_erro };
  // Ligada a um checkout externo (069) conta como ligada.
  if (!c.store_id && !c.checkout_id) {
    return { grupo: "semLoja", tom: "warn", texto: "Sem loja", detalhe: "gasto fora do lucro" };
  }
  if (meta && !c.temSegredo) {
    return { grupo: "problema", tom: "warn", texto: "Sem token", detalhe: "cole o token de leitura de novo" };
  }
  const ultimo = c.ultimo_sync_ok_em ? Date.parse(c.ultimo_sync_ok_em) : NaN;
  if (!Number.isFinite(ultimo)) {
    return {
      grupo: "aguardando",
      tom: "run",
      texto: "Aguardando",
      detalhe: meta ? "primeira leitura em até 15 min" : "o script ainda não enviou",
    };
  }
  const limite = meta ? ATRASO_META_MS : ATRASO_GOOGLE_MS;
  const desde = quando(c.ultimo_sync_ok_em!, agoraMs, fuso);
  if (agoraMs - ultimo > limite) {
    return {
      grupo: "problema",
      tom: "warn",
      texto: "Atrasada",
      detalhe: meta ? `última leitura ${desde}` : `último envio ${desde}`,
    };
  }
  return { grupo: "ok", tom: "ok", texto: "Atualizada", detalhe: meta ? desde : `recebido ${desde}` };
}

// ---------------------------------------------------------------------------
// Filtros e busca da lista de contas
// ---------------------------------------------------------------------------

export type FiltroConta = "todas" | "ligadas" | "semLoja" | "problema" | "pausadas";

export const FILTROS: { id: FiltroConta; rotulo: string }[] = [
  { id: "todas", rotulo: "Todas" },
  { id: "ligadas", rotulo: "Ligadas" },
  { id: "semLoja", rotulo: "Sem loja" },
  { id: "problema", rotulo: "Com erro" },
  { id: "pausadas", rotulo: "Pausadas" },
];

export function passaNoFiltro(grupo: GrupoConta, filtro: FiltroConta): boolean {
  switch (filtro) {
    case "ligadas":
      return grupo === "ok" || grupo === "aguardando";
    case "semLoja":
      return grupo === "semLoja";
    case "problema":
      return grupo === "problema";
    case "pausadas":
      return grupo === "pausada";
    default:
      return true;
  }
}

export function contarFiltros(grupos: GrupoConta[]): Record<FiltroConta, number> {
  const saida = { todas: 0, ligadas: 0, semLoja: 0, problema: 0, pausadas: 0 } as Record<FiltroConta, number>;
  for (const g of grupos) {
    for (const f of FILTROS) if (passaNoFiltro(g, f.id)) saida[f.id] += 1;
  }
  return saida;
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca por nome ou ID ("act_123", "123-456-7890" e "1234567890" valem). */
export function casaBusca(c: Pick<ContaAnuncioResumo, "nome" | "external_id">, busca: string): boolean {
  const q = semAcento(busca.trim());
  if (!q) return true;
  if (semAcento(c.nome ?? "").includes(q)) return true;
  const digitos = q.replace(/^act_/, "").replace(/\D/g, "");
  return digitos.length > 0 && c.external_id.includes(digitos);
}

// ---------------------------------------------------------------------------
// Gasto na tela
// ---------------------------------------------------------------------------

export interface TextoGasto {
  /** O numero principal: "R$ 1.234,56" (ou na moeda da conta, sem cotacao). */
  texto: string;
  /** O valor na moeda da conta ("US$ 232,10") ou "sem cotação". */
  detalhe: string | null;
  /** Valor cru para ordenar (na moeda do texto). */
  valor: number;
}

function dinheiro(valor: number, moeda: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
  } catch {
    return `${valor.toFixed(2)} ${moeda}`;
  }
}

export function textoDoGasto(v: ValorGasto | null, moedaRelatorio: string): TextoGasto | null {
  if (!v) return null;
  if (!v.convertido) {
    return {
      texto: dinheiro(v.original, v.moedaOriginal),
      detalhe: "sem cotação",
      valor: v.original,
    };
  }
  const mesmaMoeda = v.moedaOriginal === moedaRelatorio.toUpperCase();
  return {
    texto: `${v.aproximado ? "≈ " : ""}${dinheiro(v.valor, moedaRelatorio)}`,
    detalhe: mesmaMoeda ? null : dinheiro(v.original, v.moedaOriginal),
    valor: v.valor,
  };
}

export interface GastoNaTela {
  hoje: TextoGasto | null;
  periodo: TextoGasto | null;
  /** "desde 12/09" quando o periodo nao tem todos os dias com dado. */
  parcial: string | null;
}

export function gastoNaTela(g: GastoDaConta | undefined, moedaRelatorio: string): GastoNaTela {
  if (!g) return { hoje: null, periodo: null, parcial: null };
  const parcial =
    g.periodo && g.primeiroDia && g.diasComDado < g.diasNoPeriodo
      ? `desde ${g.primeiroDia.slice(8, 10)}/${g.primeiroDia.slice(5, 7)}`
      : null;
  return {
    hoje: textoDoGasto(g.hoje, moedaRelatorio),
    periodo: textoDoGasto(g.periodo, moedaRelatorio),
    parcial,
  };
}

// ---------------------------------------------------------------------------
// Leitura do gasto (o token do Meta, os scripts do Google)
// ---------------------------------------------------------------------------

type ContaParaToken = Pick<ContaAnuncioResumo, "ativo" | "temSegredo" | "ultimo_erro" | "ultimo_sync_ok_em">;

/** O token de leitura do Meta, visto pelas contas que ele alimenta. */
export function estadoTokenMeta(contas: ContaParaToken[]): Estado {
  if (contas.length === 0) return { tom: "neutral", texto: "Não ligado" };
  if (!contas.some((c) => c.temSegredo)) {
    return { tom: "warn", texto: "Sem token", detalhe: "Cole o token de leitura de novo." };
  }
  // O sync grava "Token do Meta recusado (190)..." em ultimo_erro.
  if (contas.some((c) => c.ativo && c.ultimo_erro && /\b190\b|token/i.test(c.ultimo_erro))) {
    return { tom: "err", texto: "Recusado", detalhe: "O Meta recusou o token. Gere outro e troque aqui." };
  }
  if (contas.some((c) => c.ultimo_sync_ok_em)) return { tom: "ok", texto: "Válido" };
  return { tom: "run", texto: "Aguardando a primeira leitura" };
}

/** Os scripts do Google, vistos pela situacao de cada conta. */
export function estadoScriptsGoogle(situacoes: SituacaoConta[]): Estado {
  const ativas = situacoes.filter((s) => s.grupo !== "pausada");
  if (situacoes.length === 0) return { tom: "neutral", texto: "Nenhuma conta" };
  const problemas = ativas.filter((s) => s.grupo === "problema").length;
  if (problemas > 0) return { tom: "warn", texto: "Atenção", detalhe: `${plural(problemas, "conta", "contas")} sem envio recente ou com erro.` };
  if (ativas.some((s) => s.grupo === "aguardando")) return { tom: "run", texto: "Aguardando o primeiro envio" };
  if (ativas.length === 0) return { tom: "neutral", texto: "Todas pausadas" };
  return { tom: "ok", texto: "Recebendo" };
}

// ---------------------------------------------------------------------------
// Destino de conversao (enviar as compras)
// ---------------------------------------------------------------------------

type DestinoParaEstado = Pick<
  DestinoDeCompra,
  "ativo" | "temToken" | "rotulos" | "rotuloCompra" | "modoTeste" | "alertas"
> & { plataforma: "meta" | "google" };

/**
 * Estado de um destino, so com o que esta gravado e os alertas abertos dele.
 * "Configurado" e nao "Enviando": sem a contagem de eventos (que mora em
 * Saude dos pixels) esta tela nao sabe se a compra esta chegando.
 */
export function estadoDoDestino(d: DestinoParaEstado): Estado {
  if (!d.ativo) return { tom: "neutral", texto: "Desativado" };
  if (d.plataforma === "meta" && !d.temToken) {
    return { tom: "err", texto: "Sem token", detalhe: "sem o token de conversões nenhuma compra sai" };
  }
  if (d.plataforma === "google" && d.rotulos === 0) {
    return { tom: "err", texto: "Incompleto", detalhe: "falta configurar ao menos um evento" };
  }
  if (d.alertas.includes("meta_capi_token")) {
    return { tom: "err", texto: "Token recusado", detalhe: "o Meta recusou o token na última hora" };
  }
  if (d.alertas.includes("envio_falhando")) {
    return { tom: "err", texto: "Falhando", detalhe: "uma compra não chegou na última hora" };
  }
  if (d.plataforma === "meta" && d.modoTeste) {
    return { tom: "info", texto: "Modo teste", detalhe: "o evento não conta como conversão" };
  }
  if (d.plataforma === "google" && !d.rotuloCompra) {
    return { tom: "warn", texto: "Sem rótulo de compra", detalhe: "a compra não é enviada" };
  }
  return { tom: "ok", texto: "Configurado" };
}

// ---------------------------------------------------------------------------
// Loja Shopify
// ---------------------------------------------------------------------------

export function estadoDaLoja(l: Pick<LojaConexao, "desinstaladaEm" | "sync">, agoraMs: number, fuso: string): Estado & { ordem: number } {
  if (l.desinstaladaEm) {
    const ms = Date.parse(l.desinstaladaEm);
    const dia = Number.isFinite(ms) ? diaNoFuso(new Date(ms), fuso) : null;
    return {
      ordem: 2,
      tom: "neutral",
      texto: "App desinstalado",
      detalhe: dia ? `desde ${dia.slice(8, 10)}/${dia.slice(5, 7)}` : "reinstale em Lojas",
    };
  }
  const s = l.sync;
  if (s?.ultimoErroTipo === "negado") {
    return { ordem: 0, tom: "err", texto: "Sem permissão", detalhe: "a Shopify não deixa ler os pedidos" };
  }
  if (s?.ultimoErroTipo === "falhou") {
    return { ordem: 1, tom: "warn", texto: "Erro na leitura", detalhe: s.ultimoErro || "a última leitura de pedidos falhou" };
  }
  if (s?.ultimoSyncOkEm) {
    return { ordem: 4, tom: "ok", texto: "Conectada", detalhe: `pedidos lidos ${quando(s.ultimoSyncOkEm, agoraMs, fuso)}` };
  }
  return { ordem: 3, tom: "run", texto: "Aguardando", detalhe: "primeira leitura dos pedidos em até 15 min" };
}

/** Fora dos totais: a Shopify nao deixa ler (ou o app saiu). */
export function semAcesso(l: Pick<LojaConexao, "desinstaladaEm" | "sync">): boolean {
  return Boolean(l.desinstaladaEm) || l.sync?.ultimoErroTipo === "negado";
}

// ---------------------------------------------------------------------------
// Checkout externo (069)
// ---------------------------------------------------------------------------

/** Sem evento ha mais que isto (com o checkout ativo): aviso. */
export const CHECKOUT_PARADO_MS = 3 * 24 * 60 * 60 * 1000;

/** "há 5 min", "há 3 h", "há 2 dias". */
export function haQuantoTempo(iso: string, agoraMs: number): string {
  const ms = agoraMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** " · afiliado ywq2mdhu", " · afiliados a, b", " · afiliados a, b +2". Nenhum = "". */
export function rotuloAfiliados(contas: string[] | undefined): string {
  if (!contas || contas.length === 0) return "";
  if (contas.length === 1) return ` · afiliado ${contas[0]}`;
  const mais = contas.length > 2 ? ` +${contas.length - 2}` : "";
  return ` · afiliados ${contas.slice(0, 2).join(", ")}${mais}`;
}

type CheckoutParaEstado = Pick<
  CheckoutResumo,
  "ativo" | "ultimo_evento_em" | "ultimo_evento_teste" | "ultimo_erro" | "ultimo_erro_em"
>;

/**
 * A situacao de um checkout externo. O erro so vale se for mais novo que o
 * ultimo evento aceito (o evento seguinte limpa, mas o teste de outra aba
 * pode chegar depois).
 */
export function estadoDoCheckout(c: CheckoutParaEstado, agoraMs: number, fuso: string): Estado & { ordem: number } {
  if (!c.ativo) return { ordem: 4, tom: "neutral", texto: "Pausado", detalhe: "pedido novo não entra; os que já estão seguem atualizando" };
  const eventoMs = c.ultimo_evento_em ? Date.parse(c.ultimo_evento_em) : NaN;
  const erroMs = c.ultimo_erro_em ? Date.parse(c.ultimo_erro_em) : NaN;
  if (c.ultimo_erro && (!Number.isFinite(eventoMs) || !(erroMs < eventoMs))) {
    return { ordem: 0, tom: "err", texto: "Erro", detalhe: c.ultimo_erro };
  }
  if (!c.ultimo_evento_em || !Number.isFinite(eventoMs)) {
    return { ordem: 1, tom: "run", texto: "Aguardando o 1º evento", detalhe: "cole a URL no painel da plataforma" };
  }
  if (c.ultimo_evento_teste) {
    return { ordem: 2, tom: "info", texto: "Teste recebido", detalhe: quando(c.ultimo_evento_em, agoraMs, fuso) };
  }
  if (agoraMs - eventoMs > CHECKOUT_PARADO_MS) {
    return { ordem: 1, tom: "warn", texto: "Sem eventos", detalhe: `último ${haQuantoTempo(c.ultimo_evento_em, agoraMs)}` };
  }
  return { ordem: 3, tom: "ok", texto: "Recebendo", detalhe: `último evento ${haQuantoTempo(c.ultimo_evento_em, agoraMs)}` };
}

// ---------------------------------------------------------------------------
// Menu de plataformas
// ---------------------------------------------------------------------------

export type IdPlataforma = "meta" | "google" | "shopify" | "checkouts" | "notificacoes" | "avancado";

export type EstadosNav = Record<IdPlataforma, Estado | null>;

function estadoContas(contas: NonNullable<ResumoIntegracoes["contas"]>, plataforma: "meta" | "google"): Estado {
  const daPlataforma = contas.filter((c) => c.plataforma === plataforma);
  if (daPlataforma.length === 0) return { tom: "neutral", texto: "Não ligado" };
  const pendentes = daPlataforma.filter((c) => c.ativo && (c.ultimo_erro || (!c.store_id && !c.checkout_id))).length;
  if (pendentes > 0) {
    const algumErro = daPlataforma.some((c) => c.ativo && c.ultimo_erro);
    return { tom: algumErro ? "err" : "warn", texto: plural(pendentes, "pendência", "pendências") };
  }
  return { tom: "ok", texto: plural(daPlataforma.length, "conta", "contas") };
}

export function estadosDaNav(r: ResumoIntegracoes): EstadosNav {
  return {
    meta: r.contas ? estadoContas(r.contas, "meta") : null,
    google: r.contas ? estadoContas(r.contas, "google") : null,
    shopify: r.lojas
      ? r.lojas.total === 0
        ? { tom: "neutral", texto: "Nenhuma loja" }
        : r.lojas.semAcesso > 0
          ? { tom: "warn", texto: `${r.lojas.semAcesso} sem acesso` }
          : { tom: "ok", texto: plural(r.lojas.total, "loja", "lojas") }
      : null,
    checkouts: r.checkouts
      ? r.checkouts.total === 0
        ? { tom: "neutral", texto: "Nenhum" }
        : r.checkouts.comErro > 0
          ? { tom: "err", texto: plural(r.checkouts.comErro, "com erro", "com erro") }
          : r.checkouts.aguardando > 0
            ? { tom: "run", texto: "Aguardando" }
            : { tom: "ok", texto: plural(r.checkouts.total, "checkout", "checkouts") }
      : null,
    notificacoes:
      r.telegram === null ? null : r.telegram ? { tom: "ok", texto: "Telegram" } : { tom: "neutral", texto: "Não ligado" },
    avancado:
      r.tokensClaude === null
        ? null
        : r.tokensClaude > 0
          ? { tom: "ok", texto: "Claude" }
          : { tom: "neutral", texto: "Claude" },
  };
}
