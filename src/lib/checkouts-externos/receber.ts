import { aplicarEvento, type EstadoPedido } from "./estado";
import type { EventoNormalizado, PlataformaCheckout } from "./plataformas/tipos";
import { nomeDaPlataforma } from "./tipos";

// ============================================================================
// Um evento do webhook de checkout, do corpo ja lido ate a resposta.
//
// Sem banco aqui: quem grava e o RepositorioCheckout (o de verdade em
// repo-supabase.ts, um em memoria nos testes). Assim a trava de idempotencia
// e a ordem dos eventos tem teste sem Postgres (checkout-externo-estado.test.ts).
//
// A ORDEM DO TRABALHO
//
//   corpo invalido -> 400, e o erro fica no checkout (a tela mostra)
//   evento de teste -> so marca "teste recebido"; NUNCA vira pedido
//   pausado e pedido que nao existe -> 200 ignorado (pedido novo nao entra).
//     Pedido que JA existe segue o caminho normal, so sem notificar: a
//     plataforma manda cada movimentacao uma vez so, e a comissao aprovada
//     ou paga durante a pausa nao pode ficar "pendente" para sempre.
//   afiliado de OUTRO checkout do usuario -> 409 (contaria em dobro). O
//     primeiro evento de cada codigo o liga a este checkout; um checkout pode
//     ter varios (a Sphere nao garante um codigo por conta).
//   trava (checkout, pedido, evento) ja existe -> 200 duplicado
//   pedido gravado (trava otimista pela versao) -> 200
//   falhou ao gravar -> a trava sai e responde 503: a retentativa da
//   plataforma volta pelo caminho normal (mesmo cuidado do webhook da Shopify)
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
  /** Tira a trava (o processamento falhou e a retentativa precisa passar). */
  soltarEvento(x: { checkout_id: string; pedido_id: string; evento: string }): Promise<void>;
  lerPedido(checkoutId: string, pedidoId: string): Promise<PedidoGravado | null>;
  /** "existe" = outro evento criou o pedido no meio do caminho. */
  inserirPedido(x: { checkout_id: string; user_id: string; pedido_id: string; pedido: EstadoPedido }): Promise<"ok" | "existe">;
  /** false = a versao mudou (outro evento gravou antes): ler de novo. */
  atualizarPedido(x: { checkout_id: string; pedido_id: string; versao: number; pedido: EstadoPedido }): Promise<boolean>;
  /**
   * Liga o codigo do afiliado a este checkout (o primeiro evento de cada
   * codigo liga). "em_uso" = o codigo ja e de outro checkout do usuario.
   */
  reivindicarConta(x: { checkout_id: string; user_id: string; plataforma: string; conta: string }): Promise<"ok" | "em_uso">;
  marcarCheckout(checkoutId: string, campos: MarcaCheckout): Promise<void>;
}

export interface Notificacao {
  tipo: "criado" | "aprovado";
  checkout: string;
  pedido: string;
  produto: string | null;
  valor: number;
  moeda: string;
  comissao: number;
  moedaComissao: string;
}

export interface ResultadoRecebimento {
  status: 200 | 400 | 409 | 503;
  corpo: Record<string, unknown>;
  /** A notificacao "Venda no celular", para depois da resposta. */
  notificar: Notificacao | null;
}

const TENTATIVAS = 4;

function resp(status: ResultadoRecebimento["status"], corpo: Record<string, unknown>): ResultadoRecebimento {
  return { status, corpo, notificar: null };
}

/**
 * Grava o pedido com trava otimista. Devolve se o evento venceu, ou lanca.
 * Checkout pausado nao cria pedido: so atualiza o que ja existe.
 */
