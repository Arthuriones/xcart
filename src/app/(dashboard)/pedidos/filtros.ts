import { ROTULO_SITUACAO_COD, SITUACOES_COD, type SituacaoCod } from "@/lib/financeiro/contra-entrega";
import { arredondar } from "@/lib/financeiro/tipos";
// So tipos do modulo de leitura: o calculo nao entra no bundle do navegador.
import type { EstadoEnvio, PedidoTela, TomPedido } from "@/lib/leitura/pedidos";

// ============================================================================
// Filtros, busca, jornada e textos da tela Pedidos. Puro, testado em
// tests/pedidos-tela.test.ts; a tela (pedidos-tela.tsx) so chama.
// ============================================================================

export type FiltroId = "todos" | "meta" | "google" | "falha" | "reembolsos" | "contra_entrega";

/** "Contra entrega" so aparece quando o periodo tem pedido contra entrega. */
export const FILTROS: { id: FiltroId; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "meta", rotulo: "Meta Ads" },
  { id: "google", rotulo: "Google Ads" },
  { id: "falha", rotulo: "Não chegou na plataforma" },
  { id: "reembolsos", rotulo: "Reembolsos" },
  { id: "contra_entrega", rotulo: "Contra entrega" },
];

/** Dentro de "Contra entrega": a situacao do pedido. */
export type FiltroCod = "todos" | SituacaoCod;

export const FILTROS_COD: { id: FiltroCod; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  ...SITUACOES_COD.map((s) => ({ id: s, rotulo: ROTULO_SITUACAO_COD[s] })),
];

export const POR_PAGINA = 25;

export function passaNoFiltroCod(p: Pick<PedidoTela, "cod">, f: FiltroCod): boolean {
  return f === "todos" ? p.cod !== null : p.cod === f;
}

export function passaNoFiltro(p: Pick<PedidoTela, "origem" | "meta" | "status"> & Partial<Pick<PedidoTela, "cod">>, f: FiltroId): boolean {
  switch (f) {
    case "contra_entrega":
      return p.cod != null;
    case "meta":
      return p.origem.id === "meta";
    case "google":
      return p.origem.id === "google";
    case "falha":
      // So o Meta: o Google sai pela tag e o servidor nao sabe se chegou.
      return p.meta === "falhou" || p.meta === "faltou";
    case "reembolsos":
      return p.status.id === "reembolsado" || p.status.id === "reembolso_parcial" || p.status.id === "cancelado";
    default:
      return true;
  }
}

