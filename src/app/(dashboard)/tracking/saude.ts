import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import type { ChaveEvento } from "@/lib/tracking/eventos";

// ============================================================================
// A saude de uma loja, sem React.
//
// Mora fora dos componentes por dois motivos: a mesma regra decide a cor do
// card, a ordem das lojas e o numero "Precisam de voce" do topo -- se cada um
// recalculasse do seu jeito, o topo diria "tudo certo" com um card vermelho
// embaixo. E arquivo puro e o que o vitest consegue importar sem montar tela.
//
// Os imports sao so de TIPO: queries.ts e diagnostico.ts tem "server-only", e
// um import de valor daqui levaria isso para o bundle do cliente.
// ============================================================================

export type Plataforma = "google" | "meta";

export const NOME_DA_PLATAFORMA: Record<Plataforma, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
};

/** Como chamar um destino numa frase. */
export function apelido(d: DestinoNaTela): string {
  const plataforma = d.plataforma === "google" ? "Google" : "Meta";
  return d.nome ? `${plataforma} "${d.nome}"` : `${plataforma} ${d.conta}`;
}

/**
 * Meta com test_event_code: o evento cai na aba de TESTE do Events Manager e
 * nao conta como conversao. Contar essas compras como "rastreadas" diria que a
 * campanha esta medindo quando nao esta.
 */
export function emModoTeste(d: DestinoNaTela): boolean {
  return d.plataforma === "meta" && Boolean(d.testEventCode);
}

/**
 * O destino manda este evento? No Meta o pixel cobre todos; no Google vale o
 * ID da acao quando ele vai pela Data Manager, e o rotulo no caminho antigo
 * (a mesma regra de `destinoAceita`).
 */
export function enviaEvento(d: DestinoNaTela, chave: ChaveEvento): boolean {
  if (d.plataforma === "meta") return true;
  return d.acoes ? Boolean(d.acoes[chave]) : Boolean(d.labels[chave]);
}

/** Os destinos para onde a compra SAI -- inclusive o Meta em modo teste. */
export function aceitamCompra(loja: LojaTracking): DestinoNaTela[] {
  return loja.destinos.filter((d) => d.ativo && d.completo && enviaEvento(d, "purchase"));
}

/** Os destinos que deveriam estar recebendo a compra COMO CONVERSAO. */
export function recebemCompra(loja: LojaTracking): DestinoNaTela[] {
  return aceitamCompra(loja).filter((d) => !emModoTeste(d));
}

/** O que falta para este destino enviar algo. Vazio = esta pronto. */
export function oQueFalta(d: DestinoNaTela): string | null {
  if (d.plataforma === "meta") {
    return d.temToken ? null : "falta o token do CAPI — sem ele nenhum evento sai";
  }
  return d.acoes || Object.keys(d.labels).length > 0
    ? null
    : "falta o rótulo de ao menos um evento — sem rótulo não há o que enviar";
}

/**
 * O pedido e anterior ao cadastro do destino -- nao tinha como ter ido para ele.
 *
 * Esperados e faltam usam a MESMA regra de data, senao "chegaram" e o alarme
 * discordam: o pedido velho sairia de um e ficaria no outro, e a tela diria
 * "3 de 4 chegaram" sem nenhum pedido faltando.
 */
function foraDaJanela(d: DestinoNaTela, diag: DiagnosticoLoja, id: string): boolean {
  // Se a compra saiu (ou esta na fila) por este destino, o pedido era dele,
  // seja qual for a data de cadastro. A data pode nem ser a real: os destinos
  // que nasceram da migration 043 tem todos a hora da migration, e a tela
  // mostrava "1/1" numa loja com 3 pedidos e 3 compras enviadas.
  if (d.contagem.pedidosComCompra.includes(id) || d.contagem.pedidosNaFila.includes(id)) {
    return false;
  }
  const desde = d.criadoEm ? Date.parse(d.criadoEm) : NaN;
  const criado = Date.parse(diag.pedidoCriadoEm?.[id] ?? "");
  return Number.isFinite(desde) && Number.isFinite(criado) && criado < desde;
}

