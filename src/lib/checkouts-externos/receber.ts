import { comprasDaEntrega, enfileirarCompras, type EnvioParaEntregar, type RastreioCheckout } from "./compra";
import { aplicarEvento, eventoJaRefletido, type EstadoPedido } from "./estado";
import type { EventoNormalizado, LeituraVarios, PlataformaCheckout } from "./plataformas/tipos";
import { compraQuandoDe, nomeDaPlataforma } from "./tipos";

// ============================================================================
// Um evento do webhook de checkout, do corpo ja lido ate a resposta.
//
// Sem banco aqui: quem grava e o RepositorioCheckout (o de verdade em
// repo-supabase.ts, um em memoria nos testes). Assim a trava de idempotencia
// e a ordem dos eventos tem teste sem Postgres (checkout-externo-estado.test.ts).
//
// A ORDEM DO TRABALHO
//
//   plataforma que assina (Cakto) ou manda token (Hubla) -> confere a origem
//     (o HMAC do corpo CRU, o x-hubla-token); sem secret/token salvo ou com
//     ele errado -> 401, e o erro fica no checkout
//   corpo invalido -> 400, e o erro fica no checkout (a tela mostra)
//   evento que nao vira pedido (abandono, assinatura, o status_updated da
//     Hubla que repete um evento proprio) -> 200 ignorado
//   evento de teste -> so marca "teste recebido"; NUNCA vira pedido
//   pausado e pedido que nao existe -> 200 ignorado (pedido novo nao entra).
//     Pedido que JA existe segue o caminho normal, so sem notificar: a
//     plataforma manda cada movimentacao uma vez so, e a comissao aprovada
//     ou paga durante a pausa nao pode ficar "pendente" para sempre.
//   afiliado de OUTRO checkout do usuario -> 409 (contaria em dobro). O
//     primeiro evento de cada codigo o liga a este checkout; um checkout pode
//     ter varios (a Sphere nao garante um codigo por conta).
//   trava (checkout, pedido, evento) ja existe -> 200 duplicado. Se o pedido
//     gravado NAO tem o evento (a gravacao falhou e a trava nao saiu), refaz:
//     senao a retentativa e o Reenviar cairiam em duplicado para sempre.
//   pedido gravado (trava otimista pela versao) -> 200
//   falhou ao gravar -> a trava sai e responde 503. A Sphere, a Hubla e o Eve
//     tentam de novo com o 503; a Cakto NAO (so timeout e erro de rede): `segurar` pede a
//     rota para segurar a resposta ate o timeout dela, e o erro fica no
//     checkout com a instrucao de reenvio (que vale mesmo com a trava presa).
//
// Uma entrega pode trazer VARIOS pedidos (V2 da Cakto: principal, order bump
// e upsell da mesma cobranca). Cada um tem a sua trava: na retentativa, o que
// ja entrou cai em "duplicado" e so o que falhou e gravado.
//
// A COMPRA PELO SERVIDOR (073, so no modelo venda): depois de gravar, o
// evento de venda que venceu entra na fila do Meta e do TikTok (compra.ts),
// ANTES da resposta -- e so um insert; o envio sai em after() na rota. Nao
// passa: teste, checkout pausado, destino desligado. Falhou ao enfileirar ->
// as travas dos itens da compra saem e a resposta e a da falha nossa: a
// retentativa refaz (o pedido ja esta igual) e o indice unico da fila impede
// a dobra. A Venda no celular desses itens fica para a retentativa.
// ============================================================================

export interface CheckoutParaReceber {
  id: string;
  user_id: string;
  plataforma: string;
  nome: string;
  ativo: boolean;
  fuso: string;
  moeda_receita: string;
  notificar_aprovada: boolean;
  /** Venda (072): avisar Pix/boleto gerado. Ausente = nao. */
  notificar_pendente?: boolean | null;
  /** Venda (072): avisar reembolso e chargeback. Ausente = nao. */
  notificar_estorno?: boolean | null;
  /** Rastreamento (073): quando a compra sai ao Meta e ao TikTok. Ausente = o padrao ("gerada"). */
  compra_quando?: string | null;
  /** Para o teste nao esconder um webhook parado (ver o ramo do teste). */
  ultimo_evento_em: string | null;
  ultimo_evento_teste: boolean;
}

