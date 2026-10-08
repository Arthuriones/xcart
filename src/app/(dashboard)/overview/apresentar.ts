import { mapaVelho, targetState } from "@/components/routed-checkout/target-state";
import { quandoFoi } from "@/lib/leitura/lojas-estado";
import { hrefRota } from "@/app/(dashboard)/clone/routed-checkout/logica";
import { repartirCem } from "@/lib/sales/share";
import { avisoDeMoeda, lerCarrinhoLevado } from "@/lib/checkout-routes/carrinho-levado";
// So tipos: o modulo de leitura e do servidor e nao entra aqui.
import type { DestinoDaRota, EventoDaRota, RotaDaLista } from "@/lib/leitura/visao-rota";

// ============================================================================
// Regras da Visao da rota, sem React e sem banco: qual rota abrir, o estado e
// a fatia de cada loja de checkout, o que vira problema (e em que tom), os
// eventos do script em frases e o "ha 5 min". Puro para o vitest travar.
// ============================================================================

/** O console de roteamento: onde se conserta o mapa, a divisao e o script. */
export const CONSOLE = "/clone/routed-checkout";

/** "1 loja de checkout", "3 lojas de checkout": nunca o plural entre parenteses. */
export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** Nome da rota para o lojista: o nome dado, ou o da vitrine. */
export function nomeDaRota(r: Pick<RotaDaLista, "nome" | "vitrine">): string {
  return r.nome.trim() || r.vitrine?.nome || "Rota sem nome";
}

/**
 * Qual rota a tela abre: a pedida na URL (?rota=), se for do usuario; senao a
 * primeira ligada; senao a primeira. Id desconhecido nao e erro: cai no padrao.
 */
export function escolherRota<R extends Pick<RotaDaLista, "id" | "ativa">>(
  rotas: R[],
  pedida?: string | null
): R | null {
  if (rotas.length === 0) return null;
  return rotas.find((r) => r.id === pedida) ?? rotas.find((r) => r.ativa) ?? rotas[0];
}

// ---------------------------------------------------------------------------
// Lojas de checkout da rota
// ---------------------------------------------------------------------------

export type EstadoDestino = "ok" | "paused" | "attention";

export interface DestinoNaTela extends DestinoDaRota {
  nome: string;
  dominio: string;
  estado: EstadoDestino;
  /** % do trafego que esta loja recebe agora (0 quando a rota esta pausada). */
  fatia: number;
}

/**
 * Estado e fatia de cada loja. O estado e o mesmo do console (targetState);
 * com a rota pausada ninguem recebe comprador, entao "ativa" vira "pausada"
 * -- "atencao" continua, porque o mapa vazio segue errado.
 * A fatia soma 100 (maior resto), como na tela de Vendas.
 */
export function destinosNaTela(destinos: DestinoDaRota[], rotaAtiva: boolean): DestinoNaTela[] {
  const recebe = (d: DestinoDaRota) => rotaAtiva && d.ligado && d.peso > 0;
  const fatias = repartirCem(destinos.map((d) => (recebe(d) ? d.peso : 0)));
  return destinos.map((d, i) => {
    const base = targetState({
      id: d.id,
      name: "",
      domain: "",
      enabled: d.ligado,
      weight: d.peso,
      sharePercent: 0,
      mappedSkuCount: d.mapeados,
    });
    return {
      ...d,
      nome: d.loja?.nome || "Loja removida",
      dominio: d.loja?.dominio ?? "",
      estado: base === "ok" && !rotaAtiva ? "paused" : base,
      fatia: fatias[i],
    };
  });
}

/** Produtos ligados por SKU: o maior mapa e, se diferem, a faixa entre as lojas. */
export function produtosLigados(destinos: Pick<DestinoNaTela, "mapeados" | "ligado">[]): {
  valor: number | null;
  menor: number | null;
} {
  const ligados = destinos.filter((d) => d.ligado);
  const base = ligados.length > 0 ? ligados : destinos;
  if (base.length === 0) return { valor: null, menor: null };
  const valores = base.map((d) => d.mapeados);
  const maior = Math.max(...valores);
  const menor = Math.min(...valores);
  return { valor: maior, menor: menor === maior ? null : menor };
}

// ---------------------------------------------------------------------------
// O que requer atencao
// ---------------------------------------------------------------------------

export type TomProblema = "err" | "warn" | "info";

export interface Problema {
  id: string;
  tom: TomProblema;
  titulo: string;
  detalhe: string;
  acao: { rotulo: string; href: string };
  /** Texto tecnico, recolhido, para o suporte. */
  suporte?: string | null;
}