/**
 * Quantos pedidos esperados NAO tiveram a compra enviada por este destino.
 *
 * Todo pedido vai para todo destino que aceita a compra, entao nao ha pedido
 * que "veio de fora do anuncio" e pode faltar: faltou, perdeu. Fica fora so o
 * que nao tinha como ter ido -- pedido anterior ao cadastro do destino -- e o
 * que ainda esta na fila do cron, que nao saiu mas nao se perdeu.
 *
 * Null = o diagnostico nao trouxe a lista de pedidos.
 */
export function pedidosSemCompra(
  d: DestinoNaTela,
  diag: DiagnosticoLoja | null
): number | null {
  if (!diag?.pedidoIds) return null;
  const chegou = new Set([...d.contagem.pedidosComCompra, ...d.contagem.pedidosNaFila]);
  let faltam = 0;
  for (const id of diag.pedidoIds) {
    if (chegou.has(id)) continue;
    if (foraDaJanela(d, diag, id)) continue;
    faltam += 1;
  }
  return faltam;
}

/**
 * Quantos pedidos este destino DEVERIA ter recebido.
 *
 * Pedido na fila conta como esperado: nao saiu ainda, mas e dele. Null = o
 * diagnostico nao trouxe a lista de pedidos.
 */
export function pedidosEsperados(
  d: DestinoNaTela,
  diag: DiagnosticoLoja | null
): number | null {
  if (!diag?.pedidoIds) return null;
  let n = 0;
  for (const id of diag.pedidoIds) {
    if (!foraDaJanela(d, diag, id)) n += 1;
  }
  return n;
}

/** Nome curto de cada evento nas grades de numeros. */
export const ROTULO_EVENTO: Record<ChaveEvento, string> = {
  view_item: "Ver produto",
  add_to_cart: "Carrinho",
  begin_checkout: "Checkout",
  payment_info: "Pagamento",
  purchase: "Compra",
};

/** O que a tela mostra de UM evento de UM destino (uma conta). */
export interface NumerosEvento {
  /** No Google, evento sem rotulo nao e enviado: nao ha numero a mostrar. */
  envia: boolean;
  /**
   * Com clique de anuncio -- e sem teste, salvo `comTestes`. E o que se
   * compara com o Gerenciador. null = o banco nao separa o teste (sem a 055).
   */
  deAnuncio: number | null;
  /** Enviados, sem os testes salvo `comTestes`. */
  total: number;
  /** Falharam. Nunca entram no total: aparecem ao lado, como erro. */
  falhas: number;
}

/**
 * Os numeros de um evento numa conta. Teste fica fora por padrao; com
 * `comTestes` ele volta para o total, e "de anuncio" vira tudo com clique.
 */
export function numerosDoEvento(
  d: DestinoNaTela,
  chave: ChaveEvento,
  comTestes: boolean
): NumerosEvento {
  const c = d.contagem;
  const enviados = c.porEvento[chave] ?? 0;
  let deAnuncio: number | null;
  if (comTestes) deAnuncio = Math.max(0, enviados - (c.semAtribPorEvento[chave] ?? 0));
  else deAnuncio = c.deAnuncioPorEvento ? (c.deAnuncioPorEvento[chave] ?? 0) : null;
  return {
    envia: enviaEvento(d, chave),
    deAnuncio,
    total: comTestes ? enviados : Math.max(0, enviados - (c.testesPorEvento[chave] ?? 0)),
    falhas: c.falhasPorEvento[chave] ?? 0,
  };
}

/**
 * Compras de um destino, sem os testes: quantas sairam e quantas levavam
 * clique de anuncio. Sem a 055, "de anuncio" cai para "com clique" -- a regra
 * de antes, para o alarme nao ficar mudo durante a troca.
 */
export function comprasSemTeste(d: DestinoNaTela): { enviadas: number; deAnuncio: number } {
  const n = numerosDoEvento(d, "purchase", false);
  const comClique = Math.max(0, n.total - (d.contagem.semAtribPorEvento.purchase ?? 0));
  return { enviadas: n.total, deAnuncio: n.deAnuncio ?? comClique };
}