export type PedidoGravado = EstadoPedido & { versao: number };

export interface MarcaCheckout {
  ultimo_evento_em?: string;
  ultimo_evento?: string;
  ultimo_evento_teste?: boolean;
  ultimo_erro?: string | null;
  ultimo_erro_em?: string | null;
}

export interface RepositorioCheckout {
  /** Grava a trava do evento. "duplicado" = ja existia. Outro erro LANCA. */
  travarEvento(x: { checkout_id: string; user_id: string; pedido_id: string; evento: string; data_evento: string }): Promise<"ok" | "duplicado">;
  /** Tira a trava (o processamento falhou e a retentativa precisa passar). Erro LANCA. */
  soltarEvento(x: { checkout_id: string; pedido_id: string; evento: string }): Promise<void>;
  /**
   * Quando a trava foi gravada (ISO); null = nao achou. Sem o metodo, toda
   * trava conta como antiga (o comportamento de antes).
   */
  travaRecebidaEm?(x: { checkout_id: string; pedido_id: string; evento: string }): Promise<string | null>;
  lerPedido(checkoutId: string, pedidoId: string): Promise<PedidoGravado | null>;
  /**
   * "existe" = outro evento criou o pedido no meio do caminho. `venda` = o
   * pedido e do modelo venda e grava as colunas da 072 (a Sphere grava so as
   * da 069, com ou sem a migration).
   */
  inserirPedido(x: { checkout_id: string; user_id: string; pedido_id: string; pedido: EstadoPedido; venda?: boolean }): Promise<"ok" | "existe">;
  /** false = a versao mudou (outro evento gravou antes): ler de novo. */
  atualizarPedido(x: { checkout_id: string; pedido_id: string; versao: number; pedido: EstadoPedido; venda?: boolean }): Promise<boolean>;
  /**
   * Liga o codigo do afiliado a este checkout (o primeiro evento de cada
   * codigo liga). "em_uso" = o codigo ja e de outro checkout do usuario.
   */
  reivindicarConta(x: { checkout_id: string; user_id: string; plataforma: string; conta: string }): Promise<"ok" | "em_uso">;
  marcarCheckout(checkoutId: string, campos: MarcaCheckout): Promise<void>;
}

export interface Notificacao {
  /**
   * Sphere: "criado" (pedido criado) e "aprovado" (comissao aprovada, se o
   * checkout pedir). Venda: "venda" (compra aprovada, sempre), "pendente"
   * (Pix/boleto gerado) e "estorno" (reembolso, chargeback), os dois se o
   * checkout pedir.
   */
  tipo: "criado" | "aprovado" | "venda" | "pendente" | "estorno";
  checkout: string;
  pedido: string;
  produto: string | null;
  /** Total do pedido (Sphere) ou faturamento da cobranca (venda). */
  valor: number;
  moeda: string;
  /** A comissao (Sphere) ou o liquido da cobranca (venda). */
  comissao: number;
  moedaComissao: string;
  /** Venda: os produtos da cobranca, o principal primeiro. */
  produtos?: string[];
  /** Venda pendente: o meio da cobranca gerada (pix, boleto...). */
  metodo?: string | null;
  estorno?: "reembolso" | "chargeback";
}

export interface ResultadoRecebimento {
  status: 200 | 400 | 401 | 409 | 503;
  corpo: Record<string, unknown>;
  /** A notificacao "Venda no celular", para depois da resposta. */
  notificar: Notificacao | null;
  /** Falha nossa numa plataforma que so reenvia por timeout: a rota segura a resposta. */
  segurar?: true;
  /** As compras que entraram na fila (073): a rota manda em after(). */
  entregar?: EnvioParaEntregar[];
}

