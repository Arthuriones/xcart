import { diaNoFuso } from "@/lib/financeiro/tipos";
import type { EventoNormalizado } from "./plataformas/tipos";
import type { SituacaoExterna } from "./tipos";

// ============================================================================
// O estado de um pedido externo a partir dos eventos, em qualquer ordem.
//
// A plataforma manda cada movimentacao uma vez, com 1 retentativa -- e nada
// garante a ordem de chegada. Entao o pedido guarda o ULTIMO estado e cada
// evento passa por aplicarEvento(atual, novo):
//
//   1. Evento mais velho que o ultimo aplicado (data_evento) nao muda a
//      situacao -- a retentativa atrasada nao desfaz o que ja andou. Mas ele
//      ainda preenche o que faltava (a data de aprovacao, o produto).
//   2. Nunca volta para "pendente": pendente e so o comeco.
//   3. Pago nunca volta para aprovado (pago ja foi aprovado).
//   4. No mesmo instante, vence a ordem pendente < aprovado < pago <
//      expirado < revertido.
//   5. Qualquer evento cria o pedido com todos os campos: se o pedido.criado
//      se perdeu, a comissao.aprovada cria o pedido.
//
// Puro: testado em tests/checkout-externo-estado.test.ts.
// ============================================================================

const ORDEM: Record<SituacaoExterna, number> = {
  pendente: 0,
  aprovado: 1,
  pago: 2,
  expirado: 3,
  revertido: 4,
};

/** O pedido como a tabela guarda (pedidos_externos), sem chaves nem versao. */
export interface EstadoPedido {
  situacao: SituacaoExterna;
  status_comissao: string | null;
  status_pedido: string | null;
  metodo_pagamento: string | null;
  produto: string | null;
  pais: string | null;
  programa: string | null;
  moeda: string;
  valor: number;
  receita: number;
  moeda_receita: string | null;
  criado_em: string;
  dia_local: string;
  aprovado_em: string | null;
  pago_em: string | null;
  perdido_em: string | null;
  atualizado_em: string;
}

/** O dia do pedido no fuso do checkout: o periodo do Dashboard le por ele. */
export function diaDoPedido(criadoEm: string, fuso: string | null | undefined): string {
  return diaNoFuso(new Date(criadoEm), fuso || "UTC");
}

/** As datas de cada etapa que este evento prova. */
function marcos(s: SituacaoExterna, quando: string) {
  return {
    aprovado_em: s === "aprovado" || s === "pago" ? quando : null,
    pago_em: s === "pago" ? quando : null,
    perdido_em: s === "expirado" || s === "revertido" ? quando : null,
  };
}

/** A data mais antiga das duas (a primeira vez que a etapa aconteceu). */
function primeira(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/** O pedido novo, so com este evento. */
export function pedidoDoEvento(ev: EventoNormalizado, fuso: string | null | undefined): EstadoPedido {
  return {
    situacao: ev.receita.situacao,
    status_comissao: ev.receita.statusOriginal,
    status_pedido: ev.pedido.status,
    metodo_pagamento: ev.pedido.metodo,
    produto: ev.pedido.produto,
    pais: ev.pedido.pais,
    programa: ev.programa,
    moeda: ev.pedido.moeda,
    valor: ev.pedido.valor,
    receita: ev.receita.valor,
    moeda_receita: ev.receita.moeda,
    criado_em: ev.pedido.criadoEm,
    dia_local: diaDoPedido(ev.pedido.criadoEm, fuso),
    ...marcos(ev.receita.situacao, ev.dataEvento),
    atualizado_em: ev.dataEvento,
  };
}

/** O evento muda a situacao do pedido? (as regras 1 a 4 do topo) */
export function eventoVence(atual: Pick<EstadoPedido, "situacao" | "atualizado_em">, novo: { situacao: SituacaoExterna; dataEvento: string }): boolean {
  if (novo.situacao === "pendente" && atual.situacao !== "pendente") return false;
  if (atual.situacao === "pago" && novo.situacao === "aprovado") return false;
  const a = Date.parse(atual.atualizado_em);
  const b = Date.parse(novo.dataEvento);
  if (b < a) return false;
  if (b > a) return true;
  return ORDEM[novo.situacao] >= ORDEM[atual.situacao];
}

/**
 * O pedido depois do evento. `atual` null = primeiro evento do pedido.
 * `mudou` false = nada a gravar (evento repetido ou velho sem novidade).
 */
export function aplicarEvento(
  atual: EstadoPedido | null,
  ev: EventoNormalizado,
  fuso: string | null | undefined
): { pedido: EstadoPedido; venceu: boolean; mudou: boolean } {
  const novo = pedidoDoEvento(ev, fuso);
  if (!atual) return { pedido: novo, venceu: true, mudou: true };

  const venceu = eventoVence(atual, { situacao: ev.receita.situacao, dataEvento: ev.dataEvento });
  const m = marcos(ev.receita.situacao, ev.dataEvento);
  const base = venceu
    ? {
        ...atual,
        situacao: novo.situacao,
        status_comissao: novo.status_comissao ?? atual.status_comissao,
        status_pedido: novo.status_pedido ?? atual.status_pedido,
        metodo_pagamento: novo.metodo_pagamento ?? atual.metodo_pagamento,
        produto: novo.produto ?? atual.produto,
        pais: novo.pais ?? atual.pais,
        programa: novo.programa ?? atual.programa,
        moeda: novo.moeda,
        valor: novo.valor,
        // Comissao zero num evento que so muda a situacao nao apaga a que ja veio.
        receita: novo.receita > 0 ? novo.receita : atual.receita,
        moeda_receita: novo.moeda_receita ?? atual.moeda_receita,
        atualizado_em: ev.dataEvento,
      }
    : {
        // Velho: so completa o que faltava.
        ...atual,
        produto: atual.produto ?? novo.produto,
        pais: atual.pais ?? novo.pais,
        programa: atual.programa ?? novo.programa,
        metodo_pagamento: atual.metodo_pagamento ?? novo.metodo_pagamento,
        receita: atual.receita > 0 ? atual.receita : novo.receita,
      };
  const pedido: EstadoPedido = {
    ...base,
    aprovado_em: primeira(atual.aprovado_em, m.aprovado_em),
    pago_em: primeira(atual.pago_em, m.pago_em),
    // So o perdido do estado atual: comissao revertida e depois paga de novo
    // nao fica marcada como perdida.
    perdido_em:
      base.situacao === "expirado" || base.situacao === "revertido"
        ? primeira(atual.perdido_em, m.perdido_em)
        : null,
  };
  const mudou = (Object.keys(pedido) as (keyof EstadoPedido)[]).some((k) => pedido[k] !== atual[k]);
  return { pedido, venceu, mudou };
}