const ORDEM_TOM: Record<TomProblema, number> = { err: 0, warn: 1, info: 2 };

/** "3 h", "2 dias". */
export function tempoDeHoras(horas: number): string {
  const h = Math.max(0, Math.floor(horas));
  if (h < 48) return plural(h, "hora", "horas");
  return plural(Math.floor(h / 24), "dia", "dias");
}

/**
 * Cada problema diz o que fazer e leva ao console. Do mais grave (comprador
 * perdendo a compra agora) ao informativo (rota pausada de proposito).
 */
export function problemasDaRota(entrada: {
  rota: Pick<RotaDaLista, "id" | "ativa" | "ultimoConserto">;
  destinos: DestinoNaTela[];
  /** Falhas de roteamento nos ultimos 7 dias; null = nao deu para contar. */
  falhas: number | null;
  agora: number;
}): Problema[] {
  const { rota, destinos, falhas, agora } = entrada;
  const lista: Problema[] = [];

  if (rota.ativa && destinos.length === 0) {
    lista.push({
      id: "sem-destino",
      tom: "err",
      titulo: "A rota não tem loja de checkout",
      detalhe: "Sem uma loja para cobrar, o comprador fica no checkout da vitrine.",
      acao: { rotulo: "Adicionar loja de checkout", href: hrefRota(rota.id, "lojas") },
    });
  } else if (rota.ativa && !destinos.some((d) => d.estado === "ok")) {
    lista.push({
      id: "ninguem-cobra",
      tom: "err",
      titulo: "Nenhuma loja de checkout está recebendo comprador",
      detalhe: "Com a rota ligada assim, o comprador fica no checkout da vitrine, que não cobra.",
      acao: { rotulo: "Ajustar a divisão", href: hrefRota(rota.id, "lojas") },
    });
  }

  for (const d of destinos) {
    if (d.estado !== "attention") continue;
    const recebendo = d.fatia > 0;
    lista.push({
      id: `sem-mapa-${d.id}`,
      tom: recebendo ? "err" : "warn",
      titulo: recebendo
        ? `${d.nome} recebe comprador sem nenhum produto ligado`
        : `${d.nome} está ligada sem nenhum produto ligado`,
      detalhe: recebendo
        ? "Nenhum produto tem par por SKU nesta loja: todo carrinho que cair nela falha."
        : "Ela ainda não recebe comprador, mas os carrinhos falhariam se ganhasse uma fatia do tráfego.",
      acao: { rotulo: "Consertar o mapa", href: hrefRota(rota.id, "lojas") },
    });
  }

  if (falhas && falhas > 0) {
    lista.push({
      id: "falhas",
      tom: "err",
      titulo: `${plural(falhas, "carrinho falhou", "carrinhos falharam")} ao rotear nos últimos 7 dias`,
      detalhe: "O comprador clicou em finalizar e não foi levado para a loja de checkout.",
      acao: { rotulo: "Ver o diagnóstico", href: hrefRota(rota.id, "diagnostico") },
    });
  }

  if (rota.ultimoConserto && !rota.ultimoConserto.ok) {
    lista.push({
      id: "conserto",
      tom: "warn",
      titulo: "A conferência automática encontrou um problema",
      detalhe: "O xcart confere o mapa de produtos sozinho e não conseguiu ligar tudo nesta rota.",
      acao: { rotulo: "Ver a rota", href: hrefRota(rota.id, "diagnostico") },
      suporte: rota.ultimoConserto.mensagem,
    });
  }

  // Mapa velho: so nas lojas que nao viraram problema acima (mapa vazio ja
  // aparece como "sem nenhum produto ligado").
  if (rota.ativa) {
    const velho = mapaVelho(
      destinos
        .filter((d) => d.estado !== "attention")
        .map((d) => ({ enabled: d.ligado, lastHealedAt: d.conferidoEm })),
      agora
    );
    if (velho) {
      lista.push({
        id: "mapa-velho",
        tom: "warn",
        titulo: velho.nunca
          ? "O mapa de produtos de uma loja nunca foi conferido"
          : `O mapa de produtos não é conferido há ${tempoDeHoras(velho.horas)}`,
        detalhe: "Produto criado na vitrine depois da última conferência não tem par e sai sem rota.",
        acao: { rotulo: "Conferir agora", href: hrefRota(rota.id, "diagnostico", { conferir: "1" }) },
      });
    }
  }

  if (!rota.ativa) {
    lista.push({
      id: "pausada",
      tom: "info",
      titulo: "A rota está pausada",
      detalhe: "Enquanto estiver pausada, a vitrine não manda comprador para as lojas de checkout.",
      acao: { rotulo: "Retomar no console", href: hrefRota(rota.id) },
    });
  }

  return lista.sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom]);
}

