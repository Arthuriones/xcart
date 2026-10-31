import { timingSafeEqual } from "node:crypto";
import { limparValor } from "@/lib/tracking/utm";
import { GATILHOS_HOTMART, type SituacaoExterna } from "../tipos";
import { DIAS_PARA_FRENTE, DIAS_PARA_TRAS, VALOR_MAXIMO, ehObjeto, lerMoeda, lerPais, lerPedidoId, texto, type Obj } from "./comum";
import type {
  Autenticacao,
  CompradorNormalizado,
  EventoNormalizado,
  Leitura,
  LeituraVarios,
  PlataformaCheckout,
  RastreioNormalizado,
  VendaNormalizada,
} from "./tipos";

// ============================================================================
// Hotmart: webhook 2.0.0 do PRODUTOR (venda propria). Doc:
// developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook.
//
// Corpo: { id, creation_date, event, version: "2.0.0", data: { product,
// affiliates, buyer, producer, commissions, purchase, subscription } }. O
// hottok (o token FIXO da conta, na aba Autenticacao do Webhook; nao e HMAC,
// nao assina o corpo) vem no header X-HOTMART-HOTTOK. O "Enviar teste" ja o
// mandou no corpo (changelog de 04/2022): o autenticar aceita os dois.
//
// - Uma TRANSACAO por aviso (HP...). O order bump e uma transacao propria,
//   com order_bump.parent_purchase_transaction = a principal (vazio = a
//   propria e a principal): o grupo (a cobranca do Dashboard e o event_id da
//   compra) e a principal. Cada item chega num aviso, e a compra ao
//   Meta/TikTok sai SO com a principal (`semCompra` no bump): o bump que
//   chegasse antes levaria o Purchase com o valor e o produto dele, e o da
//   principal cairia no indice unico. O valor do bump fica fora da compra.
// - Valores DECIMAIS (134.0, 0.65), nao centavos. Faturamento = price (o
//   valor da oferta; o full_price leva taxas e juros do parcelamento, que sao
//   da Hotmart). Comissoes (data.commissions): MARKETPLACE = a taxa da
//   Hotmart, PRODUCER = o liquido do produtor, COPRODUCER/AFFILIATE/ADDON =
//   as comissoes. A taxa e o resto depois do liquido e das comissoes.
// - O mesmo hottok recebe o aviso de cada PAPEL da conta. Coprodutor (sem a
//   linha PRODUCER, com a COPRODUCER): o liquido e a comissao dele, a taxa so
//   o MARKETPLACE e as comissoes o resto (a parte do produtor). Afiliado (sem
//   price, sem PRODUCER nem COPRODUCER): 200 ignorado -- a conta que e
//   produtora e afiliada recebe os dois, e um 400 desligaria o webhook.
// - O teto de valor (VALOR_MAXIMO) vale DEPOIS da conversao, na moeda de
//   quem recebe: em COP e CLP o numero cru passa de 100 mil numa venda comum.
//   Acima do teto: 200 ignorado, nunca 400.
// - Venda em outra moeda: a comissao do produtor traz currency_conversion
//   { converted_value, converted_to_currency, conversion_rate } -- o que ele
//   recebe de fato. Tudo vai na moeda CONVERTIDA (o price e as outras
//   comissoes pela mesma taxa): uma moeda por pedido, o fator unico do
//   Dashboard segue certo.
// - Datas em MILISSEGUNDOS desde 1970 (creation_date, approved_date; a doc
//   nao diz a unidade do order_date, entao aceita ms, segundos e ISO). O
//   pendente fica na criacao do pedido, o pago na aprovacao, o resto
//   (cancelada, expirada, reembolso, chargeback, pedido de reembolso) na hora
//   do aviso. A situacao sai SO do evento: o payload nao traz a data de cada
//   status (a Hubla tem statusAt[]), e o status de agora num aviso atrasado
//   poria a data errada no reembolso.
// - PURCHASE_PROTEST (pedido de reembolso): segue paga, SEM o "em risco"
//   (como o disputed da Hubla): o reembolso_pedido_em nunca sai (estado.ts),
//   e o pedido que nao foi reembolsado (vem o PURCHASE_COMPLETE, fim da
//   garantia, que so confirma o pago) ficaria "em risco" para sempre.
//   Reembolsou, vem o REFUNDED. Reembolso PARCIAL (status PARTIALLY_REFUNDED) fica de
//   fora, como na Hubla: marcar a venda inteira seria pior.
// - Renovacao de assinatura (recurrence_number > 1), antecipacao e as
//   cobrancas do FlexPay depois da adesao (flexPayPlan com o
//   signupTransactionReference de outra transacao) entram no lucro, mas NAO
//   vao ao Meta/TikTok (`recorrencia`): nao tem clique.
// - Rastreio: o webhook NAO manda UTM, fbp, fbc, click id nem user agent. So
//   purchase.origin { sck, src, xcod } e purchase.buyer_ip -- e a ponte poe o
//   visitante no sck ("xc.<vid>", data-xcart-param-vid="sck"): a compra acha
//   a identidade dele (user agent, _fbp, o clique) e o pedido herda a UTM do
//   clique (receber.ts).
// - Teste: o "Enviar teste" (aba Minhas configuracoes) manda o hottok REAL
//   com o payload de exemplo da doc (transacao HP02316330308193, comprador
//   buyer@email.com, datas sem sentido); o nosso usa ID_TESTE. Sai ANTES das
//   validacoes.
//
// A HOTMART DESATIVA O WEBHOOK SOZINHA quando a URL da erro (a doc nao diz o
// criterio). Por isso tudo que nao e erro de verdade responde 200: evento
// que nao vira pedido, reembolso parcial e transacao de mais de 400 dias
// (o reembolso de uma venda antiga) saem como `ignorado`. Ela reenvia o
// nao-2xx ate 5 vezes: a falha nossa responde 503 na hora, com o reenvio do
// Historico dela na tela.
//
// O comprador (nome, e-mail, telefone, endereco) fica SO em memoria. CPF
// (document) nem e lido.
// ============================================================================

