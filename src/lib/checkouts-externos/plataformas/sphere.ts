import { limparValor, type Utm } from "@/lib/tracking/utm";
import { GATILHOS_SPHERE, type SituacaoExterna } from "../tipos";
import { ehObjeto, lerData, lerMoeda, lerPais, lerPedidoId, lerValor, texto } from "./comum";
import type { EventoNormalizado, Leitura, PlataformaCheckout, RastreioNormalizado } from "./tipos";

// Os leitores sairam para comum.ts (a Cakto usa os mesmos); os testes da
// Sphere seguem importando daqui.
export { DIAS_PARA_FRENTE, DIAS_PARA_TRAS, VALOR_MAXIMO, lerData, lerValor } from "./comum";

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

// ----------------------------------------------------------------------------
// O clique do anuncio. O exemplo da doc nao traz rastreio nenhum, mas o pedido
// na Sphere guarda o sub1..sub5 e as UTMs do link do checkout (o painel mostra
// sub1 = id do anuncio, 29/10/2026). Sem saber onde o aviso os poe, o leitor
// procura no corpo, no pedido e nas caixas usuais -- e o formato do aviso real
// fica em checkouts_externos.ultimo_formato (085) para conferir.
//
// Os url_tags da operacao do Arthur: sub1={{ad.id}}, sub2={{adset.id}},
// sub3={{campaign.id}}, utm_source=facebook, utm_medium=paid. O sub que e id
// vence a UTM no nivel dele e vira o modelo do xcart (utm_campaign = campanha,
// utm_medium = conjunto, utm_content = anuncio); as regras de
// src/lib/tracking/utm.ts tiram os niveis. Sub que nao e id (o clickid do
// RedTrack, 24 hex) nao conta, e id de outro nivel nao casa com objeto nenhum
// do Meta na aba Campanhas (os ids sao unicos entre campanha, conjunto e
// anuncio): vira "id desconhecido", nunca a campanha errada.
// ----------------------------------------------------------------------------

/** Onde mais o rastreio pode vir, no corpo e dentro do pedido. */
const CAIXAS = ["rastreio", "tracking", "utm", "utms", "subs", "sub_ids", "subids", "params", "parametros", "query"];
const NOMES_SUB = (n: number) => [`sub${n}`, `sub_${n}`, `subid${n}`, `sub_id${n}`, `sub_id_${n}`, `aff_sub${n}`];
const RE_ID = /^\d{5,25}$/;

/** Os campos de texto do corpo, do pedido e das caixas, com a chave minuscula (o primeiro que vem fica). */
function camposDoClique(corpo: Record<string, unknown>): Map<string, string> {
  const saida = new Map<string, string>();
  const juntar = (o: unknown, utmSemPrefixo = false) => {
    if (!ehObjeto(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v !== "string" && typeof v !== "number") continue;
      let chave = k.trim().toLowerCase();
      // { utm: { source, medium, ... } }
      if (utmSemPrefixo && !chave.startsWith("utm_")) chave = `utm_${chave}`;
      const t = String(v).trim().slice(0, 200);
      if (t && !saida.has(chave)) saida.set(chave, t);
    }
  };
  const pedido = ehObjeto(corpo.pedido) ? corpo.pedido : {};
  juntar(corpo);
  juntar(pedido);
  for (const nome of CAIXAS) {
    juntar(corpo[nome], nome.startsWith("utm"));
    juntar(pedido[nome], nome.startsWith("utm"));
  }
  return saida;
}

/** O rastreio do aviso, ou undefined sem sub nem UTM (o pedido grava como antes). */
export function rastreioDaSphere(corpo: Record<string, unknown>): RastreioNormalizado | undefined {
  const c = camposDoClique(corpo);
  const primeiro = (nomes: string[]) => nomes.map((n) => c.get(n)).find((v) => v !== undefined) ?? null;
  const id = (v: string | null) => (v && RE_ID.test(v) ? v : null);
  const anuncio = id(primeiro(NOMES_SUB(1)));
  const conjunto = id(primeiro(NOMES_SUB(2)));
  const campanha = id(primeiro(NOMES_SUB(3)));
  // A mesma limpeza dos outros adaptadores: sem "@", controle nem macro -- o
  // CHECK da 072 recusa "@" e derrubaria o pedido inteiro.
  const u = (k: string) => limparValor(c.get(k));
  const utm: Utm = {
    source: u("utm_source"),
    medium: conjunto ?? u("utm_medium"),
    campaign: campanha ?? u("utm_campaign"),
    content: anuncio ?? u("utm_content"),
    term: u("utm_term"),
  };
  if (!Object.values(utm).some(Boolean)) return undefined;
  return {
    utm,
    sck: null,
    callback: null,
    fbc: null,
    fbp: null,
    fbclid: limparValor(c.get("fbclid")),
    ttclid: null,
    checkoutUrl: null,
    vidNaUrl: null,
  };
}

/**
 * Chave que diz de onde veio o clique: so o valor dela vai para o formato
 * guardado. O nome INTEIRO, nunca o prefixo -- "click_ip", "tracking_number" e
 * "rastreio" (o codigo da transportadora) sao do comprador.
 */
const RE_CHAVE_DE_CLIQUE =
  /^(sub_?(id_?)?[1-8]|aff_sub[1-8]|sub_?ids?|utm_(source|medium|campaign|content|term|id)|click_?id|fbclid|gclid|ttclid|ref|source|medium|content|term|campaign(_?id)?|adset(_?id)?|ad_?id)$/i;
const MAX_CHAVES = 200;

/**
 * O formato do aviso real, para conferir onde a Sphere poe o rastreio: TODOS os
 * caminhos de chave (sem valor) e o valor SO das chaves de clique. Nada do
 * comprador sai daqui -- se o aviso trouxer nome ou telefone, fica so o nome
 * do campo.
 */
export function formatoDoAvisoSphere(corpo: unknown, agora: Date): unknown {
  const chaves: string[] = [];
  const rastreio: Record<string, string> = {};
  const andar = (o: unknown, caminho: string, nivel: number) => {
    if (chaves.length >= MAX_CHAVES || nivel > 4) return;
    if (Array.isArray(o)) {
      if (o.length > 0) andar(o[0], `${caminho}[0]`, nivel + 1);
      return;
    }
    if (!ehObjeto(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (chaves.length >= MAX_CHAVES) return;
      const aqui = caminho ? `${caminho}.${k}` : k;
      chaves.push(aqui);
      if ((typeof v === "string" || typeof v === "number") && RE_CHAVE_DE_CLIQUE.test(k)) {
        // limparValor tira "@" (e-mail no sub5) e controle.
        const limpo = limparValor(v);
        if (limpo) rastreio[aqui] = limpo.slice(0, 120);
      }
      andar(v, aqui, nivel + 1);
    }
  };
  andar(corpo, "", 0);
  const evento = ehObjeto(corpo) && typeof corpo.evento === "string" ? corpo.evento.slice(0, 40) : null;
  return { em: agora.toISOString(), evento, chaves, rastreio };
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
  const rastreio = rastreioDaSphere(corpo);
  if (rastreio) saida.rastreio = rastreio;
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
  // A Sphere tenta de novo (1 vez) quando o xcart responde 503.
  reenvio: "status",
  gatilhos: GATILHOS_SPHERE,
  eventoDeVenda: "pedido.criado",
  ler: lerSphere,
  formato: formatoDoAvisoSphere,
  exemplo: exemploSphere,
};
