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

/**
 * Texto -> numero, aceitando o formato brasileiro.
 *
 * Com "," e "." no mesmo numero, o ULTIMO e o decimal e o outro e milhar
 * ("1.234,56" e "1,234.56" dao 1234.56). So virgula = decimal ("12,5").
 * Vazio ou lixo = NaN; quem chama decide se vazio vale zero.
 */
export function lerNumero(texto: string | number | null | undefined): number {
  if (typeof texto === "number") return texto;
  if (texto === null || texto === undefined) return NaN;
  let t = String(texto).replace(/[\s ]/g, "");
  if (t === "") return NaN;
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

  const textoCusto = cru.custo_unitario;
  if (textoCusto === null || textoCusto === undefined || String(textoCusto).trim() === "") {
    return { ok: false, motivo: "custo vazio" };
  }
  const custo = lerNumero(textoCusto as string | number);
  if (!Number.isFinite(custo)) return { ok: false, motivo: `custo "${String(textoCusto)}" não é número` };
  if (custo < 0) return { ok: false, motivo: "custo negativo" };
  if (custo >= CUSTO_MAXIMO) return { ok: false, motivo: "custo alto demais (confira as casas decimais)" };

  const textoFrete = cru.frete_unitario;
  let frete = 0;
  if (textoFrete !== null && textoFrete !== undefined && String(textoFrete).trim() !== "") {
    frete = lerNumero(textoFrete as string | number);
    if (!Number.isFinite(frete)) return { ok: false, motivo: `frete "${String(textoFrete)}" não é número` };
    if (frete < 0) return { ok: false, motivo: "frete negativo" };
    if (frete >= CUSTO_MAXIMO) return { ok: false, motivo: "frete alto demais (confira as casas decimais)" };
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
    item: { sku, custo_unitario: custo, frete_unitario: frete, moeda, valido_desde },
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