/** A credencial da entrega: o corpo cru, os headers e o secret salvo da plataforma. */
export interface EntregaRecebida {
  raw: string | Uint8Array;
  headers: Headers;
  segredo: string | null;
}

const TENTATIVAS = 4;

/**
 * Trava mais nova que isto e de uma entrega que ainda esta gravando (a
 * plataforma mandou duas vezes, ou a retentativa chegou antes de a primeira
 * terminar): ela grava e avisa, esta responde duplicado. Passa do maxDuration
 * da rota (30 s) com folga: trava mais velha sem o evento no pedido ficou presa.
 */
const TRAVA_EM_ANDAMENTO_MS = 60_000;

function resp(status: ResultadoRecebimento["status"], corpo: Record<string, unknown>): ResultadoRecebimento {
  return { status, corpo, notificar: null };
}

/**
 * Onde o lojista manda de novo: o Reenviar da Cakto, o Reprocessar do
 * historico da Hubla, ou a frase da propria plataforma (Eve: `reenvioNaTela`).
 */
export function comoReenviar(plataforma: Pick<PlataformaCheckout, "autenticacao" | "reenvioNaTela">): string {
  if (plataforma.reenvioNaTela) return plataforma.reenvioNaTela.manual;
  return plataforma.autenticacao === "token_no_header" ? "use Reprocessar no histórico de eventos dela" : "use Reenviar no painel dela";
}

/**
 * Como a plataforma manda de novo sozinha, para "A <nome> ...": a Cakto pelo
 * timeout; a Hubla na hora, por ~1 min; o Eve pela fila de jobs dele.
 */
export function comoTentaDeNovo(plataforma: Pick<PlataformaCheckout, "reenvio" | "reenvioNaTela">): string {
  if (plataforma.reenvio === "timeout") return "manda de novo em alguns minutos";
  return plataforma.reenvioNaTela?.automatico ?? "tenta de novo por cerca de 1 minuto";
}

/**
 * A Hubla reenvia na hora, 5 vezes em ~75 s, e para; o Eve, 5 vezes em ~15
 * min pela fila dele: banco fora por mais que isso perde o evento. As duas
 * (origem conferida, reenvio por status) marcam o erro na tela com o caminho
 * de volta. A Sphere segue sem marca.
 */
export function marcaFalhaSemSegurar(plataforma: Pick<PlataformaCheckout, "autenticar" | "reenvio">): boolean {
  return Boolean(plataforma.autenticar) && plataforma.reenvio === "status";
}

/** Uma ou varias: o adaptador de varios (Cakto, Hubla) ou o de um so (Sphere). */
function lerEntrega(plataforma: PlataformaCheckout, corpo: unknown, agora: Date, headers?: Headers): LeituraVarios {
  if (plataforma.lerTodos) return plataforma.lerTodos(corpo, agora, headers);
  const r = plataforma.ler(corpo, agora, headers);
  return r.ok ? { ok: true, eventos: [r.evento] } : r;
}

/**
 * Grava o pedido com trava otimista. Devolve se o evento venceu e se ESTA
 * chamada escreveu, ou lanca. Checkout pausado nao cria pedido: so atualiza o
 * que ja existe.
 */