/** O destino da plataforma que mais recebeu compra. */
export function melhorDa(
  alvos: DestinoNaTela[],
  plataforma: DestinoNaTela["plataforma"]
): DestinoNaTela | null {
  let melhor: DestinoNaTela | null = null;
  for (const d of alvos) {
    if (d.plataforma !== plataforma) continue;
    if (
      !melhor ||
      (d.contagem.porEvento.purchase ?? 0) > (melhor.contagem.porEvento.purchase ?? 0)
    ) {
      melhor = d;
    }
  }
  return melhor;
}

/**
 * Os destinos que estao perdendo pedido, e quantos.
 *
 * Cada destino e julgado sozinho: uma conta pode estar chegando e a outra nao.
 *
 * Com a contagem da fila indisponivel, NAO ha comparacao: "zero compras
 * enviadas" seria a falha da leitura, nao das compras, e acusaria cada
 * pedido como perdido. Antes o null virava 0 e ia direto para o alarme.
 */
export function faltasDaLoja(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null
): { d: DestinoNaTela; faltam: number }[] {
  if (loja.contagemIndisponivel) return [];
  return recebemCompra(loja)
    .map((d) => ({ d, faltam: pedidosSemCompra(d, diag) }))
    .filter(
      (f): f is { d: DestinoNaTela; faltam: number } =>
        f.faltam !== null && f.faltam >= 1
    );
}

export type VereditoDestino =
  | { tipo: "sem-contagem" }
  | { tipo: "sem-pedidos"; compras: number }
  | { tipo: "razao"; esperados: number; faltam: number; chegaram: number };

/** O numero grande de um destino em "Compras chegando". */
export function vereditoDoDestino(
  d: DestinoNaTela,
  loja: LojaTracking,
  diag: DiagnosticoLoja | null
): VereditoDestino {
  if (loja.contagemIndisponivel) return { tipo: "sem-contagem" };
  const esperados = pedidosEsperados(d, diag);
  if (esperados === null) {
    return { tipo: "sem-pedidos", compras: d.contagem.porEvento.purchase ?? 0 };
  }
  const faltam = pedidosSemCompra(d, diag) ?? 0;
  // Pela regra comum de data nunca fica negativo; o max e so cinto de
  // seguranca para nao mostrar "-1/4" se as duas contas divergirem um dia.
  return { tipo: "razao", esperados, faltam, chegaram: Math.max(0, esperados - faltam) };
}

/**
 * Por que o diagnostico falhou, em frase.
 *
 * O diagnostico grava codigo, nao frase: "denied" e "failed" vem do catch dos
 * pedidos, e o resto ja chega escrito.
 */
