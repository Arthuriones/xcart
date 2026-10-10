import { GATILHOS_SPHERE, type SituacaoExterna } from "../tipos";
import type { EventoNormalizado, Leitura, PlataformaCheckout } from "./tipos";

// ============================================================================
// Sphere Affiliates: webhook do afiliado (doc da aba "Webhooks" do painel).
//
// Corpo (exemplo real da doc):
//   { "evento": "comissao.aprovada", "data_evento": "2026-07-16T14:32:05.000Z",
//     "webhook_id": 3,
//     "pedido": { "id": 12345, "status": "created", "metodo_pagamento": "cod",
//                 "produto": "EVOX 3+3 Grátis", "pais": "IT", "moeda": "EUR",
//                 "valor": "89.90", "criado_em": "2026-07-14T10:15:00.000Z" },
//     "comissao": { "valor": "75.00", "status": "approved" },
//     "afiliado": { "codigo": "ywq2mdhu", "programa_id": "the-box-italia" } }
//
// - comissao.valor e a comissao LIQUIDA (o que o afiliado recebe): e a
//   receita. pedido.valor e o total do pedido, so dica.
// - Valores chegam como string decimal ("89.90").
// - A moeda da comissao NAO vem: fica a do checkout (moeda_receita).
// - Sem assinatura: a URL e a senha. Timeout de 10 s e 1 retentativa.
//
// VALIDACAO DURA: o valor vai direto para o lucro. Numero fora de faixa,
// moeda que nao e ISO, data fora de [-400 dias, +1 dia] e recusado.
// ============================================================================

/** afiliado.codigo do "Enviar evento de teste": nunca vira pedido. */
export const CODIGO_TESTE = "xcart-teste";

/** Teto de valor aceito (pedido e comissao). */
export const VALOR_MAXIMO = 100_000;
/** Datas aceitas em volta de agora. */
export const DIAS_PARA_TRAS = 400;
export const DIAS_PARA_FRENTE = 1;

const DIA_MS = 86_400_000;

const STATUS: Record<string, SituacaoExterna> = {
  pending: "pendente",
  approved: "aprovado",
  paid: "pago",
  expired: "expirado",
  reversed: "revertido",
};

const ORDEM_SITUACAO: Record<SituacaoExterna, number> = {
  pendente: 0,
  aprovado: 1,
  pago: 2,
  expirado: 3,
  revertido: 4,
};

const POR_EVENTO: Record<string, SituacaoExterna> = {
  "pedido.criado": "pendente",
  "comissao.aprovada": "aprovado",
  "comissao.paga": "pago",
  "pedido.expirado": "expirado",
};

type Obj = Record<string, unknown>;

function ehObjeto(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * "89.90", "89,90", 89.9 -> 89.9. Vazio/ausente -> 0. Lixo, negativo ou acima
 * do teto -> null (o chamador recusa).
 */
export function lerValor(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    let s = v.trim();
    // So virgula: decimal europeu ("89,90"). Ponto e virgula juntos: recusa.
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAXIMO) return null;
  return Math.round(n * 100) / 100;
}

/** ISO 8601 com data e hora, dentro da janela aceita. Devolve em UTC. */
export function lerData(v: unknown, agora: Date): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const agoraMs = agora.getTime();
  if (ms < agoraMs - DIAS_PARA_TRAS * DIA_MS || ms > agoraMs + DIAS_PARA_FRENTE * DIA_MS) return null;
  return new Date(ms).toISOString();
}