/** A transacao do nosso "Enviar evento de teste". */
export const ID_TESTE = "HP00000000XCART";

/** A transacao do payload de exemplo da doc, que o "Enviar teste" da Hotmart manda. */
const TRANSACAO_DO_EXEMPLO = "HP02316330308193";

/** Os eventos de compra que viram pedido; o resto da Hotmart responde 200 sem gravar. */
const POR_EVENTO: Record<string, SituacaoExterna> = {
  PURCHASE_BILLET_PRINTED: "pendente",
  PURCHASE_APPROVED: "pago",
  PURCHASE_COMPLETE: "pago",
  PURCHASE_PROTEST: "pago",
  PURCHASE_CANCELED: "expirado",
  PURCHASE_EXPIRED: "expirado",
  PURCHASE_REFUNDED: "revertido",
  PURCHASE_CHARGEBACK: "revertido",
};

/** Cobranca que se paga depois (a "gerada" da compra pelo servidor). */
const METODOS_COM_COBRANCA = new Set(["pix", "boleto", "picpay"]);

/** O vencimento do Pix pode estar dias a frente. */
const DIAS_VENCIMENTO = 90;

const DIA_MS = 86_400_000;

function redondo(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "BILLET" -> "boleto", "PIX" -> "pix": os nomes que venda.ts conhece. O resto em minusculas. */
function lerMetodo(v: unknown): string | null {
  const m = texto(v, 40)?.toLowerCase() ?? null;
  return m === "billet" ? "boleto" : m;
}

/**
 * Teto de sanidade do numero CRU, ainda na moeda do comprador (um curso de
 * R$ 497 passa de 380 mil em COP). O VALOR_MAXIMO vale depois da conversao.
 */
const TETO_CRU = 1e10;

/** Valor decimal (numero ou texto). Ausente -> 0. Lixo, negativo ou acima do teto cru -> null (recusa). */
function lerDecimal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}(\.\d{1,6})?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > TETO_CRU) return null;
  return redondo(n);
}