export function textoProblema(p: string | null): string {
  if (p === "denied") return "A loja não deu permissão para o app ler os pedidos.";
  if (p === "failed") return "A Shopify não respondeu a tempo.";
  if (!p) return "Webhook, tema e pedidos ficaram sem verificar.";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Copia de `quando` em src/app/(dashboard)/overview/page.tsx -- ja diz "atras". */
export function quando(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  return `${Math.round(h / 24)} d atrás`;
}

/** "1 pedido" / "3 pedidos" -- nunca "pedido(s)". */
export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export type Saude = "ok" | "atencao" | "parado" | "desligado";
export type Tom = "ok" | "warn" | "err" | "neutro";
export type Motivo = { tom: "err" | "warn"; texto: string };

/** Ordem das lojas na tela: o que precisa de mao primeiro. */
export const ORDEM_SAUDE: Record<Saude, number> = {
  parado: 0,
  atencao: 1,
  ok: 2,
  desligado: 3,
};

/**
 * A saude da loja e os motivos, do mais grave ao menos.
 *
 * `ligado` e o estado que a tela mostra (no card, o local -- o lojista acabou
 * de clicar). `temDiag` e se a loja estava ligada na CARGA: so entao a pagina
 * perguntou a Shopify. Loja ligada agora nao tem diagnostico, e cobrar
 * "nao deu para conferir" dela seria acusar uma falha que nao houve.
 */
export function saudeDaLoja(
  loja: LojaTracking,
  ligado: boolean,
  diag: DiagnosticoLoja | null,
  temDiag: boolean
): { saude: Saude; motivos: Motivo[]; faltas: ReturnType<typeof faltasDaLoja> } {
  if (!ligado) return { saude: "desligado", motivos: [], faltas: [] };

  const aceitam = aceitamCompra(loja);
  const recebem = recebemCompra(loja);
  const faltas = faltasDaLoja(loja, diag);

  const err: string[] = [];
  if (loja.desinstalada) err.push("App desinstalado — nada está sendo enviado");
  if (recebem.length === 0 && aceitam.length === 0) {
    err.push("Nenhum destino está recebendo a compra");
  }
  for (const { d, faltam } of faltas) {
    err.push(`${plural(faltam, "pedido", "pedidos")} sem compra enviada em ${apelido(d)}`);
  }
  if (diag?.temWebhook === false) {
    err.push("Webhook de pedidos faltando — os pedidos não viram compra");
  }

  const warn: string[] = [];
  if (loja.tetoAtingidoRecente) warn.push("Bateu no teto de eventos — números incompletos");
  if (loja.contagemIndisponivel) warn.push("Não deu para contar os envios agora");
  if (aceitam.length > 0 && recebem.length === 0) {
    warn.push("Só em modo teste — compras ainda não contam como conversão");
  } else {
    for (const d of aceitam.filter(emModoTeste)) warn.push(`${apelido(d)} em modo teste`);
  }
  if (diag?.temSnippet === false) warn.push("Snippet faltando no tema");
  else if (diag?.snippetComId === false) warn.push("Snippet antigo no tema");
  if (!loja.pixelCheckoutAtivo) warn.push("Pixel do checkout não instalado");
  else if (loja.pixelCheckoutDesatualizado) warn.push("Pixel do checkout com código antigo");
  for (const d of loja.destinos) {
    if (d.ativo && oQueFalta(d) !== null) warn.push(`${apelido(d)} incompleto`);
  }
  for (const d of loja.destinos) {
    const n = d.contagem.falharam;
    if (n > 0) warn.push(`${apelido(d)}: ${n === 1 ? "1 envio falhou" : `${n} envios falharam`}`);
  }
  for (const p of ["google", "meta"] as const) {
    const contas = recebem.filter((d) => d.plataforma === p).map(comprasSemTeste);
    if (contas.length === 0) continue;
    // O mesmo teste do "todas" da Atribuicao: so acusa quando NENHUMA venda
    // foi creditada. Parte sem click id e trafego organico, normal. Teste do
    // dono fica fora: uma compra com gclid TESTE nao pode calar o alarme.
    // Com 2 contas Google, a que nao e dona do clique fica com deAnuncio 0
    // (055: 'nao_e_desta_conta'); por isso NENHUMA conta, e nao a "melhor".
    const enviadas = Math.max(...contas.map((c) => c.enviadas));
    if (enviadas > 0 && contas.every((c) => c.deAnuncio === 0)) {
      warn.push(
        `Nenhuma venda creditada a anúncio no ${p === "google" ? "Google" : "Meta"}`
      );
    }
  }
  if (temDiag && (diag === null || diag.pedidos7d === null)) {
    warn.push("Não deu para conferir os pedidos na Shopify");
  }
  // Remarketing fica de fora de proposito: e opcional, a conversao funciona
  // sem ele, e pintar a loja de amarelo por isso ensinaria a ignorar o amarelo.

  const motivos: Motivo[] = [
    ...err.map((texto) => ({ tom: "err" as const, texto })),
    ...warn.map((texto) => ({ tom: "warn" as const, texto })),
  ];
  const saude: Saude = err.length > 0 ? "parado" : warn.length > 0 ? "atencao" : "ok";
  return { saude, motivos, faltas };
}