function lerPedidoId(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[A-Za-z0-9_.:#-]{1,64}$/.test(s) ? s : null;
}

function lerMoeda(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(m) ? m : null;
}

function lerPais(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : null;
}

export function lerSphere(corpo: unknown, agora: Date): Leitura {
  if (!ehObjeto(corpo)) return { ok: false, erro: "corpo nao e um objeto JSON" };

  const evento = typeof corpo.evento === "string" ? corpo.evento.trim().toLowerCase() : "";
  if (!evento || evento.length > 40) return { ok: false, erro: "evento ausente" };

  const dataEvento =
    corpo.data_evento === undefined || corpo.data_evento === null
      ? agora.toISOString()
      : lerData(corpo.data_evento, agora);
  if (!dataEvento) return { ok: false, erro: "data_evento invalida ou fora da janela" };

  if (!ehObjeto(corpo.pedido)) return { ok: false, erro: "pedido ausente" };
  const p = corpo.pedido;
  const pedidoId = lerPedidoId(p.id);
  if (!pedidoId) return { ok: false, erro: "pedido.id invalido" };

  const moeda = lerMoeda(p.moeda);
  if (!moeda) return { ok: false, erro: "pedido.moeda nao e ISO 4217" };
  const valor = lerValor(p.valor);
  if (valor === null) return { ok: false, erro: "pedido.valor invalido" };
  const criadoEm =
    p.criado_em === undefined || p.criado_em === null ? dataEvento : lerData(p.criado_em, agora);
  if (!criadoEm) return { ok: false, erro: "pedido.criado_em invalido ou fora da janela" };

  const c = ehObjeto(corpo.comissao) ? corpo.comissao : {};
  const comissao = lerValor(c.valor);
  if (comissao === null) return { ok: false, erro: "comissao.valor invalido" };
  const statusOriginal = typeof c.status === "string" ? c.status.trim().toLowerCase().slice(0, 40) || null : null;
  // Vale a etapa mais avancada entre o status da comissao e o evento: a
  // propria doc manda campo atrasado (comissao.aprovada com pedido.status
  // "created"), e um pedido.expirado com a comissao ainda "pending" ficaria
  // pendente para sempre.
  const peloStatus = statusOriginal ? STATUS[statusOriginal] : undefined;
  const peloEvento = POR_EVENTO[evento];
  const situacao =
    peloStatus && peloEvento
      ? ORDEM_SITUACAO[peloStatus] >= ORDEM_SITUACAO[peloEvento]
        ? peloStatus
        : peloEvento
      : peloStatus || peloEvento;
  if (!situacao) return { ok: false, erro: `evento desconhecido: ${evento}` };

  const a = ehObjeto(corpo.afiliado) ? corpo.afiliado : {};
  const conta = texto(a.codigo, 64);

  const saida: EventoNormalizado = {
    evento,
    dataEvento,
    pedidoId,
    pedido: {
      status: texto(p.status, 40),
      metodo: texto(p.metodo_pagamento, 40),
      produto: texto(p.produto, 200),
      pais: lerPais(p.pais),
      moeda,
      valor,
      criadoEm,
    },
    receita: { valor: comissao, moeda: null, situacao, statusOriginal },
    conta,
    programa: texto(a.programa_id, 120),
    teste: conta === CODIGO_TESTE,
  };
  return { ok: true, evento: saida };
}

/** O corpo do "Enviar evento de teste": o exemplo da doc, com o codigo de teste. */
export function exemploSphere(agora: Date): unknown {
  const iso = agora.toISOString();
  return {
    evento: "pedido.criado",
    data_evento: iso,
    webhook_id: 0,
    pedido: {
      id: 12345,
      status: "created",
      metodo_pagamento: "cod",
      produto: "Pedido de teste do xcart",
      pais: "IT",
      moeda: "EUR",
      valor: "89.90",
      criado_em: iso,
    },
    comissao: { valor: "75.00", status: "pending" },
    afiliado: { codigo: CODIGO_TESTE, programa_id: "xcart-teste" },
  };
}

export const sphere: PlataformaCheckout = {
  id: "sphere",
  nome: "Sphere Affiliates",
  modelo: "comissao",
  autenticacao: "token_na_url",
  gatilhos: GATILHOS_SPHERE,
  ler: lerSphere,
  exemplo: exemploSphere,
};