/** Instante da Hotmart em ms: milissegundos (o padrao), segundos (numero curto) ou ISO. null = ausente ou torto. */
function instante(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{9,14}$/.test(v.trim()) ? Number(v) : NaN;
  if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.trim())) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Na janela das datas aceitas (a de comum.ts): -400 dias, +1 (ou +`frente`). */
function naJanela(ms: number, agora: Date, frente = DIAS_PARA_FRENTE): boolean {
  const a = agora.getTime();
  return ms >= a - DIAS_PARA_TRAS * DIA_MS && ms <= a + frente * DIA_MS;
}

/** ISO dentro da janela, ou null (ausente, torto ou fora). */
function dataNaJanela(v: unknown, agora: Date, frente?: number): string | null {
  const ms = instante(v);
  return ms !== null && naJanela(ms, agora, frente) ? new Date(ms).toISOString() : null;
}

/** IPv4 ou IPv6 (so o formato: quem usa e o Meta e o TikTok). */
function lerIp(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 45) return null;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (/^[0-9A-Fa-f:.]+$/.test(s) && s.includes(":")) ? s : null;
}

/** O nosso exemplo, o exemplo da doc (que o "Enviar teste" manda), ou comprador @example. */
function ehTeste(dados: Obj, compra: Obj): boolean {
  if (compra.transaction === ID_TESTE || compra.transaction === TRANSACAO_DO_EXEMPLO) return true;
  const b = ehObjeto(dados.buyer) ? dados.buyer : {};
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (/@example\.(com|org|net)$/.test(email)) return true;
  return email === "buyer@email.com" && String(b.name || "").trim() === "Buyer Name";
}

/** A entrega de teste: so marca "teste recebido", entao nada nela precisa valer. */
function eventoDeTeste(evento: string, compra: Obj, agora: Date): EventoNormalizado {
  const agoraIso = agora.toISOString();
  return {
    evento: evento.slice(0, 40),
    dataEvento: agoraIso,
    pedidoId: lerPedidoId(compra.transaction) ?? "teste",
    pedido: { status: null, metodo: null, produto: null, pais: null, moeda: "", valor: 0, criadoEm: agoraIso },
    receita: { valor: 0, moeda: null, situacao: POR_EVENTO[evento] ?? "pendente", statusOriginal: null },
    conta: null,
    programa: null,
    teste: true,
  };
}

/** purchase.origin (o sck leva o visitante da ponte) e o buyer_ip. */
function lerRastreio(compra: Obj): RastreioNormalizado {
  const origem = ehObjeto(compra.origin) ? compra.origin : {};
  return {
    utm: {},
    sck: texto(origem.sck, 255),
    callback: null,
    fbc: null,
    fbp: null,
    fbclid: null,
    ttclid: null,
    checkoutUrl: null,
    vidNaUrl: null,
    ip: lerIp(compra.buyer_ip),
    userAgent: null,
    ttp: null,
  };
}

/**
 * O telefone do checkout. No Brasil o checkout_phone_code e o DDD (vai na
 * frente do numero); fora, o numero ja vem com o DDI (ganha o '+').
 */
function lerTelefone(b: Obj, pais: string | null): string | null {
  const numero = texto(b.checkout_phone, 30);
  if (!numero) return null;
  const digitos = numero.replace(/\D/g, "");
  if (!digitos) return null;
  if (numero.startsWith("+")) return `+${digitos}`;
  if (pais && pais !== "BR") return `+${digitos}`;
  const ddd = String(b.checkout_phone_code ?? "").replace(/\D/g, "");
  return ddd && digitos.length <= 9 ? `${ddd}${digitos}` : digitos;
}

