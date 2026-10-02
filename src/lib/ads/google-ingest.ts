import { createHash, randomBytes } from "node:crypto";
import {
  RE_DIA,
  RE_MOEDA,
  arredondar,
  diaNoFuso,
  diasDoIntervalo,
  diasNoIntervalo,
  somarDias,
  type AdSpendDailyRow,
  type GoogleIngestCorpo,
  type GoogleIngestLinha,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Ingestao do gasto do Google Ads pelo script colado na conta.
//
// POR QUE O SCRIPT EMPURRA, E NAO O XCART PUXA
//
// A Google Ads API pede o nivel Explorer do projeto no Google Cloud, que o
// Arthur ainda nao tem. O Google Ads Script roda DENTRO da conta, le o gasto
// e manda por POST -- funciona hoje, sem aprovacao. A tabela ja aceita fonte
// 'api' para quando a leitura automatica entrar.
//
// POR QUE A VALIDACAO E DURA
//
// O endpoint aceita VALOR MONETARIO e o gasto vai direto para o lucro. Cada
// conta tem o proprio segredo (so o hash fica no banco), mas um segredo
// vazado nao pode virar "qualquer numero em qualquer dia": o corpo e
// conferido campo a campo, a janela e curta e o dia nao pode estar no futuro.
//
// Arquivo puro (sem banco, sem rede): testado em tests/ads-google-ingest.test.ts.
// ============================================================================

/** Maximo de dias num envio. O script manda 30; folga para o fuso. */
export const MAX_DIAS_INGEST = 40;
/** Quanto para tras o inicio pode ir, a partir de hoje no fuso da conta. */
export const MAX_DIAS_PARA_TRAS = 95;
export const MAX_LINHAS_INGEST = 20000;
/** gerado_em adiantado aceito: relogio do Google x o nosso. */
const FOLGA_FUTURO_MS = 10 * 60 * 1000;

/** 32 bytes aleatorios: 43 caracteres base64url, sem padding. */
export function gerarSegredo(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * sha256 hex. Sem sal de proposito: o segredo ja tem 256 bits de acaso, nao
 * ha dicionario a atacar, e o hash precisa ser BUSCAVEL (indice unico) para
 * achar a conta a partir do Authorization.
 */
export function hashSegredo(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * ID de CLIENTE do Google Ads: 10 digitos, com ou sem hifens (123-456-7890).
 * O AW-... do rastreamento e outra coisa e nao tem 10 digitos.
 */
export function normalizarCustomerId(s: string): string | null {
  if (typeof s !== "string") return null;
  const digitos = s.replace(/\D/g, "");
  return /^\d{10}$/.test(digitos) ? digitos : null;
}

/** 1234567890 -> 123-456-7890, como o Google Ads mostra. */
export function formatarCustomerId(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/** RE_DIA so confere o formato: 2026-02-31 passaria. */
function diaValido(v: unknown): v is string {
  if (typeof v !== "string" || !RE_DIA.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function fusoValido(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > 64) return false;
  try {
    // Fuso que o Intl nao conhece faria diaNoFuso cair em UTC calado, e o
    // fuso gravado na conta alimenta o aviso de desalinhamento da tela.
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

function inteiroNaoNegativo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function opcionalNaoNegativo(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

type ResultadoIngest = { ok: true; corpo: GoogleIngestCorpo } | { ok: false; erro: string };

export function validarIngest(corpo: unknown, agora: Date): ResultadoIngest {
  const falha = (erro: string): ResultadoIngest => ({ ok: false, erro });
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return falha("corpo invalido");
  const c = corpo as Record<string, unknown>;

  if (c.v !== 1) return falha("versao do script desconhecida (v deve ser 1)");

  const customerId =
    typeof c.customer_id === "string" || typeof c.customer_id === "number"
      ? normalizarCustomerId(String(c.customer_id))
      : null;
  if (!customerId) return falha("customer_id invalido: use o ID de cliente de 10 digitos");

  if (typeof c.moeda !== "string" || !RE_MOEDA.test(c.moeda)) return falha("moeda invalida");
  if (!fusoValido(c.fuso)) return falha("fuso invalido");
  const fuso = c.fuso;

  if (!diaValido(c.inicio) || !diaValido(c.fim)) return falha("inicio/fim devem ser AAAA-MM-DD");
  const inicio = c.inicio;
  const fim = c.fim;
  if (inicio > fim) return falha("inicio depois do fim");
  if (diasNoIntervalo({ desde: inicio, ate: fim }) > MAX_DIAS_INGEST) {
    return falha(`intervalo maior que ${MAX_DIAS_INGEST} dias`);
  }

  // "Hoje" no fuso DA CONTA: o dia do gasto segue a conta, nao o servidor.
  const hoje = diaNoFuso(agora, fuso);
  if (fim > somarDias(hoje, 1)) return falha("fim no futuro");
  if (inicio < somarDias(hoje, -MAX_DIAS_PARA_TRAS)) {
    return falha(`inicio mais de ${MAX_DIAS_PARA_TRAS} dias no passado`);
  }

  if (typeof c.gerado_em !== "string") return falha("gerado_em ausente");
  const geradoMs = Date.parse(c.gerado_em);
  if (!Number.isFinite(geradoMs)) return falha("gerado_em invalido");
  if (geradoMs > agora.getTime() + FOLGA_FUTURO_MS) return falha("gerado_em no futuro");

  if (!Array.isArray(c.linhas)) return falha("linhas deve ser uma lista");
  if (c.linhas.length > MAX_LINHAS_INGEST) {
    return falha(`mais de ${MAX_LINHAS_INGEST} linhas num envio`);
  }

  const linhas: GoogleIngestLinha[] = [];
  for (let i = 0; i < c.linhas.length; i += 1) {
    const bruta = c.linhas[i] as Record<string, unknown> | null;
    const onde = `linha ${i + 1}`;
    if (!bruta || typeof bruta !== "object") return falha(`${onde}: invalida`);

    if (!diaValido(bruta.data) || bruta.data < inicio || bruta.data > fim) {
      return falha(`${onde}: data fora de [inicio, fim]`);
    }
    const campanhaId =
      typeof bruta.campanha_id === "string" || typeof bruta.campanha_id === "number"
        ? String(bruta.campanha_id)
        : "";
    if (!/^\d{1,20}$/.test(campanhaId)) return falha(`${onde}: campanha_id invalido`);
    if (typeof bruta.campanha !== "string" || bruta.campanha.length > 255) {
      return falha(`${onde}: campanha invalida`);
    }
    const micros =
      typeof bruta.custo_micros === "string" || typeof bruta.custo_micros === "number"
        ? String(bruta.custo_micros)
        : "";
    // So digitos: barra negativo, decimal, notacao cientifica e lixo.
    if (!/^\d{1,15}$/.test(micros)) return falha(`${onde}: custo_micros invalido`);
    if (!inteiroNaoNegativo(bruta.cliques) || !inteiroNaoNegativo(bruta.impressoes)) {
      return falha(`${onde}: cliques/impressoes invalidos`);
    }
    if (!opcionalNaoNegativo(bruta.conversoes) || !opcionalNaoNegativo(bruta.valor_conversoes)) {
      return falha(`${onde}: conversoes invalidas`);
    }

    linhas.push({
      data: bruta.data,
      campanha_id: campanhaId,
      campanha: bruta.campanha,
      status: typeof bruta.status === "string" ? bruta.status.slice(0, 40) : undefined,
      custo_micros: micros,
      cliques: bruta.cliques,
      impressoes: bruta.impressoes,
      conversoes: typeof bruta.conversoes === "number" ? bruta.conversoes : undefined,
      valor_conversoes:
        typeof bruta.valor_conversoes === "number" ? bruta.valor_conversoes : undefined,
    });
  }

  return {
    ok: true,
    corpo: {
      v: 1,
      customer_id: customerId,
      moeda: c.moeda,
      fuso,
      inicio,
      fim,
      gerado_em: new Date(geradoMs).toISOString(),
      linhas,
    },
  };
}

interface Acumulado {
  micros: number;
  impressoes: number;
  cliques: number;
  compras: number;
  valor: number;
  nome: string | null;
}

function vazio(): Acumulado {
  return { micros: 0, impressoes: 0, cliques: 0, compras: 0, valor: 0, nome: null };
}

function somar(a: Acumulado, l: GoogleIngestLinha) {
  a.micros += Number(l.custo_micros);
  a.impressoes += l.impressoes;
  a.cliques += l.cliques;
  a.compras += l.conversoes ?? 0;
  a.valor += l.valor_conversoes ?? 0;
}

/**
 * Corpo validado -> linhas de ad_spend_daily.
 *
 * O nivel 'conta' sai para TODO dia da janela, mesmo sem campanha: o Google
 * nao devolve linha de dia zerado, e sem a linha zerada um custo corrigido
 * para 0 (clique invalido estornado, por exemplo) ficaria com o valor velho.
 * Soma em micros (inteiro) e divide no fim: somar reais quebrados acumula erro.
 */
export function linhasDoIngest(
  corpo: GoogleIngestCorpo,
  ctx: { ad_account_id: string; user_id: string; sincronizado_em: string }
): AdSpendDailyRow[] {
  const porCampanha = new Map<string, Acumulado & { data: string; campanha_id: string }>();
  const porDia = new Map<string, Acumulado>();

  for (const l of corpo.linhas) {
    const chave = `${l.data}|${l.campanha_id}`;
    let c = porCampanha.get(chave);
    if (!c) {
      c = { ...vazio(), data: l.data, campanha_id: l.campanha_id };
      porCampanha.set(chave, c);
    }
    somar(c, l);
    c.nome = l.campanha || c.nome;

    let d = porDia.get(l.data);
    if (!d) {
      d = vazio();
      porDia.set(l.data, d);
    }
    somar(d, l);
  }

  const base = {
    ad_account_id: ctx.ad_account_id,
    user_id: ctx.user_id,
    moeda: corpo.moeda,
    fonte: "script" as const,
    sincronizado_em: ctx.sincronizado_em,
  };
  const linha = (
    a: Acumulado,
    data: string,
    nivel: "conta" | "campanha",
    campanhaId: string
  ): AdSpendDailyRow => ({
    ...base,
    data,
    nivel,
    campanha_id: campanhaId,
    campanha_nome: nivel === "campanha" ? a.nome : null,
    gasto: arredondar(a.micros / 1_000_000, 4),
    impressoes: a.impressoes,
    cliques: a.cliques,
    compras: arredondar(a.compras, 2),
    valor_compras: arredondar(a.valor, 2),
  });

  const saida: AdSpendDailyRow[] = [];
  for (const dia of diasDoIntervalo({ desde: corpo.inicio, ate: corpo.fim })) {
    saida.push(linha(porDia.get(dia) ?? vazio(), dia, "conta", ""));
  }
  for (const c of porCampanha.values()) {
    saida.push(linha(c, c.data, "campanha", c.campanha_id));
  }
  return saida;
}

/** "Bearer <segredo>" -> segredo, ou null se o formato nao bate. */
export function segredoDoAuthorization(header: string | null): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec((header ?? "").trim());
  return m ? m[1] : null;
}
