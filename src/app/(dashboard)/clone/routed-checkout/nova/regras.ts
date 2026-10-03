// ============================================================================
// Regras do assistente de nova rota, sem React: os modos, a trilha de passos
// de cada modo, o que falta escolher e a estimativa de creditos. Puro para o
// vitest travar. As chamadas de API e os corpos continuam os de sempre.
// ============================================================================

export type Modo = "generate" | "reuse" | "connect";

export const MODOS: { valor: Modo; rotulo: string; descricao: string }[] = [
  {
    valor: "generate",
    rotulo: "Gerar do zero",
    descricao: "Cria os produtos na loja de checkout a partir da vitrine, tirando a marca do texto e, se quiser, da imagem.",
  },
  {
    valor: "reuse",
    rotulo: "Reaproveitar uma loja",
    descricao: "Copia os produtos já sem marca de outra loja de checkout sua, sem usar IA, e liga a vitrine pelo SKU.",
  },
  {
    valor: "connect",
    rotulo: "Só conectar",
    descricao: "As duas lojas já têm os produtos. O xcart casa as variantes pelo SKU e cria na loja de checkout o que sobrar sem par.",
  },
];

/** A trilha muda com o modo: "Só conectar" nao tem o passo de criar produtos. */
export function passosDoModo(modo: Modo): string[] {
  return modo === "connect" ? ["Lojas", "Ativar rota"] : ["Lojas e opções", "Criar produtos", "Ativar rota"];
}

/** Passo interno (1 lojas, 2 criar, 3 ativar) -> posicao na trilha do modo. */
export function posicaoNaTrilha(modo: Modo, passo: 1 | 2 | 3): number {
  if (modo === "connect") return passo === 1 ? 1 : 2;
  return passo;
}

export interface Escolha {
  vitrine: string;
  checkout: string;
  /** So no "Reaproveitar": a loja de checkout de onde os produtos sao copiados. */
  origemCopia: string;
}

/** O que falta para comecar, ou null quando da. Nunca deixa a mesma loja em dois papeis. */
export function problemaDaEscolha(modo: Modo, e: Escolha, totalLojas: number): string | null {
  if (totalLojas < 2) return "Conecte pelo menos duas lojas: uma vitrine e uma loja de checkout.";
  if (modo === "reuse" && !e.origemCopia) return "Escolha a loja de onde copiar os produtos.";
  if (!e.vitrine) return "Escolha a vitrine.";
  if (!e.checkout) return "Escolha a loja de checkout.";
  if (e.vitrine === e.checkout) return "A vitrine e a loja de checkout precisam ser lojas diferentes.";
  if (modo === "reuse" && (e.origemCopia === e.checkout || e.origemCopia === e.vitrine)) {
    return "A loja de onde copiar precisa ser diferente da vitrine e da nova loja de checkout.";
  }
  return null;
}

/** Os ids ja usados nos OUTROS papeis: o seletor de um papel desabilita esses. */
export function ocupadasPorOutros(papel: keyof Escolha, modo: Modo, e: Escolha): string[] {
  const papeis: (keyof Escolha)[] = modo === "reuse" ? ["vitrine", "checkout", "origemCopia"] : ["vitrine", "checkout"];
  return papeis.filter((p) => p !== papel).map((p) => e[p]).filter(Boolean);
}

export type EstadoEstimativa =
  | { tipo: "calculando" }
  | { tipo: "semLeitura"; texto: string }
  | { tipo: "livre"; texto: string }
  | { tipo: "ok"; texto: string }
  | { tipo: "falta"; texto: string };

/**
 * Estimativa de creditos para recriar as imagens: 1 credito por produto (uma
 * imagem cada). Falta de saldo BLOQUEIA o botao (antes so pintava de vermelho).
 */
