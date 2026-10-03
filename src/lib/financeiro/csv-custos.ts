import { RE_DIA, RE_MOEDA, type CustoItemCorpo } from "@/lib/financeiro/tipos";

// ============================================================================
// Leitura do CSV de custos e a validacao de um item de custo.
//
// Puro (sem server-only): a tela usa para mostrar a previa ANTES de mandar, e a
// rota usa a mesma validacao no servidor. Uma regra so -- se a previa aceitasse
// o que a rota recusa, o lojista veria "120 validas" e depois um erro sem
// explicacao.
//
// O arquivo vem de planilha brasileira na maioria das vezes: Excel em pt-BR
// salva com ";" e decimal com virgula. Por isso o separador e detectado pelo
// cabecalho e o numero aceita "1.234,56" e "1,234.56".
// ============================================================================

/** Linhas de dados por arquivo. Acima disso o upsert vira carga demais numa requisicao so. */
export const MAX_LINHAS_CSV = 5000;

/** Teto de sanidade: numeric(12,4) no banco, e custo de 10 milhoes e erro de digitacao. */
const CUSTO_MAXIMO = 10_000_000;

const ALIASES: Record<"sku" | "custo" | "frete" | "moeda" | "desde", string[]> = {
  sku: ["sku"],
  custo: ["custo_unitario", "custo", "cost", "custo_produto"],
  frete: ["frete_unitario", "frete", "shipping"],
  moeda: ["moeda", "currency"],
  desde: ["valido_desde", "vale_desde", "data", "desde"],
};

/** Espaco comum e o inseparavel (U+00A0) que o Excel poe no milhar. */
function semEspaco(texto: string): string {
  return texto.replace(/[\s\u00a0]/g, "");
}

/**
 * "4.990" sem virgula: um ponto seguido de exatamente tres digitos. Na
 * planilha brasileira e milhar (4990); na americana, decimal (4,99). Chutar
 * errado multiplica ou divide o custo por mil sem erro nenhum -- o lucro so
 * aparece errado. Entao o numero e recusado com a explicacao, e o lojista
 * escreve "4990" ou "4,99". "0.125" nao e ambiguo: milhar nao comeca com zero.
 */
export function numeroAmbiguo(texto: unknown): boolean {
  if (typeof texto !== "string") return false;
  return /^-?[1-9]\d{0,2}\.\d{3}$/.test(semEspaco(texto));
}

/**
 * Texto -> numero, aceitando o formato brasileiro.
 *
 * Com "," e "." no mesmo numero, o ULTIMO e o decimal e o outro e milhar
 * ("1.234,56" e "1,234.56" dao 1234.56). So virgula = decimal ("12,5").
 * Varios grupos de milhar sem decimal ("1.234.567", "1,234,567") sao milhar.
 * Ambiguo ("4.990", ver numeroAmbiguo), vazio ou lixo = NaN; quem chama
 * decide se vazio vale zero.
 */
export function lerNumero(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  if (texto === null || texto === undefined) return NaN;
  let t = semEspaco(String(texto));
  if (t === "") return NaN;
  if (numeroAmbiguo(t)) return NaN;
  if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t)) return Number(t.replace(/\./g, ""));
  if (/^-?\d{1,3}(,\d{3}){2,}$/.test(t)) return Number(t.replace(/,/g, ""));
  const virgula = t.lastIndexOf(",");
  const ponto = t.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) {
    if (virgula > ponto) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (virgula >= 0) {
    t = t.replace(/,/g, ".");
  }
  // Number("") = 0 e Number("1e3") = 1000: so aceita digitos, sinal e um ponto.
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.$/.test(t)) return NaN;
  return Number(t);
}