async function gravarPedido(
  repo: RepositorioCheckout,
  checkout: CheckoutParaReceber,
  ev: EventoNormalizado,
  venda: boolean
): Promise<{ venceu: boolean; escreveu: boolean }> {
  for (let i = 0; i < TENTATIVAS; i += 1) {
    const atual = await repo.lerPedido(checkout.id, ev.pedidoId);
    const r = aplicarEvento(atual, ev, checkout.fuso);
    if (!atual) {
      if (!checkout.ativo) return { venceu: false, escreveu: false };
      const ins = await repo.inserirPedido({
        checkout_id: checkout.id,
        user_id: checkout.user_id,
        pedido_id: ev.pedidoId,
        pedido: r.pedido,
        ...(venda ? { venda: true } : {}),
      });
      if (ins === "ok") return { venceu: true, escreveu: true };
      continue;
    }
    if (!r.mudou) return { venceu: r.venceu, escreveu: false };
    const ok = await repo.atualizarPedido({
      checkout_id: checkout.id,
      pedido_id: ev.pedidoId,
      versao: atual.versao,
      pedido: r.pedido,
      ...(venda ? { venda: true } : {}),
    });
    if (ok) return { venceu: r.venceu, escreveu: true };
  }
  throw new Error("o pedido mudou em todas as tentativas");
}

type Aplicado = { ev: EventoNormalizado; venceu: boolean };

/** "#4852F91": o id que o painel da plataforma mostra, quando ela manda um. */
function rotuloDoPedido(ev: EventoNormalizado): string {
  return `#${ev.venda?.referencia ?? ev.pedidoId}`;
}

/** Uma notificacao por cobranca: o principal primeiro, os valores somados. */
function notificacaoDaCobranca(
  tipo: "venda" | "pendente" | "estorno",
  checkout: CheckoutParaReceber,
  lista: Aplicado[]
): Notificacao {
  const ordenada = [...lista].sort(
    (a, b) => Number(b.ev.venda?.ofertaTipo === "main") - Number(a.ev.venda?.ofertaTipo === "main")
  );
  const primeiro = ordenada[0].ev;
  const soma = (f: (e: EventoNormalizado) => number) =>
    Math.round(ordenada.reduce((s, r) => s + f(r.ev), 0) * 100) / 100;
  const chargeback = ordenada.some((r) => r.ev.venda?.chargebackEm);
  return {
    tipo,
    checkout: checkout.nome,
    pedido: rotuloDoPedido(primeiro),
    produto: primeiro.pedido.produto,
    produtos: ordenada.map((r) => r.ev.pedido.produto).filter((p): p is string => Boolean(p)),
    valor: soma((e) => e.pedido.valor),
    moeda: primeiro.pedido.moeda || checkout.moeda_receita,
    comissao: soma((e) => e.receita.valor),
    moedaComissao: primeiro.receita.moeda || checkout.moeda_receita,
    ...(tipo === "pendente" ? { metodo: primeiro.pedido.metodo } : {}),
    ...(tipo === "estorno" ? { estorno: chargeback ? ("chargeback" as const) : ("reembolso" as const) } : {}),
  };
}

/**
 * Venda: a compra aprovada que venceu avisa sempre; Pix/boleto gerado e
 * estorno so com o checkout pedindo (desligados por padrao).
 */
function notificacaoDaVenda(
  checkout: CheckoutParaReceber,
  plataforma: PlataformaCheckout,
  aplicados: Aplicado[]
): Notificacao | null {
  const venceram = aplicados.filter((a) => a.venceu);
  const pagos = venceram.filter((a) => a.ev.evento === plataforma.eventoDeVenda && a.ev.receita.situacao === "pago");
  if (pagos.length > 0) return notificacaoDaCobranca("venda", checkout, pagos);
  // So a cobranca que se paga depois (a Hubla marca o cartao com cobrancaGerada false).
  const pendentes = venceram.filter((a) => a.ev.receita.situacao === "pendente" && a.ev.venda?.cobrancaGerada !== false);
  if (checkout.notificar_pendente && pendentes.length > 0) return notificacaoDaCobranca("pendente", checkout, pendentes);
  const estornos = venceram.filter((a) => a.ev.receita.situacao === "revertido");
  if (checkout.notificar_estorno && estornos.length > 0) return notificacaoDaCobranca("estorno", checkout, estornos);
  return null;
}