/** "#1480", "1480" ou pedaco do SKU, sem caixa. Vazio casa tudo. */
export function buscaCasa(
  p: { nome: string; id: string; itens: readonly { sku: string }[] },
  busca: string
): boolean {
  const q = busca.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (p.nome.toLowerCase().replace(/^#/, "").includes(q) || p.id.includes(q)) return true;
  return p.itens.some((i) => i.sku.toLowerCase().includes(q));
}

/** Rotulo do ponto de envio, para leitor de tela e dica. */
export function textoEnvio(plataforma: "Meta" | "Google", e: EstadoEnvio): string {
  switch (e) {
    case "enviado":
      return `${plataforma}: compra enviada`;
    case "falhou":
      return `${plataforma}: a plataforma recusou a compra`;
    case "faltou":
      return `${plataforma}: a compra não foi enviada`;
    case "pendente":
      return `${plataforma}: compra na fila de envio`;
    case "aguardando":
      return `${plataforma}: pedido recente, envio a caminho`;
    case "nao_se_aplica":
      return `${plataforma}: este pedido não vira conversão`;
    case "teste":
      return `${plataforma}: compra de teste, fora da contagem`;
    case "tag":
      return `${plataforma}: sai pela tag do checkout, sem confirmação no servidor`;
    default:
      return `${plataforma}: sem pixel nesta loja`;
  }
}

/** Cor do ponto. Google com tag fica neutro: nao ha dado para verde ou vermelho. */
export function corEnvio(e: EstadoEnvio): "ok" | "err" | "neutro" | "apagado" {
  if (e === "enviado") return "ok";
  if (e === "falhou" || e === "faltou") return "err";
  if (e === "sem_pixel" || e === "nao_se_aplica" || e === "teste") return "apagado";
  return "neutro";
}

// ---------------------------------------------------------------------------
// Jornada: montada aqui, do dado curto que vem do servidor
// ---------------------------------------------------------------------------

export interface PassoJornada {
  titulo: string;
  detalhe: string;
  hora: string;
  tom: TomPedido;
  marca?: "meta" | "google";
}

/** So o que o banco registrou deste pedido. */
export function jornadaDoPedido(p: PedidoTela, dinheiro: (v: number) => string): PassoJornada[] {
  const j: PassoJornada[] = [];
  const o = p.origem;
  if (o.id === "meta" || o.id === "google") {
    j.push({
      titulo: `Clique no anúncio · ${o.rotulo}`,
      detalhe: o.campanha ? `utm_campaign=${o.campanha} · ${o.pista}` : o.pista,
      hora: "",
      tom: "info",
      marca: o.id,
    });
  } else if (o.id === "email") {
    j.push({ titulo: "Link de e-mail", detalhe: o.pista, hora: "", tom: "neutral" });
  } else if (o.id === "outra") {
    j.push({ titulo: `Veio de ${o.rotulo}`, detalhe: o.pista, hora: "", tom: "neutral" });
  } else if (o.id === "direto") {
    j.push({ titulo: "Sem clique de anúncio", detalhe: o.pista, hora: "", tom: "neutral" });
  } else if (o.id === "sem_dado") {
    j.push({ titulo: "Origem sem dado", detalhe: o.pista, hora: "", tom: "neutral" });
  }
  if (p.cod) {
    // Contra entrega: o pagamento vem na entrega, nao na compra.
    j.push({
      titulo: "Pedido contra entrega",
      detalhe: p.pago ? "Pago" : p.cod === "cancelado" ? "Cancelado antes do envio" : "Paga na entrega",
      hora: p.quando,
      tom: p.pago ? "ok" : "neutral",
    });
    if (p.enviado) j.push({ titulo: "Enviado", detalhe: "Saiu para entrega", hora: p.enviado, tom: "info" });
    if (p.entregue) j.push({ titulo: "Entregue", detalhe: p.pago ? "Pago" : "Pagamento ainda não marcado na Shopify", hora: p.entregue, tom: p.pago ? "ok" : "info" });
    if (p.cod === "recusado") {
      j.push({ titulo: "Recusado ou devolvido", detalhe: "Sem pagamento: custa o envio e a devolução", hora: "", tom: "err" });
    }
  } else {
    j.push({
      titulo: p.pago ? "Compra paga" : "Pedido criado",
      detalhe: p.pago ? (p.gateway ?? "Pagamento") : "Sem pagamento recebido",
      hora: p.quando,
      tom: p.pago ? "ok" : "neutral",
    });
  }
  for (const ev of p.envios) {
    const sufixo = ev.destino ? ` · ${ev.destino}` : "";
    if (ev.status === "teste") {
      j.push({
        titulo: ev.saiu ? "Compra de teste" : "Compra de teste: não enviada",
        detalhe: ev.saiu ? `Foi como teste${sufixo}; não conta como conversão` : `Teste do dono${sufixo}; fora da contagem`,
        hora: ev.hora,
        tom: "neutral",
        marca: "meta",
      });
    } else if (ev.status === "enviado") {
      j.push({ titulo: "Compra enviada ao Meta", detalhe: `Aceita pelo Meta${sufixo}`, hora: ev.hora, tom: "ok", marca: "meta" });
    } else if (ev.status === "falhou") {
      const n = ev.tentativas ?? 0;
      j.push({
        titulo: "Compra não chegou ao Meta",
        detalhe: `Recusada depois de ${n === 1 ? "1 tentativa" : `${n} tentativas`}${sufixo}${ev.erro ? `: ${ev.erro}` : ""}`,
        hora: ev.hora,
        tom: "err",
        marca: "meta",
      });
    } else {
      j.push({
        titulo: "Compra na fila do Meta",
        detalhe: `O xcart tenta de novo sozinho${sufixo}`,
        hora: ev.hora,
        tom: "neutral",
        marca: "meta",
      });
    }
  }
  if (p.meta === "faltou") {
    j.push({
      titulo: "Compra não foi enviada ao Meta",
      detalhe: "A loja tem pixel do Meta, mas não há envio registrado deste pedido.",
      hora: "",
      tom: "err",
      marca: "meta",
    });
  } else if (p.meta === "aguardando") {
    j.push({
      titulo: "Compra a caminho do Meta",
      detalhe: "Pedido recente: o envio sai em instantes.",
      hora: "",
      tom: "neutral",
      marca: "meta",
    });
  } else if (p.meta === "nao_se_aplica" && p.motivo) {
    j.push({ titulo: "Não vai para o Meta", detalhe: `Motivo: ${p.motivo}`, hora: "", tom: "neutral", marca: "meta" });
  }
  if (p.google === "tag") {
    j.push({
      titulo: "Compra do Google pela tag do checkout",
      detalhe: "Sai do navegador do comprador; o servidor não confirma a chegada.",
      hora: "",
      tom: "neutral",
      marca: "google",
    });
  }
  if (p.valores && p.valores.reembolso > 0) {
    j.push({ titulo: "Reembolso", detalhe: dinheiro(p.valores.reembolso), hora: "", tom: "warn" });
  }
  if (p.cancelado) {
    j.push({ titulo: "Pedido cancelado", detalhe: "Cancelado na Shopify", hora: p.cancelado, tom: "err" });
  }
  return j;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const ENVIO_CSV: Record<EstadoEnvio, string> = {
  enviado: "enviado",
  falhou: "recusado",
  faltou: "não enviado",
  pendente: "na fila",
  aguardando: "a caminho",
  sem_pixel: "sem pixel",
  nao_se_aplica: "não se aplica",
  teste: "teste",
  tag: "pela tag",
};

/**
 * Texto que vai para a planilha. utm_source e utm_campaign vem da URL do
 * VISITANTE: "=HYPERLINK(...)" viraria formula no Excel do lojista. Como o
 * CSV de Eventos (tracking/eventos/logica.ts), o apostrofo desarma.
 */
export function textoCsv(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Centavos, como a tela: sem isto a taxa sai "2,6361". */
function centavos(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : arredondar(v, 2);
}

/** "Valor pago - Reembolso = Faturamento": a soma de Faturamento bate com o KPI e o Dashboard. */
export const CABECALHO_CSV = [
  "Pedido",
  "Data",
  "Loja",
  "Itens",
  "Origem",
  "Campanha",
  "Meta",
  "Google",
  "Valor pago",
  "Reembolso",
  "Faturamento",
  "Produto + frete do fornecedor",
  "Taxa de pagamento",
  "Lucro estimado",
  "Status",
];

export function linhaCsv(p: PedidoTela): (string | number | null)[] {
  const v = p.valores;
  return [
    textoCsv(p.nome),
    p.quandoLongo,
    textoCsv(p.loja),
    textoCsv(p.itensTexto),
    textoCsv(p.origem.rotulo),
    textoCsv(p.origem.campanha),
    ENVIO_CSV[p.meta],
    ENVIO_CSV[p.google],
    centavos(v?.valorPago),
    centavos(v?.reembolso),
    centavos(v?.receita),
    centavos(v?.cmv),
    centavos(v?.taxa),
    centavos(v?.lucro),
    p.status.rotulo,
  ];
}