/** SO EM MEMORIA (ver o cabecalho). */
function lerComprador(dados: Obj, compra: Obj): CompradorNormalizado {
  const b = ehObjeto(dados.buyer) ? dados.buyer : {};
  const a = ehObjeto(b.address) ? b.address : {};
  const daCompra = ehObjeto(compra.checkout_country) ? lerPais(compra.checkout_country.iso) : null;
  const pais = lerPais(a.country_iso) ?? daCompra;
  const email = texto(b.email, 200);
  const nome = texto(b.name, 120) ?? ([texto(b.first_name, 60), texto(b.last_name, 60)].filter(Boolean).join(" ") || null);
  return {
    nome,
    email: email ? email.toLowerCase() : null,
    telefone: lerTelefone(b, pais),
    pais,
    estado: texto(a.state, 60),
    cidade: texto(a.city, 80),
    cep: texto(a.zipcode, 20),
  };
}

interface Linha {
  valor: number;
  moeda: string | null;
  papel: string;
  conversao: { valor: number; moeda: string; taxa: number | null } | null;
}

type Dinheiro =
  | { ok: true; faturamento: number; taxa: number | null; comissoes: number; liquido: number; moeda: string | null }
  | { ok: false; erro: string }
  | { ok: false; ignorado: string };

/**
 * O dinheiro da transacao, na moeda de quem recebe o aviso (o produtor, ou o
 * coprodutor no aviso dele). Erro = o campo torto (a venda e recusada: o
 * valor vai para o lucro). `ignorado` = o aviso do afiliado ou o valor acima
 * do teto (200, nunca 400).
 */