/** Quantos pedem acao (o informativo nao conta). */
export function contarProblemas(lista: Problema[]): number {
  return lista.filter((p) => p.tom !== "info").length;
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** "agora há pouco", "há 5 min", "há 3 h", "há 2 dias". */
export function haQuanto(iso: string, agora: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const min = Math.floor((agora - t) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** "há 5 min · hoje, 14:32": relativo e absoluto juntos, os dois visiveis. */
export function quandoTexto(iso: string, agora: number): string {
  const absoluto = quandoFoi(iso, new Date(agora));
  return absoluto ? `${haQuanto(iso, agora)} · ${absoluto}` : haQuanto(iso, agora);
}

/** O ultimo sinal do script na vitrine, em uma frase. */
export function textoSinal(sinal: { em: string | null } | null, agora: number): string {
  if (!sinal) return "Não deu para ler o sinal do script agora.";
  if (!sinal.em) return "O script ainda não deu sinal na vitrine.";
  return `Script visto na vitrine ${haQuanto(sinal.em, agora)}.`;
}

export const ROTULO_ESTRATEGIA: Record<RotaDaLista["estrategia"], string> = {
  sticky: "Sempre a mesma loja para o mesmo comprador",
  each_checkout: "Sorteia a loja a cada checkout",
};

// ---------------------------------------------------------------------------
// Eventos do script
// ---------------------------------------------------------------------------

export type TomEvento = "ok" | "warn" | "err";

const EVENTOS: Record<string, { rotulo: string; tom: TomEvento; descricao: string }> = {
  routed_ok: { rotulo: "Carrinho roteado", tom: "ok", descricao: "" },
  cart_checkout_error: {
    rotulo: "Falha ao rotear o carrinho",
    tom: "err",
    descricao: "O comprador clicou em finalizar e não foi levado para a loja de checkout.",
  },
  bypass_form_submit: {
    rotulo: "Checkout escapou da rota",
    tom: "warn",
    descricao: "A vitrine levou o comprador ao próprio checkout, que não cobra.",
  },
  bypass_link: {
    rotulo: "Checkout escapou por um link",
    tom: "warn",
    descricao: "Um link levou o comprador direto ao checkout da vitrine.",
  },
  // Avisado pela Shopify (checkouts/create na vitrine), nao pelo script.
  checkout_na_vitrine: {
    rotulo: "Carrinho caiu no checkout da vitrine",
    tom: "err",
    descricao: "A Shopify avisou um checkout aberto na vitrine, que não cobra.",
  },
};

export interface EventoNaTela {
  id: string;
  rotulo: string;
  tom: TomEvento;
  descricao: string;
  em: string;
  /** Loja de checkout do evento, quando se sabe qual. */
  loja: { id: string; nome: string } | null;
}

/**
 * Evento do script em frase. O detalhe cru do carrinho roteado e
 * "3 itens -> loja.myshopify.com": vira "3 itens para Loja". O detalhe do
 * erro e tecnico (vem do navegador do comprador) e nao aparece.
 */
export function eventoNaTela(ev: EventoDaRota, destinos: DestinoNaTela[]): EventoNaTela {
  const tipo = EVENTOS[ev.motivo] ?? {
    rotulo: "Aviso do script na vitrine",
    tom: "warn" as const,
    descricao: "",
  };
  // Script antigo nao grava a loja do evento: o dominio do detalhe acha ela.
  // O detalhe pode terminar no sufixo de moeda (ver carrinho-levado.ts).
  const dominio = lerCarrinhoLevado(ev.detalhe).dominio?.toLowerCase();
  const destino =
    (ev.destinoId ? destinos.find((d) => d.id === ev.destinoId) : undefined) ??
    (dominio ? destinos.find((d) => d.dominio.toLowerCase() === dominio) : undefined);
  const loja = destino ? { id: destino.lojaId, nome: destino.nome } : null;

  let descricao = tipo.descricao;
  if (ev.motivo === "routed_ok") {
    const itens = /^\s*(\d+)\s+itens?/i.exec(ev.detalhe ?? "");
    const para = loja?.nome ?? dominio ?? null;
    const qtd = itens ? plural(Number(itens[1]), "item", "itens") : "Carrinho";
    descricao = (para ? `${qtd} para ${para}.` : `${qtd} para a loja de checkout.`) + avisoDeMoeda(ev.detalhe);
  }
  return { id: ev.id, rotulo: tipo.rotulo, tom: tipo.tom, descricao, em: ev.em, loja };
}