async function gravarPedido(
  repo: RepositorioCheckout,
  checkout: CheckoutParaReceber,
  ev: EventoNormalizado
): Promise<{ venceu: boolean }> {
  for (let i = 0; i < TENTATIVAS; i += 1) {
    const atual = await repo.lerPedido(checkout.id, ev.pedidoId);
    const r = aplicarEvento(atual, ev, checkout.fuso);
    if (!atual) {
      if (!checkout.ativo) return { venceu: false };
      const ins = await repo.inserirPedido({
        checkout_id: checkout.id,
        user_id: checkout.user_id,
        pedido_id: ev.pedidoId,
        pedido: r.pedido,
      });
      if (ins === "ok") return { venceu: true };
      continue;
    }
    if (!r.mudou) return { venceu: r.venceu };
    const ok = await repo.atualizarPedido({
      checkout_id: checkout.id,
      pedido_id: ev.pedidoId,
      versao: atual.versao,
      pedido: r.pedido,
    });
    if (ok) return { venceu: r.venceu };
  }
  throw new Error("o pedido mudou em todas as tentativas");
}

export async function receberEvento(
  repo: RepositorioCheckout,
  checkout: CheckoutParaReceber,
  plataforma: PlataformaCheckout,
  corpo: unknown,
  agora: Date
): Promise<ResultadoRecebimento> {
  const agoraIso = agora.toISOString();
  const leitura = plataforma.ler(corpo, agora);
  if (!leitura.ok) {
    await repo.marcarCheckout(checkout.id, { ultimo_erro: `Evento recusado: ${leitura.erro}`.slice(0, 500), ultimo_erro_em: agoraIso });
    return resp(400, { ok: false, erro: leitura.erro });
  }
  const ev = leitura.evento;

  if (ev.teste) {
    await repo.marcarCheckout(checkout.id, {
      ultimo_evento_em: agoraIso,
      ultimo_evento: ev.evento,
      ultimo_evento_teste: true,
      ultimo_erro: null,
      ultimo_erro_em: null,
    });
    return resp(200, { ok: true, teste: true });
  }

  // Pausado: pedido novo nao entra (nem liga afiliado, nem trava o evento).
  if (!checkout.ativo && !(await repo.lerPedido(checkout.id, ev.pedidoId))) {
    return resp(200, { ok: true, ignorado: "checkout pausado" });
  }

  if (ev.conta) {
    const dono = await repo.reivindicarConta({
      checkout_id: checkout.id,
      user_id: checkout.user_id,
      plataforma: checkout.plataforma,
      conta: ev.conta,
    });
    if (dono === "em_uso") {
      const nome = nomeDaPlataforma(checkout.plataforma);
      const recusa = `Outro checkout seu já recebe o afiliado ${ev.conta} da ${nome}. Use a URL dele, ou "Trocar URL" nele para soltar o afiliado.`;
      await repo.marcarCheckout(checkout.id, { ultimo_erro: recusa.slice(0, 500), ultimo_erro_em: agoraIso });
      return resp(409, { ok: false, erro: "afiliado de outro checkout" });
    }
  }

  const trava = { checkout_id: checkout.id, pedido_id: ev.pedidoId, evento: ev.evento };
  const travou = await repo.travarEvento({ ...trava, user_id: checkout.user_id, data_evento: ev.dataEvento });
  if (travou === "duplicado") return resp(200, { ok: true, duplicado: true });

  let venceu: boolean;
  try {
    ({ venceu } = await gravarPedido(repo, checkout, ev));
  } catch (e) {
    console.error("[checkout/webhook] falha ao gravar o pedido", e instanceof Error ? e.message : e);
    // Sem soltar a trava, a retentativa cairia em "duplicado" e o evento se perderia.
    await repo.soltarEvento(trava).catch(() => undefined);
    return resp(503, { ok: false, erro: "tente de novo" });
  }

  await repo.marcarCheckout(checkout.id, {
    ultimo_evento_em: agoraIso,
    ultimo_evento: ev.evento,
    ultimo_evento_teste: false,
    ultimo_erro: null,
    ultimo_erro_em: null,
  });

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
  const notificar: Notificacao | null = !checkout.ativo
    ? null
    : ev.evento === "pedido.criado"
      ? { tipo: "criado", ...base }
      : checkout.notificar_aprovada && ev.receita.situacao === "aprovado" && venceu
        ? { tipo: "aprovado", ...base }
        : null;

  return { status: 200, corpo: { ok: true }, notificar };
}