function lerDinheiro(dados: Obj, compra: Obj): Dinheiro {
  const linhas: Linha[] = [];
  for (const c of Array.isArray(dados.commissions) ? dados.commissions : []) {
    if (!ehObjeto(c)) continue;
    const v = lerDecimal(c.value);
    if (v === null) return { ok: false, erro: "commissions.value invalido" };
    let conversao: Linha["conversao"] = null;
    if (ehObjeto(c.currency_conversion)) {
      const cv = lerDecimal(c.currency_conversion.converted_value);
      const cm = lerMoeda(c.currency_conversion.converted_to_currency);
      const tx = Number(c.currency_conversion.conversion_rate);
      if (cv === null || !cm) return { ok: false, erro: "commissions.currency_conversion invalido" };
      conversao = { valor: cv, moeda: cm, taxa: Number.isFinite(tx) && tx > 0 && tx < 1e6 ? tx : null };
    }
    linhas.push({ valor: v, moeda: lerMoeda(c.currency_value), papel: String(c.source || "").toUpperCase(), conversao });
  }

  // De quem e o aviso: o produtor; sem a linha dele, o coprodutor. Nenhum dos
  // dois, e sem price ou com linha de afiliado: o aviso do afiliado.
  const nosso = linhas.some((l) => l.papel === "PRODUCER") ? "PRODUCER" : linhas.some((l) => l.papel === "COPRODUCER") ? "COPRODUCER" : null;
  const preco = ehObjeto(compra.price) ? compra.price : null;
  if (!nosso && (!preco || linhas.some((l) => l.papel === "AFFILIATE"))) return { ok: false, ignorado: "aviso de afiliado" };
  if (!preco) return { ok: false, erro: "purchase.price ausente" };
  const valor = lerDecimal(preco.value);
  if (valor === null) return { ok: false, erro: "purchase.price.value invalido" };
  const moedaPreco = lerMoeda(preco.currency_value);

  const ref = linhas.find((l) => l.papel === nosso) ?? null;
  // A moeda de quem recebe: a da conversao da linha dele, senao a da comissao dele, senao a do price.
  const alvo = ref?.conversao?.moeda ?? ref?.moeda ?? moedaPreco ?? linhas.find((l) => l.moeda)?.moeda ?? null;
  // A taxa de cambio da moeda da venda para a do alvo: a da conversao do produtor.
  const de = ref?.conversao ? ref.moeda : null;
  const taxaDeCambio = ref?.conversao ? (ref.conversao.taxa ?? (ref.valor > 0 ? ref.conversao.valor / ref.valor : null)) : null;
  const naMoedaAlvo = (v: number, moeda: string | null, conversao: Linha["conversao"] = null): number | null => {
    if (!moeda || !alvo || moeda === alvo) return v;
    if (conversao && conversao.moeda === alvo) return conversao.valor;
    if (de && moeda === de && taxaDeCambio) return redondo(v * taxaDeCambio);
    return null;
  };

  let liquido: number | null = null;
  let comissoes = 0;
  let marketplace: number | null = null;
  let soma = 0;
  let somaCompleta = true;
  for (const l of linhas) {
    const v = naMoedaAlvo(l.valor, l.moeda, l.conversao);
    if (v === null) {
      // A comissao de outra moeda sem conversao fica na taxa (o resto).
      if (l.papel === nosso) return { ok: false, erro: `comissao ${l.papel} em ${l.moeda} sem conversao para ${alvo}` };
      somaCompleta = false;
      continue;
    }
    soma = redondo(soma + v);
    if (l.papel === nosso) liquido = redondo((liquido ?? 0) + v);
    else if (l.papel === "MARKETPLACE") marketplace = redondo((marketplace ?? 0) + v);
    else comissoes = redondo(comissoes + v);
  }

  // O price na moeda de quem recebe; sem cambio para ele, a soma das comissoes (elas repartem o price).
  const precoNoAlvo = naMoedaAlvo(valor, moedaPreco);
  const faturamento = precoNoAlvo ?? (somaCompleta && linhas.length > 0 ? soma : null);
  if (faturamento === null) return { ok: false, erro: `price em ${moedaPreco} sem conversao para ${alvo}` };
  if (faturamento > VALOR_MAXIMO || (liquido ?? 0) > VALOR_MAXIMO) return { ok: false, ignorado: "valor acima do teto" };
  // Sem comissao nenhuma (o aviso que nao as traz): sem taxa, o liquido e o que sobra.
  if (liquido === null) return { ok: true, faturamento, taxa: null, comissoes, liquido: redondo(Math.max(0, faturamento - comissoes)), moeda: alvo };
  // Coprodutor: a taxa e so a da Hotmart; o resto do price (a parte do produtor e dos afiliados) e comissao.
  if (nosso === "COPRODUCER") {
    const resto = redondo(Math.max(0, faturamento - liquido - (marketplace ?? 0)));
    return { ok: true, faturamento, taxa: marketplace, comissoes: resto, liquido, moeda: alvo };
  }
  const taxa = redondo(Math.max(0, faturamento - liquido - comissoes));
  return { ok: true, faturamento, taxa, comissoes, liquido, moeda: alvo };
}

