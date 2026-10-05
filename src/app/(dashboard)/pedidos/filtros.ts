// So tipos do modulo de leitura: o calculo nao entra no bundle do navegador.
import type { EstadoEnvio, PedidoTela } from "@/lib/leitura/pedidos";

// ============================================================================
// Filtros, busca e textos da tela Pedidos. Puro, testado em
// tests/pedidos-tela.test.ts; a tela (pedidos-lista.tsx) so chama.
// ============================================================================

export type FiltroId = "todos" | "meta" | "google" | "falha" | "reembolsos";

export const FILTROS: { id: FiltroId; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "meta", rotulo: "Meta Ads" },
  { id: "google", rotulo: "Google Ads" },
  { id: "falha", rotulo: "Não chegou na plataforma" },
  { id: "reembolsos", rotulo: "Reembolsos" },
];

export const POR_PAGINA = 25;

export function passaNoFiltro(p: Pick<PedidoTela, "origem" | "meta" | "status">, f: FiltroId): boolean {
  switch (f) {
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
export function buscaCasa(p: Pick<PedidoTela, "nome" | "id" | "skus">, busca: string): boolean {
  const q = busca.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (p.nome.toLowerCase().replace(/^#/, "").includes(q) || p.id.includes(q)) return true;
  return p.skus.some((s) => s.toLowerCase().includes(q));
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
  if (e === "sem_pixel" || e === "nao_se_aplica") return "apagado";
  return "neutro";
}

const ENVIO_CSV: Record<EstadoEnvio, string> = {
  enviado: "enviado",
  falhou: "recusado",
  faltou: "não enviado",
  pendente: "na fila",
  aguardando: "a caminho",
  sem_pixel: "sem pixel",
  nao_se_aplica: "não se aplica",
  tag: "pela tag",
};

export const CABECALHO_CSV = [
  "Pedido",
  "Data",
  "Loja",
  "Itens",
  "Origem",
  "Campanha",
  "Meta",
  "Google",
  "Faturamento",
  "Produto + frete do fornecedor",
  "Taxa de pagamento",
  "Reembolso",
  "Lucro estimado",
  "Status",
];

export function linhaCsv(p: PedidoTela): (string | number | null)[] {
  const v = p.valores;
  return [
    p.nome,
    p.quandoLongo,
    p.loja,
    p.itensTexto,
    p.origem.rotulo,
    p.origem.campanha,
    ENVIO_CSV[p.meta],
    ENVIO_CSV[p.google],
    v ? v.faturamento : null,
    v ? v.cmv : null,
    v ? v.taxa : null,
    v ? v.reembolso : null,
    v ? v.lucro : null,
    p.status.rotulo,
  ];
}