/** "AAAA-MM-DD" que existe no calendario (recusa 2026-02-30). */
export function diaValido(dia: string): boolean {
  if (!RE_DIA.test(dia)) return false;
  const d = new Date(`${dia}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

export interface CustoCru {
  sku?: unknown;
  custo_unitario?: unknown;
  frete_unitario?: unknown;
  moeda?: unknown;
  valido_desde?: unknown;
}

/** O valor cru esta vazio (null, undefined ou so espaco)? */
function vazio(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

/**
 * Um valor de dinheiro (custo ou frete) validado, ou o motivo em portugues.
 * E a mesma regra para o CSV, para o campo da tabela e para a rota: o que a
 * tela aceita, o servidor aceita. Vazio e recusado; quem aceita vazio (o
 * frete) confere antes de chamar.
 */
export function validarValor(
  cru: unknown,
  nome: "custo" | "frete"
): { ok: true; valor: number } | { ok: false; motivo: string } {
  if (vazio(cru)) return { ok: false, motivo: `${nome} vazio` };
  const texto = String(cru).trim();
  // So texto e ambiguo: o number que a tela manda no JSON ja e o valor (1.234 = 1,234).
  if (typeof cru === "string" && numeroAmbiguo(texto)) {
    const decimal = Number(semEspaco(texto)).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    const milhar = semEspaco(texto).replace(".", "");
    return {
      ok: false,
      motivo: `${nome} "${texto}" é ambíguo: escreva ${milhar} (milhar) ou ${decimal} (decimal)`,
    };
  }
  const valor = lerNumero(typeof cru === "number" ? cru : texto);
  if (!Number.isFinite(valor)) return { ok: false, motivo: `${nome} "${texto}" não é número` };
  if (valor < 0) return { ok: false, motivo: `${nome} negativo` };
  if (valor >= CUSTO_MAXIMO) return { ok: false, motivo: `${nome} alto demais (confira as casas decimais)` };
  return { ok: true, valor };
}

/**
 * Um item de custo validado, ou o motivo da recusa (em portugues, para a tela).
 * `moedaPadrao` preenche moeda vazia; null = moeda obrigatoria.
 */
export function validarCustoItem(
  cru: CustoCru,
  moedaPadrao: string | null
): { ok: true; item: CustoItemCorpo } | { ok: false; motivo: string } {
  const sku = typeof cru.sku === "string" ? cru.sku.trim() : "";
  if (sku.length === 0) return { ok: false, motivo: "SKU vazio" };
  if (sku.length > 255) return { ok: false, motivo: "SKU com mais de 255 caracteres" };

  const custo = validarValor(cru.custo_unitario, "custo");
  if (!custo.ok) return custo;

  let frete = 0;
  if (!vazio(cru.frete_unitario)) {
    const r = validarValor(cru.frete_unitario, "frete");
    if (!r.ok) return r;
    frete = r.valor;
  }

  const textoMoeda = typeof cru.moeda === "string" ? cru.moeda.trim().toUpperCase() : "";
  const moeda = textoMoeda || (moedaPadrao ?? "").trim().toUpperCase();
  if (!moeda) return { ok: false, motivo: "moeda vazia" };
  if (!RE_MOEDA.test(moeda)) return { ok: false, motivo: `moeda "${moeda}" inválida (use 3 letras, ex.: USD)` };

  const textoDesde = typeof cru.valido_desde === "string" ? cru.valido_desde.trim() : "";
  let valido_desde: string | null = null;
  if (textoDesde) {
    if (!diaValido(textoDesde)) {
      return { ok: false, motivo: `data "${textoDesde}" inválida (use AAAA-MM-DD)` };
    }
    valido_desde = textoDesde;
  } else if (cru.valido_desde !== null && cru.valido_desde !== undefined && typeof cru.valido_desde !== "string") {
    return { ok: false, motivo: "data inválida (use AAAA-MM-DD)" };
  }

  return {
    ok: true,
    item: { sku, custo_unitario: custo.valor, frete_unitario: frete, moeda, valido_desde },
  };
}

/**
 * Quebra uma linha respeitando aspas: Excel poe "1,50" entre aspas quando o
 * separador e virgula, e um split ingenuo partiria o numero em dois.
 */
function quebrarLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let entreAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (entreAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i += 1;
        } else {
          entreAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === sep) {
      campos.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((v) => v.trim());
}

export interface ResultadoCsvCustos {
  itens: CustoItemCorpo[];
  erros: { linha: number; motivo: string }[];
}

/**
 * CSV -> itens de custo + erros por linha. O numero da linha e o do arquivo
 * (o cabecalho e a linha 1), para o lojista achar na planilha.
 */
export function parseCsvCustos(texto: string, moedaPadrao: string): ResultadoCsvCustos {
  const itens: CustoItemCorpo[] = [];
  const erros: { linha: number; motivo: string }[] = [];

  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const naoVazias: { numero: number; texto: string }[] = [];
  linhas.forEach((t, i) => {
    if (t.trim() !== "") naoVazias.push({ numero: i + 1, texto: t });
  });
  if (naoVazias.length === 0) {
    return { itens, erros: [{ linha: 1, motivo: "arquivo vazio" }] };
  }

  const cabecalho = naoVazias[0];
  const sep = cabecalho.texto.includes(";") ? ";" : cabecalho.texto.includes("\t") ? "\t" : ",";
  const colunas = quebrarLinha(cabecalho.texto, sep).map((c) => c.toLowerCase().replace(/^﻿/, ""));
  const indice = (chave: keyof typeof ALIASES) =>
    colunas.findIndex((c) => ALIASES[chave].includes(c));

  const iSku = indice("sku");
  const iCusto = indice("custo");
  if (iSku < 0 || iCusto < 0) {
    const faltam = [iSku < 0 ? "sku" : null, iCusto < 0 ? "custo_unitario" : null]
      .filter(Boolean)
      .join(" e ");
    return {
      itens,
      erros: [
        {
          linha: cabecalho.numero,
          motivo: `cabeçalho sem a coluna ${faltam} (use sku;custo_unitario;frete_unitario;moeda;valido_desde)`,
        },
      ],
    };
  }
  const iFrete = indice("frete");
  const iMoeda = indice("moeda");
  const iDesde = indice("desde");

  const dados = naoVazias.slice(1);
  dados.forEach((l, k) => {
    if (k >= MAX_LINHAS_CSV) {
      // Um erro so para o excedente: 3000 linhas de "excedeu" esconderiam os
      // erros que importam.
      if (k === MAX_LINHAS_CSV) {
        erros.push({
          linha: l.numero,
          motivo: `mais de ${MAX_LINHAS_CSV} linhas: daqui em diante nada foi lido. Divida o arquivo.`,
        });
      }
      return;
    }
    const campos = quebrarLinha(l.texto, sep);
    const campo = (i: number) => (i >= 0 ? (campos[i] ?? "") : "");
    const r = validarCustoItem(
      {
        sku: campo(iSku),
        custo_unitario: campo(iCusto),
        frete_unitario: campo(iFrete),
        moeda: campo(iMoeda),
        valido_desde: campo(iDesde),
      },
      moedaPadrao
    );
    if (r.ok) itens.push(r.item);
    else erros.push({ linha: l.numero, motivo: r.motivo });
  });

  return { itens, erros };
}
