// ============================================================================
// Regras puras da Assinatura e do paywall: o que a tela diz sobre o plano, os
// pacotes de credito, as compras e os erros. Sem React e sem rede -- testadas
// em tests/billing-regras.test.ts.
//
// Nada aqui decide cobranca: plano, preco e pacote vem de
// src/lib/billing/plans.ts e o estado vem do banco. Isto so traduz para a tela.
// ============================================================================

import { planoPorId } from "@/lib/billing/plans";

export type TomSelo = "ok" | "warn" | "err" | "info" | "neutral" | "run";

const FUSO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;

/** "R$ 1.234,56" a partir de centavos. */
export function brl(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "03/10/2026" no horario de Sao Paulo. Data invalida vira null. */
export function dataCurta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: FUSO,
  }).format(t);
}

/** "03/10/2026 às 14:32" no horario de Sao Paulo. */
export function dataHora(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const dia = dataCurta(iso);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  }).format(t);
  return `${dia} às ${hora}`;
}

/** "1 crédito", "200 créditos". */
export function creditos(n: number): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? "crédito" : "créditos"}`;
}

/** "1 dia", "5 dias". */
export function dias(n: number): string {
  return `${n} ${n === 1 ? "dia" : "dias"}`;
}

/** 000.000.000-00 enquanto digita (so CPF, como a tela sempre aceitou). */
export function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

/** Tempo que falta, "mm:ss". Nunca negativo. */
export function contagem(restanteMs: number): string {
  const s = Math.max(0, Math.ceil(restanteMs / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Pacotes de credito
// ---------------------------------------------------------------------------

export interface PacoteBase {
  id: string;
  credits: number;
  amountCents: number;
}

export type PacoteNaTela<P extends PacoteBase = PacoteBase> = P & {
  /** Preco de um credito, em centavos (pode ter fracao). */
  centavosPorCredito: number;
  /** O de menor preco por credito, quando ha diferenca entre os pacotes. */
  melhor: boolean;
  /** Quanto mais barato por credito que o pacote mais caro (0,4 = 40%). null no mais caro. */
  economia: number | null;
};

/**
 * Preco por credito e o destaque do mais vantajoso, calculados -- nunca
 * escritos a mao. Sem diferenca de preco (ou um pacote so), ninguem e
 * destacado.
 */
export function pacotesComPreco<P extends PacoteBase>(pacotes: readonly P[]): PacoteNaTela<P>[] {
  const validos = pacotes.filter((p) => p.credits > 0 && p.amountCents > 0);
  const precos = validos.map((p) => p.amountCents / p.credits);
  const menor = precos.length ? Math.min(...precos) : 0;
  const maior = precos.length ? Math.max(...precos) : 0;
  const haDiferenca = maior - menor > 1e-9;
  return pacotes.map((p) => {
    const unit = p.credits > 0 ? p.amountCents / p.credits : 0;
    const valido = p.credits > 0 && p.amountCents > 0;
    return {
      ...p,
      centavosPorCredito: unit,
      melhor: valido && haDiferenca && Math.abs(unit - menor) < 1e-9,
      economia: valido && haDiferenca && unit < maior - 1e-9 ? 1 - unit / maior : null,
    };
  });
}

/** "R$ 0,38" por credito (duas casas, arredondado). */
export function precoPorCredito(centavos: number): string {
  return brl(Math.round(centavos));
}

// ---------------------------------------------------------------------------
// Situacao do plano
// ---------------------------------------------------------------------------

export interface PerfilAssinatura {
  /** profiles.plan: "pro" ou "free". */
  plano: string | null;
  /** profiles.plano: o tier ("loja1", "lojas3", "ilimitado"). null = Pro antigo. */
  tier?: string | null;
  /** profiles.subscription_status, como o provedor devolve. */
  status: string | null;
  fimPeriodo: string | null;
  cancelaNoFim: boolean;
  /** "pagou" (atual) ou "stripe" (legado). */
  provedor: string | null;
  /** Existe assinatura de cartao (pagou_subscription_id). */
  temAssinaturaCartao: boolean;
  /** Admin ou acesso liberado a mao pela equipe. */
  acessoLiberado: boolean;
}

export type FormaPagamento = "cartao" | "pix" | "legado";

export interface SituacaoPlano {
  /** O Pro esta valendo agora. */
  pro: boolean;
  titulo: string;
  selo: { tom: TomSelo; texto: string };
  forma: FormaPagamento | null;
  /** Renovacao ou fim do acesso, em uma frase. */
  linha: string | null;
  aviso: { tom: "warn" | "info" | "err"; titulo: string; texto: string } | null;
  podeCancelar: boolean;
  podeAssinar: boolean;
  podeRenovarPix: boolean;
  /** Como mudar de plano, numa frase. null quando nao se aplica. */
  mudarPlano: string | null;
}

/**
 * Trocar o plano de quem ja paga. A Pagou nao muda o valor de uma assinatura
 * existente (ver src/lib/billing/pagou.ts), entao no cartao a troca e pelo
 * suporte; no Pix e so escolher outro plano no proximo pagamento.
 */
export const MUDAR_PLANO = {
  cartao: "Para mudar de plano, fale com o suporte.",
  pix: "Para mudar de plano, escolha outro no próximo Pix.",
} as const;

/** Quantos dias antes do fim o Pro por Pix passa a avisar. */
export const AVISO_PIX_DIAS = 7;

function formaDe(p: PerfilAssinatura): FormaPagamento | null {
  if (p.provedor === "stripe") return "legado";
  if (p.temAssinaturaCartao) return "cartao";
  // Todo Pix grava o fim dos 30 dias. Pro sem fim e sem cartao (liberado
  // direto no banco, como a conta admin) nao e Pix: forma desconhecida.
  if (p.plano === "pro" && p.fimPeriodo) return "pix";
  return null;
}

/**
 * O que o cartao do plano mostra. Espelha a porta de acesso
 * (src/lib/billing/access.ts): Pro por Pix com o prazo vencido nao vale mais,
 * mesmo que o banco ainda diga "pro" ate a faxina rodar.
 */
export function situacaoDoPlano(p: PerfilAssinatura, agora: number): SituacaoPlano {
  const forma = formaDe(p);
  const fimMs = p.fimPeriodo ? new Date(p.fimPeriodo).getTime() : NaN;
  const temFim = Number.isFinite(fimMs);
  const fim = dataCurta(p.fimPeriodo);
  const pixVencido = forma === "pix" && temFim && fimMs < agora;
  const pro = p.plano === "pro" && !pixVencido;

  const nomeDoTier = planoPorId(p.tier)?.nome;
  const base: SituacaoPlano = {
    pro,
    titulo: nomeDoTier ? `Plano ${nomeDoTier}` : "Plano Pro",
    selo: { tom: "ok", texto: "Ativa" },
    forma: pro ? forma : null,
    linha: null,
    aviso: null,
    podeCancelar: false,
    podeAssinar: false,
    podeRenovarPix: false,
    mudarPlano: null,
  };

  if (!pro) {
    if (p.acessoLiberado) {
      return {
        ...base,
        titulo: "Acesso liberado",
        selo: { tom: "ok", texto: "Liberado" },
        linha: "A equipe do xcart liberou o acesso completo desta conta, sem cobrança.",
      };
    }
    if (forma === "cartao" && p.status === "incomplete") {
      return {
        ...base,
        forma,
        selo: { tom: "run", texto: "Processando" },
        linha: "O primeiro pagamento está sendo processado.",
        aviso: {
          tom: "info",
          titulo: "Esperando a confirmação do banco",
          texto:
            "O Pro libera sozinho assim que o pagamento for confirmado. Se não liberar em alguns minutos, fale com o suporte.",
        },
      };
    }
    let linha: string | null = null;
    if (pixVencido && fim) linha = `Os 30 dias pagos por Pix terminaram em ${fim}.`;
    else if (temFim && fimMs < agora && fim && p.status) linha = `Sua assinatura terminou em ${fim}.`;
    return {
      ...base,
      titulo: "Sem assinatura",
      selo: { tom: "neutral", texto: "Sem assinatura" },
      linha,
      podeAssinar: true,
    };
  }

  const cancelado = p.cancelaNoFim || p.status === "cancel_scheduled";

  if (forma === "legado") {
    return {
      ...base,
      selo: cancelado
        ? { tom: "neutral", texto: "Cancelamento agendado" }
        : p.status === "past_due"
          ? { tom: "warn", texto: "Pagamento pendente" }
          : { tom: "ok", texto: "Ativa" },
      linha: fim ? (cancelado ? `Acesso até ${fim}.` : `Renova em ${fim}.`) : null,
      aviso: {
        tom: "info",
        titulo: "Assinatura feita no sistema de pagamento anterior",
        texto:
          "Ela continua sendo cobrada normalmente. Para trocar o cartão, mudar de plano ou cancelar, fale com o suporte.",
      },
    };
  }

  if (forma === "pix") {
    // Arredonda para cima: 12 h viram "em 1 dia" (nunca "amanha" para o que
    // vence hoje, nem "0 dias").
    const faltam = temFim ? Math.max(1, Math.ceil((fimMs - agora) / DIA_MS)) : null;
    const perto = faltam !== null && faltam <= AVISO_PIX_DIAS;
    return {
      ...base,
      selo: perto
        ? { tom: "warn", texto: `Vence em ${dias(faltam)}` }
        : { tom: "ok", texto: "Ativa" },
      linha: fim
        ? `Pago por Pix: acesso até ${fim}. Não renova sozinho.`
        : "Pago por Pix. Não renova sozinho.",
      aviso: perto
        ? {
            tom: "warn",
            titulo: `Seu acesso vence em ${dias(faltam)}`,
            texto:
              "Pague mais 30 dias por Pix para não perder o acesso. Os dias que ainda faltam são somados.",
          }
        : null,
      podeRenovarPix: true,
      mudarPlano: MUDAR_PLANO.pix,
    };
  }

  // Cartao (ou Pro sem forma conhecida, liberado direto no banco).
  base.mudarPlano = forma === "cartao" ? MUDAR_PLANO.cartao : null;
  if (cancelado) {
    return {
      ...base,
      selo: { tom: "neutral", texto: "Cancelamento agendado" },
      linha: fim ? `Acesso até ${fim}. Depois disso, o plano não renova.` : "O plano não renova no fim do período.",
    };
  }
  if (p.status === "past_due") {
    return {
      ...base,
      selo: { tom: "warn", texto: "Pagamento pendente" },
      linha: fim ? `Ciclo atual até ${fim}.` : null,
      aviso: {
        tom: "warn",
        titulo: "A última cobrança do cartão não passou",
        texto:
          "O acesso continua por enquanto. Confira o cartão com o seu banco; para trocar de cartão, fale com o suporte.",
      },
      podeCancelar: forma === "cartao",
    };
  }
  if (p.status === "trialing") {
    return {
      ...base,
      selo: { tom: "info", texto: "Em avaliação" },
      linha: fim ? `A primeira cobrança é em ${fim}.` : null,
      podeCancelar: forma === "cartao",
    };
  }
  return {
    ...base,
    linha:
      forma === "cartao"
        ? fim
          ? `Renova em ${fim}, no cartão.`
          : "Renova todo mês, no cartão."
        : null,
    podeCancelar: forma === "cartao",
  };
}

/**
 * Por que o paywall apareceu, numa frase. A porta (access.ts) manda para ca
 * quem nao tem acesso e ja usou a clonagem gratuita -- inclusive quem pagou
 * 30 dias por Pix e deixou vencer, ou teve a assinatura encerrada.
 * null = a conta TEM acesso (chegou aqui pelo endereco): a tela oferece voltar.
 */
export function motivoDoBloqueio(
  p: (PerfilAssinatura & { usouClonagemGratis?: boolean }) | null,
  agora: number
): string | null {
  const generico = "Para continuar usando o xcart, assine um plano.";
  if (!p) return generico;
  const s = situacaoDoPlano(p, agora);
  if (s.pro || p.acessoLiberado) return null;
  if (s.linha && s.podeAssinar) return s.linha;
  if (p.usouClonagemGratis) return "Você já usou a clonagem gratuita desta conta.";
  return generico;
}

// ---------------------------------------------------------------------------
// Historico de compras (credit_purchases)
// ---------------------------------------------------------------------------

export interface CompraBase {
  kind: string | null;
  credits: number;
  method: string | null;
  provider: string | null;
  status: string | null;
}

/** "200 créditos" ou "Plano Pro · 30 dias". */
export function rotuloCompra(c: CompraBase & { plano?: string | null }): string {
  if (c.kind === "pro_month") {
    const nome = planoPorId(c.plano)?.nome;
    return nome ? `Plano ${nome} · 30 dias` : "Plano Pro · 30 dias";
  }
  return creditos(c.credits);
}

/** "Pix", "Cartão" ou "—". */
export function formaDaCompra(c: CompraBase): string {
  if (c.method === "pix") return "Pix";
  if (c.method === "card" || c.provider === "stripe") return "Cartão";
  return "—";
}

/** O estado da cobranca em palavra de gente; nunca o codigo cru. */
export function situacaoDaCompra(status: string | null): { tom: TomSelo; texto: string } {
  switch (status) {
    case "paid":
      return { tom: "ok", texto: "Paga" };
    case "pending":
    case "waiting_payment":
    case "processing":
      return { tom: "neutral", texto: "Não confirmada" };
    case "refused":
      return { tom: "err", texto: "Recusada" };
    case "canceled":
      return { tom: "neutral", texto: "Cancelada" };
    case "expired":
      return { tom: "neutral", texto: "Expirada" };
    case "refunded":
    case "chargedback":
      return { tom: "neutral", texto: "Estornada" };
    default:
      return { tom: "neutral", texto: "Sem confirmação" };
  }
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/**
 * Mensagens que as nossas rotas de cobranca devolvem, ja escritas para o
 * lojista. Qualquer outra (vinda do processador de pagamento, em ingles ou com
 * nome de fornecedor) vira a mensagem padrao da acao, e o texto cru fica so
 * no "Detalhes para o suporte".
 */
const MENSAGENS_NOSSAS = new Set([
  "Informe seu CPF para gerar a cobrança Pix.",
  "CPF inválido. Confira os números.",
  "CNPJ inválido. Confira os números.",
  "Pacote inválido.",
  "Cobrança criada, mas não foi registrada. Fale com o suporte.",
  "Você já tem uma assinatura ativa.",
  "Escolha um plano.",
  "Token de cartão inválido.",
  "Esta assinatura foi criada no provedor anterior. Fale com o suporte para cancelar.",
  "Nenhuma assinatura ativa.",
  // Do formulario de cartao (pagou-card-form.tsx), tambem nossas.
  "Não foi possível carregar o formulário de pagamento.",
  "O banco pediu autenticação adicional. Tente outro cartão.",
]);

export interface ErroNaTela {
  texto: string;
  /** O texto cru, quando nao foi mostrado: vai recolhido para o suporte. */
  detalhe: string | null;
}

export function mensagemDeErro(status: number | null, bruto: unknown, padrao: string): ErroNaTela {
  if (status === 401) {
    return { texto: "Sua sessão expirou. Entre de novo para continuar.", detalhe: null };
  }
  const msg = typeof bruto === "string" ? bruto.trim() : "";
  if (msg && MENSAGENS_NOSSAS.has(msg)) return { texto: msg, detalhe: null };
  return { texto: padrao, detalhe: msg || null };
}

export const ERRO_PADRAO = {
  pix: "Não deu para gerar o Pix agora. Nada foi cobrado; tente de novo em instantes.",
  cartao: "Não deu para concluir a assinatura agora. Confira os dados do cartão e tente de novo.",
  cancelar: "Não deu para cancelar agora. Sua assinatura continua como estava; tente de novo em instantes.",
} as const;