/** Um aviso = uma transacao, ou nada (`ignorado`). */
export function lerTodosHotmart(corpo: unknown, agora: Date): LeituraVarios {
  if (!ehObjeto(corpo)) return { ok: false, erro: "corpo nao e um objeto JSON" };
  const evento = typeof corpo.event === "string" ? corpo.event.trim().toUpperCase() : "";
  if (!evento || evento.length > 40) return { ok: false, erro: "event ausente" };
  // Abandono, assinatura, troca de plano, Members Area, compra atrasada,
  // logistica, evento novo da Hotmart: 200 sem gravar (erro seguido desliga o webhook).
  if (!POR_EVENTO[evento]) return { ok: true, eventos: [], ignorado: evento };

  const dados = ehObjeto(corpo.data) ? corpo.data : null;
  const compra = dados && ehObjeto(dados.purchase) ? dados.purchase : null;
  if (!dados || !compra) return { ok: false, erro: "data.purchase ausente" };

  // Antes de tudo: o exemplo da doc tem datas sem sentido.
  if (ehTeste(dados, compra)) return { ok: true, eventos: [eventoDeTeste(evento, compra, agora)] };

  const pedidoId = lerPedidoId(compra.transaction);
  if (!pedidoId) return { ok: false, erro: "purchase.transaction invalido" };

  const status = typeof compra.status === "string" ? compra.status.trim().toLowerCase().slice(0, 40) || null : null;
  if (evento === "PURCHASE_REFUNDED" && status === "partially_refunded") {
    return { ok: true, eventos: [], ignorado: "reembolso parcial" };
  }
  const situacao = POR_EVENTO[evento];

  // Datas. O dia do pedido e o order_date; a transacao de mais de 400 dias (o
  // reembolso de uma venda antiga) responde 200 sem gravar, nunca 400.
  const pedidoMs = instante(compra.order_date);
  const aprovadaMs = instante(compra.approved_date);
  const avisoMs = instante(corpo.creation_date);
  const base = pedidoMs ?? aprovadaMs;
  if (base !== null && base < agora.getTime() - DIAS_PARA_TRAS * DIA_MS) {
    return { ok: true, eventos: [], ignorado: "transacao de mais de 400 dias" };
  }
  const agoraIso = agora.toISOString();
  const emIso = (ms: number | null) => (ms !== null && naJanela(ms, agora) ? new Date(ms).toISOString() : null);
  const aviso = emIso(avisoMs) ?? agoraIso;
  const aprovada = emIso(aprovadaMs);
  const criado = emIso(pedidoMs) ?? aprovada ?? aviso;
  const dataEvento =
    situacao === "pendente" ? criado : situacao === "pago" && evento !== "PURCHASE_PROTEST" ? (aprovada ?? aviso) : aviso;

  const dinheiro = lerDinheiro(dados, compra);
  if (!dinheiro.ok) return "ignorado" in dinheiro ? { ok: true, eventos: [], ignorado: dinheiro.ignorado } : dinheiro;

  const pagamento = ehObjeto(compra.payment) ? compra.payment : {};
  const metodo = lerMetodo(pagamento.type);
  const bump = ehObjeto(compra.order_bump) ? compra.order_bump : {};
  const pai = bump.is_order_bump === true ? lerPedidoId(bump.parent_purchase_transaction) : null;
  const doBump = pai && pai !== pedidoId ? pai : null;
  const produto = ehObjeto(dados.product) ? dados.product : {};
  const recorrencia = Number(compra.recurrence_number);
  // FlexPay (High Ticket): a cobranca que nao e a da adesao (a tabela da doc poe o bloco em purchase, o exemplo em data).
  const flex = ehObjeto(compra.flexPayPlan) ? compra.flexPayPlan : ehObjeto(dados.flexPayPlan) ? dados.flexPayPlan : null;
  const adesao = flex ? lerPedidoId(flex.signupTransactionReference) : null;
  const parcelaFlex = !doBump && adesao !== null && adesao !== pedidoId;
  const cobranca = !metodo || METODOS_COM_COBRANCA.has(metodo);

  // O vencimento so do Pix pendente (o boleto nao traz o dele: vale a janela padrao), e so depois da criacao.
  const vence = metodo === "pix" ? dataNaJanela(pagamento.pix_expiration_date, agora, DIAS_VENCIMENTO) : null;
  const venceEm = situacao === "pendente" && vence && Date.parse(vence) > Date.parse(criado) ? vence : null;
  const chargeback = evento === "PURCHASE_CHARGEBACK";

  const venda: VendaNormalizada = {
    taxa: dinheiro.taxa,
    comissoes: dinheiro.comissoes,
    referencia: null,
    grupo: doBump ?? pedidoId,
    produtoId: lerPedidoId(produto.id) ?? lerPedidoId(produto.ucode),
    ofertaTipo: doBump ? "orderbump" : "main",
    venceEm,
    reembolsadoEm: situacao === "revertido" && !chargeback ? dataEvento : null,
    chargebackEm: chargeback ? dataEvento : null,
    // O pedido de reembolso segue pago, sem o "em risco" (ver o cabecalho).
    reembolsoPedidoEm: null,
    // O cartao "aguardando pagamento" (em analise) nao e cobranca gerada: nao manda a compra nem avisa "Pix gerado".
    cobrancaGerada: evento === "PURCHASE_BILLET_PRINTED" && cobranca,
    recorrencia: parcelaFlex || (Number.isFinite(recorrencia) && recorrencia > 1) || compra.subscription_anticipation_purchase === true,
    // O bump chega em aviso proprio: a compra sai so com a principal.
    semCompra: doBump !== null,
  };

  const comprador = lerComprador(dados, compra);
  const saida: EventoNormalizado = {
    evento,
    dataEvento,
    pedidoId,
    pedido: {
      status: texto(compra.status, 40),
      metodo,
      produto: texto(produto.name, 200),
      pais: comprador.pais,
      moeda: dinheiro.moeda ?? "",
      valor: dinheiro.faturamento,
      criadoEm: criado,
    },
    receita: {
      valor: dinheiro.liquido,
      moeda: dinheiro.moeda,
      situacao,
      // "expired" e o que venda.ts le para "Vencida" (o Pix/boleto que nao foi pago).
      statusOriginal: evento === "PURCHASE_EXPIRED" ? "expired" : status,
    },
    conta: null,
    programa: null,
    teste: false,
    venda,
    rastreio: lerRastreio(compra),
    comprador,
  };
  return { ok: true, eventos: [saida] };
}