export function estimativaCreditos(a: {
  produtos: number | null;
  saldo: number | null;
  cobrando: boolean;
  /** /api/billing/me nao respondeu: nao da para afirmar nada do saldo. */
  saldoFalhou: boolean;
}): EstadoEstimativa {
  if (a.produtos === null) return { tipo: "calculando" };
  const uso = a.produtos === 1 ? "1 crédito" : `${a.produtos.toLocaleString("pt-BR")} créditos`;
  if (a.saldoFalhou) {
    return { tipo: "semLeitura", texto: `Vai usar cerca de ${uso} (1 por produto). Não deu para ler seu saldo agora.` };
  }
  if (!a.cobrando) {
    return { tipo: "livre", texto: "A cobrança de créditos ainda não está ativa: recriar as imagens não gasta crédito por enquanto." };
  }
  if (a.saldo !== null && a.produtos > a.saldo) {
    const tem = a.saldo === 1 ? "1" : a.saldo.toLocaleString("pt-BR");
    return { tipo: "falta", texto: `Precisa de ${uso} (1 por produto) e você tem ${tem}.` };
  }
  return {
    tipo: "ok",
    texto:
      a.saldo === null
        ? `Vai usar cerca de ${uso} (1 por produto).`
        : `Vai usar cerca de ${uso} (1 por produto). Você tem ${a.saldo.toLocaleString("pt-BR")}.`,
  };
}

export const IDIOMAS: { valor: string; rotulo: string }[] = [
  { valor: "pt-BR", rotulo: "Português (Brasil)" },
  { valor: "es", rotulo: "Espanhol" },
  { valor: "es-CL", rotulo: "Espanhol (Chile)" },
  { valor: "es-MX", rotulo: "Espanhol (México)" },
  { valor: "en", rotulo: "Inglês" },
  { valor: "ja", rotulo: "Japonês" },
];

/** Nome padrao da rota: "Vitrine → Checkout". */
export function nomePadrao(vitrine: string, checkout: string): string {
  return `${vitrine || "—"} → ${checkout || "—"}`;
}

/** % de um progresso, sem passar de 100 nem dividir por zero. */
export function porcento(feito: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((feito / total) * 100)));
}

function contar(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/**
 * Os avisos depois de casar pelo SKU, montados dos numeros que
 * /api/checkout-routes/connect-by-sku devolve (as frases prontas de la vem
 * sem acento e com "(s)").
 */
export function avisosDaConexao(d: {
  coveragePercent?: number;
  missingSkuCount?: number;
  duplicateSkuCount?: number;
  matchedByLabel?: number;
}): string[] {
  const avisos: string[] = [];
  const semSku = d.missingSkuCount ?? 0;
  const repetidos = d.duplicateSkuCount ?? 0;
  const cobertura = d.coveragePercent ?? 100;
  const peloNome = d.matchedByLabel ?? 0;
  if (semSku > 0) {
    avisos.push(`${contar(semSku, "variante continua", "variantes continuam")} sem SKU: a rota casa só pelo SKU.`);
  }
  if (repetidos > 0) {
    avisos.push(
      `${contar(repetidos, "SKU se repete", "SKUs se repetem")} em produtos diferentes da vitrine: o comprador iria para o produto errado.`
    );
  }
  if (cobertura < 100) {
    avisos.push(`Só ${cobertura}% das variantes têm par. O resto cai no checkout da vitrine, que não cobra.`);
  }
  if (peloNome > 0) {
    avisos.push(
      `${contar(peloNome, "variante casou", "variantes casaram")} pelo nome, não pelo SKU: se o título mudar, deixa de ir ao checkout.`
    );
  }
  return avisos;
}

/** Os avisos depois de completar a loja de checkout, dos numeros do teste da rota. */
export function avisosDoTeste(h: {
  noSkuCount?: number;
  missingCount?: number;
  wrongCount?: number;
  shipping?: { ok?: boolean } | null;
}): string[] {
  const avisos: string[] = [];
  const semSku = h.noSkuCount ?? 0;
  const semPar = h.missingCount ?? 0;
  const errados = h.wrongCount ?? 0;
  if (semSku > 0) {
    avisos.push(`${contar(semSku, "variante da vitrine continua", "variantes da vitrine continuam")} sem SKU.`);
  }
  if (semPar > 0) {
    avisos.push(`${contar(semPar, "produto ainda está", "produtos ainda estão")} sem par na loja de checkout.`);
  }
  if (errados > 0) {
    avisos.push(`${contar(errados, "produto aponta", "produtos apontam")} para o item errado no checkout.`);
  }
  if (h.shipping && h.shipping.ok === false) {
    avisos.push("A loja de checkout não entrega no país desta rota: o comprador trava no frete.");
  }
  return avisos;
}