export async function receberEvento(
  repo: RepositorioCheckout,
  checkout: CheckoutParaReceber,
  plataforma: PlataformaCheckout,
  corpo: unknown,
  agora: Date,
  entrega?: EntregaRecebida,
  /** A fila da compra pelo servidor (073). Ausente = nada vai ao Meta nem ao TikTok. */
  rastreio?: RastreioCheckout
): Promise<ResultadoRecebimento> {
  const agoraIso = agora.toISOString();
  const nome = nomeDaPlataforma(checkout.plataforma);

  // A origem antes de tudo (a Cakto assina; a Sphere nao: a URL basta).
  if (plataforma.autenticar) {
    const auth = plataforma.autenticar(entrega?.raw ?? "", entrega?.headers ?? new Headers(), entrega?.segredo ?? null, agora);
    if (!auth.ok) {
      // A Hubla manda um token fixo (nao assina) e reenvia pelo histórico de eventos.
      const token = plataforma.autenticacao === "token_no_header";
      const reenviar = comoReenviar(plataforma);
      const motivo = auth.semSegredo
        ? `Cole aqui o ${token ? "token" : "secret"} do webhook da ${nome} e ${reenviar}.`
        : token
          ? `O token da ${nome} não confere (${auth.erro}). Confira o token colado aqui e ${reenviar}.`
          : `A assinatura da ${nome} não confere (${auth.erro}). Confira o secret colado aqui e ${reenviar}.`;
      await repo.marcarCheckout(checkout.id, { ultimo_erro: motivo.slice(0, 500), ultimo_erro_em: agoraIso });
      return resp(401, { ok: false, erro: "nao autorizado" });
    }
  }

  const leitura = lerEntrega(plataforma, corpo, agora, entrega?.headers);
  if (!leitura.ok) {
    await repo.marcarCheckout(checkout.id, { ultimo_erro: `Evento recusado: ${leitura.erro}`.slice(0, 500), ultimo_erro_em: agoraIso });
    return resp(400, { ok: false, erro: leitura.erro });
  }
  // Abandono, assinatura: chega, mas nao vira pedido.
  if (leitura.eventos.length === 0) return resp(200, { ok: true, ignorado: leitura.ignorado ?? "evento" });

  // A moeda fica gravada no pedido (a Sphere nao manda a da comissao; a Cakto
  // pode nao mandar a da venda): trocar a moeda do checkout depois nao
  // reescreve o passado.
  const eventos: EventoNormalizado[] = leitura.eventos.map((e) => {
    const moeda = e.receita.moeda || checkout.moeda_receita;
    return {
      ...e,
      pedido: e.pedido.moeda ? e.pedido : { ...e.pedido, moeda },
      receita: { ...e.receita, moeda },
    };
  });

  if (eventos.some((e) => e.teste)) {
    // So marca "teste recebido" enquanto nao chegou evento real: num checkout
    // que ja recebe, o teste apagaria o "ultimo evento ha X" e o relogio do
    // aviso de webhook parado. Quem confere o teste le a resposta.
    if (!checkout.ultimo_evento_em || checkout.ultimo_evento_teste) {
      await repo.marcarCheckout(checkout.id, {
        ultimo_evento_em: agoraIso,
        ultimo_evento: eventos[0].evento,
        ultimo_evento_teste: true,
        ultimo_erro: null,
        ultimo_erro_em: null,
      });
    }
    return resp(200, { ok: true, teste: true });
  }

  const venda = plataforma.modelo === "venda";
  const aplicados: Aplicado[] = [];
  let pausados = 0;
  let duplicados = 0;
  let falhou = false;
  /** Hubla e Eve: trava recente sem o evento no pedido (ver o ramo `refazendo`). */
  let emAndamento = false;
  for (const ev of eventos) {
    // Pausado: pedido novo nao entra (nem liga afiliado, nem trava o evento).
    if (!checkout.ativo && !(await repo.lerPedido(checkout.id, ev.pedidoId))) {
      pausados += 1;
      continue;
    }

    if (ev.conta) {
      const dono = await repo.reivindicarConta({
        checkout_id: checkout.id,
        user_id: checkout.user_id,
        plataforma: checkout.plataforma,
        conta: ev.conta,
      });
      if (dono === "em_uso") {
        const recusa = `Outro checkout seu já recebe o afiliado ${ev.conta} da ${nome}. Use a URL dele, ou "Trocar URL" nele para soltar o afiliado.`;
        await repo.marcarCheckout(checkout.id, { ultimo_erro: recusa.slice(0, 500), ultimo_erro_em: agoraIso });
        return resp(409, { ok: false, erro: "afiliado de outro checkout" });
      }
    }

    const trava = { checkout_id: checkout.id, pedido_id: ev.pedidoId, evento: ev.evento };
    const travou = await repo.travarEvento({ ...trava, user_id: checkout.user_id, data_evento: ev.dataEvento });
    // Trava que ja existe e a retentativa do que ja entrou -- menos quando a
    // gravacao falhou e a trava NAO saiu (o banco caiu nas duas): o pedido
    // nao tem o evento, e a retentativa e o Reenviar cairiam aqui para sempre.
    // Ai refaz; aplicarEvento e idempotente e a corrida cai na versao/23505.
    const refazendo = travou === "duplicado";
    if (refazendo) {
      const em = repo.travaRecebidaEm ? await repo.travaRecebidaEm(trava).catch(() => null) : null;
      const idade = em ? agora.getTime() - Date.parse(em) : NaN;
      const recente = Number.isFinite(idade) && idade < TRAVA_EM_ANDAMENTO_MS;
      if (recente && marcaFalhaSemSegurar(plataforma)) {
        // Hubla: as retentativas chegam em ~5, 15 e 35 s, todas dentro da
        // janela; a 1a do Eve em 30 s. "Duplicado" ali e 200 e ela para -- se
        // a gravacao e o soltar falharam juntos, a venda se perdia. Sem o
        // evento no pedido, 503: a proxima acha o evento (200) ou, ja velha, refaz.
        if (eventoJaRefletido(await repo.lerPedido(checkout.id, ev.pedidoId), ev, checkout.fuso)) duplicados += 1;
        else emAndamento = true;
        continue;
      }
      if (recente || eventoJaRefletido(await repo.lerPedido(checkout.id, ev.pedidoId), ev, checkout.fuso)) {
        duplicados += 1;
        continue;
      }
    }

    try {
      const { venceu, escreveu } = await gravarPedido(repo, checkout, ev, venda);
      // Refazendo, so avisa quem escreveu: a outra entrega pode ter gravado.
      if (refazendo && !escreveu) duplicados += 1;
      else aplicados.push({ ev, venceu });
    } catch (e) {
      console.error("[checkout/webhook] falha ao gravar o pedido", e instanceof Error ? e.message : e);
      // Sem soltar a trava, a retentativa cairia em "duplicado". Se nem isso
      // der, ela refaz pelo ramo acima (o pedido nao tem o evento).
      await repo.soltarEvento(trava).catch((erro: unknown) => {
        console.error("[checkout/webhook] a trava nao saiu", erro instanceof Error ? erro.message : erro);
      });
      falhou = true;
    }
  }

  // A compra pelo servidor (073): so o modelo venda, checkout ativo, e o
  // evento de venda que venceu. Grava antes de responder; a rota entrega.
  let entregar: EnvioParaEntregar[] = [];
  let avisados = aplicados;
  if (venda && checkout.ativo && rastreio && aplicados.length > 0) {
    const compras = comprasDaEntrega(aplicados, compraQuandoDe(checkout.compra_quando), plataforma.eventoDeVenda);
    try {
      entregar = await enfileirarCompras(rastreio, checkout, compras, agora.getTime());
    } catch (e) {
      console.error("[checkout/webhook] falha ao enfileirar a compra", e instanceof Error ? e.message : e);
      // Sem a trava, a retentativa refaz o item (o pedido ja esta igual) e
      // enfileira; o indice unico da fila segura a dobra do que ja entrou.
      const fora = new Set(compras.flatMap((c) => c.itens));
      for (const ev of fora) {
        await repo.soltarEvento({ checkout_id: checkout.id, pedido_id: ev.pedidoId, evento: ev.evento }).catch((erro: unknown) => {
          console.error("[checkout/webhook] a trava nao saiu", erro instanceof Error ? erro.message : erro);
        });
      }
      // A Venda no celular deles sai na retentativa, que nao vai cair em "duplicado".
      avisados = aplicados.filter((a) => !fora.has(a.ev));
      falhou = true;
    }
  }
  const comEnvios = entregar.length > 0 ? { entregar } : {};

  // O que entrou avisa (a retentativa dele vai cair em "duplicado"). O
  // historico (semAviso) grava calado: a venda e de antes da conexao.
  avisados = avisados.filter((a) => !a.ev.semAviso);
  const notificar = !checkout.ativo || avisados.length === 0 ? null : venda ? notificacaoDaVenda(checkout, plataforma, avisados) : null;

  if (falhou) {
    if (plataforma.reenvio === "timeout") {
      await repo.marcarCheckout(checkout.id, {
        ultimo_erro: `Falha nossa ao gravar um evento. A ${nome} manda de novo em alguns minutos; se o erro ficar, ${comoReenviar(plataforma)}.`,
        ultimo_erro_em: agoraIso,
      });
      return { status: 503, corpo: { ok: false, erro: "tente de novo" }, notificar, segurar: true, ...comEnvios };
    }
    if (marcaFalhaSemSegurar(plataforma)) {
      await repo.marcarCheckout(checkout.id, {
        ultimo_erro: `Falha nossa ao gravar um evento. A ${nome} ${comoTentaDeNovo(plataforma)}; se o erro ficar, ${comoReenviar(plataforma)}.`.slice(0, 500),
        ultimo_erro_em: agoraIso,
      });
    }
    return { status: 503, corpo: { ok: false, erro: "tente de novo" }, notificar, ...comEnvios };
  }

  if (aplicados.length === 0 && emAndamento) return resp(503, { ok: false, erro: "tente de novo" });
  if (aplicados.length === 0) {
    return pausados > 0 && duplicados === 0
      ? resp(200, { ok: true, ignorado: "checkout pausado" })
      : resp(200, { ok: true, duplicado: true });
  }

  await repo.marcarCheckout(checkout.id, {
    ultimo_evento_em: agoraIso,
    ultimo_evento: aplicados[aplicados.length - 1].ev.evento,
    ultimo_evento_teste: false,
    ultimo_erro: null,
    ultimo_erro_em: null,
  });

  if (venda) return { status: 200, corpo: { ok: true }, notificar, ...comEnvios };

  // Comissao (Sphere): um pedido por entrega.
  const { ev, venceu } = aplicados[0];
  const base = {
    checkout: checkout.nome,
    pedido: `#${ev.pedidoId}`,
    produto: ev.pedido.produto,
    valor: ev.pedido.valor,
    moeda: ev.pedido.moeda,
    comissao: ev.receita.valor,
    moedaComissao: ev.receita.moeda || checkout.moeda_receita,
  };
  // O pedido criado avisa uma vez (a trava e por pedido e evento). A comissao
  // aprovada so com o checkout pedindo, e so se ela mudou o pedido. Pausado
  // nao avisa nada.
  const aviso: Notificacao | null = !checkout.ativo
    ? null
    : ev.evento === plataforma.eventoDeVenda
      ? { tipo: "criado", ...base }
      : checkout.notificar_aprovada && ev.receita.situacao === "aprovado" && venceu
        ? { tipo: "aprovado", ...base }
        : null;

  return { status: 200, corpo: { ok: true }, notificar: aviso };
}