/** A transacao da entrega (o contrato de um so). Use lerTodosHotmart: ele diz o que foi ignorado. */
export function lerHotmart(corpo: unknown, agora: Date): Leitura {
  const r = lerTodosHotmart(corpo, agora);
  if (!r.ok) return r;
  if (r.eventos.length === 0) return { ok: false, erro: `evento ignorado: ${r.ignorado ?? "vazio"}` };
  return { ok: true, evento: r.eventos[0] };
}

// ---------------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------------

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** O hottok no corpo (o "Enviar teste" ja o mandou la). So se o header nao veio. */
function hottokDoCorpo(raw: string | Uint8Array): string {
  try {
    const corpo: unknown = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    return ehObjeto(corpo) && typeof corpo.hottok === "string" ? corpo.hottok.trim() : "";
  } catch {
    return "";
  }
}

/** O X-HOTMART-HOTTOK (ou o hottok do corpo) tem que ser o token colado no Panda Track. Tempo constante. */
export function autenticarHotmart(raw: string | Uint8Array, headers: Headers, segredo: string | null): Autenticacao {
  if (!segredo) return { ok: false, semSegredo: true, erro: "hottok da Hotmart nao cadastrado" };
  const recebido = (headers.get("x-hotmart-hottok") || "").trim() || hottokDoCorpo(raw);
  if (!recebido) return { ok: false, erro: "X-HOTMART-HOTTOK ausente" };
  if (!iguais(recebido, segredo.trim())) return { ok: false, erro: "X-HOTMART-HOTTOK nao confere" };
  return { ok: true };
}

/** O header que a Hotmart manda em toda entrega. */
export function assinarHotmart(_raw: string, segredo: string): Record<string, string> {
  return { "x-hotmart-hottok": segredo };
}

/** O corpo do "Enviar evento de teste": uma compra aprovada com a transacao fixa. */
export function exemploHotmart(agora: Date): unknown {
  const ms = agora.getTime();
  return {
    id: "7e57c0de-0000-4000-8000-00000000a7a1",
    creation_date: ms,
    event: "PURCHASE_APPROVED",
    version: "2.0.0",
    data: {
      product: { id: 0, ucode: "xcart-teste", name: "Venda de teste do Panda Track" },
      buyer: { email: "teste@example.com", name: "Teste do Panda Track" },
      commissions: [
        { value: 9.9, source: "MARKETPLACE", currency_value: "BRL" },
        { value: 87.1, source: "PRODUCER", currency_value: "BRL" },
      ],
      purchase: {
        transaction: ID_TESTE,
        order_date: ms,
        approved_date: ms,
        status: "APPROVED",
        price: { value: 97, currency_value: "BRL" },
        full_price: { value: 97, currency_value: "BRL" },
        payment: { type: "PIX", installments_number: 1 },
        checkout_country: { name: "Brasil", iso: "BR" },
        order_bump: { is_order_bump: false },
        origin: {},
      },
    },
  };
}

// ---------------------------------------------------------------------------
// O formato do aviso real (085)
// ---------------------------------------------------------------------------

/** So o valor destas chaves vai para o formato: a origem da venda, nunca o comprador. */
const RE_CHAVE_DE_ORIGEM = /^(sck|src|xcod)$/i;
const MAX_CHAVES = 200;

/**
 * O formato do aviso real, para conferir na primeira venda o que a doc nao
 * garante (o buyer_ip, o evento do Pix gerado, o "xc." no sck, a unidade do
 * order_date): todos os caminhos de chave (sem valor), o valor SO das chaves
 * de origem, e o evento, o status, o meio de pagamento e o tipo do order_date.
 */
export function formatoDoAvisoHotmart(corpo: unknown, agora: Date): unknown {
  const chaves: string[] = [];
  const origem: Record<string, string> = {};
  const andar = (o: unknown, caminho: string, nivel: number) => {
    if (chaves.length >= MAX_CHAVES || nivel > 5) return;
    if (Array.isArray(o)) {
      if (o.length > 0) andar(o[0], `${caminho}[0]`, nivel + 1);
      return;
    }
    if (!ehObjeto(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (chaves.length >= MAX_CHAVES) return;
      // O hottok nao entra nem como chave.
      if (k.toLowerCase() === "hottok") continue;
      const aqui = caminho ? `${caminho}.${k}` : k;
      chaves.push(aqui);
      if ((typeof v === "string" || typeof v === "number") && RE_CHAVE_DE_ORIGEM.test(k)) {
        const limpo = limparValor(v);
        if (limpo) origem[aqui] = limpo.slice(0, 120);
      }
      andar(v, aqui, nivel + 1);
    }
  };
  andar(corpo, "", 0);
  const c = ehObjeto(corpo) ? corpo : {};
  const dados = ehObjeto(c.data) ? c.data : {};
  const compra = ehObjeto(dados.purchase) ? dados.purchase : {};
  const pagamento = ehObjeto(compra.payment) ? compra.payment : {};
  const od = compra.order_date;
  return {
    em: agora.toISOString(),
    evento: texto(c.event, 40),
    status: texto(compra.status, 40),
    pagamento: texto(pagamento.type, 40),
    // "number:13" = ms; "string:24" = ISO. Nunca o valor.
    order_date: od === null || od === undefined ? null : `${typeof od}:${String(od).length}`,
    chaves,
    origem,
  };
}

export const hotmart: PlataformaCheckout = {
  id: "hotmart",
  nome: "Hotmart",
  modelo: "venda",
  autenticacao: "token_no_header",
  reenvio: "status",
  reenvioNaTela: { automatico: "tenta de novo até 5 vezes", manual: "use o reenvio no Histórico do webhook dela" },
  gatilhos: GATILHOS_HOTMART,
  eventoDeVenda: "PURCHASE_APPROVED",
  ler: lerHotmart,
  lerTodos: lerTodosHotmart,
  autenticar: autenticarHotmart,
  assinar: assinarHotmart,
  exemplo: exemploHotmart,
  formato: formatoDoAvisoHotmart,
};
